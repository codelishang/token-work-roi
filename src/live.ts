import { calculateOfficialCost, resolveOfficialPricing } from './pricing.ts';
import { providerFromSource } from './provider.ts';

const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_TOKEN_BUDGET_PER_HOUR = 50_000;
const DEFAULT_MIN_CACHE_HIT_RATE = 10;
const DEFAULT_MIN_OUTPUT_INPUT_RATIO = 0.15;
const DEFAULT_HIGH_INPUT_TOKENS = 10_000;

type InputRecord = Record<string, unknown>;

interface LiveSnapshotInput {
  totals?: InputRecord;
  byModel?: InputRecord[];
  budgetWindows?: InputRecord[];
  activeSessions?: InputRecord[];
  adviceContext?: {
    topSession?: InputRecord | null;
    sessionCount?: number;
  };
}

interface GuardrailOverrides {
  tokenBudgetPerHour?: unknown;
  minCacheHitRate?: unknown;
  minOutputInputRatio?: unknown;
  highInputTokens?: unknown;
}

export function buildLiveSnapshot({
  sessions = [],
  tokenEvents = [],
  runs = [],
  budgetProfiles = [],
  now = new Date(),
  windowMinutes = DEFAULT_WINDOW_MINUTES,
  guardrailConfig = liveGuardrailConfig(),
  latestEventAt = null,
  latestCollectionRunAt = null,
  collectionState = null,
  refreshIntervalSeconds = 60,
  autoCollectEnabled = false,
  demoMode = false
} = {}) {
  const nowMs = new Date(now).getTime();
  const windowMs = Math.max(1, Number(windowMinutes) || DEFAULT_WINDOW_MINUTES) * 60 * 1000;
  const sinceMs = nowMs - windowMs;
  const normalizedEvents = tokenEvents.map(normalizeEvent);
  const normalizedSessions = sessions.map(normalizeSession);
  const recentEvents = normalizedEvents
    .filter(event => event.timestampMs >= sinceMs && event.timestampMs <= nowMs);
  const recentSessions = normalizedSessions
    .filter(session => session.lastActivityMs >= sinceMs && session.lastActivityMs <= nowMs);

  const metricRows = recentEvents.length ? recentEvents : recentSessions;
  const sourceRows = aggregate(metricRows, 'source');
  const modelRows = aggregate(metricRows, 'model');
  const activeSessions = recentSessions
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
    .slice(0, 12)
    .map(session => ({
      device: session.device,
      source: session.source,
      sessionId: session.sessionId,
      model: session.model,
      projectPath: session.projectPath,
      lastActivity: session.lastActivity,
      totalTokens: session.totalTokens,
      costUSD: session.costUSD
    }));

  const totals = sumRows(metricRows);
  const requestCount = recentEvents.length || recentSessions.length;
  const cacheDenominator = totals.inputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;

  const budgetWindows = buildBudgetWindows({
    rows: normalizedEvents.length ? normalizedEvents : normalizedSessions,
    budgetProfiles,
    nowMs
  });

  const snapshot = {
    generatedAt: new Date(nowMs).toISOString(),
    windowMinutes,
    status: activeSessions.length || recentEvents.length ? 'active' : 'idle',
    demoMode: Boolean(demoMode),
    autoCollectEnabled: Boolean(autoCollectEnabled),
    latestEventAt,
    latestCollectionRunAt,
    refreshIntervalSeconds,
    collectionState: sanitizeCollectionState(collectionState),
    totals: {
      ...totals,
      requestCount,
      burnRateTokensPerHour: Math.round((totals.totalTokens / windowMinutes) * 60),
      cacheHitRate: cacheDenominator ? (totals.cacheReadTokens / cacheDenominator) * 100 : 0
    },
    pulse: buildPulseWindow({
      rows: metricRows,
      nowMs,
      windowMinutes
    }),
    adviceContext: buildLiveAdviceContext(metricRows),
    activeSessions,
    bySource: sourceRows,
    byModel: modelRows,
    budgetWindows,
    recentEvents: recentEvents.slice(0, 25).map(stripRuntimeFields),
    latestRun: runs[0] || null
  };
  const freshness = buildLiveDataFreshness({
    nowMs,
    recentTokenTotal: totals.totalTokens,
    recentEventCount: recentEvents.length,
    tokenEventCount: normalizedEvents.length,
    latestEventAt,
    latestCollectionRunAt,
    collectionState,
    refreshIntervalSeconds,
    demoMode
  });
  const guardrails = liveGuardrailConfig(guardrailConfig);
  const warnings = buildLiveGuardrails(snapshot, guardrails);
  const { adviceContext: _adviceContext, ...publicSnapshot } = snapshot;
  return {
    ...publicSnapshot,
    ...freshness,
    guardrails,
    warnings
  };
}

