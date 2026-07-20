import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceHealth } from '../src/source-health.ts';

test('source health summarizes coverage without exposing local paths', () => {
  const rows = buildSourceHealth({
    collectors: [{
      id: 'codex',
      label: 'Codex CLI',
      supportStatus: 'stable',
      privacyLevel: 'metadata-only',
      defaultEnabled: true,
      detected: true,
      existingRoots: ['X:/workspace/sample-codex-root'],
      configuredRoots: ['X:/workspace/sample-codex-root'],
      readsConversationContent: false,
      tokenReliability: 'native-token-fields',
      dataFields: ['input_tokens']
    }, {
      id: 'ccusage',
      label: 'ccusage Import Bridge',
      supportStatus: 'import-only',
      privacyLevel: 'metadata-only',
      defaultEnabled: false,
      detected: false,
      existingRoots: [],
      configuredRoots: [],
      readsConversationContent: false,
      tokenReliability: 'external-json-token-fields',
      dataFields: ['input_tokens']
    }],
    sessionRows: [{
      source: 'Codex CLI',
      count: 2,
      totalTokens: 1200,
      latestSessionAt: '2026-06-17T02:00:00Z'
    }],
    dailyRows: [{
      source: 'Codex CLI',
      count: 1,
      totalTokens: 1200,
      latestDailyAt: '2026-06-17T02:00:00Z'
    }],
    eventRows: [{
      source: 'Codex CLI',
      count: 2,
      totalTokens: 1200,
      latestEventAt: '2026-06-17T02:00:00Z'
    }, {
      source: 'import:ccusage-cli',
      count: 3,
      totalTokens: 3000,
      latestEventAt: '2026-06-17T03:00:00Z'
    }],
    runs: [{
      source: 'import:ccusage-cli',
      status: 'ok',
      collectedAt: '2026-06-17T03:05:00Z'
    }]
  });

  const codex = rows.find(row => row.id === 'codex');
  assert.equal(codex.health, 'has-data');
  assert.equal(codex.sessions, 2);
  assert.equal(codex.totalTokens, 1200);
  assert.equal(codex.reconciliation.status, 'ok');
  assert.equal(codex.detectedRootCount, 1);
  assert.match(codex.recommendedImport, /原生采集/);
  assert.equal(JSON.stringify(codex).includes('sample-codex-root'), false);

  const ccusage = rows.find(row => row.id === 'ccusage');
  assert.equal(ccusage.coverageTier, 'ccusage import-bridge');
  assert.equal(ccusage.tokenEvents, 3);
  assert.equal(ccusage.lastRunStatus, 'ok');
  assert.match(ccusage.recommendedImport, /ccusage/);
  assert.match(ccusage.commandHint, /npx token-work import-usage/);
});

test('source health uses event totals once and exposes reconciliation risk', () => {
  const [row] = buildSourceHealth({
    collectors: [{
      id: 'codex',
      label: 'Codex CLI',
      supportStatus: 'stable',
      privacyLevel: 'metadata-only',
      defaultEnabled: true,
      detected: true,
      existingRoots: [],
      configuredRoots: [],
      readsConversationContent: false
    }],
    dailyRows: [{ source: 'Codex CLI', count: 1, totalTokens: 100 }],
    sessionRows: [{ source: 'Codex CLI', count: 1, totalTokens: 100 }],
    eventRows: [{ source: 'Codex CLI', count: 1, totalTokens: 150 }]
  });

  assert.equal(row.totalTokens, 150);
  assert.equal(row.reconciliation.status, 'risk');
  assert.equal(row.health, 'reconciliation-risk');
});
