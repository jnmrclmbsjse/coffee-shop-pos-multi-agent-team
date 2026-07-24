#!/usr/bin/env bash
# discovery.sh — explore v1 and feed requirements to PO.
# Takes no issue number; it picks its own area from DISCOVERY.md vs findings.
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

sha="$(prompt_sha)"
PROMPT="$(sed "s/{{PROMPT_SHA}}/${sha}/g" "$PROMPTS_DIR/discovery.md")"

$CLAUDE_EXEC "$PROMPT"