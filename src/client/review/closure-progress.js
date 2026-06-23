import {
  aggregateSessions,
  missingReviewAttributionFields,
  sessionProjectLabel
} from '../dashboard/attribution.js';

const PRODUCTIVE_STATUSES = new Set(['已完成', '已发布']);
const LABELING_CATEGORY = '补标注';

export function buildReviewClosureProgress({
  sessions = [],
  roiAdvice = [],
  targetAttributedSessions = 10,
  targetOutputLinks = 3,
  targetNonLabelAdvice = 1,
  topGapLimit = 5
} = {}) {
  const attributedSessions = sessions.filter(isClosureAttributedSession)
    .sort(compareCostThenTokens);
  const manualSessions = attributedSessions.filter(isManualConfirmedSession);
  const autoHighSessions = attributedSessions.filter(isAutoHighConfidenceSession);
  const usableAttributionCount = manualSessions.length + autoHighSessions.length;
  const autoTarget = Math.ceil(sessions.length * 0.8);
  const outputSessions = sessions.filter(hasClosureOutputLink)
    .sort(compareCostThenTokens);
  const nonLabelAdvice = roiAdvice.filter(item => (item.category || '') !== LABELING_CATEGORY);
  const topGaps = buildClosureGapRows(sessions).slice(0, Math.max(1, topGapLimit));

  const checks = [
    {
      id: 'real-attribution',
      label: '人工确认归因',
      current: manualSessions.length,
      target: Math.max(1, targetAttributedSessions),
      unit: 'sessions',
      complete: manualSessions.length >= Math.max(1, targetAttributedSessions),
      detail: '需要项目别名、任务类型、产出状态、工作目的、工作阶段和产出价值全部补齐。',
      action: topGaps.length
        ? formatGapAction(topGaps[0])
        : '继续抽查高成本 session 的项目和价值是否真实。'
    },
    {
      id: 'lazy-auto-attribution',
      label: '懒人模式可用覆盖',
      current: usableAttributionCount,
      target: Math.max(1, autoTarget),
      unit: 'sessions',
      complete: manualSessions.length >= Math.max(1, targetAttributedSessions)
        || usableAttributionCount >= Math.max(1, autoTarget),
      detail: '人工确认和自动高置信完整归因都计入可用覆盖；自动归因不是人工事实。',
      action: '在看板使用“一键自动填高置信度”，再抽查最高成本的低置信待确认 session。'
    },
    {
      id: 'output-links',
      label: '产出链接',
      current: outputSessions.length,
      target: Math.max(1, targetOutputLinks),
      unit: 'links',
      complete: outputSessions.length >= Math.max(1, targetOutputLinks),
      detail: '只统计已完成或已发布 session 上保存的 URL；不抓取链接内容。',
      action: '补充产出链接：给已完成或已发布的高价值 session 补 PR、commit、文章、部署、文档或截图 URL。'
    },
    {
      id: 'non-label-advice',
      label: '非补标注 Advisor',
      current: nonLabelAdvice.length,
      target: Math.max(1, targetNonLabelAdvice),
      unit: 'items',
      complete: nonLabelAdvice.length >= Math.max(1, targetNonLabelAdvice),
      detail: '至少出现一条模型切换、上下文压缩、止损、保留策略或未定价模型建议。',
      action: '补齐真实归因后重新查看 ROI Advisor，确认建议不再只停留在“先补标注”。'
    }
  ];

  const completedChecks = checks.filter(check => check.complete).length;
  const remainingChecks = checks.length - completedChecks;
  const aggregate = aggregateSessions(sessions);

  return {
    status: remainingChecks === 0 ? 'complete' : 'needs-work',
    completedChecks,
    totalChecks: checks.length,
    remainingChecks,
    completionShare: checks.length ? completedChecks / checks.length : 0,
    checks,
    annotatedSessions: attributedSessions.slice(0, 10),
    manualSessions: manualSessions.slice(0, 10),
    autoHighSessions: autoHighSessions.slice(0, 10),
    outputSessions: outputSessions.slice(0, 10),
    nonLabelAdvice,
    topGaps,
    totals: {
      sessionCount: sessions.length,
      totalTokens: aggregate.totalTokens,
      costUSD: aggregate.costUSD
    },
    nextActions: checks
      .filter(check => !check.complete)
      .map(check => check.action)
  };
}

export function isClosureAttributedSession(session = {}) {
  return Boolean(String(session.projectAlias || '').trim())
    && missingReviewAttributionFields(session).length === 0;
}

export function isManualConfirmedSession(session = {}) {
  const source = String(session.annotationSource || 'manual');
  return isClosureAttributedSession(session)
    && (source === 'manual' || source === 'imported');
}

export function isAutoHighConfidenceSession(session = {}) {
  return isClosureAttributedSession(session)
    && session.annotationSource === 'auto'
    && Number(session.annotationConfidence || 0) >= 80;
}

export function hasClosureOutputLink(session = {}) {
  const url = String(session.outputUrl || '').trim();
  return PRODUCTIVE_STATUSES.has(session.outputStatus)
    && /^https?:\/\//i.test(url);
}

function buildClosureGapRows(sessions = []) {
  return sessions
    .filter(session => !isClosureAttributedSession(session))
    .map(session => ({
      session,
      device: session.device || '',
      source: session.source || '',
      project: sessionProjectLabel(session),
      projectPath: session.projectPath || '',
      sessionId: session.sessionId || '',
      model: session.model || '',
      lastActivity: session.lastActivity || '',
      missingFields: missingClosureFields(session),
      totalTokens: session.totalTokens || 0,
      costUSD: session.costUSD || 0
    }))
    .sort(compareCostThenTokens);
}

function missingClosureFields(session = {}) {
  const fields = [];
  if (!String(session.projectAlias || '').trim()) fields.push('项目别名');
  fields.push(...missingReviewAttributionFields(session));
  return fields;
}

function formatGapAction(row) {
  const subject = row.sessionId && row.sessionId !== row.project
    ? `${row.project} 的 ${row.sessionId}`
    : row.project || row.sessionId || '最高成本 session';
  const fields = row.missingFields.length ? `，补齐${row.missingFields.join('、')}` : '';
  return `先处理 ${subject}${fields}。`;
}

function compareCostThenTokens(a, b) {
  const left = a.session || a;
  const right = b.session || b;
  return (right.costUSD || 0) - (left.costUSD || 0)
    || (right.totalTokens || 0) - (left.totalTokens || 0);
}
