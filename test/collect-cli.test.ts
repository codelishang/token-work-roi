import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { ProcessResult } from '../test-support/process.ts';
import { localDateFromTimestamp } from '../src/collectors/utils.ts';

interface CollectSourceSummary {
  id: string;
  candidateFiles: number;
  usableTokenRecords: number;
  sessionRows: number;
  tokenEvents: number;
  coverageRisk: string;
  reconciliation: {
    dailyVsEventDiffPct: number;
    sessionVsEventDiffPct: number;
  };
}

test('collect refuses to run without explicit dry-run or apply mode', async () => {
  const dir = tempDir();
  const dbPath = join(dir, 'usage.sqlite');
  try {
    const result = await runNode(['src/collect.ts', '--sources=claude', '--db', dbPath, '--json']);
    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}${result.stderr}`, /--dry-run or --apply/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collect does not treat false boolean arguments as write confirmation', async () => {
  const result = await runNode(['src/collect.ts', '--apply', '--yes=false', '--json']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /requires --yes/);
});

test('collect apply rejects a second writer for the same SQLite database', async () => {
  const fixture = createCollectorFixture();
  const lockPath = `${fixture.dbPath}.collect.lock`;
  const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
    windowsHide: true
  });
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: owner.pid, startedAt: new Date().toISOString() }));
    const result = await runNode([
      'src/collect.ts',
      '--sources=claude',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], fixture.env);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /already running for this SQLite database/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    if (owner.exitCode == null) owner.kill('SIGKILL');
    cleanupFixture(fixture);
  }
});

test('collector dates always use China Standard Time', () => {
  assert.equal(localDateFromTimestamp('2026-06-17T15:59:59.999Z'), '2026-06-17');
  assert.equal(localDateFromTimestamp('2026-06-17T16:00:00.000Z'), '2026-06-18');
});

test('collect dry-run scans fixtures and does not write SQLite', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=claude,codex,cursor',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.mode, 'dry-run');
    assert.equal(summary.before, null);
    assert.equal(summary.after, null);
    assert.equal(existsSync(fixture.dbPath), false);

    const byId = new Map<string, CollectSourceSummary>(summary.sources.map((row: CollectSourceSummary) => [row.id, row]));
    assert.equal(byId.get('claude').candidateFiles, 2);
    assert.equal(byId.get('claude').usableTokenRecords, 3);
    assert.equal(byId.get('claude').sessionRows, 3);
    assert.equal(byId.get('claude').tokenEvents, 3);
    assert.equal(byId.get('claude').coverageRisk, 'trusted-event-level');
    assert.equal(byId.get('codex').candidateFiles, 1);
    assert.equal(byId.get('codex').usableTokenRecords, 2);
    assert.equal(byId.get('codex').coverageRisk, 'trusted-event-level');
    assert.equal(byId.get('cursor').candidateFiles, 1);
    assert.equal(byId.get('cursor').usableTokenRecords, 1);
    assert.ok(summary.totals.sessionRows >= 4);
    assert.ok(summary.totals.tokenEvents >= 4);
    assert.equal(summary.totals.dailyTotalTokens, summary.totals.sessionTotalTokens);
    assert.equal(summary.totals.sessionTotalTokens, summary.totals.eventTotalTokens);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect replaces transient WorkBuddy event identities without adding tokens twice', async () => {
  const fixture = createWorkBuddyIdentityFixture();
  try {
    const first = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const db = new DatabaseSync(fixture.dbPath);
    try {
      const event = db.prepare(`
        SELECT timestamp, input_tokens AS inputTokens, output_tokens AS outputTokens,
          cache_read_tokens AS cacheReadTokens, cache_creation_tokens AS cacheCreationTokens,
          reasoning_tokens AS reasoningTokens
        FROM token_events
        WHERE source = 'WorkBuddy'
      `).get();
      db.prepare(`
        INSERT INTO token_events (
          event_id, device, source, session_id, timestamp, model,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          reasoning_tokens, privacy_level, updated_at
        ) VALUES (?, ?, 'WorkBuddy', 'transient-session', ?, 'auto', ?, ?, ?, ?, ?, 'safe', datetime('now'))
      `).run(
        'workbuddy:legacy-fixture', fixture.device, event.timestamp,
        event.inputTokens, event.outputTokens, event.cacheReadTokens,
        event.cacheCreationTokens, event.reasoningTokens
      );
    } finally {
      db.close();
    }

    const second = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(second.code, 0, second.stderr);

    const verified = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(verified.prepare(`
        SELECT session_id AS sessionId, model,
          input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens + reasoning_tokens AS totalTokens
        FROM token_events WHERE source = 'WorkBuddy'
      `).all().map(row => ({ ...row })), [{
        sessionId: 'workbuddy:trace_fixture_identity', model: 'glm-5.2', totalTokens: 120
      }]);
      assert.deepEqual(verified.prepare(`
        SELECT total_tokens AS totalTokens FROM daily_usage WHERE source = 'WorkBuddy'
      `).all().map(row => ({ ...row })), [{ totalTokens: 120 }]);
    } finally {
      verified.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('WorkBuddy model correction rebuilds the affected daily usage', async () => {
  const fixture = createWorkBuddyIdentityFixture();
  try {
    const first = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const trace = JSON.parse(readFileSync(fixture.tracePath, 'utf8'));
    trace.trace.modelInfo.models = ['hy3-x'];
    writeFileSync(fixture.tracePath, JSON.stringify(trace), 'utf8');

    const refreshed = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' });
    assert.equal(refreshed.code, 0, refreshed.stderr);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(db.prepare(`
        SELECT model, total_tokens AS totalTokens FROM daily_usage
        WHERE source = 'WorkBuddy'
      `).all().map(row => ({ ...row })), [{ model: 'hy3', totalTokens: 120 }]);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled WorkBuddy collection updates only changed traces without losing a similarly named trace', async () => {
  const fixture = createWorkBuddyIdentityFixture();
  try {
    const original = JSON.parse(readFileSync(fixture.tracePath, 'utf8'));
    const sibling = structuredClone(original);
    sibling.trace.traceId = 'trace_fixture_identity_extra';
    sibling.spans[0].spanId = 'span_fixture_identity_extra';
    writeFileSync(fixture.siblingTracePath, JSON.stringify(sibling), 'utf8');

    const first = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const oldTime = new Date(Date.now() - 60_000);
    utimesSync(fixture.tracePath, oldTime, oldTime);
    utimesSync(fixture.siblingTracePath, oldTime, oldTime);
    const scheduledEnv = {
      ...fixture.env,
      TOKEN_WORK_COLLECT_REASON: 'scheduled',
      TOKEN_WORK_SCHEDULED_INCREMENTAL: '1'
    };
    const unchanged = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], scheduledEnv);
    assert.equal(unchanged.code, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).sources[0].tokenEvents, 0);

    original.spans.push({
      ...original.spans[0],
      spanId: 'span_fixture_identity_second',
      startedAt: '2026-06-17T02:00:45.000Z'
    });
    writeFileSync(fixture.tracePath, JSON.stringify(original), 'utf8');

    const updated = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], scheduledEnv);
    assert.equal(updated.code, 0, updated.stderr);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(db.prepare(`
        SELECT session_id AS sessionId, COUNT(*) AS events, SUM(input_tokens + output_tokens + cache_read_tokens) AS totalTokens
        FROM token_events
        WHERE source = 'WorkBuddy'
        GROUP BY session_id
        ORDER BY session_id
      `).all().map(row => ({ ...row })), [
        { sessionId: 'workbuddy:trace_fixture_identity', events: 2, totalTokens: 240 },
        { sessionId: 'workbuddy:trace_fixture_identity_extra', events: 1, totalTokens: 120 }
      ]);
      assert.equal(db.prepare(`
        SELECT total_tokens AS totalTokens FROM daily_usage WHERE source = 'WorkBuddy'
      `).get().totalTokens, 360);
    } finally {
      db.close();
    }

    original.spans = [original.spans[1]];
    writeFileSync(fixture.tracePath, JSON.stringify(original), 'utf8');
    const removed = await runNode([
      'src/collect.ts', '--sources=workbuddy', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], scheduledEnv);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(JSON.parse(removed.stdout).backup?.fileName || '', /scheduled-collect-repair/);

    const repaired = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM token_events
        WHERE source = 'WorkBuddy' AND session_id = 'workbuddy:trace_fixture_identity'
      `).get().count, 1);
      assert.equal(repaired.prepare(`
        SELECT total_tokens AS totalTokens FROM daily_usage WHERE source = 'WorkBuddy'
      `).get().totalTokens, 240);
    } finally {
      repaired.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect does not recount token history copied into a forked Codex session', async () => {
  const fixture = createForkedCodexFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const codex = summary.sources.find((source: CollectSourceSummary) => source.id === 'codex');
    assert.equal(codex.tokenEvents, 3);
    assert.equal(codex.totalTokens, 170);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect reclassifies legacy Codex records when session metadata identifies the desktop client', async () => {
  const fixture = createCollectorFixture();
  const sessionPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'codex-session.jsonl');
  try {
    const first = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const lines = readFileSync(sessionPath, 'utf8').trim().split('\n');
    const metadata = JSON.parse(lines[0]);
    metadata.payload.originator = 'Codex Desktop';
    lines[0] = JSON.stringify(metadata);
    writeFileSync(sessionPath, `${lines.join('\n')}\n`, 'utf8');

    const second = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(second.code, 0, second.stderr);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(db.prepare(`
        SELECT source, COUNT(*) AS count
        FROM token_events
        WHERE session_id LIKE 'local:codex:%'
        GROUP BY source
      `).all().map(row => ({ ...row })), [{ source: 'Codex Desktop', count: 2 }]);
      assert.deepEqual(db.prepare(`
        SELECT source, COALESCE(SUM(total_tokens), 0) AS totalTokens
        FROM daily_usage
        WHERE source LIKE 'Codex%'
        GROUP BY source
      `).all().map(row => ({ ...row })), [{ source: 'Codex Desktop', totalTokens: 155 }]);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect reclassifies zero-token Codex sessions from session metadata', async () => {
  const fixture = createCollectorFixture();
  const emptySessionPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'desktop-empty.jsonl');
  try {
    writeFileSync(emptySessionPath, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'desktop-empty', originator: 'Codex Desktop' }
    }) + '\n', 'utf8');

    const first = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const db = new DatabaseSync(fixture.dbPath);
    try {
      db.prepare(`
        INSERT INTO session_usage (device, source, session_id, model, total_tokens)
        VALUES (?, ?, ?, ?, 0)
      `).run(hostname(), 'Codex (unidentified client)', 'local:codex:desktop-empty:gpt-5.4-mini', 'gpt-5.4-mini');
    } finally {
      db.close();
    }

    const second = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(second.code, 0, second.stderr);

    const repaired = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count
        FROM session_usage
        WHERE device = ? AND source = 'Codex Desktop' AND session_id = 'local:codex:desktop-empty:gpt-5.4-mini'
      `).get(hostname()).count, 1);
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count
        FROM session_usage
        WHERE device = ? AND source = 'Codex (unidentified client)' AND session_id = 'local:codex:desktop-empty:gpt-5.4-mini'
      `).get(hostname()).count, 0);
    } finally {
      repaired.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect removes local Codex daily rows without matching events or sessions', async () => {
  const fixture = createCollectorFixture();
  try {
    const first = await runNode(['src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'], fixture.env);
    assert.equal(first.code, 0, first.stderr);
    const db = new DatabaseSync(fixture.dbPath);
    try {
      db.prepare(`INSERT INTO daily_usage (device, source, usage_date, model, total_tokens) VALUES (?, ?, '2026-01-01', 'gpt-5.5', 777)`).run(
        hostname(), 'Codex (unidentified client)'
      );
    } finally { db.close(); }
    const second = await runNode(['src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'], fixture.env);
    assert.equal(second.code, 0, second.stderr);
    const repaired = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(repaired.prepare(`SELECT COUNT(*) AS count FROM daily_usage WHERE source = 'Codex (unidentified client)'`).get().count, 0);
    } finally { repaired.close(); }
  } finally { cleanupFixture(fixture); }
});

