import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const desktopMain = resolve(root, 'desktop', 'main.mjs');
const viteConfig = resolve(root, 'vite.config.js');
const electronPackage = resolve(root, 'node_modules', 'electron', 'package.json');
const electronBin = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

assert.equal(existsSync(desktopMain), true, 'desktop/main.mjs must exist');
assert.equal(existsSync(viteConfig), true, 'vite.config.js must exist');

const source = readFileSync(desktopMain, 'utf8');
const viteSource = readFileSync(viteConfig, 'utf8');
const httpReferences = source.match(/https?:\/\/[^`'"\s)]+/g) || [];
assert.match(source, /127\.0\.0\.1/, 'desktop must bind to local loopback URLs');
assert.doesNotMatch(source, /collect\s+--apply/, 'desktop must not auto-run real collect');
assert.match(source, /SCHEDULED_COLLECT_ENABLED:\s*process\.env\.SCHEDULED_COLLECT_ENABLED\s*\|\|\s*'0'/, 'desktop-started local service should not enable scheduled collection by default');
assert.match(source, /SCHEDULED_COLLECT_RUN_ON_START:\s*process\.env\.SCHEDULED_COLLECT_RUN_ON_START\s*\|\|\s*'0'/, 'desktop-started local service should not collect on start by default');
assert.match(source, /TOKEN_WORK_LIVE_COLLECT_INTERVAL_SECONDS/, 'desktop should use the live collect interval override');
assert.match(source, /isTokenWorkApi/, 'desktop must verify the local API identifies as Token Work before reuse');
assert.match(source, /isTokenWorkUi/, 'desktop must verify the local UI identifies as Token Work before reuse');
assert.match(source, /isTokenWorkUiApi/, 'desktop must verify the local UI can proxy API requests before reuse');
assert.match(source, /page-title-updated/, 'desktop must prevent unrelated pages from replacing the Pulse window title');
assert.doesNotMatch(source, /isHealthy\(\`\$\{existingUi\}\/live`\)/, 'desktop must not reuse arbitrary local /live pages');
assert.doesNotMatch(source, /setAlwaysOnTop/, 'desktop must not force an always-on-top window by default');
assert.doesNotMatch(source, /\.maximize\(\)/, 'desktop must open as a companion window, not a maximized window');
assert.match(source, /mainWindow\.on\('close'/, 'desktop close button should hide the window to tray');
assert.match(source, /createWindow\(urls,\s*route\)/, 'tray menu routes must be preserved when reopening a destroyed window');
assert.match(source, /contextIsolation:\s*true/, 'desktop renderer must keep contextIsolation enabled');
assert.match(source, /nodeIntegration:\s*false/, 'desktop renderer must keep nodeIntegration disabled');
assert.match(source, /sandbox:\s*true/, 'desktop renderer must keep sandbox enabled');
assert.match(source, /webSecurity:\s*true/, 'desktop renderer must keep webSecurity enabled');
assert.match(source, /desktopPulseBounds/, 'desktop pulse should calculate safe work-area bounds');
assert.match(source, /Math\.min\(560/, 'desktop pulse should default to a compact companion window');
assert.match(source, /minWidth:\s*420/, 'desktop pulse should keep a compact minimum width');
assert.match(source, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/s, 'desktop must deny renderer-created windows');
assert.match(source, /setPermissionRequestHandler/, 'desktop must deny renderer permission requests by default');
assert.doesNotMatch(source, /Run Coverage Check/, 'desktop tray must not advertise fake actions');
assert.deepEqual(
  httpReferences.filter(value => !value.startsWith('http://127.0.0.1') && value !== 'http://www.w3.org/2000/svg'),
  [],
  'desktop must not call remote HTTP services'
);

assert.equal(existsSync(electronPackage), true, 'electron package should be installed');
assert.equal(existsSync(electronBin), true, 'electron binary shim should be available');
assert.match(viteSource, /\*\*\/data\/\*\*/, 'Vite must ignore SQLite data/backups so live collect cannot crash the desktop UI watcher');
const electronMeta = JSON.parse(readFileSync(electronPackage, 'utf8'));
assert.match(electronMeta.version, /^\d+\./, 'electron package should expose a version');

console.log('desktop smoke ok');
