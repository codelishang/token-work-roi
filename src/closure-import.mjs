import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  OUTPUT_STATUSES,
  OUTPUT_TYPES,
  TASK_TYPES,
  VALUE_LEVELS,
  WORK_PURPOSES,
  WORK_STAGES,
  defaultDbPath,
  normalizeSessionAnnotation,
  normalizeSessionOutput,
  openDb,
  upsertSessionAnnotation,
  upsertSessionOutput
} from './db.mjs';

const PRODUCTIVE_STATUSES = new Set(['已完成', '已发布']);

export function parseImportArgs(argv = process.argv.slice(2)) {
  const options = {
    dbPath: process.env.DB_PATH || defaultDbPath,
    file: null,
    apply: false,
    applyValid: false,
    fillGuide: false,
    report: false,
    limit: 10,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--apply-valid') {
      options.applyValid = true;
      continue;
    }
    if (arg === '--report') {
      options.report = true;
      continue;
    }
    if (arg === '--fill-guide') {
      options.fillGuide = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--db') {
      options.dbPath = argv[++i];
      continue;
    }
    if (arg.startsWith('--db=')) {
      options.dbPath = arg.slice('--db='.length);
      continue;
    }
    if (arg === '--file') {
      options.file = argv[++i];
      continue;
    }
    if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length);
      continue;
    }
    if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[++i], 'limit');
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), 'limit');
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const writeModes = [options.apply, options.applyValid, options.report, options.fillGuide].filter(Boolean).length;
  if (writeModes > 1) {
    throw new Error('--apply, --apply-valid, --report, and --fill-guide cannot be combined');
  }

  return options;
}

export function loadClosureImportFile(filePath) {
  if (!filePath) throw new Error('--file is required');
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) throw new Error(`Import file not found: ${resolved}`);
  const payload = JSON.parse(readFileSync(resolved, 'utf8'));
  const rows = Array.isArray(payload) ? payload : payload.sessions;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Import JSON must be an array or an object with a non-empty sessions array');
  }
  return { filePath: resolved, rows };
}

export function planClosureImport(db, rows = []) {
  const planned = rows.map((row, index) => normalizeImportRow(db, row, index));
  return {
    mode: 'dry-run',
    rowCount: planned.length,
    annotationCount: planned.length,
    outputCount: planned.filter(item => item.output).length,
    sessions: planned.map(item => ({
      index: item.index,
      device: item.annotation.device,
      source: item.annotation.source,
      sessionId: item.annotation.sessionId,
      projectAlias: item.annotation.projectAlias,
      taskType: item.annotation.taskType,
      outputStatus: item.annotation.outputStatus,
      workPurpose: item.annotation.workPurpose,
      workStage: item.annotation.workStage,
      valueLevel: item.annotation.valueLevel,
      hasOutput: Boolean(item.output)
    })),
    planned
  };
}

export function buildClosureImportReport(db, rows = []) {
  const { results, planned } = collectImportRows(db, rows);
  const invalidRows = results.filter(row => !row.valid);
  return {
    mode: 'report',
    valid: invalidRows.length === 0,
    rowCount: rows.length,
    validCount: results.length - invalidRows.length,
    errorCount: invalidRows.length,
    outputCount: planned.filter(item => item.output).length,
    sessions: results,
    errors: invalidRows.map(row => ({
      index: row.index,
      device: row.device,
      source: row.source,
      sessionId: row.sessionId,
      error: row.error
    }))
  };
}

export function planValidClosureImport(db, rows = []) {
  const { results, planned } = collectImportRows(db, rows);
  const invalidRows = results.filter(row => !row.valid);
  return {
    mode: 'apply-valid',
    rowCount: rows.length,
    annotationCount: planned.length,
    outputCount: planned.filter(item => item.output).length,
    skippedCount: invalidRows.length,
    sessions: planned.map(summarizePlannedItem),
    skipped: invalidRows.map(row => ({
      index: row.index,
      device: row.device,
      source: row.source,
      sessionId: row.sessionId,
      error: row.error
    })),
    planned
  };
}

