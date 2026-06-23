import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProfessionalEvidencePack,
  buildResumeAndInterviewPack,
  buildTechnicalBlogDraft,
  escapeMarkdownFormula
} from '../src/client/review/export-materials.js';

const period = {
  pretty: '2026 年 6 月',
  start: '2026-06-01',
  end: '2026-06-20'
};

const sessions = [{
  sessionId: 's1',
  source: 'Codex CLI',
  projectAlias: 'Token Work',
  taskType: '未分类',
  outputStatus: '未标注',
  workPurpose: '未说明',
  workStage: '未说明',
  valueLevel: '未评估',
  totalTokens: 50000,
  costUSD: 25
}, {
  sessionId: 's2',
  source: 'Claude Code',
  projectAlias: 'Token Work',
  taskType: '功能开发',
  outputStatus: '已发布',
  workPurpose: '功能开发',
  workStage: '发布',
  valueLevel: '高',
  outputUrl: 'https://example.com/pr/1',
  totalTokens: 20000,
  costUSD: 8
}];

const totals = {
  total: 70000,
  input: 52000,
  output: 14000,
  cost: 33
};

const eventVerifiedTrust = {
  conclusion: {
    decision: '当前真实 SQLite 有 event 级 token，并且 daily/session/event 总量可校验。',
    action: '进入 Evidence Flywheel，优先确认最高成本草稿。'
  },
  dataMode: { label: 'Real DB - event verified' },
  runtime: { coverageGate: { status: 'passed' } },
  counts: { tokenEventRows: 1234 },
  reconciliation: {
    statusLabel: '总量一致',
    note: 'daily/session/event token 合计在 1% 内。'
  }
};

const aggregateOnlyTrust = {
  conclusion: {
    decision: '当前只有 daily/session 聚合数据，只能看趋势。',
    action: '重新运行 coverage 后再做强 ROI 结论。'
  },
  dataMode: { label: 'Real DB - aggregate only' },
  runtime: { coverageGate: { status: 'not-run' } },
  counts: { tokenEventRows: 0 },
  reconciliation: { statusLabel: '未校验' }
};

const coverageBridge = {
  summary: {
    nativeTrusted: 2,
    importable: 5,
    experimental: 3,
    detectedOnly: 8,
    unsupported: 2
  }
};

const evidenceFlywheel = {
  score: 40,
  completedSteps: 3,
  totalSteps: 6,
  nextAction: '先确认最高成本自动草稿。',
  quality: {
    directWriteCount: 1,
    draftCount: 4,
    manualConfirmedCount: 0
  },
  totals: {
    outputEvidenceCount: 1
  }
};

const autopilotState = {
  plan: {
    canApplyCount: 1,
    draftCount: 2,
    queue: [{
      title: '高成本未归因 session',
      category: '补证据',
      reason: '高 token 且任务、阶段、价值缺失',
      project: 'Token Work',
      confidence: 82,
      totalTokens: 50000,
      costUSD: 25
    }]
  }
};

test('professional evidence pack distinguishes verified data from weak ROI evidence', () => {
  const markdown = buildProfessionalEvidencePack({
    period,
    sessions,
    totals,
    localTrust: eventVerifiedTrust,
    coverageBridge,
    evidenceFlywheel,
    roiEvidence: { score: 20 },
    evidenceAutopilotState: autopilotState
  });

  assert.match(markdown, /^# Token Work ROI Review Evidence/);
  assert.match(markdown, /Real DB - event verified/);
  assert.match(markdown, /Token events \| 1,234/);
  assert.match(markdown, /官方价不是账单/);
  assert.match(markdown, /自动证据不是人工事实/);
  assert.match(markdown, /高成本未归因 session/);
  assert.doesNotMatch(markdown, /提升 ROI \d+%/);
});

test('professional evidence pack refuses to overstate aggregate-only data', () => {
  const markdown = buildProfessionalEvidencePack({
    period,
    sessions,
    totals,
    localTrust: aggregateOnlyTrust,
    coverageBridge,
    evidenceFlywheel,
    evidenceAutopilotState: null
  });

  assert.match(markdown, /只能看趋势/);
  assert.match(markdown, /不能直接包装成强 ROI 结论/);
  assert.match(markdown, /not-run/);
});

test('technical blog draft includes problem, design, implementation, privacy, validation and limits', () => {
  const markdown = buildTechnicalBlogDraft({
    period,
    sessions,
    totals,
    localTrust: eventVerifiedTrust,
    coverageBridge,
    evidenceFlywheel,
    savingsSimulation: { recommendations: [{ title: 'Use light model for exploration' }] },
    modelStrategy: { coverage: { sampleShare: 25 } }
  });

  assert.match(markdown, /## 背景问题/);
  assert.match(markdown, /## 方案设计/);
  assert.match(markdown, /## 技术实现/);
  assert.match(markdown, /## 隐私与安全/);
  assert.match(markdown, /## 本期验证结果/);
  assert.match(markdown, /## 局限/);
  assert.match(markdown, /不上传数据，不保存对话正文/);
  assert.match(markdown, /官方价换算/);
});

test('resume and interview pack outputs Chinese, English and STAR without fake savings claims', () => {
  const markdown = buildResumeAndInterviewPack({
    sessions,
    totals,
    localTrust: eventVerifiedTrust,
    coverageBridge,
    evidenceFlywheel
  });

  assert.match(markdown, /## 中文简历版/);
  assert.match(markdown, /## English Resume Version/);
  assert.match(markdown, /## STAR 面试版/);
  assert.match(markdown, /\*\*Situation\*\*/);
  assert.match(markdown, /\*\*Task\*\*/);
  assert.match(markdown, /\*\*Action\*\*/);
  assert.match(markdown, /\*\*Result\*\*/);
  assert.match(markdown, /1234 event-level token rows|1,234 event-level token rows/);
  assert.doesNotMatch(markdown, /saved \d+%|提升 ROI \d+%|reduced cost by \d+%/i);
});

test('markdown formula prefixes are escaped', () => {
  assert.equal(escapeMarkdownFormula('=IMPORTXML("x")'), '\'=IMPORTXML("x")');
  assert.equal(escapeMarkdownFormula('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(escapeMarkdownFormula('@SUM(A1:A2)'), "'@SUM(A1:A2)");
});
