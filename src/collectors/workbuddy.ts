/**
 * WorkBuddy data collector.
 *
 * Scans ~/.workbuddy/traces/<pid>/trace_*.json for structured trace files
 * produced by the WorkBuddy desktop app. Each trace contains spans; generation
 * spans carry a `toolOutput` JSON string with an OpenAI-compatible chat
 * completion response that includes a `usage` object.
 *
 * PID-to-session mapping is resolved via ~/.workbuddy/sessions/<pid>.json
 * only for workspace metadata. Trace IDs remain the persisted identity because
 * WorkBuddy removes PID session files after a session ends.
 *
 * Token semantics:
 *   prompt_tokens is cache-inclusive (OpenAI convention), so:
 *     net_input  = prompt_tokens - cached_tokens  (clamped to >= 0)
 *     cache_read = cached_tokens
 *     output     = completion_tokens
 *     reasoning  = completion_tokens_details.reasoning_tokens
 *
 * Only structured token fields are imported. No prompt, response, conversation
 * content, diff, or transcript is ever stored.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { configuredPath, expandPath } from '../collector-config.ts';
import { calculateCost } from '../pricing.ts';
import { localDateFromTimestamp, normalizeModelForGrouping } from './utils.ts';

export const CLIENT_KEY = 'workbuddy';
export const SOURCE_LABEL = 'WorkBuddy';
const MAX_TRACE_FILE_BYTES = 32 * 1024 * 1024;
const INCREMENTAL_MTIME_SLOP_MS = 2_000;

interface WorkBuddyCollectOptions {
  changedAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getTracesDir() {
  return configuredPath('workbuddy', 'tracesDir', '~/.workbuddy/traces');
}

function getSessionsDir() {
  return configuredPath('workbuddy', 'sessionsDir', '~/.workbuddy/sessions');
}

function getWorkbuddyDir() {
  return expandPath(configuredPath('workbuddy', 'root', '~/.workbuddy'));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pos(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function zero() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function addInto(agg, t) {
  agg.input += t.input;
  agg.output += t.output;
  agg.cacheRead += t.cacheRead;
  agg.cacheWrite += t.cacheWrite;
  agg.reasoning += t.reasoning;
}

function hashPath(value) {
  if (!value) return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function stableEventId(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function sanitizeSmallText(value, maxLength) {
  if (!value) return null;
  return String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength) || null;
}

function actualModel(value) {
  const model = sanitizeSmallText(value, 160);
  return model && !/^(auto|default|unknown)$/i.test(model) ? model : null;
}

function traceModel(trace) {
  const models = Array.isArray(trace?.modelInfo?.models)
    ? trace.modelInfo.models.map(actualModel).filter(Boolean)
    : [];
  const uniqueModels = [...new Set(models)];
  return uniqueModels.length === 1 ? uniqueModels[0] : null;
}

function traceSessionId(trace) {
  return sanitizeSmallText(trace?.sessionId, 160);
}

function sessionModelForTrace(trace, sessionInfo, dbSessionMap) {
  const persistedSessionId = traceSessionId(trace);
  const metadataSessionId = persistedSessionId || sessionInfo?.sessionId || null;
  const persistedModel = actualModel(metadataSessionId ? dbSessionMap.get(metadataSessionId)?.model : null);
  if (persistedModel) return persistedModel;

  // A PID can be reused after a trace completes. Its in-memory metadata only
  // proves a model when the trace has no session ID or both IDs agree.
  return !persistedSessionId || sessionInfo?.sessionId === persistedSessionId
    ? sessionInfo?.model || null
    : null;
}

async function safeReaddir(dir: string, opts?: { withFileTypes?: boolean }): Promise<Dirent[] | string[]> {
  try {
    return await readdir(dir, opts as any);
  } catch {
    return [];
  }
}

async function safeReadFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session metadata cache (PID -> { sessionId, cwd })
// ---------------------------------------------------------------------------

async function loadSessionMap() {
  const sessionsDir = getSessionsDir();
  const entries = await safeReaddir(sessionsDir, { withFileTypes: true }) as Dirent[];
  const map = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const pid = basename(entry.name, '.json');
    const text = await safeReadFile(join(sessionsDir, entry.name));
    if (!text) continue;
    try {
      const data = JSON.parse(text);
      const model = actualModel(data.model);
      if (data.sessionId || data.cwd || model) {
        map.set(pid, {
          sessionId: data.sessionId || `workbuddy:${pid}`,
          cwd: data.cwd || null,
          model
        });
      }
    } catch {
      // skip unparseable session files
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Also try workbuddy.db sessions table for session metadata
// ---------------------------------------------------------------------------

async function loadDbSessionMetadata() {
  const dbPath = join(getWorkbuddyDir(), 'workbuddy.db');
  if (!existsSync(dbPath)) return new Map();

  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  } catch {
    return new Map();
  }

  const map = new Map();
  try {
    const rows = db.prepare(`
      SELECT id, cwd, model
      FROM sessions
    `).all();
    for (const row of rows) {
      map.set(row.id, {
        cwd: row.cwd || null,
        model: row.model || null
      });
    }
  } catch {
    // DB schema might differ; skip gracefully
  }

  try { db.close(); } catch { /* ignore */ }
  return map;
}

