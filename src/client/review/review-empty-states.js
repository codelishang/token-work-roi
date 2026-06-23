const DEFAULT_TASK_TYPE = '未分类';
const DEFAULT_WORK_PURPOSE = '未说明';
const DEFAULT_WORK_STAGE = '未说明';
const DEFAULT_VALUE_LEVEL = '未评估';
const PRODUCTIVE_STATUSES = new Set(['已完成', '已发布']);
const LOW_VALUE_LEVELS = new Set(['低']);
const EXPLORATION_PURPOSES = new Set(['需求澄清', '技术调研', '测试验证', '上下文整理']);
const EXPLORATION_STAGES = new Set(['探索', '验证']);

export function buildEvidenceZeroState(evidence = {}, projectCoverage = {}) {
  const missing = [];
  if (!evidence.manualConfirmed) missing.push('没有人工确认的 session，自动归因只能算草稿。');
  if (!evidence.withOutput) missing.push('没有产出链接，无法说明 token 换来了 PR、commit、文章、部署或文档。');
  if (!evidence.complete) missing.push('任务、目的、阶段、价值或产出状态还没补齐，ROI Evidence Score 会保持低位。');

  return {
    isZero: Number(evidence.evidenceScore || 0) === 0,
    title: 'Token 已采到，但 ROI 证据还没补齐',
    summary: `${projectCoverage.sessionCount || evidence.sessionCount || 0} 个 session 可以复盘；当前缺的是归因和产出证据，不是 token 采集。`,
    missing,
    action: '先点一键懒人归因，再只人工确认最高成本的少数 session。'
  };
}

export function buildSavingsEmptyReason({ simulation = {}, sessions = [] } = {}) {
  const suggestions = simulation.suggestions || [];
  if (suggestions.length) return null;

  const total = sessions.length;
  const annotated = sessions.filter(hasStrategyFields).length;
  const unpriced = simulation.unpriced?.sessionCount || 0;
  const highValueProtected = sessions.filter(isHighValueProductive).length;
  const downgradeCandidates = sessions.filter(session =>
    hasStrategyFields(session)
    && !isHighValueProductive(session)
    && (isLowValueOrWaste(session) || isExploration(session))
  ).length;

  const reasons = [];
  if (total && annotated === 0) {
    reasons.push('还没有任务、目的、阶段或价值标注，系统无法判断哪些工作适合降级模型。');
  }
  if (unpriced) {
    reasons.push(`${unpriced} 个 session 使用未公开官方美元价模型，只参与 token 复盘，不参与官方价节省模拟。`);
  }
  if (highValueProtected) {
    reasons.push(`${highValueProtected} 个已完成/已发布或高价值 session 被保护，不会建议降级模型。`);
  }
  if (annotated && downgradeCandidates === 0) {
    reasons.push('当前没有低价值、已废弃、探索、验证或上下文整理类候选，所以没有可计算降级建议。');
  }
  if (!reasons.length) {
    reasons.push('当前周期没有足够结构化证据触发模型切换建议。');
  }

  return {
    title: '没有节省建议，不等于没有价值',
    reasons,
    action: total && annotated === 0
      ? '先用一键懒人归因补齐草稿，再确认最高成本 session。'
      : '继续观察 ROI Advisor，或给低价值/废弃任务补状态后再看节省模拟。'
  };
}

function hasStrategyFields(session = {}) {
  return (session.taskType || DEFAULT_TASK_TYPE) !== DEFAULT_TASK_TYPE
    || (session.workPurpose || DEFAULT_WORK_PURPOSE) !== DEFAULT_WORK_PURPOSE
    || (session.workStage || DEFAULT_WORK_STAGE) !== DEFAULT_WORK_STAGE
    || (session.valueLevel || DEFAULT_VALUE_LEVEL) !== DEFAULT_VALUE_LEVEL;
}

function isHighValueProductive(session = {}) {
  return PRODUCTIVE_STATUSES.has(session.outputStatus) && ['高', '关键'].includes(session.valueLevel);
}

function isLowValueOrWaste(session = {}) {
  return session.outputStatus === '已废弃' || LOW_VALUE_LEVELS.has(session.valueLevel);
}

function isExploration(session = {}) {
  return EXPLORATION_PURPOSES.has(session.workPurpose) || EXPLORATION_STAGES.has(session.workStage);
}
