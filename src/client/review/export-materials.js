import { U } from '../shared/utils.js';

const PRODUCTIVE_STATUSES = new Set(['已完成', '已发布']);

export function buildProfessionalEvidencePack({
  period = {},
  sessions = [],
  totals = {},
  localTrust = null,
  coverageBridge = null,
  evidenceFlywheel = null,
  roiEvidence = null,
  evidenceAutopilotState = null
} = {}) {
  const trust = trustSummary(localTrust);
  const coverage = coverageSummary(coverageBridge);
  const evidence = evidenceSummary({ evidenceFlywheel, roiEvidence, evidenceAutopilotState });
  const actions = nextActions({ sessions, evidenceAutopilotState, evidenceFlywheel });

  return [
    '# Token Work ROI Review Evidence',
    '',
    '> 用途：这是一份可复制到周报、项目 README、博客草稿或面试准备文档的复盘证据包。它只使用本地结构化 token/session 元数据，不包含 prompt、response、transcript、diff 或完整本机路径。',
    '',
    '## 1. 数据可信度',
    '',
    table(
      ['项目', '结论'],
      [
        ['可信度结论', trust.decision],
        ['数据模式', trust.mode],
        ['Coverage gate', trust.coverageGate],
        ['总量校验', trust.reconciliation],
        ['Token events', formatInt(trust.tokenEvents)],
        ['建议动作', trust.action]
      ]
    ),
    '',
    trust.isStrong
      ? '结论：当前数据可以作为 ROI 复盘的基础，但自动证据仍需按来源和置信度区分。'
      : '结论：当前数据不能直接包装成强 ROI 结论，只能用于趋势观察或作为补采集/补证据的起点。',
    '',
    '## 2. 本期范围',
    '',
    table(
      ['指标', '数值'],
      [
        ['周期', period.pretty || `${period.start || ''} - ${period.end || ''}` || '当前筛选周期'],
        ['Session', formatInt(sessions.length)],
        ['总 tokens', compactCN(totals.total || totals.totalTokens || 0)],
        ['输入 tokens', compactCN(totals.input || totals.inputTokens || 0)],
        ['输出 tokens', compactCN(totals.output || totals.outputTokens || 0)],
        ['官方价换算', money(totals.cost || totals.costUSD || 0)],
        ['未定价说明', '未公开官方美元价的模型不参与官方价节省判断']
      ]
    ),
    '',
    '## 3. 覆盖来源',
    '',
    table(
      ['覆盖方式', '数量', '说明'],
      [
        ['原生可信采集', formatInt(coverage.nativeTrusted), 'Token Work 直接读取可靠 token 字段。'],
        ['ccusage 可导入', formatInt(coverage.importable), '通过 ccusage 结构化 JSON 补覆盖，不采用第三方 cost 字段。'],
        ['实验采集', formatInt(coverage.experimental), '只在审计证明 token 字段可靠后才升级。'],
        ['仅检测到', formatInt(coverage.detectedOnly), '检测到目录或工具，不等同于已采集 token。'],
        ['不支持 / 无 token 字段', formatInt(coverage.unsupported), '不估算、不造数。']
      ]
    ),
    '',
    '## 4. Evidence Flywheel',
    '',
    table(
      ['证据环节', '数值', '解释'],
      [
        ['飞轮进度', `${evidence.score}%`, '真实 token 转成可复盘工作证据的完成度。'],
        ['完成步骤', `${evidence.completedSteps}/${evidence.totalSteps}`, '从 token、项目、自动证据、待确认、产出到模型策略。'],
        ['可直接写入', formatInt(evidence.directWrite), '高置信自动证据，不覆盖人工标注。'],
        ['待确认草稿', formatInt(evidence.draft), '中低置信建议，只能作为草稿。'],
        ['人工确认', formatInt(evidence.manual), '最高可信证据。'],
        ['产出链接', formatInt(evidence.output), '只保存 URL、标签、类型，不抓取链接内容。']
      ]
    ),
    '',
    '## 5. ROI 判断边界',
    '',
    '- 可以判断：本期 token 花在哪些来源、模型、项目和高成本 session 上；哪些 session 缺项目/任务/阶段/价值/产出证据。',
    '- 可以模拟：在已有官方公开价格的模型上，低价值、探索、测试和上下文整理类任务如果切换模型，可能减少多少官方价换算成本。',
    '- 不能声称：这不是供应商账单，不证明真实财务支出；自动证据不是人工事实，也不是人工确认；没有产出链接时不能声称 token 换来了具体 PR、commit、文章或部署。',
    '',
    '## 6. 下一步行动',
    '',
    actions.length
      ? actions.map((action, index) => `${index + 1}. ${action}`).join('\n')
      : '1. 先运行 Evidence Autopilot，生成最高成本的待确认证据队列。',
    '',
    '## 7. 引用口径',
    '',
    '- 成本口径：官方价不是账单；这里只使用官方公开 token 价格换算，用于复盘和策略模拟，不用于财务对账。',
    '- 隐私口径：不保存 prompt、response、transcript、diff、command body 或完整本机路径。',
    '- 证据口径：manual > auto high-confidence > draft > missing；任何自动推断都必须标明来源和置信度。'
  ].join('\n');
}

