import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const nodeCmd = process.execPath;
const viteBin = resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const children = [
  spawn(nodeCmd, ['src/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: process.env.API_PORT || '4173' },
    stdio: 'inherit'
  }),
  spawn(nodeCmd, [viteBin, '--host', '127.0.0.1', '--port', '5173'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
];

let shuttingDown = false;

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const other of children) {
      if (other !== child && !other.killed) stopDevChild(other);
    }
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) stopDevChild(child);
  }
}

function stopDevChild(child) {
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    if (result.status === 0) return;
  }
  child.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform !== 'win32') {
  process.on('SIGHUP', shutdown);
}
