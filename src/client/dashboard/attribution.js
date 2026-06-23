import { U } from '../shared/utils.js';

const DEFAULT_TASK_TYPE = '未分类';
const DEFAULT_OUTPUT_STATUS = '未标注';
const DEFAULT_WORK_PURPOSE = '未说明';
const DEFAULT_WORK_STAGE = '未说明';
const DEFAULT_VALUE_LEVEL = '未评估';
const STATUS_IN_PROGRESS = '进行中';
const STATUS_COMPLETED = '已完成';
const STATUS_PUBLISHED = '已发布';
const STATUS_DISCARDED = '已废弃';

export const ATTRIBUTION_STATUS_ROWS = [
  { id: 'published', label: '已发布', outputStatus: '已发布', tone: 'published' },
  { id: 'completed', label: '已完成', outputStatus: '已完成', tone: 'completed' },
  { id: 'inProgress', label: '进行中', outputStatus: '进行中', tone: 'progress' },
  { id: 'discarded', label: '已废弃', outputStatus: '已废弃', tone: 'discarded' },
  { id: 'unattributed', label: '未归因', tone: 'unattributed' }
];

export function isUnattributedSession(session = {}) {
  return (session.taskType || DEFAULT_TASK_TYPE) === DEFAULT_TASK_TYPE
    || (session.outputStatus || DEFAULT_OUTPUT_STATUS) === DEFAULT_OUTPUT_STATUS;
}

export function isReviewUnattributedSession(session = {}) {
  return isUnattributedSession(session)
    || (session.workPurpose || DEFAULT_WORK_PURPOSE) === DEFAULT_WORK_PURPOSE
    || (session.workStage || DEFAULT_WORK_STAGE) === DEFAULT_WORK_STAGE
    || (session.valueLevel || DEFAULT_VALUE_LEVEL) === DEFAULT_VALUE_LEVEL;
}

export function buildUnattributedSessions(sessions = []) {
  return sessions
    .filter(isUnattributedSession)
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
}

export function buildReviewUnattributedSessions(sessions = []) {
  return sessions
    .filter(isReviewUnattributedSession)
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
}

export function buildPendingConfirmationSessions(sessions = []) {
  return sessions
    .filter(session =>
      isReviewUnattributedSession(session)
      || session.attributionQuality === 'auto-low'
      || Boolean(session.autoSuggestion && !session.autoSuggestion.canApply)
    )
    .sort((a, b) => (b.costUSD || 0) - (a.costUSD || 0)
      || (b.totalTokens || 0) - (a.totalTokens || 0));
}

export function buildReviewAttributionProgress(sessions = []) {
  const total = aggregateSessions(sessions);
  const unattributed = buildReviewUnattributedSessions(sessions);
  const unattributedTotal = aggregateSessions(unattributed);
  return {
    sessionCount: total.sessionCount,
    attributedSessionCount: total.sessionCount - unattributedTotal.sessionCount,
    unattributedSessionCount: unattributedTotal.sessionCount,
    totalTokens: total.totalTokens,
    attributedTokens: Math.max(0, total.totalTokens - unattributedTotal.totalTokens),
    unattributedTokens: unattributedTotal.totalTokens,
    costUSD: total.costUSD,
    unattributedCostUSD: unattributedTotal.costUSD,
    completionShare: total.sessionCount ? (total.sessionCount - unattributedTotal.sessionCount) / total.sessionCount : 0,
    tokenCompletionShare: total.totalTokens ? (total.totalTokens - unattributedTotal.totalTokens) / total.totalTokens : 0
  };
}

export function buildReviewAttributionChecklist(sessions = [], { limit = 10, generatedAt = new Date() } = {}) {
  const rows = buildReviewUnattributedSessions(sessions).slice(0, Math.max(1, limit));
  const lines = [
    '# Token Work 归因工作清单',
    '',
    `- 生成时间：${formatDateTime(generatedAt)}`,
    '- 口径：仅使用本地结构化用量和现有标注，不包含对话正文。',
    '- 用法：按优先级打开对应 session，人工核对项目、任务、目的、阶段、价值和产出状态后再保存。',
    ''
  ];

  if (!rows.length) {
    return [
      ...lines,
      '当前筛选没有待补齐归因的 session。'
    ].join('\n');
  }

  return [
    ...lines,
    markdownTable(
      ['优先级', '项目', 'Session', '缺失字段', 'Tokens', '官方价', '模型', '来源', '最后活动'],
      rows.map((session, index) => [
        index + 1,
        sessionProjectLabel(session),
        session.sessionId || '',
        missingReviewAttributionFields(session).join('、'),
        formatInt(session.totalTokens || 0),
        session.costUSD > 0 ? money(session.costUSD) : '未定价/无官方价',
        session.model || session.pricingModel || '',
        session.source || '',
        session.lastActivity || ''
      ])
    )
  ].join('\n');
}

export function missingReviewAttributionFields(session = {}) {
  const fields = [];
  if ((session.taskType || DEFAULT_TASK_TYPE) === DEFAULT_TASK_TYPE) fields.push('任务类型');
  if ((session.outputStatus || DEFAULT_OUTPUT_STATUS) === DEFAULT_OUTPUT_STATUS) fields.push('产出状态');
  if ((session.workPurpose || DEFAULT_WORK_PURPOSE) === DEFAULT_WORK_PURPOSE) fields.push('工作目的');
  if ((session.workStage || DEFAULT_WORK_STAGE) === DEFAULT_WORK_STAGE) fields.push('工作阶段');
  if ((session.valueLevel || DEFAULT_VALUE_LEVEL) === DEFAULT_VALUE_LEVEL) fields.push('产出价值');
  return fields;
}

