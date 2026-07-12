export function providerFromSource(source) {
  const value = String(source || '').toLowerCase();
  if (value.includes('kimi') || value.includes('moonshot')) return 'Kimi';
  if (value.includes('codex') || value.includes('openai')) return 'openai';
  if (value.includes('grok') || /\bx[._-]?ai\b/.test(value)) return 'xai';
  if (value.includes('claude') || value.includes('anthropic')) return 'anthropic';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('mimo') || value.includes('xiaomi')) return 'xiaomi';
  if (value.includes('glm') || value.includes('zai') || value.includes('zhipu') || value.includes('bigmodel')) return 'Zhipu GLM';
  if (value.includes('doubao') || /\bark\b/.test(value) || value.includes('volc') || value.includes('bytedance')) return 'DoubaoSeed';
  if (value.includes('qwen') || value.includes('tongyi') || value.includes('aliyun') || value.includes('alibaba') || value.includes('dashscope')) return 'Qwen';
  return null;
}
