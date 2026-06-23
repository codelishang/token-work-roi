import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdvisorActionMeasurements } from '../src/client/review/action-measurement.js';

test('advisor action measurements compare scoped before and after trends without causality claims', () => {
  const rows = buildAdvisorActionMeasurements({
    period: { start: '2026-06-01', end: '2026-06-30' },
    actions: [{
      id: 1,
      status: 'done',
      title: '探索和测试默认轻量模型',
      action: '测试验证先用轻量模型',
      createdAt: '2026-06-15T00:00:00Z',
      completedAt: '2026-06-15T00:00:00Z'
    }],
    sessions: [
      {
        lastActivity: '2026-06-10',
        workPurpose: '测试验证',
        workStage: '验证',
        taskType: '测试验证',
        model: 'gpt-5.5',
        totalTokens: 1000,
        costUSD: 10
      },
      {
        lastActivity: '2026-06-20',
        workPurpose: '测试验证',
        workStage: '验证',
        taskType: '测试验证',
        model: 'claude-haiku-4-5',
        totalTokens: 300,
        costUSD: 1
      },
      {
        lastActivity: '2026-06-20',
        workPurpose: '功能开发',
        workStage: '实现',
        taskType: '功能开发',
        model: 'claude-sonnet-4-6',
        totalTokens: 5000,
        costUSD: 20
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].scopeLabel, '探索 / 验证 / 上下文整理');
  assert.equal(rows[0].beforeTokens, 1000);
  assert.equal(rows[0].afterTokens, 300);
  assert.equal(rows[0].deltaTokens, -700);
  assert.match(rows[0].caveat, /不证明真实因果节省/);
});

test('advisor action measurements can scope low-value waste work', () => {
  const rows = buildAdvisorActionMeasurements({
    period: { start: '2026-06-01', end: '2026-06-30' },
    actions: [{
      id: 2,
      status: 'open',
      title: '低价值任务止损',
      createdAt: '2026-06-15T00:00:00Z'
    }],
    sessions: [
      { lastActivity: '2026-06-12', valueLevel: '低', outputStatus: '进行中', totalTokens: 400, costUSD: 2 },
      { lastActivity: '2026-06-18', valueLevel: '高', outputStatus: '已发布', totalTokens: 900, costUSD: 5 },
      { lastActivity: '2026-06-20', valueLevel: '中', outputStatus: '已废弃', totalTokens: 100, costUSD: 1 }
    ]
  });

  assert.equal(rows[0].scopeLabel, '低价值 / 废弃任务');
  assert.equal(rows[0].beforeSessions, 1);
  assert.equal(rows[0].afterSessions, 1);
});
