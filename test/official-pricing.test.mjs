import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  calculateCost,
  calculateOfficialCost,
  loadPricing,
  resolveOfficialPricing
} from '../src/pricing.mjs';

test('calculates OpenAI API standard USD price from official per-token rates', () => {
  const cost = calculateOfficialCost('gpt-5.5', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });

  assert.equal(cost.priced, true);
  assert.equal(cost.provider, 'openai');
  assert.equal(cost.totalUSD, 35.5);
  assert.equal(cost.ratesPerMTok.input, 5);
  assert.equal(cost.ratesPerMTok.cachedInput, 0.5);
  assert.equal(cost.ratesPerMTok.output, 30);
});

test('calculates Claude prompt-cache cost with official 5-minute cache write default', () => {
  const cost = calculateOfficialCost('claude-opus-4-7', {
    input: 1_000_000,
    cacheWrite: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });

  assert.equal(cost.priced, true);
  assert.equal(cost.provider, 'anthropic');
  assert.equal(cost.totalUSD, 36.75);
  assert.equal(cost.ratesPerMTok.cacheWrite, 6.25);
});

test('supports official DeepSeek and Xiaomi cache-hit pricing', () => {
  const deepseek = calculateOfficialCost('deepseek-v4-pro', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });
  const mimo = calculateOfficialCost('mimo-v2.5-pro', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });

  assert.equal(deepseek.totalUSD, 1.308625);
  assert.equal(mimo.totalUSD, 1.3086);
});

test('does not invent prices for research-preview or unknown models', () => {
  const spark = calculateOfficialCost('gpt-5.3-codex-spark', {
    input: 1_000_000,
    output: 1_000_000
  });
  const unknown = calculateCost('made-up-model', { input: 1_000_000, output: 1_000_000 });

  assert.equal(spark.priced, false);
  assert.equal(spark.totalUSD, 0);
  assert.match(spark.reason, /research preview/);
  assert.equal(unknown, 0);
});

test('resolves dated provider aliases without falling through to shorter model names', () => {
  assert.equal(resolveOfficialPricing('openai/gpt-5.3-codex-spark').priced, false);
  assert.equal(resolveOfficialPricing('claude-opus-4.7-20260420').model, 'claude-opus-4-7');
});

test('does not let a source provider hint hide explicit model provider pricing', () => {
  const glm = calculateOfficialCost('glm-5.2', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'anthropic' });
  const mimo = calculateOfficialCost('mimo-v2-pro', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'anthropic' });

  assert.equal(glm.priced, true);
  assert.equal(glm.provider, 'Zhipu GLM');
  assert.equal(mimo.priced, true);
  assert.equal(mimo.provider, 'xiaomi');
});

test('does not price DoubaoSeed without parsed official billing rates', () => {
  const cost = calculateOfficialCost('doubao-pro-32k', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'DoubaoSeed' });

  assert.equal(cost.priced, false);
  assert.equal(cost.totalUSD, 0);
});

test('uses official pricing cache when provided', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-work-pricing-'));
  const cachePath = join(dir, 'official-pricing.json');
  await writeFile(cachePath, JSON.stringify({
    mode: 'official-cache',
    verifiedAt: '2026-06-23',
    fetchedAt: '2026-06-23T00:00:00.000Z',
    models: [{
      provider: 'openai',
      model: 'gpt-5.5',
      aliases: ['gpt-5.5'],
      priced: true,
      ratesPerMTok: {
        input: 10,
        cachedInput: 1,
        cacheWrite5m: 10,
        cacheWrite1h: 10,
        output: 40
      },
      sourceProvider: 'openai'
    }, {
      provider: 'Zhipu GLM',
      model: 'glm-4.5-air',
      aliases: ['glm-4.5-air'],
      priced: true,
      ratesPerMTok: {
        input: 1,
        cachedInput: 0.2,
        cacheWrite5m: 1,
        cacheWrite1h: 1,
        output: 2
      },
      officialRatesPerMTok: {
        currency: 'CNY',
        unit: '1M tokens',
        ratesPerMTok: {
          input: 7,
          cachedInput: 1.4,
          output: 14
        },
        exchangeRate: 7
      },
      sourceProvider: 'Zhipu GLM',
      pricingFetchStatus: 'official-page'
    }]
  }), 'utf8');

  const pricingData = await loadPricing(cachePath);
  const official = calculateOfficialCost('gpt-5.5', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  }, { pricingData });

  assert.equal(pricingData.mode, 'official-cache');
  assert.equal(official.totalUSD, 51);
  assert.equal(calculateCost('gpt-5.5', { input: 1_000_000 }, pricingData), 10);
  assert.equal(calculateCost('deepseek-v4-pro', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  }, pricingData), 1.308625);
  assert.equal(calculateOfficialCost('glm-4.5-air', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'Zhipu GLM', pricingData }).totalUSD, 3);
});