export function buildLiveDataFreshness({
  nowMs = Date.now(),
  recentTokenTotal = 0,
  recentEventCount = 0,
  tokenEventCount = 0,
  latestEventAt = null,
  latestCollectionRunAt = null,
  collectionState = null,
  refreshIntervalSeconds = 60,
  demoMode = false
} = {}) {
  const intervalMs = Math.max(30, Number(refreshIntervalSeconds) || 60) * 1000;
  const collectionStatus = collectionState?.status || null;
  const latestRunMs = dateMs(latestCollectionRunAt);
  const latestEventMs = dateMs(latestEventAt);

  if (collectionStatus === 'running') {
    return {
      dataFreshness: 'collecting',
      staleReason: '正在刷新本地 Claude/Codex 结构化 token 日志。'
    };
  }
  if (collectionStatus === 'error') {
    return {
      dataFreshness: 'error',
      staleReason: collectionState?.message || '最近一次本地刷新失败，请打开 /trust 查看原因。'
    };
  }
  if (recentEventCount > 0 || Number(recentTokenTotal || 0) > 0) {
    return {
      dataFreshness: 'fresh',
      staleReason: null
    };
  }
  if (!tokenEventCount && !latestEventMs) {
    return {
      dataFreshness: 'empty',
      staleReason: demoMode
        ? 'Demo 或空库没有最近事件；这不代表真实采集成功。'
        : 'SQLite 还没有 event 级 token 数据。'
    };
  }
  if (!latestRunMs) {
    return {
      dataFreshness: 'stale',
      staleReason: '已有历史 token event，但当前服务还没有可见的采集运行记录。'
    };
  }
  if (nowMs - latestRunMs > intervalMs * 2) {
    return {
      dataFreshness: 'stale',
      staleReason: '最近窗口没有新 token，且距离上次后台刷新已超过两个刷新周期。'
    };
  }
  return {
    dataFreshness: 'fresh',
    staleReason: '最近窗口没有新 token；历史事件仍在 SQLite 中。'
  };
}

