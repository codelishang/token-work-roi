import { listAdvisorActions, listBudgetProfiles } from './db.mjs';
import { buildLiveSnapshot } from './live.mjs';

export function buildTerminalReport(db, { period = 'week', now = new Date() } = {}) {
  const range = periodRange(period, now);
  const daily = queryDaily(db, range);
  const sessions = querySessions(db, range);
  const tokenEvents = queryTokenEvents(db);
  const budgetProfiles = listBudgetProfiles(db).filter(profile => profile.enabled);
  const live = buildLiveSnapshot({ sessions, tokenEvents, budgetProfiles, now });
  const advisorActions = listAdvisorActions(db, {
    periodStart: range.start,
    periodEnd: range.end
  });
  const totals = sumDaily(daily);
  return {
    period: range,
    totals,
    topProjects: topProjects(sessions).slice(0, 8),
    topModels: topModels(daily).slice(0, 8),
    budgetWindows: live.budgetWindows || [],
    budgetWarnings: (live.warnings || []).filter(warning => warning.type?.includes('budget')),
    advisorActions: advisorActions.slice(0, 8)
  };
}

export function formatTerminalReport(report, format = 'table') {
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'markdown') return markdownReport(report);
  return tableReport(report);
}

function queryDaily(db, range) {
  if (range.id === 'all') {
    return db.prepare(`
      SELECT device, source, usage_date AS usageDate, model,
        input_tokens AS inputTokens,
        output_tokens AS outputTokens,
        cache_creation_tokens AS cacheCreationTokens,
        cache_read_tokens AS cacheReadTokens,
        reasoning_output_tokens AS reasoningOutputTokens,
        total_tokens AS totalTokens,
        cost_usd AS costUSD
      FROM daily_usage
    `).all();
  }
  return db.prepare(`
    SELECT device, source, usage_date AS usageDate, model,
      input_tokens AS inputTokens,
      output_tokens AS outputTokens,
      cache_creation_tokens AS cacheCreationTokens,
      cache_read_tokens AS cacheReadTokens,
      reasoning_output_tokens AS reasoningOutputTokens,
      total_tokens AS totalTokens,
      cost_usd AS costUSD
    FROM daily_usage
    WHERE usage_date >= ? AND usage_date <= ?
  `).all(range.start, range.end);
}

function querySessions(db, range) {
  const base = `
    SELECT device, source, session_id AS sessionId,
      last_activity AS lastActivity,
      project_path AS projectPath,
      input_tokens AS inputTokens,
      output_tokens AS outputTokens,
      cache_creation_tokens AS cacheCreationTokens,
      cache_read_tokens AS cacheReadTokens,
      reasoning_output_tokens AS reasoningOutputTokens,
      total_tokens AS totalTokens,
      cost_usd AS costUSD
    FROM session_usage
  `;
  if (range.id === 'all') return db.prepare(base).all();
  return db.prepare(`${base} WHERE substr(last_activity, 1, 10) >= ? AND substr(last_activity, 1, 10) <= ?`)
    .all(range.start, range.end);
}

function queryTokenEvents(db) {
  return db.prepare(`
    SELECT event_id AS eventId, device, source, session_id AS sessionId,
      timestamp, model,
      input_tokens AS inputTokens,
      output_tokens AS outputTokens,
      cache_read_tokens AS cacheReadTokens,
      cache_creation_tokens AS cacheCreationTokens,
      reasoning_tokens AS reasoningTokens,
      tool_category AS toolCategory,
      file_extension AS fileExtension
    FROM token_events
    ORDER BY timestamp DESC
    LIMIT 5000
  `).all();
}

function periodRange(period, now) {
  const id = String(period || 'week').toLowerCase();
  const endDate = new Date(now);
  const startDate = new Date(now);
  if (id === 'month') startDate.setUTCDate(endDate.getUTCDate() - 29);
  else if (id === '90d') startDate.setUTCDate(endDate.getUTCDate() - 89);
  else if (id === 'all') return { id: 'all', label: 'all', start: '', end: '' };
  else startDate.setUTCDate(endDate.getUTCDate() - 6);
  return { id, label: id, start: formatDate(startDate), end: formatDate(endDate) };
}

