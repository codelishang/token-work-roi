import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCcusageImport, ccusageImportWouldChange, parseCcusageJsonText, planCcusageImport } from '../src/ccusage-import.ts';
import { openDb } from '../src/db.ts';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-ccusage-'));
  return openDb(join(dir, 'usage.sqlite'));
}

test('ccusage import supports documented daily and project daily shapes', () => {
  const daily = planCcusageImport({
    daily: [{
      date: '2026-06-17',
      modelsUsed: ['<synthetic>'],
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 300,
      totalTokens: 1500,
      totalCost: 99
    }]
  }, { device: 'test-device', now: new Date('2026-06-17T10:00:00Z') });

  assert.equal(daily.detectedShape, 'daily');
  assert.equal(daily.daily.length, 1);
  assert.equal(daily.sessions.length, 1);
  assert.equal(daily.daily[0].costUSD < 99, true);
  assert.equal(daily.warnings[0].type, 'ignored-imported-cost');

  const projectDaily = planCcusageImport({
    projects: {
      'token-work-roi': [{
        date: '2026-06-17',
        modelsUsed: ['claude-sonnet-4'],
        inputTokens: 500,
        outputTokens: 100
      }]
    }
  }, { device: 'test-device' });

  assert.equal(projectDaily.detectedShape, 'project-daily');
  assert.equal(projectDaily.sessions[0].projectPath, 'token-work-roi');
});

test('ccusage import supports session, blocks and monthly reports', () => {
  for (const payload of [
    {
      type: 'session',
      data: [{ session: 's1', models: ['gpt-5.3-codex'], inputTokens: 100, outputTokens: 20, firstActivity: '2026-06-17T01:00:00Z', lastActivity: '2026-06-17T02:00:00Z' }]
    },
    {
      type: 'blocks',
      data: [{ blockStart: '2026-06-17T01:00:00Z', blockEnd: '2026-06-17T02:00:00Z', models: ['gpt-5.3-codex'], inputTokens: 100, outputTokens: 20 }]
    },
    {
      type: 'monthly',
      data: [{ month: '2026-06', models: ['gpt-5.3-codex'], inputTokens: 100, outputTokens: 20 }]
    }
  ]) {
    const plan = planCcusageImport(payload, { device: 'test-device' });
    assert.equal(plan.daily.length, 1);
    assert.equal(plan.sessions.length, 1);
    assert.equal(plan.tokenEvents.length, 1);
  }
});

test('ccusage import supports top-level session report with npx preamble', () => {
  const payload = parseCcusageJsonText(`[npm] notice
Need to install the following packages:
ccusage@20.0.14
Ok to proceed? (y)
{
  "session": [
    {
      "agent": "codex",
      "period": "2026/05/22/rollout-test",
      "inputTokens": 100,
      "outputTokens": 20,
      "cacheReadTokens": 30,
      "metadata": {
        "lastActivity": "2026-06-01T06:14:32.011Z",
        "reasoningOutputTokens": 5
      },
      "modelsUsed": ["gpt-5.5"],
      "modelBreakdowns": [
        {
          "modelName": "gpt-5.5",
          "inputTokens": 100,
          "outputTokens": 20,
          "cacheReadTokens": 30
        }
      ],
      "totalTokens": 155
    }
  ]
}`);
  const plan = planCcusageImport(payload, { device: 'other-device' });

  assert.equal(plan.detectedShape, 'session');
  assert.equal(plan.daily.length, 1);
  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.tokenEvents.length, 1);
  assert.equal(plan.daily[0].device, 'other-device');
  assert.equal(plan.daily[0].source, 'codex');
  assert.equal(plan.daily[0].usageDate, '2026-06-01');
  assert.equal(plan.sessions[0].sessionId, '2026/05/22/rollout-test');
  assert.equal(plan.tokenEvents[0].reasoningTokens, 5);
});

test('ccusage apply is idempotent and dry-run plans do not write', () => {
  const db = tempDb();
  const payload = {
    type: 'session',
    data: [{ session: 's1', models: ['gpt-5.3-codex'], inputTokens: 100, outputTokens: 20, lastActivity: '2026-06-17T02:00:00Z' }]
  };
  const plan = planCcusageImport(payload, { device: 'test-device' });

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM session_usage').get().count, 0);
  assert.equal(ccusageImportWouldChange(db, plan), true);
  applyCcusageImport(db, plan);
  assert.equal(ccusageImportWouldChange(db, plan), false);
  applyCcusageImport(db, plan);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_usage').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM session_usage').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM token_events').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM collection_runs WHERE source = ?').get('import:ccusage-json').count, 2);
  db.close();
});

test('ccusage parser rejects conversation-like fields', () => {
  assert.throws(() => parseCcusageJsonText(JSON.stringify({
    type: 'session',
    data: [{ session: 's1', prompt: 'do not ingest', inputTokens: 1 }]
  })), /conversation-like field/);
});
