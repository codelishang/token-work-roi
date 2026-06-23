const FIELD_LABELS = {
  projectAlias: '项目',
  taskType: '任务',
  outputStatus: '产出状态',
  workPurpose: '目的',
  workStage: '阶段',
  valueLevel: '价值',
  outputUrl: '产出链接',
  outputType: '产出类型',
  outputLabel: '产出标签'
};

const CORE_FIELDS = ['projectAlias', 'taskType', 'outputStatus', 'workPurpose', 'workStage', 'valueLevel'];

export function buildTrustEvidenceQueue({ trust = null, evidencePlan = null, limit = 10 } = {}) {
  const trustedSources = trustedSourceSet(trust);
  const suggestions = Array.isArray(evidencePlan?.suggestions)
    ? evidencePlan.suggestions
    : Array.isArray(evidencePlan?.queue) ? evidencePlan.queue : [];
  const trustedRows = suggestions
    .filter(item => matchesTrustedSource(item, trustedSources))
    .map(item => normalizeQueueRow(item, trustedSources))
    .sort(compareQueueRows)
    .slice(0, Math.max(1, Number(limit || 10)));
  const totalTokens = trustedRows.reduce((sum, row) => sum + row.totalTokens, 0);
  const totalCostUSD = trustedRows.reduce((sum, row) => sum + row.costUSD, 0);

  return {
    generatedAt: evidencePlan?.generatedAt || null,
    trustedSourceCount: trustedSources.labels.length,
    trustedSourceLabels: trustedSources.labels,
    totalSuggestions: suggestions.length,
    trustedSuggestionCount: suggestions.filter(item => matchesTrustedSource(item, trustedSources)).length,
    rows: trustedRows,
    canApplyCount: trustedRows.filter(row => row.canApply).length,
    draftCount: trustedRows.filter(row => !row.canApply).length,
    totalTokens,
    totalCostUSD,
    nextAction: trustedRows.length
      ? '先处理队列里官方价或 token 最高的证据缺口。'
      : trustedSources.labels.length
        ? '可信来源已有数据，但当前没有可推断证据。去 /review 查看人工归因缺口。'
        : '当前没有可信来源 session。先运行 coverage 或导入 ccusage JSON。'
  };
}

function trustedSourceSet(trust) {
  const sources = Array.isArray(trust?.sources) ? trust.sources : [];
  const trusted = sources.filter(source => source.successfulCoverage || source.conclusion === '可用于 ROI 复盘');
  const keys = new Set();
  const labels = [];
  for (const source of trusted) {
    const id = normalize(source.id);
    const label = normalize(source.label);
    if (id) keys.add(id);
    if (label) keys.add(label);
    if (source.label) labels.push(String(source.label));
  }
  return { keys, labels };
}

function matchesTrustedSource(item, trustedSources) {
  if (!trustedSources.keys.size) return false;
  const source = normalize(item?.source);
  if (!source) return false;
  if (trustedSources.keys.has(source)) return true;
  for (const key of trustedSources.keys) {
    if (key && (source.includes(key) || key.includes(source))) return true;
  }
  return false;
}

function normalizeQueueRow(item, trustedSources) {
  const fields = Array.isArray(item.fields) ? item.fields : [];
  const suggestedValues = item.suggestedValues || {};
  const missingFields = missingFieldLabels(fields, suggestedValues);
  return {
    suggestionId: item.suggestionId,
    kind: item.kind || 'annotation',
    title: item.title || '待补证据',
    project: item.project || '未识别项目',
    source: item.source || 'unknown',
    model: item.model || '',
    sessionId: item.sessionId || '',
    provenance: item.provenance || '待确认草稿',
    confidence: Number(item.confidence || 0),
    totalTokens: Number(item.totalTokens || 0),
    costUSD: Number(item.costUSD || 0),
    canApply: Boolean(item.canApply),
    reason: item.reason || '基于本地结构化元数据生成。',
    action: item.action || '需要人工确认后再写入。',
    missingFields,
    suggestedValues,
    whyTrusted: trustedSources.labels.length
      ? `来自可信覆盖来源：${trustedSources.labels.join(' / ')}`
      : '当前来源未通过可信覆盖。'
  };
}

function missingFieldLabels(fields, suggestedValues) {
  const labels = [];
  const fieldSet = new Set(fields);
  for (const field of CORE_FIELDS) {
    if (fieldSet.has(field) || suggestedValues[field]) labels.push(FIELD_LABELS[field]);
  }
  for (const field of fields) {
    if (!CORE_FIELDS.includes(field)) labels.push(FIELD_LABELS[field] || field);
  }
  return Array.from(new Set(labels)).slice(0, 6);
}

function compareQueueRows(a, b) {
  return (b.costUSD - a.costUSD)
    || (b.totalTokens - a.totalTokens)
    || (Number(b.canApply) - Number(a.canApply))
    || (b.confidence - a.confidence);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/gu, '-');
}
