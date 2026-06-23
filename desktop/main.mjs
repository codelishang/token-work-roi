import { app, BrowserWindow, Menu, Tray, nativeImage, screen, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = resolve(desktopDir, '..');
const nodeBin = process.env.TOKEN_WORK_NODE || 'node';
const defaultApiPort = Number(process.env.TOKEN_WORK_DESKTOP_API_PORT || 4173);
const defaultUiPort = Number(process.env.TOKEN_WORK_DESKTOP_UI_PORT || 5173);
const windowTitle = 'Token Work Pulse';

let mainWindow;
let tray;
let serviceProcess;
let urls = {
  api: `http://127.0.0.1:${defaultApiPort}`,
  ui: `http://127.0.0.1:${defaultUiPort}`
};

app.setName(windowTitle);

app.whenReady().then(async () => {
  try {
    installSecurityGuards();
    urls = await ensureLocalService();
    createTray();
    createWindow(urls);
  } catch (error) {
    createErrorWindow(error);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(urls);
});

app.on('before-quit', () => {
  if (serviceProcess && !serviceProcess.killed) {
    serviceProcess.kill();
  }
});

function createWindow(currentUrls) {
  const bounds = desktopPulseBounds();
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 1180,
    minHeight: 760,
    title: windowTitle,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.on('page-title-updated', event => {
    event.preventDefault();
    mainWindow.setTitle(windowTitle);
  });
  mainWindow.loadURL(localUiUrl('/live?surface=desktop', currentUrls));
  mainWindow.once('ready-to-show', () => {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    setTimeout(() => {
      if (!mainWindow?.isDestroyed()) mainWindow.setAlwaysOnTop(false);
    }, 1800);
  });
}

function desktopPulseBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const margin = 16;
  const width = Math.min(1820, Math.max(1180, workArea.width - margin * 2));
  const height = Math.min(980, Math.max(760, workArea.height - margin * 2));
  return {
    x: workArea.x + margin,
    y: workArea.y + margin,
    width,
    height
  };
}

function createErrorWindow(error) {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 260,
    title: 'Token Work Pulse startup error',
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  const message = escapeHtml(error?.message || 'Local service did not start.');
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <main style="font-family:system-ui,sans-serif;background:#05070d;color:#eef7ff;min-height:100vh;padding:24px">
      <p style="color:#35f4ff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Token Work Pulse</p>
      <h1 style="font-size:22px;margin:0 0 12px">Local service did not start</h1>
      <p style="color:#91a8ba;line-height:1.5">Pulse only connects to the local Token Work service on 127.0.0.1. It does not use a remote fallback.</p>
      <pre style="white-space:pre-wrap;border:1px solid rgba(53,244,255,.25);border-radius:8px;padding:12px;color:#ffb84d">${message}</pre>
    </main>
  `)}`);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Token Work Pulse');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Pulse', click: () => focusOrOpen('/live?surface=desktop') },
    { label: 'Open Dashboard', click: () => openExternal('/') },
    { label: 'Open Review', click: () => openExternal('/review') },
    { label: 'Open Trust', click: () => openExternal('/trust') },
    { type: 'separator' },
    { label: 'Run Coverage Check', click: () => openExternal('/trust') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
  tray.on('click', () => focusOrOpen('/live?surface=desktop'));
}

function focusOrOpen(route) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(urls);
    return;
  }
  mainWindow.loadURL(localUiUrl(route));
  mainWindow.show();
  mainWindow.focus();
}

function openExternal(route) {
  shell.openExternal(localUiUrl(route));
}

function installSecurityGuards() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => {
      const target = event.url || '';
      if (!isAllowedDesktopUrl(target)) event.preventDefault();
    });
  });
}

function localUiUrl(route = '/', currentUrls = urls) {
  const safeRoute = String(route || '/').startsWith('/') ? String(route || '/') : '/';
  return `${currentUrls.ui}${safeRoute}`;
}

function isAllowedDesktopUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'data:') return true;
    const currentUi = new URL(urls.ui);
    return parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port === currentUi.port;
  } catch {
    return false;
  }
}

async function ensureLocalService() {
  const existingApi = `http://127.0.0.1:${defaultApiPort}`;
  const existingUi = `http://127.0.0.1:${defaultUiPort}`;
  if (await isTokenWorkApi(existingApi) && await isTokenWorkUi(existingUi) && await isTokenWorkUiApi(existingUi)) {
    return { api: existingApi, ui: existingUi };
  }

  const apiPort = await freePort(defaultApiPort);
  const uiPort = await freePort(defaultUiPort);
  const child = spawn(nodeBin, [
    resolve(packageRoot, 'src', 'cli.mjs'),
    'start',
    '--no-open',
    '--api-port',
    String(apiPort),
    '--ui-port',
    String(uiPort)
  ], {
    cwd: packageRoot,
    env: {
      ...process.env,
      SCHEDULED_COLLECT_ENABLED: '1',
      SCHEDULED_COLLECT_RUN_ON_START: '1',
      SCHEDULED_COLLECT_INTERVAL_SECONDS: String(liveCollectIntervalSeconds()),
      TOKEN_WORK_LIVE_COLLECT_INTERVAL_SECONDS: String(liveCollectIntervalSeconds())
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  serviceProcess = child;
  child.stdout.on('data', chunk => process.stdout.write(`[token-work-desktop] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[token-work-desktop] ${chunk}`));
  const api = `http://127.0.0.1:${apiPort}`;
  const ui = `http://127.0.0.1:${uiPort}`;
  await waitForTokenWork(api, 'local API', isTokenWorkApi);
  await waitForTokenWork(ui, 'local UI', isTokenWorkUi);
  await waitForTokenWork(ui, 'local UI API proxy', isTokenWorkUiApi);
  return { api, ui };
}

function liveCollectIntervalSeconds() {
  const requested = Number(
    process.env.TOKEN_WORK_LIVE_COLLECT_INTERVAL_SECONDS ||
    process.env.SCHEDULED_COLLECT_INTERVAL_SECONDS ||
    60
  );
  return Math.max(30, Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 60);
}

function trayIcon() {
  return nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#05070d"/>
      <path d="M7 19l5-9 5 12 4-7 4 4" fill="none" stroke="#35f4ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="24" cy="8" r="3" fill="#6dff9c"/>
    </svg>
  `)}`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function isTokenWorkApi(origin) {
  return isTokenWorkLiveEndpoint(`${origin}/api/live`);
}

async function isTokenWorkUiApi(origin) {
  return isTokenWorkLiveEndpoint(`${origin}/api/live`);
}

async function isTokenWorkLiveEndpoint(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (response.status >= 500) return false;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return false;
    const payload = await response.json();
    return Boolean(
      payload &&
      typeof payload.generatedAt === 'string' &&
      payload.totals &&
      typeof payload.totals === 'object' &&
      Number.isFinite(Number(payload.windowMinutes))
    );
  } catch {
    return false;
  }
}

async function isTokenWorkUi(origin) {
  try {
    const response = await fetch(`${origin}/live?surface=desktop`, { signal: AbortSignal.timeout(1200) });
    if (response.status >= 500) return false;
    const text = await response.text();
    return text.includes('Token Work ROI') ||
      text.includes('/manifest.webmanifest') ||
      text.includes('/src/client/main.jsx');
  } catch {
    return false;
  }
}

async function waitForTokenWork(origin, label, probe) {
  const deadline = Date.now() + 45_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      if (await probe(origin)) return;
      lastError = 'identity check failed';
    } catch (error) {
      lastError = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready at ${origin}${lastError ? ` (${lastError})` : ''}`);
}

function freePort(start) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', async () => {
      try {
        resolvePort(await freePort(Number(start) + 1));
      } catch (error) {
        rejectPort(error);
      }
    });
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
    server.listen(Number(start), '127.0.0.1');
  });
}
