#!/usr/bin/env bash
# uiux-mockup.sh <issue-number> — produce the UI/UX design reference for a story.
# Spawned by po-prepare (Step 3) once acceptance criteria have passed QA
# testability. The sub-agent writes under docs/design/mockups/issue-<n>/ and
# self-reports the `design:done` marker.
#
# MODE (first match wins):
#   DESIGN_MODE=spec|open-design         — explicit override
#   the story's Design Task is labeled `design:net-new` — a genuinely new screen
#   otherwise                            — spec mode (default)
#
# Spec mode is the default on purpose. This app has settled patterns (the shared
# shell, styles.css, the existing feature screens). For incremental work — a
# column, a filter, a dialog, a field — a generated HTML mockup invents a look
# that then has to be argued back down to the existing components, which is the
# drift docs/ui-reconciliation.md exists to clean up after. Open Design earns
# its cost on a net-new screen, where there is no existing pattern to cite. The
# Tech Lead decides which at breakdown and carries `open-design` as the label.
#
# ENGINE: runs under Claude Code or Codex, selected by (first set wins)
#   DESIGN_ENGINE  → AGENT_ENGINE  → "claude" (default; matches discovery).
#   e.g.  DESIGN_ENGINE=codex ./scripts/uiux-mockup.sh 108
#
# PREREQ for open-design mode ONLY: the Open Design desktop app (daemon) must be
# running — the prompt guards for this and fails clean (rule B) if it's down.
# Also: whichever engine you pick must have the `open-design` MCP server
# configured (it lives in Codex's config.toml today; a Claude-engine run needs it
# in Claude's MCP config). Spec mode needs neither.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human

ISSUE="${1:?Usage: uiux-mockup.sh <issue-number>}"

MODE="$(resolve_design_mode "$ISSUE")" || exit 1
export DESIGN_MODE="$MODE"
echo "design mode: $MODE"

select_agent "${DESIGN_ENGINE:-}"   # sets AGENT_EXEC and runs the engine's auth preflight

# {{DESIGN_MODE}} is substituted after render(), the same way po-intake fills
# its own placeholders: render() knows nothing about modes.
PROMPT="$(render uiux-mockup.md "$ISSUE" uiux)"
PROMPT="${PROMPT//\{\{DESIGN_MODE\}\}/$MODE}"

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

# Land the design PR HERE, not from inside the agent prompt. The agent has no
# merge path of its own (see charters/uiux.md): it opens the PR and stops. Only
# a run that wrote the design:done marker above reaches this line, and
# auto_merge_story_pr additionally refuses anything red, unsettled,
# conflicting, or ambiguous — leaving those for a human instead of arming a
# merge that fires unattended whenever CI eventually goes green.
auto_merge_story_pr uiux "$ISSUE"
