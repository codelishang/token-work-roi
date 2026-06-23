import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.mjs';

test('CLI bridge refuses non-interactive external scans without --yes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-refuse-'));
  const dbPath = join(dir, 'usage.sqlite');
  const mock = createMockCcusage(dir);
  try {
    const result = await runCli(['import-usage', '--format=ccusage-cli', '--report=session', '--ccusage-bin', mock, '--db', dbPath, '--dry-run', '--json']);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /requires --yes/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI bridge dry-run/apply imports ccusage CLI JSON safely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-bridge-'));
  const dbPath = join(dir, 'usage.sqlite');
  const mock = createMockCcusage(dir);
  try {
    const dryRun = await runCli(['import-usage', '--format=ccusage-cli', '--report=session', '--ccusage-bin', mock, '--db', dbPath, '--dry-run', '--yes', '--json']);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const dryRunBody = JSON.parse(dryRun.stdout);
    assert.equal(dryRunBody.mode, 'dry-run');
    assert.equal(dryRunBody.format, 'ccusage-cli');
    assert.equal(dryRunBody.bridge.report, 'session');
    assert.equal(dryRunBody.sessions, 1);
    assert.equal(existsSync(dbPath), false);

    const applied = await runCli(['import-usage', '--format=ccusage-cli', '--report=session', '--ccusage-bin', mock, '--db', dbPath, '--apply', '--yes', '--json']);
    assert.equal(applied.code, 0, applied.stderr);
    const appliedBody = JSON.parse(applied.stdout);
    assert.equal(appliedBody.applied.sessions, 1);
    assert.equal(appliedBody.applied.tokenEvents, 1);
    assert.ok(appliedBody.backup?.path);
    assert.ok(existsSync(appliedBody.backup.path));

    const db = openDb(dbPath);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM collection_runs WHERE source = ?').get('import:ccusage-cli').count, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM token_events WHERE tool_category = ?').get('import:ccusage-cli').count, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM session_usage').get().count, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI bridge rejects unsafe ccusage CLI JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-unsafe-'));
  const dbPath = join(dir, 'usage.sqlite');
  const mock = createMockCcusage(dir);
  try {
    const result = await runCli(['import-usage', '--format=ccusage-cli', '--report=session', '--ccusage-bin', mock, '--db', dbPath, '--dry-run', '--yes', '--json'], {
      TOKEN_WORK_MOCK_CCUSAGE_OUTPUT: 'unsafe'
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /conversation-like field/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI bridge reports external command failures clearly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-fail-'));
  const dbPath = join(dir, 'usage.sqlite');
  const mock = createMockCcusage(dir);
  try {
    const result = await runCli(['import-usage', '--format=ccusage-cli', '--report=session', '--ccusage-bin', mock, '--db', dbPath, '--dry-run', '--yes', '--json'], {
      TOKEN_WORK_MOCK_CCUSAGE_OUTPUT: 'fail'
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ccusage CLI failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-ccusage reports token coverage differences without writing SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-compare-ccusage-'));
  const mock = createMockCcusage(dir);
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: {
      claude: { roots: [join(dir, 'missing-claude')], includeDesktopLocalAgent: false },
      codex: { homes: [join(dir, 'missing-codex')], sessionSubdirs: ['sessions'] },
      cursor: { roots: [join(dir, 'missing-cursor')] }
    }
  }), 'utf8');
  try {
    const result = await runCli([
      'compare-ccusage',
      '--report=session',
      '--ccusage-bin',
      mock,
      '--sources=claude,codex',
      '--yes',
      '--json'
    ], {
      TOKEN_WORK_CONFIG: configPath,
      NODE_OPTIONS: '--no-warnings'
    });
    assert.equal(result.code, 2, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.tokenStudio.totalTokens, 0);
    assert.equal(body.ccusage.totalTokens, 125);
    assert.match(body.note, /ignores ccusage cost/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockCcusage(dir) {
  const scriptPath = join(dir, 'mock-ccusage.mjs');
  writeFileSync(scriptPath, [
    "const mode = process.env.TOKEN_WORK_MOCK_CCUSAGE_OUTPUT || 'safe';",
    "if (!process.argv.includes('--json') || !process.argv.includes('--no-cost')) { console.error('missing expected flags'); process.exit(3); }",
    "if (mode === 'fail') { console.error('mock failure'); process.exit(7); }",
    "const row = { session: 'cli-bridge-s1', source: 'Codex CLI', models: ['gpt-5.3-codex'], inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, lastActivity: '2026-06-17T02:00:00Z' };",
    "if (mode === 'unsafe') row.prompt = 'secret prompt';",
    "console.log(JSON.stringify({ type: 'session', data: [row] }));"
  ].join('\n'), 'utf8');

  if (process.platform === 'win32') {
    const cmdPath = join(dir, 'mock-ccusage.cmd');
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return cmdPath;
  }

  const binPath = join(dir, 'mock-ccusage');
  writeFileSync(binPath, `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
  chmodSync(binPath, 0o755);
  return binPath;
}

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
