const SOURCE_MATCHERS = {
  claude: ['claude', 'anthropic'],
  codex: ['codex', 'openai'],
  gemini: ['gemini'],
  opencode: ['opencode', 'open code'],
  openclaw: ['openclaw', 'clawdbot', 'moltbot', 'moldbot'],
  hermes: ['hermes'],
  cursor: ['cursor'],
  copilot: ['copilot'],
  qwen: ['qwen'],
  kimi: ['kimi', 'moonshot'],
  goose: ['goose'],
  ccusage: ['import:ccusage', 'ccusage']
};

export function buildSourceHealth({
  collectors = [],
  dailyRows = [],
  sessionRows = [],
  eventRows = [],
  runs = []
} = {}) {
  const daily = groupSourceRows(dailyRows, 'dailyRows');
  const sessions = groupSourceRows(sessionRows, 'sessions');
  const events = groupSourceRows(eventRows, 'tokenEvents');
  const latestRuns = latestRunBySource(runs);

  return collectors.map(collector => {
    const matchedKeys = matchingSourceKeys(collector, [
      ...daily.keys(),
      ...sessions.keys(),
      ...events.keys(),
      ...latestRuns.keys()
    ]);
    const stats = mergeStats(matchedKeys, { daily, sessions, events });
    const run = firstRun(matchedKeys, latestRuns);
    const lastSeenAt = latestDate([
      stats.latestDailyAt,
      stats.latestSessionAt,
      stats.latestEventAt,
      run?.collectedAt
    ]);

    return {
      id: collector.id,
      label: collector.label,
      supportStatus: collector.supportStatus,
      coverageTier: coverageTier(collector.supportStatus),
      privacyLevel: collector.privacyLevel,
      defaultEnabled: Boolean(collector.defaultEnabled),
      detected: Boolean(collector.detected),
      detectedRootCount: Array.isArray(collector.existingRoots) ? collector.existingRoots.length : 0,
      configuredRootCount: Array.isArray(collector.configuredRoots) ? collector.configuredRoots.length : 0,
      readsConversationContent: Boolean(collector.readsConversationContent),
      tokenReliability: collector.tokenReliability || 'unknown',
      fixtureBacked: Boolean(collector.fixtureBacked),
      auditRecommended: Boolean(collector.auditRecommended),
      dataFields: collector.dataFields || [],
      workflow: workflowFor(collector),
      recommendedImport: recommendedImportFor(collector),
      commandHint: commandHintFor(collector),
      matchedSources: matchedKeys,
      dailyRows: stats.dailyRows,
      sessions: stats.sessions,
      tokenEvents: stats.tokenEvents,
      totalTokens: stats.totalTokens,
      lastSeenAt,
      lastRunStatus: run?.status || null,
      lastRunAt: run?.collectedAt || null,
      lastRunMessage: sanitizeRunMessage(run?.message),
      health: healthStatus({ collector, stats, run, lastSeenAt }),
      note: collector.note || null
    };
  });
}

function groupSourceRows(rows, countField) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeKey(row.source);
    if (!key) continue;
    const current = map.get(key) || emptyStats();
    current[countField] += Number(row.count ?? row[countField] ?? 0);
    current.totalTokens += Number(row.totalTokens || 0);
    if (row.latestDailyAt) current.latestDailyAt = latestDate([current.latestDailyAt, row.latestDailyAt]);
    if (row.latestSessionAt) current.latestSessionAt = latestDate([current.latestSessionAt, row.latestSessionAt]);
    if (row.latestEventAt) current.latestEventAt = latestDate([current.latestEventAt, row.latestEventAt]);
    map.set(key, current);
  }
  return map;
}

function latestRunBySource(runs) {
  const map = new Map();
  for (const run of runs) {
    const key = normalizeKey(run.source);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || new Date(run.collectedAt || 0) > new Date(existing.collectedAt || 0)) {
      map.set(key, {
        source: run.source,
        status: run.status || null,
        collectedAt: run.collectedAt || null,
        message: run.message || null
      });
    }
  }
  return map;
}

