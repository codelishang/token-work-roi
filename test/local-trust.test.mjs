import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocalTrust,
  buildLocalTrustSamples,
  sanitizeSessionLabel
} from '../src/local-trust.mjs';

test('buildLocalTrust marks verified event-level data as ROI-ready', () => {
  const trust = buildLocalTrust({
    runtime: runtime('real-event-verified', { tokenEventRows: 1 }),
    coverageBridge: {
      summary: { sourcesWithUsage: 1, successfulCoverage: 1 },
      rows: [{
        id: 'codex',
        label: 'Codex CLI',
        status: 'native-trusted',
        statusLabel: '原生可信采集',
        detected: true,
        successfulCoverage: true,
        sessions: 1,
        tokenEvents: 1,
        totalTokens: 120
      }]
    },
    sourceHealth: [],
    daily: [{ source: 'Codex CLI', totalTokens: 120 }],
    sessions: [{ source: 'Codex CLI', sessionId: 's1', projectAlias: 'Token Work', totalTokens: 120 }],
    tokenEvents: [{ source: 'Codex CLI', sessionId: 's1', inputTokens: 100, outputTokens: 20 }],
    evidenceFlywheel: {
      quality: { directWriteCount: 1, draftCount: 0, blockedCount: 0, manualConfirmedCount: 0 },
      totals: { recognizedProjectCount: 1 }
    }
  });

  assert.equal(trust.conclusion.level, 'trusted');
  assert.equal(trust.conclusion.canUseForRoiReview, true);
  assert.equal(trust.security.level, 'local-only');
  assert.equal(trust.security.dashboardApiRemoteAccess, false);
  assert.equal(trust.reconciliation.status, 'ok');
  assert.equal(trust.sources[0].conclusion, '可用于 ROI 复盘');
  assert.equal(trust.evidence.trustedSessionCount, 1);
  assert.equal(trust.evidence.trustedTokenTotal, 120);
});

test('buildLocalTrust explains aggregate-only and demo states without pretending they are trusted', () => {
  const aggregate = buildLocalTrust({
    runtime: runtime('real-aggregate-only', { sessionRows: 1 }),
    daily: [{ totalTokens: 120 }],
    sessions: [{ totalTokens: 120 }],
    tokenEvents: []
  });
  const demo = buildLocalTrust({
    runtime: runtime('demo', { sessionRows: 1, tokenEventRows: 1 }),
    daily: [{ totalTokens: 120 }],
    sessions: [{ totalTokens: 120 }],
    tokenEvents: [{ inputTokens: 120 }]
  });

  assert.equal(aggregate.conclusion.level, 'trend-only');
  assert.equal(aggregate.conclusion.canUseForRoiReview, false);
  assert.equal(aggregate.reconciliation.status, 'not-applicable');
  assert.equal(demo.conclusion.level, 'demo');
  assert.equal(demo.conclusion.canUseForRoiReview, false);
});

test('buildLocalTrust flags large daily/session/event mismatches as risk', () => {
  const trust = buildLocalTrust({
    runtime: runtime('real-event-verified', { tokenEventRows: 1 }),
    daily: [{ totalTokens: 1000 }],
    sessions: [{ totalTokens: 1000 }],
    tokenEvents: [{ inputTokens: 100 }]
  });

  assert.equal(trust.reconciliation.status, 'risk');
  assert.equal(trust.conclusion.level, 'needs-coverage');
});

test('buildLocalTrust reconciles against full event totals while samples stay limited', () => {
  const trust = buildLocalTrust({
    runtime: runtime('real-event-verified', { tokenEventRows: 50000 }),
    daily: [{ source: 'Codex CLI', totalTokens: 1000 }],
    sessions: [{ source: 'Codex CLI', sessionId: 's1', totalTokens: 1000 }],
    tokenEvents: [{ source: 'Codex CLI', sessionId: 'sample', inputTokens: 10 }],
    tokenEventTotals: [{ source: 'Codex CLI', inputTokens: 900, outputTokens: 100 }]
  });

  assert.equal(trust.samples.length, 1);
  assert.equal(trust.reconciliation.status, 'ok');
  assert.equal(trust.conclusion.level, 'trusted');
});

test('buildLocalTrust surfaces remote ingest mode without relaxing Dashboard APIs', () => {
  const trust = buildLocalTrust({
    runtime: runtime('real-event-verified', { tokenEventRows: 1 }, {
      server: {
        bindHost: 'non-loopback',
        loopbackBind: false,
        allowRemote: true,
        remoteIngestMode: true,
        ingestTokenConfigured: true,
        dashboardApiRemoteAccess: false,
        readGuard: 'loopback + local Origin',
        writeGuard: 'loopback + local Origin + JSON',
        xForwardedForTrusted: false
      }
    }),
    daily: [{ source: 'Codex CLI', totalTokens: 100 }],
    sessions: [{ source: 'Codex CLI', sessionId: 's1', totalTokens: 100 }],
    tokenEvents: [{ source: 'Codex CLI', sessionId: 's1', inputTokens: 80, outputTokens: 20 }]
  });

  assert.equal(trust.security.level, 'remote-ingest');
  assert.equal(trust.security.remoteIngestMode, true);
  assert.equal(trust.security.dashboardApiRemoteAccess, false);
  assert.equal(trust.security.xForwardedForTrusted, false);
});

test('sample rows and session labels never expose full local paths', () => {
  const samples = buildLocalTrustSamples({
    tokenEvents: [{
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\HighROIProjects\\secret-project:gpt-5.5',
      timestamp: '2026-06-18T10:00:00Z',
      model: 'gpt-5.5',
      inputTokens: 100,
      outputTokens: 20
    }],
    sessions: []
  });
  const text = JSON.stringify(samples);

  assert.equal(samples[0].session, 'secret-project · gpt-5.5');
  assert.equal(text.includes('D:\\HighROIProjects'), false);
  assert.equal(sanitizeSessionLabel('/Users/ryan/private/repo/session.jsonl'), 'session.jsonl');
});

function runtime(id, counts = {}, overrides = {}) {
  return {
    packageVersion: '1.0.0',
    demoMode: id === 'demo',
    db: { kind: id === 'demo' ? 'demo sqlite' : 'real sqlite', fileName: 'usage.sqlite' },
    counts: {
      dailyRows: 0,
      sessionRows: 0,
      tokenEventRows: 0,
      collectionRuns: 0,
      ...counts
    },
    dataMode: {
      id,
      label: id,
      message: `${id} message`
    },
    server: {
      bindHost: '127.0.0.1',
      loopbackBind: true,
      allowRemote: false,
      remoteIngestMode: false,
      ingestTokenConfigured: false,
      dashboardApiRemoteAccess: false,
      readGuard: 'loopback + local Origin',
      writeGuard: 'loopback + local Origin + JSON',
      xForwardedForTrusted: false
    },
    coverageGate: {
      status: id === 'real-event-verified' ? 'passed' : 'not-run',
      message: 'coverage state'
    },
    ...overrides
  };
}
