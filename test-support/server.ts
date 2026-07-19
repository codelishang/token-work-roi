import { spawn } from 'node:child_process';
import { stopProcessTree } from './process.ts';

const DEFAULT_TIMEOUT_MS = 15000;

interface TestServerOptions {
  dbPath?: string;
  host?: string;
  env?: NodeJS.ProcessEnv;
}

export function spawnTestServer({ dbPath, host = '127.0.0.1', env = {} }: TestServerOptions = {}) {
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: host,
      PORT: '0',
      DB_PATH: dbPath,
      SCHEDULED_COLLECT_ENABLED: 'false',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  const output = captureOutput(child);
  const server: { child: typeof child; output: typeof output; port: number | null } = { child, output, port: null };
  child.on('message', message => {
    if (!message || typeof message !== 'object') return;
    const status = message as { type?: unknown; port?: unknown };
    if (status.type === 'listening' && validPort(status.port)) server.port = status.port as number;
  });
  return server;
}

export function startTestServer(options: TestServerOptions = {}) {
  return spawnTestServer(options);
}

export async function waitForTestServer(server, { path = '/api/data', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (server.child.exitCode != null) {
      throw new Error(`server exited before ${path} started\n${serverDiagnostics(server)}`);
    }
    const port = server.port || serverPort(server.output.stdout);
    if (port) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        if (response.ok) return port;
        lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start in time: ${lastError?.message || 'no response'}\n${serverDiagnostics(server)}`);
}

export function captureOutput(child) {
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output.stdout += chunk; });
  child.stderr.on('data', chunk => { output.stderr += chunk; });
  child.on('error', error => {
    output.stderr += `${output.stderr ? '\n' : ''}${error.stack || error.message}`;
  });
  return output;
}

export function serverDiagnostics(server) {
  return `stdout=${server.output.stdout}\nstderr=${server.output.stderr}\nexit=${server.child.exitCode == null ? 'running' : server.child.exitCode}`;
}

export async function stopTestServer(child) {
  await stopProcessTree(child);
}

function validPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function serverPort(stdout) {
  const match = String(stdout || '').match(/http:\/\/[^:]+:(\d+) \(listening on /);
  const port = match ? Number(match[1]) : null;
  return validPort(port) ? port : null;
}