function matchingSourceKeys(collector, keys) {
  const unique = [...new Set(keys)].filter(Boolean);
  const patterns = SOURCE_MATCHERS[collector.id] || [collector.id, collector.label];
  const normalizedPatterns = patterns.map(normalizeKey).filter(Boolean);
  return unique.filter(key => normalizedPatterns.some(pattern => key.includes(pattern) || pattern.includes(key)));
}

function mergeStats(keys, groups) {
  const merged = emptyStats();
  for (const key of keys) {
    for (const group of Object.values(groups)) {
      const row = group.get(key);
      if (!row) continue;
      merged.dailyRows += row.dailyRows;
      merged.sessions += row.sessions;
      merged.tokenEvents += row.tokenEvents;
      merged.totalTokens += row.totalTokens;
      merged.latestDailyAt = latestDate([merged.latestDailyAt, row.latestDailyAt]);
      merged.latestSessionAt = latestDate([merged.latestSessionAt, row.latestSessionAt]);
      merged.latestEventAt = latestDate([merged.latestEventAt, row.latestEventAt]);
    }
  }
  return merged;
}

function firstRun(keys, latestRuns) {
  return keys
    .map(key => latestRuns.get(key))
    .filter(Boolean)
    .sort((a, b) => new Date(b.collectedAt || 0) - new Date(a.collectedAt || 0))[0] || null;
}

function emptyStats() {
  return {
    dailyRows: 0,
    sessions: 0,
    tokenEvents: 0,
    totalTokens: 0,
    latestDailyAt: null,
    latestSessionAt: null,
    latestEventAt: null
  };
}

function coverageTier(status) {
  if (status === 'stable') return 'native stable';
  if (status === 'experimental') return 'experimental';
  if (status === 'import-only') return 'ccusage import-bridge';
  return 'detected-only';
}

function workflowFor(collector) {
  if (collector.supportStatus === 'stable') return 'Native collector can write structured token usage after explicit collect.';
  if (collector.supportStatus === 'experimental') return 'Run collector audit first; only explicit token fields are eligible.';
  if (collector.supportStatus === 'import-only') return 'Import saved ccusage JSON or run explicit ccusage CLI bridge from terminal.';
  return 'Presence detection only; no usage rows are written.';
}

function recommendedImportFor(collector) {
  if (collector.supportStatus === 'stable') {
    return '优先用 Token Work 原生采集；如果历史缺口较大，再用 ccusage JSON 做交叉补充。';
  }
  if (collector.supportStatus === 'experimental') {
    return '先运行 audit，只在发现可靠 token 字段后采集；否则建议走 ccusage bridge。';
  }
  if (collector.supportStatus === 'import-only') {
    return '用 ccusage CLI 或保存的 JSON 导入结构化 token，不采用第三方 cost 字段。';
  }
  if (collector.detected) {
    return '已检测到工具痕迹，但没有可靠 token 字段；建议用 ccusage bridge 导入结构化 JSON。';
  }
  return '未检测到本机数据；需要使用该工具后再采集，或通过 ccusage bridge 导入。';
}

function commandHintFor(collector) {
  if (collector.id === 'ccusage') {
    return 'npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes';
  }
  if (collector.supportStatus === 'stable') return `npx token-work collect --dry-run --sources=${collector.id}`;
  if (collector.supportStatus === 'experimental') return `npx token-work collect --dry-run --sources=${collector.id}`;
  return 'npx token-work collectors --json';
}

function healthStatus({ collector, stats, run, lastSeenAt }) {
  if (stats.sessions || stats.tokenEvents || stats.dailyRows) return 'has-data';
  if (run?.status === 'error') return 'last-run-error';
  if (collector.detected) return 'detected-no-data';
  if (collector.supportStatus === 'import-only') return 'import-ready';
  if (lastSeenAt) return 'seen';
  return 'not-detected';
}

function latestDate(values) {
  const dates = values
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0]?.toISOString() || null;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeRunMessage(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text
    .replace(/[A-Z]:[\\/][^\s;]+/g, '[local-path]')
    .replace(/\/(?:Users|home)\/[^\s;]+/g, '[local-path]')
    .slice(0, 280);
}
