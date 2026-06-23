import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyClosureImport,
  buildClosureFillGuide,
  buildClosureImportReport,
  formatApplyValidResult,
  formatClosureFillGuide,
  formatImportReport,
  formatImportPlan,
  loadClosureImportFile,
  parseImportArgs,
  planClosureImport,
  planValidClosureImport
} from '../src/closure-import.mjs';
import { openDb, upsertSession } from '../src/db.mjs';

const baseSession = {
  device: 'local',
  source: 'Codex CLI',
  sessionId: 'session-1',
  projectPath: 'D:/Projects/token-work-roi',
  inputTokens: 1000,
  outputTokens: 100,
  totalTokens: 1100,
  costUSD: 1
};

const filledRow = {
  sessionId: 'session-1',
  projectAlias: 'Token Work',
  taskType: '功能开发',
  outputStatus: '已发布',
  workPurpose: '功能开发',
  workStage: '发布',
  valueLevel: '高',
  note: '真实标注',
  outputUrl: 'https://example.com/pr/1',
  outputLabel: 'PR #1',
  outputType: 'PR'
};

test('planClosureImport validates filled rows without writing SQLite', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  const plan = planClosureImport(db, [filledRow]);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.annotationCount, 1);
  assert.equal(plan.outputCount, 1);
  assert.equal(plan.sessions[0].device, 'local');
  assert.equal(plan.sessions[0].hasOutput, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get().total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 0);
}));

test('applyClosureImport writes labels only after explicit apply and creates backup', () => withDb(({ db, dbPath, dir }) => {
  upsertSession(db, baseSession);
  const plan = planClosureImport(db, [filledRow]);
  const result = applyClosureImport(db, plan, { dbPath, backupDir: join(dir, 'backups') });

  assert.equal(result.applied, true);
  assert.equal(result.annotationCount, 1);
  assert.equal(result.outputCount, 1);
  assert.equal(existsSync(result.backup.path), true);

  const annotation = db.prepare('SELECT project_alias AS projectAlias, value_level AS valueLevel FROM session_annotations').get();
  const output = db.prepare('SELECT output_url AS outputUrl, output_type AS outputType FROM session_outputs').get();
  assert.equal(annotation.projectAlias, 'Token Work');
  assert.equal(annotation.valueLevel, '高');
  assert.equal(output.outputUrl, 'https://example.com/pr/1');
  assert.equal(output.outputType, 'PR');
}));

test('planClosureImport rejects partial labels and invalid output status for links', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  assert.throws(() => planClosureImport(db, [{ ...filledRow, valueLevel: '未评估' }]), /valueLevel/);
  assert.throws(() => planClosureImport(db, [{ ...filledRow, outputStatus: '进行中' }]), /outputUrl requires/);
  assert.throws(() => planClosureImport(db, [{ ...filledRow, taskType: '不存在' }]), /taskType must be one of/);
}));

test('buildClosureImportReport returns every invalid row without writing SQLite', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  upsertSession(db, { ...baseSession, sessionId: 'session-2' });

  const report = buildClosureImportReport(db, [
    { ...filledRow, valueLevel: '未评估' },
    { ...filledRow, sessionId: 'session-2', outputStatus: '进行中' },
    { ...filledRow, sessionId: 'missing-session' }
  ]);
  const text = formatImportReport(report);

  assert.equal(report.mode, 'report');
  assert.equal(report.valid, false);
  assert.equal(report.rowCount, 3);
  assert.equal(report.validCount, 0);
  assert.equal(report.errorCount, 3);
  assert.match(report.errors[0].error, /valueLevel/);
  assert.match(report.errors[1].error, /outputUrl requires/);
  assert.match(report.errors[2].error, /does not exist/);
  assert.match(text, /Invalid: 3/);
  assert.match(text, /does not run collect, write SQLite, or read conversation content/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get().total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 0);
}));

test('buildClosureImportReport reports a valid filled file', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  const report = buildClosureImportReport(db, [filledRow]);
  const text = formatImportReport(report);

  assert.equal(report.valid, true);
  assert.equal(report.validCount, 1);
  assert.equal(report.errorCount, 0);
  assert.equal(report.outputCount, 1);
  assert.match(text, /All rows are valid/);
}));

test('buildClosureFillGuide prints missing fields and enum choices without writing', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  const guide = buildClosureFillGuide(db, [{
    ...baseSession,
    projectHint: 'Token Work',
    officialCostUSD: 1,
    projectAlias: '',
    taskType: '',
    outputStatus: '',
    workPurpose: '',
    workStage: '',
    valueLevel: ''
  }]);
  const text = formatClosureFillGuide(guide);

  assert.equal(guide.mode, 'fill-guide');
  assert.equal(guide.readyCount, 0);
  assert.equal(guide.needsInputCount, 1);
  assert.equal(guide.rows[0].missingFields.includes('projectAlias'), true);
  assert.equal(guide.allowedValues.taskType.includes('功能开发'), true);
  assert.match(text, /Token Work Closure Fill Guide/);
  assert.match(text, /taskType: 未分类 \/ 功能开发/);
  assert.match(text, /fill required fields/);
  assert.match(text, /no collect, no SQLite writes, no conversation content/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get().total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 0);
}));

