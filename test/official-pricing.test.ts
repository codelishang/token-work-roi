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
} from '../src/pricing.ts';

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

test('calculates OpenAI GPT-5.6 launch prices and aliases', () => {
  const sol = calculateOfficialCost('openai/gpt-5.6-sol', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    output: 1_000_000
  });
  const terra = calculateOfficialCost('gpt-5-6-terra', {
    input: 1_000_000,
    output: 1_000_000
  });
  const luna = calculateOfficialCost('gpt-5.6-luna', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    output: 1_000_000
  });

  assert.equal(sol.priced, true);
  assert.equal(sol.provider, 'openai');
  assert.equal(sol.resolvedModel, 'gpt-5.6-sol');
  assert.equal(sol.ratesPerMTok.input, 5);
  assert.equal(sol.ratesPerMTok.cachedInput, 0.5);
  assert.equal(sol.ratesPerMTok.cacheWrite, 6.25);
  assert.equal(sol.ratesPerMTok.output, 30);
  assert.equal(sol.totalUSD, 41.75);
  assert.equal(terra.priced, true);
  assert.equal(terra.resolvedModel, 'gpt-5.6-terra');
  assert.equal(terra.totalUSD, 17.5);
  assert.equal(luna.priced, true);
  assert.equal(luna.totalUSD, 8.35);
});

test('calculates Gemini API USD price from official rates', () => {
  const flash = calculateOfficialCost('gemini-2.5-flash', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });
  const pro = calculateOfficialCost('google/gemini-2.5-pro', {
    input: 1_000_000,
    output: 1_000_000
  });

  assert.equal(flash.priced, true);
  assert.equal(flash.provider, 'Gemini');
  assert.equal(flash.totalUSD, 2.875);
  assert.equal(pro.priced, true);
  assert.equal(pro.totalUSD, 11.25);
});

test('calculates Kimi API USD price from official RMB rates', () => {
  const code = calculateOfficialCost('kimi-k2.7-code', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000
  });
  const light = calculateOfficialCost('moonshotai/kimi-k2.5', {
    input: 1_000_000,
    output: 1_000_000
  });

  assert.equal(code.priced, true);
  assert.equal(code.provider, 'Kimi');
  assert.equal(code.totalUSD, 5.127510730568613);
  assert.equal(calculateOfficialCost('kimi-k2-7-code', { input: 1_000_000 }).resolvedModel, 'kimi-k2.7-code');
  assert.equal(calculateOfficialCost('kimi/kimi-k2-5', { input: 1_000_000 }).provider, 'Kimi');
  assert.equal(light.priced, true);
  assert.equal(light.totalUSD, 3.683556559316532);
});

test('calculates Qwen API USD price from official RMB rates', () => {
  const coder = calculateOfficialCost('qwen3-coder', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'aliyun' });
  const plus = calculateOfficialCost('tongyi/qwen3.7-plus', {
    input: 1_000_000,
    output: 1_000_000
  });

  assert.equal(coder.priced, true);
  assert.equal(coder.provider, 'Qwen');
  assert.equal(coder.resolvedModel, 'qwen3-coder-plus');
  assert.ok(Math.abs(coder.totalUSD - 2.946845247453226) < 1e-12);
  assert.equal(plus.priced, true);
  assert.equal(plus.provider, 'Qwen');
  assert.ok(Math.abs(plus.totalUSD - 1.4734226237266128) < 1e-12);
});

test('provider additions keep Gemini, Kimi and Qwen at the end', () => {
  const pricing = loadPricing();
  return pricing.then(data => {
    const sourceProviders = data.sources.map(source => source.provider);
    assert.deepEqual(sourceProviders.slice(-3), ['Gemini', 'Kimi', 'Qwen']);

    const modelProviders = data.models.map(model => model.provider);
    const firstGoogle = modelProviders.indexOf('Gemini');
    const firstKimi = modelProviders.indexOf('Kimi');
    const firstQwen = modelProviders.indexOf('Qwen');
    assert.ok(firstGoogle > 0);
    assert.ok(firstKimi > firstGoogle);
    assert.ok(firstQwen > firstKimi);
    assert.deepEqual(modelProviders.slice(firstGoogle, firstKimi), ['Gemini', 'Gemini', 'Gemini']);
    assert.deepEqual(modelProviders.slice(firstKimi, firstQwen), ['Kimi', 'Kimi', 'Kimi', 'Kimi']);
    assert.deepEqual(modelProviders.slice(firstQwen), ['Qwen', 'Qwen', 'Qwen', 'Qwen', 'Qwen', 'Qwen', 'Qwen']);
  });
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

test('calculates Grok 4.5 and Claude Fable 5 official prices', () => {
  const grok = calculateOfficialCost('xai/grok-4-5', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    output: 1_000_000
  });
  const fable = calculateOfficialCost('claude-fable-5', {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    output: 1_000_000
  });
  const fableHour = calculateOfficialCost('claude-fable-5', {
    cacheWrite: 1_000_000
  }, { anthropicCacheWriteTtl: '1h' });

  assert.equal(grok.priced, true);
  assert.equal(grok.provider, 'xai');
  assert.equal(grok.resolvedModel, 'grok-4.5');
  assert.equal(grok.totalUSD, 12);
  assert.equal(fable.priced, true);
  assert.equal(fable.provider, 'anthropic');
  assert.equal(fable.totalUSD, 73.5);
  assert.equal(fable.ratesPerMTok.cacheWrite, 12.5);
  assert.equal(fableHour.ratesPerMTok.cacheWrite, 20);
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
  const qwen = calculateOfficialCost('qwen3-coder-plus', {
    input: 1_000_000,
    output: 1_000_000
  }, { provider: 'anthropic' });

  assert.equal(glm.priced, true);
  assert.equal(glm.provider, 'Zhipu GLM');
  assert.equal(mimo.priced, true);
  assert.equal(mimo.provider, 'xiaomi');
  assert.equal(qwen.priced, true);
  assert.equal(qwen.provider, 'Qwen');
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
