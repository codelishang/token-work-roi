import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnTestServer, startTestServer, stopTestServer, waitForTestServer } from '../test-support/server.ts';

const guardedGetPaths = [
  '/api/data',
  '/api/summary',
  '/api/collectors',
  '/api/work-items',
  '/api/project-alias-rules',
  '/api/collect/status'
];

test('non-public GET APIs reject non-local Origin', async () => {
  const server = await startServer();
  try {
    for (const path of guardedGetPaths) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        headers: { Origin: 'https://example.invalid' }
      });
      assert.equal(response.status, 403, `${path} should reject non-local Origin`);
    }
  } finally {
    await server.stop();
  }
});

test('loopback GET APIs and static PNG assets are served correctly', async () => {
  const server = await startServer();
  try {
    const withoutOrigin = await fetch(`http://127.0.0.1:${server.port}/api/data`);
    assert.equal(withoutOrigin.status, 200);

    const withLocalOrigin = await fetch(`http://127.0.0.1:${server.port}/api/data`, {
      headers: { Origin: `http://127.0.0.1:${server.port}` }
    });
    assert.equal(withLocalOrigin.status, 200);

    const response = await fetch(`http://127.0.0.1:${server.port}/token-work-icon.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  } finally {
    await server.stop();
  }
});

test('malformed Host header returns 400 instead of crashing server', async () => {
  const server = await startServer();
  try {
    const response = await rawGet(server.port, '/api/data', { Host: '[' });
    assert.equal(response.statusCode, 400);

    const stillAlive = await fetch(`http://127.0.0.1:${server.port}/api/data`);
    assert.equal(stillAlive.status, 200);
  } finally {
    await server.stop();
  }
});

test('JSON write limits count UTF-8 bytes and keep the server available', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/budget-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '测'.repeat(30_000) })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /请求体过大/);

    const stillAlive = await fetch(`http://127.0.0.1:${server.port}/api/data`);
    assert.equal(stillAlive.status, 200);
  } finally {
    await server.stop();
  }
});

test('non-loopback HOST is refused unless explicitly enabled', async () => {
  const denied = await runServerUntilExit({
    HOST: '0.0.0.0',
    TOKEN_WORK_ALLOW_REMOTE: '',
    INGEST_TOKEN: ''
  });
  assert.notEqual(denied.code, 0);
  assert.match(denied.output, /Refusing to listen on non-loopback host/);

  const missingToken = await runServerUntilExit({
    HOST: '0.0.0.0',
    TOKEN_WORK_ALLOW_REMOTE: '1',
    INGEST_TOKEN: ''
  });
  assert.notEqual(missingToken.code, 0);
  assert.match(missingToken.output, /INGEST_TOKEN/);
});

test('explicit remote ingest mode can bind while Dashboard APIs stay local-Origin guarded', async () => {
  const server = await startServer({
    HOST: '0.0.0.0',
    TOKEN_WORK_ALLOW_REMOTE: '1',
    INGEST_TOKEN: 'test-ingest-token'
  });
  try {
    const loopback = await fetch(`http://127.0.0.1:${server.port}/api/data`);
    assert.equal(loopback.status, 200);

    const badOrigin = await fetch(`http://127.0.0.1:${server.port}/api/data`, {
      headers: { Origin: 'https://example.invalid' }
    });
    assert.equal(badOrigin.status, 403);
  } finally {
    await server.stop();
  }
});

test('ingest is disabled by default and requires explicit bearer token', async () => {
  const server = await startServer({ INGEST_TOKEN: '' });
  try {
    const disabled = await postIngest(server.port, {}, {
      body: ingestPayload()
    });
    assert.equal(disabled.status, 403);
    assert.match((await disabled.json()).error, /Ingest disabled/);
  } finally {
    await server.stop();
  }
});

test('ingest rejects missing or wrong bearer token when enabled', async () => {
  const server = await startServer({ INGEST_TOKEN: 'test-ingest-token' });
  try {
    const missing = await postIngest(server.port, {}, {
      body: ingestPayload()
    });
    assert.equal(missing.status, 401);

    const wrong = await postIngest(server.port, {
      Authorization: 'Bearer wrong-token'
    }, {
      body: ingestPayload()
    });
    assert.equal(wrong.status, 401);
  } finally {
    await server.stop();
  }
});

