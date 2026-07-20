/**
 * Codex CLI data collector.
 *
 * Scans two roots:
 *   ~/.codex/sessions/          — active sessions (recursive JSONL)
 *   ~/.codex/archived_sessions/ — archived sessions (recursive JSONL)
 * (CODEX_HOME env var overrides ~/.codex)
 *
 * The Codex JSONL format has three relevant event types:
 *   session_meta  – workspace (cwd), session ID, provider, agent nickname
 *   turn_context  – current model for the upcoming turn
 *   event_msg     – when payload.type === "token_count", carries token usage
 *
 * Token counting strategy:
 *   • total_token_usage establishes deltas between consecutive counters.
 *   • last_token_usage covers the first record and counter resets.
 *   • Forked sessions start from their parent's counter at fork time, so copied
 *     history is not counted again as new usage.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { configuredPaths, configuredStrings, envPathList } from '../collector-config.ts';
import { calculateCost } from '../pricing.ts';
import { localDateFromTimestamp, normalizeModelForGrouping } from './utils.ts';

/** Recursively collect all .jsonl file paths under a directory. */
async function collectJsonlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

export const CLIENT_KEY = 'codex';
export const SOURCE_LABEL = 'Codex CLI';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getCodexHomes() {
  return envPathList(process.env.CODEX_HOME, configuredPaths('codex', 'homes'));
}

function getSessionRoots() {
  const subdirs = configuredStrings('codex', 'sessionSubdirs', ['sessions', 'archived_sessions']);
  return getCodexHomes().flatMap((home) => subdirs.map((subdir) => join(home, subdir)));
}

