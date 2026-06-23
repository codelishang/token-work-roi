import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { parseCcusageJsonText, planCcusageImport } from './ccusage-import.mjs';

export const CCUSAGE_CLI_REPORTS = ['daily', 'weekly', 'monthly', 'session', 'blocks'];

export async function runCcusageCliImportPlan({
  report = 'session',
  ccusageBin = null,
  device,
  now = new Date()
} = {}) {
  const invocation = ccusageInvocation({ report, ccusageBin });
  const { stdout } = await runCommand(invocation);
  const payload = parseCcusageJsonText(stdout);
  const plan = planCcusageImport(payload, {
    device,
    now,
    importSource: 'import:ccusage-cli',
    toolCategory: 'import:ccusage-cli',
    command: invocation.commandLabel
  });
  return { plan, invocation };
}

export function ccusageInvocation({ report = 'session', ccusageBin = null } = {}) {
  const normalizedReport = String(report || 'session').toLowerCase();
  if (!CCUSAGE_CLI_REPORTS.includes(normalizedReport)) {
    throw new Error(`--report must be one of: ${CCUSAGE_CLI_REPORTS.join(', ')}`);
  }
  if (ccusageBin) {
    const command = String(ccusageBin);
    return {
      command,
      args: [normalizedReport, '--json', '--no-cost'],
      commandLabel: `${basename(command)} ${normalizedReport} --json --no-cost`
    };
  }
  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['ccusage@latest', normalizedReport, '--json', '--no-cost'],
    commandLabel: `npx ccusage@latest ${normalizedReport} --json --no-cost`
  };
}

function runCommand(invocation) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.command);
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      reject(new Error(`ccusage CLI failed to start: ${error.message}`));
    });
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`ccusage CLI failed: ${detail.slice(0, 800)}`));
    });
  });
}
