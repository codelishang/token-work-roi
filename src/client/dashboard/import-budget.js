export const CCUSAGE_BRIDGE_REPORTS = ['daily', 'weekly', 'monthly', 'session', 'blocks'];

export const BUDGET_TEMPLATES = [
  { id: 'claude-5h', label: 'Claude 5h', source: 'Claude Code', modelGroup: '', windowType: 'fixed', windowMinutes: 300, warningThreshold: 0.75, hardThreshold: 1 },
  { id: 'claude-weekly', label: 'Claude weekly', source: 'Claude Code', modelGroup: '', windowType: 'fixed', windowMinutes: 10080, warningThreshold: 0.75, hardThreshold: 1 },
  { id: 'codex-5h', label: 'Codex 5h', source: 'Codex CLI', modelGroup: '', windowType: 'fixed', windowMinutes: 300, warningThreshold: 0.75, hardThreshold: 1 },
  { id: 'heavy-daily', label: 'Heavy model daily cap', source: '', modelGroup: 'heavy', windowType: 'rolling', windowMinutes: 1440, warningThreshold: 0.7, hardThreshold: 1 },
  { id: 'explore-light-cap', label: 'Exploration light cap', source: '', modelGroup: 'light', windowType: 'rolling', windowMinutes: 1440, warningThreshold: 0.8, hardThreshold: 1 }
];

export function buildCcusageBridgeCommand({ report = 'session', apply = false } = {}) {
  const normalized = CCUSAGE_BRIDGE_REPORTS.includes(String(report).toLowerCase())
    ? String(report).toLowerCase()
    : 'session';
  return [
    'npx token-work import-usage',
    '--format=ccusage-cli',
    `--report=${normalized}`,
    apply ? '--apply' : '--dry-run',
    '--yes'
  ].join(' ');
}

export function buildCcusageJsonExportCommand({ report = 'session' } = {}) {
  const normalized = CCUSAGE_BRIDGE_REPORTS.includes(String(report).toLowerCase())
    ? String(report).toLowerCase()
    : 'session';
  return `npx ccusage@latest ${normalized} --json --no-cost > ccusage-${normalized}.json`;
}

export function defaultResetAnchor(now = new Date()) {
  const date = new Date(now);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

export function applyBudgetTemplate(current = {}, template = {}, now = new Date()) {
  return {
    ...current,
    source: template.source || current.source || '',
    modelGroup: template.modelGroup ?? current.modelGroup ?? '',
    label: template.label || current.label || '',
    windowType: template.windowType || current.windowType || 'rolling',
    windowMinutes: template.windowMinutes || current.windowMinutes || 60,
    warningThreshold: template.warningThreshold ?? current.warningThreshold ?? 0.75,
    hardThreshold: template.hardThreshold ?? current.hardThreshold ?? 1,
    resetAnchor: template.windowType === 'fixed'
      ? current.resetAnchor || defaultResetAnchor(now)
      : current.resetAnchor || ''
  };
}
