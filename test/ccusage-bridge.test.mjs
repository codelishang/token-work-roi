import test from 'node:test';
import assert from 'node:assert/strict';
import { ccusageInvocation } from '../src/ccusage-bridge.mjs';
import { planCcusageImport } from '../src/ccusage-import.mjs';

test('ccusage bridge builds npx invocation with json and no-cost flags', () => {
  const invocation = ccusageInvocation({ report: 'daily' });
  assert.match(invocation.command, process.platform === 'win32' ? /npx\.cmd$/ : /npx$/);
  assert.deepEqual(invocation.args, ['ccusage@latest', 'daily', '--json', '--no-cost']);
  assert.equal(invocation.commandLabel, 'npx ccusage@latest daily --json --no-cost');
});

test('ccusage bridge accepts explicit binary and rejects unknown reports', () => {
  const invocation = ccusageInvocation({ report: 'blocks', ccusageBin: 'ccusage' });
  assert.equal(invocation.command, 'ccusage');
  assert.deepEqual(invocation.args, ['blocks', '--json', '--no-cost']);
  assert.equal(invocation.commandLabel, 'ccusage blocks --json --no-cost');
  assert.throws(() => ccusageInvocation({ report: 'bad' }), /--report must be one of/);
});

test('ccusage import planner supports weekly report shape', () => {
  const plan = planCcusageImport({
    type: 'weekly',
    data: [{
      week: '2026-06-15',
      source: 'Codex CLI',
      models: ['gpt-5.3-codex'],
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125
    }]
  }, { device: 'test-device' });
  assert.equal(plan.detectedShape, 'weekly');
  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.tokenEvents.length, 1);
});