function getHeadlessRoots() {
  const roots = envPathList(
    process.env.TOKEN_WORK_HEADLESS_DIR,
    configuredPaths('codex', 'headlessRoots')
  );
  return roots.map((root) => join(root, 'codex'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pos(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function zero() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function addInto(agg, t) {
  agg.input     += t.input;
  agg.output    += t.output;
  agg.cacheRead  += t.cacheRead;
  agg.cacheWrite += t.cacheWrite;
  agg.reasoning  += t.reasoning;
}

/** Extract a { input, output, cached, reasoning } summary from a token-usage object. */
function usageSummary(u) {
  return {
    input:     pos(u.input_tokens),
    output:    pos(u.output_tokens),
    // Codex uses cached_input_tokens OR cache_read_input_tokens interchangeably
    cached:    Math.max(pos(u.cached_input_tokens), pos(u.cache_read_input_tokens)),
    reasoning: pos(u.reasoning_output_tokens)
  };
}

/**
 * Convert a Codex cumulative summary to our token breakdown.
 * cached is clamped to <= input to avoid inflated totals.
 */
function summaryToTokens(s) {
  const clamped = Math.min(s.cached, s.input);
  return {
    input:     Math.max(0, s.input - clamped),
    output:    s.output,
    cacheRead:  clamped,
    cacheWrite: 0,
    reasoning:  s.reasoning
  };
}

function summaryIsZero(s) {
  return s.input === 0 && s.output === 0 && s.cached === 0 && s.reasoning === 0;
}

function summaryDelta(current, previous) {
  if (
    current.input < previous.input ||
    current.output < previous.output ||
    current.cached < previous.cached ||
    current.reasoning < previous.reasoning
  ) {
    return null;
  }

  return {
    input:     current.input     - previous.input,
    output:    current.output    - previous.output,
    cached:    current.cached    - previous.cached,
    reasoning: current.reasoning - previous.reasoning
  };
}

function summaryAtLeast(current, baseline) {
  return current.input >= baseline.input &&
    current.output >= baseline.output &&
    current.cached >= baseline.cached &&
    current.reasoning >= baseline.reasoning;
}

// ---------------------------------------------------------------------------
// JSONL session parser
// ---------------------------------------------------------------------------

/**
 * Parse a single Codex JSONL session file.
 * Returns an array of { timestamp, date, model, workspace, tokens }.
 */
async function parseSessionFile(filePath, sessionId, inheritedTotal = null) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  // Per-file state
  let currentModel     = null;
  let previousTotal    = inheritedTotal;
  let awaitingForkBase = Boolean(inheritedTotal);
  let workspace        = null;
  let metaSessionId    = sessionId;

  const events = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const type = entry.type;

    // ── session_meta ──────────────────────────────────────────────────
    if (type === 'session_meta') {
      const payload = entry.payload || {};
      metaSessionId = extractSessionId(payload) || metaSessionId;
      if (payload.cwd) {
        workspace = payload.cwd;
      }
      continue;
    }

    // ── turn_context ──────────────────────────────────────────────────
    if (type === 'turn_context') {
      const payload = entry.payload || {};
      currentModel = extractModel(payload) || currentModel;
      continue;
    }

    // ── event_msg / token_count ────────────────────────────────────────
    if (type === 'event_msg') {
      const payload = entry.payload || {};
      if (payload.type !== 'token_count') continue;

      const info = payload.info || {};

      // Model resolution: payload.model → info.model → state.currentModel
      const model = normalizeModelForGrouping(
        extractModel(payload) ||
        extractModel(info)    ||
        currentModel          ||
        'unknown'
      );

      currentModel = model;

      const totalUsage = info.total_token_usage ? usageSummary(info.total_token_usage) : null;

      const lastUsage = info.last_token_usage ? usageSummary(info.last_token_usage) : null;
      let increment;
      if (totalUsage) {
        // Forked Codex sessions replay the parent's history when created.
        // Keep their parent total as the baseline until the child exceeds it.
        if (awaitingForkBase && !summaryAtLeast(totalUsage, inheritedTotal)) {
          continue;
        }
        awaitingForkBase = false;
        increment = previousTotal ? summaryDelta(totalUsage, previousTotal) : lastUsage || totalUsage;
        if (!increment) {
          previousTotal = totalUsage;
          if (!lastUsage || summaryIsZero(lastUsage)) continue;
          increment = lastUsage;
        }
        previousTotal = totalUsage;
      } else {
        if (awaitingForkBase || !lastUsage || summaryIsZero(lastUsage)) continue;
        increment = lastUsage;
      }

      if (summaryIsZero(increment)) continue;

      const tokens = summaryToTokens(increment);

      // Date from event timestamp
      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : '';
      let date = 'unknown';
      if (timestamp) {
        date = localDateFromTimestamp(timestamp);
      }

      events.push({ timestamp, date, model, workspace, tokens, sessionId: metaSessionId });
    }
  }

  return events;
}

function extractModel(obj) {
  if (!obj) return null;
  const v =
    obj.model ||
    obj.model_name ||
    obj.model_info?.slug ||
    null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function extractSessionId(obj) {
  if (!obj) return null;
  const v = obj.id || obj.session_id || obj.sessionId || null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collect(pricingData = null) {
  // Scan active, archived, and optional headless Codex outputs.
  const sessionFiles = await parseSessionFiles();

  const dailyMap = new Map();   // "date::model" → aggregated
  const sessionMap = new Map(); // true rollout session aggregate
  const seenEventKeys = new Set();
  const tokenEvents = [];
  const forkedSessionPrefixes = new Set();

  for (const { filePath, fileSessionId, lineage, events } of sessionFiles) {
    if (lineage.parentSessionId) {
      forkedSessionPrefixes.add(`local:${CLIENT_KEY}:${hashableSessionPart(lineage.sessionId)}:`);
    }
    if (!events.length) continue;
    const rawSessionId = events.find(event => event.sessionId)?.sessionId || fileSessionId;
    const sessionPrefix = `local:${CLIENT_KEY}:${hashableSessionPart(rawSessionId)}`;
    const modelSessionIds = new Map(
      [...new Set(events.map(event => event.model))]
        .map(model => [model, `${sessionPrefix}:${model}`])
    );
    const legacySessionIds = [...modelSessionIds.values()];

    for (let index = 0; index < events.length; index += 1) {
      const { timestamp, date, model, workspace, tokens } = events[index];
      const sessionId = modelSessionIds.get(model);
      const eventKey = codexEventDedupKey({ sessionId, timestamp, model, tokens });
      if (eventKey && seenEventKeys.has(eventKey)) continue;
      if (eventKey) seenEventKeys.add(eventKey);

      const workspaceKey = workspace || rawSessionId;

      // Daily
      const dk = `${date}::${model}`;
      if (!dailyMap.has(dk)) dailyMap.set(dk, { date, model, ...zero(), cost: 0 });
      addInto(dailyMap.get(dk), tokens);

      // True rollout session
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, {
          sessionId,
          workspace: workspaceKey,
          workspaceLabel: decodeWorkspace(workspaceKey),
          model,
          ...zero(),
          cost: 0,
          lastActivity: timestamp || null
        });
      }
      const sessionAgg = sessionMap.get(sessionId);
      addInto(sessionAgg, tokens);
      sessionAgg.cost += calculateCost(model, tokens, pricingData);
      if (timestamp && (!sessionAgg.lastActivity || timestamp > sessionAgg.lastActivity)) {
        sessionAgg.lastActivity = timestamp;
      }
      tokenEvents.push(tokenEventFor({ sessionId, legacySessionIds, timestamp, model, tokens, index }));
    }
  }

  return {
    ...buildOutput(dailyMap, sessionMap, tokenEvents, pricingData),
    reconciliation: { eventSessionPrefixes: [...forkedSessionPrefixes] }
  };
}

export async function audit() {
  const sessionFiles = await parseSessionFiles();
  const summary = emptyAuditSummary();
  const sessions = new Set();
  summary.candidateFiles = sessionFiles.length;
  for (const { fileSessionId, events } of sessionFiles) {
    if (events.length) {
      summary.usableTokenRecords += events.length;
      sessions.add(events.find(event => event.sessionId)?.sessionId || fileSessionId);
      for (const event of events) {
        summary.totalTokens += tokenTotal(event.tokens);
        summary.firstTimestamp = earlierTimestamp(summary.firstTimestamp, event.timestamp);
        summary.lastTimestamp = laterTimestamp(summary.lastTimestamp, event.timestamp);
      }
    } else {
      summary.skippedNoTokenRecords += 1;
    }
  }
  summary.sessionRows = sessions.size;
  summary.tokenEvents = summary.usableTokenRecords;
  return summary;
}

async function parseSessionFiles() {
  const filePaths = await collectSessionFiles();
  const files = [];
  for (const filePath of filePaths) {
    const fileSessionId = basename(filePath).replace(/\.jsonl$/, '');
    files.push({
      filePath,
      fileSessionId,
      lineage: await readSessionLineage(filePath, fileSessionId)
    });
  }
  const bySessionId = new Map();
  for (const file of files) {
    const matches = bySessionId.get(file.lineage.sessionId) || [];
    matches.push(file);
    bySessionId.set(file.lineage.sessionId, matches);
  }

  const parsedFiles = [];
  for (const file of files) {
    const parents = file.lineage.parentSessionId
      ? bySessionId.get(file.lineage.parentSessionId) || []
      : [];
    const baselines = [];
    for (const parent of parents) {
      const baseline = file.lineage.forkedAt
        ? await totalUsageAt(parent.filePath, file.lineage.forkedAt)
        : null;
      if (baseline) baselines.push(baseline);
    }
    const inheritedTotal = baselines
      .sort((left, right) => right.timestamp - left.timestamp)[0]?.summary || null;
    const unresolvedFork = Boolean(file.lineage.parentSessionId) && !inheritedTotal;
    parsedFiles.push({
      ...file,
      events: unresolvedFork
        ? []
        : await parseSessionFile(file.filePath, file.fileSessionId, inheritedTotal)
    });
  }
  return parsedFiles;
}

async function readSessionLineage(filePath, fallbackSessionId) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return { sessionId: fallbackSessionId, parentSessionId: null, forkedAt: null };
  }
  for (const raw of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type !== 'session_meta') continue;
    const payload = entry.payload || {};
    return {
      sessionId: extractSessionId(payload) || fallbackSessionId,
      parentSessionId: normalizeSessionId(payload.parent_thread_id || payload.forked_from_id),
      forkedAt: validTimestamp(payload.timestamp || entry.timestamp)
    };
  }
  return { sessionId: fallbackSessionId, parentSessionId: null, forkedAt: null };
}

