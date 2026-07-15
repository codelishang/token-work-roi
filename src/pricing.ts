/**
 * Official pricing calculator.
 *
 * This module intentionally avoids third-party pricing caches. Rates are copied
 * from provider-owned pricing pages and are expressed as USD per 1M tokens.
 * Unknown or research-preview models return 0 and are reported as unpriced.
 */

const MTOK = 1_000_000;
const VERIFIED_AT = '2026-07-13';
const DEFAULT_ANTHROPIC_CACHE_WRITE_TTL = '5m';

export const OFFICIAL_PRICING_SOURCES = [
  {
    provider: 'openai',
    label: 'OpenAI API pricing',
    url: 'https://openai.com/api/pricing/',
    note: 'Standard API rates; Batch, Flex, Priority, long-context and data residency modifiers are not applied by default.'
  },
  {
    provider: 'openai-codex',
    label: 'OpenAI Codex pricing',
    url: 'https://developers.openai.com/codex/pricing',
    note: 'Codex ChatGPT-plan credits are documented separately; API-key mode uses OpenAI API pricing.'
  },
  {
    provider: 'openai-gpt-5.6',
    label: 'OpenAI GPT-5.6 launch pricing',
    url: 'https://openai.com/index/gpt-5-6/',
    note: 'GPT-5.6 launch rates; cache write is 25% above input and cache read is 90% below input.'
  },
  {
    provider: 'xai',
    label: 'xAI Grok 4.5 launch pricing',
    url: 'https://docs.x.ai/developers/models',
    note: 'Grok 4.5 public model page lists input and output rates; no separate cached-input rate is applied by default.'
  },
  {
    provider: 'anthropic',
    label: 'Claude API pricing',
    url: 'https://claude.com/pricing',
    note: 'First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching.'
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek Models & Pricing',
    url: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: 'Overseas USD API prices per 1M tokens.'
  },
  {
    provider: 'xiaomi',
    label: 'Xiaomi MiMo API pricing',
    url: 'https://platform.xiaomimimo.com/docs/en-US/price/pay-as-you-go',
    note: 'Overseas USD API prices per 1M tokens.'
  },
  {
    provider: 'Zhipu GLM',
    label: 'Z.ai / BigModel pricing',
    url: 'https://open.bigmodel.cn/pricing',
    note: 'Official BigModel pricing page. RMB prices are converted to USD for internal cost math.'
  },
  {
    provider: 'DoubaoSeed',
    label: 'Volcengine Ark pricing',
    url: 'https://www.volcengine.com/pricing?product=ark_bd&tab=1',
    note: 'Official Ark pricing page. RMB prices are converted to USD for internal cost math.'
  },
  {
    provider: 'Gemini',
    label: 'Gemini API pricing',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: 'Gemini API USD prices per 1M tokens; Pro has separate short-context and long-context rates.'
  },
  {
    provider: 'Kimi',
    label: 'Kimi API pricing',
    url: 'https://platform.kimi.com/docs/pricing/chat',
    assetUrls: [
      'https://platform.kimi.com/docs/pricing/chat-k27-code.md',
      'https://platform.kimi.com/docs/pricing/chat-k26.md',
      'https://platform.kimi.com/docs/pricing/chat-v1.md'
    ],
    note: 'Official Kimi API RMB prices converted to USD for internal cost math.'
  },
  {
    provider: 'Qwen',
    label: 'Alibaba Cloud Model Studio pricing',
    url: 'https://help.aliyun.com/zh/model-studio/billing-for-model-studio',
    note: 'Official Alibaba Cloud Model Studio RMB prices converted to USD for internal cost math; short-context public rates are used by default.'
  }
];

