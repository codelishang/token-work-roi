export function buildReviewTrustState(meta = {}) {
  const runtime = meta.runtime || {};
  const dataMode = meta.dataMode || runtime.dataMode || {};
  const counts = runtime.counts || {};
  const coverageGate = runtime.coverageGate || {};
  const latestRun = runtime.latestCollectionRun || null;
  const hasRuntime = Boolean(meta.runtime);
  const tokenEvents = Number(counts.tokenEventRows || 0);
  const sessions = Number(counts.sessionRows || 0);
  const dailyRows = Number(counts.dailyRows || 0);
  const coverageAvailable = runtime.collectionCoverageAvailable === true
    || meta.collectionCoverageAvailable === true
    || hasRuntime && Object.keys(coverageGate).length > 0;

  if (meta.demoMode || runtime.demoMode || dataMode.id === 'demo') {
    return {
      id: 'demo',
      tone: 'demo',
      title: '当前是 Demo 数据',
      summary: '这些是合成数据，只用于看产品能力，不代表真实采集成功。',
      trusted: false,
      facts: [
        { label: 'Session', value: String(sessions || 0) },
        { label: 'Token events', value: String(tokenEvents || 0) },
        { label: '采集状态', value: '未扫描本机日志' }
      ],
      action: '运行 npx token-work 进入真实本地采集模式。'
    };
  }

  if (!hasRuntime) {
    return {
      id: 'old-service',
      tone: 'warn',
      title: '当前可能连接到旧服务',
      summary: '这个 API 没有返回 runtime 元数据，无法证明当前页面使用的是 4.8.6+ 的 event 级采集可信链路。',
      trusted: false,
      facts: [
        { label: 'Session', value: String(meta.sessionCount || sessions || '未知') },
        { label: 'Coverage', value: '不可用' },
        { label: '建议', value: '重启 npx token-work@latest' }
      ],
      action: '关闭旧 Node/Vite 进程后重新运行 npx token-work@latest。'
    };
  }

  if (dataMode.id === 'real-event-verified' && tokenEvents > 0) {
    return {
      id: 'real-event-verified',
      tone: 'ok',
      title: '本地 SQLite 已有 event 级 token 记录',
      summary: '当前数据来自本地 SQLite，且最近只读 coverage 或采集运行可追溯。美元值是官方公开价换算，不是供应商账单。',
      trusted: true,
      facts: [
        { label: 'Session', value: formatInt(sessions) },
        { label: 'Token events', value: formatInt(tokenEvents) },
        { label: '检查状态', value: coverageGate.status === 'passed' ? 'coverage 已通过' : '有采集运行' }
      ],
      latestRun,
      action: '下一步是补 ROI 证据：任务、目的、阶段、价值、产出链接和人工确认。'
    };
  }

  if (dataMode.id === 'real-aggregate-only' || tokenEvents === 0 && (sessions > 0 || dailyRows > 0)) {
    return {
      id: 'real-aggregate-only',
      tone: 'warn',
      title: '这是旧聚合库，不足以证明历史采集完整',
      summary: '当前有 daily/session 数据，但没有 event 级 token_events。它可以看趋势，不适合作为强可信历史采集口径。',
      trusted: false,
      facts: [
        { label: 'Session', value: formatInt(sessions) },
        { label: 'Daily rows', value: formatInt(dailyRows) },
        { label: 'Token events', value: '0' }
      ],
      action: '运行 npx token-work 重新走只读检查，再按可信来源采集写入。'
    };
  }

  return {
    id: 'empty',
    tone: coverageAvailable ? 'warn' : 'empty',
    title: '还没有可复盘的真实 token 数据',
    summary: '当前库为空或还没有完成可信采集。先跑真实采集，或者用 demo 只看产品能力。',
    trusted: false,
    facts: [
      { label: 'Session', value: formatInt(sessions) },
      { label: 'Token events', value: formatInt(tokenEvents) },
      { label: 'Coverage', value: coverageAvailable ? '可检查' : '不可用' }
    ],
    action: '运行 npx token-work，或 npx token-work demo 查看合成数据。'
  };
}

function formatInt(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));
}