export function buildClosureFillGuide(db, rows = [], { limit = 10 } = {}) {
  const report = buildClosureImportReport(db, rows);
  const rowLimit = Math.max(1, limit);
  const rowsToFill = report.sessions
    .filter(row => !row.valid)
    .slice(0, rowLimit)
    .map(row => ({
      ...row,
      missingFields: missingRawClosureFields(rows[row.index]),
      projectHint: normalizeText(rows[row.index]?.projectHint ?? rows[row.index]?.project_path ?? rows[row.index]?.projectPath),
      totalTokens: Number(rows[row.index]?.totalTokens ?? rows[row.index]?.total_tokens ?? 0),
      officialCostUSD: Number(rows[row.index]?.officialCostUSD ?? rows[row.index]?.official_cost_usd ?? rows[row.index]?.costUSD ?? rows[row.index]?.cost_usd ?? 0)
    }));

  return {
    mode: 'fill-guide',
    rowCount: rows.length,
    readyCount: report.validCount,
    needsInputCount: report.errorCount,
    shownCount: rowsToFill.length,
    allowedValues: allowedImportValues(),
    rows: rowsToFill,
    privacy: 'Read-only guide for user-supplied structured labels; no collect, no SQLite writes, no conversation content.'
  };
}

export function applyClosureImport(db, plan, { dbPath = defaultDbPath, backupDir = null, mode = 'apply', reason = 'closure-import' } = {}) {
  if (!plan.planned.length) {
    return {
      mode,
      applied: false,
      backup: null,
      annotationCount: 0,
      outputCount: 0,
      rowCount: plan.rowCount
    };
  }

  const backup = createDbBackup(db, dbPath, { reason, backupDir });
  db.exec('BEGIN');
  try {
    for (const item of plan.planned) {
      upsertSessionAnnotation(db, item.annotation);
      if (item.output) upsertSessionOutput(db, item.output);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    mode,
    applied: true,
    backup,
    annotationCount: plan.annotationCount,
    outputCount: plan.outputCount,
    rowCount: plan.rowCount
  };
}

export function formatImportPlan(plan, result = null) {
  const lines = [
    'Token Work Closure Import',
    '',
    `Mode: ${result?.mode || 'dry-run'}`,
    `Rows: ${plan.rowCount}`,
    `Annotations: ${plan.annotationCount}`,
    `Output links: ${plan.outputCount}`
  ];

  if (result?.backup) {
    lines.push(`Backup: ${result.backup.path}`);
  }

  lines.push('', 'Sessions:');
  for (const row of plan.sessions) {
    lines.push(`- #${row.index + 1} ${row.projectAlias} | ${row.sessionId} | ${row.taskType} / ${row.outputStatus} / ${row.workPurpose} / ${row.workStage} / ${row.valueLevel}${row.hasOutput ? ' | output' : ''}`);
  }

  if (!result) {
    lines.push('', 'Dry run only. Re-run with --apply to write labels after reviewing this plan.');
  }

  lines.push('', 'Privacy: this command imports only user-supplied structured labels; it does not run collect or read conversation content.');
  return lines.join('\n');
}

export function formatApplyValidResult(plan, result) {
  const lines = [
    'Token Work Closure Apply Valid',
    '',
    `Mode: ${result?.mode || 'apply-valid'}`,
    `Rows: ${plan.rowCount}`,
    `Applied annotations: ${plan.annotationCount}`,
    `Applied output links: ${plan.outputCount}`,
    `Skipped invalid rows: ${plan.skippedCount}`
  ];

  if (result?.backup) {
    lines.push(`Backup: ${result.backup.path}`);
  }

  if (plan.sessions.length) {
    lines.push('', 'Applied sessions:');
    for (const row of plan.sessions) {
      lines.push(`- #${row.index + 1} ${row.projectAlias} | ${row.sessionId} | ${row.taskType} / ${row.outputStatus} / ${row.workPurpose} / ${row.workStage} / ${row.valueLevel}${row.hasOutput ? ' | output' : ''}`);
    }
  } else {
    lines.push('', 'No valid rows were found. Nothing was written.');
  }

  if (plan.skipped.length) {
    lines.push('', 'Skipped rows:');
    for (const row of plan.skipped) {
      lines.push(`- #${row.index + 1} ${row.sessionId || 'unknown session'}${row.source ? ` (${row.source})` : ''}: ${row.error}`);
    }
  }

  lines.push('', 'Privacy: this command writes only fully validated user-supplied structured labels; it does not run collect or read conversation content.');
  return lines.join('\n');
}

export function formatClosureFillGuide(guide) {
  const lines = [
    'Token Work Closure Fill Guide',
    '',
    `Rows: ${guide.rowCount}`,
    `Ready to import: ${guide.readyCount}`,
    `Need input: ${guide.needsInputCount}`,
    `Shown: ${guide.shownCount}`,
    '',
    'Allowed values:',
    `- taskType: ${guide.allowedValues.taskType.join(' / ')}`,
    `- outputStatus: ${guide.allowedValues.outputStatus.join(' / ')}`,
    `- workPurpose: ${guide.allowedValues.workPurpose.join(' / ')}`,
    `- workStage: ${guide.allowedValues.workStage.join(' / ')}`,
    `- valueLevel: ${guide.allowedValues.valueLevel.join(' / ')}`,
    `- outputType: ${guide.allowedValues.outputType.join(' / ')}`
  ];

  if (!guide.rows.length) {
    lines.push('', 'No rows need input. Run --report, then dry-run or apply.');
  } else {
    lines.push('', 'Rows to fill:');
    for (const row of guide.rows) {
      lines.push(
        '',
        `#${row.index + 1} ${row.projectHint || row.sessionId || 'unknown session'}`,
        `- sessionId: ${row.sessionId || '(missing)'}`,
        row.source ? `- source: ${row.source}` : null,
        row.totalTokens ? `- tokens: ${formatInt(row.totalTokens)}` : null,
        row.officialCostUSD ? `- officialCostUSD: ${money(row.officialCostUSD)}` : null,
        `- missing: ${row.missingFields.length ? row.missingFields.join(', ') : 'see validation error'}`,
        `- validation: ${row.error}`,
        '- fill required fields: projectAlias, taskType, outputStatus, workPurpose, workStage, valueLevel',
        '- optional output: outputUrl/outputLabel/outputType only for completed or published real outputs'
      );
    }
  }

  lines.push('', `Privacy: ${guide.privacy}`);
  return lines.filter(line => line != null).join('\n');
}

export function formatImportReport(report) {
  const lines = [
    'Token Work Closure Import Report',
    '',
    `Rows: ${report.rowCount}`,
    `Valid: ${report.validCount}`,
    `Invalid: ${report.errorCount}`,
    `Output links: ${report.outputCount}`
  ];

  if (report.errorCount) {
    lines.push('', 'Invalid rows:');
    for (const row of report.sessions.filter(item => !item.valid)) {
      lines.push(`- #${row.index + 1} ${row.sessionId || 'unknown session'}${row.source ? ` (${row.source})` : ''}: ${row.error}`);
    }
  } else {
    lines.push('', 'All rows are valid. Re-run without --report for dry-run plan, then add --apply to write after review.');
  }

  lines.push('', 'Privacy: this report validates user-supplied structured labels only; it does not run collect, write SQLite, or read conversation content.');
  return lines.join('\n');
}

function collectImportRows(db, rows) {
  const results = [];
  const planned = [];

  for (const [index, row] of rows.entries()) {
    try {
      const item = normalizeImportRow(db, row, index);
      planned.push(item);
      results.push(summarizePlannedItem(item));
    } catch (error) {
      results.push({
        ...summarizeRawImportRow(row, index),
        valid: false,
        error: error.message
      });
    }
  }

  return { results, planned };
}

function missingRawClosureFields(row = {}) {
  const fields = [];
  if (!normalizeText(row.projectAlias ?? row.project_alias)) fields.push('projectAlias');
  if (!normalizeText(row.taskType ?? row.task_type)) fields.push('taskType');
  if (!normalizeText(row.outputStatus ?? row.output_status)) fields.push('outputStatus');
  if (!normalizeText(row.workPurpose ?? row.work_purpose)) fields.push('workPurpose');
  if (!normalizeText(row.workStage ?? row.work_stage)) fields.push('workStage');
  if (!normalizeText(row.valueLevel ?? row.value_level)) fields.push('valueLevel');
  return fields;
}

function allowedImportValues() {
  return {
    taskType: TASK_TYPES,
    outputStatus: OUTPUT_STATUSES,
    workPurpose: WORK_PURPOSES,
    workStage: WORK_STAGES,
    valueLevel: VALUE_LEVELS,
    outputType: OUTPUT_TYPES
  };
}

function summarizePlannedItem(item) {
  return {
    index: item.index,
    valid: true,
    device: item.annotation.device,
    source: item.annotation.source,
    sessionId: item.annotation.sessionId,
    projectAlias: item.annotation.projectAlias,
    taskType: item.annotation.taskType,
    outputStatus: item.annotation.outputStatus,
    workPurpose: item.annotation.workPurpose,
    workStage: item.annotation.workStage,
    valueLevel: item.annotation.valueLevel,
    hasOutput: Boolean(item.output)
  };
}

function normalizeImportRow(db, row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`sessions[${index}] must be an object`);
  }
  const identity = resolveSessionIdentity(db, row, index);
  const annotation = normalizeSessionAnnotation({
    ...row,
    ...identity
  });
  requireFullClosureAnnotation(annotation, index);

  const outputUrl = String(row.outputUrl ?? row.output_url ?? '').trim();
  let output = null;
  if (outputUrl) {
    if (!PRODUCTIVE_STATUSES.has(annotation.outputStatus)) {
      throw new Error(`sessions[${index}].outputUrl requires outputStatus 已完成 or 已发布`);
    }
    output = normalizeSessionOutput({
      ...row,
      ...identity,
      outputUrl
    });
  }

  return { index, annotation, output };
}

