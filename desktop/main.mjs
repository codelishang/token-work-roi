import { app, BrowserWindow, Menu, Tray, nativeImage, screen, session } from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = resolve(desktopDir, '..');
const nodeBin = process.env.TOKEN_WORK_NODE || 'node';
const defaultApiPort = Number(process.env.TOKEN_WORK_DESKTOP_API_PORT || 4173);
const defaultUiPort = Number(process.env.TOKEN_WORK_DESKTOP_UI_PORT || 5173);
const appTitle = '元衡 Token Work ROI';
const pulseTitle = '元衡 Token Work Pulse';

let mainWindow;
let tray;
let cachedAppIcon;
let serviceProcess;
let isQuitting = false;
let urls = {
  api: `http://127.0.0.1:${defaultApiPort}`,
  ui: `http://127.0.0.1:${defaultUiPort}`
};

app.setName(appTitle);

app.whenReady().then(async () => {
  try {
    setDockIcon();
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
  else focusOrOpen('/live?surface=desktop');
});

app.on('window-all-closed', event => {
  event.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serviceProcess && !serviceProcess.killed) {
    serviceProcess.kill();
  }
});

function createWindow(currentUrls, initialRoute = '/live?surface=desktop') {
  const bounds = desktopPulseBounds();
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 420,
    minHeight: 560,
    title: desktopTitleForRoute(initialRoute),
    icon: appIcon(),
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
    syncWindowTitle();
  });
  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.webContents.on('did-navigate', () => syncWindowTitle());
  mainWindow.webContents.on('did-navigate-in-page', () => syncWindowTitle());
  mainWindow.webContents.on('did-finish-load', () => syncWindowTitle());
  mainWindow.setTitle(desktopTitleForRoute(initialRoute));
  mainWindow.loadURL(localUiUrl(initialRoute, currentUrls));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function desktopPulseBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const margin = 16;
  const width = Math.min(560, Math.max(420, workArea.width - margin * 2));
  const height = Math.min(760, Math.max(560, workArea.height - margin * 2));
  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + margin,
    width,
    height
  };
}

function createErrorWindow(error) {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 260,
    title: `${appTitle} startup error`,
    icon: appIcon(),
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
      <p style="color:#35f4ff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${appTitle}</p>
      <h1 style="font-size:22px;margin:0 0 12px">Local service did not start</h1>
      <p style="color:#91a8ba;line-height:1.5">Pulse only connects to the local 元衡 Token Work service on 127.0.0.1. It does not use a remote fallback.</p>
      <pre style="white-space:pre-wrap;border:1px solid rgba(53,244,255,.25);border-radius:8px;padding:12px;color:#ffb84d">${message}</pre>
    </main>
  `)}`);
}

function createTray() {
  tray = new Tray(appIcon());
  tray.setToolTip(appTitle);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Pulse', click: () => focusOrOpen('/live?surface=desktop') },
    { label: 'Open Dashboard', click: () => focusOrOpen('/') },
    { label: 'Open Review', click: () => focusOrOpen('/review') },
    { label: 'Open Trust', click: () => focusOrOpen('/trust') },
    { type: 'separator' },
    { label: 'Quit', click: () => {
      isQuitting = true;
      app.quit();
    } }
  ]));
  tray.on('click', () => focusOrOpen('/live?surface=desktop'));
}

function focusOrOpen(route) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(urls, route);
    return;
  }
  mainWindow.setTitle(desktopTitleForRoute(route));
  mainWindow.loadURL(localUiUrl(route));
  mainWindow.show();
  mainWindow.focus();
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

function desktopTitleForRoute(routeOrUrl) {
  try {
    const parsed = new URL(String(routeOrUrl || '/'), urls.ui);
    return parsed.pathname === '/live' ? pulseTitle : appTitle;
  } catch {
    return appTitle;
  }
}

function syncWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle(desktopTitleForRoute(mainWindow.webContents.getURL()));
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
      SCHEDULED_COLLECT_ENABLED: process.env.SCHEDULED_COLLECT_ENABLED || '0',
      SCHEDULED_COLLECT_RUN_ON_START: process.env.SCHEDULED_COLLECT_RUN_ON_START || '0',
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

function appIcon() {
  if (cachedAppIcon && !cachedAppIcon.isEmpty()) return cachedAppIcon;
  const pngPath = resolve(packageRoot, 'public', 'token-work-icon.png');
  if (existsSync(pngPath)) {
    cachedAppIcon = nativeImage.createFromPath(pngPath);
    if (!cachedAppIcon.isEmpty()) return cachedAppIcon;
  }
  const svg = readFileSync(resolve(packageRoot, 'public', 'token-work-icon.svg'), 'utf8');
  cachedAppIcon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  return cachedAppIcon;
}

function setDockIcon() {
  if (typeof app.dock?.setIcon === 'function') {
    app.dock.setIcon(appIcon());
  }
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
    return text.includes('name="token-work-app" content="token-work-roi"') ||
      text.includes('name="application-name" content="元衡 Token Work"') ||
      text.includes('Token Work ROI');
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
