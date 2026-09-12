#!/usr/bin/env bash
# qa-testability.sh <issue-number> — QA reviews acceptance criteria for
# testability, clarity, and edge-case coverage (Claude Code).
#
# Spawned by po-prepare (Step 2), once per attempt of the testability loop.
# Exists for the same reason as techlead-feasibility.sh: the charter must be
# injected by render(), not hand-substituted by the calling agent.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human
require_claude_auth
ISSUE="${1:?Usage: qa-testability.sh <issue-number>}"
$CLAUDE_EXEC "$(render qa-testability.md "$ISSUE" qa)"
