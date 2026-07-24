import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hostname } from 'node:os';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createSqliteBackup, defaultDbPath, openDb, recordRun, repairUsageTotals, upsertDaily, upsertSession, upsertTokenEvent, usageTotalsNeedRepair } from './db.ts';
import { calculateCost, loadPricing } from './pricing.ts';
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

  let collectionLock = null;

  try {
    if (mode === 'apply') {
      collectionLock = acquireCollectionLock(args.db);
      db = openDb(args.db);
      summary.before = countRows(db);
    }
    await collectLocal({ collectors, mode, db, dbPath: args.db, pricingData, device, collectedAt, exportPayload, summary, scheduled });
    if (args.push) {
      if (mode !== 'apply') throw new Error('--push is only available with --apply.');
      await pushPayload(args.push, exportPayload, args.token);
    }
  } finally {
    try {
      if (db) {
        summary.after = countRows(db);
        db.close();
      }
    } finally {
      releaseCollectionLock(collectionLock);
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

function acquireCollectionLock(dbPath) {
  const resolvedDbPath = resolve(dbPath || defaultDbPath);
  const lockPath = `${resolvedDbPath}.collect.lock`;
  mkdirSync(dirname(resolvedDbPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return lockPath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = readCollectionLock(lockPath);
      if (owner?.pid && owner.pid !== process.pid && processExists(owner.pid)) {
        throw new Error(`A collection is already running for this SQLite database (PID ${owner.pid}).`);
      }
      if (!owner && collectionLockIsNew(lockPath)) {
        throw new Error('A collection is starting for this SQLite database. Please try again shortly.');
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  throw new Error('Unable to acquire the collection lock. Please try again.');
}

function collectionLockIsNew(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < 5_000;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

function readCollectionLock(lockPath) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
    const pid = Number(parsed?.pid);
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  } catch {
    return null;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function releaseCollectionLock(lockPath) {
  if (!lockPath) return;
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function collectLocal({ collectors, mode, db, dbPath, pricingData, device, collectedAt, exportPayload, summary, scheduled }) {
  if (!collectors.length) return;

  const payloads = [];

  for (const { id, module, label } of collectors) {
    let graphJson = {};
    let modelsJson = {};
    let tokenEvents = [];
    let reconciliation = null;
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
      if (typeof collectorModule.collectWithAudit === 'function') {
        const result = await collectorModule.collectWithAudit(pricingData);
        audit = normalizeAuditSummary(result.audit);
        ({ graphJson = {}, modelsJson = {}, tokenEvents = [], reconciliation = null } = result);
      } else if (typeof collectorModule.collect === 'function') {
        if (typeof collectorModule.audit === 'function') {
          audit = normalizeAuditSummary(await collectorModule.audit());
        }
        ({ graphJson = {}, modelsJson = {}, tokenEvents = [], reconciliation = null } = await collectorModule.collect(pricingData));
      } else {
        throw new Error(`Collector ${id} does not export collect()`);
      }
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

    payloads.push({ type: 'data', device, source: label, sourceSummary, label, module, dailyRows, sessionRows, eventRows, reconciliation });
  }

  const fatal = summary.sources.filter(source => source.fatalCoverageError);
  if (mode === 'apply' && fatal.length) {
    summary.ok = false;
    throw new Error(`Coverage gate blocked collection apply: ${fatal.map(source => `${source.id}:${source.coverageRisk}`).join(', ')}`);
  }

  if (mode === 'apply' && db) {
    for (const payload of payloads) {
      if (payload.type !== 'error') mergeHistoricalEventUsage(db, payload, pricingData);
    }
  }

  const needsStoredUsageRepair = mode === 'apply' && db && usageTotalsNeedRepair(db);
  if (mode === 'apply' && db) {
    const shouldBackup = needsStoredUsageRepair || tokenUsageWouldChange(db, payloads);
    summary.backup = shouldBackup
      ? createSqliteBackup(db, dbPath, scheduled
          ? {
              reason: 'scheduled-collect'
            }
          : { reason: 'collect' })
      : null;
  }

  if (needsStoredUsageRepair) {
    runInTransaction(db, () => repairUsageTotals(db));
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
      const { sourceSummary, label, module, dailyRows, sessionRows, eventRows, reconciliation } = payload;
      const run = runRecord({
        device,
        label,
        status: sourceSummary.status,
        message: `${sourceSummary.message}; candidate_files=${sourceSummary.candidateFiles}; usable_records=${sourceSummary.usableTokenRecords}; skipped_no_token=${sourceSummary.skippedNoTokenRecords}; skipped_unsafe=${sourceSummary.skippedConversationLikeRecords}`,
        collectedAt,
        module
      });
      runInTransaction(db, () => {
        applyEventReconciliation(db, payload);
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
      AND cached_input_tokens = ?
      AND reasoning_output_tokens = ? AND total_tokens = ? AND cost_usd = ?
  `);
  const matchingSession = db.prepare(`
    SELECT 1
    FROM session_usage
    WHERE device = ? AND source = ? AND session_id = ?
      AND last_activity IS COALESCE(?, last_activity)
      AND project_path IS COALESCE(?, project_path)
      AND model = CASE WHEN ? != '' THEN ? ELSE model END
      AND input_tokens = ? AND output_tokens = ?
      AND cache_creation_tokens = ? AND cache_read_tokens = ?
      AND cached_input_tokens = ?
      AND reasoning_output_tokens = ? AND total_tokens = ? AND cost_usd = ?
  `);
  const matchingEvent = db.prepare(`
    SELECT 1
    FROM token_events
    WHERE event_id = ? AND device = ? AND source = ? AND session_id = ? AND timestamp = ? AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_read_tokens = ? AND cache_creation_tokens = ? AND reasoning_tokens = ?
      AND tool_category IS ? AND file_extension IS ? AND repo_path_hash IS ? AND privacy_level = ?
    LIMIT 1
  `);
  const legacyEvent = db.prepare(`
    SELECT 1 FROM token_events
    WHERE event_id = ? AND device = ? AND source = ?
  `);

  for (const payload of payloads) {
    if (payload.type === 'error') continue;
    const reconciliationPlan = eventReconciliationPlan(db, payload);
    if (
      reconciliationPlan.prefixes.length > 0 ||
      reconciliationPlan.replaceManagedEvents
    ) return true;
    for (const row of payload.dailyRows) {
      if (!matchingDaily.get(
        row.device, row.source, row.usageDate, row.model,
        row.inputTokens, row.outputTokens, row.cacheCreationTokens,
        row.cacheReadTokens, row.cachedInputTokens || 0, row.reasoningOutputTokens, row.totalTokens, row.costUSD
      )) return true;
    }
    for (const row of payload.sessionRows) {
      if (!matchingSession.get(
        row.device, row.source, row.sessionId, row.lastActivity, row.projectPath, row.model, row.model,
        row.inputTokens, row.outputTokens, row.cacheCreationTokens,
        row.cacheReadTokens, row.cachedInputTokens || 0, row.reasoningOutputTokens, row.totalTokens, row.costUSD
      )) return true;
    }
    for (const row of payload.eventRows) {
      if (row.legacyEventIds.some(eventId => legacyEvent.get(eventId, row.device, row.source))) return true;
      if (!matchingEvent.get(
        row.eventId, row.device, row.source, row.sessionId, row.timestamp, row.model,
        row.inputTokens, row.outputTokens, row.cacheReadTokens,
        row.cacheCreationTokens, row.reasoningTokens,
        row.toolCategory || null, row.fileExtension || null, row.repoPathHash || null, row.privacyLevel || 'safe'
      )) return true;
    }
  }
  return false;
}

function applyEventReconciliation(db, payload) {
  const plan = eventReconciliationPlan(db, payload);
  if (
    !plan.prefixes.length &&
    !plan.replaceManagedEvents
  ) return plan;

  const source = reconciliationSource(payload);
  const deleteEvents = db.prepare(`
    DELETE FROM token_events
    WHERE device = ? AND source = ? AND session_id LIKE ? ESCAPE '\\'
  `);
  const resetSessions = db.prepare(`
    UPDATE session_usage
    SET input_tokens = 0,
      output_tokens = 0,
      cache_creation_tokens = 0,
      cache_read_tokens = 0,
      cached_input_tokens = 0,
      reasoning_output_tokens = 0,
      total_tokens = 0,
      cost_usd = 0,
      updated_at = datetime('now')
    WHERE device = ? AND source = ? AND session_id LIKE ? ESCAPE '\\'
  `);
  const deleteDaily = db.prepare(`
    DELETE FROM daily_usage
    WHERE device = ? AND source = ? AND usage_date = ?
  `);

  if (plan.replaceManagedEvents) {
    for (const prefix of plan.managedSessionPrefixes) {
      deleteManagedEventsBySessionPrefix(db, payload, source, plan.managedEventIdPrefix, prefix);
      resetSessionsByPrefix(db, payload, source, prefix);
    }
  }
  for (const prefix of plan.prefixes) {
    const pattern = sqlLikePrefix(prefix);
    deleteEvents.run(payload.device, source, pattern);
    // Preserve annotations and output links while removing stale session totals.
    resetSessions.run(payload.device, source, pattern);
  }
  for (const date of plan.dates) {
    deleteDaily.run(payload.device, source, date);
  }
  return plan;
}

function eventReconciliationPlan(db, payload) {
  const prefixes = normalizedEventSessionPrefixes(payload.reconciliation);
  const managedEventIdPrefix = normalizedReconciliationPrefix(payload.reconciliation?.managedEventIdPrefix);
  const managedEventSessionPrefixes = normalizedEventSessionPrefixes({
    eventSessionPrefixes: payload.reconciliation?.managedEventSessionPrefixes
  });
  if (!prefixes.length && (!managedEventIdPrefix || !managedEventSessionPrefixes.length)) {
    return {
      prefixes: [],
      dates: [],
      replaceManagedEvents: false
    };
  }

  const source = reconciliationSource(payload);
  const device = payload.device;
  const selectEvents = db.prepare(`
    SELECT event_id AS eventId, date(timestamp, '+8 hours') AS usageDate
    FROM token_events
    WHERE device = ? AND source = ? AND session_id LIKE ? ESCAPE '\\'
  `);
  const stalePrefixes = [];
  const dates = new Set();

  let replaceManagedEvents = false;
  const managedSessionPrefixes = [];
  for (const prefix of managedEventSessionPrefixes) {
    const expectedIds = new Set(payload.eventRows
      .filter(row => row.eventId.startsWith(managedEventIdPrefix) && row.sessionId.startsWith(prefix))
      .map(row => row.eventId));
    const managedRows = db.prepare(`
      SELECT event_id AS eventId, date(timestamp, '+8 hours') AS usageDate
      FROM token_events
      WHERE device = ? AND source = ?
        AND event_id LIKE ? ESCAPE '\\'
        AND session_id LIKE ? ESCAPE '\\'
    `).all(
      device,
      source,
      sqlLikePrefix(managedEventIdPrefix),
      sqlLikePrefix(prefix)
    );
    if (managedRows.some(row => !expectedIds.has(row.eventId))) {
      replaceManagedEvents = true;
      managedSessionPrefixes.push(prefix);
      for (const row of managedRows) {
        if (row.usageDate) dates.add(row.usageDate);
      }
    }
  }

  for (const prefix of prefixes) {
    const expectedIds = new Set(payload.eventRows
      .filter(row => row.sessionId.startsWith(prefix))
      .map(row => row.eventId));
    const existing = selectEvents.all(device, source, sqlLikePrefix(prefix));
    if (!existing.some(row => !expectedIds.has(row.eventId))) continue;
    stalePrefixes.push(prefix);
    for (const row of existing) {
      if (row.usageDate) dates.add(row.usageDate);
    }
  }
  return {
    prefixes: stalePrefixes,
    dates: [...dates],
    replaceManagedEvents,
    managedEventIdPrefix,
    managedSessionPrefixes
  };
}

function mergeHistoricalEventUsage(db, payload, pricingData) {
  const source = reconciliationSource(payload);
  const eventIdPrefix = normalizedReconciliationPrefix(payload.reconciliation?.managedEventIdPrefix);
  if (!eventIdPrefix) return;
  const currentPrefixes = normalizedEventSessionPrefixes({
    eventSessionPrefixes: payload.reconciliation?.managedEventSessionPrefixes
  });
  const historicalRows = db.prepare(`
    SELECT session_id AS sessionId, date(timestamp, '+8 hours') AS usageDate,
      model, MAX(timestamp) AS lastActivity,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
      COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoningOutputTokens
    FROM token_events
    WHERE device = ? AND source = ? AND event_id LIKE ? ESCAPE '\\'
    GROUP BY session_id, usageDate, model
  `).all(payload.device, source, sqlLikePrefix(eventIdPrefix))
    .filter(row => !currentPrefixes.some(prefix => row.sessionId.startsWith(prefix)));
  if (!historicalRows.length) return;

  const sessions = new Map<string, InputRecord>();
  const days = new Map<string, InputRecord>();
  for (const row of historicalRows) {
    const tokens = eventTokens(row);
    const session = sessions.get(row.sessionId) || usageRow({
      device: payload.device, source, sessionId: row.sessionId,
      lastActivity: row.lastActivity, projectPath: null, model: row.model || ''
    });
    addUsage(session, tokens, calculateCost(row.model || '', tokens, pricingData));
    if (row.lastActivity > session.lastActivity) session.lastActivity = row.lastActivity;
    sessions.set(row.sessionId, session);

    const dayKey = dailyUsageKey(row.usageDate, row.model);
    const day = days.get(dayKey) || usageRow({
      device: payload.device, source, usageDate: row.usageDate, model: row.model || ''
    });
    addUsage(day, tokens, calculateCost(row.model || '', tokens, pricingData));
    days.set(dayKey, day);
  }
  payload.sessionRows.push(...sessions.values());

  const dailyByKey = new Map(payload.dailyRows.map(row => [dailyUsageKey(row.usageDate, row.model), row]));
  for (const [key, historical] of days) {
    const current = dailyByKey.get(key);
    if (!current) {
      payload.dailyRows.push(historical);
      continue;
    }
    addUsage(current, eventTokens(historical), Number(historical.costUSD || 0));
  }
}

function usageRow(values) {
  return {
    ...values,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    costUSD: 0
  };
}

function addUsage(row, tokens, costUSD) {
  row.inputTokens += tokens.input;
  row.outputTokens += tokens.output;
  row.cacheReadTokens += tokens.cacheRead;
  row.cacheCreationTokens += tokens.cacheWrite;
  row.reasoningOutputTokens += tokens.reasoning;
  row.totalTokens += tokenTotal(tokens);
  row.costUSD += costUSD;
}

function eventTokens(row) {
  return {
    input: Number(row.inputTokens || 0),
    output: Number(row.outputTokens || 0),
    cacheRead: Number(row.cacheReadTokens || 0),
    cacheWrite: Number(row.cacheCreationTokens || 0),
    reasoning: Number(row.reasoningOutputTokens || 0)
  };
}

function normalizedEventSessionPrefixes(reconciliation) {
  const prefixes = reconciliation?.eventSessionPrefixes;
  if (!Array.isArray(prefixes)) return [];
  return [...new Set(prefixes.filter(prefix => typeof prefix === 'string' && prefix.trim()))];
}

function normalizedReconciliationPrefix(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function deleteManagedEventsBySessionPrefix(db, payload, source, eventIdPrefix, sessionPrefix) {
  if (!eventIdPrefix || !sessionPrefix) return;
  db.prepare(`
    DELETE FROM token_events
    WHERE device = ? AND source = ?
      AND event_id LIKE ? ESCAPE '\\'
      AND session_id LIKE ? ESCAPE '\\'
  `).run(payload.device, source, sqlLikePrefix(eventIdPrefix), sqlLikePrefix(sessionPrefix));
}

function resetSessionsByPrefix(db, payload, source, prefix) {
  if (!prefix) return;
  db.prepare(`
    UPDATE session_usage
    SET input_tokens = 0,
      output_tokens = 0,
      cache_creation_tokens = 0,
      cache_read_tokens = 0,
      cached_input_tokens = 0,
      reasoning_output_tokens = 0,
      total_tokens = 0,
      cost_usd = 0,
      updated_at = datetime('now')
    WHERE device = ? AND source = ? AND session_id LIKE ? ESCAPE '\\'
  `).run(payload.device, source, sqlLikePrefix(prefix));
}

function dailyUsageKey(usageDate, model) {
  return JSON.stringify([usageDate, model]);
}

function reconciliationSource(payload) {
  return payload.eventRows[0]?.source || payload.sessionRows[0]?.source || payload.dailyRows[0]?.source || payload.source || '';
}

function sqlLikePrefix(value) {
  return `${String(value).replace(/[\\%_]/g, '\\$&')}%`;
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