// ---------------------------------------------------------------------------
// Trace file parser
// ---------------------------------------------------------------------------

/**
 * Parse a single trace JSON file and extract token usage events.
 *
 * @returns {Array} Array of event objects with { eventId, sessionId, timestamp, model, tokens, workspace }
 */
function parseTraceFile(traceJson, sessionMap, dbSessionMap, audit, inheritedTraceModel = null) {
  const events = [];

  const trace = traceJson.trace;
  if (!trace || !trace.traceId) {
    audit.parseErrors += 1;
    return events;
  }

  const traceId = trace.traceId;
  const workerPid = trace.workerPid != null ? String(trace.workerPid) : null;
  const traceTimestamp = trace.startedAt || null;
  const resolvedTraceModel = traceModel(trace);
  const spans = Array.isArray(traceJson.spans) ? traceJson.spans : [];

  // PID session metadata is transient. The trace ID remains available after
  // WorkBuddy removes that file, so use it for stable storage identity.
  const sessionInfo = workerPid ? sessionMap.get(workerPid) : null;
  const sessionId = `workbuddy:${traceId}`;
  const cwd = sessionInfo?.cwd || null;
  const dbMeta = dbSessionMap.get(traceSessionId(trace) || sessionInfo?.sessionId);
  const sessionModel = sessionModelForTrace(trace, sessionInfo, dbSessionMap);

  // Try to get workspace label from DB session metadata
  let workspaceLabel = null;
  if (cwd) {
    workspaceLabel = sanitizeSmallText(basename(String(cwd).replace(/\\/g, '/')), 120);
  }
  if (!workspaceLabel) {
    if (dbMeta?.cwd) {
      workspaceLabel = sanitizeSmallText(basename(String(dbMeta.cwd).replace(/\\/g, '/')), 120);
    }
  }

  for (let spanIndex = 0; spanIndex < spans.length; spanIndex++) {
    const span = spans[spanIndex];
    if (!span || span.type !== 'generation') continue;

    const spanTimestamp = span.startedAt || traceTimestamp;
    if (!span.toolOutput || typeof span.toolOutput !== 'string') continue;

    let responses;
    try {
      responses = JSON.parse(span.toolOutput);
    } catch {
      audit.parseErrors += 1;
      continue;
    }

    // toolOutput can be a single object or an array
    const responseList = Array.isArray(responses) ? responses : [responses];

    for (let respIndex = 0; respIndex < responseList.length; respIndex++) {
      const resp = responseList[respIndex];
      if (!resp || typeof resp !== 'object') continue;

      const usage = resp.usage;
      if (!usage || typeof usage !== 'object') {
        audit.skippedNoTokenRecords += 1;
        continue;
      }

      const promptTokens = pos(usage.prompt_tokens ?? usage.promptTokens);
      const completionTokens = pos(usage.completion_tokens ?? usage.completionTokens);

      const promptDetails = usage.prompt_tokens_details || usage.promptTokensDetails || {};
      const completionDetails = usage.completion_tokens_details || usage.completionTokensDetails || {};

      const cachedTokens = pos(promptDetails.cached_tokens ?? promptDetails.cachedTokens);
      const outputReasoning = pos(completionDetails.reasoning_tokens ?? completionDetails.reasoningTokens);

      // prompt_tokens is cache-inclusive, and reasoning_tokens is included in
      // completion_tokens. Store the latter separately without counting it twice.
      const netInput = Math.max(0, promptTokens - cachedTokens);
      const output = Math.max(0, completionTokens - outputReasoning);

      const tokens = {
        input: netInput,
        output,
        cacheRead: cachedTokens,
        cacheWrite: 0,
        reasoning: outputReasoning
      };

      // Skip if no usable tokens
      if (tokens.input === 0 && tokens.output === 0 &&
          tokens.cacheRead === 0 && tokens.cacheWrite === 0 &&
          tokens.reasoning === 0) {
        audit.skippedNoTokenRecords += 1;
        continue;
      }

      const resolvedModel = actualModel(resp.model) || resolvedTraceModel || inheritedTraceModel || sessionModel;
      if (!resolvedModel) {
        audit.skippedUnresolvedModel += 1;
        continue;
      }
      const model = normalizeModelForGrouping(resolvedModel);

      const timestamp = normalizeTimestamp(spanTimestamp);

      const eventId = `${CLIENT_KEY}:${stableEventId({
        traceId,
        spanId: span.spanId || spanIndex,
        respIndex
      })}`;

      events.push({
        eventId,
        sessionId,
        timestamp,
        date: localDateFromTimestamp(timestamp),
        model,
        tokens,
        workspace: workspaceLabel,
        repoPathHash: hashPath(cwd)
      });

      audit.usableTokenRecords += 1;
    }
  }

  return events;
}

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function traceWindow(trace) {
  const startedAt = new Date(trace?.startedAt || '').getTime();
  const endedAt = new Date(trace?.endedAt || '').getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return { startedAt, endedAt: Math.max(startedAt, endedAt) };
}

