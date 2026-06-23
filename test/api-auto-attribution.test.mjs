import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  openDb,
  upsertSession,
  upsertSessionAnnotation
} from '../src/db.mjs';

test('auto attribution API suggests, applies, protects manual rows, and undoes auto rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-auto-'));
  const dbPath = join(dir, 'usage.sqlite');
  const backupDir = join(dir, 'backups');
  const port = 6300 + Math.floor(Math.random() * 1000);
  seedDb(dbPath);

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      BACKUP_DIR: backupDir,
      SCHEDULED_COLLECT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForApi(port, () => ({ stdout, stderr, exited: child.exitCode != null, exitCode: child.exitCode }));

    const suggestions = await getJson(port, '/api/auto-attribution/suggestions');
    assert.equal(suggestions.ok, true);
    assert.equal(suggestions.plan.highConfidenceCount, 1);
    assert.equal(suggestions.plan.suggestions[0].values.projectAlias, 'TokenWork');

    await assertRejectsWithStatus(
      fetch(`http://127.0.0.1:${port}/api/auto-attribution/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}'
      }),
      415
    );

    const applied = await postJson(port, '/api/auto-attribution/apply', {
      sessions: suggestions.plan.suggestions.map(row => ({
        device: row.device,
        source: row.source,
        sessionId: row.sessionId
      }))
    });
    assert.equal(applied.applied, 1);
    assert.equal(existsSync(applied.backup.path), true);
    assert.ok(applied.runId);

    const data = await getJson(port, '/api/data');
    const auto = data.sessions.find(session => session.sessionId === 'codex:one');
    const manual = data.sessions.find(session => session.sessionId === 'claude:two');
    assert.equal(auto.annotationSource, 'auto');
    assert.equal(auto.annotationConfidence, 80);
    assert.equal(auto.attributionQuality, 'auto-high');
    assert.equal(manual.annotationSource, 'manual');
    assert.equal(manual.projectAlias, 'Manual Project');

    const undone = await postJson(port, '/api/auto-attribution/undo', { runId: applied.runId });
    assert.equal(undone.deleted, 1);
    assert.equal(existsSync(undone.backup.path), true);

    const afterUndo = await getJson(port, '/api/data');
    assert.equal(afterUndo.sessions.find(session => session.sessionId === 'codex:one').annotationSource, null);
    assert.equal(afterUndo.sessions.find(session => session.sessionId === 'claude:two').annotationSource, 'manual');
  } finally {
    await stopChild(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'codex:one',
      lastActivity: '2026-06-01T01:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\TokenWork',
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      costUSD: 0.01
    });
    upsertSession(db, {
      device: 'devbox',
      source: 'Claude Code',
      sessionId: 'claude:two',
      lastActivity: '2026-06-01T02:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\ManualProject',
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      costUSD: 0.02
    });
    upsertSessionAnnotation(db, {
      device: 'devbox',
      source: 'Claude Code',
      sessionId: 'claude:two',
      projectAlias: 'Manual Project',
      taskType: '功能开发'
    });
  } finally {
    db.close();
  }
}

async function waitForApi(port, diagnostics) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < 5000) {
    try {
      await getJson(port, '/api/data');
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const details = diagnostics ? diagnostics() : {};
  throw new Error(`server did not start in time: ${lastError?.message || 'no response'}\nstdout=${details.stdout || ''}\nstderr=${details.stderr || ''}\nexit=${details.exited ? details.exitCode : 'running'}`);
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function postJson(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function assertRejectsWithStatus(responsePromise, expectedStatus) {
  const response = await responsePromise;
  assert.equal(response.status, expectedStatus, await response.text());
}

function stopChild(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolve => {
    child.once('close', resolve);
    child.kill();
  });
}
