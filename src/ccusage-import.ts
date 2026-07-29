import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { calculateOfficialCost } from './pricing.ts';
import { providerFromSource } from './provider.ts';
import { recordRun, upsertDaily, upsertSession, upsertTokenEvent } from './db.ts';

const UNSAFE_KEYS = new Set([
  'prompt',
  'response',
  'messages',
  'message',
  'transcript',
  'conversation',
  'diff',
  'patch',
  'content',
  'text'
]);
const GENERIC_CODEX_SOURCE = 'Codex';
const LEGACY_UNKNOWN_CODEX_SOURCE = 'Codex (unidentified client)';

interface ImportOptions {
  device?: string;
  now?: Date;
  importSource?: string;
  command?: string;
  toolCategory?: string;
}

export function readCcusageImportInput(file) {
  if (!file || file === '-') {
    return readFileSync(0, 'utf8');
  }
  return readFileSync(file, 'utf8');
}

export function parseCcusageJsonText(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || '').trim());
  } catch (error) {
    const extracted = extractJsonPayload(String(text || ''));
    if (!extracted) throw new Error(`Invalid ccusage JSON: ${error.message}`);
    try {
      payload = JSON.parse(extracted);
    } catch {
      throw new Error(`Invalid ccusage JSON: ${error.message}`);
    }
  }
  const unsafePath = firstUnsafeKeyPath(payload);
  if (unsafePath) {
    throw new Error(`ccusage JSON contains conversation-like field: ${unsafePath}`);
  }
  return payload;
}

export function planCcusageImport(payload, options: ImportOptions = {}) {
  const device = cleanText(options.device, 120) || hostname();
  const now = options.now || new Date();
  const importSource = cleanText(options.importSource, 80) || 'import:ccusage-json';
  const command = cleanText(options.command, 240) || 'import-usage --format=ccusage-json';
  const toolCategory = cleanText(options.toolCategory, 80) || importSource;
  const detectedShape = detectShape(payload);
  const rows = extractUsageRows(payload, detectedShape);
  if (!rows.length) {
    throw new Error('No supported ccusage usage rows found');
  }

  const dailyByKey = new Map();
  const sessionsByKey = new Map();
  const eventsByKey = new Map();
  const warnings = [];

  for (const row of rows) {
    const parts = expandModelBreakdowns(row);
    for (const part of parts) {
      const source = sourceFromRow(part);
      const usageDate = usageDateFromRow(part);
      const timestamp = timestampFromRow(part, usageDate, now);
      const model = cleanText(part.model, 160) || '<unknown>';
      const projectPath = cleanText(part.projectPath || part.project || part.projectName, 240) || null;
      const sessionId = sessionIdFromRow(part, detectedShape, usageDate, model, projectPath);
      const tokens = tokenFields(part);
      const cost = calculateOfficialCost(model, {
        input: tokens.inputTokens,
        output: tokens.outputTokens,
        cacheRead: tokens.cacheReadTokens,
        cacheWrite: tokens.cacheCreationTokens,
        reasoning: tokens.reasoningOutputTokens
      }, { provider: providerFromSource(source) });

      if (!cost.priced && number(part.costUSD ?? part.totalCost) > 0) {
        warnings.push({
          type: 'ignored-imported-cost',
          model,
          reason: 'ccusage cost was present but Token Work keeps official-price conversion only.'
        });
      }

      const usageRow = {
        device,
        source,
        usageDate,
        model,
        ...tokens,
        totalTokens: tokens.totalTokens,
        costUSD: cost.totalUSD
      };
      const dailyKey = [usageRow.device, usageRow.source, usageRow.usageDate, usageRow.model].join('::');
      mergeUsageRow(dailyByKey, dailyKey, usageRow);

      const sessionRow = {
        device,
        source,
        sessionId,
        lastActivity: timestamp,
        projectPath,
        model,
        ...tokens,
        totalTokens: tokens.totalTokens,
        costUSD: cost.totalUSD
      };
      const sessionKey = [sessionRow.device, sessionRow.source, sessionRow.sessionId].join('::');
      mergeSessionRow(sessionsByKey, sessionKey, sessionRow);

      const eventRow = {
        eventId: eventIdFor({ detectedShape, source, usageDate, sessionId, model, timestamp }),
        device,
        source,
        sessionId,
        timestamp,
        model,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        cacheCreationTokens: tokens.cacheCreationTokens,
        reasoningTokens: tokens.reasoningOutputTokens,
        toolCategory,
        privacyLevel: 'safe'
      };
      eventsByKey.set(eventRow.eventId, eventRow);
    }
  }

  return {
    detectedShape,
    device,
    daily: [...dailyByKey.values()],
    sessions: [...sessionsByKey.values()],
    tokenEvents: [...eventsByKey.values()],
    warnings: dedupeWarnings(warnings),
    run: {
      device,
      source: importSource,
      status: 'ok',
      message: `shape=${detectedShape}, daily=${dailyByKey.size}, sessions=${sessionsByKey.size}, token_events=${eventsByKey.size}`,
      collectedAt: new Date(now).toISOString(),
      command
    }
  };
}

