import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('CLI help exposes open and import-usage help', async () => {
  const help = await runCli(['--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /token-work open/);

  const importHelp = await runCli(['import-usage', '--help']);
  assert.equal(importHelp.code, 0, importHelp.stderr);
  assert.match(importHelp.stdout, /ccusage Import/);
  assert.match(importHelp.stdout, /--dry-run/);
  assert.match(importHelp.stdout, /prompt, response, messages/);
});

function runCli(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['src/cli.mjs', ...argv], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
  });
}
