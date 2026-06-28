const DEFAULT_PERIOD = { start: '', end: '' };

export function buildAdvisorActionMeasurements({
  actions = [],
  sessions = [],
  period = DEFAULT_PERIOD
} = {}) {
  const periodSessions = sessions.filter(session => inPeriod(session, period));
  return actions
    .filter(action => ['open', 'done', 'dismissed'].includes(action.status || 'open'))
    .map(action => measureAction(action, periodSessions, period))
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.deltaCostUSD) - Math.abs(a.deltaCostUSD)
      || Math.abs(b.deltaTokens) - Math.abs(a.deltaTokens));
}

function measureAction(action, sessions, period) {
  const anchor = actionDate(action, period);
  const matcher = scopeMatcher(action);
  const scoped = sessions.filter(matcher);
  const before = scoped.filter(session => sessionDate(session) < anchor);
  const after = scoped.filter(session => sessionDate(session) >= anchor);
  const beforeAgg = aggregate(before);
  const afterAgg = aggregate(after);
  return {
    id: String(action.id ?? action.sourceRule ?? action.title ?? ''),
    title: String(action.title || 'Advisor action'),
    status: action.status || 'open',
    scopeLabel: matcher.scopeLabel,
    beforeSessions: beforeAgg.sessionCount,
    afterSessions: afterAgg.sessionCount,
    beforeTokens: beforeAgg.totalTokens,
    afterTokens: afterAgg.totalTokens,
    deltaTokens: afterAgg.totalTokens - beforeAgg.totalTokens,
    beforeCostUSD: beforeAgg.costUSD,
    afterCostUSD: afterAgg.costUSD,
    deltaCostUSD: afterAgg.costUSD - beforeAgg.costUSD,
    caveat: '同类任务/模型趋势对比，不证明真实因果节省。'
  };
}

function actionDate(action = {}, period = DEFAULT_PERIOD) {
  return asDate(action.completedAt || action.createdAt || period.start) || new Date(0);
}

function sessionDate(session = {}) {
  return asDate(session.lastActivity || session.updatedAt || session.lastSeenAt) || new Date(0);
}

function inPeriod(session = {}, period = DEFAULT_PERIOD) {
  const date = sessionDate(session);
  const start = asDate(period.start);
  const end = asDate(period.end);
  if (start && date < start) return false;
  if (end) {
    const inclusiveEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    if (date >= inclusiveEnd) return false;
  }
  return true;
}

function scopeMatcher(action = {}) {
  const text = [
    action.category,
    action.title,
    action.action,
    action.evidence,
    action.sourceRule
  ].join(' ').toLowerCase();

  if (/探索|测试|验证|上下文|调研|explor|test|context|research/u.test(text)) {
    const matcher = session => ['需求澄清', '技术调研', '测试验证', '上下文整理'].includes(session.workPurpose)
      || ['探索', '验证'].includes(session.workStage)
      || ['技术调研', '测试验证'].includes(session.taskType);
    matcher.scopeLabel = '探索 / 验证 / 上下文整理';
    return matcher;
  }

  if (/低价值|废弃|止损|waste|abandon|low value/u.test(text)) {
    const matcher = session => session.outputStatus === '已废弃' || session.valueLevel === '低';
    matcher.scopeLabel = '低价值 / 废弃任务';
    return matcher;
  }

  if (/重模型|heavy|opus|gpt-5\.5/u.test(text)) {
    const matcher = session => modelTierLabel(session) === 'heavy';
    matcher.scopeLabel = '重模型 session';
    return matcher;
  }

  if (/轻量|light|haiku|deepseek|mimo/u.test(text)) {
    const matcher = session => modelTierLabel(session) === 'light';
    matcher.scopeLabel = '轻量模型 session';
    return matcher;
  }

  if (/中模型|mid|sonnet|codex/u.test(text)) {
    const matcher = session => modelTierLabel(session) === 'mid';
    matcher.scopeLabel = '中模型 session';
    return matcher;
  }

  const matcher = () => true;
  matcher.scopeLabel = '本期全部 session';
  return matcher;
}

function modelTierLabel(session = {}) {
  const model = String(session.model || session.pricingModel || '').toLowerCase();
  if (/opus|gpt-5\.5|gemini-2\.5-pro-long-context/.test(model)) return 'heavy';
  if (/sonnet|codex|pro|kimi-k2[.-][67]/.test(model)) return 'mid';
  if (/haiku|flash|deepseek|mimo|kimi-k2[.-]5/.test(model)) return 'light';
  return 'unknown';
}

function aggregate(rows = []) {
  return rows.reduce((acc, row) => {
    acc.sessionCount += 1;
    acc.totalTokens += Number(row.totalTokens || 0);
    acc.costUSD += Number(row.costUSD || 0);
    return acc;
  }, { sessionCount: 0, totalTokens: 0, costUSD: 0 });
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
