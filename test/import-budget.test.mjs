import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBudgetTemplate,
  buildCcusageBridgeCommand,
  buildCcusageJsonExportCommand,
  defaultResetAnchor
} from '../src/client/dashboard/import-budget.js';

test('ccusage bridge command builder only emits explicit local CLI commands', () => {
  assert.equal(
    buildCcusageBridgeCommand({ report: 'blocks' }),
    'npx token-work import-usage --format=ccusage-cli --report=blocks --dry-run --yes'
  );
  assert.equal(
    buildCcusageBridgeCommand({ report: 'weekly', apply: true }),
    'npx token-work import-usage --format=ccusage-cli --report=weekly --apply --yes'
  );
  assert.equal(
    buildCcusageBridgeCommand({ report: 'unknown' }),
    'npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes'
  );
});

test('ccusage JSON export command builder emits explicit saved JSON commands', () => {
  assert.equal(
    buildCcusageJsonExportCommand({ report: 'blocks' }),
    'npx ccusage@latest blocks --json --no-cost > ccusage-blocks.json'
  );
  assert.equal(
    buildCcusageJsonExportCommand({ report: 'unknown' }),
    'npx ccusage@latest session --json --no-cost > ccusage-session.json'
  );
});

test('budget templates fill editable fixed-window guardrail fields', () => {
  const reset = defaultResetAnchor(new Date('2026-06-17T02:13:45Z'));
  assert.equal(reset, '2026-06-17T02:13');

  const next = applyBudgetTemplate(
    { tokenBudget: '500000' },
    { label: 'Codex 5h', source: 'Codex CLI', windowType: 'fixed', windowMinutes: 300, warningThreshold: 0.7 },
    new Date('2026-06-17T02:13:45Z')
  );
  assert.equal(next.source, 'Codex CLI');
  assert.equal(next.label, 'Codex 5h');
  assert.equal(next.windowType, 'fixed');
  assert.equal(next.windowMinutes, 300);
  assert.equal(next.warningThreshold, 0.7);
  assert.equal(next.resetAnchor, '2026-06-17T02:13');
  assert.equal(next.tokenBudget, '500000');
});
