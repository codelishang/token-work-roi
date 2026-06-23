import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertSession, upsertSessionAnnotation } from '../src/db.mjs';

test('budget CLI supports fixed windows and warning thresholds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-budget-'));
  const dbPath = join(dir, 'usage.sqlite');
  try {
    const saved = await runCli([
      'budget', 'set',
      '--db', dbPath,
      '--source', 'Codex CLI',
      '--label', 'Codex 5h',
      '--window-type', 'fixed',
      '--window-minutes', '300',
      '--reset-anchor', '2026-06-17T00:00:00Z',
      '--warning-threshold', '0.7',
      '--token-budget', '500000',
      '--json'
    ]);
    assert.equal(saved.code, 0, saved.stderr);
    const body = JSON.parse(saved.stdout);
    assert.equal(body.profile.windowType, 'fixed');
    assert.equal(body.profile.warningThreshold, 0.7);

    const listed = await runCli(['budget', 'list', '--db', dbPath]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /fixed:300m/);
    assert.match(listed.stdout, /warn=70%/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('policy CLI exports markdown snippets without writing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-cli-policy-'));
  const dbPath = join(dir, 'usage.sqlite');
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 's1',
      lastActivity: '2026-06-17T02:00:00Z',
      totalTokens: 1200
    });
    upsertSessionAnnotation(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 's1',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '测试验证',
      workStage: '验证',
      valueLevel: '中'
    });
  } finally {
    db.close();
  }

  try {
    const agents = await runCli(['policy', '--db', dbPath, '--format=agents-md']);
    assert.equal(agents.code, 0, agents.stderr);
    assert.match(agents.stdout, /Token Work ROI Agent Policy/);
    assert.match(agents.stdout, /测试验证/);
    assert.match(agents.stdout, /Do not automatically edit/);
    assert.doesNotMatch(agents.stdout, /secret prompt|private response|actual transcript/i);

    const claude = await runCli(['policy', '--db', join(dir, 'missing.sqlite'), '--format=claude-md']);
    assert.equal(claude.code, 0, claude.stderr);
    assert.match(claude.stdout, /Reviewed sessions|No matching annotated sessions|Claude Code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
