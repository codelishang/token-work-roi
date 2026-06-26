import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };
import { stopProcessTree } from '../test-support/process.mjs';

test('CLI help exposes bare auto entrypoint', async () => {
  const result = await runNode(['src/cli.mjs', '--help']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /token-work \[--db data\/usage\.sqlite\]/);
  assert.match(result.stdout, /--api-port 4173\|0/);
  assert.match(result.stdout, /--ui-port 5173\|0/);
  assert.match(result.stdout, /Use port 0 to let the OS assign a free local port/);
});

test('bare CLI auto apply writes trusted event usage before starting UI', async () => {
  const fixture = createAutoFixture();
  const { child, output } = startBareCli(fixture, []);

  try {
    const apiPort = await waitForCliApiPort(child, output);
    assert.match(output.stdout, /\[token-work\] UI  http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output.stdout, /\[token-work\] API http:\/\/127\.0\.0\.1:\d+/);
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
  const { child, output } = startBareCli(fixture, ['--dry-run-only']);

  try {
    const apiPort = await waitForCliApiPort(child, output);
    assert.match(output.stdout, /\[token-work\] UI  http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output.stdout, /\[token-work\] API http:\/\/127\.0\.0\.1:\d+/);
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
  const { child, output } = startBareCli(fixture, ['--no-collect']);

  try {
    const apiPort = await waitForCliApiPort(child, output);
    assert.match(output.stdout, /\[token-work\] UI  http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output.stdout, /\[token-work\] API http:\/\/127\.0\.0\.1:\d+/);
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

test('start command accepts OS-assigned API and UI ports', async () => {
  const fixture = createAutoFixture();
  const { child, output } = startCli(fixture, ['start']);

  try {
    const apiPort = await waitForCliApiPort(child, output);
    assert.match(output.stdout, /\[token-work\] UI  http:\/\/127\.0\.0\.1:\d+/);
    assert.match(output.stdout, /\[token-work\] API http:\/\/127\.0\.0\.1:\d+/);
    const data = await waitForData(apiPort);
    assert.equal(data.meta.dataMode.id, 'empty');
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

function startBareCli(fixture, extraArgs) {
  return startCli(fixture, [], extraArgs);
}

function startCli(fixture, commandArgs = [], extraArgs = []) {
  const child = spawn(process.execPath, [
    'src/cli.mjs',
    ...commandArgs,
    '--db',
    fixture.dbPath,
    '--api-port',
    '0',
    '--ui-port',
    '0',
    '--no-open',
    ...extraArgs
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...fixture.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output.stdout += chunk; });
  child.stderr.on('data', chunk => { output.stderr += chunk; });
  child.on('error', error => {
    output.stderr += `${output.stderr ? '\n' : ''}${error.stack || error.message}`;
  });
  return { child, output };
}

function cliApiPort(output) {
  const match = output.stdout.match(/\[token-work\] API http:\/\/127\.0\.0\.1:(\d+)/);
  return match ? Number(match[1]) : null;
}

async function waitForCliApiPort(child, output) {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (child.exitCode != null) {
      throw new Error(`CLI exited before API became ready\nstdout=${output.stdout}\nstderr=${output.stderr}`);
    }
    const port = cliApiPort(output);
    if (port) return port;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`CLI API did not become ready\nstdout=${output.stdout}\nstderr=${output.stderr}`);
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

function cleanupFixture(fixture) {
  rmSync(fixture.dir, { recursive: true, force: true });
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
  return stopProcessTree(child, { detached: process.platform !== 'win32' });
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
