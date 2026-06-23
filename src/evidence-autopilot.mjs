import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  AUTO_ATTRIBUTION_THRESHOLD,
  AUTO_ATTRIBUTION_VERSION,
  buildAutoAttributionPlan
} from './auto-attribution.mjs';
import {
  applyAutoSessionAnnotations,
  upsertSessionOutput
} from './db.mjs';

export const EVIDENCE_AUTOPILOT_VERSION = 'v1.0.0';

export function buildEvidenceAutopilotPlan({
  sessions = [],
  projectAliasRules = [],
  period = 'month',
  now = new Date(),
  threshold = AUTO_ATTRIBUTION_THRESHOLD,
  gitCandidatesBySession = null,
  scanGit = true,
  queueLimit = 10
} = {}) {
  const nowDate = asDate(now) || new Date();
  const scopedSessions = filterSessionsByPeriod(sessions, period, nowDate);
  const autoPlan = buildAutoAttributionPlan({
    sessions: scopedSessions,
    projectAliasRules,
    now: nowDate,
    threshold
  });
  const gitMap = gitCandidatesBySession
    ? normalizeGitCandidateMap(gitCandidatesBySession)
    : scanGit ? findGitOutputCandidates(scopedSessions) : new Map();

  const annotationSuggestions = autoPlan.suggestions.map(item =>
    evidenceSuggestionFromAuto(item, threshold)
  );
  const outputSuggestions = scopedSessions
    .map(session => evidenceSuggestionFromGit(session, gitMap.get(sessionKey(session))))
    .filter(Boolean);

  const suggestions = [...annotationSuggestions, ...outputSuggestions]
    .sort(compareSuggestions)
    .map((item, index) => {
      item.rank = index + 1;
      return item;
    });
  const queue = suggestions.slice(0, queueLimit);
  const canApply = suggestions.filter(item => item.canApply);
  const draft = suggestions.filter(item => !item.canApply && item.confidence >= 60);

  return {
    ok: true,
    version: EVIDENCE_AUTOPILOT_VERSION,
    autoVersion: AUTO_ATTRIBUTION_VERSION,
    generatedAt: nowDate.toISOString(),
    period: normalizePeriod(period),
    threshold,
    privacy: 'Only structured metadata is used. Prompt, response, transcript, diff, file content, and full local paths are not returned.',
    totalSessions: scopedSessions.length,
    suggestionCount: suggestions.length,
    canApplyCount: canApply.length,
    draftCount: draft.length,
    queue,
    suggestions,
    summary: {
      annotationSuggestions: annotationSuggestions.length,
      outputSuggestions: outputSuggestions.length,
      autoHighConfidence: annotationSuggestions.filter(item => item.canApply).length,
      gitOutputCandidates: outputSuggestions.length,
      canApplyIds: canApply.map(item => item.suggestionId)
    }
  };
}

export function applyEvidenceSuggestions(db, plan, payload = {}) {
  const requested = suggestionIdSet(payload.suggestionIds || payload.suggestions);
  const selected = plan.suggestions.filter(item => requested.has(item.suggestionId));
  const annotationRows = selected
    .filter(item => item.kind === 'annotation' && item.canApply && item._autoSuggestion)
    .map(item => item._autoSuggestion);
  const outputRows = selected
    .filter(item => item.kind === 'output' && item.canApply && item._output)
    .map(item => item._output);
  const result = {
    requested: requested.size,
    selected: selected.length,
    appliedAnnotations: 0,
    appliedOutputs: 0,
    skippedNotFound: requested.size - selected.length,
    skippedNotApplicable: selected.filter(item => !item.canApply).length
  };

  if (annotationRows.length) {
    const applied = applyAutoSessionAnnotations(db, annotationRows, {
      threshold: plan.threshold,
      runId: payload.runId || undefined
    });
    result.appliedAnnotations = applied.applied;
    result.skippedProtected = applied.skippedProtected;
    result.skippedLowConfidence = applied.skippedLowConfidence;
    result.runId = applied.runId;
  }

  for (const row of outputRows) {
    upsertSessionOutput(db, row);
    result.appliedOutputs += 1;
  }

  return result;
}

export function findGitOutputCandidates(sessions = []) {
  const candidates = new Map();
  const repoCache = new Map();
  for (const session of sessions) {
    if (session.outputUrl) continue;
    const projectPath = localProjectPath(session.projectPath);
    if (!projectPath) continue;
    const repo = repoCache.get(projectPath) || inspectGitRepo(projectPath);
    repoCache.set(projectPath, repo);
    if (!repo?.ok) continue;
    const commit = findCommitNearSession(repo, session);
    if (!commit) continue;
    candidates.set(sessionKey(session), {
      ...commit,
      repoName: repo.repoName,
      remoteHost: repo.remoteHost,
      hasRemoteCommitUrl: Boolean(commit.commitUrl),
      reason: commit.commitUrl
        ? `在 ${repo.repoName} 的 Git 历史中找到与 session 时间接近的 commit。`
        : `在 ${repo.repoName} 找到本地 commit，但 remote 无法生成可公开打开的 HTTPS URL。`
    });
  }
  return candidates;
}

