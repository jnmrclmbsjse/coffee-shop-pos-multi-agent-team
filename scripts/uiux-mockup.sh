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

PROMPT="$(render uiux-mockup.md "$ISSUE")"

# Claude Code may automatically delegate a long design run to a background
# sub-agent. In print mode the parent can then exit 0 after a progress update,
# while the delegated work is still running (or becomes orphaned). po-prepare
# correctly treats the missing design marker as failure, but that turns an
# engine scheduling choice into a false story escalation. Keep any Claude
# sub-agent work synchronous so this wrapper does not return before it has been
# collected and self-reported. Codex has no equivalent setting and is unchanged.
if [[ "$AGENT_ENGINE_RESOLVED" == "claude" ]]; then
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 $AGENT_EXEC "$PROMPT"
else
  $AGENT_EXEC "$PROMPT"
fi

# Exit code 0 means only that the CLI turn ended. The durable success contract
# for this workflow is the exact HTML completion marker on the story. Enforce it
# here as a second line of defence so callers can never mistake a progress-only
# response for a completed design pass.
if ! gh issue view "$ISSUE" --json comments \
    -q '[.comments[].body] | join("\n")' 2>/dev/null \
    | grep -q '<!-- OD-PREPARE:design:done'; then
  echo "DESIGN ERROR — engine exited without writing the design:done marker for #$ISSUE" >&2
  exit 1
fi
