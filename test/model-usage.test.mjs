import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildModelUsageRows,
  filterSessionsByDashboardFilters,
  sessionModel
} from '../src/client/dashboard/model-usage.js';

const sessions = [
  {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex-a',
    model: 'gpt-5.5',
    lastActivity: '2026-06-10',
    totalTokens: 100,
    costUSD: 0.01
  },
  {
    device: 'devbox',
    source: 'Claude Code',
    sessionId: 'claude-a',
    model: 'claude-opus-4-7',
    lastActivity: '2026-06-10',
    totalTokens: 50,
    costUSD: 0.02
  },
  {
    device: 'laptop',
    source: 'Codex CLI',
    sessionId: 'codex-b',
    pricingModel: 'gpt-5.3-codex',
    lastActivity: '2026-06-09',
    totalTokens: 30,
    costUSD: 0.03
  }
];

const daily = [
  {
    usageDate: '2026-06-10',
    source: 'Codex CLI',
    model: 'gpt-5.5',
    inputTokens: 60,
    outputTokens: 40,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 100,
    costUSD: 0.01,
    pricingStatus: 'priced'
  },
  {
    usageDate: '2026-06-10',
    source: 'Claude Code',
    model: 'claude-opus-4-7',
    inputTokens: 20,
    outputTokens: 30,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 50,
    costUSD: 0.02,
    pricingStatus: 'priced'
  }
];

test('sessionModel falls back to pricingModel when API model is absent', () => {
  assert.equal(sessionModel(sessions[2]), 'gpt-5.3-codex');
});

test('filterSessionsByDashboardFilters applies model filters to session data', () => {
  const rows = filterSessionsByDashboardFilters(sessions, {
    startDate: '2026-06-09',
    endDate: '2026-06-10',
    sources: new Set(),
    devices: new Set(),
    models: new Set(['gpt-5.5'])
  });
  assert.deepEqual(rows.map(row => row.sessionId), ['codex-a']);
});

test('buildModelUsageRows aggregates token cost and session counts by model', () => {
  const rows = buildModelUsageRows(daily, sessions);
  const byModel = Object.fromEntries(rows.map(row => [row.model, row]));

  assert.equal(byModel['gpt-5.5'].totalTokens, 100);
  assert.equal(byModel['gpt-5.5'].sessionCount, 1);
  assert.equal(byModel['gpt-5.5'].dayCount, 1);
  assert.equal(byModel['gpt-5.5'].pricingStatus, '已定价');

  assert.equal(byModel['claude-opus-4-7'].totalTokens, 50);
  assert.equal(byModel['claude-opus-4-7'].sources[0], 'Claude Code');

  assert.equal(byModel['gpt-5.3-codex'].totalTokens, 30);
  assert.equal(byModel['gpt-5.3-codex'].sessionCount, 1);
});
