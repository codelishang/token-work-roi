const PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s，。；;|]+|\/(?:Users|home|mnt|private|var)\/[^\s，。；;|]+)/gu;

export function buildLocalTrust({
  runtime = null,
  coverageBridge = null,
  sourceHealth = [],
  daily = [],
  sessions = [],
  tokenEvents = [],
  tokenEventTotals = null,
  runs = [],
  evidenceFlywheel = null
} = {}) {
  const dataMode = runtime?.dataMode || { id: 'unknown', label: 'Unknown', message: '当前 API 未返回数据模式。' };
  const coverageGate = runtime?.coverageGate || { status: 'not-run' };
  const counts = runtime?.counts || databaseCountsFromRows({ daily, sessions, tokenEvents, runs });
  const reconciliation = buildReconciliation({ daily, sessions, tokenEvents: tokenEventTotals || tokenEvents });
  const sources = buildTrustSources({ coverageBridge, sourceHealth });
  const conclusion = buildTrustConclusion({ dataMode, coverageGate, counts, reconciliation });
  const evidence = buildCoverageToEvidenceSummary({ coverageBridge, evidenceFlywheel, sessions });
  const samples = buildSampleRows({ tokenEvents, sessions });

  return {
    generatedAt: new Date().toISOString(),
    conclusion,
    security: buildSecuritySummary(runtime?.server || {}),
    dataMode: {
      id: dataMode.id || 'unknown',
      label: dataMode.label || 'Unknown',
      message: sanitizeText(dataMode.message || '')
    },
    runtime: {
      packageVersion: runtime?.packageVersion || 'unknown',
      dbKind: runtime?.db?.kind || 'unknown sqlite',
      dbFileName: sanitizeFileName(runtime?.db?.fileName || ''),
      latestCollectionRun: sanitizeRun(runtime?.latestCollectionRun || null),
      coverageGate: sanitizeCoverageGate(coverageGate)
    },
    counts: {
      dailyRows: Number(counts.dailyRows || 0),
      sessionRows: Number(counts.sessionRows || 0),
      tokenEventRows: Number(counts.tokenEventRows || 0),
      collectionRuns: Number(counts.collectionRuns || 0)
    },
    reconciliation,
    sources,
    evidence,
    samples,
    privacy: {
      returnsFullPath: false,
      returnsConversationContent: false,
      note: 'Local Trust 只返回结构化 token/session 元数据和脱敏标签，不返回 prompt、response、transcript、diff 或完整本机路径。'
    }
  };
}

export function buildLocalTrustSamples({ tokenEvents = [], sessions = [], source = null, limit = 20 } = {}) {
  return buildSampleRows({
    tokenEvents: source
      ? tokenEvents.filter(row => sameSource(row.source, source))
      : tokenEvents,
    sessions: source
      ? sessions.filter(row => sameSource(row.source, source))
      : sessions,
    limit
  });
}

export function sanitizeSessionLabel(value) {
  const raw = String(value ?? '').trim();
  const text = sanitizeText(value);
  if (!text) return '';
  if (raw.startsWith('local:')) {
    const model = raw.split(':').at(-1) || '';
    const project = projectTail(projectPathFromSessionId(raw));
    return [project, model].filter(Boolean).join(' · ') || 'local session';
  }
  if (raw.includes('\\') || raw.includes('/')) return projectTail(raw) || '[local-session]';
  return truncate(text, 96);
}

