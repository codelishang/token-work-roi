import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb, upsertDaily, upsertSession } from '../src/db.mjs';
import { startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.mjs';

test('annotation API upserts, merges into /api/data, and deletes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedDb(dbPath);
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server);
    const initial = await getJson(port, '/api/data');
    assert.equal(initial.sessions.length, 1);
    assert.equal(initial.sessions[0].model, 'codex-mini');
    assert.equal(initial.sessions[0].taskType, '未分类');
    assert.equal(initial.sessions[0].outputStatus, '未标注');
    assert.equal(initial.sessions[0].workPurpose, '未说明');
    assert.equal(initial.sessions[0].workStage, '未说明');
    assert.equal(initial.sessions[0].valueLevel, '未评估');

    const payload = {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\Project:codex-mini',
      projectAlias: 'AI 选题雷达',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '高',
      note: '完成 v1 标注'
    };

    await assertRejectsWithStatus(
      fetch(`http://127.0.0.1:${port}/api/session-annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      }),
      415
    );

    await assertRejectsWithStatus(
      fetch(`http://127.0.0.1:${port}/api/session-annotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://evil.example'
        },
        body: JSON.stringify(payload)
      }),
      403
    );

    const saved = await postJson(port, '/api/session-annotations', payload);
    assert.equal(saved.ok, true);
    assert.equal(saved.annotation.projectAlias, 'AI 选题雷达');

    const annotated = await getJson(port, '/api/data');
    assert.equal(annotated.meta.taskTypes.includes('功能开发'), true);
    assert.equal(annotated.sessions[0].projectAlias, 'AI 选题雷达');
    assert.equal(annotated.sessions[0].taskType, '功能开发');
    assert.equal(annotated.sessions[0].outputStatus, '已完成');
    assert.equal(annotated.sessions[0].workPurpose, '功能开发');
    assert.equal(annotated.sessions[0].workStage, '实现');
    assert.equal(annotated.sessions[0].valueLevel, '高');
    assert.equal(annotated.sessions[0].note, '完成 v1 标注');

    const deleted = await deleteJson(port, '/api/session-annotations', {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\Project:codex-mini'
    });
    assert.equal(deleted.deleted, 1);

    const cleared = await getJson(port, '/api/data');
    assert.equal(cleared.sessions[0].projectAlias, null);
    assert.equal(cleared.sessions[0].taskType, '未分类');
    assert.equal(cleared.sessions[0].outputStatus, '未标注');
    assert.equal(cleared.sessions[0].workPurpose, '未说明');
    assert.equal(cleared.sessions[0].workStage, '未说明');
    assert.equal(cleared.sessions[0].valueLevel, '未评估');
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertDaily(db, {
      device: 'devbox',
      source: 'Codex CLI',
      usageDate: '2026-06-10',
      model: 'codex-mini',
      inputTokens: 100,
      outputTokens: 30,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 165,
      costUSD: 0.01
    });
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\Project:codex-mini',
      lastActivity: '2026-06-10T01:00:00.000Z',
      projectPath: 'D:\\Project',
      inputTokens: 100,
      outputTokens: 30,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 165,
      costUSD: 0.01
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

