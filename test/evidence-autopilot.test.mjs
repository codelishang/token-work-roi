import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEvidenceSuggestions,
  buildEvidenceAutopilotPlan
} from '../src/evidence-autopilot.mjs';
import {
  openDb,
  upsertSession,
  upsertSessionAnnotation
} from '../src/db.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseSession = {
  device: 'devbox',
  source: 'Codex CLI',
  sessionId: 'local:codex:D:\\HighROIProjects\\token-work:gpt-5.5',
  projectPath: 'D:\\HighROIProjects\\token-work',
  taskType: '未分类',
  outputStatus: '未标注',
  workPurpose: '未说明',
  workStage: '未说明',
  valueLevel: '未评估',
  inputTokens: 200_000,
  outputTokens: 20_000,
  totalTokens: 220_000,
  costUSD: 12,
  lastActivity: '2026-06-18'
};

test('evidence autopilot turns alias rules and git commit URLs into applicable evidence', () => {
  const plan = buildEvidenceAutopilotPlan({
    sessions: [baseSession],
    projectAliasRules: [{
      enabled: true,
      matchType: 'prefix',
      pattern: 'D:\\HighROIProjects\\token-work',
      projectAlias: 'Token Work'
    }],
    period: 'all',
    gitCandidatesBySession: new Map([[
      sessionKey(baseSession),
      {
        repoName: 'token-work',
        remoteHost: 'github.com',
        commitHash: 'abcdef1234567890',
        commitAt: '2026-06-18T10:00:00.000Z',
        commitUrl: 'https://github.com/codelishang/token-work-roi/commit/abcdef1234567890',
        reason: 'matched commit'
      }
    ]])
  });

  assert.equal(plan.period, 'all');
  assert.equal(plan.summary.annotationSuggestions, 1);
  assert.equal(plan.summary.outputSuggestions, 1);
  assert.equal(plan.canApplyCount, 2);
  assert.equal(plan.queue.length, 2);
  assert.equal(plan.queue[0].canApply, true);
  assert.equal(plan.suggestions.some(item => item.kind === 'output' && item.suggestedValues.outputType === 'commit'), true);
  assert.equal(plan.suggestions.find(item => item.kind === 'annotation').suggestedValues.projectAlias, 'Token Work');
});

test('local git candidates without remote commit URL stay drafts and are not writable', () => {
  const plan = buildEvidenceAutopilotPlan({
    sessions: [baseSession],
    period: 'all',
    gitCandidatesBySession: new Map([[
      sessionKey(baseSession),
      {
        repoName: 'local-only',
        remoteHost: null,
        commitHash: 'abcdef1234567890',
        commitAt: '2026-06-18T10:00:00.000Z',
        commitUrl: null,
        reason: 'local commit'
      }
    ]])
  });

  const output = plan.suggestions.find(item => item.kind === 'output');
  assert.equal(output.canApply, false);
  assert.equal(output.provenance, '待确认草稿');
  assert.equal(output.suggestedValues.outputUrl, undefined);
});

test('evidence suggestions do not expose full local project paths', () => {
  const plan = buildEvidenceAutopilotPlan({
    sessions: [{
      ...baseSession,
      projectPath: 'D:\\HighROIProjects\\private-client\\token-work',
      sessionId: 'local:codex:D:\\HighROIProjects\\private-client\\token-work:gpt-5.5'
    }],
    period: 'all',
    scanGit: false
  });

  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes('D:\\HighROIProjects\\private-client'), false);
  assert.equal(plan.suggestions[0].project, 'token-work');
});

test('apply evidence suggestions writes selected auto annotations and output links without overwriting manual labels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-work-evidence-'));
  const dbPath = join(dir, 'usage.sqlite');
  const db = openDb(dbPath);
  try {
    upsertSession(db, {
      device: baseSession.device,
      source: baseSession.source,
      sessionId: baseSession.sessionId,
      lastActivity: '2026-06-18T10:00:00.000Z',
      projectPath: baseSession.projectPath,
      inputTokens: baseSession.inputTokens,
      outputTokens: baseSession.outputTokens,
      totalTokens: baseSession.totalTokens,
      costUSD: baseSession.costUSD
    });
    const plan = buildEvidenceAutopilotPlan({
      sessions: [baseSession],
      period: 'all',
      gitCandidatesBySession: new Map([[
        sessionKey(baseSession),
        {
          repoName: 'token-work',
          remoteHost: 'github.com',
          commitHash: 'abcdef1234567890',
          commitAt: '2026-06-18T10:00:00.000Z',
          commitUrl: 'https://github.com/codelishang/token-work-roi/commit/abcdef1234567890',
          reason: 'matched commit'
        }
      ]])
    });
    const result = applyEvidenceSuggestions(db, plan, {
      suggestionIds: plan.suggestions.filter(item => item.canApply).map(item => item.suggestionId)
    });

    assert.equal(result.appliedAnnotations, 1);
    assert.equal(result.appliedOutputs, 1);
    const output = db.prepare('SELECT output_url AS outputUrl, output_type AS outputType FROM session_outputs').get();
    assert.equal(output.outputType, 'commit');
    assert.match(output.outputUrl, /^https:\/\/github\.com\//);

    upsertSessionAnnotation(db, {
      device: baseSession.device,
      source: baseSession.source,
      sessionId: baseSession.sessionId,
      projectAlias: 'Manual Project',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '高',
      annotationSource: 'manual',
      annotationConfidence: 100
    });
    const manualPlan = buildEvidenceAutopilotPlan({ sessions: [{ ...baseSession, annotationSource: 'manual' }], period: 'all', scanGit: false });
    assert.equal(manualPlan.suggestions.some(item => item.kind === 'annotation'), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function sessionKey(row = {}) {
  return `${row.device || ''}::${row.source || ''}::${row.sessionId || ''}`;
}