function buildTrustConclusion({ dataMode, coverageGate, counts, reconciliation }) {
  if (dataMode.id === 'demo') {
    return {
      level: 'demo',
      title: 'Demo 数据',
      decision: '只能看产品流程，不能代表真实采集成功。',
      canUseForRoiReview: false,
      action: '运行真实模式或导入 ccusage JSON 后再复盘。'
    };
  }
  if (dataMode.id === 'empty') {
    return {
      level: 'empty',
      title: '空库',
      decision: '当前没有可复盘的 token 数据。',
      canUseForRoiReview: false,
      action: '先运行 coverage / collect，或从 ccusage JSON 导入结构化用量。'
    };
  }
  if (coverageGate.status === 'failed') {
    return {
      level: 'needs-coverage',
      title: 'Coverage 未通过',
      decision: '不能强判断历史完整性，只能先排查来源失败原因。',
      canUseForRoiReview: false,
      action: '查看失败来源，重新运行只读 coverage。'
    };
  }
  if (dataMode.id === 'real-event-verified' && reconciliation.status !== 'risk') {
    return {
      level: 'trusted',
      title: '可用于 ROI 复盘',
      decision: '当前真实 SQLite 有 event 级 token，并且 daily/session/event 总量可校验。',
      canUseForRoiReview: true,
      action: '进入 Evidence Flywheel，把最高成本 session 转成项目、产出和模型策略证据。'
    };
  }
  if (dataMode.id === 'real-event-unverified') {
    return {
      level: 'needs-coverage',
      title: '有 event 数据但还没验收',
      decision: '可以看趋势，但做强 ROI 判断前需要重新 coverage。',
      canUseForRoiReview: false,
      action: '运行只读 coverage，确认来源和总量一致。'
    };
  }
  if (dataMode.id === 'real-aggregate-only' || Number(counts.tokenEventRows || 0) === 0) {
    return {
      level: 'trend-only',
      title: '只能看聚合趋势',
      decision: '当前只有 daily/session 聚合行，不足以证明历史 event 级采集完整。',
      canUseForRoiReview: false,
      action: '先补 event 级采集或导入结构化 JSON。'
    };
  }
  return {
    level: reconciliation.status === 'risk' ? 'needs-coverage' : 'trend-only',
    title: reconciliation.status === 'risk' ? '总量不一致' : '需要确认',
    decision: reconciliation.status === 'risk'
      ? 'daily/session/event 总量差异过大，不建议强复盘。'
      : '当前数据状态需要先确认 coverage 和来源。',
    canUseForRoiReview: false,
    action: '查看 Local Trust 来源和 sample rows，排查差异。'
  };
}

function buildReconciliation({ daily = [], sessions = [], tokenEvents = [] }) {
  const dailyTotalTokens = sumTokens(daily, row => row.totalTokens);
  const sessionTotalTokens = sumTokens(sessions, row => row.totalTokens);
  const eventTotalTokens = sumTokens(tokenEvents, eventTokens);
  const dailySessionDiffRatio = diffRatio(dailyTotalTokens, sessionTotalTokens);
  const sessionEventDiffRatio = eventTotalTokens > 0 ? diffRatio(sessionTotalTokens, eventTotalTokens) : null;
  const maxDiffRatio = Math.max(dailySessionDiffRatio, sessionEventDiffRatio ?? 0);
  const status = eventTotalTokens <= 0
    ? 'not-applicable'
    : maxDiffRatio <= 0.01
      ? 'ok'
      : maxDiffRatio <= 0.05 ? 'warn' : 'risk';
  return {
    status,
    statusLabel: ({
      ok: '总量一致',
      warn: '轻微差异',
      risk: '差异过大',
      'not-applicable': '缺少 event 级数据'
    })[status],
    dailyTotalTokens,
    sessionTotalTokens,
    eventTotalTokens,
    dailySessionDiffRatio,
    sessionEventDiffRatio,
    maxDiffRatio,
    note: status === 'risk'
      ? 'daily/session/event token 合计差异超过 5%，建议重新 coverage 或检查导入来源。'
      : status === 'not-applicable'
        ? '当前没有 token_events，只能看聚合趋势。'
        : 'daily/session/event token 合计在可接受误差内。'
  };
}

function buildTrustSources({ coverageBridge, sourceHealth = [] }) {
  const bridgeRows = Array.isArray(coverageBridge?.rows) ? coverageBridge.rows : [];
  const healthById = new Map(sourceHealth.map(row => [row.id, row]));
  return bridgeRows.map(row => {
    const health = healthById.get(row.id) || {};
    const reason = sourceReason(row, health);
    return {
      id: row.id,
      label: sanitizeText(row.label || row.id),
      status: row.status,
      statusLabel: row.statusLabel || trustStatusLabel(row.status),
      conclusion: sourceConclusion(row),
      reason,
      detected: Boolean(row.detected),
      successfulCoverage: Boolean(row.successfulCoverage),
      sessions: Number(row.sessions || 0),
      tokenEvents: Number(row.tokenEvents || 0),
      dailyRows: Number(row.dailyRows || 0),
      totalTokens: Number(row.totalTokens || 0),
      lastSeenAt: row.lastSeenAt || null,
      tokenReliability: row.tokenReliability || 'unknown',
      recommendedAction: sanitizeText(row.recommendedAction || ''),
      privacy: row.privacy || (health.readsConversationContent ? '需要审计内容风险' : '不读取正文')
    };
  });
}