test('collect reconciles current Codex events while preserving historical usage', async () => {
  const fixture = createForkedCodexFixture();
  try {
    const first = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], fixture.env);
    assert.equal(first.code, 0, first.stderr);

    const db = new DatabaseSync(fixture.dbPath);
    try {
      db.prepare(`
        INSERT INTO token_events (
          event_id, device, source, session_id, timestamp, model, input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'legacy-fork-event',
        hostname(),
        'Codex CLI',
        'local:codex:child_1:gpt-5.4-mini',
        '2026-06-17T02:05:00.000Z',
        'gpt-5.4-mini',
        999
      );
      db.prepare(`
        INSERT INTO token_events (
          event_id, device, source, session_id, timestamp, model, input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'similarly-named-event',
        hostname(),
        'Codex CLI',
        'local:codex:childX1:gpt-5.4-mini',
        '2026-06-17T02:05:00.000Z',
        'gpt-5.4-mini',
        777
      );
      db.prepare(`
        INSERT INTO token_events (
          event_id, device, source, session_id, timestamp, model, input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'codex:stale-event',
        hostname(),
        'Codex CLI',
        'local:codex:parent:gpt-5.4-mini',
        '2026-06-17T02:05:00.000Z',
        'gpt-5.4-mini',
        999
      );
      db.prepare(`
        INSERT INTO token_events (
          event_id, device, source, session_id, timestamp, model, input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'codex:unscanned-event',
        hostname(),
        'Codex CLI',
        'local:codex:unscanned-session:gpt-5.4-mini',
        '2026-06-17T02:05:00.000Z',
        'gpt-5.4-mini',
        777
      );
      db.prepare(`
        INSERT INTO session_usage (device, source, session_id, model, total_tokens)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        hostname(),
        'Codex CLI',
        'local:codex:unscanned-session:gpt-5.4-mini',
        'gpt-5.4-mini',
        0
      );
      db.prepare(`
        INSERT INTO daily_usage (device, source, usage_date, model, total_tokens)
        VALUES (?, ?, ?, ?, ?)
      `).run(hostname(), 'Codex CLI', '2026-06-17', 'legacy-model', 999);
    } finally {
      db.close();
    }

    const second = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], fixture.env);
    assert.equal(second.code, 0, second.stderr);

    const repaired = new DatabaseSync(fixture.dbPath);
    try {
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM token_events WHERE event_id = 'legacy-fork-event'
      `).get().count, 0);
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM token_events WHERE event_id = 'similarly-named-event'
      `).get().count, 1);
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM token_events WHERE event_id = 'codex:stale-event'
      `).get().count, 0);
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM token_events WHERE event_id = 'codex:unscanned-event'
      `).get().count, 1);
      assert.equal(repaired.prepare(`
        SELECT total_tokens AS totalTokens FROM session_usage
        WHERE source = 'Codex (unidentified client)' AND session_id = 'local:codex:unscanned-session:gpt-5.4-mini'
      `).get().totalTokens, 777);
      assert.equal(repaired.prepare(`
        SELECT COUNT(*) AS count FROM daily_usage
        WHERE source = 'Codex CLI' AND usage_date = '2026-06-17' AND model = 'legacy-model'
      `).get().count, 0);
      assert.equal(repaired.prepare(`
        SELECT total_tokens AS totalTokens FROM daily_usage
        WHERE source = 'Codex CLI' AND usage_date = '2026-06-17' AND model = 'gpt-5.4-mini'
      `).get().totalTokens, 170);
    } finally {
      repaired.close();
    }

  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled Codex collection preserves unchanged session events', async () => {
  const fixture = createCollectorFixture();
  try {
    const unchangedPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'unchanged-session.jsonl');
    writeFileSync(unchangedPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'unchanged-session', originator: 'codex-tui' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T02:30:00.000Z',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 50 }, last_token_usage: { input_tokens: 50 } }
        }
      })
    ].join('\n'), 'utf8');
    const initial = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], {
      ...fixture.env,
      TOKEN_WORK_COLLECT_REASON: 'scheduled',
      TOKEN_WORK_SCHEDULED_INCREMENTAL: '1'
    });
    assert.equal(initial.code, 0, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).sources[0].candidateFiles, 2);
    const before = new DatabaseSync(fixture.dbPath, { readOnly: true });
    let eventCount;
    let unchangedDailyTotal;
    try {
      eventCount = before.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'Codex CLI'`).get().count;
      unchangedDailyTotal = before.prepare(`
        SELECT total_tokens AS totalTokens
        FROM daily_usage
        WHERE source = 'Codex CLI' AND usage_date = '2026-06-17' AND model = 'gpt-5.4-mini'
      `).get().totalTokens;
    } finally {
      before.close();
    }

    const codexPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'codex-session.jsonl');
    const refreshedAt = new Date(Date.now() + 1_000).toISOString();
    writeFileSync(codexPath, [
      readFileSync(codexPath, 'utf8').trim(),
      JSON.stringify({
        type: 'event_msg',
        timestamp: refreshedAt,
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 100 },
            last_token_usage: { input_tokens: 20 }
          }
        }
      })
    ].join('\n'), 'utf8');
    const refreshed = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], {
      ...fixture.env,
      TOKEN_WORK_COLLECT_REASON: 'scheduled',
      TOKEN_WORK_SCHEDULED_INCREMENTAL: '1'
    });
    assert.equal(refreshed.code, 0, refreshed.stderr);
    const changed = JSON.parse(refreshed.stdout);
    assert.equal(changed.sources[0].candidateFiles, 1);
    assert.equal(changed.sources[0].tokenEvents, 3);
    const after = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(after.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'Codex CLI'`).get().count, eventCount + 1);
      assert.equal(after.prepare(`
        SELECT COUNT(*) AS count FROM token_events
        WHERE source = 'Codex CLI' AND session_id LIKE 'local:codex:unchanged-session:%'
      `).get().count, 1);
      assert.equal(after.prepare(`
        SELECT total_tokens AS totalTokens
        FROM daily_usage
        WHERE source = 'Codex CLI' AND usage_date = '2026-06-17' AND model = 'gpt-5.4-mini'
      `).get().totalTokens, unchangedDailyTotal);
    } finally {
      after.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled Codex collection does not rescan an unchanged fork parent', async () => {
  const fixture = createCollectorFixture();
  try {
    const sessionsDir = join(fixture.codexHome, 'sessions', '2026', '06', '17');
    const parentId = 'parent-session';
    const childId = 'child-session';
    writeFileSync(join(sessionsDir, `${parentId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: parentId, originator: 'codex-tui' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T03:00:00.000Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20 }, last_token_usage: { input_tokens: 20 } } }
      })
    ].join('\n'), 'utf8');
    const childPath = join(sessionsDir, `${childId}.jsonl`);
    writeFileSync(childPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: childId, parent_thread_id: parentId, timestamp: '2026-06-17T03:00:00.000Z', originator: 'codex-tui' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T03:05:00.000Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 30 }, last_token_usage: { input_tokens: 10 } } }
      })
    ].join('\n'), 'utf8');

    const initial = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' });
    assert.equal(initial.code, 0, initial.stderr);

    const refreshedAt = new Date(Date.now() + 1_000).toISOString();
    writeFileSync(childPath, [
      readFileSync(childPath, 'utf8').trim(),
      JSON.stringify({
        type: 'event_msg',
        timestamp: refreshedAt,
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 40 }, last_token_usage: { input_tokens: 10 } } }
      })
    ].join('\n'), 'utf8');

    const refreshed = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' });
    assert.equal(refreshed.code, 0, refreshed.stderr);
    assert.equal(JSON.parse(refreshed.stdout).sources[0].candidateFiles, 1);
  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled Codex collection reclassifies a session without duplicating its usage', async () => {
  const fixture = createCollectorFixture();
  const sessionPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'codex-session.jsonl');
  const scheduledEnv = {
    ...fixture.env,
    TOKEN_WORK_COLLECT_REASON: 'scheduled',
    TOKEN_WORK_SCHEDULED_INCREMENTAL: '1'
  };
  try {
    const initial = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], scheduledEnv);
    assert.equal(initial.code, 0, initial.stderr);

    const lines = readFileSync(sessionPath, 'utf8').trim().split('\n');
    const metadata = JSON.parse(lines[0]);
    metadata.payload.originator = 'Codex Desktop';
    lines[0] = JSON.stringify(metadata);
    writeFileSync(sessionPath, `${lines.join('\n')}\n`, 'utf8');
    utimesSync(sessionPath, new Date(), new Date(Date.now() + 1_000));

    const refreshed = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], scheduledEnv);
    assert.equal(refreshed.code, 0, refreshed.stderr);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(db.prepare(`
        SELECT source, COALESCE(SUM(total_tokens), 0) AS totalTokens
        FROM daily_usage
        WHERE source LIKE 'Codex%'
        GROUP BY source
      `).all().map(row => ({ ...row })), [{ source: 'Codex Desktop', totalTokens: 155 }]);
      assert.equal(db.prepare(`
        SELECT COUNT(*) AS count FROM token_events WHERE source = 'Codex CLI'
      `).get().count, 0);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled Codex collection repairs known historical client metadata without rescanning transcripts', async () => {
  const fixture = createCollectorFixture();
  try {
    const initial = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(initial.code, 0, initial.stderr);

    const db = new DatabaseSync(fixture.dbPath);
    try {
      for (const table of ['token_events', 'session_usage', 'daily_usage']) {
        db.prepare(`UPDATE ${table} SET source = ? WHERE source = ?`).run('Codex (unidentified client)', 'Codex CLI');
      }
    } finally {
      db.close();
    }

    const refreshed = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], {
      ...fixture.env,
      TOKEN_WORK_COLLECT_REASON: 'scheduled',
      TOKEN_WORK_SCHEDULED_INCREMENTAL: '1'
    });
    assert.equal(refreshed.code, 0, refreshed.stderr);
    assert.equal(JSON.parse(refreshed.stdout).sources[0].candidateFiles, 0);

    const repaired = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(repaired.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'Codex (unidentified client)'`).get().count, 0);
      assert.equal(repaired.prepare(`
        SELECT total_tokens AS totalTokens FROM daily_usage
        WHERE source = 'Codex CLI' AND model = 'gpt-5.4-mini'
      `).get().totalTokens, 52);
    } finally {
      repaired.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('scheduled Codex collection reads only the changed tail of a large session', async () => {
  const fixture = createCollectorFixture();
  try {
    const sessionPath = join(fixture.codexHome, 'sessions', '2026', '06', '17', 'tail-session.jsonl');
    const padding = JSON.stringify({ type: 'note', payload: { text: 'x'.repeat(512) } });
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'tail-session', originator: 'codex-tui' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T04:00:00.000Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10 }, last_token_usage: { input_tokens: 10 } } }
      }),
      ...Array.from({ length: 8_500 }, () => padding)
    ].join('\n'), 'utf8');

    const initial = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' });
    assert.equal(initial.code, 0, initial.stderr);

    const refreshedAt = new Date(Date.now() + 1_000).toISOString();
    writeFileSync(sessionPath, [
      readFileSync(sessionPath, 'utf8').trim(),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: refreshedAt,
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 30 }, last_token_usage: { input_tokens: 20 } } }
      })
    ].join('\n'), 'utf8');

    const refreshed = await runNode([
      'src/collect.ts', '--sources=codex', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' });
    assert.equal(refreshed.code, 0, refreshed.stderr);
    assert.equal(JSON.parse(refreshed.stdout).sources[0].tokenEvents, 1);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare(`
        SELECT total_tokens AS totalTokens
        FROM session_usage
        WHERE source = 'Codex CLI' AND session_id = 'local:codex:tail-session:gpt-5.4-mini'
      `).get().totalTokens, 30);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect keeps distinct Codex and Claude events without relying on file position', async () => {
  const fixture = createCollectorFixture();
  try {
    writeFileSync(join(fixture.claudeRoot, 'projects', 'token-work', 'anonymous.jsonl'), [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-17T02:00:00.000Z',
        localRecordId: 'first',
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 11, output_tokens: 2 }
        }
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-17T02:00:00.000Z',
        localRecordId: 'second',
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 11, output_tokens: 2 }
        }
      })
    ].join('\n'), 'utf8');
    writeFileSync(join(fixture.codexHome, 'sessions', '2026', '06', '17', 'same-timestamp.jsonl'), [
      JSON.stringify({ type: 'session_meta', payload: { id: 'same-timestamp', originator: 'codex-tui' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T04:00:00.000Z',
        payload: {
          type: 'token_count', request_id: 'first',
          info: { total_token_usage: { input_tokens: 10 } }
        }
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T04:00:00.000Z',
        payload: {
          type: 'token_count', request_id: 'second',
          info: { total_token_usage: { input_tokens: 20 } }
        }
      })
    ].join('\n'), 'utf8');

    const result = await runNode([
      'src/collect.ts',
      '--sources=claude,codex',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);

    const db = new DatabaseSync(fixture.dbPath);
    try {
      const totals = db.prepare(`
        SELECT
          COUNT(*) AS eventCount,
          COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens + reasoning_tokens), 0) AS eventTokens
        FROM token_events
        WHERE source = 'Claude Code' AND session_id LIKE 'local:claude:anonymous:%'
      `).get();
      assert.equal(totals.eventCount, 2);
      assert.equal(totals.eventTokens, 26);
      const codex = db.prepare(`
        SELECT COUNT(*) AS eventCount, SUM(input_tokens) AS inputTokens
        FROM token_events
        WHERE source = 'Codex CLI' AND session_id LIKE 'local:codex:same-timestamp:%'
      `).get();
      assert.equal(codex.eventCount, 2);
      assert.equal(codex.inputTokens, 20);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect retains the request that follows a Codex counter reset', async () => {
  const fixture = createResettingCodexFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const codex = summary.sources.find((source: CollectSourceSummary) => source.id === 'codex');
    assert.equal(codex.tokenEvents, 3);
    assert.equal(codex.totalTokens, 170);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect keeps post-fork usage when the parent Codex transcript is unavailable', async () => {
  const fixture = createUnresolvedForkedCodexFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=codex',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const codex = summary.sources.find((source: CollectSourceSummary) => source.id === 'codex');
    assert.equal(codex.tokenEvents, 1);
    assert.equal(codex.totalTokens, 100);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect prefers an OpenClaw live transcript over its archived copy', async () => {
  const fixture = createOpenClawArchiveFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=openclaw',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const openclaw = summary.sources.find((source: CollectSourceSummary) => source.id === 'openclaw');
    assert.equal(openclaw.dailyTotalTokens, 10);
    assert.equal(openclaw.sessionTotalTokens, 10);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect retains distinct OpenClaw history from an archived transcript', async () => {
  const fixture = createOpenClawArchiveFixture({ includeArchivedHistory: true });
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=openclaw',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const openclaw = summary.sources.find((source: CollectSourceSummary) => source.id === 'openclaw');
    assert.equal(openclaw.dailyTotalTokens, 17);
    assert.equal(openclaw.sessionTotalTokens, 17);
  } finally {
    cleanupFixture(fixture);
  }
});

test('coverage command returns historical coverage risk and reconciliation', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/cli.ts',
      'coverage',
      '--sources=claude,codex,cursor',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const byId = new Map<string, CollectSourceSummary>(summary.sources.map((row: CollectSourceSummary) => [row.id, row]));
    assert.equal(byId.get('claude').coverageRisk, 'trusted-event-level');
    assert.equal(byId.get('codex').coverageRisk, 'trusted-event-level');
    assert.ok(byId.get('claude').reconciliation.dailyVsEventDiffPct <= 0.01);
    assert.ok(byId.get('codex').reconciliation.sessionVsEventDiffPct <= 0.01);
    assert.equal(summary.totals.fatalCoverageErrors, 0);
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect removes only unassociated zero-token Claude placeholders', async () => {
  const fixture = createCollectorFixture();
  try {
    const initial = await runNode([
      'src/collect.ts', '--sources=claude', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], fixture.env);
    assert.equal(initial.code, 0, initial.stderr);

    const device = hostname();
    const db = new DatabaseSync(fixture.dbPath);
    try {
      const insertSession = db.prepare(`
        INSERT INTO session_usage(device, source, session_id, model, input_tokens, total_tokens)
        VALUES (?, 'Claude Code', ?, '<synthetic>', ?, ?)
      `);
      insertSession.run(device, 'remove:<synthetic>', 0, 0);
      insertSession.run(device, 'keep-annotation:<synthetic>', 0, 0);
      insertSession.run(device, 'keep-usage:<synthetic>', 1, 1);
      insertSession.run(device, 'remove-event:<synthetic>', 0, 0);
      db.prepare(`
        INSERT INTO session_annotations(device, source, session_id)
        VALUES (?, 'Claude Code', 'keep-annotation:<synthetic>')
      `).run(device);
      db.prepare(`
        INSERT INTO token_events(event_id, device, source, session_id, timestamp, model)
        VALUES ('placeholder-event', ?, 'Claude Code', 'remove-event:<synthetic>', '2026-08-09T00:00:00Z', '<synthetic>')
      `).run(device);
      db.prepare(`
        INSERT INTO daily_usage(device, source, usage_date, model)
        VALUES (?, 'Claude Code', '2026-08-09', '<synthetic>')
      `).run(device);
    } finally {
      db.close();
    }

    const cleaned = await runNode([
      'src/collect.ts', '--sources=claude', '--db', fixture.dbPath, '--apply', '--yes', '--json'
    ], { ...fixture.env, TOKEN_WORK_COLLECT_REASON: 'scheduled' });
    assert.equal(cleaned.code, 0, cleaned.stderr);
    const summary = JSON.parse(cleaned.stdout);
    assert.match(summary.backup?.fileName || '', /scheduled-collect-repair/);

    const after = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.deepEqual(after.prepare(`
        SELECT session_id AS sessionId, total_tokens AS totalTokens
        FROM session_usage
        WHERE source = 'Claude Code' AND instr(session_id, '<synthetic>') > 0
        ORDER BY session_id
      `).all().map(row => ({ ...row })), [
        { sessionId: 'keep-annotation:<synthetic>', totalTokens: 0 },
        { sessionId: 'keep-usage:<synthetic>', totalTokens: 1 }
      ]);
      assert.equal(after.prepare(`SELECT COUNT(*) AS count FROM session_annotations WHERE session_id = 'keep-annotation:<synthetic>'`).get().count, 1);
      assert.equal(after.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE model = '<synthetic>'`).get().count, 0);
      assert.equal(after.prepare(`SELECT COUNT(*) AS count FROM daily_usage WHERE model = '<synthetic>'`).get().count, 0);
    } finally {
      after.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('collect apply writes temp SQLite with backup and before/after counts', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/collect.ts',
      '--sources=claude,codex,cursor',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.mode, 'apply');
    assert.equal(summary.before.sessionRows, 0);
    assert.ok(summary.after.sessionRows >= 3);
    assert.ok(summary.after.tokenEvents >= 1);
    assert.ok(summary.after.collectionRuns >= 3);
    assert.ok(summary.backup?.path);
    assert.equal(existsSync(summary.backup.path), true);

    const db = new DatabaseSync(fixture.dbPath);
    let legacyEventId;
    let eventCount;
    let runCount;
    try {
      assert.ok(Number(db.prepare('SELECT COUNT(*) AS count FROM session_usage').get().count) >= 3);
      assert.ok(Number(db.prepare('SELECT COUNT(*) AS count FROM token_events').get().count) >= 1);
      assert.ok(Number(db.prepare('SELECT COUNT(*) AS count FROM collection_runs').get().count) >= 3);
      const codexSessions = db.prepare(`
        SELECT session_id AS sessionId, model, total_tokens AS totalTokens
        FROM session_usage
        WHERE source = 'Codex CLI'
        ORDER BY model
      `).all();
      assert.deepEqual(codexSessions.map(row => [row.model, row.totalTokens]), [
        ['gpt-5.3-codex', 103],
        ['gpt-5.4-mini', 52]
      ]);
      const claudeSessions = db.prepare(`
        SELECT model, total_tokens AS totalTokens
        FROM session_usage
        WHERE source = 'Claude Code'
        ORDER BY model, total_tokens DESC
      `).all();
      assert.deepEqual(claudeSessions.map(row => [row.model, row.totalTokens]), [
        ['claude-opus-4-6', 72],
        ['claude-sonnet-4-5', 140],
        ['claude-sonnet-4-5', 81]
      ]);

      eventCount = db.prepare('SELECT COUNT(*) AS count FROM token_events').get().count;
      runCount = db.prepare('SELECT COUNT(*) AS count FROM collection_runs').get().count;
      const migratedEvent = db.prepare(`
        SELECT event_id AS eventId
        FROM token_events
        WHERE source = 'Codex CLI' AND model = 'gpt-5.4-mini'
      `).get();
      legacyEventId = codexEventId({
        sessionId: 'local:codex:codex-session:gpt-5.3-codex',
        timestamp: '2026-06-17T02:05:00.000Z',
        model: 'gpt-5.4-mini',
        tokens: { input: 40, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 2 },
        index: 1
      });
      assert.notEqual(migratedEvent.eventId, legacyEventId);
      db.prepare('UPDATE token_events SET event_id = ? WHERE event_id = ?').run(legacyEventId, migratedEvent.eventId);
    } finally {
      db.close();
    }

    const second = await runNode([
      'src/collect.ts',
      '--sources=claude,codex,cursor',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], { ...fixture.env, SCHEDULED_COLLECT_ENABLED: '1' });
    assert.equal(second.code, 0, second.stderr);
    const afterMigration = new DatabaseSync(fixture.dbPath);
    try {
      assert.equal(afterMigration.prepare('SELECT COUNT(*) AS count FROM token_events').get().count, eventCount);
      assert.equal(afterMigration.prepare('SELECT COUNT(*) AS count FROM collection_runs').get().count, runCount);
      assert.equal(afterMigration.prepare('SELECT COUNT(*) AS count FROM token_events WHERE event_id = ?').get(legacyEventId).count, 0);
      assert.equal(afterMigration.prepare(`
        SELECT COUNT(*) AS count FROM token_events
        WHERE source = 'Codex CLI' AND model = 'gpt-5.4-mini'
      `).get().count, 1);
      afterMigration.prepare(`
        UPDATE session_usage
        SET last_activity = '2026-07-19T12:00:00.000Z', cost_usd = 999
        WHERE source = 'Cursor'
      `).run();
      afterMigration.prepare('UPDATE daily_usage SET cost_usd = 999').run();
    } finally {
      afterMigration.close();
    }

    const backupDir = join(fixture.dir, 'backups');
    const existingBackups = readdirSync(backupDir).filter(name => name.endsWith('.sqlite'));
    assert.equal(existingBackups.length, 1);
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(join(backupDir, existingBackups[0]), oldTime, oldTime);

    const unchanged = await runNode([
      'src/collect.ts',
      '--sources=claude,codex,cursor',
      '--db',
      fixture.dbPath,
      '--apply',
      '--yes',
      '--json'
    ], { ...fixture.env, SCHEDULED_COLLECT_ENABLED: '1' });
    assert.equal(unchanged.code, 0, unchanged.stderr);
    const refreshed = JSON.parse(unchanged.stdout);
    assert.ok(refreshed.backup?.path, unchanged.stderr);
    assert.equal(existsSync(refreshed.backup.path), true);
    assert.equal(
      readdirSync(backupDir).filter(name => name.endsWith('-scheduled-collect.sqlite')).length,
      1
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('token-work collect wrapper defaults to dry-run-only writes when requested', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/cli.ts',
      'collect',
      '--sources=claude',
      '--db',
      fixture.dbPath,
      '--dry-run',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.mode, 'dry-run');
    assert.equal(existsSync(fixture.dbPath), false);
  } finally {
    cleanupFixture(fixture);
  }
});

