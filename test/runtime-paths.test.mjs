import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveLaunchCwd, resolveViteBin } from '../src/runtime-paths.mjs';

test('resolveViteBin handles npm npx hoisted dependency layout', () => {
  const root = join(tmpdir(), `token-work-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const packageRoot = join(root, 'node_modules', 'token-work');
  const viteRoot = join(root, 'node_modules', 'vite');
  const viteBin = join(viteRoot, 'bin', 'vite.js');
  mkdirSync(join(packageRoot, 'src'), { recursive: true });
  mkdirSync(join(viteRoot, 'bin'), { recursive: true });
  writeFileSync(join(viteRoot, 'package.json'), '{"name":"vite"}\n');
  writeFileSync(viteBin, '#!/usr/bin/env node\n');

  try {
    const resolved = resolveViteBin({
      packageRoot,
      requireLike: {
        resolve(id) {
          assert.equal(id, 'vite/package.json');
          return join(viteRoot, 'package.json');
        }
      }
    });
    assert.equal(resolved, viteBin);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveViteBin keeps local source checkout fallback', () => {
  const root = join(tmpdir(), `token-work-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const packageRoot = join(root, 'token-work');
  const viteBin = join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  mkdirSync(join(packageRoot, 'node_modules', 'vite', 'bin'), { recursive: true });
  writeFileSync(viteBin, '#!/usr/bin/env node\n');

  try {
    const resolved = resolveViteBin({
      packageRoot,
      requireLike: {
        resolve() {
          throw new Error('not found');
        }
      }
    });
    assert.equal(resolved, viteBin);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLaunchCwd expands Windows 8.3 temp paths before starting Vite', () => {
  const shortPackageRoot = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\token-work-npx-smoke\\run\\node_modules\\token-work';
  const longPackageRoot = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\token-work-npx-smoke\\run\\node_modules\\token-work';

  const resolved = resolveLaunchCwd(shortPackageRoot, {
    realpathLike(path) {
      assert.equal(path, resolve(shortPackageRoot));
      return longPackageRoot;
    }
  });

  assert.equal(resolved, longPackageRoot);
  assert.equal(resolved.includes('~'), false);
});

test('resolveLaunchCwd prefers native long path when the first realpath is still short', () => {
  const shortPackageRoot = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\token-work-npx-smoke\\run\\node_modules\\token-work';
  const longPackageRoot = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\token-work-npx-smoke\\run\\node_modules\\token-work';

  const resolved = resolveLaunchCwd(shortPackageRoot, {
    realpathLike() {
      return shortPackageRoot;
    },
    nativeRealpathLike() {
      return longPackageRoot;
    }
  });

  assert.equal(resolved, longPackageRoot);
});

test('resolveLaunchCwd falls back to the package root when realpath is unavailable', () => {
  const packageRoot = join(tmpdir(), `token-work-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const resolved = resolveLaunchCwd(packageRoot, {
    realpathLike() {
      throw new Error('realpath failed');
    }
  });

  assert.equal(resolved, packageRoot);
});
