import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDb, recordRun, upsertSession, upsertTokenEvent } from '../src/db.mjs';
import { startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.mjs';

test('source health API returns safe coverage metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-source-health-api-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedDb(dbPath);
  const server = startTestServer({ dbPath, env: { TOKEN_WORK_DEMO_MODE: '1' } });

  try {
    const port = await waitForTestServer(server, { path: '/api/source-health' });
    const health = await getJson(port, '/api/source-health');
    const codex = health.sources.find(row => row.id === 'codex');
    assert.equal(codex.health, 'has-data');
    assert.equal(codex.sessions, 1);
    assert.equal(codex.readsConversationContent, false);

    const ccusage = health.sources.find(row => row.id === 'ccusage');
    assert.equal(ccusage.coverageTier, 'ccusage import-bridge');
    assert.equal(ccusage.tokenEvents, 1);
    assert.match(ccusage.commandHint, /npx token-work import-usage/);
    assert.doesNotMatch(JSON.stringify(health), /C:\\\\Users|prompt|response|transcript|diff/);

    const data = await getJson(port, '/api/data');
    assert.ok(data.meta.sourceHealth.some(row => row.id === 'codex'));
    assert.equal(data.meta.projectCoverage.sessionCount, 1);
    assert.equal(data.meta.projectCoverage.projectCount, 1);
    assert.equal(data.meta.projectCoverage.pendingSessionCount, 1);
    assert.equal(data.meta.reviewWorkflow.pendingSessionCount, 1);
    assert.equal(data.meta.reviewWorkflow.openAdvisorActionCount, 0);

    const coverage = await getJson(port, '/api/collection-coverage');
    assert.equal(coverage.demoMode, true);
    assert.equal(coverage.sources[0].coverageRisk, 'demo-data');
    assert.doesNotMatch(JSON.stringify(coverage), /C:\\\\Users|prompt|response|transcript|diff/);

    const collectResponse = await fetch(`http://127.0.0.1:${port}/api/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(collectResponse.status, 400);
    assert.match(await collectResponse.text(), /Demo Mode/);
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data API labels real aggregate-only databases as not event verified', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-data-mode-aggregate-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedAggregateDb(dbPath);
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server, { path: '/api/source-health' });
    const data = await getJson(port, '/api/data');
    assert.equal(data.meta.demoMode, false);
    assert.equal(data.meta.dataMode.id, 'real-aggregate-only');
    assert.equal(data.meta.runtime.counts.sessionRows, 1);
    assert.equal(data.meta.runtime.counts.tokenEventRows, 0);
    assert.equal(data.meta.runtime.collectionCoverageAvailable, true);
    assert.doesNotMatch(JSON.stringify(data.meta.runtime), /C:\\\\Users|D:\\\\HighROIProjects|prompt|response|transcript|diff/);
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data API labels event rows without a verified run as needing coverage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-data-mode-event-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedEventDb(dbPath, { verifiedRun: false });
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server, { path: '/api/source-health' });
    const data = await getJson(port, '/api/data');
    assert.equal(data.meta.demoMode, false);
    assert.equal(data.meta.dataMode.id, 'real-event-unverified');
    assert.equal(data.meta.runtime.counts.tokenEventRows, 1);
    assert.equal(data.meta.runtime.db.kind, 'real sqlite');
    assert.equal(data.meta.runtime.db.fileName, 'usage.sqlite');
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data API labels verified event-level databases as event verified', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-data-mode-event-verified-'));
  const dbPath = join(dir, 'usage.sqlite');
  seedEventDb(dbPath, { verifiedRun: true });
  const server = startTestServer({ dbPath });

  try {
    const port = await waitForTestServer(server, { path: '/api/source-health' });
    const data = await getJson(port, '/api/data');
    assert.equal(data.meta.demoMode, false);
    assert.equal(data.meta.dataMode.id, 'real-event-verified');
    assert.equal(data.meta.runtime.counts.tokenEventRows, 1);
    assert.equal(data.meta.runtime.db.kind, 'real sqlite');
    assert.equal(data.meta.runtime.db.fileName, 'usage.sqlite');
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedDb(dbPath) {
  seedEventDb(dbPath, { verifiedRun: true });
}

function seedEventDb(dbPath, { verifiedRun }) {
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'codex-s1',
      lastActivity: '2026-06-17T02:00:00Z',
      projectPath: 'D:\\HighROIProjects\\TokenWork',
      model: 'gpt-5.3-codex',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    });
    upsertTokenEvent(db, {
      eventId: 'ccusage-import-e1',
      device: 'devbox',
      source: 'import:ccusage-cli',
      sessionId: 'import-s1',
      timestamp: '2026-06-17T03:00:00Z',
      model: 'claude-sonnet-4-5',
      inputTokens: 200,
      outputTokens: 40
    });
    recordRun(db, {
      device: 'devbox',
      source: 'import:ccusage-cli',
      status: 'ok',
      message: verifiedRun ? 'daily=1, sessions=1, token_events=1; candidate_files=1; usable_records=1' : null,
      collectedAt: '2026-06-17T03:05:00Z'
    });
  } finally {
    db.close();
  }
}

function seedAggregateDb(dbPath) {
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'codex-aggregate-only',
      lastActivity: '2026-06-17T02:00:00Z',
      projectPath: 'TokenWork',
      model: 'gpt-5.3-codex',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
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

