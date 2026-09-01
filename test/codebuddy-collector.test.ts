import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { collect, CLIENT_KEY, SOURCE_LABEL } from '../src/collectors/codebuddy.ts';
import { resetConfigCache } from '../src/collector-config.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-codebuddy-'));
  const extensionDir = join(dir, 'logs', 'window1', 'exthost', 'Tencent-Cloud.coding-copilot');
  mkdirSync(extensionDir, { recursive: true });
  const logPath = join(extensionDir, 'CodeBuddy.log');
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, JSON.stringify({ collectors: { codebuddy: { logsRoots: [join(dir, 'logs')] } } }), 'utf8');
  return { dir, logPath, configPath };
}

function line(requestId = 'request-a', totalTokens = 140) {
  return `2026-06-17 10:00:00.000 [info] [BaseAgent:plan] [session-a] notifyStepEnd, step: 1, requestId: ${requestId}, messageId: message-a, usage: {"inputTokens":120,"outputTokens":20,"totalTokens":${totalTokens},"cacheTokens":80,"cachedWriteTokens":10,"thinkingTokens":5}, isMaxTokenLimit: false\n`;
}

function modelLine(model = 'deepseek-v4-flash') {
  return `2026-06-17 09:59:59.000 [info] [BaseAgent:plan] DeepSeek ModelProvider initialized, modelId: ${model}, modelName: Deepseek-V4-Flash\n`;
}

test('CodeBuddy imports explicit completion usage once without reading a model or conversation', async () => {
  const data = fixture();
  writeFileSync(data.logPath, `${line()}${line()}`, 'utf8');
  process.env.TOKEN_WORK_CONFIG = data.configPath;
  resetConfigCache();
  try {
    const result = await collect();
    assert.equal(CLIENT_KEY, 'codebuddy');
    assert.equal(SOURCE_LABEL, 'CodeBuddy');
    assert.equal(result.tokenEvents.length, 1);
    assert.deepEqual(result.tokenEvents[0], {
      eventId: result.tokenEvents[0].eventId,
      source: 'codebuddy',
      sessionId: result.tokenEvents[0].sessionId,
      timestamp: new Date('2026-06-17T10:00:00.000').toISOString(),
      model: 'unknown',
      inputTokens: 30,
      outputTokens: 15,
      cacheReadTokens: 80,
      cacheCreationTokens: 10,
      reasoningTokens: 5,
      privacyLevel: 'safe'
    });
    assert.match(result.tokenEvents[0].eventId, /^codebuddy:[a-f0-9]{32}$/);
    assert.match(result.tokenEvents[0].sessionId, /^codebuddy:[a-f0-9]{32}$/);
  } finally {
    delete process.env.TOKEN_WORK_CONFIG;
    resetConfigCache();
    rmSync(data.dir, { recursive: true, force: true });
  }
});

