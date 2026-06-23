import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const args = parseArgs(process.argv.slice(2));
const version = args.version || args.v;
if (!version) {
  console.error('Usage: npm run smoke:published -- --version 4.8.6');
  process.exit(1);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'token-work-published-smoke-'));
const fixtureDir = join(tempRoot, 'fixtures');

try {
  createEmptyCollectorConfig(fixtureDir);
  await smokeService(['--dry-run-only', '--no-open'], {
    assertData: data => data.meta?.dataMode?.id === 'empty'
  });
  await smokeService(['demo', '--no-open'], {
    assertData: data => data.meta?.demoMode === true
  });
  await runNpx(['privacy-check']);
  await runNpx(['statusline', '--format=text']);
  console.log(JSON.stringify({ ok: true, version }, null, 2));
  if (!process.env.TOKEN_WORK_KEEP_SMOKE_DIR) await cleanupTempDir(tempRoot);
} catch (error) {
  console.error(error.message);
  console.error(`smoke temp dir: ${tempRoot}`);
  process.exit(1);
}

async function smokeService(commandArgs, { assertData }) {
  const cwd = mkdtempSync(join(tempRoot, 'run-'));
  mkdirSync(join(cwd, 'data'), { recursive: true });
  const apiPort = await freePort(4380);
  const uiPort = await freePort(apiPort + 1000);
  const child = spawnNpx([
    ...commandArgs,
    '--api-port', String(apiPort),
    '--ui-port', String(uiPort)
  ], { cwd });
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
    await waitForText(`http://127.0.0.1:${uiPort}/`, { childState: () => ({ closed, stdout, stderr }) });
    if (!assertData(data)) {
      throw new Error(`unexpected data state for ${commandArgs.join(' ')}: ${JSON.stringify(data.meta?.dataMode || data.meta)}`);
    }
  } finally {
    await stopChild(child);
  }
}

function runNpx(commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const cwd = mkdtempSync(join(tempRoot, 'cmd-'));
    const child = spawnNpx(commandArgs, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('close', code => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`npx token-work@${version} ${commandArgs.join(' ')} failed with exit ${code}\n${stderr || stdout}`));
    });
  });
}

function spawnNpx(commandArgs, { cwd }) {
  const fullArgs = ['--yes', `token-work@${version}`, ...commandArgs];
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', `npx ${fullArgs.map(quoteWindowsArg).join(' ')}`], {
      cwd,
      env: safeEnv({ TOKEN_WORK_CONFIG: join(fixtureDir, 'collectors.json'), NODE_OPTIONS: '--no-warnings' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  }
  return spawn('npx', fullArgs, {
    cwd,
    env: safeEnv({ TOKEN_WORK_CONFIG: join(fixtureDir, 'collectors.json'), NODE_OPTIONS: '--no-warnings' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function createEmptyCollectorConfig(root) {
  mkdirSync(root, { recursive: true });
  const empty = join(root, 'empty');
  mkdirSync(join(empty, 'claude'), { recursive: true });
  mkdirSync(join(empty, 'codex'), { recursive: true });
  mkdirSync(join(empty, 'cursor'), { recursive: true });
  writeFileSync(join(root, 'collectors.json'), JSON.stringify({
    collectors: {
      claude: { roots: [join(empty, 'claude')], includeDesktopLocalAgent: false },
      codex: { homes: [join(empty, 'codex')], sessionSubdirs: ['sessions'] },
      cursor: { roots: [join(empty, 'cursor')] }
    }
  }), 'utf8');
}

async function waitForJson(url, options = {}) {
  const response = await waitForResponse(url, options);
  return response.json();
}

async function waitForText(url, options = {}) {
  const response = await waitForResponse(url, options);
  return response.text();
}

async function waitForResponse(url, { childState, timeoutMs = 120000, intervalMs = 500 } = {}) {
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

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
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
      await sleep(500);
    }
  }
  console.warn(`warning: smoke temp dir could not be removed: ${dir}`);
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}
