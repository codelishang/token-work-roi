import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteAdvisorAction,
  deleteBudgetProfile,
  listAdvisorActions,
  listBudgetProfiles,
  linkWorkItemSessions,
  listTokenEvents,
  listWorkItems,
  openDb,
  upsertAdvisorAction,
  upsertBudgetProfile,
  upsertSession,
  upsertTokenEvent,
  upsertWorkItem
} from '../src/db.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-roi-'));
  return openDb(join(dir, 'usage.sqlite'));
}

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
