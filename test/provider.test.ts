import assert from 'node:assert/strict';
import test from 'node:test';
import { providerFromSource } from '../src/provider.ts';

test('providerFromSource keeps model provider aliases in one place', () => {
  assert.equal(providerFromSource('xAI Console'), 'xai');
  assert.equal(providerFromSource('x.ai usage export'), 'xai');
  assert.equal(providerFromSource('Grok Build'), 'xai');
  assert.equal(providerFromSource('Claude Code'), 'anthropic');
  assert.equal(providerFromSource('Moonshot Kimi'), 'Kimi');
  assert.equal(providerFromSource('Volcengine Ark'), 'DoubaoSeed');
  assert.equal(providerFromSource('OpenAI Codex Spark'), 'openai');
  assert.equal(providerFromSource('Alibaba DashScope'), 'Qwen');
  assert.equal(providerFromSource('plain local source'), null);
});
