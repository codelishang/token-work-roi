import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverageBridge } from '../src/coverage-bridge.mjs';

test('coverage bridge separates native trusted, importable, experimental, detected-only and unsupported sources', () => {
  const bridge = buildCoverageBridge({
    sourceHealth: [
      {
        id: 'claude',
        label: 'Claude Code',
        supportStatus: 'stable',
        tokenReliability: 'native-token-fields',
        detected: true,
        sessions: 3,
        tokenEvents: 10,
        totalTokens: 12_000
      },
      {
        id: 'ccusage',
        label: 'ccusage Import',
        supportStatus: 'import-only',
        tokenReliability: 'external-json-token-fields'
      },
      {
        id: 'cursor',
        label: 'Cursor',
        supportStatus: 'experimental',
        tokenReliability: 'explicit-token-fields-only',
        detected: true
      },
      {
        id: 'kiro',
        label: 'Kiro',
        supportStatus: 'unsupported',
        tokenReliability: 'unknown-no-usage-import',
        detected: false
      }
    ]
  });

  assert.equal(bridge.summary.nativeTrusted, 1);
  assert.equal(bridge.summary.importable, 1);
  assert.equal(bridge.summary.experimental, 1);
  assert.equal(bridge.summary.detectedOnly, 0);
  assert.equal(bridge.summary.unsupported, 1);
  assert.equal(bridge.summary.sourcesWithUsage, 1);
  assert.equal(bridge.summary.successfulCoverage, 1);
  assert.deepEqual(bridge.summary.ccusageReports, ['daily', 'weekly', 'monthly', 'session', 'blocks']);
  assert.equal(bridge.rows.find(row => row.id === 'claude').statusLabel, '原生可信采集');
  assert.equal(bridge.rows.find(row => row.id === 'claude').successfulCoverage, true);
  assert.equal(bridge.rows.find(row => row.id === 'ccusage').statusLabel, 'ccusage 可导入');
  assert.equal(bridge.rows.find(row => row.id === 'ccusage').workflow.state, 'import-json');
  assert.equal(bridge.rows.find(row => row.id === 'ccusage').importReports.length, 5);
  assert.match(bridge.rows.find(row => row.id === 'ccusage').importReports[0].exportCommand, /ccusage@latest daily --json --no-cost/);
  assert.match(bridge.rows.find(row => row.id === 'cursor').recommendedAction, /collector audit/);
  assert.equal(bridge.rows.find(row => row.id === 'cursor').successfulCoverage, false);
  assert.equal(bridge.rows.find(row => row.id === 'cursor').workflow.state, 'audit-required');
  assert.match(bridge.rows.find(row => row.id === 'cursor').failureReason, /实验来源/);
});
