import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb, upsertTokenEvent } from '../src/db.mjs';
import { startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.mjs';

test('APIs cover budget profiles and advisor actions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedDb(dbPath);
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server);
    const budget = await postJson(port, '/api/budget-profiles', {
      source: 'Codex CLI',
      label: 'Codex 15m',
      windowMinutes: 15,
      tokenBudget: 1000
    });
    assert.equal(budget.profile.enabled, true);

    const budgets = await getJson(port, '/api/budget-profiles');
    assert.equal(budgets.profiles.length, 1);

    const live = await getJson(port, '/api/live');
    assert.equal(live.budgetWindows.length, 1);
    assert.ok(live.warnings.some(item => item.type === 'budget-exceeded'));

    const action = await postJson(port, '/api/advisor-actions', {
      periodStart: '2026-06-17',
      periodEnd: '2026-06-17',
      category: '节省模拟',
      title: '测试验证换轻量模型',
      action: '下周测试验证默认先用轻量模型',
      evidence: '1 session',
      sourceRule: 'savings:test'
    });
    assert.equal(action.action.status, 'open');

    const done = await postJson(port, '/api/advisor-actions', {
      ...action.action,
      status: 'done'
    });
    assert.equal(done.action.id, action.action.id);
    assert.equal(done.action.status, 'done');

    const data = await getJson(port, '/api/data');
    assert.equal(data.budgetProfiles.length, 1);
    assert.equal(data.advisorActions[0].status, 'done');

    await assertRejectsWithStatus(fetch(`http://127.0.0.1:${port}/api/budget-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}'
    }), 415);

    const deletedAction = await deleteJson(port, `/api/advisor-actions/${action.action.id}`, {});
    assert.equal(deletedAction.deleted, 1);
    const deletedBudget = await deleteJson(port, '/api/budget-profiles', { id: budget.profile.id });
    assert.equal(deletedBudget.deleted, 1);
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertTokenEvent(db, {
      eventId: 'budget-api-warning',
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 's1',
      timestamp: new Date().toISOString(),
      model: 'gpt-5.3-codex',
      inputTokens: 1200,
      outputTokens: 200
    });
  } finally {
    db.close();
  }
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

async function deleteJson(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'DELETE',
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