test('buildClosureFillGuide reports no rows when labels are complete', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  const guide = buildClosureFillGuide(db, [filledRow]);
  const text = formatClosureFillGuide(guide);

  assert.equal(guide.readyCount, 1);
  assert.equal(guide.needsInputCount, 0);
  assert.equal(guide.rows.length, 0);
  assert.match(text, /No rows need input/);
}));

test('planValidClosureImport writes valid rows and skips invalid rows', () => withDb(({ db, dbPath, dir }) => {
  upsertSession(db, baseSession);
  upsertSession(db, { ...baseSession, sessionId: 'session-2' });

  const plan = planValidClosureImport(db, [
    filledRow,
    { ...filledRow, sessionId: 'session-2', valueLevel: '未评估' }
  ]);
  const result = applyClosureImport(db, plan, {
    dbPath,
    backupDir: join(dir, 'backups'),
    mode: 'apply-valid',
    reason: 'closure-import-valid'
  });
  const text = formatApplyValidResult(plan, result);

  assert.equal(plan.annotationCount, 1);
  assert.equal(plan.outputCount, 1);
  assert.equal(plan.skippedCount, 1);
  assert.equal(result.mode, 'apply-valid');
  assert.equal(result.applied, true);
  assert.equal(existsSync(result.backup.path), true);
  assert.match(text, /Applied annotations: 1/);
  assert.match(text, /Skipped invalid rows: 1/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get().total, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 1);
}));

test('planValidClosureImport does not write or back up when no rows are valid', () => withDb(({ db, dbPath, dir }) => {
  upsertSession(db, baseSession);

  const plan = planValidClosureImport(db, [{ ...filledRow, valueLevel: '未评估' }]);
  const result = applyClosureImport(db, plan, {
    dbPath,
    backupDir: join(dir, 'backups'),
    mode: 'apply-valid',
    reason: 'closure-import-valid'
  });
  const text = formatApplyValidResult(plan, result);

  assert.equal(plan.annotationCount, 0);
  assert.equal(plan.skippedCount, 1);
  assert.equal(result.applied, false);
  assert.equal(result.backup, null);
  assert.match(text, /No valid rows were found/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_annotations').get().total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM session_outputs').get().total, 0);
}));

test('planClosureImport requires device and source for ambiguous session ids', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  upsertSession(db, { ...baseSession, device: 'other', source: 'Claude Code' });

  assert.throws(() => planClosureImport(db, [filledRow]), /ambiguous/);
  const plan = planClosureImport(db, [{ ...filledRow, device: 'local', source: 'Codex CLI' }]);
  assert.equal(plan.sessions[0].source, 'Codex CLI');
}));

test('loadClosureImportFile and parseImportArgs support dry-run workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-closure-import-file-'));
  try {
    const filePath = join(dir, 'labels.json');
    writeFileSync(filePath, JSON.stringify({ sessions: [filledRow] }), 'utf8');
    const loaded = loadClosureImportFile(filePath);
    const args = parseImportArgs(['--file', filePath, '--db=usage.sqlite', '--json', '--report', '--limit=3']);

    assert.equal(loaded.rows.length, 1);
    assert.equal(args.file, filePath);
    assert.equal(args.dbPath, 'usage.sqlite');
    assert.equal(args.json, true);
    assert.equal(args.report, true);
    assert.equal(args.limit, 3);
    assert.equal(parseImportArgs(['--file', filePath, '--fill-guide']).fillGuide, true);
    assert.equal(parseImportArgs(['--file', filePath, '--apply-valid']).applyValid, true);
    assert.equal(args.apply, false);
    assert.throws(() => parseImportArgs(['--file', filePath, '--report', '--apply']), /cannot be combined/);
    assert.throws(() => parseImportArgs(['--file', filePath, '--report', '--apply-valid']), /cannot be combined/);
    assert.throws(() => parseImportArgs(['--file', filePath, '--fill-guide', '--apply-valid']), /cannot be combined/);
    assert.throws(() => parseImportArgs(['--file', filePath, '--limit=0']), /positive integer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatImportPlan makes dry-run status explicit', () => withDb(({ db }) => {
  upsertSession(db, baseSession);
  const plan = planClosureImport(db, [filledRow]);
  const text = formatImportPlan(plan);
  assert.match(text, /Mode: dry-run/);
  assert.match(text, /Dry run only/);
  assert.match(text, /does not run collect or read conversation content/);
}));

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-closure-import-'));
  const dbPath = join(dir, 'usage.sqlite');
  const db = openDb(dbPath);
  try {
    return fn({ db, dbPath, dir });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
