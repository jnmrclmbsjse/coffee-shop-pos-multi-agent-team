#!/usr/bin/env bash
# po-prepare.sh <issue-number> — run the In Preparation convergence (Codex).
# Codex orchestrates; it shells out to Claude Code (feasibility, testability)
# and to Codex-via-Open-Design (design) itself, per the prompt.
# PREREQ: Open Design desktop app (daemon) running, for the design step.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
ISSUE="${1:?Usage: po-prepare.sh <issue-number>}"
$CODEX_EXEC "$(render po-prepare.md "$ISSUE")"