export function buildAttributionStatusSummary(sessions = []) {
  const total = aggregateSessions(sessions);
  return ATTRIBUTION_STATUS_ROWS.map(row => {
    const matching = row.id === 'unattributed'
      ? sessions.filter(isUnattributedSession)
      : sessions.filter(session => (session.outputStatus || DEFAULT_OUTPUT_STATUS) === row.outputStatus);
    const aggregate = aggregateSessions(matching);
    return {
      ...row,
      ...aggregate,
      share: total.totalTokens ? aggregate.totalTokens / total.totalTokens : 0
    };
  });
}

export function buildRiskDistribution(sessions = []) {
  const total = aggregateSessions(sessions);
  const groups = [
    { id: 'unattributed', label: '未归因', tone: 'unattributed', sessions: sessions.filter(isUnattributedSession) },
    { id: 'inProgress', label: '进行中', tone: 'progress', sessions: sessions.filter(session => session.outputStatus === STATUS_IN_PROGRESS) },
    { id: 'discarded', label: '已废弃', tone: 'discarded', sessions: sessions.filter(session => session.outputStatus === STATUS_DISCARDED) }
  ];
  return groups.map(row => {
    const aggregate = aggregateSessions(row.sessions);
    return {
      id: row.id,
      label: row.label,
      tone: row.tone,
      ...aggregate,
      share: total.totalTokens ? aggregate.totalTokens / total.totalTokens : 0
    };
  });
}

export function buildProjectRoiRows(sessions = []) {
  const rows = new Map();
  for (const session of sessions) {
    const project = sessionProjectLabel(session);
    if (!rows.has(project)) {
      rows.set(project, {
        project,
        sessionCount: 0,
        totalTokens: 0,
        costUSD: 0,
        publishedTokens: 0,
        publishedCostUSD: 0,
        completedTokens: 0,
        completedCostUSD: 0,
        inProgressTokens: 0,
        inProgressCostUSD: 0,
        discardedTokens: 0,
        discardedCostUSD: 0,
        unattributedTokens: 0,
        unattributedCostUSD: 0,
        publishedCount: 0,
        completedCount: 0,
        inProgressCount: 0,
        discardedCount: 0,
        unattributedCount: 0
      });
    }
    const row = rows.get(project);
    const tokens = session.totalTokens || 0;
    const cost = session.costUSD || 0;
    row.sessionCount += 1;
    row.totalTokens += tokens;
    row.costUSD += cost;

    if (session.outputStatus === STATUS_PUBLISHED) {
      row.publishedTokens += tokens;
      row.publishedCostUSD += cost;
      row.publishedCount += 1;
    }
    if (session.outputStatus === STATUS_COMPLETED) {
      row.completedTokens += tokens;
      row.completedCostUSD += cost;
      row.completedCount += 1;
    }
    if (session.outputStatus === STATUS_IN_PROGRESS) {
      row.inProgressTokens += tokens;
      row.inProgressCostUSD += cost;
      row.inProgressCount += 1;
    }
    if (session.outputStatus === STATUS_DISCARDED) {
      row.discardedTokens += tokens;
      row.discardedCostUSD += cost;
      row.discardedCount += 1;
    }
    if (isUnattributedSession(session)) {
      row.unattributedTokens += tokens;
      row.unattributedCostUSD += cost;
      row.unattributedCount += 1;
    }
  }

  return Array.from(rows.values())
    .map(row => ({
      ...row,
      productiveTokens: row.publishedTokens + row.completedTokens,
      productiveCostUSD: row.publishedCostUSD + row.completedCostUSD,
      productiveShare: row.totalTokens ? (row.publishedTokens + row.completedTokens) / row.totalTokens : 0,
      riskShare: row.totalTokens ? (row.discardedTokens + row.unattributedTokens) / row.totalTokens : 0
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export function buildWeeklyReview(sessions = [], { today = null, days = 7 } = {}) {
  const now = parseDate(today) || new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(1, days) + 1);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const weeklySessions = sessions.filter(session => {
    const date = parseDate(session.lastActivity);
    return date && date >= start && date <= end;
  });
  const projectRows = buildProjectRoiRows(weeklySessions);
  const discardedSessions = weeklySessions.filter(session => session.outputStatus === STATUS_DISCARDED);
  const publishedOutputs = weeklySessions
    .filter(session => session.outputStatus === STATUS_PUBLISHED && session.outputUrl)
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    totals: aggregateSessions(weeklySessions),
    highCostProjects: projectRows.slice(0, 5),
    discarded: aggregateSessions(discardedSessions),
    unattributedQueue: buildUnattributedSessions(weeklySessions).slice(0, 8),
    publishedOutputs: publishedOutputs.slice(0, 8)
  };
}

export function aggregateSessions(sessions = []) {
  return sessions.reduce((acc, session) => {
    acc.sessionCount += 1;
    acc.totalTokens += session.totalTokens || 0;
    acc.inputTokens += session.inputTokens || 0;
    acc.outputTokens += session.outputTokens || 0;
    acc.costUSD += session.costUSD || 0;
    return acc;
  }, {
    sessionCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0
  });
}

export function sessionProjectLabel(session = {}) {
  if (session.projectAlias) return session.projectAlias;
  if (session.projectPath && session.projectPath !== 'Unknown Project') return session.projectPath;
  if (session.sessionId) return session.sessionId.split('/').slice(-1)[0] || session.sessionId;
  return '未归档项目';
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-');
}

function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(markdownCell).join(' | ')} |`)
  ].join('\n');
}

function markdownCell(value) {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const formulaSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return formulaSafe.replace(/\|/g, '\\|');
}

function formatInt(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(Number(value || 0)));
}

function money(value) {
  return U.money(Number(value || 0));
}
