import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb, recordRun, upsertSession, upsertTokenEvent } from '../src/db.mjs';
import { startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.mjs';

test('read APIs expose coverage bridge and evidence flywheel safely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-api-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedDb(dbPath);
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server);
    const data = await getJson(port, '/api/data');
    assert.ok(data.meta.coverageBridge);
    assert.ok(data.meta.evidenceFlywheel);
    assert.ok(data.meta.localTrust);
    assert.ok(data.meta.localTrust.conclusion);
    assert.ok(data.meta.evidenceFlywheel.quality);
    assert.ok(Array.isArray(data.meta.evidenceFlywheel.queues.confirmationDrafts));
    assert.equal(JSON.stringify(data.meta.evidenceFlywheel).includes('D:\\HighROIProjects\\secret-project'), false);
    assert.equal(JSON.stringify(data.meta.localTrust).includes('D:\\HighROIProjects\\secret-project'), false);

    const coverage = await getJson(port, '/api/coverage-bridge');
    assert.equal(coverage.ok, true);
    assert.ok(coverage.coverageBridge.summary.totalSources >= 1);
    assert.ok('successfulCoverage' in coverage.coverageBridge.summary);

    const flywheel = await getJson(port, '/api/evidence-flywheel?period=all');
    assert.equal(flywheel.ok, true);
    assert.equal(flywheel.flywheel.totals.sessionCount, 1);
    assert.equal(JSON.stringify(flywheel).includes('D:\\HighROIProjects\\secret-project'), false);

    const localTrust = await getJson(port, '/api/local-trust');
    assert.equal(localTrust.ok, true);
    assert.ok(localTrust.localTrust.conclusion);
    assert.equal(JSON.stringify(localTrust).includes('D:\\HighROIProjects\\secret-project'), false);

    const samples = await getJson(port, '/api/local-trust/samples?source=codex');
    assert.equal(samples.ok, true);
    assert.ok(Array.isArray(samples.samples));
    assert.equal(JSON.stringify(samples).includes('D:\\HighROIProjects\\secret-project'), false);
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:secret-project:gpt-5.5',
      lastActivity: '2026-06-18T10:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\secret-project',
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 1200,
      costUSD: 1
    });
    upsertTokenEvent(db, {
      eventId: 'codex-secret-e1',
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:secret-project:gpt-5.5',
      timestamp: '2026-06-18T10:00:00.000Z',
      model: 'gpt-5.5',
      inputTokens: 1000,
      outputTokens: 200
    });
    recordRun(db, {
      device: 'devbox',
      source: 'Codex CLI',
      status: 'ok',
      message: 'daily=1, sessions=1, token_events=1; candidate_files=1; usable_records=1',
      collectedAt: '2026-06-18T10:05:00.000Z'
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

