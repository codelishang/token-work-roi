import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb } from '../src/db.mjs';

test('ccusage import API dry-runs before explicit apply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-v44-'));
  const dbPath = join(dir, 'usage.sqlite');
  const port = 7400 + Math.floor(Math.random() * 1000);
  const db = openDb(dbPath);
  db.close();

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      BACKUP_DIR: join(dir, 'backups'),
      SCHEDULED_COLLECT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  try {
    await waitForApi(port);
    const payload = {
      daily: [{
        date: '2026-06-17',
        source: 'Codex CLI',
        session: 'ccusage-api-s1',
        model: 'vendor-private-unpriced-model',
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 100,
        totalTokens: 1600,
        costUSD: 99
      }]
    };

    const dryRun = await postJson(port, '/api/import/ccusage-json', {
      payload,
      apply: false
    });
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.daily, 1);
    assert.equal(dryRun.sessions, 1);
    assert.equal(dryRun.tokenEvents, 1);
    assert.ok(dryRun.warnings.some(item => item.type === 'ignored-imported-cost'));

    const before = await getJson(port, '/api/data');
    assert.equal(before.daily.length, 0);
    assert.equal(before.sessions.length, 0);

    const unsafe = await fetch(`http://127.0.0.1:${port}/api/import/ccusage-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          daily: [{ date: '2026-06-17', model: 'gpt-5.3-codex', inputTokens: 1 }],
          prompt: 'do not import'
        }
      })
    });
    assert.equal(unsafe.status, 400);
    assert.match(await unsafe.text(), /conversation-like field/);

    const applied = await postJson(port, '/api/import/ccusage-json', {
      payload,
      apply: true
    });
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.applied.daily, 1);
    assert.equal(applied.applied.sessions, 1);
    assert.equal(applied.applied.tokenEvents, 1);
    assert.ok(applied.backup?.path);
    assert.ok(existsSync(applied.backup.path));

    const after = await getJson(port, '/api/data');
    assert.equal(after.daily.length, 1);
    assert.equal(after.sessions.length, 1);
  } finally {
    await stopChild(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForApi(port) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/data`);
      if (response.ok) return;
    } catch {
      // Retry while the server starts.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not start in time');
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

function stopChild(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolve => {
    child.once('close', resolve);
    child.kill();
  });
}
