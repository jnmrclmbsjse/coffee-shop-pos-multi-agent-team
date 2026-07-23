#!/usr/bin/env bash
# poll.sh [role ...] — watch the GitHub board and dispatch agents.
#
#   ./scripts/poll.sh dev                 # Dev only
#   ./scripts/poll.sh dev qa tech-lead    # everything
#   DRY_RUN=1 ./scripts/poll.sh dev       # show what WOULD dispatch
#
# GUARDS (all overridable by env):
#   POLL_INTERVAL=60        seconds between cycles
#   MAX_ATTEMPTS=2          consecutive failures for one issue before escalating
#   MAX_DISPATCHES=6        TOTAL dispatches for one issue before cycle-stop
#   DISPATCH_TIMEOUT=1800   seconds a single agent run may take (0 = no limit)
#   MAX_SESSION_HOURS=8     total poller runtime before graceful stop
#   MAX_PER_HOUR=20         dispatches per rolling hour across all roles
#
# KILL SWITCH: `touch .poll-stop` — stops after the current dispatch finishes.
#              Remove the file before starting again.
set -uo pipefail   # deliberately no -e: a failed dispatch must not kill the loop

cd "$(dirname "$0")/.." || exit 1
source "scripts/_common.sh"

POLL_INTERVAL="${POLL_INTERVAL:-60}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-2}"
MAX_DISPATCHES="${MAX_DISPATCHES:-6}"
DISPATCH_TIMEOUT="${DISPATCH_TIMEOUT:-1800}"
MAX_SESSION_HOURS="${MAX_SESSION_HOURS:-8}"
MAX_PER_HOUR="${MAX_PER_HOUR:-20}"
DRY_RUN="${DRY_RUN:-0}"

LOG_DIR="logs"; STATE_DIR=".poll-state"; STOP_FILE=".poll-stop"
mkdir -p "$LOG_DIR" "$STATE_DIR"
SESSION_START=$(date +%s)
RATE_LOG="$STATE_DIR/dispatch-times"

ROLES=("${@:-dev}")

# macOS ships no `timeout`; coreutils provides `gtimeout`.
TIMEOUT_BIN=""
command -v timeout  >/dev/null 2>&1 && TIMEOUT_BIN="timeout"
[[ -z "$TIMEOUT_BIN" ]] && command -v gtimeout >/dev/null 2>&1 && TIMEOUT_BIN="gtimeout"

label_for()  { case "$1" in dev) echo agent:dev;; qa) echo agent:qa;; tech-lead) echo agent:tech-lead;; esac; }
script_for() { case "$1" in dev) echo scripts/dev-pickup.sh;; qa) echo scripts/qa-test.sh;; tech-lead) echo scripts/techlead-review.sh;; esac; }
single_for() { case "$1" in dev|qa) echo 1;; tech-lead) echo 0;; esac; }

