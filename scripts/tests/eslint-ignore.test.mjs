import path from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: repoRoot });

const ignoredPaths = [
  '.claude/worktrees/example/apps/web/src/transient.ts',
  '.claude/worktrees/example/.claude/session.ts',
  '.playwright/browser-state.js',
  '.playwright-mcp/session.js',
  'artifacts/discovery/session.js',
  'docs/discovery-artifacts/browser/session.js',
];

for (const relativePath of ignoredPaths) {
  const ignored = await eslint.isPathIgnored(path.join(repoRoot, relativePath));
  if (!ignored) {
    console.error(`FAIL: ESLint must ignore ${relativePath}`);
    process.exitCode = 1;
  }
}

const productPath = path.join(repoRoot, 'apps/web/src/main.tsx');
if (await eslint.isPathIgnored(productPath)) {
  console.error('FAIL: ESLint must continue to check product source files');
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log('ESLint ignore configuration tests passed');
}