function buildCoverageToEvidenceSummary({ coverageBridge, evidenceFlywheel, sessions = [] }) {
  const quality = evidenceFlywheel?.quality || {};
  const trustedSourceIds = new Set((Array.isArray(coverageBridge?.rows) ? coverageBridge.rows : [])
    .filter(row => row.successfulCoverage)
    .flatMap(row => [normalize(row.id), normalize(row.label)]));
  const trustedSessions = sessions.filter(session =>
    trustedSourceIds.has(normalize(session.source))
    || Array.from(trustedSourceIds).some(source => source && normalize(session.source).includes(source))
  );
  const trustedTokenTotal = sumTokens(trustedSessions, row => row.totalTokens);
  const allTokenTotal = sumTokens(sessions, row => row.totalTokens);
  return {
    coverageSourcesWithUsage: Number(coverageBridge?.summary?.sourcesWithUsage || 0),
    successfulCoverageSources: Number(coverageBridge?.summary?.successfulCoverage || 0),
    trustedSessionCount: trustedSessions.length,
    trustedTokenTotal,
    untrustedSessionCount: Math.max(0, sessions.length - trustedSessions.length),
    untrustedTokenTotal: Math.max(0, allTokenTotal - trustedTokenTotal),
    recognizedProjectCount: Number(evidenceFlywheel?.totals?.recognizedProjectCount || uniqueProjects(sessions)),
    directWriteCount: Number(quality.directWriteCount || 0),
    draftCount: Number(quality.draftCount || 0),
    blockedCount: Number(quality.blockedCount || 0),
    manualConfirmedCount: Number(quality.manualConfirmedCount || 0),
    autoHighConfidenceCount: Number(quality.autoHighConfidenceCount || 0),
    nextAction: sanitizeText(evidenceFlywheel?.nextAction || '先确认最高成本证据缺口。'),
    conclusion: trustedSessions.length
      ? `已有 ${trustedSessions.length} 个可信来源 session 可进入证据飞轮。`
      : '当前还没有来自可信覆盖来源的 session，先运行 coverage 或导入结构化 JSON。'
  };
}

function buildSecuritySummary(server = {}) {
  const loopbackBind = Boolean(server.loopbackBind);
  const remoteIngestMode = Boolean(server.remoteIngestMode);
  const dashboardApiRemoteAccess = Boolean(server.dashboardApiRemoteAccess);
  const level = loopbackBind
    ? 'local-only'
    : remoteIngestMode ? 'remote-ingest' : 'unknown';
  return {
    level,
    title: loopbackBind
      ? 'API 只绑定本机'
      : remoteIngestMode ? '远程 ingest 模式已开启' : '绑定状态待确认',
    decision: loopbackBind
      ? '普通 Dashboard API 只接受本机 socket 和本机 Origin。'
      : remoteIngestMode
        ? '服务允许非 loopback 绑定，但普通 Dashboard API 仍保持本机读写保护。'
        : '当前 API 没有返回可确认的本机绑定状态。',
    bindHost: sanitizeText(server.bindHost || ''),
    readGuard: sanitizeText(server.readGuard || 'loopback + local Origin'),
    writeGuard: sanitizeText(server.writeGuard || 'loopback + local Origin + JSON'),
    remoteIngestMode,
    ingestTokenConfigured: Boolean(server.ingestTokenConfigured),
    dashboardApiRemoteAccess,
    xForwardedForTrusted: Boolean(server.xForwardedForTrusted),
    action: remoteIngestMode
      ? '确认只把 ingest 暴露给可信网络；Dashboard 仍应从本机浏览器打开。'
      : '保持默认本机启动即可；不要用 HOST=0.0.0.0 运行普通看板。'
  };
}

function buildSampleRows({ tokenEvents = [], sessions = [], limit = 8 } = {}) {
  const sessionByKey = new Map(sessions.map(session => [
    sourceSessionKey(session.source, session.sessionId),
    session
  ]));
  return tokenEvents.slice(0, Math.max(1, Math.min(50, Number(limit) || 8))).map(event => {
    const session = sessionByKey.get(sourceSessionKey(event.source, event.sessionId)) || {};
    return {
      source: sanitizeText(event.source || session.source || ''),
      model: sanitizeText(event.model || session.model || session.pricingModel || ''),
      session: sanitizeSessionLabel(event.sessionId || session.sessionId || ''),
      timestamp: sanitizeText(event.timestamp || session.lastActivity || ''),
      totalTokens: eventTokens(event),
      tokenParts: {
        input: Number(event.inputTokens || 0),
        output: Number(event.outputTokens || 0),
        cacheRead: Number(event.cacheReadTokens || 0),
        cacheCreation: Number(event.cacheCreationTokens || 0),
        reasoning: Number(event.reasoningTokens || event.reasoningOutputTokens || 0)
      },
      privacyLevel: sanitizeText(event.privacyLevel || 'metadata-only')
    };
  });
}

