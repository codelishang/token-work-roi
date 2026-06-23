import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrustEvidenceQueue } from '../src/client/dashboard/trust-evidence-queue.js';

const trust = {
  sources: [
    { id: 'claude', label: 'Claude Code', successfulCoverage: true, conclusion: '可用于 ROI 复盘' },
    { id: 'cursor', label: 'Cursor', successfulCoverage: false, conclusion: '仅检测到' }
  ]
};

test('buildTrustEvidenceQueue only includes trusted coverage sources', () => {
  const queue = buildTrustEvidenceQueue({
    trust,
    evidencePlan: {
      suggestions: [
        suggestion({ suggestionId: 'claude-1', source: 'Claude Code', totalTokens: 1000, costUSD: 3 }),
        suggestion({ suggestionId: 'cursor-1', source: 'Cursor', totalTokens: 999999, costUSD: 999 })
      ]
    }
  });

  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0].suggestionId, 'claude-1');
  assert.equal(queue.trustedSuggestionCount, 1);
  assert.equal(queue.trustedSourceCount, 1);
});

test('buildTrustEvidenceQueue sorts by official price then tokens and limits to ten', () => {
  const suggestions = Array.from({ length: 12 }, (_, index) =>
    suggestion({
      suggestionId: `row-${index}`,
      source: 'claude',
      totalTokens: 1000 + index,
      costUSD: index === 3 ? 50 : index
    })
  );
  const queue = buildTrustEvidenceQueue({ trust, evidencePlan: { suggestions }, limit: 10 });

  assert.equal(queue.rows.length, 10);
  assert.equal(queue.rows[0].suggestionId, 'row-3');
  assert.equal(queue.rows[1].suggestionId, 'row-11');
  assert.equal(queue.rows.at(-1).suggestionId, 'row-2');
});

test('buildTrustEvidenceQueue reports apply and draft counts with field labels', () => {
  const queue = buildTrustEvidenceQueue({
    trust,
    evidencePlan: {
      suggestions: [
        suggestion({
          suggestionId: 'apply',
          source: 'claude',
          canApply: true,
          fields: ['projectAlias', 'taskType', 'workStage'],
          suggestedValues: { projectAlias: 'Token Work' }
        }),
        suggestion({
          suggestionId: 'draft',
          source: 'claude',
          canApply: false,
          fields: ['outputUrl', 'outputType']
        })
      ]
    }
  });

  assert.equal(queue.canApplyCount, 1);
  assert.equal(queue.draftCount, 1);
  assert.deepEqual(queue.rows[0].missingFields.slice(0, 3), ['项目', '任务', '阶段']);
  assert.match(queue.rows[0].whyTrusted, /Claude Code/);
});

function suggestion(overrides = {}) {
  return {
    suggestionId: 's1',
    kind: 'annotation',
    title: '自动补齐归因',
    project: 'Demo',
    source: 'claude',
    model: 'sonnet',
    sessionId: 'session-1',
    provenance: '自动高置信',
    confidence: 88,
    totalTokens: 100,
    costUSD: 1,
    canApply: false,
    fields: ['projectAlias'],
    suggestedValues: {},
    reason: 'fixture',
    action: 'fixture',
    ...overrides
  };
}
