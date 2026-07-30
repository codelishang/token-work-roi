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
  assert.equal(plan.daily[0].source, 'Codex');
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

test('ccusage migrates legacy generic Codex rows without duplicating imported usage', () => {
  const db = tempDb();
  const payload = {
    type: 'session',
    data: [{
      agent: 'codex',
      session: 'legacy-session',
      models: ['gpt-5.5'],
      inputTokens: 100,
      outputTokens: 20,
      lastActivity: '2026-06-17T02:00:00Z'
    }]
  };
  const plan = planCcusageImport(payload, { device: 'other-device' });
  const daily = plan.daily[0];
  const session = plan.sessions[0];
  const event = plan.tokenEvents[0];
  const legacyEventId = event.eventId.replace(/^(ccusage:[^:]+:)[^:]+:/, '$1codex:');
  try {
    db.prepare(`
      INSERT INTO daily_usage (device, source, usage_date, model, input_tokens, output_tokens, total_tokens, cost_usd)
      VALUES (?, 'codex', ?, ?, ?, ?, ?, ?)
    `).run(daily.device, daily.usageDate, daily.model, daily.inputTokens, daily.outputTokens, daily.totalTokens, daily.costUSD);
    db.prepare(`
      INSERT INTO session_usage (device, source, session_id, last_activity, model, input_tokens, output_tokens, total_tokens, cost_usd)
      VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?)
    `).run(session.device, session.sessionId, session.lastActivity, session.model, session.inputTokens, session.outputTokens, session.totalTokens, session.costUSD);
    db.prepare(`
      INSERT INTO token_events (event_id, device, source, session_id, timestamp, model, input_tokens, output_tokens)
      VALUES (?, ?, 'codex', ?, ?, ?, ?, ?)
    `).run(legacyEventId, event.device, event.sessionId, event.timestamp, event.model, event.inputTokens, event.outputTokens);

    applyCcusageImport(db, plan);
    applyCcusageImport(db, plan);

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'codex'`).get().count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'Codex'`).get().count, 1);
    assert.equal(db.prepare(`SELECT total_tokens AS totalTokens FROM daily_usage WHERE source = 'Codex'`).get().totalTokens, 120);
    assert.equal(db.prepare(`SELECT total_tokens AS totalTokens FROM session_usage WHERE source = 'Codex'`).get().totalTokens, 120);
  } finally {
    db.close();
  }
});

test('ccusage migration does not rewrite unrelated legacy Codex imports on the same device', () => {
  const db = tempDb();
  const plan = planCcusageImport({
    type: 'session',
    data: [{ agent: 'codex', session: 'selected', models: ['gpt-5.5'], inputTokens: 10, lastActivity: '2026-06-17T02:00:00Z' }]
  }, { device: 'shared-device' });
  try {
    db.prepare(`
      INSERT INTO token_events (event_id, device, source, session_id, timestamp, model, input_tokens)
      VALUES ('ccusage:session:codex-unidentified-client:2026-06-18:unrelated:gpt-5.5:2026-06-18T02:00:00.000Z', ?, 'Codex (unidentified client)', 'unrelated', '2026-06-18T02:00:00.000Z', 'gpt-5.5', 99)
    `).run('shared-device');

    applyCcusageImport(db, plan);

    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM token_events
      WHERE device = 'shared-device' AND source = 'Codex (unidentified client)' AND session_id = 'unrelated'
    `).get().count, 1);
  } finally {
    db.close();
  }
});

test('ccusage migration preserves labels attached to legacy unidentified sessions', () => {
  const db = tempDb();
  const plan = planCcusageImport({
    type: 'session',
    data: [{ agent: 'codex', session: 'selected', models: ['gpt-5.5'], inputTokens: 10, lastActivity: '2026-06-17T02:00:00Z' }]
  }, { device: 'shared-device' });
  const daily = plan.daily[0];
  const session = plan.sessions[0];
  const event = plan.tokenEvents[0];
  const legacyEventId = event.eventId.replace(':codex:', ':codex-unidentified-client:');
  try {
    db.prepare(`INSERT INTO daily_usage (device, source, usage_date, model, total_tokens) VALUES (?, 'codex', ?, ?, ?)`)
      .run(daily.device, daily.usageDate, daily.model, daily.totalTokens);
    db.prepare(`INSERT INTO daily_usage (device, source, usage_date, model, total_tokens) VALUES (?, ?, ?, ?, ?)`)
      .run(daily.device, 'Codex (unidentified client)', daily.usageDate, daily.model, daily.totalTokens);
    db.prepare(`INSERT INTO session_usage (device, source, session_id, model, total_tokens) VALUES (?, 'codex', ?, ?, ?)`)
      .run(session.device, session.sessionId, session.model, session.totalTokens);
    db.prepare(`INSERT INTO session_usage (device, source, session_id, model, total_tokens) VALUES (?, ?, ?, ?, ?)`)
      .run(session.device, 'Codex (unidentified client)', session.sessionId, session.model, session.totalTokens);
    db.prepare(`INSERT INTO session_annotations (device, source, session_id, note, updated_at) VALUES (?, 'codex', ?, 'newest', '2026-06-17 03:00:00')`)
      .run(session.device, session.sessionId);
    db.prepare(`INSERT INTO session_annotations (device, source, session_id, note, updated_at) VALUES (?, ?, ?, ?, '2026-06-17T02:00:00Z')`)
      .run(session.device, 'Codex (unidentified client)', session.sessionId, 'keep');
    db.prepare(`
      INSERT INTO token_events (event_id, device, source, session_id, timestamp, model, input_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(legacyEventId, event.device, 'Codex (unidentified client)', event.sessionId, event.timestamp, event.model, event.inputTokens);

    assert.equal(ccusageImportWouldChange(db, plan), true);
    applyCcusageImport(db, plan);

    assert.equal(db.prepare(`SELECT note FROM session_annotations WHERE device = ? AND source = 'Codex' AND session_id = ?`)
      .get(session.device, session.sessionId).note, 'newest');
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM daily_usage WHERE device = ? AND source = 'Codex' AND usage_date = ? AND model = ?`)
      .get(daily.device, daily.usageDate, daily.model).count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE event_id = ? AND source = 'Codex'`)
      .get(event.eventId).count, 1);
  } finally {
    db.close();
  }
});

