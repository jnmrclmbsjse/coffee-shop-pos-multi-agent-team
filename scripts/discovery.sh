#!/usr/bin/env bash
# discovery.sh — explore v1 and feed requirements to PO.
# Takes no issue number; it picks its own area from DISCOVERY.md vs findings.
#
# ENGINE: runs under Claude Code or Codex, selected by (first set wins)
#   DISCOVERY_ENGINE  → AGENT_ENGINE  → "claude" (default; current behaviour).
#   e.g.  DISCOVERY_ENGINE=codex ./scripts/discovery.sh
#
# Requires in your shell profile:
#   export V1_URL="http://localhost:3000"
#   export V1_USERNAME="..."
#   export V1_PASSWORD="..."
#
# SAFETY: point V1_URL at a dev/test instance, NOT production. This agent
# browses autonomously; a live POS holds real sales and inventory data.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human

: "${V1_URL:?Set V1_URL (e.g. http://localhost:3000)}"
: "${V1_USERNAME:?Set V1_USERNAME}"
: "${V1_PASSWORD:?Set V1_PASSWORD}"

[[ -f DISCOVERY.md ]] || { echo "DISCOVERY.md not found at repo root — it is the map this agent needs."; exit 1; }

select_agent "${DISCOVERY_ENGINE:-}"   # sets AGENT_EXEC and runs the engine's auth preflight

sha="$(prompt_sha)"
# Discovery has no issue number, so it does not go through render(). Inject the
# charter here or the template's {{CHARTER}} ships as literal text — and this is
# the one lane that touches something outside the team's own output, so its
# read-only boundary is the last one that should go missing.
CHARTER_TEXT="$(charter discovery)" || exit 1
PROMPT="$(BODY="$(sed "s/{{PROMPT_SHA}}/${sha}/g" "$PROMPTS_DIR/discovery.md")" \
  CHARTER_TEXT="$CHARTER_TEXT" \
  python3 -c 'import os; print(os.environ["BODY"].replace("{{CHARTER}}", os.environ["CHARTER_TEXT"]))')"

$AGENT_EXEC "$PROMPT"