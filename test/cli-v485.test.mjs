import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };

test('CLI help exposes bare auto entrypoint', async () => {
  const result = await runNode(['src/cli.mjs', '--help']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /token-work \[--db data\/usage\.sqlite\]/);
  assert.match(result.stdout, /--no-collect\|--dry-run-only/);
});

test('bare CLI auto apply writes trusted event usage before starting UI', async () => {
  const fixture = createAutoFixture();
  const apiPort = randomPort();
  const uiPort = randomPort();
  const child = spawn(process.execPath, [
    'src/cli.mjs',
    '--db',
    fixture.dbPath,
    '--api-port',
    String(apiPort),
    '--ui-port',
    String(uiPort),
    '--no-open'
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...fixture.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });

  try {
    const data = await waitForData(apiPort);
    assert.equal(data.meta.runtime.packageVersion, packageJson.version);
    assert.equal(data.meta.runtime.counts.tokenEventRows, 1);
    assert.equal(data.meta.dataMode.id, 'real-event-verified');
    const live = await getJson(apiPort, '/api/live');
    assert.equal(live.autoCollectEnabled, true);
    assert.equal(live.refreshIntervalSeconds, 60);
  } finally {
    await stopChild(child);
    cleanupFixture(fixture);
  }
});

test('bare CLI dry-run-only starts UI without writing usage', async () => {
  const fixture = createAutoFixture();
  const apiPort = randomPort();
  const uiPort = randomPort();
  const child = spawn(process.execPath, [
    'src/cli.mjs',
    '--db',
    fixture.dbPath,
    '--api-port',
    String(apiPort),
    '--ui-port',
    String(uiPort),
    '--dry-run-only',
    '--no-open'
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...fixture.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });

  try {
    const data = await waitForData(apiPort);
    assert.equal(data.meta.runtime.counts.sessionRows, 0);
    assert.equal(data.meta.runtime.counts.tokenEventRows, 0);
    assert.equal(data.meta.dataMode.id, 'empty');
    const live = await getJson(apiPort, '/api/live');
    assert.equal(live.autoCollectEnabled, false);
  } finally {
    await stopChild(child);
    cleanupFixture(fixture);
  }
});

test('bare CLI no-collect starts UI without scanning or writing usage', async () => {
  const fixture = createAutoFixture();
  const apiPort = randomPort();
  const uiPort = randomPort();
  const child = spawn(process.execPath, [
    'src/cli.mjs',
    '--db',
    fixture.dbPath,
    '--api-port',
    String(apiPort),
    '--ui-port',
    String(uiPort),
    '--no-collect',
    '--no-open'
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...fixture.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });

  try {
    const data = await waitForData(apiPort);
    assert.equal(data.meta.runtime.counts.sessionRows, 0);
    assert.equal(data.meta.runtime.counts.tokenEventRows, 0);
    assert.equal(data.meta.dataMode.id, 'empty');
    const live = await getJson(apiPort, '/api/live');
    assert.equal(live.autoCollectEnabled, false);
  } finally {
    await stopChild(child);
    cleanupFixture(fixture);
  }
});

function createAutoFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-auto-cli-'));
  const claudeRoot = join(dir, 'claude');
  const codexHome = join(dir, 'codex');
  const cursorRoot = join(dir, 'cursor');
  mkdirSync(join(claudeRoot, 'projects', 'token-work'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(cursorRoot, { recursive: true });

  writeFileSync(join(claudeRoot, 'projects', 'token-work', 'claude-session.jsonl'), [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T01:00:00.000Z',
      requestId: 'req-auto-1',
      message: {
        id: 'msg-auto-1',
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

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

function cleanupFixture(fixture) {
  rmSync(fixture.dir, { recursive: true, force: true });
}

function randomPort() {
  return 12000 + Math.floor(Math.random() * 20000);
}

async function waitForData(port) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/data`);
      if (response.ok) return response.json();
    } catch {
      // Retry while the CLI finishes coverage/apply and starts the API.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`server did not start on ${port}`);
}

function stopChild(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      clearTimeout(resolveTimer);
      resolve();
    };
    const killTree = force => {
      if (child.exitCode != null) return done();
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        return;
      }
      if (child.pid) {
        try {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          return;
        } catch {
          // Fall back to killing the direct child below.
        }
      }
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    };
    const killTimer = setTimeout(() => killTree(true), 2500);
    const resolveTimer = setTimeout(done, 5000);
    killTimer.unref?.();
    resolveTimer.unref?.();
    child.once('close', done);
    killTree(false);
  });
}

function runNode(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env: process.env,
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
