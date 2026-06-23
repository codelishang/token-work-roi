import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoiEvidence } from '../src/client/review/roi-evidence.js';

test('ROI evidence score rewards complete manual attribution and outputs', () => {
  const evidence = buildRoiEvidence({
    workItems: [{ id: 1 }],
    sessions: [
      {
        projectAlias: 'Token Work ROI',
        taskType: '功能开发',
        outputStatus: '已发布',
        workPurpose: '功能开发',
        workStage: '发布',
        valueLevel: '高',
        annotationSource: 'manual',
        outputUrl: 'https://example.com/pr/1',
        totalTokens: 1000,
        costUSD: 1
      }
    ]
  });
  assert.equal(evidence.evidenceScore, 100);
  assert.equal(evidence.complete, 1);
  assert.equal(evidence.withOutput, 1);
});

test('ROI evidence surfaces high cost gaps when fields are missing', () => {
  const evidence = buildRoiEvidence({
    sessions: [
      {
        projectPath: 'D:/Projects/token-work-roi',
        taskType: '未分类',
        outputStatus: '未标注',
        workPurpose: '未说明',
        workStage: '未说明',
        valueLevel: '未评估',
        annotationSource: 'auto',
        annotationConfidence: 85,
        sessionId: 's1',
        totalTokens: 5000,
        costUSD: 9
      }
    ]
  });
  assert.equal(evidence.evidenceScore < 50, true);
  assert.equal(evidence.highCostGaps[0].missing.includes('人工确认'), true);
});