function sourceReason(row, health) {
  if (row.successfulCoverage) return '已写入结构化 token，可进入 Evidence Flywheel 做复盘。';
  if (row.status === 'native-trusted') return '原生采集器可信，但当前库还没有该来源的用量；先运行 dry-run 检查候选文件。';
  if (row.status === 'ccusage-importable') return '尚未导入 ccusage 结构化 JSON；导入后 Token Work 会重算官方价。';
  if (row.status === 'detected-only') return '检测到工具痕迹，但没有可靠 token 字段；不算采集成功。';
  if (health.health === 'last-run-error') return sanitizeText(health.lastRunMessage || '上次采集或导入失败。');
  return '当前不支持，或上游没有稳定 token 字段。';
}

function sourceConclusion(row) {
  if (row.successfulCoverage) return '可用于 ROI 复盘';
  if (row.status === 'ccusage-importable') return '可导入后复盘';
  if (row.status === 'detected-only') return '只检测到，不算覆盖';
  if (row.status === 'native-trusted') return '可采集，当前无数据';
  return '不可作为 token 覆盖';
}

function trustStatusLabel(status) {
  return ({
    'native-trusted': '原生可信采集',
    'ccusage-importable': 'ccusage 可导入',
    'detected-only': '仅检测到',
    unsupported: '不支持 / 无 token 字段'
  })[status] || '未知状态';
}

function databaseCountsFromRows({ daily = [], sessions = [], tokenEvents = [], runs = [] }) {
  return {
    dailyRows: daily.length,
    sessionRows: sessions.length,
    tokenEventRows: tokenEvents.length,
    collectionRuns: runs.length
  };
}

function sanitizeCoverageGate(gate = {}) {
  return {
    status: gate.status || 'not-run',
    checkedAt: gate.checkedAt || null,
    trustedSourceCount: Number(gate.trustedSourceCount || 0),
    eventSourceCount: Number(gate.eventSourceCount || 0),
    totalTokenEvents: Number(gate.totalTokenEvents || 0),
    firstTimestamp: gate.firstTimestamp || null,
    lastTimestamp: gate.lastTimestamp || null,
    message: sanitizeText(gate.message || '')
  };
}

function sanitizeRun(row) {
  if (!row) return null;
  return {
    source: sanitizeText(row.source || ''),
    status: sanitizeText(row.status || ''),
    message: sanitizeText(row.message || ''),
    collectedAt: row.collectedAt || null
  };
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(PATH_PATTERN, '[local-path]')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function sanitizeFileName(value) {
  return String(value || '').replace(/[\\/]/g, '').slice(0, 120);
}

function sameSource(left, right) {
  return normalize(left).includes(normalize(right)) || normalize(right).includes(normalize(left));
}

function sourceSessionKey(source, sessionId) {
  return `${normalize(source)}::${String(sessionId || '')}`;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function sumTokens(rows, selector) {
  return rows.reduce((sum, row) => sum + Number(selector(row) || 0), 0);
}

function eventTokens(row = {}) {
  return Number(row.inputTokens || 0)
    + Number(row.outputTokens || 0)
    + Number(row.cacheReadTokens || 0)
    + Number(row.cacheCreationTokens || 0)
    + Number(row.reasoningTokens || row.reasoningOutputTokens || 0);
}

function diffRatio(a, b) {
  const left = Number(a || 0);
  const right = Number(b || 0);
  const base = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / base;
}

function uniqueProjects(sessions) {
  return new Set(sessions.map(session => (
    session.projectAlias || session.manualProjectAlias || session.ruleProjectAlias || projectTail(session.projectPath)
  )).filter(Boolean)).size;
}

function projectPathFromSessionId(sessionId) {
  const text = String(sessionId || '').trim();
  if (!text.startsWith('local:')) return '';
  const lastColon = text.lastIndexOf(':');
  if (lastColon <= 'local:'.length) return '';
  return text.slice(0, lastColon).replace(/^local:[^:]+:/, '');
}

function projectTail(value) {
  const text = String(value || '').trim();
  if (!text || text === 'Unknown Project') return '';
  return text.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean).at(-1) || '';
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}
