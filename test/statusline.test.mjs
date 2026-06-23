import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDb,
  upsertAdvisorAction,
  upsertBudgetProfile,
  upsertTokenEvent
} from '../src/db.mjs';
import { buildStatuslineSnapshot, formatStatuslineText } from '../src/statusline.mjs';

test('statusline snapshot summarizes recent tokens, budget and advisor actions', () => {
  const { dir, dbPath } = seedStatuslineDb('2026-06-17T02:12:00Z');
  const db = openDb(dbPath);
  try {
    const snapshot = buildStatuslineSnapshot(db, {
      now: new Date('2026-06-17T02:15:00Z'),
      windowMinutes: 15,
      source: 'codex'
    });
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.totals.totalTokens, 1600);
    assert.equal(snapshot.budget.status, 'exceeded');
    assert.equal(snapshot.openAdvisorActions, 1);
    assert.ok(snapshot.budget.resetInMinutes > 0);
    assert.ok(snapshot.warnings.some(warning => warning.type === 'budget-exceeded'));
    assert.ok(snapshot.warnings.some(warning => warning.type === 'unpriced-model-active'));

    const text = formatStatuslineText(snapshot, { maxWidth: 70 });
    assert.ok(text.length <= 70);
    assert.match(text, /^TS /);
    assert.match(text, /tok=1\.6k/);
    assert.match(text, /actions=1/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('statusline CLI prints stable JSON and compact text', async () => {
  const { dir, dbPath } = seedStatuslineDb(new Date().toISOString());
  try {
    const json = await runCli(['statusline', '--db', dbPath, '--format=json', '--window-minutes=15', '--source=codex']);
    assert.equal(json.code, 0, json.stderr);
    const snapshot = JSON.parse(json.stdout);
    assert.equal(snapshot.source, 'codex');
    assert.equal(snapshot.openAdvisorActions, 1);
    assert.equal(snapshot.budget.windows.length, 1);

    const text = await runCli(['statusline', '--db', dbPath, '--format=text', '--window-minutes=15', '--source=codex', '--max-width=60']);
    assert.equal(text.code, 0, text.stderr);
    assert.ok(text.stdout.trim().length <= 60);
    assert.match(text.stdout, /^TS /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('statusline CLI handles missing SQLite as an empty read-only state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-statusline-missing-'));
  const dbPath = join(dir, 'missing.sqlite');
  try {
    const text = await runCli(['statusline', '--db', dbPath, '--format=text']);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /warn=no-db/);

    const json = await runCli(['statusline', '--db', dbPath, '--format=json']);
    assert.equal(json.code, 0, json.stderr);
    const snapshot = JSON.parse(json.stdout);
    assert.equal(snapshot.status, 'missing-db');
    assert.equal(snapshot.totals.totalTokens, 0);
    assert.equal(snapshot.warnings[0].type, 'missing-db');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('statusline help includes integration snippets', async () => {
  const help = await runCli(['statusline', '--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Claude Code statusline command/);
  assert.match(help.stdout, /tmux/);
  assert.match(help.stdout, /PowerShell prompt/);
  assert.match(help.stdout, /only reads local SQLite/);
});

function seedStatuslineDb(timestamp) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-statusline-'));
  const dbPath = join(dir, 'usage.sqlite');
  const resetAnchor = new Date(new Date(timestamp).getTime() - 10 * 60 * 1000).toISOString();
  const db = openDb(dbPath);
  try {
    upsertTokenEvent(db, {
      eventId: `statusline-${timestamp}`,
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp,
      model: 'gpt-5.3-codex-spark',
      inputTokens: 1200,
      outputTokens: 100,
      cacheReadTokens: 300
    });
    upsertBudgetProfile(db, {
      source: 'Codex CLI',
      label: 'Codex 15m',
      windowType: 'fixed',
      windowMinutes: 15,
      resetAnchor,
      warningThreshold: 0.7,
      tokenBudget: 1000
    });
    upsertAdvisorAction(db, {
      periodStart: '2026-06-17',
      periodEnd: '2026-06-17',
      category: '模型切换',
      title: '测试验证改用轻量模型',
      action: '下周测试验证默认先用轻量模型',
      evidence: 'statusline fixture',
      sourceRule: 'statusline:test'
    });
  } finally {
    db.close();
  }
  return { dir, dbPath };
}

function runCli(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['src/cli.mjs', ...argv], {
      cwd: process.cwd(),
      env: process.env,
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
