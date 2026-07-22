#!/usr/bin/env bash
# qa-test.sh <issue-number> — QA writes/runs e2e, accepts or rejects (Claude Code).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
ISSUE="${1:?Usage: qa-test.sh <issue-number>}"
$CLAUDE_EXEC "$(render qa-test.md "$ISSUE")"
