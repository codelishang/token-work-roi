import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPrivacyCheck } from '../src/privacy-check.mjs';

function gitFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-roi-privacy-'));
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('privacy check passes clean tracked docs', () => {
  const dir = gitFixture();
  writeFileSync(join(dir, 'README.md'), '# Demo\n\nNo private data.\n');
  spawnSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  const result = runPrivacyCheck({ cwd: dir });
  assert.equal(result.ok, true);
});

test('privacy check blocks real db and personal paths', () => {
  const dir = gitFixture();
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'usage.sqlite'), 'not a real sqlite but blocked by path');
  writeFileSync(join(dir, 'notes.md'), 'Path: C:\\Users\\someone\\secret');
  spawnSync('git', ['add', 'data/usage.sqlite', 'notes.md'], { cwd: dir, stdio: 'ignore' });
  const result = runPrivacyCheck({ cwd: dir });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.id === 'sqlite-db'), true);
  assert.equal(result.issues.some(issue => issue.id === 'personal-windows-path'), true);
});
