import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteAdvisorAction,
  deleteBudgetProfile,
  createSqliteBackup,
  listAdvisorActions,
  listBudgetProfiles,
  linkWorkItemSessions,
  listTokenEvents,
  listWorkItems,
  openDb,
  upsertDaily,
  upsertAdvisorAction,
  upsertBudgetProfile,
  upsertSession,
  upsertTokenEvent,
  upsertWorkItem
} from '../src/db.ts';
import { buildTerminalReport } from '../src/terminal-report.ts';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-roi-'));
  return openDb(join(dir, 'usage.sqlite'));
}

test('scheduled backups are rate limited and retained independently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-backup-'));
  const dbPath = join(dir, 'usage.sqlite');
  const backupDir = join(dir, 'backups');
  const db = openDb(dbPath);

  const first = createSqliteBackup(db, dbPath, {
    reason: 'scheduled-collect',
    backupDir,
    minimumIntervalMs: 60_000,
    maxBackups: 2,
    now: new Date('2026-07-19T00:00:00.000Z')
  });
  assert.ok(first && existsSync(first.path));
  utimesSync(first.path, new Date('2026-07-19T00:00:00.000Z'), new Date('2026-07-19T00:00:00.000Z'));

  const skipped = createSqliteBackup(db, dbPath, {
    reason: 'scheduled-collect',
    backupDir,
    minimumIntervalMs: 60_000,
    maxBackups: 2,
    now: new Date('2026-07-19T00:00:30.000Z')
  });
  assert.equal(skipped, null);

  for (const now of ['2026-07-19T01:00:00.000Z', '2026-07-19T02:00:00.000Z']) {
    const backup = createSqliteBackup(db, dbPath, {
      reason: 'scheduled-collect',
      backupDir,
      maxBackups: 2,
      now: new Date(now)
    });
    assert.ok(backup && existsSync(backup.path));
  }
  assert.equal(readdirSync(backupDir).filter(name => name.endsWith('-scheduled-collect.sqlite')).length, 2);

  const manual = createSqliteBackup(db, dbPath, {
    reason: 'collect',
    backupDir,
    now: new Date('2026-07-19T02:00:00.000Z')
  });
  assert.ok(manual && existsSync(manual.path));
  assert.equal(readdirSync(backupDir).filter(name => name.endsWith('-collect.sqlite')).length, 3);
  db.close();
});

test('token_events upsert is idempotent and privacy bounded', () => {
  const db = tempDb();
  upsertTokenEvent(db, {
    eventId: 'evt-1',
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 's1',
    timestamp: '2026-06-17T00:00:00Z',
    model: 'codex-mini',
    inputTokens: 10,
    outputTokens: 3,
    toolCategory: 'edit',
    fileExtension: '.js',
    repoPathHash: 'abc',
    privacyLevel: 'hashed'
  });
  upsertTokenEvent(db, {
    eventId: 'evt-1',
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 's1',
    timestamp: '2026-06-17T00:00:00Z',
    model: 'codex-mini',
    inputTokens: 20,
    outputTokens: 5,
    privacyLevel: 'safe'
  });
  const rows = listTokenEvents(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inputTokens, 20);
  assert.equal(rows[0].privacyLevel, 'safe');
  db.close();
});

test('token event ids do not overwrite another device or source', () => {
  const db = tempDb();
  const event = {
    eventId: 'shared-event-id',
    source: 'Codex CLI',
    sessionId: 'shared-session',
    timestamp: '2026-07-19T00:00:00Z',
    model: 'gpt-5.5',
    inputTokens: 10,
    outputTokens: 2
  };

  upsertTokenEvent(db, { ...event, device: 'workstation-a' });
  upsertTokenEvent(db, { ...event, device: 'workstation-b', inputTokens: 20 });
  upsertTokenEvent(db, { ...event, device: 'workstation-b', inputTokens: 30 });
  upsertTokenEvent(db, { ...event, device: 'workstation-a', source: 'Claude Code', inputTokens: 40 });

  const rows = listTokenEvents(db, { limit: 10 });
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.device === 'workstation-a' && row.source === 'Codex CLI').inputTokens, 10);
  assert.equal(rows.find(row => row.device === 'workstation-b').inputTokens, 30);
  assert.equal(rows.find(row => row.source === 'Claude Code').inputTokens, 40);
  db.close();
});

