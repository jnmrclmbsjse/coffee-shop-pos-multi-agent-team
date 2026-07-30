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
PROMPT="$(sed "s/{{PROMPT_SHA}}/${sha}/g" "$PROMPTS_DIR/discovery.md")"

$AGENT_EXEC "$PROMPT"