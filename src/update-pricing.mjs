import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  OFFICIAL_PRICING_SOURCES,
  OFFICIAL_PRICE_TABLE,
  serializeOfficialPricingModels
} from './pricing.mjs';
import { getUsdCnyExchangeRate } from './exchange-rate.mjs';

process.env.PRICING_REFRESH = '1';

const pricingCachePath = resolve(process.cwd(), 'data', 'official-pricing.json');
const pricingSourcePath = resolve(process.cwd(), 'src', 'pricing.mjs');
const STABLE_ALIASES = new Map([
  ['deepseek::deepseek-v4-flash', ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']],
  ['xiaomi::mimo-v2.5-pro', ['mimo-v2.5-pro', 'mimo-v2-pro']],
  ['zhipu glm::glm-5.2', ['glm-5.2', 'glm-5-2']],
  ['zhipu glm::glm-5.1', ['glm-5.1', 'glm-5-1']],
  ['zhipu glm::glm-4.5-air', ['glm-4.5-air', 'glm-4-5-air']],
  ['zhipu glm::glm-4.7', ['glm-4.7', 'glm-4-7']]
]);
const fetchedAt = new Date().toISOString();
const exchangeRate = await getUsdCnyExchangeRate();
const sources = await Promise.all(OFFICIAL_PRICING_SOURCES.map(source => fetchSourceStatus(source, exchangeRate)));
const ok = sources.filter(source => source.fetchStatus === 'ok').length;
const fetchedRates = new Map(
  sources
    .flatMap(source => source.models || [])
    .map(model => [pricingKey(model), model])
);
  const pricing = {
  mode: 'official-cache',
  verifiedAt: fetchedAt.slice(0, 10),
  fetchedAt,
  exchangeRate,
  sources: sources.map(({ body, models, ...source }) => source),
  models: serializeOfficialPricingModels(OFFICIAL_PRICE_TABLE).map(model => {
    const fetched = fetchedRates.get(pricingKey(model));
    const aliases = Array.from(new Set([
      ...(STABLE_ALIASES.get(pricingKey(fetched || model)) || []),
      ...(model.aliases || []),
      ...(fetched?.aliases || [])
    ]));
    return fetched
      ? {
          ...model,
          ...fetched,
          aliases,
          ratesPerMTok: {
            ...(model.ratesPerMTok || {}),
            ...(fetched.ratesPerMTok || {})
          },
          pricingFetchStatus: fetched.pricingFetchStatus || 'official-page'
        }
      : { ...model, pricingFetchStatus: 'fallback-table' };
  })
};

if (ok === 0) {
  console.log(`[pricing] skipped cache write; official sources reachable=0/${sources.length}`);
  for (const source of sources) {
    console.log(`[pricing] ${source.provider}: ${source.fetchStatus} (${source.fetchError || source.httpStatus || 'unknown error'})`);
  }
  process.exitCode = 1;
} else {
  await mkdir(resolve(process.cwd(), 'data'), { recursive: true });
  await writeFile(pricingCachePath, `${JSON.stringify(pricing, null, 2)}\n`, 'utf8');
  await updateBuiltinPricingTable(pricingSourcePath, pricing);

  const parsed = pricing.models.filter(model => model.pricingFetchStatus?.startsWith('official-page')).length;
  console.log(`[pricing] wrote ${pricingCachePath}`);
  console.log(`[pricing] updated built-in table ${pricingSourcePath}`);
  console.log(`[pricing] official sources reachable=${ok}/${sources.length} parsedModels=${parsed}/${pricing.models.length}`);
  for (const source of sources) {
    const suffix = source.fetchStatus === 'ok'
      ? `${source.httpStatus || 'ok'} ${source.contentLength} bytes, parsed=${source.models?.length || 0}`
      : source.httpStatus
        ? `${source.httpStatus} ${source.contentLength ?? 0} bytes`
        : source.fetchError;
    console.log(`[pricing] ${source.provider}: ${source.fetchStatus} (${suffix})`);
  }
}

async function updateBuiltinPricingTable(filePath, pricing) {
  const source = await readFile(filePath, 'utf8');
  const withDate = source.replace(
    /const VERIFIED_AT = '[^']+';/,
    `const VERIFIED_AT = '${pricing.verifiedAt}';`
  );
  const tableStart = withDate.indexOf('export const OFFICIAL_PRICE_TABLE = [');
  const tableEndWithSemi = withDate.indexOf('\n];', tableStart);
  const tableEndWithoutSemi = withDate.indexOf('\n]\n', tableStart);
  const tableEnd = tableEndWithSemi >= 0 ? tableEndWithSemi : tableEndWithoutSemi;
  if (tableStart < 0 || tableEnd < 0) {
    throw new Error('Unable to locate OFFICIAL_PRICE_TABLE block in pricing.mjs');
  }
  const existingEndLength = tableEndWithSemi >= 0 ? 3 : 2;
  const nextTable = `export const OFFICIAL_PRICE_TABLE = [\n${pricing.models.map(officialRateSource).join(',\n')}\n];`;
  const nextSource = `${withDate.slice(0, tableStart)}${nextTable}${withDate.slice(tableEnd + existingEndLength)}`;
  if (nextSource !== source) await writeFile(filePath, nextSource, 'utf8');
}

