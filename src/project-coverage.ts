const DEFAULTS = {
  taskType: '未分类',
  outputStatus: '未标注',
  workPurpose: '未说明',
  workStage: '未说明',
  valueLevel: '未评估'
};

export function buildProjectCoverage({ sessions = [] } = {}) {
  const projects = new Map();
  const totals = {
    sessionCount: 0,
    totalTokens: 0,
    costUSD: 0,
    recognizedSessionCount: 0,
    unknownSessionCount: 0,
    manualSessionCount: 0,
    autoHighSessionCount: 0,
    autoLowSessionCount: 0,
    missingSessionCount: 0,
    completeSessionCount: 0,
    pendingSessionCount: 0,
    pendingTokens: 0,
    pendingCostUSD: 0
  };

  for (const session of sessions) {
    const tokens = Number(session.totalTokens || 0);
    const cost = Number(session.costUSD || 0);
    const label = projectLabel(session);
    const recognized = label !== '未识别项目';
    const complete = isReviewComplete(session);
    const pending = !complete || session.attributionQuality === 'auto-low' || session.attributionQuality === 'missing';
    totals.sessionCount += 1;
    totals.totalTokens += tokens;
    totals.costUSD += cost;
    if (recognized) totals.recognizedSessionCount += 1; else totals.unknownSessionCount += 1;
    if (isManualLike(session)) totals.manualSessionCount += 1;
    else if (session.attributionQuality === 'auto-high') totals.autoHighSessionCount += 1;
    else if (session.attributionQuality === 'auto-low') totals.autoLowSessionCount += 1;
    else totals.missingSessionCount += 1;
    if (complete) totals.completeSessionCount += 1;
    if (pending) {
      totals.pendingSessionCount += 1;
      totals.pendingTokens += tokens;
      totals.pendingCostUSD += cost;
    }

    if (!projects.has(label)) {
      projects.set(label, {
        project: label,
        recognized,
        sessionCount: 0,
        totalTokens: 0,
        costUSD: 0,
        manualCount: 0,
        autoCount: 0,
        pendingCount: 0,
        publishedOrCompletedCount: 0
      });
    }
    const row = projects.get(label);
    row.sessionCount += 1;
    row.totalTokens += tokens;
    row.costUSD += cost;
    if (isManualLike(session)) row.manualCount += 1;
    if (String(session.annotationSource || '') === 'auto') row.autoCount += 1;
    if (pending) row.pendingCount += 1;
    if (session.outputStatus === '已完成' || session.outputStatus === '已发布') row.publishedOrCompletedCount += 1;
  }

  const projectRows = Array.from(projects.values())
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    ...totals,
    projectCount: projectRows.filter(row => row.recognized).length,
    unknownProjectCount: projectRows.filter(row => !row.recognized).length,
    recognizedShare: totals.sessionCount ? totals.recognizedSessionCount / totals.sessionCount : 0,
    attributionCompletionShare: totals.sessionCount ? totals.completeSessionCount / totals.sessionCount : 0,
    pendingTokenShare: totals.totalTokens ? totals.pendingTokens / totals.totalTokens : 0,
    projectRows: projectRows.slice(0, 8)
  };
}

export function buildReviewWorkflow({ sessions = [], advisorActions = [] } = {}) {
  const coverage = buildProjectCoverage({ sessions });
  const projectRows = coverage.projectRows || [];
  const highCostProject = projectRows[0] || null;
  const publishedOrCompleted = sessions.filter(session =>
    session.outputStatus === '已完成' || session.outputStatus === '已发布'
  );
  const publishedOutputs = sessions.filter(session =>
    session.outputStatus === '已发布' && session.outputUrl
  );
  const openAdvisorActions = advisorActions.filter(action => (action.status || 'open') === 'open');
  return {
    highCostProject: highCostProject ? {
      project: highCostProject.project,
      totalTokens: highCostProject.totalTokens,
      costUSD: highCostProject.costUSD,
      sessionCount: highCostProject.sessionCount
    } : null,
    pendingCostUSD: coverage.pendingCostUSD,
    pendingTokens: coverage.pendingTokens,
    pendingSessionCount: coverage.pendingSessionCount,
    completedOrPublishedCount: publishedOrCompleted.length,
    publishedOutputCount: publishedOutputs.length,
    openAdvisorActionCount: openAdvisorActions.length
  };
}

export function isReviewComplete(session = {}) {
  return Object.entries(DEFAULTS).every(([field, fallback]) => (session[field] || fallback) !== fallback);
}

function isManualLike(session = {}) {
  const source = String(session.annotationSource || '');
  return source === 'manual' || source === 'imported';
}

function projectLabel(session = {}) {
  const alias = clean(session.projectAlias || session.manualProjectAlias || session.ruleProjectAlias);
  if (alias) return alias;
  const path = clean(session.projectPath);
  if (path && path !== 'Unknown Project') return basename(path);
  const fromSession = basename(projectPathFromSessionId(session.sessionId));
  return fromSession || '未识别项目';
}

function projectPathFromSessionId(sessionId) {
  const text = clean(sessionId);
  if (!text.startsWith('local:')) return '';
  const lastColon = text.lastIndexOf(':');
  if (lastColon <= 'local:'.length) return '';
  const withoutModel = text.slice(0, lastColon);
  return withoutModel.replace(/^local:[^:]+:/, '');
}

function basename(value) {
  const text = clean(value);
  if (!text) return '';
  const cleaned = text.replace(/[\\/]+$/, '');
  return cleaned.split(/[\\/]/).filter(Boolean).at(-1) || '';
}

function clean(value) {
  return String(value ?? '').trim();
}
