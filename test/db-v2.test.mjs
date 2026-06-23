import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  batchUpsertSessionAnnotations,
  deleteProjectAliasRule,
  deleteSessionOutput,
  exportAnnotationData,
  importAnnotationData,
  listProjectAliasRules,
  matchProjectAliasRule,
  openDb,
  upsertProjectAliasRule,
  upsertSession,
  upsertSessionAnnotation,
  upsertSessionOutput
} from '../src/db.mjs';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-db-'));
  const dbPath = join(dir, 'usage.sqlite');
  const db = openDb(dbPath);
  try {
    seedSessions(db);
    fn(db, dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedSessions(db) {
  for (const row of [
    {
      device: 'devbox',
      source: 'Codex CLI',
      sessionId: 'codex:one',
      lastActivity: '2026-06-10T01:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\TokenWork',
      totalTokens: 500,
      costUSD: 0.05
    },
    {
      device: 'devbox',
      source: 'Claude Code',
      sessionId: 'claude:two',
      lastActivity: '2026-06-10T02:00:00.000Z',
      projectPath: 'D:\\HighROIProjects\\Other',
      totalTokens: 100,
      costUSD: 0.01
    }
  ]) {
    upsertSession(db, row);
  }
}

test('v2 schema migration is repeatable', () => withDb((db, dbPath) => {
  const reopened = openDb(dbPath);
  try {
    const tables = reopened.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('project_alias_rules', 'session_outputs')
      ORDER BY name
    `).all().map(row => row.name);
    assert.deepEqual(tables, ['project_alias_rules', 'session_outputs']);
    const annotationColumns = reopened.prepare('PRAGMA table_info(session_annotations)').all().map(row => row.name);
    const outputColumns = reopened.prepare('PRAGMA table_info(session_outputs)').all().map(row => row.name);
    assert.equal(annotationColumns.includes('work_purpose'), true);
    assert.equal(annotationColumns.includes('work_stage'), true);
    assert.equal(annotationColumns.includes('value_level'), true);
    assert.equal(outputColumns.includes('output_type'), true);
  } finally {
    reopened.close();
  }
}));

test('project alias rules match by prefix and can be disabled', () => withDb((db) => {
  const rule = upsertProjectAliasRule(db, {
    pattern: 'D:\\HighROIProjects\\TokenWork',
    matchType: 'prefix',
    projectAlias: 'Token Work',
    enabled: true
  });

  assert.equal(matchProjectAliasRule('D:\\HighROIProjects\\TokenWork\\src', [rule]), 'Token Work');

  const disabled = upsertProjectAliasRule(db, { ...rule, enabled: false });
  assert.equal(matchProjectAliasRule('D:\\HighROIProjects\\TokenWork\\src', [disabled]), null);
  assert.equal(listProjectAliasRules(db)[0].enabled, false);

  assert.equal(deleteProjectAliasRule(db, { id: rule.id }), 1);
}));

test('session outputs upsert and delete by session identity', () => withDb((db) => {
  const saved = upsertSessionOutput(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex:one',
    outputUrl: 'https://github.com/example/repo/pull/42',
    outputLabel: 'PR #42',
    outputType: 'PR'
  });

  assert.equal(saved.outputUrl, 'https://github.com/example/repo/pull/42');
  assert.equal(saved.outputLabel, 'PR #42');
  assert.equal(saved.outputType, 'PR');
  assert.throws(() => upsertSessionOutput(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex:one',
    outputUrl: 'file:///secret.txt'
  }), /http or https/);

  assert.equal(deleteSessionOutput(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex:one'
  }), 1);
}));

test('batch annotation only changes selected sessions', () => withDb((db) => {
  const result = batchUpsertSessionAnnotations(db, {
    sessions: [{ device: 'devbox', source: 'Codex CLI', sessionId: 'codex:one' }],
    values: { taskType: '功能开发', outputStatus: '已完成', workPurpose: '调试修复', workStage: '验证', valueLevel: '中', note: '批量标注' }
  });
  assert.equal(result.updated, 1);

  const rows = db.prepare(`
    SELECT source, task_type AS taskType, output_status AS outputStatus,
      work_purpose AS workPurpose, work_stage AS workStage, value_level AS valueLevel, note
    FROM session_annotations
    ORDER BY source
  `).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'Codex CLI');
  assert.equal(rows[0].taskType, '功能开发');
  assert.equal(rows[0].outputStatus, '已完成');
  assert.equal(rows[0].workPurpose, '调试修复');
  assert.equal(rows[0].workStage, '验证');
  assert.equal(rows[0].valueLevel, '中');
  assert.equal(rows[0].note, '批量标注');
}));

test('annotation export and import round-trip v3 data', () => withDb((db) => {
  upsertSessionAnnotation(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex:one',
    projectAlias: 'Token Work',
    taskType: '功能开发',
    outputStatus: '已发布',
    workPurpose: '功能开发',
    workStage: '发布',
    valueLevel: '关键'
  });
  upsertSessionOutput(db, {
    device: 'devbox',
    source: 'Codex CLI',
    sessionId: 'codex:one',
    outputUrl: 'https://example.com/token-work',
    outputLabel: 'Demo',
    outputType: '部署'
  });
  upsertProjectAliasRule(db, {
    pattern: 'D:\\HighROIProjects\\TokenWork',
    matchType: 'prefix',
    projectAlias: 'Token Work',
    enabled: true
  });

  const exported = exportAnnotationData(db);
  assert.equal(exported.version, 3);
  assert.equal(exported.sessionAnnotations.length, 1);
  assert.equal(exported.sessionAnnotations[0].workPurpose, '功能开发');
  assert.equal(exported.sessionAnnotations[0].workStage, '发布');
  assert.equal(exported.sessionAnnotations[0].valueLevel, '关键');
  assert.equal(exported.sessionOutputs.length, 1);
  assert.equal(exported.sessionOutputs[0].outputType, '部署');
  assert.equal(exported.projectAliasRules.length, 1);

  db.prepare('DELETE FROM session_annotations').run();
  db.prepare('DELETE FROM session_outputs').run();
  db.prepare('DELETE FROM project_alias_rules').run();

  const imported = importAnnotationData(db, exported);
  assert.deepEqual(imported, {
    sessionAnnotations: 1,
    sessionOutputs: 1,
    projectAliasRules: 1
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 1);
  const importedAnnotation = db.prepare('SELECT work_purpose AS workPurpose, work_stage AS workStage, value_level AS valueLevel FROM session_annotations').get();
  const importedOutput = db.prepare('SELECT output_type AS outputType FROM session_outputs').get();
  assert.equal(importedAnnotation.workPurpose, '功能开发');
  assert.equal(importedAnnotation.workStage, '发布');
  assert.equal(importedAnnotation.valueLevel, '关键');
  assert.equal(importedOutput.outputType, '部署');
}));
