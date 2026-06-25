import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const electronBin = resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

if (!existsSync(electronBin)) {
  console.error('Electron is not installed. The desktop entry is for source checkouts; run npm install first.');
  process.exit(1);
}

const desktopResult = spawnSync(electronBin, ['desktop/main.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(desktopResult.status ?? 1);