test('ingest accepts tokened JSON machine requests and writes structured rows', async () => {
  const server = await startServer({ INGEST_TOKEN: 'test-ingest-token' });
  try {
    const accepted = await postIngest(server.port, {
      Authorization: 'Bearer test-ingest-token'
    }, {
      body: ingestPayload()
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { ok: true, daily: 1, sessions: 1, runs: 1 });

    const summary = await fetch(`http://127.0.0.1:${server.port}/api/summary`).then(response => response.json());
    assert.ok(Math.abs(summary.totals.costUSD - 0.0002) < 1e-12);
    const data = await fetch(`http://127.0.0.1:${server.port}/api/data`).then(response => response.json());
    assert.equal(data.sessions[0].model, 'gpt-5.5');
    assert.ok(Math.abs(data.sessions[0].costUSD - 0.0002) < 1e-12);
  } finally {
    await server.stop();
  }
});

test('ingest rejects malformed usage rows without partial writes', async () => {
  const server = await startServer({ INGEST_TOKEN: 'test-ingest-token' });
  try {
    const malformed = await postIngest(server.port, {
      Authorization: 'Bearer test-ingest-token'
    }, {
      body: {
        ...ingestPayload(),
        daily: [{
          ...ingestPayload().daily[0],
          inputTokens: -1
        }]
      }
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /non-negative integer/);

    const summary = await fetch(`http://127.0.0.1:${server.port}/api/summary`).then(response => response.json());
    assert.equal(summary.totals.totalTokens, 0);
  } finally {
    await server.stop();
  }
});

test('ingest rejects non-local browser origins and non-json bodies', async () => {
  const server = await startServer({ INGEST_TOKEN: 'test-ingest-token' });
  try {
    const badOrigin = await postIngest(server.port, {
      Authorization: 'Bearer test-ingest-token',
      Origin: 'https://example.invalid'
    }, {
      body: ingestPayload()
    });
    assert.equal(badOrigin.status, 403);

    const nonJson = await fetch(`http://127.0.0.1:${server.port}/api/ingest`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-ingest-token',
        'Content-Type': 'text/plain'
      },
      body: 'not json'
    });
    assert.equal(nonJson.status, 415);
  } finally {
    await server.stop();
  }
});

async function startServer(extraEnv: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-security-'));
  const pricingCachePath = join(dir, 'official-pricing.json');
  writeFileSync(pricingCachePath, JSON.stringify({
    mode: 'official-cache',
    models: [{
      provider: 'openai',
      model: 'gpt-5.5',
      aliases: ['gpt-5.5'],
      priced: true,
      ratesPerMTok: {
        input: 10,
        cachedInput: 1,
        cacheWrite5m: 10,
        cacheWrite1h: 10,
        output: 20
      },
      sourceProvider: 'openai'
    }]
  }), 'utf8');
  const server = startTestServer({
    dbPath: join(dir, 'usage.sqlite'),
    env: {
      HOST: extraEnv.HOST || '127.0.0.1',
      TOKEN_WORK_ALLOW_REMOTE: '',
      INGEST_TOKEN: '',
      TOKEN_WORK_PRICING_CACHE: pricingCachePath,
      ...extraEnv
    }
  });

  try {
    const port = await waitForTestServer(server);
    return {
      port,
      child: server.child,
      output: () => `${server.output.stdout}${server.output.stderr}`,
      async stop() {
        await stopTestServer(server.child);
        rmSync(dir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function ingestPayload() {
  return {
    daily: [{
      device: 'test-device',
      source: 'test-source',
      usageDate: '2026-06-20',
      model: 'gpt-5.5',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUSD: 999
    }],
    sessions: [{
      device: 'test-device',
      source: 'test-source',
      sessionId: 'test-session',
      lastActivity: '2026-06-20T00:00:00.000Z',
      model: 'gpt-5.5',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUSD: 999
    }],
    runs: [{
      device: 'test-device',
      source: 'test-source',
      status: 'success',
      message: 'ingest security test',
      command: 'fixture'
    }]
  };
}

function postIngest(port, headers = {}, { body = {} } = {}) {
  return fetch(`http://127.0.0.1:${port}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function rawGet(port, path, headers = {}) {
  return new Promise<{ statusCode?: number; headers: IncomingHttpHeaders }>((resolveRequest, rejectRequest) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, res => {
      res.resume();
      res.on('end', () => resolveRequest({ statusCode: res.statusCode, headers: res.headers }));
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

async function runServerUntilExit(extraEnv: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-security-denied-'));
  const server = spawnTestServer({
    dbPath: join(dir, 'usage.sqlite'),
    env: extraEnv
  });

  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stopTestServer(server.child).finally(() => {
          reject(new Error(`server did not exit; output=${server.output.stdout}${server.output.stderr}`));
        });
      }, 5000);
      server.child.once('exit', exitCode => {
        clearTimeout(timer);
        resolve(exitCode);
      });
      server.child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return { code, output: `${server.output.stdout}${server.output.stderr}` };
  } finally {
    await stopTestServer(server.child);
    rmSync(dir, { recursive: true, force: true });
  }
}
