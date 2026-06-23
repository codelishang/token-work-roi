import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavingsSimulation } from '../src/client/review/savings-simulator.js';
import { buildMarkdownReviewReport } from '../src/client/review/markdown-report.js';

const period = {
  pretty: '2026 年 6 月',
  start: '2026-06-01',
  end: '2026-06-17'
};

test('savings simulator suggests downgrading heavy exploration and testing work', () => {
  const simulation = buildSavingsSimulation({
    sessions: [{
      sessionId: 'heavy-test',
      source: 'Codex CLI',
      model: 'gpt-5.5',
      pricingStatus: 'priced',
      workPurpose: '测试验证',
      workStage: '验证',
      valueLevel: '中',
      outputStatus: '进行中',
      annotationSource: 'auto',
      annotationConfidence: 85,
      inputTokens: 900_000,
      outputTokens: 80_000,
      totalTokens: 980_000,
      costUSD: 6
    }]
  });

  assert.equal(simulation.suggestions.length, 1);
  assert.equal(simulation.suggestions[0].suggestedTier, 'light');
  assert.equal(simulation.suggestions[0].evidenceQuality, '自动高置信');
  assert.match(simulation.suggestions[0].evidenceSummary, /自动高置信/);
  assert.ok(simulation.suggestions[0].savingsUSD > 0);
  assert.match(simulation.suggestions[0].why, /方向|试错|重模型|最高成本|高单价/);
});

test('savings simulator does not downgrade high-value published work', () => {
  const simulation = buildSavingsSimulation({
    sessions: [{
      sessionId: 'published',
      source: 'Claude Code',
      model: 'claude-opus-4-8',
      pricingStatus: 'priced',
      workPurpose: '功能开发',
      workStage: '发布',
      valueLevel: '高',
      outputStatus: '已发布',
      inputTokens: 500_000,
      outputTokens: 60_000,
      totalTokens: 560_000,
      costUSD: 4
    }]
  });

  assert.deepEqual(simulation.suggestions, []);
});

test('savings simulator excludes unpriced models from dollar savings', () => {
  const simulation = buildSavingsSimulation({
    sessions: [{
      sessionId: 'spark',
      source: 'Codex CLI',
      model: 'gpt-5.3-codex-spark',
      pricingStatus: 'unpriced',
      pricingReason: 'research preview without official USD price',
      workPurpose: '测试验证',
      workStage: '探索',
      valueLevel: '低',
      outputStatus: '已废弃',
      inputTokens: 500_000,
      outputTokens: 10_000,
      totalTokens: 510_000,
      costUSD: 0
    }]
  });

  assert.deepEqual(simulation.suggestions, []);
  assert.equal(simulation.unpriced.sessionCount, 1);
  assert.equal(simulation.unpriced.models[0], 'gpt-5.3-codex-spark');
});

test('savings simulator ranks low-value abandoned high-cost sessions first', () => {
  const simulation = buildSavingsSimulation({
    sessions: [
      {
        sessionId: 'explore',
        source: 'Claude Code',
        model: 'claude-opus-4-8',
        pricingStatus: 'priced',
        workPurpose: '技术调研',
        workStage: '探索',
        valueLevel: '中',
        outputStatus: '进行中',
        inputTokens: 100_000,
        outputTokens: 20_000,
        totalTokens: 120_000,
        costUSD: 1
      },
      {
        sessionId: 'waste',
        source: 'Claude Code',
        model: 'claude-opus-4-8',
        pricingStatus: 'priced',
        workPurpose: '功能开发',
        workStage: '实现',
        valueLevel: '低',
        outputStatus: '已废弃',
        inputTokens: 1_000_000,
        outputTokens: 50_000,
        totalTokens: 1_050_000,
        costUSD: 8
      }
    ]
  });

  assert.match(simulation.suggestions[0].id, /low-value/);
  assert.ok(simulation.suggestions[0].savingsUSD > simulation.suggestions.at(-1).savingsUSD);
});

test('markdown report includes savings simulation without invoice wording', () => {
  const savingsSimulation = buildSavingsSimulation({
    sessions: [{
      sessionId: 'heavy-test',
      source: 'Codex CLI',
      model: 'gpt-5.5',
      pricingStatus: 'priced',
      workPurpose: '测试验证',
      workStage: '验证',
      valueLevel: '中',
      outputStatus: '进行中',
      inputTokens: 900_000,
      outputTokens: 80_000,
      totalTokens: 980_000,
      costUSD: 6
    }]
  });
  const report = buildMarkdownReviewReport({ period, savingsSimulation });

  assert.match(report, /## 9\. 节省模拟/);
  assert.match(report, /官方价换算节省模拟只用于比较模型策略，不是供应商账单/);
  assert.match(report, /不承诺真实账单节省/);
});
