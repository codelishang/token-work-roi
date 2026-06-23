import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAnnotationTemplate,
  QUICK_ANNOTATION_TEMPLATES,
  readAnnotationPresets,
  rememberAnnotationPreset,
  writeAnnotationPresets
} from '../src/client/dashboard/annotation-presets.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    }
  };
}

test('rememberAnnotationPreset stores only structured fields and recent projects', () => {
  const state = rememberAnnotationPreset({}, {
    projectAlias: 'Token Work',
    taskType: '功能开发',
    outputStatus: '已完成',
    workPurpose: '功能开发',
    workStage: '验证',
    valueLevel: '高',
    note: 'do not store free text',
    outputUrl: 'https://example.com/private'
  });

  assert.deepEqual(state.recentProjects, ['Token Work']);
  assert.equal(state.lastTemplate.projectAlias, 'Token Work');
  assert.equal(state.lastTemplate.taskType, '功能开发');
  assert.equal(state.lastTemplate.note, undefined);
  assert.equal(state.lastTemplate.outputUrl, undefined);
});

test('rememberAnnotationPreset deduplicates and limits recent projects', () => {
  let state = {};
  for (const project of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'A']) {
    state = rememberAnnotationPreset(state, { projectAlias: project });
  }

  assert.deepEqual(state.recentProjects, ['A', 'I', 'H', 'G', 'F', 'E', 'D', 'C']);
});

test('applyAnnotationTemplate merges template fields without clearing other form data', () => {
  const form = {
    projectAlias: '',
    taskType: '未分类',
    outputStatus: '未标注',
    workPurpose: '未说明',
    workStage: '未说明',
    valueLevel: '未评估',
    note: 'keep note',
    outputUrl: 'https://example.com/output'
  };
  const next = applyAnnotationTemplate(form, {
    projectAlias: 'Token Work',
    taskType: '问题修复',
    outputStatus: '已完成',
    workPurpose: '调试修复',
    workStage: '验证',
    valueLevel: '中'
  });

  assert.equal(next.projectAlias, 'Token Work');
  assert.equal(next.taskType, '问题修复');
  assert.equal(next.note, 'keep note');
  assert.equal(next.outputUrl, 'https://example.com/output');
});

test('quick annotation templates cover common review decisions without free text', () => {
  assert.deepEqual(QUICK_ANNOTATION_TEMPLATES.map(item => item.id), [
    'explore-validate',
    'build-feature',
    'ship-output',
    'stop-loss'
  ]);
  for (const template of QUICK_ANNOTATION_TEMPLATES) {
    assert.equal(template.values.note, undefined);
    assert.equal(template.values.outputUrl, undefined);
    assert.equal(template.values.outputLabel, undefined);
  }
});

test('quick annotation templates can apply without overwriting project or output data', () => {
  const form = {
    projectAlias: 'Token Work',
    taskType: '未分类',
    outputStatus: '未标注',
    workPurpose: '未说明',
    workStage: '未说明',
    valueLevel: '未评估',
    note: 'keep real note',
    outputUrl: 'https://example.com/pr/1',
    outputLabel: 'PR #1'
  };
  const next = applyAnnotationTemplate(
    form,
    QUICK_ANNOTATION_TEMPLATES.find(item => item.id === 'ship-output').values,
    { includeProjectAlias: false }
  );

  assert.equal(next.projectAlias, 'Token Work');
  assert.equal(next.outputStatus, '已发布');
  assert.equal(next.workStage, '发布');
  assert.equal(next.valueLevel, '关键');
  assert.equal(next.note, 'keep real note');
  assert.equal(next.outputUrl, 'https://example.com/pr/1');
  assert.equal(next.outputLabel, 'PR #1');
});

test('readAnnotationPresets tolerates broken storage data', () => {
  const storage = memoryStorage({ 'token-work.annotation-presets.v1': '{bad json' });
  const state = readAnnotationPresets(storage);

  assert.deepEqual(state.recentProjects, []);
  assert.equal(state.lastTemplate, null);
});

test('writeAnnotationPresets round-trips normalized state', () => {
  const storage = memoryStorage();
  const state = rememberAnnotationPreset({}, {
    projectAlias: 'Token Work',
    taskType: '功能开发'
  });
  writeAnnotationPresets(state, storage);

  const loaded = readAnnotationPresets(storage);
  assert.deepEqual(loaded.recentProjects, ['Token Work']);
  assert.equal(loaded.lastTemplate.taskType, '功能开发');
});