function evidenceSuggestionFromAuto(item, threshold) {
  const fields = item.applicableFields?.length ? item.applicableFields : item.changedFields || [];
  const confidence = Number(item.applyConfidence || item.annotationConfidence || 0);
  const canApply = Boolean(item.canApply && confidence >= threshold && fields.length);
  const project = safeProjectLabel(item.values?.projectAlias, item.projectPath, item.sessionId);
  const title = canApply
    ? `自动补齐 ${fields.map(fieldLabel).join('、')}`
    : `待确认 ${fields.map(fieldLabel).join('、') || '归因字段'}`;
  const suggestion = {
    suggestionId: stableId('annotation', item),
    kind: 'annotation',
    category: '归因证据',
    provenance: canApply ? '自动高置信' : '待确认草稿',
    title,
    project,
    source: item.source,
    sessionId: safeSessionLabel(item.sessionId),
    model: item.model,
    totalTokens: item.totalTokens || 0,
    costUSD: item.costUSD || 0,
    confidence,
    canApply,
    fields,
    suggestedValues: item.applicableValues || item.values || {},
    reason: item.annotationReason || item.evidence || '基于结构化 token/session 元数据生成的自动归因建议。',
    action: canApply ? '接受建议会写入自动归因字段，不覆盖人工确认。' : '先编辑确认，避免把低证据推断写成事实。'
  };
  Object.defineProperty(suggestion, '_autoSuggestion', { value: item, enumerable: false });
  return suggestion;
}

function evidenceSuggestionFromGit(session, candidate) {
  if (!candidate) return null;
  const canApply = Boolean(candidate.commitUrl);
  const confidence = canApply ? 86 : 68;
  const suggestion = {
    suggestionId: stableId('output', session, candidate.commitHash),
    kind: 'output',
    category: '产出证据',
    provenance: canApply ? '自动高置信' : '待确认草稿',
    title: canApply ? `补充 ${candidate.repoName} commit 产出链接` : `发现 ${candidate.repoName} 本地 commit 候选`,
    project: safeProjectLabel(session.projectAlias, candidate.repoName, session.projectPath, session.sessionId),
    source: session.source,
    sessionId: safeSessionLabel(session.sessionId),
    model: session.model || session.pricingModel || null,
    totalTokens: session.totalTokens || 0,
    costUSD: session.costUSD || 0,
    confidence,
    canApply,
    fields: ['outputUrl', 'outputType'],
    suggestedValues: canApply ? {
      outputUrl: candidate.commitUrl,
      outputLabel: `${candidate.repoName} ${shortHash(candidate.commitHash)}`,
      outputType: 'commit'
    } : {
      outputType: 'commit',
      outputLabel: `${candidate.repoName} ${shortHash(candidate.commitHash)}`
    },
    reason: candidate.reason,
    action: canApply
      ? '接受建议会保存 HTTPS commit URL、标签和类型；不会读取 commit diff。'
      : '只有生成 HTTPS commit URL 后才会写入产出链接。',
    git: {
      repoName: candidate.repoName,
      remoteHost: candidate.remoteHost || null,
      commitHash: shortHash(candidate.commitHash),
      commitAt: candidate.commitAt || null,
      hasRemoteCommitUrl: Boolean(candidate.commitUrl)
    }
  };
  Object.defineProperty(suggestion, '_output', {
    value: canApply ? {
      device: session.device,
      source: session.source,
      sessionId: session.sessionId,
      outputUrl: candidate.commitUrl,
      outputLabel: `${candidate.repoName} ${shortHash(candidate.commitHash)}`,
      outputType: 'commit'
    } : null,
    enumerable: false
  });
  return suggestion;
}

function inspectGitRepo(projectPath) {
  if (!existsSync(projectPath)) return { ok: false, reason: 'project path does not exist' };
  const root = git(projectPath, ['rev-parse', '--show-toplevel']);
  if (!root.ok) return { ok: false, reason: 'not a git repository' };
  const repoRoot = root.stdout.trim();
  const remote = git(repoRoot, ['remote', 'get-url', 'origin']);
  const parsedRemote = parseRemote(remote.ok ? remote.stdout.trim() : '');
  return {
    ok: true,
    root: repoRoot,
    repoName: parsedRemote.repoName || basename(repoRoot),
    remoteHost: parsedRemote.host || null,
    remoteKind: parsedRemote.kind || null,
    commitUrlFor: parsedRemote.commitUrlFor || null
  };
}

