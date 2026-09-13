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
CHARTERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../charters" && pwd)"
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

# auto_merge_story_pr <role> <story-issue> — land a lane's own PR, CI-gated.
#
# WHY THIS EXISTS. The design lane used to enable auto-merge from inside the
# AGENT prompt (`gh pr merge --auto --squash`). Because `master` requires 0
# approving reviews, `--auto` had nothing outstanding to wait for beyond CI, so
# every design PR in the history merged with zero reviews — the agent armed the
# merge on its own work and walked away. Merging from the wrapper instead means
# the agent holds no merge path at all, and a PR that is red or conflicting is
# left for a human rather than sitting armed to fire whenever it goes green.
#
# This is a CI GATE, NOT A CONTENT REVIEW. It does not read the diff. It only
# refuses to merge something that is failing, unsettled, conflicting, or
# ambiguous.
auto_merge_story_pr() {
  local role="$1"
  local story="$2"
  local pr n body files scope_prefix checks mergeable matched=0 multi=0

  # The file scope is what actually identifies the PR. A QA task and a design
  # task for the SAME STORY produce two different PRs that both legitimately
  # reference it, so matching on the story alone picks whichever gh lists first
  # — sometimes the wrong one.
  case "$role" in
    qa)   scope_prefix="e2e/" ;;
    uiux) scope_prefix="docs/design/" ;;
    *)    echo "auto-merge: unknown role '$role' — refusing to guess a scope." >&2; return 0 ;;
  esac

  while read -r n; do
    [[ -z "$n" ]] && continue
    body="$(gh pr view "$n" --json body -q '.body' 2>/dev/null || true)"
    # EXACT match on the whole reference, not a substring: "#84" must not match
    # a PR that actually references "#840".
    grep -oE '#[0-9]+' <<<"$body" | grep -Fxq "#${story}" || continue

    files="$(gh pr view "$n" --json files -q '.files[].path' 2>/dev/null || true)"
    [[ -z "$files" ]] && continue
    # ALL changed files must sit under the role's scope, not merely one of them.
    # A PR touching docs/design/ AND something else is not the clean
    # scope-limited PR the write boundary is supposed to guarantee.
    if ! grep -qv "^${scope_prefix}" <<<"$files"; then
      matched=$(( matched + 1 ))
      if [[ -z "${pr:-}" ]]; then pr="$n"; else multi=1; fi
    fi
  done < <(gh pr list --state open --author "@me" --json number -q '.[].number' 2>/dev/null || true)

  if (( multi )); then
    echo "auto-merge: ${matched} open PRs reference #${story} within ${scope_prefix} — ambiguous, leaving all of them for a human." >&2
    return 0
  fi
  if [[ -z "${pr:-}" ]]; then
    echo "auto-merge: no open PR references #${story} within ${scope_prefix} — nothing to merge (already merged, or none was required)." >&2
    return 0
  fi

  # `gh pr checks` exits non-zero while anything is pending or failing, so the
  # `|| true` is load-bearing under `set -e`: we want to INSPECT the buckets,
  # not die on them. That also means the exit code cannot tell "red CI" from
  # "gh itself failed", so the gate FAILS CLOSED on stdout alone: empty output,
  # invalid JSON, an empty list, or any non-pass bucket all refuse the merge.
  checks="$(gh pr checks "$pr" --json bucket 2>/dev/null || true)"
  if [[ -z "$checks" ]] || ! python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ok = isinstance(d, list) and len(d) > 0 and all(isinstance(c, dict) and c.get('bucket') == 'pass' for c in d)
except Exception:
    ok = False
sys.exit(0 if ok else 1)" <<<"$checks" 2>/dev/null; then
    echo "auto-merge: #${pr} has non-passing or unsettled checks — leaving it for a human." >&2
    return 0
  fi
  mergeable="$(gh pr view "$pr" --json mergeable -q .mergeable 2>/dev/null || true)"
  if [[ "$mergeable" != "MERGEABLE" ]]; then
    echo "auto-merge: #${pr} is not cleanly mergeable (${mergeable:-unknown}) — leaving it for a human." >&2
    return 0
  fi

  # Merge and branch-delete are SEPARATE calls on purpose. Combined as
  # `--squash --delete-branch`, a branch that cannot be deleted makes gh return
  # non-zero AFTER the merge already landed, which under `set -e` aborts the
  # caller and reports failure for work that actually succeeded. This repo has
  # `delete_branch_on_merge: false`, so the delete is a real, separate step.
  if ! gh pr merge "$pr" --squash >/dev/null 2>&1; then
    echo "auto-merge: #${pr} merge attempt FAILED — leaving it for a human." >&2
    return 0
  fi
  echo "auto-merge: #${pr} merged (${role}, references #${story}, checks green)." >&2
  gh pr view "$pr" --json headRefName -q .headRefName 2>/dev/null \
    | while read -r br; do
        [[ -z "$br" ]] && continue
        gh api -X DELETE "repos/:owner/:repo/git/refs/heads/${br}" >/dev/null 2>&1 \
          && echo "auto-merge: deleted branch ${br}." >&2 \
          || echo "auto-merge: branch ${br} not deleted (harmless; the merge stands)." >&2
      done
}

# charter <role>  → prints _shared.md followed by that role's charter
#
# A charter belongs to a ROLE. The engine is swappable; the role is not. Codex
# runs the PO, Dev and Deploy lanes and Claude runs Tech Lead and QA, but that
# is a scheduling fact, not a boundary — so charters are keyed on the role and
# injected, never discovered by file name.
charter() {
  # SPLIT ASSIGNMENTS. bash expands an entire `local` line before it assigns any
  # of it, so `local role="$1" own=".../${role}.md"` reads an EMPTY role and
  # silently resolves to `charters/.md`.
  local role="$1"
  local shared="$CHARTERS_DIR/_shared.md"
  local own="$CHARTERS_DIR/${role}.md"
  if [[ ! -f "$own" ]]; then
    echo "charter: no charter for role '$role' — expected $own" >&2
    return 1
  fi
  cat "$shared" "$own"
}

# render <template-name> <issue-number> [role]  → prints the interpolated prompt
#
# When <role> is given, {{CHARTER}} is replaced by that role's charter. A
# template containing {{CHARTER}} that is rendered WITHOUT a role is a wiring
# bug and fails loudly: shipping the literal text "{{CHARTER}}" to an engine
# would run the lane with no boundaries at all, silently, which is the exact
# failure this mechanism exists to end.
render() {
  local template="$1"
  local issue="$2"
  local role="${3:-}"
  local sha body
  sha="$(prompt_sha)"
  body="$(sed -e "s/{{ISSUE}}/${issue}/g" -e "s/{{PROMPT_SHA}}/${sha}/g" \
    "${PROMPTS_DIR}/${template}")"

  if [[ "$body" != *"{{CHARTER}}"* ]]; then
    printf '%s\n' "$body"
    return 0
  fi
  if [[ -z "$role" ]]; then
    echo "render: ${template} contains {{CHARTER}} but no role was passed" >&2
    echo "        the lane would run with no charter — refusing" >&2
    return 1
  fi
  local text; text="$(charter "$role")" || return 1
  # python, not sed: the charter is a multi-line document full of pipes,
  # slashes, and ampersands, every one of which sed would treat as syntax.
  CHARTER_TEXT="$text" BODY="$body" python3 -c 'import os; print(os.environ["BODY"].replace("{{CHARTER}}", os.environ["CHARTER_TEXT"]))'
}
