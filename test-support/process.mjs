import { spawnSync } from 'node:child_process';

export async function stopProcessTree(child, { detached = false } = {}) {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      clearTimeout(resolveTimer);
      resolve();
    };
    const killTree = force => {
      if (child.exitCode != null) return done();
      if (process.platform === 'win32' && child.pid) {
        const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        if (result.status === 0) return done();
        return;
      }
      if (detached && child.pid) {
        try {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          return;
        } catch {
          // Fall back to killing the direct child below.
        }
      }
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    };
    const killTimer = setTimeout(() => killTree(true), 2500);
    const resolveTimer = setTimeout(done, 5000);
    killTimer.unref?.();
    resolveTimer.unref?.();
    child.once('close', done);
    killTree(false);
  });
}
