import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectCoverage, buildReviewWorkflow } from '../src/project-coverage.mjs';

test('project coverage separates real project attribution from source coverage', () => {
  const sessions = [{
    projectAlias: 'Token Work',
    annotationSource: 'manual',
    taskType: '功能开发',
    outputStatus: '已发布',
    workPurpose: '功能开发',
    workStage: '发布',
    valueLevel: '高',
    totalTokens: 1000,
    costUSD: 1
  }, {
    projectPath: 'D:/Work/Argus',
    annotationSource: 'auto',
    attributionQuality: 'auto-high',
    taskType: '技术调研',
    outputStatus: '进行中',
    workPurpose: '上下文整理',
    workStage: '探索',
    valueLevel: '中',
    totalTokens: 800,
    costUSD: 0.8
  }, {
    sessionId: 'plain-session-id',
    taskType: '未分类',
    outputStatus: '未标注',
    workPurpose: '未说明',
    workStage: '未说明',
    valueLevel: '未评估',
    totalTokens: 500,
    costUSD: 0.5
  }];

  const coverage = buildProjectCoverage({ sessions });
  assert.equal(coverage.projectCount, 2);
  assert.equal(coverage.unknownSessionCount, 1);
  assert.equal(coverage.manualSessionCount, 1);
  assert.equal(coverage.autoHighSessionCount, 1);
  assert.equal(coverage.pendingSessionCount, 1);
  assert.equal(coverage.pendingTokens, 500);
  assert.equal(coverage.projectRows[0].project, 'Token Work');
});

test('review workflow summarizes high-cost project and open actions', () => {
  const workflow = buildReviewWorkflow({
    sessions: [{
      projectAlias: 'Project A',
      outputStatus: '已发布',
      outputUrl: 'https://example.com/deploy',
      taskType: '功能开发',
      workPurpose: '功能开发',
      workStage: '发布',
      valueLevel: '高',
      totalTokens: 2000,
      costUSD: 2
    }, {
      projectAlias: 'Project B',
      outputStatus: '未标注',
      taskType: '未分类',
      workPurpose: '未说明',
      workStage: '未说明',
      valueLevel: '未评估',
      totalTokens: 3000,
      costUSD: 3
    }],
    advisorActions: [
      { status: 'open' },
      { status: 'done' }
    ]
  });

  assert.equal(workflow.highCostProject.project, 'Project B');
  assert.equal(workflow.pendingSessionCount, 1);
  assert.equal(workflow.pendingCostUSD, 3);
  assert.equal(workflow.completedOrPublishedCount, 1);
  assert.equal(workflow.publishedOutputCount, 1);
  assert.equal(workflow.openAdvisorActionCount, 1);
});
