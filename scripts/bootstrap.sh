#!/usr/bin/env bash
# bootstrap.sh — one-time repo scaffold from ADR 0001 (Codex). No issue number.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_dev
# bootstrap prompt has no {{ISSUE}}; render with a dummy that won't match
sha="$(prompt_sha)"
PROMPT="$(sed "s/{{PROMPT_SHA}}/${sha}/g" "$PROMPTS_DIR/bootstrap.md")"
$CODEX_EXEC "$PROMPT"