export const OFFICIAL_PRICE_TABLE = [
  officialRate({
    provider: "openai",
    model: "gpt-5.6-sol",
    aliases: ["gpt-5-6-sol"],
    input: 5,
    cachedInput: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 6.25,
    output: 30,
    source: "openai-gpt-5.6",
    note: "OpenAI GPT-5.6 Sol flagship launch rate. Cache write is input × 1.25; cache read is input × 0.1."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.6-terra",
    aliases: ["gpt-5-6-terra"],
    input: 2.5,
    cachedInput: 0.25,
    cacheWrite5m: 3.125,
    cacheWrite1h: 3.125,
    output: 15,
    source: "openai-gpt-5.6",
    note: "OpenAI GPT-5.6 Terra balanced launch rate. Cache write is input × 1.25; cache read is input × 0.1."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.6-luna",
    aliases: ["gpt-5-6-luna"],
    input: 1,
    cachedInput: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 1.25,
    output: 6,
    source: "openai-gpt-5.6",
    note: "OpenAI GPT-5.6 Luna lightweight launch rate. Cache write is input × 1.25; cache read is input × 0.1."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.5",
    aliases: ["gpt-5-5"],
    input: 5,
    cachedInput: 0.5,
    cacheWrite5m: 5,
    cacheWrite1h: 5,
    output: 30,
    source: "openai",
    note: "OpenAI API standard short-context rate."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.4-mini",
    aliases: ["gpt-5-4-mini"],
    source: "openai",
    unavailableReason: "OpenAI API pricing page was not reachable during the last pricing refresh; do not infer this model price without a verified official rate.",
    note: "Standard API rates; Batch, Flex, Priority, long-context and data residency modifiers are not applied by default."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.3-codex",
    aliases: ["gpt-5-3-codex"],
    input: 1.75,
    cachedInput: 0.175,
    cacheWrite5m: 1.75,
    cacheWrite1h: 1.75,
    output: 14,
    source: "openai",
    note: "OpenAI API standard Codex model rate."
  }),
  officialRate({
    provider: "openai",
    model: "gpt-5.3-codex-spark",
    aliases: ["gpt-5-3-codex-spark"],
    source: "openai-codex",
    unavailableReason: "OpenAI Codex docs list GPT-5.3-Codex-Spark as research preview and do not publish a USD API token rate.",
    note: "Codex ChatGPT-plan credits are documented separately; API-key mode uses OpenAI API pricing."
  }),
  officialRate({
    provider: "xai",
    model: "grok-4.5",
    aliases: ["grok-4-5"],
    input: 2,
    cachedInput: 2,
    cacheWrite5m: 2,
    cacheWrite1h: 2,
    output: 6,
    source: "xai",
    note: "xAI Grok 4.5 public model page lists input and output rates; no separate cached-input rate is applied by default."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-fable-5",
    aliases: ["claude-fable-5"],
    input: 10,
    cachedInput: 1,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    output: 50,
    source: "anthropic",
    note: "First-party Claude Fable 5 pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-opus-4-8",
    aliases: ["claude-opus-4-8"],
    input: 5,
    cachedInput: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    output: 25,
    source: "anthropic",
    note: "First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-opus-4-7",
    aliases: ["claude-opus-4-7"],
    input: 5,
    cachedInput: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    output: 25,
    source: "anthropic",
    note: "First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-opus-4-6",
    aliases: ["claude-opus-4-6"],
    input: 5,
    cachedInput: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    output: 25,
    source: "anthropic",
    note: "First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    aliases: ["claude-sonnet-4-6"],
    input: 3,
    cachedInput: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    output: 15,
    source: "anthropic",
    note: "First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "anthropic",
    model: "claude-haiku-4-5",
    aliases: ["claude-haiku-4-5"],
    input: 1,
    cachedInput: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    output: 5,
    source: "anthropic",
    note: "First-party Claude API global standard pricing; cache write defaults to 5-minute prompt caching."
  }),
  officialRate({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    aliases: ["deepseek-v4-pro"],
    input: 0.435,
    cachedInput: 0.003625,
    cacheWrite5m: 0.435,
    cacheWrite1h: 0.435,
    output: 0.87,
    source: "deepseek",
    note: "Overseas USD API prices per 1M tokens."
  }),
  officialRate({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    aliases: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    input: 0.14,
    cachedInput: 0.0028,
    cacheWrite5m: 0.14,
    cacheWrite1h: 0.14,
    output: 0.28,
    source: "deepseek",
    note: "DeepSeek docs state deepseek-chat and deepseek-reasoner map to deepseek-v4-flash compatibility modes."
  }),
  officialRate({
    provider: "xiaomi",
    model: "mimo-v2.5-pro",
    aliases: ["mimo-v2-5-pro"],
    input: 0.435,
    cachedInput: 0.0036,
    cacheWrite5m: 0.435,
    cacheWrite1h: 0.435,
    output: 0.87,
    source: "xiaomi",
    note: "Overseas USD API prices per 1M tokens."
  }),
  officialRate({
    provider: "xiaomi",
    model: "mimo-v2.5",
    aliases: ["mimo-v2-5"],
    input: 0.14,
    cachedInput: 0.0028,
    cacheWrite5m: 0.14,
    cacheWrite1h: 0.14,
    output: 0.28,
    source: "xiaomi",
    note: "Overseas USD API prices per 1M tokens."
  }),
  officialRate({
    provider: "xiaomi",
    model: "mimo-v2-pro",
    aliases: ["mimo-v2-pro"],
    input: 0.435,
    cachedInput: 0.0036,
    cacheWrite5m: 0.435,
    cacheWrite1h: 0.435,
    output: 0.87,
    source: "xiaomi",
    note: "Xiaomi docs state mimo-v2-pro routes to V2.5 pricing."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-5.2",
    aliases: ["glm-5-2"],
    input: 1.1799479642947746,
    cachedInput: 0.29498699107369364,
    cacheWrite5m: 1.1799479642947746,
    cacheWrite1h: 1.1799479642947746,
    output: 4.129817875031711,
    source: "Zhipu GLM",
    note: "Official BigModel RMB rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-5.1",
    aliases: ["glm-5-1"],
    input: 0.8849609732210809,
    cachedInput: 0.19174154419790088,
    cacheWrite5m: 0.8849609732210809,
    cacheWrite1h: 0.8849609732210809,
    output: 3.5398438928843237,
    source: "Zhipu GLM",
    note: "Official BigModel RMB short-context rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-4.5-air",
    aliases: ["glm-4-5-air"],
    input: 0.11799479642947747,
    cachedInput: 0.023598959285895494,
    cacheWrite5m: 0.11799479642947747,
    cacheWrite1h: 0.11799479642947747,
    output: 0.29498699107369364,
    source: "Zhipu GLM",
    note: "Official BigModel pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-4.7",
    aliases: ["glm-4-7"],
    input: 0.29498699107369364,
    cachedInput: 0.05899739821473873,
    cacheWrite5m: 0.29498699107369364,
    cacheWrite1h: 0.29498699107369364,
    output: 1.1799479642947746,
    source: "Zhipu GLM",
    note: "Official BigModel pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-5",
    aliases: ["glm-5"],
    input: 0.5899739821473873,
    cachedInput: 0.14749349553684682,
    cacheWrite5m: 0.5899739821473873,
    cacheWrite1h: 0.5899739821473873,
    output: 2.6548829196632426,
    source: "Zhipu GLM",
    note: "Official BigModel pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "Zhipu GLM",
    model: "glm-5-turbo",
    aliases: ["glm-5-turbo"],
    input: 0.7374674776842342,
    cachedInput: 0.17699219464421617,
    cacheWrite5m: 0.7374674776842342,
    cacheWrite1h: 0.7374674776842342,
    output: 3.24485690181063,
    source: "Zhipu GLM",
    note: "Official BigModel pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "DoubaoSeed",
    model: "doubao-pro-32k",
    aliases: ["doubao-pro-32k"],
    source: "DoubaoSeed",
    unavailableReason: "Run npm run pricing:update to fetch official RMB pricing and convert it to USD.",
    note: "Official Ark pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "DoubaoSeed",
    model: "doubao-lite-32k",
    aliases: ["doubao-lite-32k"],
    source: "DoubaoSeed",
    unavailableReason: "Run npm run pricing:update to fetch official RMB pricing and convert it to USD.",
    note: "Official Ark pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "DoubaoSeed",
    model: "doubao-pro-256k",
    aliases: ["doubao-pro-256k"],
    source: "DoubaoSeed",
    unavailableReason: "Run npm run pricing:update to fetch official RMB pricing and convert it to USD.",
    note: "Official Ark pricing page. RMB prices are converted to USD for internal cost math."
  }),
  officialRate({
    provider: "Gemini",
    model: "gemini-2.5-flash",
    aliases: ["gemini-2-5-flash", "gemini-flash-latest"],
    input: 0.3,
    cachedInput: 0.075,
    cacheWrite5m: 0.3,
    cacheWrite1h: 0.3,
    output: 2.5,
    source: "Gemini",
    note: "Gemini API standard rate for prompts up to 200k tokens."
  }),
  officialRate({
    provider: "Gemini",
    model: "gemini-2.5-pro",
    aliases: ["gemini-2-5-pro", "gemini-pro-latest"],
    input: 1.25,
    cachedInput: 0.31,
    cacheWrite5m: 1.25,
    cacheWrite1h: 1.25,
    output: 10,
    source: "Gemini",
    note: "Gemini API short-context rate for prompts up to 200k tokens."
  }),
  officialRate({
    provider: "Gemini",
    model: "gemini-2.5-pro-long-context",
    aliases: ["gemini-2-5-pro-long-context"],
    input: 2.5,
    cachedInput: 0.625,
    cacheWrite5m: 2.5,
    cacheWrite1h: 2.5,
    output: 15,
    source: "Gemini",
    note: "Gemini API long-context rate for prompts over 200k tokens."
  }),
  officialRate({
    provider: "Kimi",
    model: "kimi-k2.7-code",
    aliases: ["kimi-k2-7-code"],
    input: 0.9587077209895044,
    cachedInput: 0.19174154419790088,
    cacheWrite5m: 0.9587077209895044,
    cacheWrite1h: 0.9587077209895044,
    output: 3.982324379494864,
    source: "Kimi",
    note: "Official Kimi API CNY rate parsed from the current model pricing pages."
  }),
  officialRate({
    provider: "Kimi",
    model: "kimi-k2.7-code-highspeed",
    aliases: ["kimi-k2-7-code-highspeed"],
    input: 1.9174154419790088,
    cachedInput: 0.38348308839580175,
    cacheWrite5m: 1.9174154419790088,
    cacheWrite1h: 1.9174154419790088,
    output: 7.964648758989728,
    source: "Kimi",
    note: "Official Kimi API CNY rate parsed from the current model pricing pages."
  }),
  officialRate({
    provider: "Kimi",
    model: "kimi-k2.6",
    aliases: ["kimi-k2-6"],
    input: 0.9587077209895044,
    cachedInput: 0.16224284509053152,
    cacheWrite5m: 0.9587077209895044,
    cacheWrite1h: 0.9587077209895044,
    output: 3.982324379494864,
    source: "Kimi",
    note: "Official Kimi API CNY rate parsed from the current model pricing pages."
  }),
  officialRate({
    provider: "Kimi",
    model: "kimi-k2.5",
    aliases: ["kimi-k2-5"],
    input: 0.5893690494906452,
    cachedInput: 0.1031395836608629,
    cacheWrite5m: 0.5893690494906452,
    cacheWrite1h: 0.5893690494906452,
    output: 3.094187509825887,
    source: "Kimi",
    note: "Official Kimi API RMB rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen3.7-plus",
    aliases: ["qwen3-7-plus"],
    input: 0.29498699107369364,
    cachedInput: 0.29498699107369364,
    cacheWrite5m: 0.29498699107369364,
    cacheWrite1h: 0.29498699107369364,
    output: 1.1799479642947746,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB short-context rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen3.7-max",
    aliases: ["qwen3-7-max"],
    input: 1.7699219464421618,
    cachedInput: 1.7699219464421618,
    cacheWrite5m: 1.7699219464421618,
    cacheWrite1h: 1.7699219464421618,
    output: 5.309765839326485,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen3.6-flash",
    aliases: ["qwen3-6-flash"],
    input: 0.17699219464421617,
    cachedInput: 0.17699219464421617,
    cacheWrite5m: 0.17699219464421617,
    cacheWrite1h: 0.17699219464421617,
    output: 1.0619531678652971,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen3-coder-plus",
    aliases: ["qwen3-coder-plus", "qwen3-coder"],
    input: 0.5899739821473873,
    cachedInput: 0.5899739821473873,
    cacheWrite5m: 0.5899739821473873,
    cacheWrite1h: 0.5899739821473873,
    output: 2.359895928589549,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB short-context Coder rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen3-coder-flash",
    aliases: ["qwen3-coder-flash"],
    input: 0.14749349553684682,
    cachedInput: 0.14749349553684682,
    cacheWrite5m: 0.14749349553684682,
    cacheWrite1h: 0.14749349553684682,
    output: 0.5899739821473873,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB short-context Coder rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen-coder-plus",
    aliases: ["qwen-coder-plus"],
    input: 0.5162272343789639,
    cachedInput: 0.5162272343789639,
    cacheWrite5m: 0.5162272343789639,
    cacheWrite1h: 0.5162272343789639,
    output: 1.0324544687579278,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB Coder rate converted to USD at the last verified refresh rate."
  }),
  officialRate({
    provider: "Qwen",
    model: "qwen-coder-turbo",
    aliases: ["qwen-coder-turbo"],
    input: 0.29498699107369364,
    cachedInput: 0.29498699107369364,
    cacheWrite5m: 0.29498699107369364,
    cacheWrite1h: 0.29498699107369364,
    output: 0.8849609732210809,
    source: "Qwen",
    note: "Official Alibaba Cloud Model Studio RMB Coder rate converted to USD at the last verified refresh rate."
  })
];

