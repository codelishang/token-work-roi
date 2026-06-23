import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'token-work-browser-smoke-'));
const fixtureDir = join(tempRoot, 'fixtures');
const dbPath = join(tempRoot, 'data', 'usage.sqlite');

try {
  createCollectorFixture(fixtureDir);
  mkdirSync(dirname(dbPath), { recursive: true });
  const apiPort = await freePort(4280);
  const uiPort = await freePort(apiPort + 1000);
  const app = spawn(process.execPath, [
    resolve(packageRoot, 'src', 'cli.mjs'),
    '--db', dbPath,
    '--api-port', String(apiPort),
    '--ui-port', String(uiPort),
    '--no-open'
  ], {
    cwd: packageRoot,
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
  app.stdout.setEncoding('utf8');
  app.stderr.setEncoding('utf8');
  app.stdout.on('data', chunk => { stdout += chunk; });
  app.stderr.on('data', chunk => { stderr += chunk; });
  app.on('close', () => { closed = true; });
  app.on('error', error => {
    stderr += error.stack || error.message;
    closed = true;
  });

  try {
    const data = await waitForJson(`http://127.0.0.1:${apiPort}/api/data`, { childState: () => ({ closed, stdout, stderr }) });
    if (data.meta?.dataMode?.id !== 'real-event-verified') {
      throw new Error(`expected real-event-verified data mode, got ${data.meta?.dataMode?.id || 'missing'}`);
    }
    await waitForText(`http://127.0.0.1:${uiPort}/`, { childState: () => ({ closed, stdout, stderr }) });
    const browserResult = await runBrowserConsoleCheck(`http://127.0.0.1:${uiPort}/`);
    console.log(JSON.stringify({
      ok: true,
      dataMode: data.meta?.dataMode?.id,
      tokenEvents: data.meta?.runtime?.counts?.tokenEventRows,
      browser: browserResult.browser,
      consoleMessages: browserResult.messageCount
    }, null, 2));
  } finally {
    await stopChild(app);
  }

  if (!process.env.TOKEN_WORK_KEEP_SMOKE_DIR) {
    await cleanupTempDir(tempRoot);
  }
} catch (error) {
  console.error(error.message);
  console.error(`smoke temp dir: ${tempRoot}`);
  process.exit(1);
}

async function runBrowserConsoleCheck(url) {
  const browser = findBrowser();
  if (!browser) {
    throw new Error('No Chromium-compatible browser found. Set CHROME_PATH or TOKEN_WORK_BROWSER to run smoke:browser.');
  }
  if (typeof WebSocket !== 'function') {
    throw new Error('Node.js WebSocket global is unavailable; use Node 22.12+ or 24+.');
  }

  const debugPort = await freePort(9222);
  const profileDir = mkdtempSync(join(tmpdir(), 'token-work-chrome-'));
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, { timeoutMs: 30000 });
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    const target = await targetResponse.json();
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('Chrome did not return a page WebSocket debugger URL');
    const cdp = await connectCdp(wsUrl);
    const messages = [];
    try {
      cdp.onMessage(message => {
        if (message.method === 'Runtime.consoleAPICalled') {
          const text = (message.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
          messages.push(`${message.params?.type || 'console'} ${text}`.trim());
        }
        if (message.method === 'Runtime.exceptionThrown') {
          messages.push(`exception ${message.params?.exceptionDetails?.text || ''} ${message.params?.exceptionDetails?.exception?.description || ''}`.trim());
        }
        if (message.method === 'Log.entryAdded') {
          const entry = message.params?.entry || {};
          messages.push(`${entry.level || 'log'} ${entry.text || ''}`.trim());
        }
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable');
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url });
      await waitForDashboardReady(cdp, messages);
    } finally {
      cdp.close();
    }

    const bad = messages.filter(message =>
      /Encountered two children with the same key|ReferenceError|ERR_CONNECTION_REFUSED|Uncaught|Failed to load resource.*ERR_CONNECTION_REFUSED/iu.test(message)
    );
    if (bad.length) {
      throw new Error(`Browser console smoke failed:\n${bad.join('\n')}`);
    }
    return { browser, messageCount: messages.length };
  } finally {
    await stopChild(chrome);
    await cleanupTempDir(profileDir);
  }
}

async function waitForDashboardReady(cdp, messages) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < 30000) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        hasRoot: Boolean(document.querySelector('#root')),
        bodyLength: document.body?.innerText?.length || 0,
        bodyText: (document.body?.innerText || '').slice(0, 400)
      }))()`,
      returnByValue: true
    });
    lastState = state.result?.result?.value || null;
    if (lastState?.hasRoot && Number(lastState.bodyLength || 0) > 20) return;
    await sleep(500);
  }
  throw new Error([
    'Dashboard root did not render visible content',
    `lastState=${JSON.stringify(lastState)}`,
    `console=${messages.slice(-8).join(' | ')}`
  ].join('\n'));
}

function connectCdp(wsUrl) {
  return new Promise((resolveConnection, rejectConnection) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener('open', () => {
      resolveConnection({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
        onMessage(listener) {
          listeners.add(listener);
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: resolvePending, reject: rejectPending } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectPending(new Error(message.error.message || JSON.stringify(message.error)));
        else resolvePending(message);
        return;
      }
      for (const listener of listeners) listener(message);
    });
    ws.addEventListener('error', () => rejectConnection(new Error('Failed to connect to Chrome DevTools Protocol')));
  });
}

function findBrowser() {
  const envBrowser = process.env.TOKEN_WORK_BROWSER || process.env.CHROME_PATH || process.env.CHROME;
  if (envBrowser) return envBrowser;
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ]
      : [
          which('google-chrome-stable'),
          which('google-chrome'),
          which('chromium-browser'),
          which('chromium'),
          which('microsoft-edge')
        ];
  return candidates.find(candidate => candidate && (process.platform === 'linux' || existsSync(candidate))) || '';
}

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
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
      requestId: 'req-browser-smoke-1',
      cwd: 'D:\\HighROIProjects\\token-work-smoke',
      message: {
        id: 'msg-browser-smoke-1',
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

async function waitForJson(url, options = {}) {
  const response = await waitForResponse(url, options);
  return response.json();
}

async function waitForText(url, options = {}) {
  const response = await waitForResponse(url, options);
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
