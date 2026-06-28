const DEFAULTS = {
  taskType: '未分类',
  outputStatus: '未标注',
  workPurpose: '未说明',
  workStage: '未说明',
  valueLevel: '未评估'
};

export function buildEvidenceFlywheel({
  sessions = [],
  workItems = [],
  advisorActions = [],
  evidencePlan = null,
  coverageBridge = null
} = {}) {
  const totals = aggregateSessions(sessions);
  const realTokenReady = totals.sessionCount > 0;
  const recognizedProjects = sessions.filter(hasRecognizedProject);
  const autoEvidence = sessions.filter(isAutoEvidence);
  const manualEvidence = sessions.filter(isManualEvidence);
  const outputSessions = sessions.filter(hasOutputEvidence);
  const strategySessions = sessions.filter(hasStrategyEvidence);
  const draftCount = Number(evidencePlan?.draftCount || 0);
  const applicableCount = Number(evidencePlan?.canApplyCount || 0);
  const suggestionRows = Array.isArray(evidencePlan?.suggestions) ? evidencePlan.suggestions : [];
  const quality = buildQualitySummary({
    sessions,
    evidencePlan,
    manualEvidence,
    autoEvidence,
    suggestionRows
  });
  const openActions = advisorActions.filter(action => (action.status || 'open') === 'open').length;

  const steps = [
    step('real-token', '已有真实 token', realTokenReady, totals.sessionCount, Math.max(1, totals.sessionCount), '先通过 coverage gate 获取 event 级 Claude/Codex token；demo 数据不计入真实复盘。'),
    step('project', '已识别项目', recognizedProjects.length > 0, recognizedProjects.length, Math.max(1, totals.sessionCount), '通过项目路径、别名规则或人工确认识别项目。'),
    step('auto-evidence', '已生成自动证据', autoEvidence.length > 0 || applicableCount > 0, autoEvidence.length + applicableCount, Math.max(1, totals.sessionCount), '运行 Evidence Autopilot 写入高置信自动证据，不覆盖人工确认。'),
    step('drafts', '待确认草稿', draftCount > 0 || autoEvidence.length > 0, draftCount, Math.max(1, Math.min(10, totals.sessionCount || 1)), '低/中置信建议只展示为草稿，优先确认最高成本的 10 条。'),
    step('outputs', '已确认产出', outputSessions.length > 0, outputSessions.length, Math.max(1, Math.min(3, totals.sessionCount || 1)), '保存 PR、commit、文章、部署、文档或截图 URL；不抓取链接内容。'),
    step('strategy', '可生成模型策略', strategySessions.length > 0, strategySessions.length, Math.max(1, totals.sessionCount), '任务、阶段或价值字段越完整，Savings Simulator 和 Model Strategy 越可用。')
  ];

  const completedSteps = steps.filter(item => item.complete).length;
  const nextAction = firstIncompleteAction(steps);

  return {
    generatedAt: new Date().toISOString(),
    score: Math.round((completedSteps / steps.length) * 100),
    completedSteps,
    totalSteps: steps.length,
    steps,
    totals: {
      ...totals,
      recognizedProjectCount: uniqueProjectCount(recognizedProjects),
      autoEvidenceCount: autoEvidence.length,
      manualEvidenceCount: manualEvidence.length,
      outputEvidenceCount: outputSessions.length,
      strategyEvidenceCount: strategySessions.length,
      workItemCount: workItems.length,
      openAdvisorActionCount: openActions,
      coverageSourcesWithUsage: coverageBridge?.summary?.sourcesWithUsage || 0
    },
    quality,
    queues: {
      highCostGaps: highCostGaps(sessions).slice(0, 10),
      confirmationDrafts: suggestionRows
        .filter(item => !item.canApply && Number(item.confidence || 0) >= 60)
        .sort(compareSuggestionEvidence)
        .slice(0, 10)
        .map(toSuggestionQueueRow),
      blockedEvidence: suggestionRows
        .filter(item => !item.canApply && Number(item.confidence || 0) < 60)
        .sort(compareSuggestionEvidence)
        .slice(0, 10)
        .map(toSuggestionQueueRow),
      outputCandidates: sessions
        .filter(session => !hasOutputEvidence(session) && isProductive(session))
        .sort(compareCostThenTokens)
        .slice(0, 10)
        .map(toQueueRow),
      strategyCandidates: sessions
        .filter(session => !hasStrategyEvidence(session))
        .sort(compareCostThenTokens)
        .slice(0, 10)
        .map(toQueueRow)
    },
    nextAction,
    note: 'Evidence Flywheel is derived from local structured metadata, annotations, output links, and Evidence Autopilot suggestions. It does not read conversation content.'
  };
}