function findCommitNearSession(repo, session) {
  const window = commitWindow(session.lastActivity);
  if (!window) return null;
  const result = git(repo.root, [
    'log',
    `--since=${window.since}`,
    `--until=${window.until}`,
    '--format=%H%x09%ct',
    '--max-count=5'
  ]);
  if (!result.ok) return null;
  const rows = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (!rows.length) return null;
  const [hash, timestamp] = rows[0].split('\t');
  if (!hash) return null;
  const commitAt = timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null;
  return {
    commitHash: hash,
    commitAt,
    commitUrl: repo.commitUrlFor ? repo.commitUrlFor(hash) : null
  };
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 2500,
    windowsHide: true,
    maxBuffer: 512 * 1024
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseRemote(remoteUrl) {
  const text = String(remoteUrl || '').trim();
  if (!text) return {};
  const ssh = text.match(/^git@([^:]+):(.+)$/u);
  const https = text.match(/^https?:\/\/([^/]+)\/(.+)$/u);
  const host = (ssh?.[1] || https?.[1] || '').toLowerCase();
  const repoPath = (ssh?.[2] || https?.[2] || '').replace(/\.git$/u, '').replace(/^\/+/u, '');
  if (!host || !repoPath || !repoPath.includes('/')) return { host };
  const repoName = basename(repoPath);
  if (host === 'github.com') {
    return {
      host,
      kind: 'github',
      repoName,
      commitUrlFor: hash => `https://github.com/${repoPath}/commit/${hash}`
    };
  }
  if (host === 'gitlab.com') {
    return {
      host,
      kind: 'gitlab',
      repoName,
      commitUrlFor: hash => `https://gitlab.com/${repoPath}/-/commit/${hash}`
    };
  }
  if (host === 'bitbucket.org') {
    return {
      host,
      kind: 'bitbucket',
      repoName,
      commitUrlFor: hash => `https://bitbucket.org/${repoPath}/commits/${hash}`
    };
  }
  return { host, repoName };
}

function commitWindow(value) {
  const date = asDate(value);
  if (!date) return null;
  const since = new Date(date.getTime() - 36 * 60 * 60 * 1000);
  const until = new Date(date.getTime() + 36 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

function filterSessionsByPeriod(sessions, period, now) {
  const normalized = normalizePeriod(period);
  if (normalized === 'all') return sessions;
  const days = normalized === 'week' ? 7 : 30;
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return sessions.filter(session => {
    const date = asDate(session.lastActivity);
    return !date || date >= start;
  });
}

function compareSuggestions(a, b) {
  return Number(b.canApply) - Number(a.canApply)
    || b.confidence - a.confidence
    || Number(b.costUSD || 0) - Number(a.costUSD || 0)
    || Number(b.totalTokens || 0) - Number(a.totalTokens || 0);
}

function normalizeGitCandidateMap(value) {
  if (value instanceof Map) return value;
  const map = new Map();
  for (const [key, candidate] of Object.entries(value || {})) map.set(key, candidate);
  return map;
}

function normalizePeriod(value) {
  const text = String(value || 'month').toLowerCase();
  if (['week', 'month', 'all'].includes(text)) return text;
  return 'month';
}

function suggestionIdSet(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return new Set(list.map(row => typeof row === 'string' ? row : row?.suggestionId).filter(Boolean));
}

function stableId(kind, row = {}, extra = '') {
  return `${kind}:${createHash('sha256')
    .update([kind, row.device, row.source, row.sessionId, extra].join('::'))
    .digest('hex')
    .slice(0, 18)}`;
}

function localProjectPath(value) {
  const text = String(value || '').trim();
  if (!text || text === 'Unknown Project' || text.startsWith('local:')) return '';
  return text;
}

function safeProjectLabel(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || text === 'Unknown Project') continue;
    if (text.startsWith('local:')) {
      const parts = text.split(':');
      const maybePath = parts.length > 3 ? parts.slice(2, -1).join(':') : '';
      const fromPath = pathTail(maybePath);
      if (fromPath) return fromPath;
      continue;
    }
    const tail = pathTail(text);
    return tail || text.slice(0, 120);
  }
  return '未归属项目';
}

function safeSessionLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('local:')) {
    const parts = text.split(':');
    const model = parts.at(-1) || '';
    const project = safeProjectLabel(text);
    return [project, model].filter(Boolean).join(' · ');
  }
  if (text.includes('\\') || text.includes('/')) return pathTail(text);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function pathTail(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.replace(/\\/g, '/').replace(/\/+$/u, '');
  const tail = normalized.split('/').filter(Boolean).at(-1) || '';
  return tail.slice(0, 120);
}

function sessionKey(row = {}) {
  return `${row.device || ''}::${row.source || ''}::${row.sessionId || ''}`;
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fieldLabel(field) {
  return ({
    projectAlias: '项目',
    taskType: '任务',
    outputStatus: '产出状态',
    workPurpose: '目的',
    workStage: '阶段',
    valueLevel: '价值'
  })[field] || field;
}

function shortHash(value) {
  return String(value || '').slice(0, 8);
}
