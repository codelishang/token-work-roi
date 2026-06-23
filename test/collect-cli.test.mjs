import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('collect refuses to run without explicit dry-run or apply mode', async () => {
  const dir = tempDir();
  const dbPath = join(dir, 'usage.sqlite');
  try {
    const result = await runNode(['src/collect.mjs', '--sources=claude', '--db', dbPath, '--json']);
    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}${result.stderr}`, /--dry-run or --apply/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collect dry-run scans fixtures and does not write SQLite', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/collect.mjs',
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

    const byId = new Map(summary.sources.map(row => [row.id, row]));
    assert.equal(byId.get('claude').candidateFiles, 2);
    assert.equal(byId.get('claude').usableTokenRecords, 2);
    assert.equal(byId.get('claude').sessionRows, 2);
    assert.equal(byId.get('claude').tokenEvents, 2);
    assert.equal(byId.get('claude').coverageRisk, 'trusted-event-level');
    assert.equal(byId.get('codex').candidateFiles, 1);
    assert.equal(byId.get('codex').usableTokenRecords, 1);
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
      'src/cli.mjs',
      'coverage',
      '--sources=claude,codex,cursor',
      '--json'
    ], fixture.env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const byId = new Map(summary.sources.map(row => [row.id, row]));
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
      'src/collect.mjs',
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
    try {
      assert.ok(db.prepare('SELECT COUNT(*) AS count FROM session_usage').get().count >= 3);
      assert.ok(db.prepare('SELECT COUNT(*) AS count FROM token_events').get().count >= 1);
      assert.ok(db.prepare('SELECT COUNT(*) AS count FROM collection_runs').get().count >= 3);
    } finally {
      db.close();
    }
  } finally {
    cleanupFixture(fixture);
  }
});

test('token-work collect wrapper defaults to dry-run-only writes when requested', async () => {
  const fixture = createCollectorFixture();
  try {
    const result = await runNode([
      'src/cli.mjs',
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

function runNode(argv, env = {}) {
  return new Promise(resolve => {
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