function buildQualitySummary({ sessions, evidencePlan, manualEvidence, autoEvidence, suggestionRows }) {
  const directWriteCount = Number(evidencePlan?.canApplyCount || 0);
  const draftCount = Number(evidencePlan?.draftCount || 0);
  const blockedCount = suggestionRows.filter(item => !item.canApply && Number(item.confidence || 0) < 60).length;
  const missingCount = Math.max(0, sessions.length - manualEvidence.length - autoEvidence.length);
  return {
    directWriteCount,
    draftCount,
    blockedCount,
    manualConfirmedCount: manualEvidence.length,
    autoHighConfidenceCount: autoEvidence.length,
    missingCount,
    rows: [
      {
        id: 'direct-write',
        label: '可直接写入',
        count: directWriteCount,
        tone: 'good',
        detail: '高置信自动证据；写入时仍不会覆盖人工确认。'
      },
      {
        id: 'draft',
        label: '待确认草稿',
        count: draftCount,
        tone: 'warn',
        detail: '中低置信推断，只进队列等待确认，不作为事实。'
      },
      {
        id: 'blocked',
        label: '不可写入',
        count: blockedCount,
        tone: 'risk',
        detail: '缺远程 URL、时间窗口或可靠字段时，只说明原因。'
      },
      {
        id: 'manual',
        label: '人工确认',
        count: manualEvidence.length,
        tone: 'manual',
        detail: '最高可信证据；自动归因永远不覆盖。'
      }
    ]
  };
}

function step(id, label, complete, current, target, action) {
  const safeTarget = Math.max(1, Number(target || 1));
  const safeCurrent = Math.max(0, Number(current || 0));
  return {
    id,
    label,
    complete: Boolean(complete),
    current: safeCurrent,
    target: safeTarget,
    share: Math.min(1, safeCurrent / safeTarget),
    action
  };
}

function aggregateSessions(sessions) {
  return sessions.reduce((acc, session) => {
    acc.sessionCount += 1;
    acc.totalTokens += Number(session.totalTokens || 0);
    acc.costUSD += Number(session.costUSD || 0);
    return acc;
  }, { sessionCount: 0, totalTokens: 0, costUSD: 0 });
}

function hasRecognizedProject(session = {}) {
  return Boolean(clean(session.projectAlias || session.manualProjectAlias || session.ruleProjectAlias || projectTail(session.projectPath)));
}

function isAutoEvidence(session = {}) {
  return session.annotationSource === 'auto' && Number(session.annotationConfidence || 0) >= 80 && isReviewComplete(session);
}

function isManualEvidence(session = {}) {
  const source = String(session.annotationSource || '');
  return (source === 'manual' || source === 'imported') && isReviewComplete(session);
}

function hasOutputEvidence(session = {}) {
  return isProductive(session) && /^https?:\/\//i.test(String(session.outputUrl || '').trim());
}

function hasStrategyEvidence(session = {}) {
  return (session.taskType || DEFAULTS.taskType) !== DEFAULTS.taskType
    || (session.workStage || DEFAULTS.workStage) !== DEFAULTS.workStage
    || (session.valueLevel || DEFAULTS.valueLevel) !== DEFAULTS.valueLevel;
}

function isProductive(session = {}) {
  return session.outputStatus === '已完成' || session.outputStatus === '已发布';
}

function isReviewComplete(session = {}) {
  return Object.entries(DEFAULTS).every(([field, fallback]) => (session[field] || fallback) !== fallback);
}

function highCostGaps(sessions) {
  return sessions
    .filter(session => !isReviewComplete(session) || !hasOutputEvidence(session))
    .sort(compareCostThenTokens)
    .map(session => ({
      ...toQueueRow(session),
      missing: missingFields(session)
    }));
}

