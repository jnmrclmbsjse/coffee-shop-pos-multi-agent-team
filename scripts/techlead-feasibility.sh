#!/usr/bin/env bash
# techlead-feasibility.sh <issue-number> — Tech Lead checks feasibility and
# breaks the story into Design/Dev/QA tasks (Claude Code).
#
# Spawned by po-prepare (Step 1). This wrapper exists so the Tech Lead charter
# is INJECTED: po-prepare used to hand-substitute ISSUE and PROMPT_SHA into the
# template itself, which cannot resolve {{CHARTER}} and would ship the literal
# placeholder to the engine — a lane running with no boundaries at all.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human
require_claude_auth
ISSUE="${1:?Usage: techlead-feasibility.sh <issue-number>}"
$CLAUDE_EXEC "$(render techlead-feasibility.md "$ISSUE" techlead)"