export function buildTechnicalBlogDraft({
  period = {},
  sessions = [],
  totals = {},
  localTrust = null,
  coverageBridge = null,
  evidenceFlywheel = null,
  savingsSimulation = null,
  modelStrategy = null
} = {}) {
  const trust = trustSummary(localTrust);
  const coverage = coverageSummary(coverageBridge);
  const topProjects = aggregateProjects(sessions).slice(0, 5);
  const savings = savingsSimulation?.recommendations || savingsSimulation?.items || [];
  const strategyCoverage = modelStrategy?.coverage?.sampleShare ?? modelStrategy?.coverage?.strategySampleShare ?? null;

  return [
    '# 我为什么做 Token Work ROI：把 AI 编程 token 变成可复盘的工作证据',
    '',
    '## 标题候选',
    '',
    '1. 从 token 看板到 ROI 复盘：我如何管理 AI 编程投入',
    '2. Token Work ROI：一个本地隐私优先的 AI 编程成本与产出复盘工具',
    '3. 不只统计 token：把 AI 编程消耗连接到项目、产出和模型策略',
    '',
    '## 摘要',
    '',
    `本期样本包含 ${formatInt(sessions.length)} 个 session、${compactCN(totals.total || totals.totalTokens || 0)} tokens，官方价换算为 ${money(totals.cost || totals.costUSD || 0)}。Token Work ROI 的目标不是生成供应商账单，而是回答三个更适合个人复盘的问题：token 花在哪、产生了什么证据、下周怎么用更少 token 做更高价值的事。`,
    '',
    '## 背景问题',
    '',
    'AI 编程工具降低了试错成本，也放大了不可见消耗。普通 token dashboard 可以告诉我用了多少 token，却很难回答：这些 token 是探索、实现、调试还是发布？哪些 session 最后有 PR、commit、文章或部署？哪些任务应该先用轻量模型试错，哪些任务才值得上重模型？',
    '',
    '因此我把 Token Work ROI 定位为本地复盘系统，而不是另一个 token meter。它先确认数据可信度，再把 token 转成项目、任务、阶段、价值和产出证据，最后输出模型策略和行动清单。',
    '',
    '## 方案设计',
    '',
    '- Local Trust：先判断当前数据库是 demo、aggregate-only、event-verified 还是 coverage failed，避免把旧聚合库包装成强结论。',
    '- Coverage Bridge：把来源区分为原生可信采集、ccusage 可导入、实验采集、仅检测到和无可靠 token 字段。',
    '- Evidence Flywheel：把真实 token 串到项目识别、自动证据、待确认草稿、产出链接和模型策略样本。',
    `- Savings Simulator：只对有官方公开美元价的模型做节省模拟，人民币按 ${U.exchangeRateLabel()} 估算，未定价模型不参与金额结论。`,
    '- Desktop Pulse：作为可选本地伴侣，只做 burn rate、预算窗口、reset countdown 和 open actions 的快速入口。',
    '',
    '## 技术实现',
    '',
    `- 数据层：本地 SQLite 保存 daily、session 和 event 级 token 元数据；当前 token events 为 ${formatInt(trust.tokenEvents)}。`,
    '- 采集边界：Claude/Codex 只读取结构化 token/model/time/session 字段；Cursor 没有明确 token 字段时保持 detected-only。',
    `- 覆盖策略：当前原生可信来源 ${formatInt(coverage.nativeTrusted)} 个，ccusage 可导入来源 ${formatInt(coverage.importable)} 个，detected-only 来源 ${formatInt(coverage.detectedOnly)} 个。`,
    '- API 边界：本地 Dashboard API 默认 loopback-only；非本机读取和写入都需要本地 Origin / JSON 约束。',
    '- 价格口径：继续使用官方公开 token 单价换算，不采用 ccusage、LiteLLM、OpenRouter 或日志里的 cost 字段作为账单。',
    '',
    '## 本期验证结果',
    '',
    table(
      ['项目', '结果'],
      [
        ['数据可信度', trust.decision],
        ['Coverage gate', trust.coverageGate],
        ['Session 数', formatInt(sessions.length)],
        ['总 tokens', compactCN(totals.total || totals.totalTokens || 0)],
        ['官方价换算', money(totals.cost || totals.costUSD || 0)],
        ['Evidence Flywheel', `${evidenceFlywheel?.completedSteps || 0}/${evidenceFlywheel?.totalSteps || 6}`],
        ['节省模拟候选', formatInt(savings.length)],
        ['模型策略样本覆盖', strategyCoverage == null ? '待补证据' : `${Number(strategyCoverage).toFixed(1)}%`]
      ]
    ),
    '',
    topProjects.length ? [
      '本期高成本项目示例：',
      '',
      table(
        ['项目', 'Session', 'Tokens', '官方价'],
        topProjects.map(project => [
          project.project,
          formatInt(project.sessions),
          compactCN(project.totalTokens),
          money(project.costUSD)
        ])
      )
    ].join('\n') : '当前没有足够项目证据，下一步应先补项目别名和任务类型。',
    '',
    '## 隐私与安全',
    '',
    '这个工具的约束是本地优先：不上传数据，不保存对话正文，不保存 diff，不保存 command body，不保存完整本机路径。产出链接只保存 URL、标签和类型，不抓取链接内容。这样牺牲了一部分自动理解能力，但换来了可解释、低风险、零额外 token 的复盘流程。',
    '',
    '## 经验总结',
    '',
    '- 测试验证、探索和上下文整理默认先用轻量模型；方向确认后再升级。',
    '- 复杂实现和调试修复适合中模型，除非有明确关键价值或发布风险。',
    '- 发布前审查、关键价值任务和高风险变更才值得使用重模型。',
    '- 如果 input/output 比很高，先压缩上下文，只喂必要文件和当前问题。',
    '- 如果 cache 复用率低且 input 高，优先沉淀项目上下文，而不是反复把同一批文件塞给模型。',
    '',
    '## 局限',
    '',
    'Token Work ROI 不能恢复已经被上游删除或从未记录 token 字段的历史；也不能自动判断真实产出质量。它能做的是把仍存在于本机的结构化 token 元数据变成可复盘证据，并把不确定性明确标出来。',
    '',
    '## 下一步',
    '',
    '下一步不是继续堆功能，而是优先处理最高成本的待确认证据队列：补项目、任务、阶段、价值和产出链接。只有证据变完整，Savings Simulator 和 Model Strategy 才会给出更可信的建议。'
  ].join('\n');
}

