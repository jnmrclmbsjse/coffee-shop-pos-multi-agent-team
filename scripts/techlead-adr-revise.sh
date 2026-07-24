#!/usr/bin/env bash
# techlead-adr-revise.sh <story-issue-number> — revise an ADR after review.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human
ISSUE="${1:?Usage: techlead-adr-revise.sh <story-issue-number>}"
$CLAUDE_EXEC "$(render techlead-adr-revise.md "$ISSUE")"