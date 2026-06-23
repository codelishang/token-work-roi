import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectRoiRows,
  buildRiskDistribution,
  buildWeeklyReview
} from '../src/client/dashboard/attribution.js';

const sessions = [
  {
    sessionId: 'published',
    projectAlias: 'Token Work',
    taskType: '功能开发',
    outputStatus: '已发布',
    lastActivity: '2026-06-10',
    totalTokens: 1000,
    costUSD: 1,
    outputUrl: 'https://example.com/published',
    outputLabel: '发布页'
  },
  {
    sessionId: 'completed',
    projectAlias: 'Token Work',
    taskType: '问题修复',
    outputStatus: '已完成',
    lastActivity: '2026-06-09',
    totalTokens: 500,
    costUSD: 0.5
  },
  {
    sessionId: 'discarded',
    projectPath: 'D:\\Other',
    taskType: '技术调研',
    outputStatus: '已废弃',
    lastActivity: '2026-06-08',
    totalTokens: 300,
    costUSD: 0.3
  },
  {
    sessionId: 'unattributed',
    projectPath: 'D:\\Other',
    taskType: '未分类',
    outputStatus: '进行中',
    lastActivity: '2026-06-07',
    totalTokens: 200,
    costUSD: 0.2
  },
  {
    sessionId: 'old',
    projectAlias: 'Old Project',
    taskType: '功能开发',
    outputStatus: '已发布',
    lastActivity: '2026-05-01',
    totalTokens: 900,
    costUSD: 0.9,
    outputUrl: 'https://example.com/old'
  }
];

test('buildRiskDistribution aggregates unattributed, in-progress and discarded cost shares', () => {
  const rows = buildRiskDistribution(sessions);
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));

  assert.equal(byId.unattributed.sessionCount, 1);
  assert.equal(byId.unattributed.totalTokens, 200);
  assert.equal(byId.inProgress.sessionCount, 1);
  assert.equal(byId.inProgress.totalTokens, 200);
  assert.equal(byId.discarded.sessionCount, 1);
  assert.equal(byId.discarded.costUSD, 0.3);
  assert.equal(Number(byId.discarded.share.toFixed(4)), Number((300 / 2900).toFixed(4)));
});

test('buildProjectRoiRows keeps project status buckets consistent with session totals', () => {
  const rows = buildProjectRoiRows(sessions);
  const tokenStudio = rows.find(row => row.project === 'Token Work');
  const other = rows.find(row => row.project === 'D:\\Other');

  assert.equal(tokenStudio.sessionCount, 2);
  assert.equal(tokenStudio.totalTokens, 1500);
  assert.equal(tokenStudio.publishedTokens, 1000);
  assert.equal(tokenStudio.completedTokens, 500);
  assert.equal(tokenStudio.productiveShare, 1);

  assert.equal(other.totalTokens, 500);
  assert.equal(other.discardedTokens, 300);
  assert.equal(other.unattributedTokens, 200);
  assert.equal(other.riskShare, 1);
});

test('buildWeeklyReview uses the last seven days and exposes published output links', () => {
  const weekly = buildWeeklyReview(sessions, { today: '2026-06-10' });

  assert.equal(weekly.startDate, '2026-06-04');
  assert.equal(weekly.endDate, '2026-06-10');
  assert.equal(weekly.totals.totalTokens, 2000);
  assert.equal(weekly.highCostProjects[0].project, 'Token Work');
  assert.equal(weekly.discarded.totalTokens, 300);
  assert.deepEqual(weekly.unattributedQueue.map(row => row.sessionId), ['unattributed']);
  assert.equal(weekly.publishedOutputs.length, 1);
  assert.equal(weekly.publishedOutputs[0].outputLabel, '发布页');
});