/**
 * Kept for the collector API shape. No network or third-party cache is used.
 */
export async function loadPricing(cachePath = null) {
  const cached = await readPricingCache(cachePath);
  if (cached) return cached;
  return {
    mode: 'official-docs',
    verifiedAt: VERIFIED_AT,
    sources: OFFICIAL_PRICING_SOURCES,
    models: OFFICIAL_PRICE_TABLE
  };
}

export function calculateCost(model, tokens, _pricingData = null, provider = null) {
  return calculateOfficialCost(model, tokens, { provider, pricingData: _pricingData }).totalUSD;
}

export function calculateOfficialCost(model, tokens = {}, options = {}) {
  const pricing = resolveOfficialPricing(model, options.provider, options.pricingData);
  const normalizedTokens = normalizeTokens(tokens);

  if (!pricing || !pricing.priced) {
    return {
      model: normalizeModelId(model),
      resolvedModel: pricing?.model || null,
      provider: pricing?.provider || null,
      priced: false,
      status: pricing?.unavailableReason ? 'unpriced' : 'unknown-model',
      reason: pricing?.unavailableReason || 'No official USD token price is configured for this model.',
      tokens: normalizedTokens,
      ratesPerMTok: null,
      totalUSD: 0,
      source: pricing?.source || null
    };
  }

  const cacheWriteMode = normalizeAnthropicCacheWriteTtl(options.anthropicCacheWriteTtl);
  const rates = ratesForCalculation(pricing.ratesPerMTok, pricing.provider, cacheWriteMode);
  const outputTokens = normalizedTokens.output + normalizedTokens.reasoning;
  const inputUSD = costPart(normalizedTokens.input, rates.input);
  const cachedInputUSD = costPart(normalizedTokens.cacheRead, rates.cachedInput);
  const cacheWriteUSD = costPart(normalizedTokens.cacheWrite, rates.cacheWrite);
  const outputUSD = costPart(outputTokens, rates.output);

  return {
    model: normalizeModelId(model),
    resolvedModel: pricing.model,
    provider: pricing.provider,
    priced: true,
    status: 'priced',
    reason: null,
    tokens: normalizedTokens,
    ratesPerMTok: rates,
    parts: {
      inputUSD,
      cachedInputUSD,
      cacheWriteUSD,
      outputUSD
    },
    totalUSD: inputUSD + cachedInputUSD + cacheWriteUSD + outputUSD,
    source: pricing.source,
    note: pricing.note || null
  };
}