function overlapsTraceWindow(left, right) {
  return left.startedAt <= right.endedAt && right.startedAt <= left.endedAt;
}

function inheritedTraceModels(traceFiles) {
  const models = new Map();
  for (const file of traceFiles) {
    const trace = file.traceJson?.trace;
    if (!trace || traceModel(trace)) continue;
    const workerPid = trace.workerPid == null ? null : String(trace.workerPid);
    const window = traceWindow(trace);
    if (!workerPid || !window) continue;

    const candidates = traceFiles
      .filter(other => {
        const otherTrace = other.traceJson?.trace;
        return other !== file
          && otherTrace?.workerPid != null
          && String(otherTrace.workerPid) === workerPid
          && traceWindow(otherTrace)
          && overlapsTraceWindow(window, traceWindow(otherTrace));
      })
      .map(other => traceModel(other.traceJson.trace))
      .filter(Boolean);
    const uniqueModels = [...new Set(candidates)];
    if (uniqueModels.length === 1) models.set(file.filePath, uniqueModels[0]);
  }
  return models;
}

// ---------------------------------------------------------------------------
// Trace file discovery
// ---------------------------------------------------------------------------

async function listTraceFiles(tracesDir) {
  const files = [];
  const pidDirs = await safeReaddir(tracesDir, { withFileTypes: true }) as Dirent[];

  for (const dir of pidDirs) {
    if (!dir.isDirectory()) continue;
    const pidPath = join(tracesDir, dir.name);
    const traceFiles = await safeReaddir(pidPath, { withFileTypes: true }) as Dirent[];

    for (const file of traceFiles) {
      if (!file.isFile()) continue;
      if (!file.name.startsWith('trace_') || !file.name.endsWith('.json')) continue;
      const filePath = join(pidPath, file.name);
      try {
        const info = await stat(filePath);
        files.push({ filePath, size: info.size, mtimeMs: info.mtimeMs });
      } catch {
        // A trace can disappear while WorkBuddy is rotating its files.
      }
    }
  }

  return files;
}