export function buildLiveGuardrails(snapshot: LiveSnapshotInput = {}, config: GuardrailOverrides = {}) {
  const guardrails = liveGuardrailConfig(config);
  const totals = snapshot.totals || {};
  const warnings = [];
  const context = liveAdviceContext(snapshot);
  const inputTokens = number(totals.inputTokens);
  const outputTokens = number(totals.outputTokens);
  const reasoningTokens = number(totals.reasoningTokens);
  const burnRate = number(totals.burnRateTokensPerHour);
  const cacheHitRate = Number(totals.cacheHitRate || 0);
  const responseTokens = outputTokens + reasoningTokens;
  const outputInputRatio = inputTokens ? responseTokens / inputTokens : 0;

  if (burnRate > guardrails.tokenBudgetPerHour) {
    warnings.push({
      type: 'high-burn-rate',
      level: burnRate > guardrails.tokenBudgetPerHour * 1.5 ? 'high' : 'medium',
      message: '最近窗口 token burn rate 超过预算线',
      evidence: joinEvidence(`${formatInt(burnRate)} tokens/hour > ${formatInt(guardrails.tokenBudgetPerHour)} tokens/hour`, context.focusEvidence),
      action: context.focusAction || '暂停大上下文任务，拆成更小的验证步骤后再继续。'
    });
  }

  if (inputTokens >= guardrails.highInputTokens && cacheHitRate < guardrails.minCacheHitRate) {
    warnings.push({
      type: 'low-cache-hit',
      level: 'medium',
      message: 'Input tokens 高但 cache hit 偏低',
      evidence: joinEvidence(`input ${formatInt(inputTokens)} tokens，cache hit ${cacheHitRate.toFixed(1)}% < ${guardrails.minCacheHitRate}%`, context.focusEvidence),
      action: context.sessionCount > 1
        ? '先固定同一窗口的项目摘要和验收标准，跨窗口继续时只带差异，不重复喂完整上下文。'
        : '沉淀当前窗口的项目上下文摘要，避免每轮重复喂相同文件。'
    });
  }

  if (inputTokens >= guardrails.highInputTokens && outputInputRatio < guardrails.minOutputInputRatio) {
    warnings.push({
      type: 'low-output-input-ratio',
      level: 'medium',
      message: '响应/输入比偏低，可能在读过多上下文',
      evidence: joinEvidence(`响应/输入 ${outputInputRatio.toFixed(2)} < ${guardrails.minOutputInputRatio}`, context.focusEvidence),
      action: context.sessionCount > 1
        ? '先选 token 最高的窗口收敛问题边界；其它窗口只保留结论、错误和验收标准。'
        : '只保留当前问题直接相关的文件、错误和验收标准。'
    });
  }

  const unpricedModels = (snapshot.byModel || [])
    .map(row => row.key)
    .filter(model => isUnpricedModel(model));
  if (unpricedModels.length) {
    warnings.push({
      type: 'unpriced-model-active',
      level: 'low',
      message: '最近窗口存在未公开官方美元价模型',
      evidence: `${unpricedModels.slice(0, 3).join('、')} 不纳入官方价成本判断`,
      action: '用 token、产出状态和价值判断这些模型，不把 $0 当成免费。'
    });
  }

  for (const window of snapshot.budgetWindows || []) {
    if (window.status === 'exceeded') {
      warnings.push({
        type: 'budget-exceeded',
        level: 'high',
        message: `${window.label} 已超过自定义预算`,
        evidence: budgetEvidence(window),
        action: '暂停当前高消耗任务，先拆分上下文并复查是否仍需要继续。'
      });
    } else if (window.status === 'over-pace') {
      warnings.push({
        type: 'over-budget-pace',
        level: 'high',
        message: `${window.label} 按当前 burn rate 会超预算`,
        evidence: budgetEvidence(window),
        action: '降低模型层级或缩小输入范围，把大任务拆成验证步骤。'
      });
    } else if (window.status === 'near-limit') {
      warnings.push({
        type: 'near-budget-limit',
        level: 'medium',
        message: `${window.label} 接近自定义预算`,
        evidence: budgetEvidence(window),
        action: '优先做收尾和验证，暂缓新的大上下文探索。'
      });
    }
  }

  const heavyModels = (snapshot.byModel || [])
    .filter(row => isHeavyModel(row.key) && number(row.totalTokens) > 0);
  const budgetPressure = burnRate > guardrails.tokenBudgetPerHour
    || (snapshot.budgetWindows || []).some(window => ['near-limit', 'over-pace', 'exceeded'].includes(String(window.status || '')));
  if (budgetPressure && heavyModels.length) {
    warnings.push({
      type: 'heavy-model-stop-today',
      level: (snapshot.budgetWindows || []).some(window => ['over-pace', 'exceeded'].includes(String(window.status || ''))) ? 'high' : 'medium',
      message: '当前窗口先暂停重模型',
      evidence: `${heavyModels.slice(0, 3).map(row => row.key).join('、')} 最近窗口合计 ${formatInt(heavyModels.reduce((sum, row) => sum + number(row.totalTokens), 0))} tokens`,
      action: '测试、探索和上下文整理先切轻量/中模型；关键发布审查再恢复重模型。'
    });
  }

  return warnings;
}

