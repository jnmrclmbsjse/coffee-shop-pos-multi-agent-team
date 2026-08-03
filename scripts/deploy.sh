#!/usr/bin/env bash
# deploy.sh <issue-number> — trigger + watch the production deploy, report the
# outcome (Claude Code). Mirrors qa-test.sh; see prompts/deploy.md.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human
require_claude_auth
ISSUE="${1:?Usage: deploy.sh <issue-number>}"
$CLAUDE_EXEC "$(render deploy.md "$ISSUE")"