test('ccusage migration ignores non-Codex rows in mixed-source reports', () => {
  const db = tempDb();
  const plan = planCcusageImport({
    type: 'session',
    data: [
      { agent: 'codex', session: 'codex-session', models: ['gpt-5.5'], inputTokens: 10, lastActivity: '2026-06-17T01:00:00Z' },
      { agent: 'claude', session: 'claude-session', models: ['claude-sonnet-4'], inputTokens: 20, lastActivity: '2026-06-18T01:00:00Z' }
    ]
  }, { device: 'mixed-device' });
  const claudeDaily = plan.daily.find(row => row.source === 'claude');
  const claudeSession = plan.sessions.find(row => row.source === 'claude');
  try {
    db.prepare(`INSERT INTO daily_usage (device, source, usage_date, model, total_tokens) VALUES (?, 'codex', ?, ?, 20)`)
      .run('mixed-device', claudeDaily.usageDate, claudeDaily.model);
    db.prepare(`INSERT INTO session_usage (device, source, session_id, model, total_tokens) VALUES (?, 'codex', ?, ?, 20)`)
      .run('mixed-device', claudeSession.sessionId, claudeSession.model);

    applyCcusageImport(db, plan);

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM daily_usage WHERE device = 'mixed-device' AND source = 'codex' AND model = ?`)
      .get(claudeDaily.model).count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM session_usage WHERE device = 'mixed-device' AND source = 'codex' AND session_id = ?`)
      .get(claudeSession.sessionId).count, 1);
  } finally {
    db.close();
  }
});

test('ccusage migration preserves another device when canonical event ids collide', () => {
  const db = tempDb();
  const plan = planCcusageImport({
    type: 'session',
    data: [{ agent: 'codex', session: 'shared-session', models: ['gpt-5.5'], inputTokens: 10, lastActivity: '2026-06-17T01:00:00Z' }]
  }, { device: 'new-device' });
  const event = plan.tokenEvents[0];
  const legacyEventId = event.eventId.replace(':codex:', ':codex-unidentified-client:');
  try {
    db.prepare(`
      INSERT INTO token_events (event_id, device, source, session_id, timestamp, model, input_tokens)
      VALUES (?, 'existing-device', 'Codex', 'shared-session', ?, 'gpt-5.5', 30)
    `).run(event.eventId, event.timestamp);
    db.prepare(`
      INSERT INTO token_events (event_id, device, source, session_id, timestamp, model, input_tokens)
      VALUES (?, 'new-device', 'Codex (unidentified client)', 'shared-session', ?, 'gpt-5.5', 10)
    `).run(legacyEventId, event.timestamp);

    applyCcusageImport(db, plan);
    applyCcusageImport(db, plan);

    assert.equal(db.prepare(`SELECT input_tokens AS inputTokens FROM token_events WHERE event_id = ? AND device = 'existing-device'`)
      .get(event.eventId).inputTokens, 30);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE device = 'new-device' AND source = 'Codex'`)
      .get().count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE device = 'new-device' AND source = 'Codex (unidentified client)'`)
      .get().count, 0);
    assert.equal(ccusageImportWouldChange(db, plan), false);
  } finally {
    db.close();
  }
});

test('ccusage parser rejects conversation-like fields', () => {
  assert.throws(() => parseCcusageJsonText(JSON.stringify({
    type: 'session',
    data: [{ session: 's1', prompt: 'do not ingest', inputTokens: 1 }]
  })), /conversation-like field/);
});
