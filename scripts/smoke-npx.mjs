import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'token-work-npx-smoke-'));
const packDir = join(tempRoot, 'pack');
const runDir = join(tempRoot, 'run');
const fixtureDir = join(tempRoot, 'fixtures');
const dbPath = join(runDir, 'data', 'usage.sqlite');

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  createCollectorFixture(fixtureDir);

  await runNpm(['pack', '--pack-destination', packDir], { cwd: packageRoot });
  const tarball = readdirSync(packDir).find(file => file.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not create a .tgz file');

  await runNpm(['init', '-y'], { cwd: runDir });
  await runNpm(['install', join(packDir, tarball), '--silent'], { cwd: runDir });

  const cliPath = join(runDir, 'node_modules', 'token-work', 'src', 'cli.mjs');
  if (!existsSync(cliPath)) throw new Error(`Installed CLI not found: ${cliPath}`);

  const apiPort = await freePort(4180);
  const uiPort = await freePort(apiPort + 1000);
  const child = spawn(process.execPath, [
    cliPath,
    '--db', dbPath,
    '--api-port', String(apiPort),
    '--ui-port', String(uiPort),
    '--no-open'
  ], {
    cwd: runDir,
    env: safeEnv({
      TOKEN_WORK_CONFIG: join(fixtureDir, 'collectors.json'),
      NODE_OPTIONS: '--no-warnings'
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let closed = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', () => { closed = true; });
  child.on('error', error => {
    stderr += error.stack || error.message;
    closed = true;
  });

  try {
    const data = await waitForJson(`http://127.0.0.1:${apiPort}/api/data`, { childState: () => ({ closed, stdout, stderr }) });
    const html = await waitForText(`http://127.0.0.1:${uiPort}/`, { childState: () => ({ closed, stdout, stderr }) });
    const apply = await fetch(`http://127.0.0.1:${uiPort}/api/auto-attribution/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threshold: 100,
        sessions: [{ device: '__probe__', source: '__probe__', sessionId: '__probe__' }]
      })
    });
    const applyJson = await apply.json();
    if (!apply.ok || !applyJson.ok || applyJson.applied !== 0) {
      throw new Error(`auto attribution proxy smoke failed: ${apply.status} ${JSON.stringify(applyJson)}`);
    }
    if (!html.includes('<div id="root"></div>')) throw new Error('UI HTML root missing');
    if (data.meta?.dataMode?.id !== 'real-event-verified') {
      throw new Error(`expected real-event-verified data mode, got ${data.meta?.dataMode?.id || 'missing'}`);
    }
    if (Number(data.meta?.runtime?.counts?.tokenEventRows || 0) < 1) {
      throw new Error('expected installed package to collect at least one token event from fixture');
    }

    console.log(JSON.stringify({
      ok: true,
      packageVersion: data.meta?.runtime?.packageVersion,
      dataMode: data.meta?.dataMode?.id,
      tokenEvents: data.meta?.runtime?.counts?.tokenEventRows,
      uiReady: html.includes('<div id="root"></div>'),
      autoAttributionProxy: applyJson.ok === true,
      tarball: join(packDir, tarball)
    }, null, 2));
  } finally {
    await stopChild(child);
  }

  if (!process.env.TOKEN_WORK_KEEP_SMOKE_DIR) {
    await cleanupTempDir(tempRoot);
  }
} catch (error) {
  console.error(error.message);
  console.error(`smoke temp dir: ${tempRoot}`);
  process.exit(1);
}

function createCollectorFixture(root) {
  const claudeProject = join(root, 'claude', 'projects', 'token-work');
  const codexHome = join(root, 'codex');
  const cursorRoot = join(root, 'cursor');
  mkdirSync(claudeProject, { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(cursorRoot, { recursive: true });
  writeFileSync(join(claudeProject, 'claude-session.jsonl'), [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T01:00:00.000Z',
      requestId: 'req-npx-smoke-1',
      cwd: 'D:\\HighROIProjects\\token-work-smoke',
      message: {
        id: 'msg-npx-smoke-1',
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
  writeFileSync(join(root, 'collectors.json'), JSON.stringify({
    collectors: {
      claude: { roots: [join(root, 'claude')], includeDesktopLocalAgent: false },
      codex: { homes: [codexHome], sessionSubdirs: ['sessions'] },
      cursor: { roots: [cursorRoot] }
    }
  }), 'utf8');
}

function runNpm(args, { cwd }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnNpm(args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('close', code => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
      } else {
        rejectRun(new Error(`npm ${args.join(' ')} failed with exit ${code}\n${stderr || stdout}`));
      }
    });
  });
}

function spawnNpm(args, { cwd }) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', `npm ${args.map(quoteWindowsArg).join(' ')}`], {
      cwd,
      env: safeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  }
  return spawn('npm', args, {
    cwd,
    env: safeEnv(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function safeEnv(extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('='))),
    ...extra
  };
}

async function waitForJson(url, { childState }) {
  const response = await waitForResponse(url, { childState });
  return response.json();
}

async function waitForText(url, { childState }) {
  const response = await waitForResponse(url, { childState });
  return response.text();
}

async function waitForResponse(url, { childState, timeoutMs = 90000, intervalMs = 500 } = {}) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const state = childState?.() || {};
    if (state.closed) {
      throw new Error(`child exited before ${url}\nstdout=${state.stdout || ''}\nstderr=${state.stderr || ''}`);
    }
    try {
      const response = await fetch(url);
      last = String(response.status);
      if (response.ok) return response;
    } catch (error) {
      last = error.message;
    }
    await sleep(intervalMs);
  }
  const state = childState?.() || {};
  throw new Error(`Timed out waiting for ${url}: ${last}\nstdout=${state.stdout || ''}\nstderr=${state.stderr || ''}`);
}

async function freePort(start) {
  for (let port = start; port < start + 200; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found near ${start}`);
}

function canListen(port) {
  return new Promise(resolvePort => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => server.close(() => resolvePort(true)));
    server.listen(port, '127.0.0.1');
  });
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function stopChild(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise(resolveStop => {
    const timer = setTimeout(resolveStop, 5000);
    timer.unref?.();
    child.once('close', () => {
      clearTimeout(timer);
      resolveStop();
    });
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  });
}

async function cleanupTempDir(dir) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Windows can keep recently terminated npm/vite files locked briefly.
      await sleep(500);
    }
  }
  console.warn(`warning: smoke temp dir could not be removed: ${dir}`);
}
