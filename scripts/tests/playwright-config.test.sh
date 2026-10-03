#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
root_config="$repo_root/playwright.config.ts"
canonical_config="$repo_root/e2e/playwright.config.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -Fqx "export { default } from './e2e/playwright.config';" "$root_config" ||
  fail "the root Playwright config must delegate to e2e/playwright.config.ts"

grep -Eq '^[[:space:]]*testDir:[[:space:]]*__dirname,' "$canonical_config" ||
  fail "the canonical test directory must resolve independently of its entry point"

grep -Eq '^[[:space:]]*fullyParallel:[[:space:]]*false,' "$canonical_config" ||
  fail "the canonical E2E config must disable full parallelism"

grep -Eq '^[[:space:]]*workers:[[:space:]]*1,' "$canonical_config" ||
  fail "the canonical E2E config must use one worker for the shared database"

grep -Fq "http://localhost:" "$canonical_config" ||
  fail "the canonical E2E config must default to a localhost web origin"

grep -Eq 'E2E_WEB_PORT \?\? 5173' "$canonical_config" ||
  fail "the default E2E web port must match the API default CORS origin"

if grep -Fq "http://127.0.0.1:" "$canonical_config"; then
  fail "the canonical E2E config must not mix 127.0.0.1 with localhost defaults"
fi

echo "Playwright configuration tests passed"
