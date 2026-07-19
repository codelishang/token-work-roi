import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createSqliteBackup, openDb, recordRun, upsertDaily, upsertSession, upsertTokenEvent } from './db.ts';
import { loadPricing } from './pricing.ts';
import { collectableCollectors, collectorLabel, enabledCollectorIds } from './collector-registry.ts';

type InputRecord = Record<string, unknown>;

interface CollectArgs {
  [key: string]: string | boolean | undefined;
  apply?: boolean;
  collectors?: string;
  db?: string;
  device?: string;
  dryRun?: boolean;
  experimental?: boolean;
  help?: boolean;
  json?: boolean;
  push?: string;
  sources?: string;
  token?: string;
  yes?: boolean;
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  validateMode(args);
  const mode = args.apply ? 'apply' : 'dry-run';
  await confirmApplyIfNeeded(args);

  const device = args.device || hostname();
  const collectedAt = new Date().toISOString();
  const pricingCachePath = resolve(process.cwd(), 'data', 'official-pricing.json');
  const pricingData = await loadPricing(pricingCachePath);
  const enabled = enabledCollectors(args);
  const scheduled = isScheduledCollection();
  const includeExperimental = Boolean(args.sources || args.collectors || args.experimental);
  const collectors = collectableCollectors({ includeExperimental }).filter(({ id }) => enabled.has(id));
  const exportPayload = {
    device,
    collectedAt,
    daily: [],
    sessions: [],
    tokenEvents: [],
    runs: []
  };

  let db = null;
  const summary = {
    ok: true,
    mode,
    device,
    collectedAt,
    enabledCollectors: Array.from(enabled),
    before: null,
    after: null,
    backup: null,
    totals: {
      dailyRows: 0,
      sessionRows: 0,
      tokenEvents: 0,
      candidateFiles: 0,
      usableTokenRecords: 0,
      skippedNoTokenRecords: 0,
      skippedConversationLikeRecords: 0,
      skippedOversizedFiles: 0,
      parseErrors: 0,
      auditSessionRows: 0,
      auditTokenEvents: 0,
      auditTotalTokens: 0,
      dailyTotalTokens: 0,
      sessionTotalTokens: 0,
      eventTotalTokens: 0,
      totalTokens: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      fatalCoverageErrors: 0
    },
    sources: []
  };

  if (mode === 'apply') {
    db = openDb(args.db);
    summary.before = countRows(db);
  }

  try {
    await collectLocal({ collectors, mode, db, dbPath: args.db, pricingData, device, collectedAt, exportPayload, summary, scheduled });
    if (args.push) {
      if (mode !== 'apply') throw new Error('--push is only available with --apply.');
      await pushPayload(args.push, exportPayload, args.token);
    }
  } finally {
    if (db) {
      summary.after = countRows(db);
      db.close();
    }
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }

  if (summary.sources.some(source => source.status === 'error')) {
    process.exitCode = 1;
  }
}