test('scheduled CodeBuddy collection adds a new request without recounting the log', () => {
  const data = fixture();
  writeFileSync(data.logPath, line('request-a'), 'utf8');
  const env = { ...process.env, TOKEN_WORK_CONFIG: data.configPath, NODE_OPTIONS: '--no-warnings' };
  const run = (scheduled = false) => execFileSync(process.execPath, [
    'src/collect.ts', '--sources=codebuddy', '--db', join(data.dir, 'usage.sqlite'), '--apply', '--yes', '--json'
  ], {
    cwd: process.cwd(),
    env: scheduled ? { ...env, TOKEN_WORK_COLLECT_REASON: 'scheduled', TOKEN_WORK_SCHEDULED_INCREMENTAL: '1' } : env,
    encoding: 'utf8'
  });
  try {
    run();
    const old = new Date(Date.now() - 60_000);
    utimesSync(data.logPath, old, old);
    run(true);
    writeFileSync(data.logPath, `${line('request-a')}${line('request-b')}`, 'utf8');
    run(true);

    const db = new DatabaseSync(join(data.dir, 'usage.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'CodeBuddy'`).get().count, 2);
      assert.equal(db.prepare(`SELECT total_tokens AS totalTokens FROM daily_usage WHERE device = ? AND source = 'CodeBuddy'`).get(hostname()).totalTokens, 280);
    } finally {
      db.close();
    }
  } finally {
    rmSync(data.dir, { recursive: true, force: true });
  }
});

test('CodeBuddy log rotation keeps earlier events from the same session', () => {
  const data = fixture();
  writeFileSync(data.logPath, `${line('request-a')}${line('request-b')}`, 'utf8');
  const env = { ...process.env, TOKEN_WORK_CONFIG: data.configPath, NODE_OPTIONS: '--no-warnings' };
  const run = () => execFileSync(process.execPath, [
    'src/collect.ts', '--sources=codebuddy', '--db', join(data.dir, 'usage.sqlite'), '--apply', '--yes', '--json'
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
  try {
    run();
    writeFileSync(data.logPath, line('request-b'), 'utf8');
    run();

    const db = new DatabaseSync(join(data.dir, 'usage.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM token_events WHERE source = 'CodeBuddy'`).get().count, 2);
      assert.equal(db.prepare(`SELECT total_tokens AS totalTokens FROM daily_usage WHERE device = ? AND source = 'CodeBuddy'`).get(hostname()).totalTokens, 280);
    } finally {
      db.close();
    }
  } finally {
    rmSync(data.dir, { recursive: true, force: true });
  }
});

test('CodeBuddy replaces an earlier unknown model with the matching initialized model', () => {
  const data = fixture();
  writeFileSync(data.logPath, line(), 'utf8');
  const env = { ...process.env, TOKEN_WORK_CONFIG: data.configPath, NODE_OPTIONS: '--no-warnings' };
  const run = () => execFileSync(process.execPath, [
    'src/collect.ts', '--sources=codebuddy', '--db', join(data.dir, 'usage.sqlite'), '--apply', '--yes', '--json'
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
  try {
    run();
    writeFileSync(data.logPath, `${modelLine()}${line()}`, 'utf8');
    run();

    const db = new DatabaseSync(join(data.dir, 'usage.sqlite'), { readOnly: true });
    try {
      assert.deepEqual(db.prepare(`
        SELECT model, total_tokens AS totalTokens FROM daily_usage
        WHERE device = ? AND source = 'CodeBuddy'
      `).all(hostname()).map(row => ({ ...row })), [{ model: 'deepseek-v4-flash', totalTokens: 140 }]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(data.dir, { recursive: true, force: true });
  }
});

test('CodeBuddy does not carry one model initialization into another completion', async () => {
  const data = fixture();
  writeFileSync(data.logPath, `${modelLine()}${line('request-a')}${line('request-b').replace('[session-a]', '[session-b]')}`, 'utf8');
  process.env.TOKEN_WORK_CONFIG = data.configPath;
  resetConfigCache();
  try {
    const result = await collect();
    assert.deepEqual(result.tokenEvents.map(event => event.model).sort(), ['deepseek-v4-flash', 'unknown']);
  } finally {
    delete process.env.TOKEN_WORK_CONFIG;
    resetConfigCache();
    rmSync(data.dir, { recursive: true, force: true });
  }
});

test('CodeBuddy rejects inconsistent token totals', async () => {
  const data = fixture();
  writeFileSync(data.logPath, line('request-b', 141), 'utf8');
  process.env.TOKEN_WORK_CONFIG = data.configPath;
  resetConfigCache();
  try {
    const result = await collect();
    assert.equal(result.tokenEvents.length, 0);
    assert.equal(result.audit.skippedNoTokenRecords, 1);
  } finally {
    delete process.env.TOKEN_WORK_CONFIG;
    resetConfigCache();
    rmSync(data.dir, { recursive: true, force: true });
  }
});
