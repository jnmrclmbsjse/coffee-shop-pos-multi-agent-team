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
CODEX_EXEC="codex --dangerously-bypass-approvals-and-sandbox exec"
CLAUDE_EXEC="claude --dangerously-skip-permissions -p"

# Open Design: the daemon must be running (desktop app open) before any design
# step. Its MCP server is registered in Codex's config.toml (see plan §6).

PROMPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../prompts" && pwd)"
source "$(dirname "${BASH_SOURCE[0]}")/dependency-utils.sh"

# Per-role GitHub identities.
# GH_TOKEN_DEV  — machine account (Dev agent authors PRs as this identity)
# GH_TOKEN_HUMAN — your personal account (Tech Lead review, QA, PO, merges)
# Export both in your shell profile; scripts select the right one per role.
: "${GH_TOKEN_HUMAN:=$(gh auth token 2>/dev/null || true)}"

as_dev()   { export GH_TOKEN="${GH_TOKEN_DEV:?GH_TOKEN_DEV not set}"; }
as_human() { export GH_TOKEN="${GH_TOKEN_HUMAN:?GH_TOKEN_HUMAN not set}"; }

prompt_sha() {
  git rev-parse --short HEAD -- "$PROMPTS_DIR" 2>/dev/null || echo "nogit"
}

# require_claude_auth — fail fast if the headless Claude session can't
# authenticate. A dead OAuth session makes `claude -p` print generic strings
# ("Failed to authenticate", "OAuth session expired") that poll.sh's
# classify_failure() reads as an issue-specific *environmental* failure — so it
# escalates and stamps `agent:human` on an innocent issue, and the whole board
# fills with false escalations while the real problem (the machine needs a human
# to `/login`) goes unnamed. Probe once, cheaply, before the expensive dispatch.
# On failure we exit 3 — a code OUTSIDE poll.sh's 0/124 handling — and print the
# AUTH_EXPIRED sentinel; poll.sh treats either signal as a machine-level halt,
# not a per-issue escalation. Call this right after the as_* identity line in
# every wrapper that shells out to $CLAUDE_EXEC.
require_claude_auth() {
  local out
  if ! out="$($CLAUDE_EXEC 'Reply with the single word OK and nothing else.' 2>&1)" \
     || ! printf '%s' "$out" | grep -qi 'ok'; then
    echo "AUTH_EXPIRED: Claude Code OAuth session is dead — run /login to re-authenticate." >&2
    printf '  probe output: %s\n' "${out:0:200}" >&2
    exit 3
  fi
}

# require_codex_auth — Codex-side twin of require_claude_auth. A dead Codex login
# makes `codex exec` fail with generic text that poll.sh's classify_failure()
# would read as a per-issue *environmental* failure — escalating and stamping
# `agent:human` on an innocent issue while the real problem (the machine needs a
# human to `codex login`) goes unnamed. Probe once, cheaply, before the dispatch.
# Same contract as the Claude probe: exit 3 + the AUTH_EXPIRED sentinel, which
# poll.sh treats as a machine-level halt, not a per-issue escalation. (If a
# lighter `codex login status`-style check exists in your Codex version, swap the
# probe for it — the exec turn here is chosen to match the proven Claude path and
# avoid guessing a subcommand.)
require_codex_auth() {
  local out
  if ! out="$($CODEX_EXEC 'Reply with the single word OK and nothing else.' 2>&1)" \
     || ! printf '%s' "$out" | grep -qi 'ok'; then
    echo "AUTH_EXPIRED: Codex session is dead — run 'codex login' to re-authenticate." >&2
    printf '  probe output: %s\n' "${out:0:200}" >&2
    exit 3
  fi
}

# select_agent [lane-override] — pick the coding engine (Claude Code or Codex)
# for a lane and prepare it. Resolution order, first non-empty wins:
#   1. the lane's own override (passed as $1, e.g. "${DISCOVERY_ENGINE:-}")
#   2. AGENT_ENGINE — global default for every lane that opts in
#   3. "claude"     — built-in default; preserves pre-swap behaviour
# Sets AGENT_EXEC to the resolved CLI and runs that engine's auth preflight, so a
# dead login halts the poller cleanly instead of being misclassified. Call once,
# right after the as_* identity line, then invoke `$AGENT_EXEC "$PROMPT"`.
select_agent() {
  local engine="${1:-}"
  engine="${engine:-${AGENT_ENGINE:-claude}}"
  case "$engine" in
    claude) AGENT_EXEC="$CLAUDE_EXEC"; require_claude_auth ;;
    codex)  AGENT_EXEC="$CODEX_EXEC"; require_codex_auth ;;
    *) echo "select_agent: unknown engine '$engine' (expected 'claude' or 'codex')" >&2; exit 2 ;;
  esac
  AGENT_ENGINE_RESOLVED="$engine"
  export AGENT_EXEC AGENT_ENGINE_RESOLVED
}

# render <template-name> <issue-number>  → prints the interpolated prompt
render() {
  local template="$1" issue="$2" sha
  sha="$(prompt_sha)"
  sed -e "s/{{ISSUE}}/${issue}/g" -e "s/{{PROMPT_SHA}}/${sha}/g" \
    "${PROMPTS_DIR}/${template}"
}
