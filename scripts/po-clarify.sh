#!/usr/bin/env bash
# po-clarify.sh <issue-number> — PO answers an agent's clarification question.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human
ISSUE="${1:?Usage: po-clarify.sh <issue-number>}"
$CODEX_EXEC "$(render po-clarify.md "$ISSUE")"