function createCollectorFixture() {
  const dir = tempDir();
  const claudeRoot = join(dir, 'claude');
  const codexHome = join(dir, 'codex');
  const cursorRoot = join(dir, 'cursor');
  const cursorStorage = join(cursorRoot, 'User', 'globalStorage');
  mkdirSync(join(claudeRoot, 'projects', 'token-work'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions', '2026', '06', '17'), { recursive: true });
  mkdirSync(cursorStorage, { recursive: true });

  writeFileSync(join(claudeRoot, 'projects', 'token-work', 'claude-session.jsonl'), [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T01:00:00.000Z',
      requestId: 'req-1',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5
        }
      }
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T01:05:00.000Z',
      requestId: 'req-1-opus',
      message: {
        id: 'msg-1-opus',
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 50,
          output_tokens: 20,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 0
        }
      }
    })
  ].join('\n'), 'utf8');

  writeFileSync(join(claudeRoot, 'projects', 'token-work', 'claude-session-2.jsonl'), [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T01:30:00.000Z',
      requestId: 'req-2',
      message: {
        id: 'msg-2',
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 60,
          output_tokens: 15,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 2
        }
      }
    })
  ].join('\n'), 'utf8');

  writeFileSync(join(codexHome, 'sessions', '2026', '06', '17', 'codex-session.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-session', cwd: join(dir, 'repo'), originator: 'codex-tui' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.3-codex' } }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-06-17T02:00:00.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 80, output_tokens: 20, cached_input_tokens: 5, reasoning_output_tokens: 3 },
          total_token_usage: { input_tokens: 80, output_tokens: 20, cached_input_tokens: 5, reasoning_output_tokens: 3 }
        }
      }
    }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-06-17T02:05:00.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 40, output_tokens: 10, cached_input_tokens: 0, reasoning_output_tokens: 2 },
          total_token_usage: { input_tokens: 120, output_tokens: 30, cached_input_tokens: 5, reasoning_output_tokens: 5 }
        }
      }
    })
  ].join('\n'), 'utf8');

  const cursorDb = new DatabaseSync(join(cursorStorage, 'state.vscdb'));
  try {
    cursorDb.exec('CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    cursorDb.prepare('INSERT INTO cursorDiskKV(key, value) VALUES (?, ?)').run(
      'bubbleId:composer-1:bubble-1',
      JSON.stringify({
        conversationId: 'cursor-conversation-1',
        createdAt: '2026-06-17T03:00:00.000Z',
        modelInfo: { modelName: 'claude-sonnet-4-5' },
        tokenCount: {
          inputTokens: 120,
          outputTokens: 35
        }
      })
    );
  } finally {
    cursorDb.close();
  }

  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: {
      claude: { roots: [claudeRoot], includeDesktopLocalAgent: false },
      codex: { homes: [codexHome], sessionSubdirs: ['sessions'] },
      cursor: { roots: [cursorRoot] }
    }
  }), 'utf8');

  return {
    dir,
    claudeRoot,
    codexHome,
    dbPath: join(dir, 'usage.sqlite'),
    env: {
      TOKEN_WORK_CONFIG: configPath,
      NODE_OPTIONS: '--no-warnings'
    }
  };
}

