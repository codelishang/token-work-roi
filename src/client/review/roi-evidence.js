const MISSING_TASK = '未分类';
const MISSING_STATUS = '未标注';
const MISSING_PURPOSE = '未说明';
const MISSING_STAGE = '未说明';
const MISSING_VALUE = '未评估';

export function buildRoiEvidence({ sessions = [], workItems = [] } = {}) {
  const sessionCount = sessions.length;
  const totalTokens = sum(sessions, 'totalTokens');
  const officialCostUSD = sum(sessions, 'costUSD');
  const manualConfirmed = sessions.filter(isManual).length;
  const withOutput = sessions.filter(session => Boolean(session.outputUrl)).length;
  const complete = sessions.filter(isEvidenceComplete).length;
  const incompleteCostUSD = sum(sessions.filter(session => !isEvidenceComplete(session)), 'costUSD');
  const highCostGaps = sessions
    .filter(session => !isEvidenceComplete(session))
    .sort((a, b) => (b.costUSD || b.totalTokens || 0) - (a.costUSD || a.totalTokens || 0))
    .slice(0, 5)
    .map(session => ({
      project: session.projectAlias || session.projectPath || '未归属项目',
      sessionId: session.sessionId,
      totalTokens: session.totalTokens || 0,
      costUSD: session.costUSD || 0,
      missing: missingFields(session)
    }));
  const evidenceScore = sessionCount
    ? Math.round((
      (complete / sessionCount) * 0.45
      + (manualConfirmed / sessionCount) * 0.25
      + (withOutput / sessionCount) * 0.20
      + (workItems.length ? 0.10 : 0)
    ) * 100)
    : 0;

  return {
    evidenceScore,
    sessionCount,
    totalTokens,
    officialCostUSD,
    manualConfirmed,
    autoOrMissing: Math.max(0, sessionCount - manualConfirmed),
    withOutput,
    complete,
    workItemCount: workItems.length,
    incompleteCostUSD,
    highCostGaps
  };
}

function isEvidenceComplete(session = {}) {
  return Boolean(session.projectAlias || session.projectPath)
    && (session.taskType || MISSING_TASK) !== MISSING_TASK
    && (session.outputStatus || MISSING_STATUS) !== MISSING_STATUS
    && (session.workPurpose || MISSING_PURPOSE) !== MISSING_PURPOSE
    && (session.workStage || MISSING_STAGE) !== MISSING_STAGE
    && (session.valueLevel || MISSING_VALUE) !== MISSING_VALUE
    && isManual(session);
}

function isManual(session = {}) {
  return session.annotationSource === 'manual' || session.annotationSource === 'imported';
}

function missingFields(session = {}) {
  const fields = [];
  if (!session.projectAlias && !session.projectPath) fields.push('项目');
  if ((session.taskType || MISSING_TASK) === MISSING_TASK) fields.push('任务');
  if ((session.outputStatus || MISSING_STATUS) === MISSING_STATUS) fields.push('产出状态');
  if ((session.workPurpose || MISSING_PURPOSE) === MISSING_PURPOSE) fields.push('目的');
  if ((session.workStage || MISSING_STAGE) === MISSING_STAGE) fields.push('阶段');
  if ((session.valueLevel || MISSING_VALUE) === MISSING_VALUE) fields.push('价值');
  if (!isManual(session)) fields.push('人工确认');
  return fields;
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + Number(row[field] || 0), 0);
}
