import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstRunState } from '../src/client/dashboard/onboarding.js';

test('first-run state points empty databases to demo or import', () => {
  const state = buildFirstRunState({
    daily: [],
    sessions: [],
    budgetProfiles: [],
    advisorActions: [],
    tokenEvents: []
  });
  assert.equal(state.hasUsage, false);
  assert.equal(state.shouldShow, true);
  assert.equal(state.steps[0].status, 'todo');
  assert.equal(state.notices[0].id, 'no-data');
});

test('first-run state asks review users to create advisor actions after usage exists', () => {
  const state = buildFirstRunState({
    daily: [{ usageDate: '2026-06-17', totalTokens: 100 }],
    sessions: [{ sessionId: 's1', totalTokens: 100 }],
    budgetProfiles: [],
    advisorActions: [],
    tokenEvents: []
  });
  assert.equal(state.hasUsage, true);
  assert.equal(state.hasActions, false);
  assert.ok(state.notices.some(notice => notice.id === 'no-actions'));
});

test('first-run state explains budgets without event-level live data', () => {
  const state = buildFirstRunState({
    daily: [{ usageDate: '2026-06-17', totalTokens: 100 }],
    sessions: [{ sessionId: 's1', totalTokens: 100 }],
    budgetProfiles: [{ id: 1, label: 'Codex 1h' }],
    advisorActions: [{ id: 1, status: 'open' }],
    tokenEvents: []
  });
  assert.equal(state.hasBudget, true);
  assert.equal(state.hasLiveEvents, false);
  assert.ok(state.notices.some(notice => notice.id === 'budget-no-live-events'));
});

test('first-run state hides when data, budgets, actions and live events exist', () => {
  const state = buildFirstRunState({
    daily: [{ usageDate: '2026-06-17', totalTokens: 100 }],
    sessions: [{ sessionId: 's1', totalTokens: 100 }],
    budgetProfiles: [{ id: 1, label: 'Codex 1h' }],
    advisorActions: [{ id: 1, status: 'open' }],
    tokenEvents: [{ eventId: 'e1', totalTokens: 100 }]
  });
  assert.equal(state.shouldShow, false);
  assert.deepEqual(state.notices, []);
});