export function resolveOfficialPricing(model, provider = null, pricingData = null) {
  const normalized = normalizeModelId(model);
  if (!normalized || normalized === '<synthetic>') return null;

  const candidates = modelCandidates(normalized, provider);
  const sorted = pricingTableFrom(pricingData)
    .slice()
    .sort((a, b) => longestAliasLength(b) - longestAliasLength(a));

  for (const rate of sorted) {
    if (matchesRate(rate, candidates)) return rate;
  }

  return null;
}

export function officialPricingMetadata(rows = [], pricingData = null) {
  const byModel = new Map();
  let totalTokens = 0;
  let pricedTokens = 0;
  let pricedCostUSD = 0;
  const metadata = pricingData && pricingData.models?.length ? pricingData : null;

  for (const row of rows) {
    const tokens = tokenTotal(row);
    totalTokens += tokens;
    const cost = Number(row.costUSD || 0);
    const priced = row.pricingStatus === 'priced' || cost > 0;
    if (priced) {
      pricedTokens += tokens;
      pricedCostUSD += cost;
      continue;
    }
    const model = row.model || row.pricingModel || 'unknown';
    const current = byModel.get(model) || { model, totalTokens: 0, rows: 0, reason: row.pricingReason || 'No official USD price.' };
    current.totalTokens += tokens;
    current.rows += 1;
    byModel.set(model, current);
  }

  return {
    mode: 'official-price-conversion',
    currency: 'USD',
    verifiedAt: metadata?.verifiedAt || VERIFIED_AT,
    fetchedAt: metadata?.fetchedAt || null,
    totalTokens,
    pricedTokens,
    unpricedTokens: Math.max(0, totalTokens - pricedTokens),
    pricedShare: totalTokens ? pricedTokens / totalTokens : 1,
    pricedCostUSD,
    sources: metadata?.sources || OFFICIAL_PRICING_SOURCES,
    unpricedModels: Array.from(byModel.values())
      .sort((a, b) => b.totalTokens - a.totalTokens)
  };
}

