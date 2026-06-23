import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceFlywheel } from '../src/evidence-flywheel.mjs';

test('evidence flywheel turns structured session evidence into review progress', () => {
  const flywheel = buildEvidenceFlywheel({
    sessions: [
      {
        source: 'Codex CLI',
        sessionId: 'local:codex:D:\\HighROIProjects\\token-work:gpt-5.5',
        projectPath: 'D:\\HighROIProjects\\token-work',
        projectAlias: 'Token Work',
        model: 'gpt-5.5',
        totalTokens: 5000,
        costUSD: 2.5,
        taskType: '功能开发',
        outputStatus: '已发布',
        workPurpose: '功能开发',
        workStage: '发布',
        valueLevel: '高',
        annotationSource: 'auto',
        annotationConfidence: 90,
        outputUrl: 'https://github.com/codelishang/token-work-roi/commit/abc123',
        outputType: 'commit'
      }
    ],
    workItems: [{ id: 1 }],
    advisorActions: [{ status: 'open' }],
    evidencePlan: {
      canApplyCount: 1,
      draftCount: 2,
      suggestions: [
        {
          suggestionId: 'draft:1',
          title: '待确认项目',
          project: 'Token Work',
          confidence: 68,
          canApply: false,
          totalTokens: 3000,
          costUSD: 1,
          reason: '需要人工确认。'
        },
        {
          suggestionId: 'blocked:1',
          title: '缺远程 URL',
          project: 'Token Work',
          confidence: 40,
          canApply: false,
          totalTokens: 2000,
          costUSD: 0.5,
          reason: 'D:\\private\\path 缺少 HTTPS remote。'
        }
      ]
    },
    coverageBridge: { summary: { sourcesWithUsage: 1 } }
  });

  assert.equal(flywheel.totals.sessionCount, 1);
  assert.equal(flywheel.totals.recognizedProjectCount, 1);
  assert.equal(flywheel.totals.autoEvidenceCount, 1);
  assert.equal(flywheel.totals.outputEvidenceCount, 1);
  assert.equal(flywheel.totals.strategyEvidenceCount, 1);
  assert.equal(flywheel.totals.openAdvisorActionCount, 1);
  assert.equal(flywheel.steps.find(step => step.id === 'real-token').complete, true);
  assert.equal(flywheel.queues.highCostGaps.length, 0);
  assert.equal(flywheel.quality.directWriteCount, 1);
  assert.equal(flywheel.quality.draftCount, 2);
  assert.equal(flywheel.quality.blockedCount, 1);
  assert.equal(flywheel.queues.confirmationDrafts.length, 1);
  assert.equal(flywheel.queues.blockedEvidence.length, 1);
  assert.equal(JSON.stringify(flywheel).includes('D:\\private'), false);
});

test('evidence flywheel queue rows hide full local paths', () => {
  const flywheel = buildEvidenceFlywheel({
    sessions: [
      {
        source: 'Codex CLI',
        sessionId: 'local:codex:C:\\Users\\ryan\\private-project:gpt-5.5',
        projectPath: 'C:\\Users\\ryan\\private-project',
        model: 'gpt-5.5',
        totalTokens: 9000,
        costUSD: 9,
        taskType: '未分类',
        outputStatus: '未标注',
        workPurpose: '未说明',
        workStage: '未说明',
        valueLevel: '未评估'
      }
    ]
  });

  const text = JSON.stringify(flywheel);
  assert.equal(text.includes('C:\\Users\\ryan'), false);
  assert.equal(flywheel.queues.highCostGaps[0].project, 'private-project');
});