export function applyCcusageImport(db, plan) {
  db.exec('BEGIN');
  try {
    migrateLegacyGenericCodexImport(db, plan);
    for (const row of plan.daily) upsertDaily(db, row);
    for (const row of plan.sessions) upsertSession(db, row);
    for (const row of plan.tokenEvents) upsertTokenEvent(db, row);
    recordRun(db, plan.run);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    daily: plan.daily.length,
    sessions: plan.sessions.length,
    tokenEvents: plan.tokenEvents.length,
    warnings: plan.warnings.length
  };
}

export function ccusageImportWouldChange(db, plan) {
  const daily = db.prepare(`
    SELECT 1 FROM daily_usage
    WHERE device = ? AND source = ? AND usage_date = ? AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_creation_tokens = ? AND cache_read_tokens = ?
      AND cached_input_tokens = ? AND reasoning_output_tokens = ?
      AND total_tokens = ? AND cost_usd = ?
  `);
  const sessions = db.prepare(`
    SELECT 1 FROM session_usage
    WHERE device = ? AND source = ? AND session_id = ?
      AND last_activity IS COALESCE(?, last_activity)
      AND project_path IS COALESCE(?, project_path)
      AND model = CASE WHEN ? != '' THEN ? ELSE model END
      AND input_tokens = ? AND output_tokens = ?
      AND cache_creation_tokens = ? AND cache_read_tokens = ?
      AND cached_input_tokens = ? AND reasoning_output_tokens = ?
      AND total_tokens = ? AND cost_usd = ?
  `);
  const events = db.prepare(`
    SELECT 1 FROM token_events
    WHERE event_id = ? AND device = ? AND source = ? AND session_id = ? AND timestamp = ? AND model = ?
      AND input_tokens = ? AND output_tokens = ?
      AND cache_read_tokens = ? AND cache_creation_tokens = ? AND reasoning_tokens = ?
      AND tool_category IS ? AND file_extension IS ? AND repo_path_hash IS ? AND privacy_level = ?
  `);

  for (const row of plan.daily) {
    if (!daily.get(
      row.device, row.source, row.usageDate, row.model,
      row.inputTokens, row.outputTokens, row.cacheCreationTokens, row.cacheReadTokens,
      row.cachedInputTokens || 0, row.reasoningOutputTokens, row.totalTokens, row.costUSD
    )) return true;
  }
  for (const row of plan.sessions) {
    if (!sessions.get(
      row.device, row.source, row.sessionId, row.lastActivity, row.projectPath, row.model, row.model,
      row.inputTokens, row.outputTokens, row.cacheCreationTokens, row.cacheReadTokens,
      row.cachedInputTokens || 0, row.reasoningOutputTokens, row.totalTokens, row.costUSD
    )) return true;
  }
  for (const row of plan.tokenEvents) {
    if (!events.get(
      row.eventId, row.device, row.source, row.sessionId, row.timestamp, row.model,
      row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.reasoningTokens,
      row.toolCategory || null, row.fileExtension || null, row.repoPathHash || null, row.privacyLevel || 'safe'
    )) return true;
  }
  return false;
}

