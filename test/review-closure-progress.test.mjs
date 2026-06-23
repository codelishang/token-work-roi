import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewClosureProgress,
  hasClosureOutputLink,
  isClosureAttributedSession
} from '../src/client/review/closure-progress.js';

const baseSession = {
  device: 'local',
  source: 'Codex CLI',
  sessionId: 'session-1',
  projectAlias: 'Token Work',
  taskType: '功能开发',
  outputStatus: '已完成',
  workPurpose: '功能开发',
  workStage: '实现',
  valueLevel: '高',
  totalTokens: 1000,
  costUSD: 1.2,
  model: 'gpt-5.3-codex'
};

test('closure attribution requires project alias plus v3 review labels', () => {
  assert.equal(isClosureAttributedSession(baseSession), true);
  assert.equal(isClosureAttributedSession({ ...baseSession, projectAlias: '' }), false);
  assert.equal(isClosureAttributedSession({ ...baseSession, valueLevel: '未评估' }), false);
});

test('closure output links only count completed or published http urls', () => {
  assert.equal(hasClosureOutputLink({
    ...baseSession,
    outputStatus: '已发布',
    outputUrl: 'https://example.com/pr/1'
  }), true);
  assert.equal(hasClosureOutputLink({
    ...baseSession,
    outputStatus: '进行中',
    outputUrl: 'https://example.com/pr/1'
  }), false);
  assert.equal(hasClosureOutputLink({
    ...baseSession,
    outputStatus: '已完成',
    outputUrl: 'file:///private.txt'
  }), false);
});

test('buildReviewClosureProgress tracks P0 real-data acceptance gates', () => {
  const completeSessions = Array.from({ length: 10 }, (_, index) => ({
    ...baseSession,
    sessionId: `complete-${index + 1}`,
    totalTokens: 1000 + index,
    costUSD: 1 + index / 10,
    outputStatus: index < 3 ? '已发布' : '已完成',
    outputUrl: index < 3 ? `https://example.com/output/${index + 1}` : ''
  }));

  const progress = buildReviewClosureProgress({
    sessions: [
      ...completeSessions,
      {
        ...baseSession,
        sessionId: 'missing-project',
        projectAlias: '',
        totalTokens: 9000,
        costUSD: 9
      }
    ],
    roiAdvice: [
      { id: 'attribute-high-cost-work', category: '补标注' },
      { id: 'reduce-context-bloat', category: '上下文压缩' }
    ]
  });

  assert.equal(progress.status, 'complete');
  assert.equal(progress.completedChecks, 4);
  assert.equal(progress.checks.find(check => check.id === 'real-attribution').current, 10);
  assert.equal(progress.checks.find(check => check.id === 'lazy-auto-attribution').complete, true);
  assert.equal(progress.checks.find(check => check.id === 'output-links').current, 3);
  assert.equal(progress.checks.find(check => check.id === 'non-label-advice').current, 1);
  assert.deepEqual(progress.topGaps[0].missingFields, ['项目别名']);
});

test('buildReviewClosureProgress surfaces next actions when gates are not met', () => {
  const progress = buildReviewClosureProgress({
    sessions: [
      { ...baseSession, sessionId: 'missing-value', valueLevel: '未评估', totalTokens: 5000, costUSD: 5 },
      { ...baseSession, sessionId: 'missing-project', projectAlias: '', totalTokens: 7000, costUSD: 7 }
    ],
    roiAdvice: [{ id: 'attribute-high-cost-work', category: '补标注' }]
  });

  assert.equal(progress.status, 'needs-work');
  assert.equal(progress.remainingChecks, 4);
  assert.equal(progress.topGaps[0].sessionId, 'missing-project');
  assert.match(progress.nextActions.join('\n'), /先处理 missing-project/);
  assert.match(progress.nextActions.join('\n'), /产出链接/);
  assert.match(progress.nextActions.join('\n'), /ROI Advisor/);
});