async function totalUsageAt(filePath, timestamp) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const forkTime = new Date(timestamp).getTime();
  let latest = null;
  let latestTime = -Infinity;
  for (const raw of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;
    const eventTime = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(eventTime) || eventTime > forkTime || eventTime < latestTime) continue;
    const total = entry.payload?.info?.total_token_usage;
    if (!total) continue;
    latest = usageSummary(total);
    latestTime = eventTime;
  }
  return latest ? { summary: latest, timestamp: latestTime } : null;
}

function normalizeSessionId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

async function collectSessionFiles() {
  const roots = [...getSessionRoots(), ...getHeadlessRoots()];
  const nestedPaths = await Promise.all(roots.map((root) => collectJsonlFiles(root)));
  return [...new Set(nestedPaths.flat())];
}

function codexEventDedupKey({ sessionId, timestamp, model, tokens }) {
  if (!timestamp) return null;
  return [
    sessionId,
    timestamp,
    model,
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.reasoning
  ].join('::');
}

/**
 * Attempt to produce a human-readable label from a raw workspace path.
 * Codex cwd values are already absolute paths, so just return as-is.
 */
function decodeWorkspace(raw) {
  return raw;
}

// ---------------------------------------------------------------------------
// Convert to common collector JSON
// ---------------------------------------------------------------------------

