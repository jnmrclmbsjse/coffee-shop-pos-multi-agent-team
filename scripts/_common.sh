#!/usr/bin/env bash
# _common.sh — sourced by all wrapper scripts. Not run directly.
#
# Fill these two in from your installed tool versions' docs (see
# prompts/_conventions.md). These are the ONLY hard-coded CLI facts; everything
# else is prompt-driven.
#
# Examples (VERIFY against your versions — flags change):
#   CODEX_EXEC="codex exec"
#   CLAUDE_EXEC="claude -p"
# Add model/permission/sandbox flags as needed, e.g.:
#   CODEX_EXEC="codex exec --sandbox workspace-write"
#   CLAUDE_EXEC="claude -p --permission-mode acceptEdits"
CODEX_EXEC="${CODEX_EXEC:-codex exec}"
CLAUDE_EXEC="${CLAUDE_EXEC:-claude -p}"

# Open Design: the daemon must be running (desktop app open) before any design
# step. Its MCP server is registered in Codex's config.toml (see plan §6).

PROMPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../prompts" && pwd)"

prompt_sha() {
  git rev-parse --short HEAD -- "$PROMPTS_DIR" 2>/dev/null || echo "nogit"
}

# render <template-name> <issue-number>  → prints the interpolated prompt
render() {
  local template="$1" issue="$2" sha
  sha="$(prompt_sha)"
  sed -e "s/{{ISSUE}}/${issue}/g" -e "s/{{PROMPT_SHA}}/${sha}/g" \
    "${PROMPTS_DIR}/${template}"
}
