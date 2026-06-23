import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('Dockerfile matches package runtime and only copies existing paths', () => {
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:24-alpine/m);
  assert.doesNotMatch(dockerfile, /pricing-litellm|pricing-openrouter/);
  assert.match(dockerfile, /^COPY public \.\/public$/m);
  assert.match(dockerfile, /^COPY data\/\.gitkeep \.\/data\/\.gitkeep$/m);
  assert.match(dockerfile, /^COPY data\/official-pricing\.json \.\/data\/official-pricing\.json$/m);

  for (const match of dockerfile.matchAll(/^COPY\s+(.+?)\s+(.+)$/gm)) {
    const sources = match[1].split(/\s+/).filter(item => item !== '--from');
    for (const source of sources) {
      if (source.startsWith('--')) continue;
      assert.equal(existsSync(resolve(root, source)), true, `Dockerfile COPY source must exist: ${source}`);
    }
  }
});

test('docker compose remote bind is explicit and keeps collector home read-only', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /HOST:\s+"0\.0\.0\.0"/);
  assert.match(compose, /INGEST_TOKEN:/);
  assert.match(compose, /TOKEN_WORK_ALLOW_REMOTE:\s+"1"/);
  assert.match(compose, /TOKEN_WORK_COLLECTOR_HOME/);
  assert.match(compose, /:\/collector-home:ro/);
});

test('.dockerignore excludes private runtime data from build context', () => {
  const ignorePath = resolve(root, '.dockerignore');
  assert.equal(existsSync(ignorePath), true);
  const ignore = readFileSync(ignorePath, 'utf8');
  assert.match(ignore, /^data\/\*$/m);
  assert.match(ignore, /^!data\/\.gitkeep$/m);
  assert.match(ignore, /^node_modules$/m);
  assert.match(ignore, /^dist$/m);
});