async function collectLocal({ collectors, mode, db, dbPath, pricingData, device, collectedAt, exportPayload, summary, scheduled }) {
  if (!collectors.length) return;

  const payloads = [];

  for (const { id, module, label } of collectors) {
    let graphJson = {};
    let modelsJson = {};
    let tokenEvents = [];
    let audit = emptyAuditSummary();
    const sourceSummary = {
      id,
      label,
      status: 'empty',
      message: '',
      dailyRows: 0,
      sessionRows: 0,
      tokenEvents: 0,
      candidateFiles: 0,
      usableTokenRecords: 0,
      skippedNoTokenRecords: 0,
      skippedConversationLikeRecords: 0,
      skippedOversizedFiles: 0,
      parseErrors: 0,
      dailyTotalTokens: 0,
      sessionTotalTokens: 0,
      eventTotalTokens: 0,
      totalTokens: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      coverageRisk: 'empty',
      coverageStatus: 'empty',
      fatalCoverageError: false,
      reconciliation: null
    };

    try {
      const collectorModule = await import(module);
      if (typeof collectorModule.audit === 'function') {
        audit = normalizeAuditSummary(await collectorModule.audit());
      }
      if (typeof collectorModule.collect !== 'function') {
        throw new Error(`Collector ${id} does not export collect()`);
      }
      ({ graphJson = {}, modelsJson = {}, tokenEvents = [] } = await collectorModule.collect(pricingData));
    } catch (error) {
      sourceSummary.status = 'error';
      sourceSummary.message = error.message;
      addAuditToSource(sourceSummary, audit);
      addCoverageReconciliation(sourceSummary, [], [], []);
      addSummary(summary, sourceSummary);
      payloads.push({ type: 'error', sourceSummary, label, module, message: error.message });
      continue;
    }

    const dailyRows = normalizeDailyRows(graphJson, device);
    const sessionRows = normalizeSessionRows(modelsJson, device);
    const eventRows = normalizeTokenEventRows(tokenEvents, device, collectedAt);
    sourceSummary.dailyRows = dailyRows.length;
    sourceSummary.sessionRows = sessionRows.length;
    sourceSummary.tokenEvents = eventRows.length;
    sourceSummary.status = dailyRows.length || sessionRows.length || eventRows.length ? 'ok' : 'empty';
    sourceSummary.message = [
      `daily=${dailyRows.length}`,
      `sessions=${sessionRows.length}`,
      `token_events=${eventRows.length}`
    ].join(', ');
    addAuditToSource(sourceSummary, audit);
    addCoverageReconciliation(sourceSummary, dailyRows, sessionRows, eventRows);
    addSummary(summary, sourceSummary);

    exportPayload.daily.push(...dailyRows);
    exportPayload.sessions.push(...sessionRows);
    exportPayload.tokenEvents.push(...eventRows);

    payloads.push({ type: 'data', sourceSummary, label, module, dailyRows, sessionRows, eventRows });
  }

  const fatal = summary.sources.filter(source => source.fatalCoverageError);
  if (mode === 'apply' && fatal.length) {
    summary.ok = false;
    throw new Error(`Coverage gate blocked collection apply: ${fatal.map(source => `${source.id}:${source.coverageRisk}`).join(', ')}`);
  }

  if (mode === 'apply' && db) {
    const shouldBackup = !scheduled || tokenUsageWouldChange(db, payloads);
    summary.backup = shouldBackup
      ? createSqliteBackup(db, dbPath, scheduled
          ? {
              reason: 'scheduled-collect',
              minimumIntervalMs: 60 * 60 * 1000,
              maxBackups: 24
            }
          : { reason: 'collect' })
      : null;
  }

  for (const payload of payloads) {
    if (mode === 'apply') {
      if (payload.type === 'error') {
        const run = runRecord({
          device,
          label: payload.label,
          status: 'error',
          message: payload.message,
          collectedAt,
          module: payload.module
        });
        recordCollectionRun(db, run, scheduled);
        exportPayload.runs.push(run);
        continue;
      }
      const { sourceSummary, label, module, dailyRows, sessionRows, eventRows } = payload;
      const run = runRecord({
        device,
        label,
        status: sourceSummary.status,
        message: `${sourceSummary.message}; candidate_files=${sourceSummary.candidateFiles}; usable_records=${sourceSummary.usableTokenRecords}; skipped_no_token=${sourceSummary.skippedNoTokenRecords}; skipped_unsafe=${sourceSummary.skippedConversationLikeRecords}`,
        collectedAt,
        module
      });
      runInTransaction(db, () => {
        dailyRows.forEach(row => upsertDaily(db, row));
        sessionRows.forEach(row => upsertSession(db, row));
        const deleteLegacyEvent = db.prepare(`
          DELETE FROM token_events
          WHERE event_id = ? AND device = ? AND source = ?
        `);
        for (const row of eventRows) {
          for (const legacyEventId of row.legacyEventIds) {
            deleteLegacyEvent.run(legacyEventId, row.device, row.source);
          }
          upsertTokenEvent(db, row);
        }
        recordCollectionRun(db, run, scheduled);
      });
      exportPayload.runs.push(run);
    }
  }
}