export function attachOfficialPricing(row, model = row?.model, provider = null, pricingData = null) {
  const cacheRead = Number(row?.cacheReadTokens ?? row?.cacheRead ?? 0)
    + Number(row?.cachedInputTokens ?? row?.cachedInput ?? 0);
  const tokens = {
    input: row?.inputTokens ?? row?.input,
    output: row?.outputTokens ?? row?.output,
    cacheRead,
    cacheWrite: row?.cacheCreationTokens ?? row?.cacheWrite,
    reasoning: row?.reasoningOutputTokens ?? row?.reasoning
  };
  const cost = calculateOfficialCost(model, tokens, { provider, pricingData });
  return {
    ...row,
    costUSD: cost.totalUSD,
    pricingStatus: cost.status,
    pricingModel: cost.resolvedModel || cost.model || model || null,
    pricingProvider: cost.provider || null,
    pricingReason: cost.reason || null,
    pricingSource: cost.source?.url || null,
    pricingSourceLabel: cost.source?.label || null,
    pricingRatesPerMTok: cost.ratesPerMTok || null
  };
}

function officialRate({
  provider,
  model,
  aliases,
  input,
  cachedInput,
  cacheWrite5m,
  cacheWrite1h,
  output,
  source,
  note,
  unavailableReason
}) {
  const sourceMeta = findPricingSource(source);
  const priced = input != null && output != null && !unavailableReason;
  return {
    provider,
    model,
    aliases: aliases.map(normalizeModelId),
    priced,
    unavailableReason: unavailableReason || null,
    ratesPerMTok: priced ? {
      input: Number(input),
      cachedInput: Number(cachedInput ?? input),
      cacheWrite5m: Number(cacheWrite5m ?? input),
      cacheWrite1h: Number(cacheWrite1h ?? cacheWrite5m ?? input),
      output: Number(output)
    } : null,
    source: sourceMeta,
    note: note || sourceMeta?.note || null
  };
}

