const FALLBACK_USD_CNY_RATE = 7.2;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3500;
const DEFAULT_SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';

let cachedRate = null;

export async function getUsdCnyExchangeRate({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
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
    const rate = Number(payload?.rates?.CNY ?? payload?.conversion_rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('CNY rate missing');
    cachedRate = {
      base: 'USD',
      quote: 'CNY',
      rate,
      source: payload?.provider || sourceUrl,
      sourceUrl,
      lastUpdated: payload?.time_last_update_utc || null,
      nextUpdated: payload?.time_next_update_utc || null,
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
