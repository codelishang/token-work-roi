import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI imports ccusage dry-run/apply and prints report JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-'));
  const dbPath = join(dir, 'usage.sqlite');
  const jsonPath = join(dir, 'ccusage.json');
  writeFileSync(jsonPath, JSON.stringify({
    type: 'session',
    data: [{
      session: 's1',
      models: ['gpt-5.3-codex'],
      inputTokens: 100,
      outputTokens: 20,
      lastActivity: '2026-06-17T02:00:00Z'
    }]
  }), 'utf8');

  try {
    const dryRun = await runCli(['import-usage', '--format=ccusage-json', '--file', jsonPath, '--db', dbPath, '--dry-run', '--json']);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).mode, 'dry-run');

    const applied = await runCli(['import-usage', '--format=ccusage-json', '--file', jsonPath, '--db', dbPath, '--apply', '--json']);
    assert.equal(applied.code, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).applied.sessions, 1);

    const budget = await runCli(['budget', 'set', '--db', dbPath, '--source', 'Codex CLI', '--label', 'Codex 15m', '--window-minutes', '15', '--token-budget', '1000']);
    assert.equal(budget.code, 0, budget.stderr);

    const list = await runCli(['budget', 'list', '--db', dbPath, '--json']);
    assert.equal(list.code, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).profiles.length, 1);

    const report = await runCli(['report', '--db', dbPath, '--period', 'all', '--format', 'json']);
    assert.equal(report.code, 0, report.stderr);
    assert.equal(JSON.parse(report.stdout).totals.totalTokens, 120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runCli(argv, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['src/cli.mjs', ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
  });
}