function toQueueRow(session = {}) {
  return {
    project: safeProject(session),
    source: session.source || '',
    model: session.model || session.pricingModel || '',
    sessionId: safeSession(session.sessionId),
    totalTokens: Number(session.totalTokens || 0),
    costUSD: Number(session.costUSD || 0),
    lastActivity: session.lastActivity || null,
    attributionSource: session.annotationSource || 'missing',
    attributionConfidence: Number(session.annotationConfidence || 0)
  };
}

function toSuggestionQueueRow(item = {}) {
  return {
    suggestionId: clean(item.suggestionId),
    kind: clean(item.kind),
    category: clean(item.category),
    provenance: clean(item.provenance),
    title: safeText(item.title || item.category || '证据建议'),
    project: safeText(item.project || '未识别项目'),
    source: clean(item.source),
    model: clean(item.model),
    sessionId: safeSession(item.sessionId),
    totalTokens: Number(item.totalTokens || 0),
    costUSD: Number(item.costUSD || 0),
    confidence: Number(item.confidence || 0),
    canApply: Boolean(item.canApply),
    reason: safeText(item.reason || item.action || '缺少可写入证据。'),
    fields: Array.isArray(item.fields) ? item.fields.map(clean).filter(Boolean) : []
  };
}

function missingFields(session = {}) {
  const fields = [];
  if (!clean(session.projectAlias)) fields.push('项目');
  if ((session.taskType || DEFAULTS.taskType) === DEFAULTS.taskType) fields.push('任务');
  if ((session.outputStatus || DEFAULTS.outputStatus) === DEFAULTS.outputStatus) fields.push('产出状态');
  if ((session.workPurpose || DEFAULTS.workPurpose) === DEFAULTS.workPurpose) fields.push('目的');
  if ((session.workStage || DEFAULTS.workStage) === DEFAULTS.workStage) fields.push('阶段');
  if ((session.valueLevel || DEFAULTS.valueLevel) === DEFAULTS.valueLevel) fields.push('价值');
  if (isProductive(session) && !hasOutputEvidence(session)) fields.push('产出链接');
  return fields;
}

function firstIncompleteAction(steps) {
  return steps.find(step => !step.complete)?.action || '证据闭环已基本可用，下一步是抽查最高成本自动证据。';
}

function uniqueProjectCount(sessions) {
  return new Set(sessions.map(safeProject).filter(Boolean)).size;
}

function compareCostThenTokens(a, b) {
  return Number(b.costUSD || 0) - Number(a.costUSD || 0)
    || Number(b.totalTokens || 0) - Number(a.totalTokens || 0);
}

function compareSuggestionEvidence(a, b) {
  return Number(b.costUSD || 0) - Number(a.costUSD || 0)
    || Number(b.totalTokens || 0) - Number(a.totalTokens || 0)
    || Number(b.confidence || 0) - Number(a.confidence || 0);
}

function safeProject(session = {}) {
  return clean(session.projectAlias || session.manualProjectAlias || session.ruleProjectAlias)
    || projectTail(session.projectPath)
    || projectTail(projectPathFromSessionId(session.sessionId))
    || '未识别项目';
}

function safeSession(value) {
  const text = clean(value);
  if (!text) return '';
  if (text.startsWith('local:')) {
    const model = text.split(':').at(-1) || '';
    const project = projectTail(projectPathFromSessionId(text));
    return [project, model].filter(Boolean).join(' · ');
  }
  if (text.includes('\\') || text.includes('/')) return projectTail(text);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function projectPathFromSessionId(sessionId) {
  const text = clean(sessionId);
  if (!text.startsWith('local:')) return '';
  const lastColon = text.lastIndexOf(':');
  if (lastColon <= 'local:'.length) return '';
  return text.slice(0, lastColon).replace(/^local:[^:]+:/, '');
}

function projectTail(value) {
  const text = clean(value);
  if (!text || text === 'Unknown Project') return '';
  return text.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean).at(-1) || '';
}

function clean(value) {
  return String(value ?? '').trim();
}

function safeText(value) {
  const text = clean(value)
    .replace(/[A-Za-z]:[\\/][^\s，。；;]+/gu, '[local-path]')
    .replace(/\/(?:Users|home|mnt|private|var)\/[^\s，。；;]+/gu, '[local-path]');
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}
