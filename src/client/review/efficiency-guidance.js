export function buildEfficiencyGuidance({
  cacheReuseRate = 0,
  inputOutputRatio = 0,
  reasoningShare = 0,
  hasReasoningTokens = true
} = {}) {
  return {
    cache: classifyCache(cacheReuseRate),
    io: classifyInputOutput(inputOutputRatio),
    reasoning: classifyReasoning(reasoningShare, hasReasoningTokens)
  };
}

function classifyCache(value) {
  const v = finite(value);
  if (v <= 0) {
    return item('无复用', '0%', '没有读到 cache 复用。重复喂项目上下文时，优先沉淀项目摘要、文件清单和固定系统提示。', 'neutral');
  }
  if (v < 10) {
    return item('偏低', '1-10%', '有少量复用，但大部分输入仍在重复计算。把固定上下文拆成可复用前缀。', 'warn');
  }
  if (v < 50) {
    return item('有复用', '10-50%', '说明已有部分上下文被复用。继续把常用项目背景、约束和文件地图固定下来。', 'ok');
  }
  if (v < 80) {
    return item('良好', '50-80%', '复用率较好，适合长项目连续工作。注意别为了追求 cache 而塞入无关上下文。', 'ok');
  }
  return item('很高', '80%+', '大量 token 来自缓存复用，成本结构通常更友好；同时检查是否长期保留了过多过期上下文。', 'strong');
}

function classifyInputOutput(value) {
  const v = finite(value);
  if (v <= 0) {
    return item('缺输出', '0', '没有可计算的输出 token。先确认采集来源是否记录 output_tokens。', 'neutral');
  }
  if (v < 3) {
    return item('输出密集', '0-3', '输入相对精简，模型产出较多。适合内容生成、报告草稿或明确的小任务。', 'ok');
  }
  if (v < 8) {
    return item('健康', '3-8', '输入和输出比较均衡。多数编码、解释和复盘任务可接受。', 'ok');
  }
  if (v < 15) {
    return item('上下文偏重', '8-15', '输入明显多于输出。检查是否把整个项目、长日志或重复错误一次性塞给模型。', 'warn');
  }
  if (v < 30) {
    return item('需要压缩', '15-30', '高输入低输出，通常说明上下文太大或问题太散。先缩小文件范围，再让模型回答。', 'risk');
  }
  return item('高风险浪费', '30+', '大量 token 用在输入侧。把任务拆小，只给必要文件、错误片段和目标约束。', 'risk');
}

function classifyReasoning(value, hasReasoningTokens) {
  if (!hasReasoningTokens) {
    return item('未记录', '无单独字段', '当前来源没有单独记录 reasoning tokens。不要用 0% 判断任务不复杂。', 'neutral');
  }
  const v = finite(value);
  if (v < 2) {
    return item('普通任务', '0-2%', '推理 token 占比较低，多数是常规生成、编辑或短链路问题。', 'ok');
  }
  if (v < 10) {
    return item('复杂推理', '2-10%', '模型在做多步判断。适合调试、方案权衡、较复杂实现。', 'warn');
  }
  return item('深度推理', '10%+', '推理成本较高。只在架构决策、复杂 bug、发布前审查等高价值任务中保留。', 'risk');
}

function item(label, range, advice, tone) {
  return {
    label,
    range,
    advice,
    tone,
    source: '本地复盘建议区间，不是官方统一 benchmark'
  };
}

function finite(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