export function buildResumeAndInterviewPack({
  sessions = [],
  totals = {},
  localTrust = null,
  coverageBridge = null,
  evidenceFlywheel = null
} = {}) {
  const trust = trustSummary(localTrust);
  const coverage = coverageSummary(coverageBridge);
  const eventPhrase = trust.tokenEvents > 0
    ? `${formatInt(trust.tokenEvents)} event-level token rows`
    : 'event-level token validation gates';
  const sessionPhrase = sessions.length > 0
    ? `${formatInt(sessions.length)} local AI coding sessions`
    : 'local fixture and demo sessions';
  const totalPhrase = (totals.total || totals.totalTokens)
    ? `${compactCN(totals.total || totals.totalTokens)} tokens`
    : 'structured token metadata';
  const flywheelPhrase = `${evidenceFlywheel?.completedSteps || 0}/${evidenceFlywheel?.totalSteps || 6} evidence-flywheel steps`;

  return [
    '# Token Work ROI Resume / Interview Pack',
    '',
    '## 中文简历版',
    '',
    `- 设计并实现本地优先的 AI 编程 ROI 复盘工具 Token Work ROI，将 ${sessionPhrase} 和 ${totalPhrase} 连接到项目、任务、阶段、产出证据和模型策略。`,
    `- 构建 Local Trust 与 Coverage Bridge，区分原生可信采集、ccusage 导入、实验采集、仅检测到和无可靠 token 字段来源；当前数据可信度为“${trust.decision}”。`,
    `- 实现 Evidence Flywheel 与 Autopilot，把结构化 session 元数据转成可直接写入 / 待确认 / 不可写入 / 人工确认四类证据，当前飞轮进度为 ${flywheelPhrase}。`,
    '- 强化隐私和安全边界：默认 loopback-only API，不保存 prompt、response、transcript、diff、command body 或完整本机路径，写接口保留本机 Origin + JSON 校验。',
    '- 建立发布门禁：覆盖 npm/browser/desktop smoke、privacy check、build、audit 和 tarball dry-run，避免源码能跑但 npx 用户路径不可用。',
    '',
    '## English Resume Version',
    '',
    `- Built Token Work ROI, a local-first AI coding ROI review system that connects ${sessionPhrase}, ${totalPhrase}, project attribution, output evidence, and model strategy without storing conversation content.`,
    `- Implemented Local Trust and Coverage Bridge workflows to separate native trusted collection, ccusage import paths, experimental audit, detected-only tools, and unsupported/no-token-field sources; current trust state: ${trust.mode}.`,
    `- Developed an Evidence Flywheel and rule-based Autopilot that convert structured session metadata into direct-write evidence, confirmation drafts, blocked evidence, and manual confirmation while preserving provenance and confidence.`,
    '- Hardened privacy boundaries with loopback-only local APIs, local-Origin JSON write guards, host binding checks, and privacy scans that block real SQLite databases, AI logs, `.env`, transcripts, diffs, and full local paths from release artifacts.',
    '- Validated the release path with Node tests, Vite build, npx tarball smoke, browser console smoke, desktop smoke, npm audit, and npm pack dry-run so the public entry point matches the local development path.',
    '',
    '## STAR 面试版',
    '',
    '**Situation**：AI 编程工具会产生大量 token 消耗，但普通看板只能说明用了多少，不能说明 token 花在哪、有没有产出、哪些模型策略值得保留。',
    '',
    '**Task**：我需要做一个本地隐私优先的复盘系统，在不读取对话正文的前提下，把真实 token 数据变成项目、任务、产出、模型策略和行动建议。',
    '',
    `**Action**：我实现了本地 SQLite 数据层、Claude/Codex event 级采集可信门、Coverage Bridge、Local Trust、Evidence Flywheel、Savings Simulator、Model Policy、Desktop Pulse 和发布 smoke gate。系统明确区分 ${formatInt(coverage.nativeTrusted)} 个原生可信来源、${formatInt(coverage.importable)} 个可导入来源和 ${formatInt(coverage.detectedOnly)} 个 detected-only 来源，不伪造 token 或账单。`,
    '',
    `**Result**：当前系统可以基于 ${eventPhrase} 和 ${sessionPhrase} 生成可复盘证据包、技术博客草稿、简历描述和模型策略建议；在证据不足时会明确标出“只能看趋势 / 待确认 / 不可写入”，不会包装成人工事实或真实财务节省。`,
    '',
    '**Takeaway**：这个项目的核心不是 token meter，而是“可信覆盖 → 自动证据 → ROI 复盘 → 模型策略 → 行动趋势”的本地闭环。它展示了我在产品判断、隐私安全、数据可信、前端体验、CLI/npm 发布路径和工程验证上的完整交付能力。',
    '',
    '## 可公开口径',
    '',
    '- 不写“精确账单”或“真实节省金额”，只写“官方公开 token 价格换算 / 策略模拟”。',
    '- 不写“自动判断产出质量”，只写“结构化证据和人工确认”。',
    '- 不写“覆盖所有工具”，只写“原生可信 + ccusage bridge + detected-only 透明解释”。'
  ].join('\n');
}