function detectShape(payload) {
  if (Array.isArray(payload?.daily)) return 'daily';
  if (payload?.projects && typeof payload.projects === 'object' && !Array.isArray(payload.projects)) return 'project-daily';
  if (Array.isArray(payload?.data) && payload.type) {
    const type = String(payload.type).toLowerCase();
    if (['daily', 'weekly', 'session', 'blocks', 'monthly'].includes(type)) return type;
  }
  for (const type of ['weekly', 'session', 'blocks', 'monthly']) {
    if (Array.isArray(payload?.[type])) return type;
  }
  throw new Error('Unsupported ccusage JSON shape. Expected daily, project daily, weekly, session, blocks, monthly, or top-level report output.');
}

function extractUsageRows(payload, shape) {
  if (shape === 'daily') return payload.daily.map(row => ({ ...row }));
  if (shape === 'project-daily') {
    const rows = [];
    for (const [project, entries] of Object.entries(payload.projects || {})) {
      if (!Array.isArray(entries)) continue;
      for (const row of entries) rows.push({ ...row, projectPath: project });
    }
    return rows;
  }
  if (Array.isArray(payload[shape])) return payload[shape].map(row => ({ ...row }));
  return (payload.data || []).map(row => ({ ...row }));
}

function expandModelBreakdowns(row) {
  const breakdown = row.modelBreakdowns || row.modelBreakdown || row.breakdowns;
  if (!breakdown) {
    return [{ ...row, model: primaryModel(row) }];
  }

  if (Array.isArray(breakdown)) {
    const usable = breakdown.filter(item => item && typeof item === 'object' && hasTokenField(item));
    if (!usable.length) return [{ ...row, model: primaryModel(row) }];
    return usable.map((item, index) => ({
      ...row,
      ...inputRecord(item),
      model: item.model || item.modelName || primaryModel(row, index)
    }));
  }

  if (typeof breakdown === 'object') {
    const usable = Object.entries(breakdown)
      .filter(([, item]) => item && typeof item === 'object' && hasTokenField(item));
    if (!usable.length) return [{ ...row, model: primaryModel(row) }];
    return usable.map(([model, item]) => ({
      ...row,
      ...inputRecord(item),
      model
    }));
  }

  return [{ ...row, model: primaryModel(row) }];
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function primaryModel(row, index = 0) {
  const models = row.modelsUsed || row.models || row.model;
  if (Array.isArray(models)) return models[index] || models[0] || '<unknown>';
  return models || row.modelName || '<unknown>';
}

function tokenFields(row) {
  const inputTokens = integer(row.inputTokens ?? row.input_tokens ?? row.input);
  const outputTokens = integer(row.outputTokens ?? row.output_tokens ?? row.output);
  const cacheCreationTokens = integer(
    row.cacheCreationTokens
    ?? row.cacheCreationInputTokens
    ?? row.cache_creation_tokens
    ?? row.cacheWriteTokens
  );
  const cacheReadTokens = integer(
    row.cacheReadTokens
    ?? row.cacheReadInputTokens
    ?? row.cache_read_tokens
    ?? row.cachedInputTokens
  );
  const reasoningOutputTokens = integer(
    row.reasoningTokens
    ?? row.reasoningOutputTokens
    ?? row.reasoning_output_tokens
    ?? row.metadata?.reasoningTokens
    ?? row.metadata?.reasoningOutputTokens
  );
  const explicitTotal = integer(row.totalTokens ?? row.total_tokens);
  const computedTotal = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + reasoningOutputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cachedInputTokens: 0,
    reasoningOutputTokens,
    totalTokens: explicitTotal || computedTotal
  };
}

function hasTokenField(row) {
  return [
    'inputTokens',
    'input_tokens',
    'outputTokens',
    'output_tokens',
    'cacheCreationTokens',
    'cacheCreationInputTokens',
    'cacheReadTokens',
    'cacheReadInputTokens',
    'reasoningTokens',
    'totalTokens',
    'total_tokens'
  ].some(key => row[key] != null);
}