function officialRateSource(model) {
  const lines = [
    `  officialRate({`,
    `    provider: ${literal(model.provider)},`,
    `    model: ${literal(model.model)},`,
    `    aliases: ${arrayLiteral(model.aliases || [model.model])},`
  ];
  if (model.ratesPerMTok) {
    const rates = model.ratesPerMTok;
    lines.push(`    input: ${numberLiteral(rates.input)},`);
    lines.push(`    cachedInput: ${numberLiteral(rates.cachedInput ?? rates.input)},`);
    if (rates.cacheWrite5m != null) lines.push(`    cacheWrite5m: ${numberLiteral(rates.cacheWrite5m)},`);
    if (rates.cacheWrite1h != null) lines.push(`    cacheWrite1h: ${numberLiteral(rates.cacheWrite1h)},`);
    lines.push(`    output: ${numberLiteral(rates.output)},`);
  }
  const tail = [
    `    source: ${literal(model.sourceProvider || model.provider)}`,
    model.unavailableReason ? `    unavailableReason: ${literal(model.unavailableReason)}` : null,
    model.note ? `    note: ${literal(model.note)}` : null
  ].filter(Boolean);
  lines.push(...tail.map((line, index) => index < tail.length - 1 ? `${line},` : line));
  return `${lines.join('\n')}\n  })`;
}

function literal(value) {
  return JSON.stringify(String(value || ''));
}

function arrayLiteral(values) {
  return `[${values.map(literal).join(', ')}]`;
}

function numberLiteral(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number) ? String(number) : String(number);
}