export function serializeOfficialPricingModels(models = OFFICIAL_PRICE_TABLE) {
  return models.map(row => ({
    provider: row.provider,
    model: row.model,
    aliases: row.aliases,
    priced: row.priced,
    unavailableReason: row.unavailableReason,
    ratesPerMTok: row.ratesPerMTok,
    officialRatesPerMTok: row.officialRatesPerMTok || null,
    sourceProvider: row.source?.provider || row.source?.label || null,
    pricingFetchStatus: row.pricingFetchStatus || null,
    note: row.note || null
  }));
}

function pricingTableFrom(pricingData = null) {
  if (!pricingData?.models?.length) return OFFICIAL_PRICE_TABLE;
  const merged = new Map(OFFICIAL_PRICE_TABLE.map(model => [pricingKey(model), model]));
  const cached = pricingData.models
    .map(model => normalizeCachedRate(model))
    .filter(Boolean);
  for (const model of cached) {
    merged.set(pricingKey(model), model);
  }
  return Array.from(merged.values());
}

function normalizeCachedRate(row = {}) {
  const sourceKey = row.sourceProvider || row.source?.provider || row.source || row.provider;
  const provider = canonicalProvider(row.provider);
  const sourceMeta = findPricingSource(sourceKey);
  const rates = row.ratesPerMTok || {};
  const hasRates = rates.input != null && rates.output != null;
  const priced = row.priced !== false && hasRates && !row.unavailableReason;
  return {
    provider,
    model: row.model,
    aliases: (row.aliases || [row.model]).map(normalizeModelId),
    priced,
    unavailableReason: row.unavailableReason || null,
    ratesPerMTok: priced ? {
      input: Number(rates.input),
      cachedInput: Number(rates.cachedInput ?? rates.input),
      cacheWrite5m: Number(rates.cacheWrite5m ?? rates.input),
      cacheWrite1h: Number(rates.cacheWrite1h ?? rates.cacheWrite5m ?? rates.input),
      output: Number(rates.output)
    } : null,
    officialRatesPerMTok: row.officialRatesPerMTok || null,
    source: sourceMeta,
    pricingFetchStatus: row.pricingFetchStatus || null,
    note: row.note || sourceMeta?.note || null
  };
}

