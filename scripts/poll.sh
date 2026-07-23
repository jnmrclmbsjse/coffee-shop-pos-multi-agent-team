#!/usr/bin/env bash
# poll.sh [role ...] — watch the GitHub board and dispatch agents.
#
#   ./scripts/poll.sh dev                 # Dev only (recommended to start)
#   ./scripts/poll.sh dev qa              # Dev + QA
#   ./scripts/poll.sh dev qa tech-lead    # everything
#   DRY_RUN=1 ./scripts/poll.sh dev       # show what WOULD dispatch, run nothing
#
# Behaviour:
#   - polls `gh issue list` every POLL_INTERVAL seconds
#   - skips issues labeled `blocked` or `agent:human`
#   - dev/qa run ONE AT A TIME (atomic lock); tech-lead may run concurrently
#   - every dispatch is logged to logs/<role>-<issue>-<timestamp>.log
#   - an issue that fails MAX_ATTEMPTS times is labeled `agent:human` and skipped
#
# Stop with Ctrl-C. Locks are released on exit.
set -uo pipefail   # NOTE: deliberately no -e; a failed dispatch must not kill the loop

cd "$(dirname "$0")/.." || exit 1
source "scripts/_common.sh"

POLL_INTERVAL="${POLL_INTERVAL:-60}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-2}"
DRY_RUN="${DRY_RUN:-0}"
LOG_DIR="logs"
STATE_DIR=".poll-state"
mkdir -p "$LOG_DIR" "$STATE_DIR"

ROLES=("${@:-dev}")

# role → label, wrapper script, single-instance?
label_for()  { case "$1" in dev) echo agent:dev;; qa) echo agent:qa;; tech-lead) echo agent:tech-lead;; esac; }
script_for() { case "$1" in dev) echo scripts/dev-pickup.sh;; qa) echo scripts/qa-test.sh;; tech-lead) echo scripts/techlead-review.sh;; esac; }
single_for() { case "$1" in dev|qa) echo 1;; tech-lead) echo 0;; esac; }

# ---------- atomic lock (mkdir is atomic; `[ -f ]` + touch is NOT) ----------
acquire_lock() {
  # NOTE: split assignments — bash expands the whole `local` line before
  # assigning, so `local a="$1" b="$a"` leaves b empty. Bit us once already.
  local role="$1"
  local lockdir="$STATE_DIR/$role.lock"
  if mkdir "$lockdir" 2>/dev/null; then
    echo $$ > "$lockdir/pid"
    return 0
  fi
  # stale lock? (holder died without cleaning up)
  local pid; pid="$(cat "$lockdir/pid" 2>/dev/null || echo "")"
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    echo "    [lock] clearing stale $role lock (pid $pid gone)"
    rm -rf "$lockdir"
    mkdir "$lockdir" 2>/dev/null && { echo $$ > "$lockdir/pid"; return 0; }
  fi
  return 1
}
release_lock() { rm -rf "$STATE_DIR/$1.lock"; }

cleanup() { echo; echo "Stopping. Releasing locks…"; for r in "${ROLES[@]}"; do release_lock "$r"; done; exit 0; }
trap cleanup INT TERM

# ---------- attempt tracking: never retry the same issue forever ----------
attempts_of() { cat "$STATE_DIR/attempts-$1" 2>/dev/null || echo 0; }
bump_attempt() { echo $(( $(attempts_of "$1") + 1 )) > "$STATE_DIR/attempts-$1"; }
clear_attempt() { rm -f "$STATE_DIR/attempts-$1"; }

dispatch() {
  local role="$1" issue="$2"
  local script; script="$(script_for "$role")"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local log="$LOG_DIR/${role}-${issue}-${ts}.log"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] would run: $script $issue"
    return 0
  fi

  echo "    → dispatching $script $issue  (log: $log)"
  bump_attempt "$issue"
  if "$script" "$issue" >"$log" 2>&1; then
    echo "    ✓ #$issue completed  ($log)"
    clear_attempt "$issue"
  else
    local n; n="$(attempts_of "$issue")"
    echo "    ✗ #$issue failed (attempt $n/$MAX_ATTEMPTS) — see $log"
    if (( n >= MAX_ATTEMPTS )); then
      echo "    !! escalating #$issue to agent:human after $n failures"
      gh issue edit "$issue" --add-label agent:human >/dev/null 2>&1
      gh issue comment "$issue" --body \
        "Poller escalation: dispatch failed $n times. Last log: \`$log\`. Needs a human." >/dev/null 2>&1
      clear_attempt "$issue"
    fi
  fi
}

poll_role() {
  local role="$1" label; label="$(label_for "$role")"

  # issues wanting this agent, minus ones that are blocked or escalated
  local candidates
  candidates="$(gh issue list --state open --label "$label" \
      --json number,labels --limit 100 \
      -q '[ .[]
            | select( (.labels | map(.name)) as $l
                      | ($l | index("blocked") | not)
                      and ($l | index("agent:human") | not) )
            | .number ] | .[]' 2>/dev/null)"

  [[ -z "$candidates" ]] && return 0

  local single; single="$(single_for "$role")"
  while read -r issue; do
    [[ -z "$issue" ]] && continue

    if (( $(attempts_of "$issue") >= MAX_ATTEMPTS )); then continue; fi

    if [[ "$single" == "1" ]]; then
      if acquire_lock "$role"; then
        echo "  [$role] claimed #$issue"
        dispatch "$role" "$issue"
        release_lock "$role"
        return 0          # one at a time: re-poll fresh next cycle
      else
        echo "  [$role] busy — #$issue waits"
        return 0
      fi
    else
      echo "  [$role] #$issue (concurrent)"
      dispatch "$role" "$issue"
    fi
  done <<< "$candidates"
}

echo "poll.sh watching: ${ROLES[*]}"
echo "  interval=${POLL_INTERVAL}s  max-attempts=${MAX_ATTEMPTS}  dry-run=${DRY_RUN}"
echo "  logs → $LOG_DIR/   state → $STATE_DIR/"
echo "  Ctrl-C to stop."
echo

while true; do
  echo "[$(date +%H:%M:%S)] polling…"
  for role in "${ROLES[@]}"; do poll_role "$role"; done
  sleep "$POLL_INTERVAL"
done