export function escapeMarkdownFormula(value) {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function trustSummary(localTrust = null) {
  const conclusion = localTrust?.conclusion || {};
  const runtime = localTrust?.runtime || {};
  const counts = localTrust?.counts || {};
  const reconciliation = localTrust?.reconciliation || {};
  const mode = localTrust?.dataMode?.label || 'Unknown';
  const coverageGate = runtime.coverageGate?.status || 'not-run';
  const tokenEvents = Number(counts.tokenEventRows || 0);
  const decision = conclusion.decision || '当前数据可信度待确认';
  return {
    mode,
    decision,
    action: conclusion.action || '先运行 coverage 或导入结构化 token 数据。',
    coverageGate,
    reconciliation: `${reconciliation.statusLabel || '未校验'}${reconciliation.note ? ` · ${reconciliation.note}` : ''}`,
    tokenEvents,
    isStrong: /event verified|event/i.test(mode) && tokenEvents > 0 && !/failed|risk|不可|只能看趋势/i.test(decision)
  };
}

function coverageSummary(coverageBridge = null) {
  const summary = coverageBridge?.summary || {};
  return {
    nativeTrusted: Number(summary.nativeTrusted || 0),
    importable: Number(summary.importable || 0),
    experimental: Number(summary.experimental || 0),
    detectedOnly: Number(summary.detectedOnly || 0),
    unsupported: Number(summary.unsupported || 0)
  };
}

function evidenceSummary({ evidenceFlywheel = null, roiEvidence = null, evidenceAutopilotState = null } = {}) {
  const quality = evidenceFlywheel?.quality || {};
  const totals = evidenceFlywheel?.totals || {};
  const plan = evidenceAutopilotState?.plan || {};
  return {
    score: Number(evidenceFlywheel?.score ?? roiEvidence?.score ?? roiEvidence?.evidenceScore ?? 0),
    completedSteps: Number(evidenceFlywheel?.completedSteps || 0),
    totalSteps: Number(evidenceFlywheel?.totalSteps || 6),
    directWrite: Number(plan.canApplyCount ?? quality.directWriteCount ?? 0),
    draft: Number(plan.draftCount ?? quality.draftCount ?? 0),
    manual: Number(quality.manualConfirmedCount ?? totals.manualEvidenceCount ?? roiEvidence?.manualConfirmedCount ?? 0),
    output: Number(totals.outputEvidenceCount ?? roiEvidence?.outputEvidenceCount ?? 0)
  };
}

function nextActions({ sessions = [], evidenceAutopilotState = null, evidenceFlywheel = null } = {}) {
  const queue = (evidenceAutopilotState?.plan?.queue || [])
    .slice()
    .sort((a, b) => Number(b.costUSD || 0) - Number(a.costUSD || 0) || Number(b.totalTokens || 0) - Number(a.totalTokens || 0))
    .slice(0, 5)
    .map(row => `${safeInline(row.title)}：补齐 ${safeInline(row.category || '证据')}，原因：${safeInline(row.reason || '高成本或高 token 且证据不足')}。`);

  if (queue.length) return queue;

  const gaps = sessions
    .filter(session => isEvidenceGap(session))
    .sort((a, b) => Number(b.costUSD || 0) - Number(a.costUSD || 0) || Number(b.totalTokens || 0) - Number(a.totalTokens || 0))
    .slice(0, 5)
    .map(session => `补齐 ${safeInline(projectLabel(session))}：任务类型、工作目的、阶段、产出价值和产出状态；当前 ${compactCN(session.totalTokens || 0)} tokens。`);

  if (gaps.length) return gaps;
  return evidenceFlywheel?.nextAction ? [evidenceFlywheel.nextAction] : [];
}

function isEvidenceGap(session = {}) {
  return (session.taskType || '未分类') === '未分类'
    || (session.outputStatus || '未标注') === '未标注'
    || (session.workPurpose || '未说明') === '未说明'
    || (session.workStage || '未说明') === '未说明'
    || (session.valueLevel || '未评估') === '未评估';
}

function aggregateProjects(sessions = []) {
  const map = new Map();
  for (const session of sessions) {
    const project = projectLabel(session);
    if (!map.has(project)) map.set(project, { project, sessions: 0, totalTokens: 0, costUSD: 0, outputs: 0 });
    const row = map.get(project);
    row.sessions += 1;
    row.totalTokens += Number(session.totalTokens || 0);
    row.costUSD += Number(session.costUSD || 0);
    if (PRODUCTIVE_STATUSES.has(session.outputStatus) && session.outputUrl) row.outputs += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.costUSD - a.costUSD || b.totalTokens - a.totalTokens);
}

function projectLabel(session = {}) {
  return session.projectAlias
    || session.ruleProjectAlias
    || session.projectName
    || session.projectPath
    || session.sessionId
    || '未识别项目';
}

function table(headers, rows) {
  return [
    `| ${headers.map(safeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(safeCell).join(' | ')} |`)
  ].join('\n');
}

function safeCell(value) {
  return safeInline(value).replace(/\|/g, '\\|');
}

function safeInline(value) {
  return escapeMarkdownFormula(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactCN(value) {
  return U.compactCN(Number(value || 0));
}

function money(value) {
  return U.money(Number(value || 0));
}

function formatInt(value) {
  return Math.round(Number(value || 0)).toLocaleString('zh-CN');
}
