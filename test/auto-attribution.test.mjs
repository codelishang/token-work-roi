import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachAutoSuggestions,
  buildAutoAttributionPlan,
  buildAutoAttributionSuggestion
} from '../src/auto-attribution.mjs';

const baseSession = {
  device: 'local',
  source: 'Codex CLI',
  sessionId: 'local:codex:D:\\HighROIProjects\\TokenWork:gpt-5.5',
  projectPath: 'D:\\HighROIProjects\\TokenWork',
  taskType: '未分类',
  outputStatus: '未标注',
  workPurpose: '未说明',
  workStage: '未说明',
  valueLevel: '未评估',
  inputTokens: 100_000,
  outputTokens: 20_000,
  totalTokens: 120_000,
  costUSD: 3,
  lastActivity: '2026-06-15'
};

test('project alias rules create high-confidence suggestions', () => {
  const suggestion = buildAutoAttributionSuggestion(baseSession, {
    projectAliasRules: [{
      enabled: true,
      matchType: 'prefix',
      pattern: 'D:\\HighROIProjects\\TokenWork',
      projectAlias: 'Token Work'
    }],
    now: new Date('2026-06-30T00:00:00Z')
  });

  assert.equal(suggestion.values.projectAlias, 'Token Work');
  assert.equal(suggestion.annotationConfidence, 92);
  assert.equal(suggestion.canApply, true);
  assert.match(suggestion.annotationReason, /项目别名规则/);
});

test('output links infer productive work without writing critical value', () => {
  const suggestion = buildAutoAttributionSuggestion({
    ...baseSession,
    outputUrl: 'https://github.com/example/repo/pull/42',
    outputType: 'PR'
  });

  assert.equal(suggestion.values.taskType, '功能开发');
  assert.equal(suggestion.values.outputStatus, '已完成');
  assert.equal(suggestion.values.workPurpose, '功能开发');
  assert.equal(suggestion.values.workStage, '实现');
  assert.equal(suggestion.values.valueLevel, '中');
  assert.notEqual(suggestion.values.valueLevel, '关键');
  assert.equal(suggestion.annotationConfidence, 80);
});

test('deploy output infers published high value but not critical value', () => {
  const suggestion = buildAutoAttributionSuggestion({
    ...baseSession,
    outputUrl: 'https://example.com/app',
    outputType: '部署'
  });

  assert.equal(suggestion.values.outputStatus, '已发布');
  assert.equal(suggestion.values.workStage, '发布');
  assert.equal(suggestion.values.valueLevel, '高');
  assert.notEqual(suggestion.values.valueLevel, '关键');
  assert.equal(suggestion.annotationConfidence, 80);
});

test('high input low output only creates low-confidence review suggestions', () => {
  const suggestion = buildAutoAttributionSuggestion({
    ...baseSession,
    projectPath: '',
    inputTokens: 900_000,
    outputTokens: 50_000,
    totalTokens: 1_000_000
  }, {
    now: new Date('2026-06-30T00:00:00Z')
  });

  assert.equal(suggestion.values.taskType, '技术调研');
  assert.equal(suggestion.values.workPurpose, '上下文整理');
  assert.equal(suggestion.values.outputStatus, '未标注');
  assert.equal(suggestion.annotationConfidence, 65);
  assert.equal(suggestion.canApply, false);
});

test('model layer and recent activity only create low-confidence drafts', () => {
  const suggestion = buildAutoAttributionSuggestion({
    ...baseSession,
    sessionId: 'heavy-active',
    projectPath: '',
    model: 'gpt-5.5',
    inputTokens: 70_000,
    outputTokens: 30_000,
    totalTokens: 100_000,
    lastActivity: '2026-06-16T12:00:00Z'
  }, {
    now: new Date('2026-06-17T00:00:00Z')
  });

  assert.equal(suggestion.values.taskType, '技术调研');
  assert.equal(suggestion.values.workPurpose, '技术调研');
  assert.equal(suggestion.values.workStage, '探索');
  assert.equal(suggestion.values.outputStatus, '进行中');
  assert.equal(suggestion.annotationConfidence, 60);
  assert.equal(suggestion.canApply, false);
  assert.match(suggestion.annotationReason, /模型层级/);
});

test('manual or imported annotations are never suggested for overwrite', () => {
  assert.equal(buildAutoAttributionSuggestion({
    ...baseSession,
    annotationSource: 'manual',
    annotationConfidence: 100
  }), null);
  assert.equal(buildAutoAttributionSuggestion({
    ...baseSession,
    annotationSource: 'imported',
    annotationConfidence: 100
  }), null);
});

test('plan reports lazy-mode reduction and attaches suggestions', () => {
  const sessions = [
    { ...baseSession, sessionId: 's1', outputUrl: 'https://example.com/doc', outputType: '文档' },
    { ...baseSession, sessionId: 's2', annotationSource: 'manual', taskType: '功能开发' }
  ];
  const plan = buildAutoAttributionPlan({ sessions, now: new Date('2026-06-16T00:00:00Z') });
  const attached = attachAutoSuggestions(sessions, plan.suggestions);

  assert.equal(plan.highConfidenceCount, 1);
  assert.equal(plan.lowConfidenceCount, 0);
  assert.equal(attached[0].autoSuggestion.canApply, true);
  assert.equal(attached[1].autoSuggestion, null);
});
