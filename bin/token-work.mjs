#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeEntry = resolve(packageRoot, 'dist-runtime', 'cli.mjs');
const sourceEntry = resolve(packageRoot, 'src', 'cli.ts');
const entry = existsSync(runtimeEntry) ? runtimeEntry : sourceEntry;

if (!existsSync(entry)) {
  console.error('token-work runtime not found. Reinstall token-work and try again.');
  process.exit(1);
}

await import(pathToFileURL(entry).href);