function summarizeRawImportRow(row, index) {
  const value = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  return {
    index,
    device: normalizeText(value.device),
    source: normalizeText(value.source),
    sessionId: normalizeText(value.sessionId ?? value.session_id),
    projectAlias: normalizeText(value.projectAlias ?? value.project_alias)
  };
}

function requireFullClosureAnnotation(annotation, index) {
  const required = [
    ['projectAlias', annotation.projectAlias],
    ['taskType', annotation.taskType !== '未分类' ? annotation.taskType : null],
    ['outputStatus', annotation.outputStatus !== '未标注' ? annotation.outputStatus : null],
    ['workPurpose', annotation.workPurpose !== '未说明' ? annotation.workPurpose : null],
    ['workStage', annotation.workStage !== '未说明' ? annotation.workStage : null],
    ['valueLevel', annotation.valueLevel !== '未评估' ? annotation.valueLevel : null]
  ];
  const missing = required.filter(([, value]) => !value).map(([field]) => field);
  if (missing.length) {
    throw new Error(`sessions[${index}] is missing required closure field(s): ${missing.join(', ')}`);
  }
}

function resolveSessionIdentity(db, row, index) {
  const sessionId = normalizeText(row.sessionId ?? row.session_id);
  if (!sessionId) throw new Error(`sessions[${index}].sessionId is required`);
  const device = normalizeText(row.device);
  const source = normalizeText(row.source);

  if (device && source) {
    const found = db.prepare(`
      SELECT device, source, session_id AS sessionId
      FROM session_usage
      WHERE device = ? AND source = ? AND session_id = ?
    `).get(device, source, sessionId);
    if (!found) throw new Error(`sessions[${index}] does not match an existing session`);
    return found;
  }

  const matches = db.prepare(`
    SELECT device, source, session_id AS sessionId
    FROM session_usage
    WHERE session_id = ?
    ORDER BY device, source
  `).all(sessionId);
  if (matches.length === 0) throw new Error(`sessions[${index}].sessionId does not exist in session_usage`);
  if (matches.length > 1) throw new Error(`sessions[${index}].sessionId is ambiguous; include device and source`);
  return matches[0];
}

