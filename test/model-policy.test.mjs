import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPolicy, formatModelPolicy, formatModelPolicyMarkdown } from '../src/model-policy.mjs';

test('model policy builds executable local rules without LLM calls', () => {
  const policy = buildModelPolicy({
    generatedAt: new Date('2026-06-17T00:00:00Z'),
    sessions: [
      { workPurpose: '测试验证', workStage: '验证', valueLevel: '中', outputStatus: '已完成', totalTokens: 1200 },
      { workPurpose: '功能开发', workStage: '实现', valueLevel: '高', outputStatus: '已发布', totalTokens: 5000 }
    ]
  });
  assert.equal(policy.rules.length, 3);
  const markdown = formatModelPolicyMarkdown(policy);
  assert.match(markdown, /Token Work Model Policy/);
  assert.match(markdown, /Testing|测试|light/i);
  assert.doesNotMatch(markdown, /prompt|response body/i);
});

test('model policy formats Claude and AGENTS snippets without writing files', () => {
  const policy = buildModelPolicy({
    generatedAt: new Date('2026-06-17T00:00:00Z'),
    sessions: [
      { workPurpose: '上下文整理', workStage: '探索', valueLevel: '低', outputStatus: '进行中', totalTokens: 3000 }
    ]
  });
  const claude = formatModelPolicy(policy, 'claude-md');
  const agents = formatModelPolicy(policy, 'agents-md');
  assert.match(claude, /Claude Code/);
  assert.match(claude, /lightweight models/);
  assert.match(agents, /Agent Policy/);
  assert.match(agents, /Do not automatically edit/);
  assert.doesNotMatch(`${claude}\n${agents}`, /secret prompt|private response|actual transcript/i);
});
