import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLiveDataFreshness, buildLiveGuardrails, buildLiveSnapshot } from '../src/live.mjs';
import { openDb, upsertTokenEvent } from '../src/db.mjs';

test('live snapshot uses recent token events for burn rate and cache hit', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    sessions: [{
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 'old',
      lastActivity: '2026-06-17T01:00:00Z',
      totalTokens: 99999
    }],
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Cursor',
      sessionId: 's1',
      timestamp: '2026-06-17T02:10:00Z',
      model: 'gpt-5.3-codex',
      inputTokens: 1000,
      outputTokens: 250,
      cacheReadTokens: 500
    }]
  });
  assert.equal(snapshot.status, 'active');
  assert.equal(snapshot.totals.totalTokens, 1750);
  assert.equal(snapshot.dataFreshness, 'fresh');
  assert.equal(snapshot.totals.burnRateTokensPerHour, 7000);
  assert.equal(snapshot.bySource[0].key, 'Cursor');
  assert.equal(snapshot.activeSessions.length, 0);
  assert.ok(snapshot.totals.cacheHitRate > 0);
});

test('live snapshot builds 24h pulse metrics from event-level rows', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T12:00:00Z'),
    windowMinutes: 1440,
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: '2026-06-17T01:10:00Z',
      model: 'gpt-5.5',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 400
    }, {
      eventId: 'e2',
      device: 'demo',
      source: 'Claude Code',
      sessionId: 's2',
      timestamp: '2026-06-17T11:50:00Z',
      model: 'claude-opus-4-7',
      inputTokens: 2000,
      outputTokens: 300,
      cacheReadTokens: 700
    }]
  });
  assert.equal(snapshot.totals.requestCount, 2);
  assert.equal(snapshot.pulse.requestCount, 2);
  assert.equal(snapshot.pulse.timeline.length, 24);
  assert.equal(snapshot.pulse.agent.activeMinutes, 30);
  assert.equal(snapshot.pulse.agent.utilizationPercent, 2.083333333333333);
  assert.equal(snapshot.byModel[0].requests, 1);
});

test('live snapshot reports idle empty state', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    sessions: [],
    tokenEvents: []
  });
  assert.equal(snapshot.status, 'idle');
  assert.equal(snapshot.totals.totalTokens, 0);
  assert.equal(snapshot.dataFreshness, 'empty');
  assert.deepEqual(snapshot.byModel, []);
});

test('live data freshness explains collecting, stale and empty states', () => {
  assert.equal(buildLiveDataFreshness({
    collectionState: { status: 'running' }
  }).dataFreshness, 'collecting');

  assert.equal(buildLiveDataFreshness({
    collectionState: { status: 'error', message: 'collector failed' },
    tokenEventCount: 10
  }).dataFreshness, 'error');

  assert.equal(buildLiveDataFreshness({
    nowMs: new Date('2026-06-20T10:00:00Z').getTime(),
    tokenEventCount: 10,
    latestEventAt: '2026-06-20T09:00:00Z',
    latestCollectionRunAt: '2026-06-20T09:59:30Z',
    refreshIntervalSeconds: 60
  }).dataFreshness, 'fresh');

  const stale = buildLiveDataFreshness({
    nowMs: new Date('2026-06-20T10:00:00Z').getTime(),
    tokenEventCount: 10,
    latestEventAt: '2026-06-20T09:00:00Z',
    latestCollectionRunAt: '2026-06-20T09:30:00Z',
    refreshIntervalSeconds: 60
  });
  assert.equal(stale.dataFreshness, 'stale');
  assert.match(stale.staleReason, /刷新/);
});

test('live guardrails warn on burn rate, low cache hit, low output/input and unpriced models', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: '2026-06-17T02:10:00Z',
      model: 'gpt-5.3-codex-spark',
      inputTokens: 20_000,
      outputTokens: 500,
      cacheReadTokens: 0
    }]
  });
  const types = snapshot.warnings.map(item => item.type).sort();
  assert.deepEqual(types, [
    'high-burn-rate',
    'low-cache-hit',
    'low-output-input-ratio',
    'unpriced-model-active'
  ].sort());
  assert.equal(snapshot.guardrails.tokenBudgetPerHour, 50_000);
});

test('live guardrail thresholds can be overridden', () => {
  const warnings = buildLiveGuardrails({
    totals: {
      inputTokens: 20_000,
      outputTokens: 500,
      cacheReadTokens: 0,
      totalTokens: 20_500,
      burnRateTokensPerHour: 60_000,
      cacheHitRate: 50
    },
    byModel: [{ key: 'gpt-5.3-codex', totalTokens: 20_500 }]
  }, {
    tokenBudgetPerHour: 100_000,
    minCacheHitRate: 0.1,
    minOutputInputRatio: 0.01,
    highInputTokens: 10_000
  });
  assert.deepEqual(warnings, []);
});

test('live snapshot builds budget windows and budget warnings', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    budgetProfiles: [{
      id: 1,
      source: 'Codex CLI',
      label: 'Codex 15m',
      windowMinutes: 15,
      tokenBudget: 10_000,
      costBudgetUSD: 0,
      enabled: true
    }],
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: '2026-06-17T02:10:00Z',
      model: 'gpt-5.3-codex',
      inputTokens: 9_000,
      outputTokens: 1_000
    }]
  });
  assert.equal(snapshot.budgetWindows.length, 1);
  assert.equal(snapshot.budgetWindows[0].status, 'exceeded');
  assert.ok(snapshot.warnings.some(item => item.type === 'budget-exceeded'));
});