function sumDaily(rows) {
  return rows.reduce((acc, row) => {
    acc.totalTokens += row.totalTokens || 0;
    acc.inputTokens += row.inputTokens || 0;
    acc.outputTokens += row.outputTokens || 0;
    acc.cacheReadTokens += row.cacheReadTokens || 0;
    acc.cacheCreationTokens += row.cacheCreationTokens || 0;
    acc.reasoningOutputTokens += row.reasoningOutputTokens || 0;
    acc.costUSD += row.costUSD || 0;
    return acc;
  }, {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 0,
    costUSD: 0
  });
}

function topProjects(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.projectPath || '<unknown>';
    const acc = map.get(key) || { project: key, sessions: 0, totalTokens: 0, costUSD: 0 };
    acc.sessions += 1;
    acc.totalTokens += row.totalTokens || 0;
    acc.costUSD += row.costUSD || 0;
    map.set(key, acc);
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function topModels(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.model || '<unknown>'}::${row.source || 'unknown'}`;
    const acc = map.get(key) || { model: row.model || '<unknown>', source: row.source || 'unknown', totalTokens: 0, costUSD: 0 };
    acc.totalTokens += row.totalTokens || 0;
    acc.costUSD += row.costUSD || 0;
    map.set(key, acc);
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function tableReport(report) {
  return [
    `Token Work ROI Report (${report.period.id === 'all' ? 'all' : `${report.period.start}..${report.period.end}`})`,
    '',
    `tokens=${formatInt(report.totals.totalTokens)} official_price=${money(report.totals.costUSD)}`,
    '',
    'Top projects',
    ...report.topProjects.slice(0, 5).map(row => `- ${row.project}: ${formatInt(row.totalTokens)} tokens, ${money(row.costUSD)}`),
    '',
    'Top models',
    ...report.topModels.slice(0, 5).map(row => `- ${row.model} (${row.source}): ${formatInt(row.totalTokens)} tokens, ${money(row.costUSD)}`),
    '',
    'Budget risks',
    ...(report.budgetWarnings.length ? report.budgetWarnings.map(w => `- ${w.level}: ${w.message} — ${w.evidence}`) : ['- none']),
    '',
    'Advisor actions',
    ...(report.advisorActions.length ? report.advisorActions.map(a => `- [${a.status}] ${a.title}: ${a.action}`) : ['- none'])
  ].join('\n');
}

function markdownReport(report) {
  return [
    '# Token Work ROI Terminal Report',
    '',
    `- Period: ${safe(report.period.id === 'all' ? 'all' : `${report.period.start}..${report.period.end}`)}`,
    `- Total tokens: ${formatInt(report.totals.totalTokens)}`,
    `- Official price conversion: ${money(report.totals.costUSD)}`,
    '',
    '## Top Projects',
    '',
    report.topProjects.length ? mdTable(
      ['Project', 'Sessions', 'Tokens', 'Official Price'],
      report.topProjects.slice(0, 8).map(row => [row.project, row.sessions, formatInt(row.totalTokens), money(row.costUSD)])
    ) : 'No project data.',
    '',
    '## Top Models',
    '',
    report.topModels.length ? mdTable(
      ['Model', 'Source', 'Tokens', 'Official Price'],
      report.topModels.slice(0, 8).map(row => [row.model, row.source, formatInt(row.totalTokens), money(row.costUSD)])
    ) : 'No model data.',
    '',
    '## Budget Risks',
    '',
    report.budgetWarnings.length ? report.budgetWarnings.map(w => `- **${safe(w.level)}** ${safe(w.message)}: ${safe(w.evidence)}. ${safe(w.action)}`).join('\n') : '- No active budget risk.',
    '',
    '## Advisor Actions',
    '',
    report.advisorActions.length ? mdTable(
      ['Status', 'Category', 'Title', 'Action'],
      report.advisorActions.map(row => [row.status, row.category, row.title, row.action])
    ) : 'No advisor actions for this period.',
    '',
    '## Notes',
    '',
    '- Costs are official public token-price conversions, not provider invoices.',
    '- Completed actions are tracked as review workflow state; they do not prove causal savings.'
  ].join('\n');
}

function mdTable(headers, rows) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n');
}

function cell(value) {
  const text = safe(value);
  return (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/\|/g, '\\|');
}

function safe(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function formatInt(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US');
}

function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}
