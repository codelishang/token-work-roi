import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { ProcessResult } from '../test-support/process.ts';

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
    const scheduledBackups = readdirSync(backupDir)
      .filter(name => name.endsWith('-scheduled-collect.sqlite'));
    assert.equal(scheduledBackups.length, 1);
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(backupDir, scheduledBackups[0]), oldTime, oldTime);

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
    assert.equal(JSON.parse(unchanged.stdout).backup, null, unchanged.stderr);
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
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-session', cwd: join(dir, 'repo') } }),
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
    dbPath: join(dir, 'usage.sqlite'),
    env: {
      TOKEN_WORK_CONFIG: configPath,
      NODE_OPTIONS: '--no-warnings'
    }
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