function liveAdviceContext(snapshot: LiveSnapshotInput = {}) {
  const stored = snapshot.adviceContext?.topSession || null;
  const fallback = (snapshot.activeSessions || [])
    .slice()
    .sort((a, b) => number(b.totalTokens) - number(a.totalTokens))[0] || null;
  const topSession = stored || fallback;
  const sessionCount = Number(snapshot.adviceContext?.sessionCount) || (snapshot.activeSessions || []).length;
  const pieces = [];
  if (topSession?.sessionId && topSession.sessionId !== 'unknown-session') {
    pieces.push(`窗口 ${shortSessionId(topSession.sessionId)} ${formatInt(topSession.totalTokens)} tokens`);
  }
  if (topSession?.source && topSession.source !== 'unknown') {
    pieces.push(`来源 ${topSession.source}`);
  }
  if (topSession?.model && topSession.model !== 'unknown') {
    pieces.push(`模型 ${topSession.model}`);
  }
  const focusEvidence = pieces.length ? pieces.slice(0, 3).join(' · ') : '';
  const focusAction = topSession?.sessionId && topSession.sessionId !== 'unknown-session'
    ? `先处理窗口 ${shortSessionId(topSession.sessionId)}：拆分上下文、确认是否还需要继续当前任务。`
    : '';
  return { focusEvidence, focusAction, sessionCount };
}

function buildLiveAdviceContext(rows = []) {
  const sessions = new Map();
  for (const row of rows) {
    const sessionId = String(row?.sessionId || '').trim();
    if (!sessionId || sessionId === 'unknown-session') continue;
    const key = [row.device || '', row.source || '', sessionId].join('::');
    const current = sessions.get(key) || {
      sessionId,
      source: row.source || 'unknown',
      model: row.model || 'unknown',
      totalTokens: 0,
      latestActivityMs: 0
    };
    current.totalTokens += number(row.totalTokens);
    const activityMs = number(row.timestampMs ?? row.lastActivityMs);
    if (activityMs >= current.latestActivityMs) {
      current.latestActivityMs = activityMs;
      current.source = row.source || current.source;
      current.model = row.model || current.model;
    }
    sessions.set(key, current);
  }
  const ranked = Array.from(sessions.values())
    .sort((a, b) => b.totalTokens - a.totalTokens || b.latestActivityMs - a.latestActivityMs);
  return {
    sessionCount: ranked.length,
    topSession: ranked[0] || null
  };
}

function joinEvidence(primary, extra) {
  return extra ? `${primary} · ${extra}` : primary;
}