function sourceFromRow(row) {
  const source = cleanText(row.source || row.tool || row.instance || row.provider || row.agent, 80);
  return source?.toLowerCase() === 'codex' ? GENERIC_CODEX_SOURCE : source || 'ccusage';
}

function migrateLegacyGenericCodexImport(db, plan) {
  if (!plan.tokenEvents.some(row => row.source === GENERIC_CODEX_SOURCE)) return;
  const legacyEvents = new Map(plan.tokenEvents.map((row) => [
    row.eventId,
    row.eventId
  ]));
  if (!legacyEvents.size) return;

  const rows = db.prepare(`
    SELECT event_id AS eventId
    FROM token_events
    WHERE device = ? AND source IN ('codex', ?) AND event_id LIKE 'ccusage:%:%:%'
  `).all(plan.device, LEGACY_UNKNOWN_CODEX_SOURCE);
  for (const { eventId } of rows) {
    const canonicalEventId = legacyEvents.get(legacyGenericCodexEventId(eventId));
    if (!canonicalEventId) continue;
    if (eventId === canonicalEventId) {
      db.prepare(`UPDATE token_events SET source = ? WHERE event_id = ?`).run(GENERIC_CODEX_SOURCE, eventId);
      continue;
    }
    const current = db.prepare('SELECT 1 FROM token_events WHERE event_id = ?').get(canonicalEventId);
    if (current) {
      db.prepare('DELETE FROM token_events WHERE event_id = ?').run(eventId);
      continue;
    }
    db.prepare(`
      UPDATE token_events
      SET event_id = ?, source = ?
      WHERE event_id = ? AND device = ? AND source IN ('codex', ?)
    `).run(canonicalEventId, GENERIC_CODEX_SOURCE, eventId, plan.device, LEGACY_UNKNOWN_CODEX_SOURCE);
  }

  for (const row of plan.daily) {
    const target = db.prepare(`
      SELECT 1 FROM daily_usage
      WHERE device = ? AND source = ? AND usage_date = ? AND model = ?
    `).get(row.device, GENERIC_CODEX_SOURCE, row.usageDate, row.model);
    if (target) {
      db.prepare(`
        DELETE FROM daily_usage
        WHERE device = ? AND source IN ('codex', ?) AND usage_date = ? AND model = ?
      `).run(row.device, LEGACY_UNKNOWN_CODEX_SOURCE, row.usageDate, row.model);
      continue;
    }
    db.prepare(`
      UPDATE daily_usage
      SET source = ?
      WHERE device = ? AND source IN ('codex', ?) AND usage_date = ? AND model = ?
    `).run(GENERIC_CODEX_SOURCE, row.device, LEGACY_UNKNOWN_CODEX_SOURCE, row.usageDate, row.model);
  }
  for (const row of plan.sessions) {
    const target = db.prepare(`
      SELECT 1 FROM session_usage
      WHERE device = ? AND source = ? AND session_id = ?
    `).get(row.device, GENERIC_CODEX_SOURCE, row.sessionId);
    if (target) {
      db.prepare(`
        DELETE FROM session_usage
        WHERE device = ? AND source IN ('codex', ?) AND session_id = ?
      `).run(row.device, LEGACY_UNKNOWN_CODEX_SOURCE, row.sessionId);
      continue;
    }
    db.prepare(`
      UPDATE session_usage
      SET source = ?
      WHERE device = ? AND source IN ('codex', ?) AND session_id = ?
    `).run(GENERIC_CODEX_SOURCE, row.device, LEGACY_UNKNOWN_CODEX_SOURCE, row.sessionId);
  }

  // Earlier versions used a different event-id source segment for generic Codex imports.
  db.prepare(`
    DELETE FROM token_events
    WHERE device = ? AND source = ?
      AND event_id LIKE 'ccusage:%:codex-unidentified-client:%'
      AND EXISTS (
        SELECT 1 FROM token_events AS current
        WHERE current.event_id = REPLACE(token_events.event_id, ':codex-unidentified-client:', ':codex:')
      )
  `).run(plan.device, LEGACY_UNKNOWN_CODEX_SOURCE);
  db.prepare(`
    UPDATE token_events
    SET event_id = REPLACE(event_id, ':codex-unidentified-client:', ':codex:'), source = ?
    WHERE device = ? AND source = ? AND event_id LIKE 'ccusage:%:codex-unidentified-client:%'
  `).run(GENERIC_CODEX_SOURCE, plan.device, LEGACY_UNKNOWN_CODEX_SOURCE);
}

