import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUsdCnyExchangeRate } from '../src/exchange-rate.ts';

test('exchange rate uses persisted pricing cache by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-work-exchange-'));
  const cachePath = join(dir, 'official-pricing.json');
  await writeFile(cachePath, JSON.stringify({
    fetchedAt: '2026-07-06T00:00:00.000Z',
    exchangeRate: {
      base: 'USD',
      quote: 'CNY',
      rate: 6.66,
      source: 'weekly-cache',
      fetchedAt: '2026-07-06T00:00:00.000Z',
      isFallback: false
    }
  }));

  const previousCache = process.env.TOKEN_WORK_PRICING_CACHE;
  const previousRefresh = process.env.PRICING_REFRESH;
  process.env.TOKEN_WORK_PRICING_CACHE = cachePath;
  delete process.env.PRICING_REFRESH;
  try {
    const rate = await getUsdCnyExchangeRate({
      fetchImpl: async () => {
        throw new Error('should not fetch');
      }
    });
    assert.equal(rate.rate, 6.66);
    assert.equal(rate.cached, true);
    assert.equal(rate.source, 'weekly-cache');
  } finally {
    restoreEnv('TOKEN_WORK_PRICING_CACHE', previousCache);
    restoreEnv('PRICING_REFRESH', previousRefresh);
  }
});

test('pricing refresh skips persisted exchange cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-work-exchange-'));
  const cachePath = join(dir, 'official-pricing.json');
  await writeFile(cachePath, JSON.stringify({
    exchangeRate: {
      rate: 6.66
    }
  }));

  const previousCache = process.env.TOKEN_WORK_PRICING_CACHE;
  const previousRefresh = process.env.PRICING_REFRESH;
  process.env.TOKEN_WORK_PRICING_CACHE = cachePath;
  process.env.PRICING_REFRESH = '1';
  try {
    const rate = await getUsdCnyExchangeRate({
      now: Date.parse('2026-07-07T00:00:00.000Z'),
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          rates: { CNY: 7.01 },
          provider: 'test-rate-source',
          time_last_update_utc: 'Tue, 07 Jul 2026 00:00:00 +0000'
        })
      })
    });
    assert.equal(rate.rate, 7.01);
    assert.equal(rate.cached, false);
    assert.equal(rate.source, 'test-rate-source');
  } finally {
    restoreEnv('TOKEN_WORK_PRICING_CACHE', previousCache);
    restoreEnv('PRICING_REFRESH', previousRefresh);
  }
});

test('fallback exchange rate in pricing cache is not treated as refreshed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-work-exchange-'));
  const cachePath = join(dir, 'official-pricing.json');
  await writeFile(cachePath, JSON.stringify({
    exchangeRate: {
      rate: 7.2,
      source: 'fallback',
      isFallback: true
    }
  }));

  const previousCache = process.env.TOKEN_WORK_PRICING_CACHE;
  const previousRefresh = process.env.PRICING_REFRESH;
  process.env.TOKEN_WORK_PRICING_CACHE = cachePath;
  delete process.env.PRICING_REFRESH;
  try {
    const rate = await getUsdCnyExchangeRate({
      now: Date.parse('2026-07-09T00:00:00.000Z'),
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          conversion_rates: { CNY: 7.02 },
          provider: 'live-rate-source'
        })
      })
    });
    assert.equal(rate.rate, 7.02);
    assert.equal(rate.cached, false);
    assert.equal(rate.source, 'live-rate-source');
  } finally {
    restoreEnv('TOKEN_WORK_PRICING_CACHE', previousCache);
    restoreEnv('PRICING_REFRESH', previousRefresh);
  }
});

function restoreEnv(key, value) {
  if (value == null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