function pricingKey(row = {}) {
  return `${normalizeProvider(row.provider)}::${normalizeModelId(row.model)}`;
}

function findPricingSource(provider) {
  const key = normalizeProvider(provider);
  return OFFICIAL_PRICING_SOURCES.find(item => normalizeProvider(item.provider) === key) || null;
}

async function readPricingCache(cachePath) {
  if (!cachePath) return null;
  try {
    const { readFile } = await Function('specifier', 'return import(specifier)')('node:fs/promises');
    const text = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(text);
    const models = pricingTableFrom(parsed);
    if (!models.length) return null;
    return {
      mode: parsed.mode || 'official-cache',
      verifiedAt: parsed.verifiedAt || parsed.fetchedAt || VERIFIED_AT,
      fetchedAt: parsed.fetchedAt || null,
      sources: parsed.sources || OFFICIAL_PRICING_SOURCES,
      models
    };
  } catch {
    return null;
  }
}

function ratesForCalculation(rates, provider, cacheWriteMode) {
  return {
    input: validRate(rates.input),
    cachedInput: validRate(rates.cachedInput),
    cacheWrite: validRate(
      provider === 'anthropic' && cacheWriteMode === '1h'
        ? rates.cacheWrite1h
        : rates.cacheWrite5m
    ),
    output: validRate(rates.output)
  };
}

