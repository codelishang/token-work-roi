import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.json', '.md', '.txt', '.yml', '.yaml', '.toml',
  '.html', '.css', '.svg', '.env', '.gitignore', '.nvmrc'
]);

const SECRET_PATTERNS = [
  { id: 'env-file', severity: 'high', testPath: path => /^\.env(?:\.|$)/i.test(path) || /[/\\]\.env(?:\.|$)/i.test(path), message: 'Environment files must not be published.' },
  { id: 'sqlite-db', severity: 'high', testPath: path => /(?:^|[/\\])data[/\\].+\.sqlite(?:3)?$/i.test(path), message: 'Real SQLite usage databases must not be published.' },
  { id: 'ai-log-dir', severity: 'high', testPath: path => /(^|[/\\])\.(claude|codex)([/\\]|$)/i.test(path), message: 'Local AI tool log directories must not be published.' },
  { id: 'export-file', severity: 'medium', testPath: path => /token-work-(annotations|review).*\.(json|csv|md)$/i.test(path), message: 'Generated exports should be reviewed before publishing.' }
];

const CONTENT_PATTERNS = [
  { id: 'personal-windows-path', severity: 'high', re: /C:\\Users\\|C:\/Users\//i, message: 'Personal Windows user paths found in tracked text.' },
  { id: 'real-project-path', severity: 'medium', re: /D:[\\/](AIResume|HighROIProjects)[\\/](?!ryan__token-work-roi|token-work-roi-demo)/i, message: 'Real local project path found in tracked text.' },
  { id: 'personal-handle', severity: 'high', re: new RegExp(`guoye${'yang'}|\\u90ed\\u70e8\\u626c`, 'i'), message: 'Forbidden public identity string found; use ryan instead.' },
  { id: 'conversation-content', severity: 'medium', re: /(conversation|transcript|prompt|response)\s*[:=]\s*["'`][^"'`]{80,}/i, message: 'Possible raw conversation content found in tracked text.' },
  { id: 'api-secret', severity: 'high', re: /(sk-[A-Za-z0-9_-]{20,}|api[_-]?key\s*[:=]\s*["'][^"']{12,})/i, message: 'Possible API key or secret found.' }
];

export function runPrivacyCheck({ cwd = process.cwd(), includeUntracked = false } = {}) {
  const files = trackedFiles(cwd, includeUntracked);
  const issues = [];

  for (const file of files) {
    const fullPath = join(cwd, file);
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.testPath(file)) {
        issues.push(issue(pattern, file));
      }
    }
    if (!isReadableTextFile(fullPath)) continue;
    const text = readFileSync(fullPath, 'utf8');
    for (const pattern of CONTENT_PATTERNS) {
      const match = text.match(pattern.re);
      if (match) {
        issues.push({
          ...issue(pattern, file),
          excerpt: safeExcerpt(match[0])
        });
      }
    }
  }

  return {
    ok: !issues.some(item => item.severity === 'high'),
    checkedFiles: files.length,
    issues
  };
}

export function formatPrivacyCheckReport(result) {
  const lines = [
    'Token Work Privacy Check',
    `status=${result.ok ? 'ok' : 'blocked'}`,
    `checkedFiles=${result.checkedFiles}`,
    `issues=${result.issues.length}`
  ];
  if (!result.issues.length) {
    lines.push('No publish-blocking privacy issues found.');
    return lines.join('\n');
  }
  lines.push('');
  for (const item of result.issues) {
    lines.push(`- [${item.severity}] ${item.id}: ${item.file}`);
    lines.push(`  ${item.message}`);
    if (item.excerpt) lines.push(`  excerpt: ${item.excerpt}`);
  }
  return lines.join('\n');
}

function trackedFiles(cwd, includeUntracked) {
  const args = includeUntracked
    ? ['ls-files', '--cached', '--others', '--exclude-standard']
    : ['ls-files'];
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }
  return fallbackFiles(cwd);
}

function fallbackFiles(cwd) {
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    "Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\\\(node_modules|dist|data|\\.git)\\\\' } | ForEach-Object { Resolve-Path -Relative $_.FullName }"
  ], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\.[\\/]/, ''))
    .filter(Boolean);
}

function isReadableTextFile(path) {
  try {
    if (!existsSync(path) || statSync(path).size > 512 * 1024) return false;
    const lower = path.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    return TEXT_EXTENSIONS.has(ext) || !lower.includes('.');
  } catch {
    return false;
  }
}

function issue(pattern, file) {
  return {
    id: pattern.id,
    severity: pattern.severity,
    file: normalizePath(file),
    message: pattern.message
  };
}

function safeExcerpt(value) {
  return String(value).replace(/\s+/g, ' ').slice(0, 160);
}

function normalizePath(path) {
  return relative(process.cwd(), join(process.cwd(), path)).replace(/\\/g, '/');
}