function createWorkBuddyIdentityFixture() {
  const dir = tempDir();
  const tracesDir = join(dir, 'workbuddy', 'traces', '12345');
  const sessionsDir = join(dir, 'workbuddy', 'sessions');
  mkdirSync(tracesDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  const tracePath = join(tracesDir, 'trace_fixture_identity.json');
  const siblingTracePath = join(tracesDir, 'trace_fixture_identity_extra.json');
  writeFileSync(tracePath, JSON.stringify({
    trace: {
      traceId: 'trace_fixture_identity',
      workerPid: 12345,
      startedAt: '2026-06-17T02:00:00.000Z',
      endedAt: '2026-06-17T02:01:00.000Z',
      modelInfo: { models: ['glm-5.2'] }
    },
    spans: [{
      spanId: 'span_fixture_identity',
      type: 'generation',
      startedAt: '2026-06-17T02:00:30.000Z',
      toolOutput: JSON.stringify({
        model: 'auto',
        usage: { prompt_tokens: 100, completion_tokens: 20 }
      })
    }]
  }), 'utf8');
  writeFileSync(join(sessionsDir, '12345.json'), JSON.stringify({
    sessionId: 'transient-session', cwd: join(dir, 'workspace')
  }), 'utf8');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: {
      workbuddy: {
        root: join(dir, 'workbuddy'),
        tracesDir: join(dir, 'workbuddy', 'traces'),
        sessionsDir
      }
    }
  }), 'utf8');
  return {
    dir,
    dbPath: join(dir, 'usage.sqlite'),
    device: hostname(),
    tracePath,
    siblingTracePath,
    env: { TOKEN_WORK_CONFIG: configPath, NODE_OPTIONS: '--no-warnings' }
  };
}