function normalizeAnthropicCacheWriteTtl(value = globalThis.process?.env?.ANTHROPIC_CACHE_WRITE_TTL) {
  const normalized = String(value || DEFAULT_ANTHROPIC_CACHE_WRITE_TTL).trim().toLowerCase();
  return normalized === '1h' || normalized === 'hour' || normalized === '3600' ? '1h' : '5m';
}

function modelCandidates(model, provider) {
  const normalized = normalizeModelId(model);
  const bare = normalized.split('/').at(-1);
  const providerPrefix = normalized.includes('/') ? normalized.split('/').at(0) : '';
  const values = [
    normalized,
    bare,
    normalizeVersionSeparator(normalized),
    normalizeVersionSeparator(bare)
  ].filter(Boolean);
  const providerHint = normalizeProvider(provider);
  if (providerHint) {
    values.push(`${providerHint}/${bare}`);
  } else if (providerPrefix) {
    values.push(`${providerPrefix}/${bare}`);
  }
  return Array.from(new Set(values));
}

function matchesRate(rate, candidates) {
  const providerKey = normalizeProvider(rate.provider);
  return candidates.some(candidate => {
    const text = String(candidate || '');
    const slash = text.indexOf('/');
    const candidateProvider = slash > 0 ? normalizeProvider(text.slice(0, slash)) : '';
    const candidateModel = slash > 0 ? text.slice(slash + 1) : text;
    if (candidateProvider && candidateProvider !== providerKey) return false;
    return rate.aliases.some(alias =>
      candidateModel === alias ||
      candidateModel.startsWith(`${alias}-`) ||
      candidateModel.startsWith(`${alias}:`)
    );
  });
}

function longestAliasLength(rate) {
  return Math.max(...rate.aliases.map(alias => alias.length));
}

function normalizeTokens(tokens = {}) {
  return {
    input: positive(tokens.input),
    output: positive(tokens.output),
    cacheRead: positive(tokens.cacheRead ?? tokens.cache_read),
    cacheWrite: positive(tokens.cacheWrite ?? tokens.cache_write),
    reasoning: positive(tokens.reasoning)
  };
}

function tokenTotal(row = {}) {
  return positive(row.totalTokens ?? row.total_tokens)
    || positive(row.inputTokens) + positive(row.outputTokens)
      + positive(row.cacheReadTokens) + positive(row.cacheCreationTokens)
      + positive(row.reasoningOutputTokens);
}

function costPart(tokens, ratePerMTok) {
  return positive(tokens) * validRate(ratePerMTok) / MTOK;
}

function validRate(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function positive(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeProvider(value) {
  return String(canonicalProvider(value) || '').trim().toLowerCase().replace(/_/g, '-');
}

function canonicalProvider(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (['zai', 'z ai', 'zhipu', 'zhipu ai', 'zhipu glm', 'bigmodel'].includes(normalized)) return 'Zhipu GLM';
  if (['volcengine', 'volc engine', 'ark', 'doubao', 'doubao seed', 'doubaoseed', 'bytedance'].includes(normalized)) return 'DoubaoSeed';
  if (['google', 'gemini'].includes(normalized)) return 'Gemini';
  if (['moonshot', 'moonshot ai', 'moonshotai', 'kimi'].includes(normalized)) return 'Kimi';
  if (['qwen', 'tongyi', 'tongyi qianwen', 'aliyun', 'alibaba', 'alibaba cloud', 'dashscope', 'model studio'].includes(normalized)) return 'Qwen';
  return String(value || '').trim();
}

function normalizeModelId(value) {
  return String(value || '').trim().toLowerCase().replace(/(?<=\d)\.(?=\d)/g, '-');
}

function normalizeVersionSeparator(id) {
  const text = String(id || '');
  const normalized = text.replace(/(?<=\d)\.(?=\d)/g, '-');
  return normalized === text ? null : normalized;
}