function legacyGenericCodexEventId(eventId) {
  return String(eventId).replace(/^(ccusage:[^:]+:)[^:]+:/, '$1codex:');
}

function usageDateFromRow(row) {
  const raw = row.date || row.usageDate || row.week || row.weekStart || row.startDate || row.month || row.blockStart || row.firstActivity || row.lastActivity || row.metadata?.lastActivity || row.metadata?.firstActivity;
  const date = parseDate(raw);
  if (!date) throw new Error('ccusage row is missing a usable date/month/activity field');
  return formatDate(date);
}

function timestampFromRow(row, usageDate, now) {
  const raw = row.lastActivity || row.metadata?.lastActivity || row.blockEnd || row.firstActivity || row.metadata?.firstActivity || row.blockStart || row.date || row.week || row.weekStart || row.startDate || row.month;
  const date = parseDate(raw) || parseDate(usageDate) || new Date(now);
  return date.toISOString();
}

function sessionIdFromRow(row, shape, usageDate, model, projectPath) {
  const raw = row.session || row.sessionId || row.session_id || row.id || row.period || null;
  if (raw) return cleanText(raw, 240);
  const project = projectPath ? hashable(projectPath) : 'all';
  return `ccusage:${shape}:${project}:${usageDate}:${hashable(model)}`;
}

function eventIdFor({ detectedShape, source, usageDate, sessionId, model, timestamp }) {
  return [
    'ccusage',
    detectedShape,
    hashable(source),
    usageDate,
    hashable(sessionId),
    hashable(model),
    timestamp
  ].join(':');
}

function mergeUsageRow(map, key, row) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row });
    return;
  }
  addTokenFields(existing, row);
  existing.costUSD += row.costUSD || 0;
}

function mergeSessionRow(map, key, row) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row });
    return;
  }
  addTokenFields(existing, row);
  existing.costUSD += row.costUSD || 0;
  if (row.lastActivity && (!existing.lastActivity || row.lastActivity > existing.lastActivity)) {
    existing.lastActivity = row.lastActivity;
  }
  if (!existing.projectPath && row.projectPath) existing.projectPath = row.projectPath;
}

function addTokenFields(target, row) {
  target.inputTokens += row.inputTokens || 0;
  target.outputTokens += row.outputTokens || 0;
  target.cacheCreationTokens += row.cacheCreationTokens || 0;
  target.cacheReadTokens += row.cacheReadTokens || 0;
  target.cachedInputTokens += row.cachedInputTokens || 0;
  target.reasoningOutputTokens += row.reasoningOutputTokens || 0;
  target.totalTokens += row.totalTokens || 0;
}

function firstUnsafeKeyPath(value, path = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = firstUnsafeKeyPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(String(key).toLowerCase())) return `${path}.${key}`;
    const found = firstUnsafeKeyPath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function cleanText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function integer(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function hashable(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function extractJsonPayload(text) {
  const value = String(text || '');
  const candidates = [
    [value.indexOf('{'), value.lastIndexOf('}')],
    [value.indexOf('['), value.lastIndexOf(']')]
  ].filter(([start, end]) => start >= 0 && end > start);
  for (const [start, end] of candidates) {
    const candidate = value.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try the next possible JSON payload shape.
    }
  }
  return null;
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter(warning => {
    const key = `${warning.type}:${warning.model}:${warning.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
