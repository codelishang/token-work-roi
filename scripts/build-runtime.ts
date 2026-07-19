import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = resolve(root, 'dist-runtime');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const sourceFiles = listSourceFiles(resolve(root, 'src'));

for (const source of sourceFiles) {
  const target = resolve(outRoot, source.replace(/^src\//, '').replace(/\.ts$/u, '.mjs'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, toRuntimeModule(readFileSync(resolve(root, source), 'utf8'), source));
}

function toRuntimeModule(text: string, fileName: string) {
  const result = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    },
    fileName,
    reportDiagnostics: true
  });
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) || [];
  if (errors.length) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n'
    }));
  }
  return result.outputText
    .replace(/((?:from\s+|import\s*\(\s*)['"][^'"]+?)\.ts(['"]\s*\)?)/gu, '$1.mjs$2')
    .replace(/(['"])src\/cli\.ts\1/gu, '$1dist-runtime/cli.mjs$1')
    .replace(/(['"])src\/server\.ts\1/gu, '$1dist-runtime/server.mjs$1')
    .replace(/(['"])src\/collect\.ts\1/gu, '$1dist-runtime/collect.mjs$1')
    .replace(/(['"])(\.\/collectors\/[^'"]+)\.ts\1/gu, '$1$2.mjs$1')
    .replace(/resolve\(SOURCE_DIR,\s*'server\.ts'\)/gu, "resolve(SOURCE_DIR, 'server.mjs')")
    .replace(/resolve\(SOURCE_DIR,\s*'collect\.ts'\)/gu, "resolve(SOURCE_DIR, 'collect.mjs')")
    .replace(/resolve\(process\.cwd\(\),\s*'src',\s*'collect\.ts'\)/gu, "resolve(process.cwd(), 'dist-runtime', 'collect.mjs')");
}

function listSourceFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...listSourceFiles(path));
    } else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
      entries.push(relative(root, path).replace(/\\/gu, '/'));
    }
  }
  return entries;
}
