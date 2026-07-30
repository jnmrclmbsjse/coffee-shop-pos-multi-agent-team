#!/usr/bin/env bash
# uiux-mockup.sh <issue-number> — generate the UI/UX design for a story.
# Spawned by po-prepare (Step 3) once acceptance criteria have passed QA
# testability. The sub-agent drives Open Design via its MCP server and writes
# mockups under docs/design/; it self-reports the `design:done` marker.
#
# ENGINE: runs under Claude Code or Codex, selected by (first set wins)
#   DESIGN_ENGINE  → AGENT_ENGINE  → "claude" (default; matches discovery).
#   e.g.  DESIGN_ENGINE=codex ./scripts/uiux-mockup.sh 108
#
# PREREQ: the Open Design desktop app (daemon) must be running — the mockup
# prompt guards for this and fails clean (rule B) if it's down. Also: whichever
# engine you pick must have the `open-design` MCP server configured (it lives in
# Codex's config.toml today; a Claude-engine run needs it in Claude's MCP config).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human

ISSUE="${1:?Usage: uiux-mockup.sh <issue-number>}"

select_agent "${DESIGN_ENGINE:-}"   # sets AGENT_EXEC and runs the engine's auth preflight

$AGENT_EXEC "$(render uiux-mockup.md "$ISSUE")"