async function fetchSourceStatus(source, exchangeRate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'user-agent': 'token-work-roi-pricing-cache/1.0'
      }
    });
    const text = await response.text();
    const assets = response.ok ? await fetchSourceAssets(source, text) : [];
    const parseBody = [text, ...assets.map(asset => asset.body || '')].join('\n');
    const models = response.ok ? parseSourceModels(source, parseBody, exchangeRate) : [];
    return {
      ...source,
      fetchedAt,
      fetchStatus: response.ok ? 'ok' : 'http-error',
      httpStatus: response.status,
      contentLength: text.length,
      assets: assets.map(({ body, ...asset }) => asset),
      models
    };
  } catch (error) {
    return {
      ...source,
      fetchedAt,
      fetchStatus: 'error',
      fetchError: error?.name === 'AbortError' ? 'timeout' : error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceAssets(source, body) {
  const urls = source.assetUrls?.length ? source.assetUrls : discoverAssetUrls(source, body);
  if (!urls.length) return [];
  const assets = await Promise.all(urls.map(url => fetchAsset(url)));
  const nestedUrls = assets.flatMap(asset => discoverAssetUrls(source, asset.body || ''));
  const seen = new Set(assets.map(asset => asset.url));
  const nestedAssets = await Promise.all(
    nestedUrls
      .filter(url => !seen.has(url))
      .map(url => fetchAsset(url))
  );
  return [...assets, ...nestedAssets];
}

async function fetchAsset(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/javascript,application/javascript,text/plain,*/*;q=0.8',
          'user-agent': 'token-work-roi-pricing-cache/1.0'
        }
      });
      const body = await response.text();
      return {
        url,
        fetchStatus: response.ok ? 'ok' : 'http-error',
        httpStatus: response.status,
        contentLength: body.length,
        body: response.ok ? body : ''
      };
    } catch (error) {
      return {
        url,
        fetchStatus: 'error',
        fetchError: error?.name === 'AbortError' ? 'timeout' : error?.message || String(error)
      };
    } finally {
      clearTimeout(timer);
    }
}

function discoverAssetUrls(source, body) {
  if (isZhipuSource(source)) {
    return Array.from(
      body.matchAll(/<script[^>]+src="([^"]*\/js\/app\.[^"]+\.js)"/g),
      match => absoluteUrl(match[1], source.url)
    );
  }
  return [];
}

function parseSourceModels(source, body, exchangeRate) {
  if (source.provider === 'anthropic') return parseAnthropicModels(body);
  if (source.provider === 'deepseek') return parseDeepSeekModels(body);
  if (source.provider === 'xiaomi') return parseColumnPricingTable(body, {
    provider: 'xiaomi',
    sourceProvider: 'xiaomi',
    models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro'],
    startMarker: 'Overseas Pricing of the Model'
  });
  if (isZhipuSource(source)) return parseZaiModels(body, exchangeRate);
  if (isDoubaoSource(source)) return parseVolcengineModels(body, exchangeRate);
  return [];
}

function parseAnthropicModels(body) {
  const cards = body.split('card_pricing_api_wrap').slice(1);
  const rates = cards
    .map(card => Array.from(card.matchAll(/data-value="([0-9.]+)"/g), match => Number(match[1])))
    .filter(values => values.length >= 4)
    .map(values => ({
      input: values[0],
      output: values[1],
      cacheWrite5m: values[2],
      cachedInput: values[3]
    }));

  const opus = rates.find(rate => rate.input === 5 && rate.output === 25);
  const sonnet = rates.find(rate => rate.input === 3 && rate.output === 15);
  const haiku = rates.find(rate => rate.input === 1 && rate.output === 5);
  return [
    ...['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'].map(model => rateModel('anthropic', model, opus, 'anthropic')),
    rateModel('anthropic', 'claude-sonnet-4-6', sonnet, 'anthropic'),
    rateModel('anthropic', 'claude-haiku-4-5', haiku, 'anthropic')
  ].filter(Boolean);
}

function parseDeepSeekModels(body) {
  const text = tableText(body);
  const hit = matchPricingRow(text, /1M INPUT TOKENS \(CACHE HIT\)\|\|\$([0-9.]+)\|\|\$([0-9.]+)/);
  const miss = matchPricingRow(text, /1M INPUT TOKENS \(CACHE MISS\)\|\|\$([0-9.]+)\|\|\$([0-9.]+)/);
  const output = matchPricingRow(text, /1M OUTPUT TOKENS\|\|\$([0-9.]+)\|\|\$([0-9.]+)/);
  if (!hit || !miss || !output) return [];
  return [
    rateModel('deepseek', 'deepseek-v4-flash', {
      cachedInput: hit[0],
      input: miss[0],
      output: output[0],
      cacheWrite5m: miss[0],
      cacheWrite1h: miss[0]
    }, 'deepseek'),
    rateModel('deepseek', 'deepseek-v4-pro', {
      cachedInput: hit[1],
      input: miss[1],
      output: output[1],
      cacheWrite5m: miss[1],
      cacheWrite1h: miss[1]
    }, 'deepseek')
  ].filter(Boolean);
}

function parseZaiModels(body, exchangeRate) {
  const pairs = [
    ['glm-5.2', 'GLM-5.2'],
    ['glm-5.1', 'GLM-5.1'],
    ['glm-5-turbo', 'GLM-5-Turbo'],
    ['glm-5', 'GLM-5'],
    ['glm-4.7', 'GLM-4.7'],
    ['glm-4.5-air', 'GLM-4.5-Air'],
    ['glm-4.7-flashx', 'GLM-4.7-FlashX'],
    ['glm-4.7-flash', 'GLM-4.7-Flash']
  ];
  return pairs.map(([model, label]) => {
    const block = modelBlock(body, label);
    if (!block) return null;
    const input = cnyPrice(block, /inPrice:\["([^"]+)"/);
    const output = cnyPrice(block, /outPrice:\["([^"]+)"/);
    const cachedInput = cnyPrice(block, /hit:\["([^"]+)"/);
    if (input == null || output == null) return null;
    return rateModel('Zhipu GLM', model, cnyToUsdRates({
      input,
      output,
      cachedInput,
      cacheWrite5m: input,
      cacheWrite1h: input
    }, exchangeRate), 'Zhipu GLM', 'official-page-asset', {
      currency: 'CNY',
      unit: '1M tokens',
      ratesPerMTok: {
        input,
        output,
        cachedInput: cachedInput ?? input,
        cacheWrite5m: input,
        cacheWrite1h: input
      },
      exchangeRate: exchangeRate.rate,
      sourceUnit: '元 / 1M tokens'
    });
  }).filter(Boolean);
}

function parseVolcengineModels(body, exchangeRate) {
  const normalized = body.replace(/\\u002F/g, '/').replace(/\\"/g, '"');
  const pairs = [
    ['doubao-pro-32k', 'Doubao-pro-32k'],
    ['doubao-lite-32k', 'Doubao-lite-32k'],
    ['doubao-pro-256k', 'Doubao-pro-256k']
  ];
  return pairs.map(([model, label]) => {
    const rates = volcengineInferenceRates(normalized, label);
    if (!rates) return null;
    return rateModel('DoubaoSeed', model, cnyToUsdRates({
      ...rates,
      cachedInput: rates.cachedInput ?? rates.input,
      cacheWrite5m: rates.input,
      cacheWrite1h: rates.input
    }, exchangeRate), 'DoubaoSeed', 'official-page-asset', {
      currency: 'CNY',
      unit: '1M tokens',
      ratesPerMTok: {
        ...rates,
        cachedInput: rates.cachedInput ?? rates.input,
        cacheWrite5m: rates.input,
        cacheWrite1h: rates.input
      },
      exchangeRate: exchangeRate.rate,
      sourceUnit: '元 / 1M tokens'
    });
  }).filter(Boolean);
}

function volcengineInferenceRates(body, label) {
  const input = volcenginePriceFor(body, label, 'infer-prompt');
  const output = volcenginePriceFor(body, label, 'infer-completion');
  if (input == null || output == null) return null;
  return {
    input: input * 1000,
    output: output * 1000
  };
}

function volcenginePriceFor(body, label, chargeKind) {
  const escaped = escapeRegExp(label);
  const pattern = new RegExp(
    `"ConfigurationCode":"${escaped}"[^}]*"ChargeItemCode":"${escaped}-${chargeKind}[^"]*"[^}]*"Unit":"千tokens"[^}]*?(?:"Price"|"price"|"DefaultPrice"|"SalePrice")\\s*:?\\s*"?([0-9.]+)"?`,
    'i'
  );
  const match = body.match(pattern);
  return match ? Number(match[1]) : null;
}

function parseColumnPricingTable(body, { provider, sourceProvider, models, startMarker = '', endMarker = '' }) {
  let segment = body;
  const start = startMarker ? segment.indexOf(startMarker) : -1;
  if (start >= 0) segment = segment.slice(start);
  const end = endMarker ? segment.indexOf(endMarker) : -1;
  if (end > 0) segment = segment.slice(0, end);

  const text = tableText(segment);
  return models.map(model => {
    const match = text.match(new RegExp(`${escapeRegExp(model)}\\|+\\s*\\|+\\$([0-9.]+)\\|+\\s*\\|+\\$([0-9.]+)\\|+\\s*\\|+\\$([0-9.]+)`));
    const prices = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
    if (prices.length < 3) return null;
    return rateModel(provider, model, {
      cachedInput: prices[0],
      input: prices[1],
      output: prices[2],
      cacheWrite5m: prices[1],
      cacheWrite1h: prices[1]
    }, sourceProvider, 'official-page');
  }).filter(Boolean);
}

function rateModel(provider, model, rates, sourceProvider, pricingFetchStatus = 'official-page', officialRatesPerMTok = null) {
  if (!rates || !isFiniteRate(rates.input) || !isFiniteRate(rates.output)) return null;
  const ratesPerMTok = {
    input: rates.input,
    cachedInput: isFiniteRate(rates.cachedInput) ? rates.cachedInput : rates.input,
    output: rates.output
  };
  if (isFiniteRate(rates.cacheWrite5m)) ratesPerMTok.cacheWrite5m = rates.cacheWrite5m;
  if (isFiniteRate(rates.cacheWrite1h)) ratesPerMTok.cacheWrite1h = rates.cacheWrite1h;
  return {
    provider,
    model,
    aliases: [model],
    priced: true,
    unavailableReason: null,
    ratesPerMTok,
    officialRatesPerMTok,
    pricingFetchStatus,
    sourceProvider
  };
}

function modelBlock(body, label) {
  const start = body.indexOf(`name:"${label}"`);
  if (start < 0) return null;
  const next = body.indexOf('{name:', start + label.length + 8);
  return body.slice(start, next > start ? next : start + 1200);
}

function cnyPrice(block, pattern) {
  const value = block.match(pattern)?.[1];
  if (!value || value.includes('免费')) return 0;
  const number = Number(value.match(/[0-9.]+/)?.[0]);
  return Number.isFinite(number) ? number : null;
}

function cnyToUsdRates(rates, exchangeRate) {
  const divisor = Number(exchangeRate?.rate || 0);
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return Object.fromEntries(
    Object.entries(rates).map(([key, value]) => [key, Number(value) / divisor])
  );
}

function tableText(body) {
  return body.replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
}

function matchPricingRow(text, pattern) {
  const match = text.match(pattern);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pricingKey(row) {
  return `${providerKey(row.provider)}::${String(row.model || '').toLowerCase().replace(/(?<=\d)\.(?=\d)/g, '-')}`;
}

function isZhipuSource(source) {
  return providerKey(source?.provider) === 'zhipu glm';
}

function isDoubaoSource(source) {
  return providerKey(source?.provider) === 'doubaoseed';
}

function providerKey(provider) {
  const normalized = String(provider || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (['zai', 'z ai', 'zhipu', 'zhipu ai', 'zhipu glm', 'bigmodel'].includes(normalized)) return 'zhipu glm';
  if (['volcengine', 'volc engine', 'ark', 'doubao', 'doubao seed', 'doubaoseed', 'bytedance'].includes(normalized)) return 'doubaoseed';
  return normalized;
}

function isFiniteRate(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function absoluteUrl(value, baseUrl) {
  if (value.startsWith('//')) return `https:${value}`;
  if (/^(static|js|css)\//.test(value)) return new URL(`/${value}`, baseUrl).toString();
  return new URL(value, baseUrl).toString();
}
