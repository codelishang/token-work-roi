export function buildFirstRunState(data = {}) {
  const dailyCount = data.daily?.length || 0;
  const sessionCount = data.sessions?.length || 0;
  const budgetCount = data.budgetProfiles?.length || 0;
  const actionCount = data.advisorActions?.length || 0;
  const tokenEventCount = data.tokenEvents?.length || 0;
  const hasUsage = dailyCount > 0 || sessionCount > 0;
  const hasBudget = budgetCount > 0;
  const hasActions = actionCount > 0;
  const hasLiveEvents = tokenEventCount > 0;

  const steps = [
    {
      id: 'data',
      status: hasUsage ? 'done' : 'todo',
      title: '准备用量数据',
      detail: hasUsage
        ? `${dailyCount} 条 daily、${sessionCount} 个 session 已可复盘`
        : '先用 demo，或通过 ccusage JSON dry-run 后再写入 SQLite',
      action: hasUsage ? '已完成' : '打开导入/预算'
    },
    {
      id: 'budget',
      status: hasBudget ? 'done' : 'todo',
      title: '创建预算窗口',
      detail: hasBudget
        ? `${budgetCount} 个自定义预算窗口已配置`
        : '只设置你自己的 token/USD 窗口，不内置供应商套餐额度',
      action: hasBudget ? '已完成' : '创建预算'
    },
    {
      id: 'review',
      status: hasActions ? 'done' : 'todo',
      title: '进入复盘行动',
      detail: hasActions
        ? `${actionCount} 条 Advisor action 可在周报里追踪`
        : '去 /review 把节省模拟或 ROI 建议加入行动清单',
      action: hasActions ? '已完成' : '打开 /review'
    }
  ];

  const notices = [];
  if (!hasUsage) {
    notices.push({
      id: 'no-data',
      tone: 'primary',
      title: '还没有可复盘的用量数据',
      detail: '运行 npm run demo 看完整流程，或打开导入/预算粘贴 ccusage JSON。真实采集仍需你显式确认。',
      action: '打开导入/预算'
    });
  }
  if (hasUsage && !hasActions) {
    notices.push({
      id: 'no-actions',
      tone: 'review',
      title: '下一步是把建议变成行动清单',
      detail: '数据已经存在，但还没有 open/done/dismissed actions。去 /review 处理 Savings Simulator 和 ROI Advisor。',
      action: '打开 /review'
    });
  }
  if (hasBudget && !hasLiveEvents) {
    notices.push({
      id: 'budget-no-live-events',
      tone: 'live',
      title: '预算窗口已配置，但 /live 需要事件级 token 数据',
      detail: '/live 只看最近窗口内的 token_events；只有 session 聚合数据时预算仍会保存，但实时 burn rate 可能为空。',
      action: '打开 /live'
    });
  }

  return {
    hasUsage,
    hasBudget,
    hasActions,
    hasLiveEvents,
    shouldShow: notices.length > 0 || steps.some(step => step.status !== 'done'),
    steps,
    notices
  };
}
