import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyAutoSessionAnnotations,
  deleteSessionAnnotation,
  openDb,
  undoAutoSessionAnnotations,
  upsertSession,
  upsertSessionAnnotation
} from '../src/db.mjs';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-db-'));
  const db = openDb(join(dir, 'usage.sqlite'));
  try {
    upsertSession(db, {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'local:codex:D:\\Project:codex-mini',
      lastActivity: '2026-06-10T01:00:00.000Z',
      projectPath: 'D:\\Project',
      inputTokens: 100,
      outputTokens: 30,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 165,
      costUSD: 0.01
    });
    fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('session annotation upsert stores normalized values', () => withDb((db) => {
  const saved = upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    projectAlias: '  AI 选题雷达  ',
    taskType: '功能开发',
    outputStatus: '已完成',
    workPurpose: '方案设计',
    workStage: '实现',
    valueLevel: '高',
    note: '  首版归因  UI  '
  });

  assert.equal(saved.projectAlias, 'AI 选题雷达');
  assert.equal(saved.taskType, '功能开发');
  assert.equal(saved.outputStatus, '已完成');
  assert.equal(saved.workPurpose, '方案设计');
  assert.equal(saved.workStage, '实现');
  assert.equal(saved.valueLevel, '高');
  assert.equal(saved.note, '首版归因 UI');
  assert.equal(saved.annotationSource, 'manual');
  assert.equal(saved.annotationConfidence, 100);
  assert.ok(saved.annotationUpdatedAt);
}));

test('session annotation defaults stay explicit', () => withDb((db) => {
  const saved = upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    projectAlias: '',
    note: ''
  });

  assert.equal(saved.projectAlias, null);
  assert.equal(saved.taskType, '未分类');
  assert.equal(saved.outputStatus, '未标注');
  assert.equal(saved.workPurpose, '未说明');
  assert.equal(saved.workStage, '未说明');
  assert.equal(saved.valueLevel, '未评估');
  assert.equal(saved.note, null);
  assert.equal(saved.annotationSource, 'manual');
  assert.equal(saved.annotationConfidence, 100);
}));

test('session annotation validates enums and length', () => withDb((db) => {
  assert.throws(() => upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    taskType: '随便填'
  }), /taskType must be one of/);

  assert.throws(() => upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    valueLevel: '爆款'
  }), /valueLevel must be one of/);

  assert.throws(() => upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    note: 'x'.repeat(501)
  }), /note must be 500 characters or less/);

  assert.throws(() => upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    annotationSource: 'guessed'
  }), /annotationSource must be one of/);

  assert.throws(() => upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    annotationSource: 'auto',
    annotationConfidence: 101
  }), /annotationConfidence must be an integer/);
}));

test('session annotation delete is scoped by identity', () => withDb((db) => {
  upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    taskType: '问题修复'
  });

  const deleted = deleteSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini'
  });

  assert.equal(deleted, 1);
  const remaining = db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get();
  assert.equal(remaining.total, 0);
}));

test('auto annotations write provenance, protect manual rows, and undo by run id', () => withDb((db) => {
  const first = applyAutoSessionAnnotations(db, [{
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    values: {
      projectAlias: 'Project',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '中'
    },
    annotationConfidence: 85,
    annotationReason: '路径和产出链接命中',
    autoVersion: 'v1.0.0'
  }], { runId: 'auto-test', threshold: 80 });

  assert.equal(first.applied, 1);
  const auto = db.prepare('SELECT annotation_source AS source, annotation_confidence AS confidence, auto_run_id AS runId FROM session_annotations').get();
  assert.equal(auto.source, 'auto');
  assert.equal(auto.confidence, 85);
  assert.equal(auto.runId, 'auto-test');

  upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    taskType: '问题修复'
  });

  const protectedResult = applyAutoSessionAnnotations(db, [{
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'local:codex:D:\\Project:codex-mini',
    values: { taskType: '功能开发' },
    annotationConfidence: 90
  }], { runId: 'auto-test-2', threshold: 80 });
  assert.equal(protectedResult.applied, 0);
  assert.equal(protectedResult.skippedProtected, 1);

  assert.equal(undoAutoSessionAnnotations(db, { runId: 'auto-test' }), 0);
  assert.equal(db.prepare('SELECT task_type AS taskType, annotation_source AS source FROM session_annotations').get().taskType, '问题修复');
}));
