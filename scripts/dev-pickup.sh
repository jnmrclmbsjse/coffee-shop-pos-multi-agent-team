#!/usr/bin/env bash
# dev-pickup.sh <issue-number> — Dev implements a task / bug (Codex).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_dev
ISSUE="${1:?Usage: dev-pickup.sh <issue-number>}"
$CODEX_EXEC "$(render dev-pickup.md "$ISSUE")"