function tokenUsageWouldChange(db, payloads) {
  const matchingDaily = db.prepare(`
    SELECT 1
    FROM daily_usage
    WHERE device = ? AND source = ? AND usage_date = ? AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_creation_tokens = ? AND cache_read_tokens = ?
      AND reasoning_output_tokens = ? AND total_tokens = ?
  `);
  const matchingSession = db.prepare(`
    SELECT 1
    FROM session_usage
    WHERE device = ? AND source = ? AND session_id = ?
      AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_creation_tokens = ? AND cache_read_tokens = ?
      AND reasoning_output_tokens = ? AND total_tokens = ?
  `);
  const matchingEvent = db.prepare(`
    SELECT 1
    FROM token_events
    WHERE device = ? AND source = ? AND session_id = ? AND timestamp = ? AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_read_tokens = ? AND cache_creation_tokens = ? AND reasoning_tokens = ?
    LIMIT 1
  `);
  const legacyEvent = db.prepare(`
    SELECT 1 FROM token_events
    WHERE event_id = ? AND device = ? AND source = ?
  `);

  for (const payload of payloads) {
    if (payload.type === 'error') continue;
    for (const row of payload.dailyRows) {
      if (!matchingDaily.get(
        row.device, row.source, row.usageDate, row.model,
        row.inputTokens, row.outputTokens, row.cacheCreationTokens,
        row.cacheReadTokens, row.reasoningOutputTokens, row.totalTokens
      )) return true;
    }
    for (const row of payload.sessionRows) {
      if (!matchingSession.get(
        row.device, row.source, row.sessionId,
        row.model,
        row.inputTokens, row.outputTokens, row.cacheCreationTokens,
        row.cacheReadTokens, row.reasoningOutputTokens, row.totalTokens
      )) return true;
    }
    for (const row of payload.eventRows) {
      if (row.legacyEventIds.some(eventId => legacyEvent.get(eventId, row.device, row.source))) return true;
      if (!matchingEvent.get(
        row.device, row.source, row.sessionId, row.timestamp, row.model,
        row.inputTokens, row.outputTokens, row.cacheReadTokens,
        row.cacheCreationTokens, row.reasoningTokens
      )) return true;
    }
  }
  return false;
}

function isScheduledCollection() {
  const reason = process.env.TOKEN_WORK_COLLECT_REASON;
  return reason === 'scheduled'
    || (!reason && ['1', 'true', 'yes', 'on'].includes(String(process.env.SCHEDULED_COLLECT_ENABLED || '').toLowerCase()));
}

