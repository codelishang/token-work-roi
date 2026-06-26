import { calculateOfficialCost } from '../../pricing.mjs';
import { modelTier } from './roi-advisor.js';

const PRODUCTIVE_STATUSES = new Set(['已完成', '已发布']);
const HIGH_VALUE_LEVELS = new Set(['高', '关键']);
const LOW_VALUE_LEVELS = new Set(['低']);
const EXPLORATION_PURPOSES = new Set(['需求澄清', '技术调研', '测试验证', '上下文整理']);
const EXPLORATION_STAGES = new Set(['探索', '验证']);
const CONTEXT_PURPOSES = new Set(['上下文整理']);
const TARGET_MODELS = {
  light: [
    { model: 'deepseek-v4-flash', provider: 'deepseek', label: 'DeepSeek V4 Flash' },
    { model: 'mimo-v2.5', provider: 'xiaomi', label: 'MiMo v2.5' },
    { model: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },
    { model: 'gemini-2.5-flash', provider: 'Gemini', label: 'Gemini 2.5 Flash' },
    { model: 'kimi-k2.5', provider: 'Kimi', label: 'Kimi K2.5' }
  ],
  mid: [
    { model: 'gpt-5.3-codex', provider: 'openai', label: 'GPT-5.3 Codex' },
    { model: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6' },
    { model: 'deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro' },
    { model: 'mimo-v2.5-pro', provider: 'xiaomi', label: 'MiMo v2.5 Pro' },
    { model: 'gemini-2.5-pro', provider: 'Gemini', label: 'Gemini 2.5 Pro' },
    { model: 'kimi-k2.7-code', provider: 'Kimi', label: 'Kimi K2.7 Code' }
  ]
};

export function buildSavingsSimulation({ sessions = [], daily = [], pricingMeta = null } = {}) {
  const rows = sessions.length ? sessions : daily;
  const totalCostUSD = rows.reduce((sum, row) => sum + pricedCost(row), 0);
  const totalTokens = rows.reduce((sum, row) => sum + tokensFor(row).total, 0);
  const unpricedSessions = rows
    .filter(row => isUnpriced(row) && tokensFor(row).total > 0)
    .map(row => ({
      sessionId: row.sessionId || row.id || '',
      model: row.model || row.pricingModel || 'unknown',
      totalTokens: tokensFor(row).total,
      reason: row.pricingReason || '未配置官方公开美元价'
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const grouped = new Map();
  for (const row of rows) {
    const candidate = classifyCandidate(row);
    if (!candidate) continue;

    const currentCostUSD = pricedCost(row);
    if (currentCostUSD <= 0 || isUnpriced(row)) continue;

    const simulated = simulateTargetCost(row, candidate.targetTier);
    if (!simulated || simulated.costUSD >= currentCostUSD) continue;

    const key = candidate.id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...candidate,
        sessionCount: 0,
        totalTokens: 0,
        currentCostUSD: 0,
        simulatedCostUSD: 0,
        savingsUSD: 0,
        targetModels: new Map(),
        evidenceCounts: new Map(),
        sampleSessions: []
      });
    }

    const target = grouped.get(key);
    const tokens = tokensFor(row);
    target.sessionCount += 1;
    target.totalTokens += tokens.total;
    target.currentCostUSD += currentCostUSD;
    target.simulatedCostUSD += simulated.costUSD;
    target.savingsUSD += currentCostUSD - simulated.costUSD;
    target.targetModels.set(simulated.model, simulated.label);
    const evidenceLabel = evidenceQualityForRow(row);
    target.evidenceCounts.set(evidenceLabel, (target.evidenceCounts.get(evidenceLabel) || 0) + 1);
    if (target.sampleSessions.length < 3) {
      target.sampleSessions.push({
        sessionId: row.sessionId || row.id || '',
        project: projectLabel(row),
        model: row.model || row.pricingModel || 'unknown',
        totalTokens: tokens.total,
        costUSD: currentCostUSD,
        evidenceQuality: evidenceLabel
      });
    }
  }

  const suggestions = Array.from(grouped.values())
    .map(row => ({
      id: row.id,
      title: row.title,
      recommendation: row.recommendation,
      currentTier: row.currentTier,
      suggestedTier: row.targetTier,
      suggestedModels: Array.from(row.targetModels.values()),
      sessionCount: row.sessionCount,
      totalTokens: row.totalTokens,
      currentCostUSD: row.currentCostUSD,
      simulatedCostUSD: row.simulatedCostUSD,
      savingsUSD: row.savingsUSD,
      savingsShare: row.currentCostUSD ? row.savingsUSD / row.currentCostUSD : 0,
      why: row.why,
      action: row.action,
      evidenceQuality: dominantEvidenceQuality(row.evidenceCounts),
      evidenceSummary: evidenceSummary(row.evidenceCounts),
      sampleSessions: row.sampleSessions,
      score: row.savingsUSD * 100 + row.totalTokens / 1000 + row.priority
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'official-price-simulation',
    totalCostUSD,
    totalTokens,
    potentialSavingsUSD: suggestions.reduce((sum, row) => sum + row.savingsUSD, 0),
    suggestions,
    unpriced: {
      sessionCount: unpricedSessions.length,
      totalTokens: unpricedSessions.reduce((sum, row) => sum + row.totalTokens, 0),
      models: Array.from(new Set(unpricedSessions.map(row => row.model))).slice(0, 8),
      sampleSessions: unpricedSessions.slice(0, 5)
    },
    pricingMeta
  };
}

function classifyCandidate(row = {}) {
  const currentTier = modelTier(row.model || row.pricingModel, row.pricingStatus);
  if (!['heavy', 'mid'].includes(currentTier)) return null;
  if (isHighValueProductive(row)) return null;

  if (isLowValueOrWaste(row)) {
    return {
      id: `${currentTier}-low-value-to-light`,
      currentTier,
      targetTier: 'light',
      priority: currentTier === 'heavy' ? 90 : 70,
      title: '低价值或废弃任务先切轻量模型',
      recommendation: '把低价值、已废弃或高不确定性的工作先用轻量模型试错，再决定是否升级。',
      why: '这类 session 的产出价值或状态已经显示风险，继续使用高单价模型会放大沉没成本。',
      action: '为同类任务设置轻量模型默认值和 token 止损线，确认方向后再升级。'
    };
  }

  if (isExplorationOrValidation(row)) {
    return {
      id: `${currentTier}-exploration-to-light`,
      currentTier,
      targetTier: 'light',
      priority: currentTier === 'heavy' ? 82 : 62,
      title: '探索、测试和上下文整理优先轻量化',
      recommendation: '需求澄清、技术调研、测试验证、上下文整理默认使用轻量模型。',
      why: '这些工作更像快速判断方向，不应该一开始就使用重模型完整推理。',
      action: '把探索/验证阶段的默认模型切到轻量层；进入复杂实现或发布审查再升级。'
    };
  }

  if (currentTier === 'heavy' && row.workStage === '实现') {
    return {
      id: 'heavy-implementation-to-mid',
      currentTier,
      targetTier: 'mid',
      priority: 45,
      title: '普通实现阶段先用中模型承接',
      recommendation: '非关键价值的实现任务先用中模型，关键审查和复杂收口再上重模型。',
      why: '实现阶段通常需要稳定代码能力，但不一定每轮都需要最高成本模型。',
      action: '把普通功能开发默认切到中模型；只在关键产出、架构风险或发布审查时使用重模型。'
    };
  }

  if (currentTier === 'heavy' && CONTEXT_PURPOSES.has(row.workPurpose)) {
    return {
      id: 'heavy-context-to-light',
      currentTier,
      targetTier: 'light',
      priority: 75,
      title: '上下文整理不要占用重模型预算',
      recommendation: '上下文整理、摘要和文件筛选先交给轻量模型完成。',
      why: '整理材料的目标是减少后续上下文，不应本身成为高成本入口。',
      action: '把项目摘要、文件清单、错误归纳沉淀为轻量模型任务。'
    };
  }

  return null;
}

function simulateTargetCost(row, tier) {
  const tokens = tokensFor(row);
  const candidates = orderedTargetModels(tier, row)
    .map(candidate => ({
      ...candidate,
      costUSD: calculateOfficialCost(candidate.model, tokens, { provider: candidate.provider }).totalUSD
    }))
    .filter(candidate => candidate.costUSD > 0)
    .sort((a, b) => a.costUSD - b.costUSD);
  return candidates[0] || null;
}

function orderedTargetModels(tier, row = {}) {
  const candidates = TARGET_MODELS[tier] || [];
  const provider = String(row.pricingProvider || providerFromSource(row.source) || '').toLowerCase();
  const preferred = candidates.filter(candidate => candidate.provider === provider);
  const rest = candidates.filter(candidate => candidate.provider !== provider);
  return [...preferred, ...rest];
}

function tokensFor(row = {}) {
  const input = positive(row.inputTokens ?? row.input_tokens);
  const output = positive(row.outputTokens ?? row.output_tokens);
  const cacheRead = positive(row.cacheReadTokens ?? row.cache_read_tokens);
  const cacheWrite = positive(row.cacheCreationTokens ?? row.cache_creation_tokens);
  const reasoning = positive(row.reasoningOutputTokens ?? row.reasoningTokens ?? row.reasoning_output_tokens);
  const total = positive(row.totalTokens ?? row.total_tokens)
    || input + output + cacheRead + cacheWrite + reasoning;
  return { input, output, cacheRead, cacheWrite, reasoning, total };
}

function pricedCost(row = {}) {
  const value = Number(row.costUSD ?? row.cost_usd ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isUnpriced(row = {}) {
  return row.pricingStatus === 'unpriced'
    || modelTier(row.model || row.pricingModel, row.pricingStatus) === 'unpriced';
}

function isHighValueProductive(row = {}) {
  return HIGH_VALUE_LEVELS.has(row.valueLevel)
    && PRODUCTIVE_STATUSES.has(row.outputStatus);
}

function isLowValueOrWaste(row = {}) {
  return row.outputStatus === '已废弃' || LOW_VALUE_LEVELS.has(row.valueLevel);
}

function isExplorationOrValidation(row = {}) {
  return EXPLORATION_PURPOSES.has(row.workPurpose)
    || EXPLORATION_STAGES.has(row.workStage);
}

function projectLabel(row = {}) {
  return row.projectAlias || row.projectPath || row.sessionId || row.source || 'unknown';
}

function evidenceQualityForRow(row = {}) {
  if (row.annotationSource === 'manual' || row.annotationSource === 'imported') return '人工确认';
  if (row.annotationSource === 'auto' && Number(row.annotationConfidence || 0) >= 80) return '自动高置信';
  if (row.annotationSource === 'auto') return '待确认草稿';
  if (
    (row.taskType && row.taskType !== '未分类')
    || (row.workPurpose && row.workPurpose !== '未说明')
    || (row.workStage && row.workStage !== '未说明')
    || (row.valueLevel && row.valueLevel !== '未评估')
  ) return '待确认草稿';
  return '缺证据';
}

function dominantEvidenceQuality(counts = new Map()) {
  let best = '缺证据';
  let bestCount = -1;
  for (const [label, count] of counts.entries()) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function evidenceSummary(counts = new Map()) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${count}`)
    .join(' / ') || '缺证据';
}

function providerFromSource(source) {
  const value = String(source || '').toLowerCase();
  if (value.includes('claude') || value.includes('anthropic')) return 'anthropic';
  if (value.includes('codex') || value.includes('openai')) return 'openai';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('mimo') || value.includes('xiaomi')) return 'xiaomi';
  return null;
}

function positive(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
