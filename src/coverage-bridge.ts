const TRUSTED_NATIVE_STATUSES = new Set(['stable']);
const IMPORT_BRIDGE_STATUSES = new Set(['import-only']);
const EXPERIMENTAL_STATUSES = new Set(['experimental']);
const DETECTED_ONLY_STATUSES = new Set(['detected-only']);
const CCUSAGE_REPORTS = ['daily', 'weekly', 'monthly', 'session', 'blocks'];

export function buildCoverageBridge({ sourceHealth = [] } = {}) {
  const rows = sourceHealth.map(row => {
    const status = bridgeStatus(row);
    const hasUsage = Number(row.sessions || 0) > 0
      || Number(row.tokenEvents || 0) > 0
      || Number(row.dailyRows || 0) > 0;
    const failureReason = bridgeFailureReason(row, status, hasUsage);
    return {
      id: row.id,
      label: row.label,
      status,
      statusLabel: statusLabel(status),
      detected: Boolean(row.detected),
      hasUsage,
      successfulCoverage: isSuccessfulCoverage(status, hasUsage),
      sessions: Number(row.sessions || 0),
      tokenEvents: Number(row.tokenEvents || 0),
      dailyRows: Number(row.dailyRows || 0),
      totalTokens: Number(row.totalTokens || 0),
      tokenReliability: row.tokenReliability || 'unknown',
      tokenReliabilityLabel: tokenReliabilityLabel(row.tokenReliability),
      commandHint: row.commandHint || commandForStatus(status, row.id),
      recommendedAction: bridgeRecommendation(row, status),
      recommendedPath: recommendedPath(status),
      whyNoData: failureReason || null,
      canWriteUsage: canWriteUsage(status),
      coverageStatus: status,
      privacy: row.readsConversationContent ? '需要审计内容风险' : '不读取正文',
      lastSeenAt: row.lastSeenAt || row.lastRunAt || row.latestEventAt || row.latestSessionAt || row.latestDailyAt || null,
      health: row.health || 'unknown',
      failureReason,
      workflow: bridgeWorkflow(row, status, hasUsage, failureReason),
      importReports: importReportsFor(status),
      usageSummary: {
        sessions: Number(row.sessions || 0),
        tokenEvents: Number(row.tokenEvents || 0),
        dailyRows: Number(row.dailyRows || 0),
        totalTokens: Number(row.totalTokens || 0)
      }
    };
  });
  const summary = {
    totalSources: rows.length,
    nativeTrusted: rows.filter(row => row.status === 'native-trusted').length,
    importable: rows.filter(row => row.status === 'ccusage-importable').length,
    experimental: rows.filter(row => row.status === 'experimental-audit').length,
    detectedOnly: rows.filter(row => row.status === 'detected-only').length,
    unsupported: rows.filter(row => row.status === 'unsupported').length,
    sourcesWithUsage: rows.filter(row => row.hasUsage).length,
    successfulCoverage: rows.filter(row => row.successfulCoverage).length,
    totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    ccusageReports: CCUSAGE_REPORTS
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    rows: rows.sort(compareBridgeRows),
    note: 'Coverage Bridge explains support and import paths. Experimental and detected-only sources are not counted as successful token collection until explicit token fields are proven.'
  };
}

function bridgeStatus(row = {}) {
  if (TRUSTED_NATIVE_STATUSES.has(row.supportStatus) && row.tokenReliability === 'native-token-fields') {
    return 'native-trusted';
  }
  if (IMPORT_BRIDGE_STATUSES.has(row.supportStatus) || row.id === 'ccusage') {
    return 'ccusage-importable';
  }
  if (EXPERIMENTAL_STATUSES.has(row.supportStatus)) {
    return 'experimental-audit';
  }
  if (row.detected || DETECTED_ONLY_STATUSES.has(row.supportStatus)) {
    return 'detected-only';
  }
  return 'unsupported';
}

function statusLabel(status) {
  return ({
    'native-trusted': '原生可信采集',
    'ccusage-importable': 'ccusage 可导入',
    'experimental-audit': '实验采集',
    'detected-only': '仅检测到',
    unsupported: '不支持 / 无 token 字段'
  })[status] || '未知状态';
}

function bridgeRecommendation(row, status) {
  if (status === 'native-trusted') {
    return row.hasUsage
      ? '已有原生结构化 token 数据；如需补齐其他工具，可再导入 ccusage JSON。'
      : `运行 ${row.commandHint || commandForStatus(status, row.id)} 做 dry-run，确认后再 apply。`;
  }
  if (status === 'ccusage-importable') {
    return '用 ccusage CLI 或保存的 JSON 导入结构化 token；Token Work 会重算官方价并拒绝正文风险字段。';
  }
  if (status === 'experimental-audit') {
    return '先做 collector audit，只有证明存在稳定 token 字段后才升级采集；否则走 ccusage bridge。';
  }
  if (status === 'detected-only') {
    return '检测到工具痕迹但没有可靠 token 字段；不要把它当作已覆盖，优先用 ccusage bridge 补数据。';
  }
  return '当前没有可靠 token 字段或本机未检测到数据；等待上游记录 token 字段后再升级支持。';
}

