import { listAdvisorActions, listBudgetProfiles, listTokenEvents } from './db.mjs';
import { buildLiveSnapshot } from './live.mjs';

export function buildStatuslineSnapshot(db, {
  now = new Date(),
  windowMinutes = 15,
  source = 'all'
} = {}) {
  const sourceFilter = normalizeSourceFilter(source);
  const tokenEvents = listTokenEvents(db, { limit: 5000 })
    .filter(event => sourceMatches(event.source, sourceFilter));
  const budgetProfiles = listBudgetProfiles(db)
    .filter(profile => profile.enabled)
    .filter(profile => sourceFilter === 'all' || !profile.source || sourceMatches(profile.source, sourceFilter));
  const live = buildLiveSnapshot({
    tokenEvents,
    budgetProfiles,
    now,
    windowMinutes
  });
  const openAdvisorActions = listAdvisorActions(db)
    .filter(action => action.status === 'open')
    .length;
  const highestBudgetShare = Math.max(0, ...live.budgetWindows.map(window => Math.max(
    Number(window.tokenShare || 0),
    Number(window.costShare || 0)
  )));
  const resetInMinutes = live.budgetWindows.length
    ? Math.min(...live.budgetWindows.map(window => Number(window.resetInMinutes || 0)))
    : null;

  return {
    generatedAt: live.generatedAt,
    source: sourceFilter,
    windowMinutes: live.windowMinutes,
    status: live.status,
    totals: {
      totalTokens: live.totals.totalTokens,
      burnRateTokensPerHour: live.totals.burnRateTokensPerHour,
      cacheHitRate: live.totals.cacheHitRate,
      costUSD: live.totals.costUSD
    },
    budget: {
      windows: live.budgetWindows,
      status: budgetStatus(live.budgetWindows),
      highestShare: highestBudgetShare,
      resetInMinutes
    },
    warnings: live.warnings.map(warning => ({
      type: warning.type,
      level: warning.level,
      message: warning.message,
      evidence: warning.evidence,
      action: warning.action
    })),
    openAdvisorActions
  };
}

export function buildEmptyStatuslineSnapshot({
  now = new Date(),
  windowMinutes = 15,
  source = 'all',
  warning = null
} = {}) {
  const sourceFilter = normalizeSourceFilter(source);
  return {
    generatedAt: new Date(now).toISOString(),
    source: sourceFilter,
    windowMinutes,
    status: 'missing-db',
    totals: {
      totalTokens: 0,
      burnRateTokensPerHour: 0,
      cacheHitRate: 0,
      costUSD: 0
    },
    budget: {
      windows: [],
      status: 'none',
      highestShare: 0,
      resetInMinutes: null
    },
    warnings: warning ? [{
      type: 'missing-db',
      level: 'low',
      message: warning,
      evidence: 'No local SQLite database was available.',
      action: 'Run demo, import ccusage JSON, or start real collection explicitly before using statusline data.'
    }] : [],
    openAdvisorActions: 0
  };
}

export function formatStatuslineText(snapshot, { maxWidth = 100 } = {}) {
  const totals = snapshot.totals || {};
  const budget = snapshot.budget || {};
  const warningTypes = (snapshot.warnings || []).map(warning => warning.type);
  const warn = warningTypes.includes('missing-db') ? 'no-db'
    : warningTypes.includes('unpriced-model-active') ? 'unpriced'
    : warningTypes.length ? warningTypes[0] : 'ok';
  const reset = budget.resetInMinutes == null ? '-' : `${Math.round(budget.resetInMinutes)}m`;
  const budgetText = budget.windows?.length
    ? `${budget.status}:${Math.round(Number(budget.highestShare || 0) * 100)}%`
    : 'none';
  const text = [
    'TS',
    `tok=${compactInt(totals.totalTokens)}`,
    `burn=${compactInt(totals.burnRateTokensPerHour)}/h`,
    `cache=${Number(totals.cacheHitRate || 0).toFixed(0)}%`,
    `actions=${snapshot.openAdvisorActions || 0}`,
    `budget=${budgetText}`,
    `reset=${reset}`,
    `warn=${warn}`
  ].join(' ');
  return truncateStatusline(text, maxWidth);
}

function budgetStatus(windows) {
  if (windows.some(window => window.status === 'exceeded')) return 'exceeded';
  if (windows.some(window => window.status === 'over-pace')) return 'over-pace';
  if (windows.some(window => window.status === 'near-limit')) return 'near-limit';
  if (windows.length) return 'ok';
  return 'none';
}

function normalizeSourceFilter(source) {
  const value = String(source || 'all').trim().toLowerCase();
  if (['all', 'claude', 'codex'].includes(value)) return value;
  throw new Error('--source must be all, claude, or codex');
}

function sourceMatches(source, filter) {
  if (filter === 'all') return true;
  const value = String(source || '').toLowerCase();
  if (filter === 'claude') return value.includes('claude') || value.includes('anthropic');
  if (filter === 'codex') return value.includes('codex') || value.includes('openai');
  return false;
}

function compactInt(value) {
  const number = Math.round(Number(value || 0));
  if (number >= 1_000_000) return `${trimFixed(number / 1_000_000)}M`;
  if (number >= 1_000) return `${trimFixed(number / 1_000)}k`;
  return String(number);
}

function trimFixed(value) {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, '');
}

function truncateStatusline(text, maxWidth) {
  const width = Math.max(40, Number(maxWidth) || 100);
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 3)).trimEnd()}...`;
}
