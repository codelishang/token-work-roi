import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewAttributionProgress,
  buildReviewAttributionChecklist,
  buildReviewUnattributedSessions,
  buildAttributionStatusSummary,
  buildUnattributedSessions,
  isReviewUnattributedSession,
  isUnattributedSession
} from '../src/client/dashboard/attribution.js';

const sessions = [
  {
    sessionId: 'published',
    taskType: '功能开发',
    outputStatus: '已发布',
    workPurpose: '功能开发',
    workStage: '发布',
    valueLevel: '高',
    inputTokens: 60,
    outputTokens: 40,
    totalTokens: 100,
    costUSD: 1
  },
  {
    sessionId: 'completed-without-task',
    taskType: '未分类',
    outputStatus: '已完成',
    workPurpose: '功能开发',
    workStage: '实现',
    valueLevel: '中',
    inputTokens: 30,
    outputTokens: 20,
    totalTokens: 50,
    costUSD: 0.5
  },
  {
    sessionId: 'unmarked-status',
    taskType: '问题修复',
    outputStatus: '未标注',
    workPurpose: '调试修复',
    workStage: '验证',
    valueLevel: '中',
    inputTokens: 15,
    outputTokens: 10,
    totalTokens: 25,
    costUSD: 0.25
  },
  {
    sessionId: 'discarded',
    taskType: '技术调研',
    outputStatus: '已废弃',
    workPurpose: '未说明',
    workStage: '探索',
    valueLevel: '低',
    inputTokens: 20,
    outputTokens: 5,
    totalTokens: 25,
    costUSD: 0.1
  }
];

test('isUnattributedSession uses the broad task-or-status rule', () => {
  assert.equal(isUnattributedSession(sessions[0]), false);
  assert.equal(isUnattributedSession(sessions[1]), true);
  assert.equal(isUnattributedSession(sessions[2]), true);
  assert.equal(isUnattributedSession({}), true);
});

test('isReviewUnattributedSession also requires purpose stage and value', () => {
  assert.equal(isReviewUnattributedSession(sessions[0]), false);
  assert.equal(isReviewUnattributedSession(sessions[1]), true);
  assert.equal(isReviewUnattributedSession(sessions[2]), true);
  assert.equal(isReviewUnattributedSession(sessions[3]), true);
  assert.equal(isReviewUnattributedSession({
    taskType: '功能开发',
    outputStatus: '已完成',
    workPurpose: '功能开发',
    workStage: '未说明',
    valueLevel: '高'
  }), true);
});

test('buildReviewUnattributedSessions sorts v3 review gaps by token cost', () => {
  const rows = buildReviewUnattributedSessions(sessions);
  assert.deepEqual(rows.map(row => row.sessionId), ['completed-without-task', 'unmarked-status', 'discarded']);
});

test('buildReviewAttributionProgress reports session and token completion', () => {
  const progress = buildReviewAttributionProgress(sessions);

  assert.equal(progress.sessionCount, 4);
  assert.equal(progress.attributedSessionCount, 1);
  assert.equal(progress.unattributedSessionCount, 3);
  assert.equal(progress.totalTokens, 200);
  assert.equal(progress.attributedTokens, 100);
  assert.equal(progress.unattributedTokens, 100);
  assert.equal(progress.completionShare, 0.25);
  assert.equal(progress.tokenCompletionShare, 0.5);
});

test('buildReviewAttributionChecklist copies highest cost real work gaps', () => {
  const checklist = buildReviewAttributionChecklist([
    ...sessions,
    {
      sessionId: '=danger',
      projectAlias: '+formula|project',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '未说明',
      workStage: '未说明',
      valueLevel: '未评估',
      totalTokens: 75,
      costUSD: 2,
      model: 'gpt-5.5',
      source: 'Codex CLI',
      lastActivity: '2026-06-12'
    }
  ], {
    limit: 2,
    generatedAt: new Date(2026, 5, 12, 9, 30)
  });

  assert.match(checklist, /^# Token Work 归因工作清单/);
  assert.match(checklist, /不包含对话正文/);
  assert.match(checklist, /人工核对项目、任务、目的、阶段、价值和产出状态/);
  assert.match(checklist, /任务类型/);
  assert.match(checklist, /工作目的、工作阶段、产出价值/);
  assert.match(checklist, /'\=danger/);
  assert.match(checklist, /'\+formula\\\|project/);
  assert.equal(checklist.includes('unmarked-status'), false);
});

test('buildUnattributedSessions filters and sorts highest token work first', () => {
  const rows = buildUnattributedSessions(sessions);
  assert.deepEqual(rows.map(row => row.sessionId), ['completed-without-task', 'unmarked-status']);
});

test('buildAttributionStatusSummary aggregates output status and unattributed rows', () => {
  const summary = buildAttributionStatusSummary(sessions);
  const byId = Object.fromEntries(summary.map(row => [row.id, row]));

  assert.equal(byId.published.sessionCount, 1);
  assert.equal(byId.published.totalTokens, 100);
  assert.equal(byId.published.costUSD, 1);
  assert.equal(byId.published.share, 0.5);

  assert.equal(byId.completed.sessionCount, 1);
  assert.equal(byId.completed.totalTokens, 50);
  assert.equal(byId.completed.share, 0.25);

  assert.equal(byId.inProgress.sessionCount, 0);
  assert.equal(byId.inProgress.totalTokens, 0);

  assert.equal(byId.discarded.sessionCount, 1);
  assert.equal(byId.discarded.totalTokens, 25);
  assert.equal(byId.discarded.share, 0.125);

  assert.equal(byId.unattributed.sessionCount, 2);
  assert.equal(byId.unattributed.totalTokens, 75);
  assert.equal(byId.unattributed.costUSD, 0.75);
  assert.equal(byId.unattributed.share, 0.375);
});
