import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_USD_CNY_RATE = 7.2;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(MODULE_DIR, '..');

let cachedRate = null;

interface ExchangeRateResponse {
  ok: boolean;
  status?: number;
  json(): Promise<Record<string, unknown>>;
}

type ExchangeRateFetch = (input: string | URL | Request, init?: RequestInit) => Promise<ExchangeRateResponse>;

export async function getUsdCnyExchangeRate({
  now = Date.now(),
  fetchImpl = globalThis.fetch
}: { now?: number; fetchImpl?: ExchangeRateFetch } = {}) {
  const persisted = readPersistedExchangeRate(now);
  if (persisted) return persisted;

  if (cachedRate && now - cachedRate.fetchedAtMs < CACHE_TTL_MS) {
    return { ...cachedRate, cached: true };
  }

  const sourceUrl = process.env.TOKEN_WORK_EXCHANGE_RATE_URL || DEFAULT_SOURCE_URL;
  let timer = null;
  try {
    if (!fetchImpl) throw new Error('fetch unavailable');
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(sourceUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rates = inputRecord(payload.rates);
    const conversionRates = inputRecord(payload.conversion_rates);
    const rate = Number(rates.CNY ?? conversionRates.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('CNY rate missing');
    cachedRate = {
      base: 'USD',
      quote: 'CNY',
      rate,
      source: typeof payload.provider === 'string' ? payload.provider : sourceUrl,
      sourceUrl,
      lastUpdated: typeof payload.time_last_update_utc === 'string' ? payload.time_last_update_utc : null,
      nextUpdated: typeof payload.time_next_update_utc === 'string' ? payload.time_next_update_utc : null,
      fetchedAt: new Date(now).toISOString(),
      fetchedAtMs: now,
      isFallback: false
    };
    return { ...cachedRate, cached: false };
  } catch (error) {
    return {
      base: 'USD',
      quote: 'CNY',
      rate: FALLBACK_USD_CNY_RATE,
      source: 'fallback',
      sourceUrl,
      lastUpdated: null,
      nextUpdated: null,
      fetchedAt: new Date(now).toISOString(),
      fetchedAtMs: now,
      isFallback: true,
      cached: false,
      error: error.message || 'exchange rate unavailable'
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readPersistedExchangeRate(now) {
  if (process.env.PRICING_REFRESH === '1') return null;
  const cachePath = resolvePricingCachePath();
  try {
    const payload = JSON.parse(readFileSync(cachePath, 'utf8'));
    const rate = Number(payload?.exchangeRate?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    if (payload.exchangeRate.isFallback) return null;
    const fetchedAt = payload.exchangeRate.fetchedAt || payload.fetchedAt || payload.verifiedAt || new Date(now).toISOString();
    return {
      ...payload.exchangeRate,
      base: payload.exchangeRate.base || 'USD',
      quote: payload.exchangeRate.quote || 'CNY',
      rate,
      source: payload.exchangeRate.source || 'pricing-cache',
      sourceUrl: payload.exchangeRate.sourceUrl || null,
      fetchedAt,
      fetchedAtMs: Date.parse(fetchedAt) || now,
      isFallback: Boolean(payload.exchangeRate.isFallback),
      cached: true
    };
  } catch {
    return null;
  }
}

function resolvePricingCachePath() {
  if (process.env.TOKEN_WORK_PRICING_CACHE) return process.env.TOKEN_WORK_PRICING_CACHE;
  const candidates = [
    resolve(process.cwd(), 'data', 'official-pricing.json'),
    resolve(PACKAGE_ROOT, 'data', 'official-pricing.json')
  ];
  return candidates.find(candidate => existsSync(candidate)) || candidates[0];
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