function createForkedCodexFixture() {
  const dir = tempDir();
  const codexHome = join(dir, 'codex');
  const sessionDir = join(codexHome, 'sessions', '2026', '06', '17');
  mkdirSync(sessionDir, { recursive: true });
  const tokenCount = (timestamp, inputTokens) => JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: inputTokens },
        last_token_usage: { input_tokens: inputTokens }
      }
    }
  });
  writeFileSync(join(sessionDir, 'parent.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'parent', timestamp: '2026-06-17T02:00:00.000Z', originator: 'codex-tui' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    tokenCount('2026-06-17T02:00:00.000Z', 100),
    tokenCount('2026-06-17T02:04:00.000Z', 150)
  ].join('\n'), 'utf8');
  writeFileSync(join(sessionDir, 'child.jsonl'), [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'child_1',
        parent_thread_id: 'parent',
        forked_from_id: 'parent',
        timestamp: '2026-06-17T02:05:00.000Z',
        originator: 'codex-tui'
      }
    }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    tokenCount('2026-06-17T02:05:00.000Z', 100),
    tokenCount('2026-06-17T02:05:00.001Z', 150),
    tokenCount('2026-06-17T02:06:00.000Z', 170)
  ].join('\n'), 'utf8');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: { codex: { homes: [codexHome], sessionSubdirs: ['sessions'] } }
  }), 'utf8');
  return {
    dir,
    dbPath: join(dir, 'usage.sqlite'),
    env: { TOKEN_WORK_CONFIG: configPath }
  };
}