test('usage rows persist session models and reject malformed numeric data', () => {
  const db = tempDb();
  upsertDaily(db, {
    device: 'demo',
    source: 'Codex CLI',
    usageDate: '2026-07-15',
    model: 'gpt-5.5',
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 7,
    costUSD: 0.0002
  });
  upsertSession(db, {
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 'session-with-model',
    lastActivity: '2026-07-15T01:00:00.000Z',
    model: 'gpt-5.5',
    inputTokens: 10,
    outputTokens: 5,
    costUSD: 0.0002
  });
  upsertSession(db, {
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 'session-with-model',
    inputTokens: 20,
    outputTokens: 10
  });

  const session = db.prepare('SELECT model, last_activity AS lastActivity, total_tokens AS totalTokens FROM session_usage').get();
  assert.equal(session.model, 'gpt-5.5');
  assert.equal(session.lastActivity, '2026-07-15T01:00:00.000Z');
  assert.equal(session.totalTokens, 30);
  const report = buildTerminalReport(db, { period: 'all' });
  assert.equal(report.totals.totalTokens, 22);
  assert.equal(report.totals.cacheReadTokens, 7);
  upsertDaily(db, {
    device: 'demo',
    source: 'Codex CLI',
    usageDate: '2026-07-16',
    model: 'gpt-5.5',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 1
  });
  assert.equal(
    db.prepare("SELECT total_tokens AS totalTokens FROM daily_usage WHERE usage_date = '2026-07-16'").get().totalTokens,
    15
  );
  assert.throws(() => upsertDaily(db, {
    device: 'demo',
    source: 'Codex CLI',
    usageDate: '2026-02-30',
    inputTokens: 1
  }), /valid date/);
  assert.throws(() => upsertSession(db, {
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 'bad-token-count',
    inputTokens: -1
  }), /non-negative integer/);
  db.close();
});

test('work items can be created and linked to sessions', () => {
  const db = tempDb();
  upsertSession(db, {
    device: 'demo',
    source: 'Codex CLI',
    sessionId: 's1',
    lastActivity: '2026-06-17',
    totalTokens: 100
  });
  const item = upsertWorkItem(db, {
    title: 'Ship Token Work ROI',
    projectAlias: 'Token Work ROI',
    workType: '功能开发',
    status: '已发布',
    valueLevel: '高',
    outputUrl: 'https://example.com/pr/1',
    outputType: 'PR'
  });
  const linked = linkWorkItemSessions(db, {
    workItemId: item.id,
    sessions: [{ device: 'demo', source: 'Codex CLI', sessionId: 's1' }]
  });
  assert.equal(linked.linked, 1);
  const items = listWorkItems(db);
  assert.equal(items.length, 1);
  assert.equal(items[0].sessions.length, 1);
  db.close();
});

test('budget profiles validate custom local budgets', () => {
  const db = tempDb();
  const profile = upsertBudgetProfile(db, {
    source: 'claude',
    label: 'Claude 5h',
    windowMinutes: 300,
    tokenBudget: 500000
  });
  assert.equal(profile.source, 'claude');
  assert.equal(profile.enabled, true);
  assert.equal(listBudgetProfiles(db).length, 1);
  assert.throws(() => upsertBudgetProfile(db, {
    source: 'codex',
    label: 'invalid',
    windowMinutes: 0,
    tokenBudget: 100
  }), /windowMinutes/);
  assert.equal(deleteBudgetProfile(db, { id: profile.id }), 1);
  db.close();
});

test('budget profiles support fixed reset windows and warning thresholds', () => {
  const db = tempDb();
  const profile = upsertBudgetProfile(db, {
    source: 'Codex CLI',
    label: 'Codex fixed 5h',
    windowType: 'fixed',
    windowMinutes: 300,
    resetAnchor: '2026-06-17T00:00:00Z',
    warningThreshold: 0.6,
    tokenBudget: 100000
  });
  assert.equal(profile.windowType, 'fixed');
  assert.equal(profile.resetAnchor, '2026-06-17T00:00:00.000Z');
  assert.equal(profile.warningThreshold, 0.6);

  const rolling = upsertBudgetProfile(db, {
    id: profile.id,
    source: 'Codex CLI',
    label: 'Codex rolling',
    windowType: 'rolling',
    windowMinutes: 60,
    resetAnchor: '2026-06-17T00:00:00Z',
    warningThreshold: 0.75,
    tokenBudget: 100000
  });
  assert.equal(rolling.windowType, 'rolling');
  assert.equal(rolling.resetAnchor, null);
  assert.throws(() => upsertBudgetProfile(db, {
    source: 'Codex CLI',
    label: 'bad threshold',
    windowType: 'fixed',
    windowMinutes: 300,
    resetAnchor: '2026-06-17T00:00:00Z',
    warningThreshold: 1.5,
    tokenBudget: 1000
  }), /warningThreshold/);
  db.close();
});

test('advisor actions upsert by period and source rule', () => {
  const db = tempDb();
  const first = upsertAdvisorAction(db, {
    periodStart: '2026-06-01',
    periodEnd: '2026-06-07',
    category: '节省模拟',
    title: '测试验证换轻量模型',
    action: '下周测试验证默认先用轻量模型',
    evidence: '2 sessions',
    sourceRule: 'savings:test',
    status: 'open'
  });
  const updated = upsertAdvisorAction(db, {
    periodStart: '2026-06-01',
    periodEnd: '2026-06-07',
    category: '节省模拟',
    title: '测试验证换轻量模型',
    action: '下周测试验证默认先用轻量模型',
    evidence: '2 sessions',
    sourceRule: 'savings:test',
    status: 'done'
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.status, 'done');
  assert.ok(updated.completedAt);
  assert.equal(listAdvisorActions(db, { periodStart: '2026-06-01', periodEnd: '2026-06-07' }).length, 1);
  assert.equal(deleteAdvisorAction(db, { id: updated.id }), 1);
  db.close();
});