function isSuccessfulCoverage(status, hasUsage) {
  return hasUsage && (status === 'native-trusted' || status === 'ccusage-importable');
}

function bridgeFailureReason(row, status, hasUsage) {
  if (hasUsage) return '';
  if (row.health === 'last-run-error') return row.lastRunMessage || '上次采集或导入失败。';
  if (status === 'native-trusted') return '本机未写入该来源的结构化 token，用 dry-run 检查候选文件和 token 字段。';
  if (status === 'ccusage-importable') return '尚未导入 ccusage 结构化 JSON。';
  if (status === 'experimental-audit') return '实验来源需要 audit 证明可靠 token 字段；当前不按稳定覆盖计算。';
  if (status === 'detected-only') return '检测到工具痕迹，但 Token Work 没有可靠 token 字段可写入。';
  return '未检测到本机数据，或上游没有公开稳定 token 字段。';
}

function bridgeWorkflow(row, status, hasUsage, failureReason) {
  if (isSuccessfulCoverage(status, hasUsage)) {
    return {
      state: 'covered',
      label: '已接入用量',
      nextStep: '去 /review 查看证据飞轮和模型策略。',
      reason: ''
    };
  }
  if (status === 'native-trusted') {
    return {
      state: 'native-dry-run',
      label: '先做原生 dry-run',
      nextStep: row.commandHint || commandForStatus(status, row.id),
      reason: failureReason
    };
  }
  if (status === 'ccusage-importable') {
    return {
      state: 'import-json',
      label: '导入 ccusage JSON',
      nextStep: '选择 report，运行命令后粘贴 JSON dry-run，确认后再 apply。',
      reason: failureReason
    };
  }
  if (status === 'detected-only') {
    return {
      state: 'bridge-recommended',
      label: '建议用 ccusage bridge',
      nextStep: '如果 ccusage 支持该工具，先导出 JSON，再由 Token Work 预检导入。',
      reason: failureReason
    };
  }
  if (status === 'experimental-audit') {
    return {
      state: 'audit-required',
      label: '先审计 token 字段',
      nextStep: '运行 npx token-work collectors --audit --json；通过后再考虑采集或导入。',
      reason: failureReason
    };
  }
  return {
    state: 'unsupported',
    label: '暂不写入用量',
    nextStep: '等待上游写出稳定 token 字段，或通过显式结构化 JSON 导入。',
    reason: failureReason
  };
}

function importReportsFor(status) {
  if (!['ccusage-importable', 'detected-only', 'experimental-audit'].includes(status)) return [];
  return CCUSAGE_REPORTS.map(report => ({
    report,
    exportCommand: `npx ccusage@latest ${report} --json --no-cost > ccusage-${report}.json`,
    tokenStudioCommand: `npx token-work import-usage --format=ccusage-cli --report=${report} --dry-run --yes`
  }));
}

function commandForStatus(status, id) {
  if (status === 'native-trusted') return `npx token-work collect --dry-run --sources=${id}`;
  if (status === 'ccusage-importable') return 'npx token-work import-usage --format=ccusage-cli --report=session --dry-run --yes';
  if (status === 'experimental-audit') return 'npx token-work collectors --audit --json';
  return 'npx token-work collectors --json';
}

function recommendedPath(status) {
  if (status === 'native-trusted') return '原生 dry-run -> apply';
  if (status === 'ccusage-importable') return 'ccusage JSON import';
  if (status === 'experimental-audit') return 'collector audit -> bridge/import';
  if (status === 'detected-only') return 'ccusage bridge 或等待 token 字段';
  return '暂不写入';
}

function canWriteUsage(status) {
  return status === 'native-trusted' || status === 'ccusage-importable';
}

function tokenReliabilityLabel(value) {
  return ({
    'native-token-fields': '原生 token 字段',
    'explicit-token-fields-only': '只认显式 token 字段',
    'external-json-token-fields': '外部 JSON token 字段',
    'unknown-no-usage-import': '未知，不导入用量'
  })[value] || '未知 token 口径';
}

function compareBridgeRows(a, b) {
  const rank = {
    'native-trusted': 0,
    'ccusage-importable': 1,
    'experimental-audit': 2,
    'detected-only': 3,
    unsupported: 4
  };
  return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || Number(b.hasUsage) - Number(a.hasUsage)
    || b.totalTokens - a.totalTokens
    || String(a.label || '').localeCompare(String(b.label || ''));
}