test('live guardrails suggest pausing heavy models when budget pressure is active', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    budgetProfiles: [{
      id: 1,
      source: 'Claude Code',
      label: 'Claude 15m',
      windowMinutes: 15,
      tokenBudget: 10_000,
      enabled: true
    }],
    tokenEvents: [{
      eventId: 'heavy-budget',
      device: 'demo',
      source: 'Claude Code',
      sessionId: 's1',
      timestamp: '2026-06-17T02:10:00Z',
      model: 'claude-opus-4-7',
      inputTokens: 9_000,
      outputTokens: 2_000
    }]
  });
  const warning = snapshot.warnings.find(item => item.type === 'heavy-model-stop-today');
  assert.ok(warning);
  assert.match(warning.action, /轻量\/中模型/);
});

test('live snapshot warns when current pace will exceed custom budget', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    budgetProfiles: [{
      id: 1,
      source: 'Codex CLI',
      label: 'Codex 15m',
      windowMinutes: 15,
      tokenBudget: 12_000,
      enabled: true
    }],
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: '2026-06-17T02:12:00Z',
      model: 'gpt-5.3-codex',
      inputTokens: 8_000,
      outputTokens: 1_000
    }]
  });
  assert.equal(snapshot.budgetWindows[0].status, 'over-pace');
  assert.ok(snapshot.warnings.some(item => item.type === 'over-budget-pace'));
});

test('live snapshot supports fixed budget reset windows and custom near threshold', () => {
  const snapshot = buildLiveSnapshot({
    now: new Date('2026-06-17T02:15:00Z'),
    windowMinutes: 15,
    budgetProfiles: [{
      id: 1,
      source: 'Codex CLI',
      label: 'Codex fixed hour',
      windowType: 'fixed',
      windowMinutes: 60,
      resetAnchor: '2026-06-17T00:00:00Z',
      warningThreshold: 0.2,
      tokenBudget: 10_000,
      enabled: true
    }],
    tokenEvents: [{
      eventId: 'e1',
      device: 'demo',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: '2026-06-17T02:10:00Z',
      model: 'gpt-5.3-codex',
      inputTokens: 1_800,
      outputTokens: 400
    }]
  });
  const window = snapshot.budgetWindows[0];
  assert.equal(window.windowType, 'fixed');
  assert.equal(window.windowStart, '2026-06-17T02:00:00.000Z');
  assert.equal(window.windowEnd, '2026-06-17T03:00:00.000Z');
  assert.equal(window.resetInMinutes, 45);
  assert.equal(window.warningThreshold, 0.2);
  assert.equal(window.status, 'near-limit');
  assert.ok(snapshot.warnings.some(item => item.type === 'near-budget-limit'));
});


test('live API returns guardrails and warnings from temporary SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-live-api-'));
  const dbPath = join(dir, 'usage.sqlite');
  const port = 6100 + Math.floor(Math.random() * 1000);
  const db = openDb(dbPath);
  try {
    upsertTokenEvent(db, {
      eventId: 'live-api-warning',
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: new Date().toISOString(),
      model: 'gpt-5.3-codex-spark',
      inputTokens: 20_000,
      outputTokens: 100
    });
  } finally {
    db.close();
  }

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SCHEDULED_COLLECT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  try {
    await waitForLiveApi(port);
    const response = await fetch(`http://127.0.0.1:${port}/api/live`);
    if (!response.ok) assert.fail(await response.text());
    const body = await response.json();
    assert.equal(body.guardrails.tokenBudgetPerHour, 50_000);
    assert.equal(body.dataFreshness, 'fresh');
    assert.equal(typeof body.latestEventAt, 'string');
    assert.equal(body.collectionState.status, 'idle');
    assert.ok(body.warnings.some(item => item.type === 'high-burn-rate'));
  } finally {
    await stopChild(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live API does not cap 24h token event counts at 500', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-live-window-'));
  const dbPath = join(dir, 'usage.sqlite');
  const port = 6200 + Math.floor(Math.random() * 1000);
  const db = openDb(dbPath);
  try {
    const now = Date.now();
    for (let index = 0; index < 620; index += 1) {
      upsertTokenEvent(db, {
        eventId: `live-window-${index}`,
        device: 'devbox',
        source: 'Codex CLI',
        sessionId: `s${index % 5}`,
        timestamp: new Date(now - index * 60 * 1000).toISOString(),
        model: 'gpt-5.3-codex',
        inputTokens: 100,
        outputTokens: 20
      });
    }
  } finally {
    db.close();
  }

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SCHEDULED_COLLECT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  try {
    await waitForLiveApi(port);
    const response = await fetch(`http://127.0.0.1:${port}/api/live?windowMinutes=1440`);
    if (!response.ok) assert.fail(await response.text());
    const body = await response.json();
    assert.equal(body.totals.requestCount, 620);
    assert.equal(body.pulse.requestCount, 620);
    assert.equal(body.bySource[0].requests, 620);
  } finally {
    await stopChild(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForLiveApi(port) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/live`);
      if (response.ok) return;
    } catch {
      // Retry while the server starts.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('live API did not start in time');
}

function stopChild(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolve => {
    child.once('close', resolve);
    child.kill();
  });
}
