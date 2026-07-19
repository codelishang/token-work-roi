import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type RealpathLike = (path: string) => string;

export function resolveViteBin({ packageRoot, requireLike }: {
  packageRoot?: string;
  requireLike?: { resolve?: (specifier: string) => string };
} = {}) {
  const candidates = [];

  try {
    const vitePackageJson = requireLike?.resolve?.('vite/package.json');
    if (vitePackageJson) {
      candidates.push(resolve(dirname(vitePackageJson), 'bin', 'vite.js'));
    }
  } catch {
    // Fall back to the direct local checkout layout below.
  }

  if (packageRoot) {
    candidates.push(resolve(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js'));
  }

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error('Vite is not installed. Reinstall token-work or run npm install in the source checkout, then retry token-work start.');
  }
  return found;
}

export function resolveLaunchCwd(packageRoot, {
  realpathLike = realpathSync as RealpathLike,
  nativeRealpathLike = realpathSync.native as RealpathLike
}: { realpathLike?: RealpathLike; nativeRealpathLike?: RealpathLike } = {}) {
  const fallback = resolve(packageRoot || '.');
  const candidates = [
    tryRealpath(realpathLike, fallback),
    tryRealpath(nativeRealpathLike, fallback),
    fallback
  ].filter(Boolean);
  return candidates.find(candidate => !candidate.includes('~')) || candidates[0] || fallback;
}

function tryRealpath(realpathLike: RealpathLike, path: string) {
  try {
    return realpathLike?.(path) || null;
  } catch {
    return null;
  }
}