function shortSessionId(sessionId) {
  const text = String(sessionId || '').trim();
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

export function buildBudgetWindows({ rows = [], budgetProfiles = [], nowMs = Date.now() } = {}) {
  return budgetProfiles
    .filter(profile => profile && profile.enabled !== false)
    .map(profile => {
      const windowMinutes = positiveNumber(profile.windowMinutes, 300);
      const frame = budgetWindowFrame(profile, nowMs, windowMinutes);
      const source = String(profile.source || '').trim();
      const modelGroup = String(profile.modelGroup || profile.model_group || '').trim();
      const matching = rows.filter(row => {
        const timestampMs = row.timestampMs ?? row.lastActivityMs ?? 0;
        return timestampMs >= frame.startMs
          && timestampMs <= nowMs
          && (!source || row.source === source)
          && modelMatchesGroup(row.model, modelGroup);
      });
      const totals = sumRows(matching);
      const firstMs = frame.windowType === 'fixed'
        ? frame.startMs
        : matching.length
        ? Math.min(...matching.map(row => row.timestampMs ?? row.lastActivityMs ?? nowMs).filter(Number.isFinite))
        : frame.startMs;
      const elapsedMinutes = Math.max(1, Math.min(windowMinutes, (nowMs - firstMs) / 60000 || windowMinutes));
      const burnRateTokensPerHour = Math.round((totals.totalTokens / elapsedMinutes) * 60);
      const projectedTokens = Math.round((totals.totalTokens / elapsedMinutes) * windowMinutes);
      const projectedCostUSD = (totals.costUSD / elapsedMinutes) * windowMinutes;
      const tokenBudget = number(profile.tokenBudget);
      const costBudgetUSD = number(profile.costBudgetUSD);
      const warningThreshold = threshold(profile.warningThreshold, 0.75);
      const hardThreshold = hardThresholdValue(profile.hardThreshold);
      const tokenShare = tokenBudget ? totals.totalTokens / tokenBudget : 0;
      const costShare = costBudgetUSD ? totals.costUSD / costBudgetUSD : 0;
      const projectedTokenShare = tokenBudget ? projectedTokens / tokenBudget : 0;
      const projectedCostShare = costBudgetUSD ? projectedCostUSD / costBudgetUSD : 0;
      const currentShare = Math.max(tokenShare, costShare);
      const projectedShare = Math.max(projectedTokenShare, projectedCostShare);
      const status = currentShare >= hardThreshold ? 'exceeded'
        : projectedShare >= hardThreshold ? 'over-pace'
          : currentShare >= warningThreshold ? 'near-limit'
            : 'ok';
      return {
        id: profile.id ?? null,
        source,
        modelGroup,
        label: profile.label || (source ? `${source} budget` : 'Token budget'),
        windowType: frame.windowType,
        windowMinutes,
        resetAnchor: profile.resetAnchor || null,
        warningThreshold,
        windowStart: new Date(frame.startMs).toISOString(),
        windowEnd: new Date(frame.endMs).toISOString(),
        resetInMinutes: frame.resetInMinutes,
        hardThreshold,
        totalTokens: totals.totalTokens,
        costUSD: totals.costUSD,
        burnRateTokensPerHour,
        projectedTokens,
        projectedCostUSD,
        tokenBudget,
        costBudgetUSD,
        tokenShare,
        costShare,
        projectedTokenShare,
        projectedCostShare,
        status
      };
    });
}

function budgetWindowFrame(profile, nowMs, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const windowType = profile.windowType === 'fixed' ? 'fixed' : 'rolling';
  if (windowType === 'fixed') {
    const anchorMs = new Date(profile.resetAnchor || 0).getTime();
    if (Number.isFinite(anchorMs) && anchorMs > 0) {
      const index = Math.floor((nowMs - anchorMs) / windowMs);
      const startMs = anchorMs + index * windowMs;
      const endMs = startMs + windowMs;
      return {
        windowType,
        startMs,
        endMs,
        resetInMinutes: Math.max(0, Math.ceil((endMs - nowMs) / 60000))
      };
    }
  }
  const startMs = nowMs - windowMs;
  return {
    windowType: 'rolling',
    startMs,
    endMs: nowMs,
    resetInMinutes: windowMinutes
  };
}

export function liveGuardrailConfig(overrides: GuardrailOverrides = {}) {
  return {
    tokenBudgetPerHour: positiveNumber(
      overrides.tokenBudgetPerHour,
      envPositive('TOKEN_WORK_LIVE_TOKEN_BUDGET_PER_HOUR', DEFAULT_TOKEN_BUDGET_PER_HOUR)
    ),
    minCacheHitRate: positiveNumber(
      overrides.minCacheHitRate,
      envPositive('TOKEN_WORK_LIVE_MIN_CACHE_HIT', DEFAULT_MIN_CACHE_HIT_RATE)
    ),
    minOutputInputRatio: positiveNumber(
      overrides.minOutputInputRatio,
      envPositive('TOKEN_WORK_LIVE_MIN_OUTPUT_INPUT_RATIO', DEFAULT_MIN_OUTPUT_INPUT_RATIO)
    ),
    highInputTokens: positiveNumber(overrides.highInputTokens, DEFAULT_HIGH_INPUT_TOKENS)
  };
}

function normalizeSession(session) {
  const lastActivity = session.lastActivity || session.last_activity || null;
  return {
    device: session.device || '',
    source: session.source || 'unknown',
    sessionId: session.sessionId || session.session_id || 'unknown-session',
    model: session.model || 'unknown',
    projectPath: session.projectPath || session.project_path || null,
    lastActivity,
    lastActivityMs: dateMs(lastActivity),
    inputTokens: number(session.inputTokens ?? session.input_tokens),
    outputTokens: number(session.outputTokens ?? session.output_tokens),
    cacheReadTokens: number(session.cacheReadTokens ?? session.cache_read_tokens),
    cacheCreationTokens: number(session.cacheCreationTokens ?? session.cache_creation_tokens),
    reasoningTokens: number(session.reasoningOutputTokens ?? session.reasoningTokens ?? session.reasoning_output_tokens),
    totalTokens: number(session.totalTokens ?? session.total_tokens),
    costUSD: number(session.costUSD ?? session.cost_usd)
  };
}

function normalizeEvent(event) {
  const timestamp = event.timestamp || event.createdAt || event.created_at || null;
  const inputTokens = number(event.inputTokens ?? event.input_tokens);
  const outputTokens = number(event.outputTokens ?? event.output_tokens);
  const cacheReadTokens = number(event.cacheReadTokens ?? event.cache_read_tokens);
  const cacheCreationTokens = number(event.cacheCreationTokens ?? event.cache_creation_tokens);
  const reasoningTokens = number(event.reasoningTokens ?? event.reasoning_tokens);
  const model = event.model || 'unknown';
  const costUSD = number(event.costUSD ?? event.cost_usd)
    || calculateOfficialCost(model, {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheCreationTokens,
      reasoning: reasoningTokens
    }, { provider: providerFromSource(event.source) }).totalUSD;
  return {
    eventId: event.eventId || event.event_id || null,
    device: event.device || '',
    source: event.source || 'unknown',
    sessionId: event.sessionId || event.session_id || 'unknown-session',
    timestamp,
    timestampMs: dateMs(timestamp),
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens,
    costUSD,
    toolCategory: event.toolCategory || event.tool_category || null,
    fileExtension: event.fileExtension || event.file_extension || null
  };
}

function budgetEvidence(window) {
  const pieces = [];
  if (window.tokenBudget) {
    pieces.push(`${formatInt(window.totalTokens)} / ${formatInt(window.tokenBudget)} tokens`);
    pieces.push(`projected ${formatInt(window.projectedTokens)} tokens`);
  }
  if (window.costBudgetUSD) {
    pieces.push(`$${window.costUSD.toFixed(4)} / $${window.costBudgetUSD.toFixed(4)}`);
    pieces.push(`projected $${window.projectedCostUSD.toFixed(4)}`);
  }
  return pieces.join(' · ');
}

function aggregate(rows, field) {
  const byKey = new Map();
  for (const row of rows) {
    const key = row[field] || 'unknown';
    if (!byKey.has(key)) {
      byKey.set(key, { key, sessions: new Set(), requests: 0, totalTokens: 0, costUSD: 0 });
    }
    const target = byKey.get(key);
    target.sessions.add(row.sessionId);
    target.requests += 1;
    target.totalTokens += row.totalTokens;
    target.costUSD += row.costUSD;
  }
  return [...byKey.values()]
    .map(row => ({
      key: row.key,
      sessions: row.sessions.size,
      requests: row.requests,
      totalTokens: row.totalTokens,
      costUSD: row.costUSD
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10);
}

function buildPulseWindow({ rows = [], nowMs = Date.now(), windowMinutes = DEFAULT_WINDOW_MINUTES } = {}) {
  const safeWindowMinutes = Math.max(1, Number(windowMinutes) || DEFAULT_WINDOW_MINUTES);
  const windowMs = safeWindowMinutes * 60 * 1000;
  const startMs = nowMs - windowMs;
  const chartBucketCount = safeWindowMinutes >= 1440 ? 24 : Math.max(6, Math.min(24, Math.ceil(safeWindowMinutes / 5)));
  const chartBucketMs = windowMs / chartBucketCount;
  const chartBuckets = Array.from({ length: chartBucketCount }, (_, index) => {
    const bucketStartMs = startMs + index * chartBucketMs;
    return {
      index,
      start: new Date(bucketStartMs).toISOString(),
      label: formatBucketLabel(bucketStartMs),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      requests: 0
    };
  });

  const activityBucketMinutes = safeWindowMinutes >= 1440 ? 15 : Math.max(1, Math.min(5, Math.ceil(safeWindowMinutes / 12)));
  const activityBucketMs = activityBucketMinutes * 60 * 1000;
  const activityBuckets = new Set();

  for (const row of rows) {
    const timestampMs = row.timestampMs ?? row.lastActivityMs ?? 0;
    if (!timestampMs || timestampMs < startMs || timestampMs > nowMs) continue;
    const chartIndex = Math.min(chartBucketCount - 1, Math.max(0, Math.floor((timestampMs - startMs) / chartBucketMs)));
    chartBuckets[chartIndex].inputTokens += number(row.inputTokens);
    chartBuckets[chartIndex].outputTokens += number(row.outputTokens);
    chartBuckets[chartIndex].cacheReadTokens += number(row.cacheReadTokens);
    chartBuckets[chartIndex].totalTokens += number(row.totalTokens);
    chartBuckets[chartIndex].costUSD += number(row.costUSD);
    chartBuckets[chartIndex].requests += 1;
    const activityIndex = Math.max(0, Math.floor((timestampMs - startMs) / activityBucketMs));
    activityBuckets.add(activityIndex);
  }

  const activeMinutes = Math.min(safeWindowMinutes, activityBuckets.size * activityBucketMinutes);
  const utilization = safeWindowMinutes ? activeMinutes / safeWindowMinutes : 0;

  return {
    windowMinutes: safeWindowMinutes,
    windowHours: safeWindowMinutes / 60,
    requestCount: rows.length,
    timeline: chartBuckets,
    agent: {
      activeMinutes,
      activeHours: activeMinutes / 60,
      utilization,
      utilizationPercent: utilization * 100,
      bucketMinutes: activityBucketMinutes
    }
  };
}

function sumRows(rows) {
  return rows.reduce((sum, row) => ({
    inputTokens: sum.inputTokens + row.inputTokens,
    outputTokens: sum.outputTokens + row.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
    cacheCreationTokens: sum.cacheCreationTokens + row.cacheCreationTokens,
    reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
    totalTokens: sum.totalTokens + row.totalTokens,
    costUSD: sum.costUSD + row.costUSD
  }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUSD: 0
  });
}

function stripRuntimeFields(row) {
  const { timestampMs, ...rest } = row;
  return rest;
}

function sanitizeCollectionState(state) {
  if (!state) return null;
  return {
    status: state.status || 'idle',
    message: state.message || null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    exitCode: state.exitCode ?? null,
    summary: state.summary || null
  };
}

function dateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function envPositive(name, fallback) {
  const value = Number(globalThis.process?.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function threshold(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : fallback;
}

function hardThresholdValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.5 && number <= 2 ? number : 1;
}

function isUnpricedModel(model) {
  const value = String(model || '').trim();
  if (!value || value === 'unknown') return false;
  const pricing = resolveOfficialPricing(value);
  return !pricing || !pricing.priced;
}

function isHeavyModel(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('mythos') || value.includes('fable') || value.includes('opus') || value.includes('gpt-5.6-sol') || value.includes('gpt-5.5') || value.includes('gemini-2.5-pro-long-context');
}

function isLightModel(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('haiku')
    || value.includes('flash')
    || value.includes('spark')
    || value.includes('gpt-5.6-luna')
    || value.includes('deepseek')
    || value.includes('mimo')
    || value.includes('gemini-2.5-flash')
    || /kimi-k2[.-]5/.test(value);
}

function isMidModel(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('sonnet')
    || value.includes('grok-4.5')
    || value.includes('grok-4-5')
    || value.includes('gpt-5.3')
    || value.includes('codex')
    || value.includes('gemini-2.5-pro')
    || /kimi-k2[.-][67]/.test(value);
}

function modelMatchesGroup(model, modelGroup) {
  const group = String(modelGroup || '').trim().toLowerCase();
  if (!group || group === 'all') return true;
  if (group === 'heavy') return isHeavyModel(model);
  if (group === 'light') return isLightModel(model);
  if (group === 'mid' || group === 'medium') return isMidModel(model) && !isHeavyModel(model);
  if (group === 'priced') return !isUnpricedModel(model);
  if (group === 'unpriced') return isUnpricedModel(model);
  return String(model || '').toLowerCase().includes(group);
}

function formatInt(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US');
}

function formatBucketLabel(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}