function createResettingCodexFixture() {
  const dir = tempDir();
  const codexHome = join(dir, 'codex');
  const sessionDir = join(codexHome, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const tokenCount = (timestamp, totalTokens, lastTokens) => JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: totalTokens },
        last_token_usage: { input_tokens: lastTokens }
      }
    }
  });
  writeFileSync(join(sessionDir, 'reset.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'reset', originator: 'codex-tui' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    tokenCount('2026-06-17T02:00:00.000Z', 100, 100),
    tokenCount('2026-06-17T02:01:00.000Z', 150, 50),
    tokenCount('2026-06-17T02:02:00.000Z', 20, 20)
  ].join('\n'), 'utf8');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: { codex: { homes: [codexHome], sessionSubdirs: ['sessions'] } }
  }), 'utf8');
  return {
    dir,
    dbPath: join(dir, 'usage.sqlite'),
    env: { TOKEN_WORK_CONFIG: configPath }
  };
}

function createUnresolvedForkedCodexFixture() {
  const dir = tempDir();
  const codexHome = join(dir, 'codex');
  const sessionDir = join(codexHome, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'child.jsonl'), [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'child',
        parent_thread_id: 'missing-parent',
        forked_from_id: 'missing-parent',
        timestamp: '2026-06-17T02:00:00.000Z',
        originator: 'codex-tui'
      }
    }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-06-17T02:00:01.000Z',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 100 },
          last_token_usage: { input_tokens: 100 }
        }
      }
    })
  ].join('\n'), 'utf8');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: { codex: { homes: [codexHome], sessionSubdirs: ['sessions'] } }
  }), 'utf8');
  return {
    dir,
    dbPath: join(dir, 'usage.sqlite'),
    env: { TOKEN_WORK_CONFIG: configPath }
  };
}

