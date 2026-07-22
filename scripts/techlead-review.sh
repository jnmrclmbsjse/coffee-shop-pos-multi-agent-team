#!/usr/bin/env bash
# techlead-review.sh <issue-number> — Tech Lead reviews the linked PR (Claude Code).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
ISSUE="${1:?Usage: techlead-review.sh <issue-number>}"
$CLAUDE_EXEC "$(render techlead-review.md "$ISSUE")"