function buildOutput(dailyMap, sessionMap, tokenEvents, pricingData) {
  const byDate = new Map();
  for (const row of dailyMap.values()) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const contributions = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      clients: rows.map(row => {
        const tokens = {
          input:     row.input,
          output:    row.output,
          cacheRead:  row.cacheRead,
          cacheWrite: row.cacheWrite,
          reasoning:  row.reasoning,
        };
        return {
          client:  CLIENT_KEY,
          modelId: row.model,
          tokens,
          cost: calculateCost(row.model, tokens, pricingData),
        };
      })
    }));

  const entries = [...sessionMap.values()].map(wm => {
    const tokens = {
      input:     wm.input,
      output:    wm.output,
      cacheRead:  wm.cacheRead,
      cacheWrite: wm.cacheWrite,
      reasoning:  wm.reasoning,
    };
    return {
      client:         CLIENT_KEY,
      workspaceKey:   wm.workspace,
      workspaceLabel: wm.workspaceLabel,
      sessionId:       wm.sessionId,
      lastActivity:    wm.lastActivity,
      model:          wm.model,
      ...tokens,
      cost: wm.cost,
    };
  });

  return { graphJson: { contributions }, modelsJson: { entries }, tokenEvents };
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

function tokenEventFor({ sessionId, legacySessionIds = [], timestamp, model, tokens, index }) {
  const eventId = codexEventId({ sessionId, timestamp, model, tokens, index });
  return {
    eventId,
    legacyEventIds: legacySessionIds
      .map(candidate => codexEventId({ sessionId: candidate, timestamp, model, tokens, index }))
      .filter(candidate => candidate !== eventId),
    source: CLIENT_KEY,
    sessionId,
    timestamp: timestamp || new Date().toISOString(),
    model,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheCreationTokens: tokens.cacheWrite,
    reasoningTokens: tokens.reasoning,
    privacyLevel: 'safe'
  };
}

function codexEventId({ sessionId, timestamp, model, tokens, index }) {
  return `codex:${stableHash({ sessionId, timestamp, model, tokens, index })}`;
}

function tokenTotal(tokens) {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning;
}

function stableHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function hashableSessionPart(value) {
  const text = String(value || '').trim();
  if (!text) return 'unknown-session';
  return text.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 96) || stableHash(text);
}

function earlierTimestamp(left, right) {
  if (!right) return left || null;
  if (!left) return right;
  return new Date(right) < new Date(left) ? right : left;
}

function laterTimestamp(left, right) {
  if (!right) return left || null;
  if (!left) return right;
  return new Date(right) > new Date(left) ? right : left;
}
