import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  openDb,
  upsertDaily,
  upsertProjectAliasRule,
  upsertSession,
  upsertSessionOutput
} from '../src/db.mjs';
import { removeTempDir } from '../test-support/fs.mjs';
import { startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.mjs';

test('evidence suggestion API builds and applies selected high-confidence evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-evidence-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedDb(dbPath);
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server);

    const planResponse = await getJson(port, '/api/evidence-suggestions?period=all');
    assert.equal(planResponse.ok, true);
    assert.equal(planResponse.plan.period, 'all');
    assert.equal(planResponse.plan.privacy.includes('Prompt'), true);
    assert.equal(JSON.stringify(planResponse).includes('D:\\HighROIProjects\\token-work'), false);
    const annotation = planResponse.plan.suggestions.find(item => item.kind === 'annotation' && item.canApply);
    assert.ok(annotation, 'expected an applicable annotation suggestion');
    assert.equal(annotation.suggestedValues.taskType, '功能开发');

    await assertRejectsWithStatus(
      fetch(`http://127.0.0.1:${port}/api/evidence-suggestions/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ suggestionIds: [annotation.suggestionId] })
      }),
      415
    );

    await assertRejectsWithStatus(
      fetch(`http://127.0.0.1:${port}/api/evidence-suggestions/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://evil.example'
        },
        body: JSON.stringify({ suggestionIds: [annotation.suggestionId] })
      }),
      403
    );

    const applied = await postJson(port, '/api/evidence-suggestions/apply', {
      period: 'all',
      suggestionIds: [annotation.suggestionId]
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.appliedAnnotations, 1);
    assert.equal(applied.appliedOutputs, 0);

    const data = await getJson(port, '/api/data');
    assert.equal(data.sessions[0].projectAlias, 'Token Work');
    assert.equal(data.sessions[0].taskType, '功能开发');
    assert.equal(data.sessions[0].annotationSource, 'auto');
    assert.equal(data.sessions[0].annotationConfidence >= 80, true);
  } finally {
    await stopTestServer(server.child);
    await removeTempDir(dir);
  }
});

function seedDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertProjectAliasRule(db, {
      pattern: 'D:\\HighROIProjects\\token-work',
      matchType: 'prefix',
      projectAlias: 'Token Work',
      enabled: true
    });
    upsertDaily(db, {
      device: 'devbox',
      source: 'Codex CLI',
      usageDate: '2026-06-18',
      model: 'gpt-5.5',
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 10,
      totalTokens: 1210,
      costUSD: 0.5
    });
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\HighROIProjects\\token-work:gpt-5.5',
      lastActivity: '2026-06-18T10:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\token-work',
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 10,
      totalTokens: 1210,
      costUSD: 0.5
    });
    upsertSessionOutput(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\HighROIProjects\\token-work:gpt-5.5',
      outputUrl: 'https://github.com/codelishang/token-work-roi/commit/abcdef1234567890',
      outputLabel: 'token-work abcdef12',
      outputType: 'commit'
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

async function assertRejectsWithStatus(responsePromise, expectedStatus) {
  const response = await responsePromise;
  assert.equal(response.status, expectedStatus, await response.text());
}

