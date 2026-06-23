import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('collector config accepts UTF-8 BOM files instead of falling back to defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-config-'));
  const configPath = join(dir, 'collectors.json');
  writeFileSync(configPath, `\uFEFF${JSON.stringify({
    collectors: { cursor: { roots: ['D:/fixture/cursor'] } },
    enabledCollectors: ['cursor']
  })}`, 'utf8');

  const old = process.env.TOKEN_WORK_CONFIG;
  process.env.TOKEN_WORK_CONFIG = configPath;
  try {
    const moduleUrl = `../src/collector-config.mjs?case=${Date.now()}`;
    const { configuredPaths } = await import(moduleUrl);
    assert.deepEqual(configuredPaths('cursor', 'roots'), ['D:/fixture/cursor']);
  } finally {
    if (old == null) delete process.env.TOKEN_WORK_CONFIG;
    else process.env.TOKEN_WORK_CONFIG = old;
  }
});