# ---------- atomic lock ----------
acquire_lock() {
  # split assignments — bash expands the whole `local` line before assigning
  local role="$1"
  local lockdir="$STATE_DIR/$role.lock"
  if mkdir "$lockdir" 2>/dev/null; then echo $$ > "$lockdir/pid"; return 0; fi
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

# ---------- counters (files, not arrays — macOS bash 3.2 has no `declare -A`) ----------
_get() { cat "$STATE_DIR/$1" 2>/dev/null || echo 0; }
_bump() { echo $(( $(_get "$1") + 1 )) > "$STATE_DIR/$1"; }

attempts_of()   { _get "attempts-$1"; }      # consecutive failures, reset on success
dispatches_of() { _get "dispatches-$1"; }    # TOTAL dispatches ever — cycle detection

# ---------- rate limit: dispatches in the last rolling hour ----------
rate_ok() {
  local now cutoff count
  now=$(date +%s); cutoff=$(( now - 3600 ))
  [[ -f "$RATE_LOG" ]] || return 0
  # keep only recent entries, then count
  awk -v c="$cutoff" '$1 > c' "$RATE_LOG" > "$RATE_LOG.tmp" 2>/dev/null && mv "$RATE_LOG.tmp" "$RATE_LOG"
  count=$(wc -l < "$RATE_LOG" | tr -d ' ')
  (( count < MAX_PER_HOUR ))
}
rate_record() { date +%s >> "$RATE_LOG"; }

# ---------- guards checked each cycle ----------
should_stop() {
  if [[ -f "$STOP_FILE" ]]; then
    echo "!! kill switch ($STOP_FILE) present — stopping."
    rm $STOP_FILE
    echo "Removed $STOP_FILE"
    return 0
  fi
  local elapsed_h=$(( ( $(date +%s) - SESSION_START ) / 3600 ))
  if (( MAX_SESSION_HOURS > 0 && elapsed_h >= MAX_SESSION_HOURS )); then
    echo "!! session budget reached (${MAX_SESSION_HOURS}h) — stopping."
    return 0
  fi
  return 1
}

escalate() {
  local issue="$1" why="$2"
  echo "    !! escalating #$issue — $why"
  gh issue edit "$issue" --add-label agent:human >/dev/null 2>&1
  gh issue comment "$issue" --body "Poller escalation: $why. Needs a human." >/dev/null 2>&1
  rm -f "$STATE_DIR/attempts-$issue"
}

dispatch() {
  local role="$1" issue="$2"
  local script ts log
  script="$(script_for "$role")"
  ts="$(date +%Y%m%d-%H%M%S)"
  log="$LOG_DIR/${role}-${issue}-${ts}.log"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] would run: $script $issue"
    return 0
  fi

  _bump "dispatches-$issue"
  rate_record
  echo "    → $script $issue  (log: $log)"

  local rc
  if [[ -n "$TIMEOUT_BIN" && "$DISPATCH_TIMEOUT" != "0" ]]; then
    "$TIMEOUT_BIN" "$DISPATCH_TIMEOUT" "$script" "$issue" >"$log" 2>&1; rc=$?
  else
    "$script" "$issue" >"$log" 2>&1; rc=$?
  fi

  if (( rc == 0 )); then
    echo "    ✓ #$issue completed"
    rm -f "$STATE_DIR/attempts-$issue"
  elif (( rc == 124 )); then
    echo "    ✗ #$issue TIMED OUT after ${DISPATCH_TIMEOUT}s"
    escalate "$issue" "agent run exceeded ${DISPATCH_TIMEOUT}s (log: $log)"
  else
    _bump "attempts-$issue"
    local n; n="$(attempts_of "$issue")"
    echo "    ✗ #$issue failed (attempt $n/$MAX_ATTEMPTS) — see $log"
    (( n >= MAX_ATTEMPTS )) && escalate "$issue" "dispatch failed $n times (log: $log)"
  fi
}

poll_role() {
  local role="$1" label candidates single
  label="$(label_for "$role")"
  candidates="$(gh issue list --state open --label "$label" \
      --json number,labels --limit 100 \
      -q '[ .[] | select( (.labels|map(.name)) as $l
              | ($l|index("blocked")|not) and ($l|index("agent:human")|not) )
            | .number ] | .[]' 2>/dev/null)"
  [[ -z "$candidates" ]] && return 0
  single="$(single_for "$role")"

  while read -r issue; do
    [[ -z "$issue" ]] && continue
    (( $(attempts_of "$issue") >= MAX_ATTEMPTS )) && continue

    # cycle detection: an issue dispatched many times is ping-ponging between roles
    if (( $(dispatches_of "$issue") >= MAX_DISPATCHES )); then
      escalate "$issue" "dispatched $(dispatches_of "$issue") times without resolving — likely a loop"
      rm -f "$STATE_DIR/dispatches-$issue"
      continue
    fi

    if ! rate_ok; then
      echo "  [$role] rate limit ($MAX_PER_HOUR/hr) reached — pausing dispatches"
      return 0
    fi

    if [[ "$single" == "1" ]]; then
      if acquire_lock "$role"; then
        echo "  [$role] claimed #$issue"
        dispatch "$role" "$issue"
        release_lock "$role"
        return 0                       # one at a time; re-poll fresh next cycle
      else
        echo "  [$role] busy — #$issue waits"; return 0
      fi
    else
      echo "  [$role] #$issue"
      dispatch "$role" "$issue"
    fi
  done <<< "$candidates"
}

echo "poll.sh watching: ${ROLES[*]}"
echo "  interval=${POLL_INTERVAL}s  attempts=${MAX_ATTEMPTS}  max-dispatches/issue=${MAX_DISPATCHES}"
echo "  dispatch-timeout=${DISPATCH_TIMEOUT}s  session=${MAX_SESSION_HOURS}h  rate=${MAX_PER_HOUR}/hr"
echo "  dry-run=${DRY_RUN}  timeout-bin=${TIMEOUT_BIN:-none (no per-run timeout!)}"
echo "  logs → $LOG_DIR/   state → $STATE_DIR/   kill switch → touch $STOP_FILE"
echo

while true; do
  should_stop && cleanup
  echo "[$(date +%H:%M:%S)] polling…"
  for role in "${ROLES[@]}"; do
    should_stop && cleanup
    poll_role "$role"
  done
  sleep "$POLL_INTERVAL"
done