function createOpenClawArchiveFixture({ includeArchivedHistory = false } = {}) {
  const dir = tempDir();
  const agentRoot = join(dir, 'openclaw');
  const sessionDir = join(agentRoot, 'main', 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const transcript = [
    JSON.stringify({ type: 'model_change', modelId: 'gpt-5.4-mini', provider: 'openai' }),
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 10 }
      }
    })
  ].join('\n');
  const archivedTranscript = includeArchivedHistory
    ? [
        JSON.stringify({ type: 'model_change', modelId: 'gpt-5.4-mini', provider: 'openai' }),
        JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            usage: { input: 7 }
          }
        }),
        transcript
      ].join('\n')
    : transcript;
  writeFileSync(join(sessionDir, 'session-1.jsonl'), transcript, 'utf8');
  writeFileSync(join(sessionDir, 'session-1.jsonl.deleted.2026-06-17'), archivedTranscript, 'utf8');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({
    collectors: { openclaw: { agentRoots: [agentRoot] } }
  }), 'utf8');
  return {
    dir,
    dbPath: join(dir, 'usage.sqlite'),
    env: { TOKEN_WORK_CONFIG: configPath }
  };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'token-work-collect-'));
}

function cleanupFixture(fixture) {
  rmSync(fixture.dir, { recursive: true, force: true });
}

function codexEventId(payload) {
  return `codex:${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32)}`;
}

function runNode(argv, env = {}) {
  return new Promise<ProcessResult>(resolve => {
    const child = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
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