function shouldReadTrace(file, changedAfterMs) {
  return !Number.isFinite(changedAfterMs)
    || file.mtimeMs >= changedAfterMs - INCREMENTAL_MTIME_SLOP_MS;
}

async function readTraceFile(file, audit) {
  if (file.size > MAX_TRACE_FILE_BYTES) {
    audit.skippedOversizedFiles += 1;
    return null;
  }
  const text = await safeReadFile(file.filePath);
  if (!text) {
    audit.parseErrors += 1;
    return null;
  }
  try {
    return { ...file, traceJson: JSON.parse(text) };
  } catch {
    audit.parseErrors += 1;
    return null;
  }
}

function needsInheritedModel(traceJson, sessionMap, dbSessionMap) {
  const trace = traceJson?.trace;
  if (!trace || traceModel(trace)) return false;
  const workerPid = trace.workerPid == null ? null : String(trace.workerPid);
  const sessionInfo = workerPid ? sessionMap.get(workerPid) : null;
  if (sessionModelForTrace(trace, sessionInfo, dbSessionMap)) return false;

  return (Array.isArray(traceJson?.spans) ? traceJson.spans : []).some(span => {
    if (!span || span.type !== 'generation' || typeof span.toolOutput !== 'string') return false;
    try {
      const responses = JSON.parse(span.toolOutput);
      return (Array.isArray(responses) ? responses : [responses]).some(response => {
        const usage = response?.usage;
        return usage && typeof usage === 'object' && !actualModel(response.model);
      });
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function emptyAuditSummary(candidateFiles = 0) {
  return {
    candidateFiles,
    usableTokenRecords: 0,
    skippedNoTokenRecords: 0,
    skippedUnresolvedModel: 0,
    skippedConversationLikeRecords: 0,
    skippedOversizedFiles: 0,
    parseErrors: 0
  };
}

export async function audit() {
  const tracesDir = getTracesDir();
  if (!existsSync(tracesDir)) return emptyAuditSummary();

  const files = await listTraceFiles(tracesDir);
  const summary = emptyAuditSummary(files.length);

  const sessionMap = await loadSessionMap();
  const dbSessionMap = await loadDbSessionMetadata();

  for (const file of files) {
    const traceFile = await readTraceFile(file, summary);
    if (traceFile) parseTraceFile(traceFile.traceJson, sessionMap, dbSessionMap, summary);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collect(pricingData = null, { changedAfterMs }: WorkBuddyCollectOptions = {}) {
  const tracesDir = getTracesDir();
  if (!existsSync(tracesDir)) {
    return { graphJson: { contributions: [] }, modelsJson: { entries: [] }, tokenEvents: [], audit: emptyAuditSummary() };
  }

  const files = await listTraceFiles(tracesDir);
  const sessionMap = await loadSessionMap();
  const dbSessionMap = await loadDbSessionMetadata();
  const auditSummary = emptyAuditSummary(files.length);
  let selectedFiles = files.filter(file => shouldReadTrace(file, changedAfterMs));
  let traceFiles = [];

  for (const file of selectedFiles) {
    const traceFile = await readTraceFile(file, auditSummary);
    if (traceFile) traceFiles.push(traceFile);
  }

  // A trace in auto mode can inherit a model from an overlapping trace in the
  // same worker. Fall back to a complete pass for that uncommon case so an
  // incremental refresh never turns a known usage record into a skipped one.
  if (selectedFiles.length !== files.length && traceFiles.some(file =>
    needsInheritedModel(file.traceJson, sessionMap, dbSessionMap)
  )) {
    selectedFiles = files;
    traceFiles = [];
    auditSummary.skippedOversizedFiles = 0;
    auditSummary.parseErrors = 0;
    for (const file of selectedFiles) {
      const traceFile = await readTraceFile(file, auditSummary);
      if (traceFile) traceFiles.push(traceFile);
    }
  }

  const inheritedModels = inheritedTraceModels(traceFiles);
  const allEvents = traceFiles.flatMap(file =>
    parseTraceFile(file.traceJson, sessionMap, dbSessionMap, auditSummary, inheritedModels.get(file.filePath))
  );

  const output = buildOutput(allEvents, pricingData, auditSummary);
  return {
    ...output,
    reconciliation: {
      managedEventIdPrefix: `${CLIENT_KEY}:`,
      managedEventSessionIds: traceFiles
        .map(file => file.traceJson?.trace?.traceId)
        .filter(Boolean)
        .map(traceId => `${CLIENT_KEY}:${traceId}`),
      reconcileIncrementally: true
    }
  };
}

export async function collectWithAudit(pricingData = null, options = {}) {
  const result = await collect(pricingData, options);
  return { ...result, audit: result.audit || emptyAuditSummary() };
}

// ---------------------------------------------------------------------------
// Build standard collector output
// ---------------------------------------------------------------------------

function buildOutput(events, pricingData, auditSummary) {
  const dailyMap = new Map();
  const sessionMap = new Map();

  for (const event of events) {
    // Daily aggregation by date + model
    const dailyKey = `${event.date}::${event.model}`;
    if (!dailyMap.has(dailyKey)) {
      dailyMap.set(dailyKey, { date: event.date, model: event.model, ...zero(), cost: 0 });
    }
    const daily = dailyMap.get(dailyKey);
    addInto(daily, event.tokens);
    daily.cost += calculateCost(event.model, event.tokens, pricingData);

    // Session aggregation by sessionId + model
    const sessionKey = `${event.sessionId}::${event.model}`;
    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        workspace: event.workspace || event.sessionId,
        workspaceLabel: event.workspace || event.sessionId,
        sessionId: event.sessionId,
        model: event.model,
        ...zero(),
        cost: 0,
        lastActivity: event.timestamp
      });
    }
    const sess = sessionMap.get(sessionKey);
    addInto(sess, event.tokens);
    sess.cost += calculateCost(event.model, event.tokens, pricingData);
    if (event.timestamp > (sess.lastActivity || '')) {
      sess.lastActivity = event.timestamp;
    }
  }

  // Build graphJson contributions
  const byDate = new Map();
  for (const row of dailyMap.values()) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const contributions = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      clients: rows.map(row => ({
        client: CLIENT_KEY,
        modelId: row.model,
        tokens: {
          input: row.input,
          output: row.output,
          cacheRead: row.cacheRead,
          cacheWrite: row.cacheWrite,
          reasoning: row.reasoning
        },
        cost: row.cost
      }))
    }));

  // Build modelsJson entries
  const entries = [...sessionMap.values()].map(sess => ({
    client: CLIENT_KEY,
    workspaceKey: sess.workspace,
    workspaceLabel: sess.workspaceLabel,
    sessionId: sess.sessionId,
    lastActivity: sess.lastActivity,
    model: sess.model,
    input: sess.input,
    output: sess.output,
    cacheRead: sess.cacheRead,
    cacheWrite: sess.cacheWrite,
    reasoning: sess.reasoning,
    cost: sess.cost
  }));

  // Build tokenEvents
  const tokenEvents = events.map(event => ({
    eventId: event.eventId,
    source: CLIENT_KEY,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    model: event.model,
    inputTokens: event.tokens.input,
    outputTokens: event.tokens.output,
    cacheReadTokens: event.tokens.cacheRead,
    cacheCreationTokens: event.tokens.cacheWrite,
    reasoningTokens: event.tokens.reasoning,
    repoPathHash: event.repoPathHash,
    privacyLevel: event.repoPathHash ? 'hashed' : 'safe'
  }));

  return {
    graphJson: { contributions },
    modelsJson: { entries },
    tokenEvents,
    audit: auditSummary
  };
}

// ---------------------------------------------------------------------------
// Roots (for registry detection)
// ---------------------------------------------------------------------------

export function roots() {
  return [getTracesDir()];
}