function createDbBackup(db, dbPath, { reason = 'closure-import', backupDir = null } = {}) {
  const resolvedDbPath = resolve(dbPath);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const safeReason = String(reason || 'manual').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const dir = backupDir || process.env.BACKUP_DIR || join(dirname(resolvedDbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const fileName = `usage-${stamp}-${safeReason}.sqlite`;
  const path = join(dir, fileName);
  copyFileSync(resolvedDbPath, path);
  return { createdAt, path, fileName };
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parsePositiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function formatInt(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(Number(value || 0)));
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function openDryRunDb(dbPath) {
  const resolved = resolve(dbPath);
  if (!existsSync(resolved)) throw new Error(`SQLite database not found: ${resolved}`);
  return new DatabaseSync(resolved, { readOnly: true, timeout: 10000 });
}

function runCli() {
  try {
    const options = parseImportArgs();
    if (options.help) {
      console.log(helpText());
      return;
    }

    const dbPath = resolve(options.dbPath || defaultDbPath);
    const { rows, filePath } = loadClosureImportFile(options.file);
    if (!existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
    const db = (options.apply || options.applyValid) ? openDb(dbPath) : openDryRunDb(dbPath);
    try {
      if (options.fillGuide) {
        const guide = buildClosureFillGuide(db, rows, { limit: options.limit });
        console.log(options.json ? JSON.stringify({
          filePath,
          dbPath,
          ...guide
        }, null, 2) : formatClosureFillGuide(guide));
        return;
      }

      if (options.report) {
        const report = buildClosureImportReport(db, rows);
        console.log(options.json ? JSON.stringify({
          filePath,
          dbPath,
          ...report
        }, null, 2) : formatImportReport(report));
        if (!report.valid) process.exitCode = 1;
        return;
      }

      if (options.applyValid) {
        const plan = planValidClosureImport(db, rows);
        const result = applyClosureImport(db, plan, {
          dbPath,
          mode: 'apply-valid',
          reason: 'closure-import-valid'
        });
        const output = {
          filePath,
          dbPath,
          ...result,
          rowCount: plan.rowCount,
          annotationCount: plan.annotationCount,
          outputCount: plan.outputCount,
          skippedCount: plan.skippedCount,
          sessions: plan.sessions,
          skipped: plan.skipped
        };
        console.log(options.json ? JSON.stringify(output, null, 2) : formatApplyValidResult(plan, result));
        if (!result.applied) process.exitCode = 1;
        return;
      }

      const plan = planClosureImport(db, rows);
      const result = options.apply ? applyClosureImport(db, plan, { dbPath }) : null;
      const output = {
        filePath,
        dbPath,
        ...(result || { mode: 'dry-run', applied: false }),
        rowCount: plan.rowCount,
        annotationCount: plan.annotationCount,
        outputCount: plan.outputCount,
        sessions: plan.sessions
      };
      console.log(options.json ? JSON.stringify(output, null, 2) : formatImportPlan(plan, result));
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(`closure:import failed: ${error.message}`);
    process.exitCode = 2;
  }
}

function helpText() {
  return [
    'Usage: npm run closure:import -- --file labels.json [options]',
    '',
    'Options:',
    '  --file <path>    JSON array or { "sessions": [...] } with filled labels.',
    '  --db <path>      SQLite database path. Defaults to DB_PATH or data/usage.sqlite.',
    '  --json           Print machine-readable output.',
    '  --fill-guide     Print a read-only field-by-field guide for filling real labels.',
    '  --report         Validate all rows and report every invalid row without writing.',
    '  --apply-valid    Write only fully valid rows and skip invalid rows after creating a backup.',
    '  --apply          Write labels after validation. Without this, the command is dry-run only.',
    '  --limit=<n>      Fill guide row limit. Default: 10.',
    '  -h, --help       Show this help.',
    '',
    'Required per row: sessionId, projectAlias, taskType, outputStatus, workPurpose, workStage, valueLevel.',
    'Optional per row: device, source, note, outputUrl, outputLabel, outputType.',
    'This command never runs collect or reads conversation content.'
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
