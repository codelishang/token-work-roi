const STORAGE_KEY = 'token-work.annotation-presets.v1';
const MAX_RECENT_PROJECTS = 8;
const TEMPLATE_FIELDS = ['projectAlias', 'taskType', 'outputStatus', 'workPurpose', 'workStage', 'valueLevel'];

export const EMPTY_ANNOTATION_PRESETS = {
  recentProjects: [],
  lastTemplate: null
};

export const QUICK_ANNOTATION_TEMPLATES = [
  {
    id: 'explore-validate',
    label: '探索验证',
    description: '调研、测试、上下文整理',
    values: {
      taskType: '技术调研',
      outputStatus: '进行中',
      workPurpose: '技术调研',
      workStage: '探索',
      valueLevel: '中'
    }
  },
  {
    id: 'build-feature',
    label: '功能实现',
    description: '开发或修复中的有效工作',
    values: {
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '高'
    }
  },
  {
    id: 'ship-output',
    label: '发布产出',
    description: '已发布、可展示或可复用',
    values: {
      taskType: '功能开发',
      outputStatus: '已发布',
      workPurpose: '功能开发',
      workStage: '发布',
      valueLevel: '关键'
    }
  },
  {
    id: 'stop-loss',
    label: '废弃止损',
    description: '方向不继续投入',
    values: {
      taskType: '技术调研',
      outputStatus: '已废弃',
      workPurpose: '技术调研',
      workStage: '探索',
      valueLevel: '低'
    }
  }
];

export function readAnnotationPresets(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_ANNOTATION_PRESETS };
    return normalizePresetState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_ANNOTATION_PRESETS };
  }
}

export function writeAnnotationPresets(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(normalizePresetState(state)));
  } catch {
    // Presets are convenience-only. Ignore storage failures in private modes.
  }
}

export function rememberAnnotationPreset(state, values = {}) {
  const current = normalizePresetState(state);
  const template = normalizeTemplate(values);
  const projectAlias = template.projectAlias;
  const recentProjects = projectAlias
    ? [projectAlias, ...current.recentProjects.filter(item => item !== projectAlias)].slice(0, MAX_RECENT_PROJECTS)
    : current.recentProjects;

  return {
    recentProjects,
    lastTemplate: hasTemplateValues(template) ? template : current.lastTemplate
  };
}

export function applyAnnotationTemplate(form, template, { includeProjectAlias = true } = {}) {
  if (!template) return { ...form };
  const next = { ...form };
  for (const field of TEMPLATE_FIELDS) {
    if (field === 'projectAlias' && !includeProjectAlias) continue;
    if (template[field]) next[field] = template[field];
  }
  return next;
}

function normalizePresetState(value = {}) {
  const recentProjects = Array.isArray(value.recentProjects)
    ? uniqueStrings(value.recentProjects).slice(0, MAX_RECENT_PROJECTS)
    : [];
  const lastTemplate = value.lastTemplate ? normalizeTemplate(value.lastTemplate) : null;
  return {
    recentProjects,
    lastTemplate: lastTemplate && hasTemplateValues(lastTemplate) ? lastTemplate : null
  };
}

function normalizeTemplate(values = {}) {
  const template = {};
  for (const field of TEMPLATE_FIELDS) {
    const value = normalizeText(values[field]);
    if (value) template[field] = value;
  }
  return template;
}

function hasTemplateValues(template = {}) {
  return TEMPLATE_FIELDS.some(field => Boolean(template[field]));
}

function uniqueStrings(values = []) {
  const out = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}
