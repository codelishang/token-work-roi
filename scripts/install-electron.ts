import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const installScript = resolve(process.cwd(), 'node_modules', 'electron', 'install.js');

if (!existsSync(installScript)) {
  console.error('Electron is not installed in node_modules. Run npm install in the source checkout first.');
  process.exit(1);
}

const env = {
  ...process.env
};

const result = spawnSync(process.execPath, [installScript], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit'
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

process.exit(0);
