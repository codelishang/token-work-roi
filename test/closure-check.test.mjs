import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildClosureAuditFromDb,
  buildClosureImportTemplate,
  formatClosureAudit,
  formatClosureImportTemplate,
  formatClosureWorklist,
  openReadOnlyDb,
  parseArgs
} from '../src/closure-check.mjs';
import {
  openDb,
  upsertDaily,
  upsertSession,
  upsertSessionAnnotation,
  upsertSessionOutput
} from '../src/db.mjs';

test('buildClosureAuditFromDb reports complete P0 gate from structured data', () => withDb((db) => {
  seedCompleteClosureData(db);

  const audit = buildClosureAuditFromDb(db, { dbPath: 'temp.sqlite' });
  assert.equal(audit.status, 'complete');
  assert.equal(audit.counts.sessions, 10);
  assert.equal(audit.counts.annotations, 10);
  assert.equal(audit.counts.outputs, 3);
  assert.equal(audit.progress.checks.find(check => check.id === 'real-attribution').complete, true);
  assert.equal(audit.progress.checks.find(check => check.id === 'output-links').complete, true);
  assert.equal(audit.progress.checks.find(check => check.id === 'non-label-advice').complete, true);
  assert.equal(audit.roiAdvice.some(item => item.category !== '补标注'), true);
  assert.equal(audit.progress.annotatedSessions[0].project, 'Token Work');
  assert.equal('note' in audit.progress.annotatedSessions[0], false);
}));

test('formatClosureAudit includes gaps and privacy boundary without conversation content', () => withDb((db) => {
  upsertSession(db, {
    device: 'local',
    source: 'Codex CLI',
    sessionId: 'gap-1',
    projectPath: 'D:/Projects/token-work-roi',
    inputTokens: 2000,
    outputTokens: 100,
    totalTokens: 2100,
    costUSD: 2
  });

  const audit = buildClosureAuditFromDb(db, { dbPath: 'temp.sqlite' });
  const text = formatClosureAudit(audit);
  assert.equal('session' in audit.progress.topGaps[0], false);
  assert.match(text, /Status: needs-work/);
  assert.match(text, /Top gaps:/);
  assert.match(text, /missing 项目别名, 任务类型, 产出状态, 工作目的, 工作阶段, 产出价值/);
  assert.match(text, /Privacy: read-only SQLite audit/);
  assert.equal(text.includes('对话正文'), false);
}));

test('formatClosureWorklist prints fillable rows and escapes markdown formula cells', () => withDb((db) => {
  upsertSession(db, {
    device: 'local',
    source: 'Codex CLI',
    sessionId: '=session',
    projectPath: '+project|name',
    inputTokens: 2000,
    outputTokens: 100,
    totalTokens: 2100,
    costUSD: 2
  });

  const audit = buildClosureAuditFromDb(db, { dbPath: 'temp.sqlite', topGapLimit: 10 });
  const text = formatClosureWorklist(audit, { limit: 10 });
  assert.match(text, /^# Token Work P0 Attribution Worklist/);
  assert.match(text, /Project alias \| Task type \| Output status/);
  assert.match(text, /'\+project\\\|name/);
  assert.match(text, /'\=session/);
  assert.match(text, /Privacy: no conversation content/);
  assert.equal(text.includes('conversation body'), false);
}));

test('formatClosureImportTemplate prints import-ready blank JSON for real gaps', () => withDb((db) => {
  upsertSession(db, {
    device: 'local',
    source: 'Codex CLI',
    sessionId: '=session',
    projectPath: '+project|name',
    inputTokens: 2000,
    outputTokens: 100,
    totalTokens: 2100,
    costUSD: 2
  });

  const audit = buildClosureAuditFromDb(db, { dbPath: 'temp.sqlite', topGapLimit: 10 });
  const template = buildClosureImportTemplate(audit, { limit: 10 });
  const text = formatClosureImportTemplate(audit, { limit: 10 });
  const parsed = JSON.parse(text);

  assert.equal(template.sessions.length, 1);
  assert.equal(template.sessions[0].device, 'local');
  assert.equal(template.sessions[0].source, 'Codex CLI');
  assert.equal(template.sessions[0].sessionId, '=session');
  assert.equal(template.sessions[0].projectAlias, '');
  assert.equal(template.sessions[0].taskType, '');
  assert.equal(template.sessions[0].outputUrl, '');
  assert.deepEqual(template.allowedValues.taskType.includes('功能开发'), true);
  assert.equal(parsed.sessions[0].sessionId, '=session');
  assert.match(text, /No conversation content was read/);
  assert.equal(text.includes('conversation body'), false);
}));

test('parseArgs supports json and closure gate options', () => {
  const options = parseArgs([
    '--db', 'custom.sqlite',
    '--json',
    '--worklist',
    '--template-json',
    '--out=labels.json',
    '--limit=8',
    '--fail-on-incomplete',
    '--target-sessions=12',
    '--target-outputs=4'
  ]);

  assert.equal(options.dbPath, 'custom.sqlite');
  assert.equal(options.json, true);
  assert.equal(options.worklist, true);
  assert.equal(options.templateJson, true);
  assert.equal(options.outPath, 'labels.json');
  assert.equal(options.worklistLimit, 8);
  assert.equal(options.topGapLimit, 8);
  assert.equal(options.failOnIncomplete, true);
  assert.equal(options.targetAttributedSessions, 12);
  assert.equal(options.targetOutputLinks, 4);
});

test('openReadOnlyDb rejects missing database instead of creating one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-missing-db-'));
  const dbPath = join(dir, 'missing.sqlite');
  try {
    assert.throws(() => openReadOnlyDb(dbPath), /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-closure-check-'));
  const dbPath = join(dir, 'usage.sqlite');
  const db = openDb(dbPath);
  try {
    return fn(db, dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedCompleteClosureData(db) {
  upsertDaily(db, {
    device: 'local',
    source: 'Codex CLI',
    usageDate: '2026-06-12',
    model: 'gpt-5.3-codex',
    inputTokens: 130000,
    outputTokens: 10000,
    totalTokens: 140000,
    costUSD: 1
  });

  for (let index = 0; index < 10; index += 1) {
    const session = {
      device: 'local',
      source: 'Codex CLI',
      sessionId: `complete-${index + 1}`,
      projectPath: 'D:/Projects/token-work-roi',
      inputTokens: 13000,
      outputTokens: 800,
      totalTokens: 13800,
      costUSD: 1 + index / 10
    };
    upsertSession(db, session);
    upsertSessionAnnotation(db, {
      ...session,
      projectAlias: 'Token Work',
      taskType: '功能开发',
      outputStatus: index < 3 ? '已发布' : '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '高'
    });
    if (index < 3) {
      upsertSessionOutput(db, {
        ...session,
        outputUrl: `https://example.com/output/${index + 1}`,
        outputLabel: `Output ${index + 1}`,
        outputType: '文档'
      });
    }
  }
}