function recordCollectionRun(db, run, scheduled) {
  if (!scheduled) {
    recordRun(db, run);
    return;
  }
  const previous = db.prepare(`
    SELECT status, message, collected_at AS collectedAt
    FROM collection_runs
    WHERE device = ? AND source = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(run.device, run.source);
  const elapsed = previous
    ? new Date(run.collectedAt).getTime() - new Date(previous.collectedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const sameOutcome = previous?.status === run.status
    && (run.status === 'ok' || previous?.message === run.message);
  if (sameOutcome && elapsed >= 0 && elapsed < 60 * 60 * 1000) return;
  recordRun(db, run);
}

function validateMode(args) {
  if (args.dryRun && args.apply) {
    throw new Error('Choose either --dry-run or --apply, not both.');
  }
  if (!args.dryRun && !args.apply) {
    throw new Error('collect requires --dry-run or --apply. No local AI logs were scanned and SQLite was not modified.');
  }
  if (args.push && !args.apply) {
    throw new Error('--push requires --apply.');
  }
}

async function confirmApplyIfNeeded(args) {
  if (!args.apply) return;
  if (args.yes || process.env.TOKEN_WORK_COLLECT_CONFIRMED === '1') return;
  if (!process.stdin.isTTY) {
    throw new Error('collect --apply requires --yes in non-interactive shells.');
  }
  const sources = args.sources || args.collectors || 'configured defaults';
  const rl = createInterface({ input, output });
  try {
    console.log('This will scan local AI coding logs for structured token usage and write SQLite.');
    console.log(`Sources: ${sources}`);
    console.log('Token Work only imports token/model/time/session metadata. It does not save prompt, response, transcript, diff, or full file paths.');
    const answer = await rl.question('Type APPLY to continue: ');
    if (answer.trim() !== 'APPLY') {
      throw new Error('Collection cancelled. SQLite was not modified.');
    }
  } finally {
    rl.close();
  }
}

function enabledCollectors(args) {
  const sourceArg = args.sources || args.collectors;
  if (sourceArg) {
    return enabledCollectorIds({ includeExperimental: true, values: sourceArg });
  }
  return enabledCollectorIds({ includeExperimental: Boolean(args.experimental) });
}

function runInTransaction(database, work) {
  database.exec('BEGIN');
  try {
    work();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function countRows(db) {
  const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    dailyRows: count('daily_usage'),
    sessionRows: count('session_usage'),
    tokenEvents: count('token_events'),
    collectionRuns: count('collection_runs')
  };
}

function normalizeDailyRows(json, deviceName) {
  const days = Array.isArray(json.contributions) ? json.contributions : [];
  return days.flatMap((day) => {
    const clients = Array.isArray(day.clients) ? day.clients : [];
    return clients.map((entry) => {
      const tokens = normalizeTokens(entry.tokens);
      return {
        device: deviceName,
        source: sourceLabel(entry.client),
        usageDate: day.date,
        model: entry.modelId || entry.model_id || 'unknown',
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheCreationTokens: tokens.cacheWrite,
        cacheReadTokens: tokens.cacheRead,
        reasoningOutputTokens: tokens.reasoning,
        totalTokens: tokenTotal(tokens),
        costUSD: entry.cost || 0
      };
    });
  });
}

function normalizeSessionRows(json, deviceName) {
  const entries = Array.isArray(json.entries) ? json.entries : [];
  return entries.map((entry) => {
    const tokens = {
      input: positiveNumber(entry.input),
      output: positiveNumber(entry.output),
      cacheRead: positiveNumber(entry.cacheRead),
      cacheWrite: positiveNumber(entry.cacheWrite),
      reasoning: positiveNumber(entry.reasoning)
    };
    const source = sourceLabel(entry.client);
    const workspace = entry.workspaceLabel || entry.workspaceKey || '';
    const model = entry.model || 'unknown';
    return {
      device: deviceName,
      source,
      sessionId: entry.sessionId || ['local', entry.client || 'unknown', workspace || 'no-workspace', model].join(':'),
      lastActivity: entry.lastActivity || null,
      projectPath: workspace || null,
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheCreationTokens: tokens.cacheWrite,
      cacheReadTokens: tokens.cacheRead,
      reasoningOutputTokens: tokens.reasoning,
      totalTokens: tokenTotal(tokens),
      costUSD: entry.cost || 0
    };
  });
}

function normalizeTokenEventRows(events, deviceName, collectedAt) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const eventId = event.eventId ?? event.event_id ?? null;
    return {
      device: deviceName,
      source: sourceLabel(event.source || event.client),
      sessionId: event.sessionId || event.session_id || 'unknown-session',
      timestamp: event.timestamp || collectedAt,
      model: event.model || 'unknown',
      inputTokens: positiveNumber(event.inputTokens ?? event.input_tokens),
      outputTokens: positiveNumber(event.outputTokens ?? event.output_tokens),
      cacheReadTokens: positiveNumber(event.cacheReadTokens ?? event.cache_read_tokens),
      cacheCreationTokens: positiveNumber(event.cacheCreationTokens ?? event.cache_creation_tokens),
      reasoningTokens: positiveNumber(event.reasoningTokens ?? event.reasoning_tokens),
      toolCategory: event.toolCategory ?? event.tool_category ?? null,
      fileExtension: event.fileExtension ?? event.file_extension ?? null,
      repoPathHash: event.repoPathHash ?? event.repo_path_hash ?? null,
      privacyLevel: event.privacyLevel ?? event.privacy_level ?? 'safe',
      eventId,
      legacyEventIds: [...new Set(Array.isArray(event.legacyEventIds) ? event.legacyEventIds : [])]
        .filter(candidate => typeof candidate === 'string' && candidate && candidate !== eventId)
    };
  });
}

function normalizeTokens(tokens: InputRecord = {}) {
  return {
    input: positiveNumber(tokens.input),
    output: positiveNumber(tokens.output),
    cacheRead: positiveNumber(tokens.cacheRead ?? tokens.cache_read),
    cacheWrite: positiveNumber(tokens.cacheWrite ?? tokens.cache_write),
    reasoning: positiveNumber(tokens.reasoning)
  };
}

function tokenTotal(tokens) {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning;
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function sourceLabel(client) {
  return collectorLabel(client) || client || 'unknown';
}

function runRecord({ device, label, status, message, collectedAt, module }) {
  return {
    device,
    source: label,
    status,
    message,
    collectedAt,
    command: `js-collector:${module}`
  };
}

function emptyAuditSummary() {
  return {
    candidateFiles: 0,
    usableTokenRecords: 0,
    skippedNoTokenRecords: 0,
    skippedConversationLikeRecords: 0,
    skippedOversizedFiles: 0,
    parseErrors: 0,
    sessionRows: 0,
    tokenEvents: 0,
    totalTokens: 0,
    firstTimestamp: null,
    lastTimestamp: null
  };
}

function normalizeAuditSummary(value: InputRecord = {}) {
  const summary = emptyAuditSummary();
  for (const key of [
    'candidateFiles',
    'usableTokenRecords',
    'skippedNoTokenRecords',
    'skippedConversationLikeRecords',
    'skippedOversizedFiles',
    'parseErrors',
    'sessionRows',
    'tokenEvents',
    'totalTokens'
  ]) {
    summary[key] = positiveNumber(value[key]);
  }
  summary.firstTimestamp = safeTimestamp(value.firstTimestamp);
  summary.lastTimestamp = safeTimestamp(value.lastTimestamp);
  return summary;
}

function addAuditToSource(sourceSummary, audit) {
  const normalized = normalizeAuditSummary(audit);
  for (const key of [
    'candidateFiles',
    'usableTokenRecords',
    'skippedNoTokenRecords',
    'skippedConversationLikeRecords',
    'skippedOversizedFiles',
    'parseErrors'
  ]) {
    sourceSummary[key] = normalized[key];
  }
  sourceSummary.auditSessionRows = normalized.sessionRows;
  sourceSummary.auditTokenEvents = normalized.tokenEvents;
  sourceSummary.auditTotalTokens = normalized.totalTokens;
  sourceSummary.firstTimestamp = normalized.firstTimestamp || sourceSummary.firstTimestamp;
  sourceSummary.lastTimestamp = normalized.lastTimestamp || sourceSummary.lastTimestamp;
}

function addSummary(summary, sourceSummary) {
  summary.sources.push(sourceSummary);
  for (const key of Object.keys(summary.totals)) {
    if (typeof summary.totals[key] === 'number') {
      summary.totals[key] += Number(sourceSummary[key] || 0);
    }
  }
  summary.totals.firstTimestamp = earlierTimestamp(summary.totals.firstTimestamp, sourceSummary.firstTimestamp);
  summary.totals.lastTimestamp = laterTimestamp(summary.totals.lastTimestamp, sourceSummary.lastTimestamp);
}

function printSummary(summary) {
  console.log(`[collect] mode=${summary.mode} enabled=${summary.enabledCollectors.join(',') || 'none'}`);
  for (const source of summary.sources) {
    console.log(`[${source.label}] status=${source.status} risk=${source.coverageRisk} daily=${source.dailyRows} sessions=${source.sessionRows} token_events=${source.tokenEvents} candidate_files=${source.candidateFiles} usable_records=${source.usableTokenRecords} skipped_no_token=${source.skippedNoTokenRecords} skipped_unsafe=${source.skippedConversationLikeRecords} parse_errors=${source.parseErrors} tokens(event/session/daily)=${source.eventTotalTokens}/${source.sessionTotalTokens}/${source.dailyTotalTokens}`);
    if (source.firstTimestamp || source.lastTimestamp) console.log(`  range=${source.firstTimestamp || '-'}..${source.lastTimestamp || '-'}`);
    if (source.coverageStatus) console.log(`  coverage=${source.coverageStatus}`);
    if (source.status === 'error' && source.message) console.log(`  error=${source.message}`);
  }
  if (summary.mode === 'dry-run') {
    console.log('[collect] dry-run only. Re-run with --apply --yes after reviewing this summary to write SQLite.');
    return;
  }
  if (summary.backup?.path) console.log(`[collect] backup=${summary.backup.path}`);
  if (summary.before && summary.after) {
    console.log(`[collect] rows before daily=${summary.before.dailyRows} sessions=${summary.before.sessionRows} events=${summary.before.tokenEvents} runs=${summary.before.collectionRuns}`);
    console.log(`[collect] rows after  daily=${summary.after.dailyRows} sessions=${summary.after.sessionRows} events=${summary.after.tokenEvents} runs=${summary.after.collectionRuns}`);
  }
}

function addCoverageReconciliation(sourceSummary, dailyRows, sessionRows, eventRows) {
  if (eventRows.length > 0) {
    sourceSummary.usableTokenRecords = eventRows.length;
  }
  const dailyTotalTokens = sumDailyTokens(dailyRows);
  const sessionTotalTokens = sumSessionTokens(sessionRows);
  const eventTotalTokens = sumEventTokens(eventRows);
  const firstEventTimestamp = firstTimestamp(eventRows.map(row => row.timestamp));
  const lastEventTimestamp = lastTimestamp(eventRows.map(row => row.timestamp));
  sourceSummary.dailyTotalTokens = dailyTotalTokens;
  sourceSummary.sessionTotalTokens = sessionTotalTokens;
  sourceSummary.eventTotalTokens = eventTotalTokens;
  sourceSummary.totalTokens = eventTotalTokens || sessionTotalTokens || dailyTotalTokens || sourceSummary.totalTokens || 0;
  sourceSummary.firstTimestamp = firstEventTimestamp || sourceSummary.firstTimestamp;
  sourceSummary.lastTimestamp = lastEventTimestamp || sourceSummary.lastTimestamp;
  sourceSummary.reconciliation = {
    candidateRecords: sourceSummary.usableTokenRecords,
    tokenEvents: eventRows.length,
    sessions: sessionRows.length,
    dailyRows: dailyRows.length,
    dailyTotalTokens,
    sessionTotalTokens,
    eventTotalTokens,
    dailyVsEventDiffPct: diffPct(dailyTotalTokens, eventTotalTokens),
    sessionVsEventDiffPct: diffPct(sessionTotalTokens, eventTotalTokens)
  };

  const hasUsableRecords = sourceSummary.usableTokenRecords > 0;
  const needsEventLevel = sourceSummary.id === 'claude' || sourceSummary.id === 'codex';

  if (sourceSummary.status === 'error') {
    sourceSummary.coverageRisk = 'collector-error';
    sourceSummary.coverageStatus = 'collector failed before producing rows';
    return;
  }
  if (needsEventLevel && hasUsableRecords && eventRows.length === 0) {
    sourceSummary.coverageRisk = 'blocking-no-events';
    sourceSummary.coverageStatus = 'usable token records were found but no token_events would be written';
    sourceSummary.fatalCoverageError = true;
    sourceSummary.fatalCoverageErrors = 1;
    return;
  }
  if (eventRows.length > 0 && (
    diffPct(dailyTotalTokens, eventTotalTokens) > 0.01 ||
    diffPct(sessionTotalTokens, eventTotalTokens) > 0.01
  )) {
    sourceSummary.coverageRisk = 'blocking-reconciliation-mismatch';
    sourceSummary.coverageStatus = 'daily/session/event token totals differ by more than 1%';
    sourceSummary.fatalCoverageError = true;
    sourceSummary.fatalCoverageErrors = 1;
    return;
  }
  if (sourceSummary.id === 'cursor' && sourceSummary.candidateFiles > 0 && sourceSummary.usableTokenRecords === 0) {
    sourceSummary.coverageRisk = 'detected-no-token-fields';
    sourceSummary.coverageStatus = 'Cursor was detected, but no reliable tokenCount fields were found';
    return;
  }
  if (sourceSummary.candidateFiles === 0) {
    sourceSummary.coverageRisk = 'not-detected';
    sourceSummary.coverageStatus = 'no candidate local metadata files were found';
    return;
  }
  if (eventRows.length > 0) {
    sourceSummary.coverageRisk = 'trusted-event-level';
    sourceSummary.coverageStatus = 'event/session/daily totals reconcile within 1%';
    return;
  }
  if (dailyRows.length || sessionRows.length) {
    sourceSummary.coverageRisk = 'aggregate-only';
    sourceSummary.coverageStatus = 'only aggregate rows would be written; historical event coverage is incomplete';
    return;
  }
  sourceSummary.coverageRisk = 'empty';
  sourceSummary.coverageStatus = 'candidate files did not produce token usage rows';
}

function sumDailyTokens(rows) {
  return rows.reduce((sum, row) => sum + positiveNumber(row.totalTokens), 0);
}

function sumSessionTokens(rows) {
  return rows.reduce((sum, row) => sum + positiveNumber(row.totalTokens), 0);
}

function sumEventTokens(rows) {
  return rows.reduce((sum, row) => sum
    + positiveNumber(row.inputTokens)
    + positiveNumber(row.outputTokens)
    + positiveNumber(row.cacheReadTokens)
    + positiveNumber(row.cacheCreationTokens)
    + positiveNumber(row.reasoningTokens), 0);
}

function diffPct(left, right) {
  const max = Math.max(Number(left || 0), Number(right || 0), 1);
  return Math.abs(Number(left || 0) - Number(right || 0)) / max;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? value : null;
}

function firstTimestamp(values) {
  return values.reduce((best, value) => earlierTimestamp(best, value), null);
}

function lastTimestamp(values) {
  return values.reduce((best, value) => laterTimestamp(best, value), null);
}

function earlierTimestamp(left, right) {
  const safeRight = safeTimestamp(right);
  if (!safeRight) return safeTimestamp(left);
  const safeLeft = safeTimestamp(left);
  if (!safeLeft) return safeRight;
  return new Date(safeRight) < new Date(safeLeft) ? safeRight : safeLeft;
}

function laterTimestamp(left, right) {
  const safeRight = safeTimestamp(right);
  if (!safeRight) return safeTimestamp(left);
  const safeLeft = safeTimestamp(left);
  if (!safeLeft) return safeRight;
  return new Date(safeRight) > new Date(safeLeft) ? safeRight : safeLeft;
}

function parseArgs(argv) {
  const booleanKeys = new Set(['apply', 'dryRun', 'experimental', 'help', 'json', 'yes']);
  const valueKeys = new Set(['collectors', 'db', 'device', 'push', 'sources', 'token']);
  const parsed: CollectArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.slice(2).split(/=(.*)/s);
      const camelKey = toCamel(key);
      parsed[camelKey] = parseArgValue(camelKey, value, booleanKeys);
    } else if (arg.startsWith('--')) {
      const key = toCamel(arg.slice(2));
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        if (valueKeys.has(key)) throw new Error(`--${arg.slice(2)} requires a value`);
        parsed[key] = true;
      } else {
        parsed[key] = parseArgValue(key, next, booleanKeys);
        i += 1;
      }
    }
  }
  return parsed;
}

function parseArgValue(key, value, booleanKeys) {
  if (!booleanKeys.has(key)) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)} must be true or false`);
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function printHelp() {
  console.log([
    'Token Work collector',
    '',
    'Examples:',
    '  token-work collect --dry-run --sources=claude,codex,cursor',
    '  token-work collect --apply --yes --sources=claude,codex',
    '',
    'Modes:',
    '  --dry-run   Scan candidate local metadata and print a summary without writing SQLite',
    '  --apply     Write SQLite after explicit confirmation or --yes',
    '',
    'Safety:',
    '  The collector imports token/model/time/session metadata only.',
    '  It does not save prompt, response, transcript, diff, or full file paths.'
  ].join('\n'));
}

async function pushPayload(url, payload, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Push failed: HTTP ${response.status} ${await response.text()}`);
  }
  console.log(`[push] ${url}`);
}
