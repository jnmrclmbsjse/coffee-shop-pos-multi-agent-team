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
DISCOVERY_COOLDOWN="${DISCOVERY_COOLDOWN:-14400}"   # 4h between discovery runs
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

label_for()  { case "$1" in dev) echo agent:dev;; qa) echo agent:qa;; tech-lead) echo agent:tech-lead;; po) echo agent:po;; esac; }
script_for() { case "$1" in dev) echo scripts/dev-pickup.sh;; qa) echo scripts/qa-test.sh;; tech-lead) echo scripts/techlead-review.sh;; prepare) echo scripts/po-prepare.sh;; po) echo scripts/po-clarify.sh;; esac; }
single_for() { case "$1" in dev|qa|prepare) echo 1;; tech-lead|po) echo 0;; esac; }

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
    return 0
  fi
  local elapsed_h=$(( ( $(date +%s) - SESSION_START ) / 3600 ))
  if (( MAX_SESSION_HOURS > 0 && elapsed_h >= MAX_SESSION_HOURS )); then
    echo "!! session budget reached (${MAX_SESSION_HOURS}h) — stopping."
    return 0
  fi
  return 1
}

# ---------- failure classification ----------
# ENVIRONMENTAL: permissions, missing config, API rejections. Retrying cannot
#   help — and worse, an agent that hits a permission wall may hunt for other
#   credentials on the machine and route AROUND the boundary (observed once
#   already). These queue immediately, never retry.
# LOGIC: tests failed, review rejected, build broken. One retry with the failure
#   reason injected as an issue comment, then queue.
# Unrecognised failures default to ENVIRONMENTAL — the safer bias: a needless
# queue entry costs you one glance; a needless retry costs tokens and may
# trigger the route-around behaviour above.
classify_failure() {
  local log="$1"
  if grep -qiE 'not accessible|permission|unauthoriz|forbidden|\b40[13]\b|authentication|denied|not allowed for this repository|GraphQL: Resource|command not found|no such file|rate limit|could not resolve host|label .* not found|reserved value' "$log" 2>/dev/null; then
    echo environmental; return
  fi
  if grep -qiE 'test.*fail|failing test|assertion|build failed|compilation error|type error|lint error|changes requested' "$log" 2>/dev/null; then
    echo logic; return
  fi
  echo environmental
}

# ---------- morning queue: one digest issue per day ----------
queue_issue_number() {
  local title="Escalations — $(date +%Y-%m-%d)" num
  num="$(gh issue list --state open --label escalation-digest --limit 20 \
        --json number,title -q "[.[] | select(.title==\"$title\") | .number] | first" 2>/dev/null)"
  if [[ -z "$num" || "$num" == "null" ]]; then
    gh label create escalation-digest --color ededed \
      --description "Daily digest of overnight escalations" --force >/dev/null 2>&1
    num="$(gh issue create --title "$title" --label escalation-digest \
      --body "Escalations for $(date +%Y-%m-%d). Each entry links the issue and its log." \
      2>/dev/null | grep -oE '[0-9]+$')"
  fi
  echo "$num"
}

queue_escalation() {
  local issue="$1" why="$2" log="$3" kind="$4" digest
  digest="$(queue_issue_number)"
  [[ -z "$digest" ]] && { echo "    !! could not create/find digest issue"; return; }
  gh issue comment "$digest" --body "**#${issue}** — \`${kind}\`
${why}
Log: \`${log}\`" >/dev/null 2>&1
  echo "    → queued on digest #$digest"
}

escalate() {
  local issue="$1" why="$2" log="${3:-}" kind="${4:-unclassified}"
  echo "    !! escalating #$issue — $why"
  gh issue edit "$issue" --add-label agent:human >/dev/null 2>&1
  gh issue comment "$issue" --body "Poller escalation (\`$kind\`): $why. Needs a human." >/dev/null 2>&1
  [[ -n "$log" ]] && queue_escalation "$issue" "$why" "$log" "$kind"
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
    escalate "$issue" "agent run exceeded ${DISPATCH_TIMEOUT}s" "$log" "timeout"
  else
    local kind; kind="$(classify_failure "$log")"
    if [[ "$kind" == "environmental" ]]; then
      echo "    ✗ #$issue failed (environmental) — not retrying"
      escalate "$issue" "environmental failure — retrying cannot fix this" "$log" "environmental"
    else
      _bump "attempts-$issue"
      local n; n="$(attempts_of "$issue")"
      echo "    ✗ #$issue failed (logic, attempt $n/$MAX_ATTEMPTS) — see $log"
      if (( n >= MAX_ATTEMPTS )); then
        escalate "$issue" "failed $n times after retry" "$log" "logic"
      else
        # feed the failure back so the retry has context (agents read issue comments)
        gh issue comment "$issue" --body "Automated retry context — the previous run failed. Last 25 lines:

\`\`\`
$(tail -25 "$log" 2>/dev/null)
\`\`\`
Address this specifically rather than repeating the same approach." >/dev/null 2>&1
        echo "    ↻ failure context posted to #$issue; will retry next cycle"
      fi
    fi
  fi
}

# ---------- prepare lane ----------
# Bridges intake -> convergence. Without this, a story created by po-intake (or
# by the discovery agent calling it) sits forever: no agent:* label means no
# other lane claims it, and backlog_empty() correctly reports "not empty", so
# discovery stops too. The pipeline deadlocks at exactly this seam.
story_prepared() {
  gh issue view "$1" --json comments -q '[.comments[].body] | join(" ")' 2>/dev/null \
    | grep -q 'OD-PREPARE:feasibility:done'
}

poll_prepare() {
  local candidates story
  # open stories that are not already escalated, ADR-blocked, or mid-clarification
  candidates="$(gh issue list --state open --label type:story --limit 50 \
      --json number,labels \
      -q '[ .[] | select( (.labels|map(.name)) as $l
              | ($l|index("agent:human")|not)
              and ($l|index("blocked-on-adr")|not)
              and ($l|index("needs-clarification")|not) )
            | .number ] | .[]' 2>/dev/null)"
  [[ -z "$candidates" ]] && return 0

  while read -r story; do
    [[ -z "$story" ]] && continue
    story_prepared "$story" && continue          # already converged
    (( $(attempts_of "$story") >= MAX_ATTEMPTS )) && continue
    if (( $(dispatches_of "$story") >= MAX_DISPATCHES )); then
      escalate "$story" "prepared $(dispatches_of "$story") times without converging — likely a loop" "" "prepare"
      rm -f "$STATE_DIR/dispatches-$story"
      continue
    fi
    rate_ok || { echo "  [prepare] rate limit reached — pausing"; return 0; }

    # single-instance: po-prepare spawns sub-agents and is expensive
    if acquire_lock prepare; then
      echo "  [prepare] claimed story #$story"
      dispatch prepare "$story"
      release_lock prepare
      return 0
    else
      echo "  [prepare] busy — #$story waits"; return 0
    fi
  done <<< "$candidates"
}

# ---------- ADR lane ----------
# Stories blocked on an ADR carry `blocked-on-adr` and a marker:
#   <!-- OD-PREPARE:adr-pr:<n> -->
# The PR's own state is the trigger; there is no event mechanism locally.
poll_adr() {
  local stories story pr state merged decision last_commit last_review
  stories="$(gh issue list --state open --label blocked-on-adr --limit 50 \
             --json number -q '.[].number' 2>/dev/null)"
  [[ -z "$stories" ]] && return 0

  while read -r story; do
    [[ -z "$story" ]] && continue
    pr="$(gh issue view "$story" --json comments \
          -q '[.comments[].body] | join(" ")' 2>/dev/null \
          | grep -oE 'OD-PREPARE:adr-pr:[0-9]+' | tail -1 | grep -oE '[0-9]+$')"
    if [[ -z "$pr" ]]; then
      echo "  [adr] #$story is blocked-on-adr but has no adr-pr marker"
      escalate "$story" "blocked-on-adr with no ADR PR marker — cannot track" "" "adr"
      gh issue edit "$story" --remove-label blocked-on-adr >/dev/null 2>&1
      continue
    fi

    state="$(gh pr view "$pr" --json state -q .state 2>/dev/null)"
    merged="$(gh pr view "$pr" --json mergedAt -q .mergedAt 2>/dev/null)"

    if [[ -n "$merged" && "$merged" != "null" ]]; then
      echo "  [adr] ADR PR #$pr merged — unblocking story #$story"
      [[ "$DRY_RUN" == "1" ]] && { echo "    [dry-run] would re-run po-prepare $story"; continue; }
      gh issue edit "$story" --remove-label blocked-on-adr >/dev/null 2>&1
      local ts log; ts="$(date +%Y%m%d-%H%M%S)"; log="$LOG_DIR/po-prepare-${story}-${ts}.log"
      echo "    → scripts/po-prepare.sh $story  (log: $log)"
      scripts/po-prepare.sh "$story" >"$log" 2>&1 \
        && echo "    ✓ po-prepare resumed" || echo "    ✗ po-prepare failed — see $log"
      continue
    fi

    if [[ "$state" == "CLOSED" ]]; then
      echo "  [adr] ADR PR #$pr closed unmerged — story #$story needs a human"
      gh issue edit "$story" --remove-label blocked-on-adr >/dev/null 2>&1
      escalate "$story" "ADR PR #$pr was closed without merging — architecture direction rejected" "" "adr"
      continue
    fi

    decision="$(gh pr view "$pr" --json reviewDecision -q .reviewDecision 2>/dev/null)"
    if [[ "$decision" == "CHANGES_REQUESTED" ]]; then
      # FRESHNESS: reviewDecision stays CHANGES_REQUESTED until the human reviews
      # again, so without this we would re-dispatch a revision every cycle.
      # Only act if the last review is NEWER than the last commit — i.e. Tech
      # Lead has not already responded.
      last_commit="$(gh pr view "$pr" --json commits -q '.commits | last | .committedDate' 2>/dev/null)"
      last_review="$(gh pr view "$pr" --json reviews -q '[.reviews[] | .submittedAt] | last' 2>/dev/null)"
      if [[ -n "$last_review" && "$last_review" > "$last_commit" ]]; then
        echo "  [adr] changes requested on PR #$pr — dispatching revision"
        [[ "$DRY_RUN" == "1" ]] && { echo "    [dry-run] would run: scripts/techlead-adr-revise.sh $story"; continue; }
        local ts2 log2; ts2="$(date +%Y%m%d-%H%M%S)"; log2="$LOG_DIR/adr-revise-${story}-${ts2}.log"
        echo "    → scripts/techlead-adr-revise.sh $story  (log: $log2)"
        scripts/techlead-adr-revise.sh "$story" >"$log2" 2>&1 \
          && echo "    ✓ revision pushed" || echo "    ✗ revision failed — see $log2"
      else
        echo "  [adr] PR #$pr revised already — waiting on human re-review"
      fi
    else
      echo "  [adr] PR #$pr awaiting human review"
    fi
  done <<< "$stories"
}

# ---------- discovery lane ----------
# Fires only when the team has genuinely run out of work.
# PREDICATE (adjust if this doesn't match your intent): no open dev/qa/bug
# tasks, and no story mid-flight (labeled agent:* or still In Preparation).
# Epics are excluded deliberately — they are permanent containers that never
# close, so counting them would mean the backlog is never "empty".
# Design tasks are excluded too: they are created and closed inside po-prepare
# and never sit waiting for pickup.
backlog_empty() {
  local tasks stories
  tasks="$(gh issue list --state open --limit 100 --json number,labels \
    -q '[ .[] | select( (.labels|map(.name)) as $l
            | ($l|index("type:dev-task")) or ($l|index("type:qa-task")) or ($l|index("type:bug")) )
          ] | length' 2>/dev/null)"
  [[ "${tasks:-0}" != "0" ]] && return 1

  stories="$(gh issue list --state open --limit 100 --label type:story --json number,labels \
    -q '[ .[] | select( (.labels|map(.name)) as $l
            | ($l|map(startswith("agent:"))|any) or ($l|index("needs-clarification")) )
          ] | length' 2>/dev/null)"
  [[ "${stories:-0}" != "0" ]] && return 1

  # UNPREPARED STORIES also count as backlog. Since story templates no longer
  # apply an agent:* label, a story created by po-intake but never po-prepare'd
  # is indistinguishable by labels from a finished one. Without this check,
  # discovery would keep filing new stories on top of unstarted ones.
  # A converged story carries the feasibility:done marker in its comments.
  local s
  for s in $(gh issue list --state open --limit 100 --label type:story \
             --json number -q '.[].number' 2>/dev/null); do
    if ! gh issue view "$s" --json comments \
         -q '[.comments[].body] | join(" ")' 2>/dev/null \
         | grep -q 'OD-PREPARE:feasibility:done'; then
      return 1        # at least one story still needs preparing
    fi
  done
  return 0
}

poll_discovery() {
  local last now
  last="$(_get discovery-last)"
  now=$(date +%s)
  if (( now - last < DISCOVERY_COOLDOWN )); then return 0; fi
  if ! backlog_empty; then return 0; fi

  echo "  [discovery] backlog empty — exploring v1"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] would run: scripts/discovery.sh"
    return 0                      # do NOT consume the cooldown on a dry run
  fi
  echo "$now" > "$STATE_DIR/discovery-last"
  local ts log; ts="$(date +%Y%m%d-%H%M%S)"; log="$LOG_DIR/discovery-${ts}.log"
  echo "    → scripts/discovery.sh  (log: $log)"
  if [[ -n "$TIMEOUT_BIN" && "$DISPATCH_TIMEOUT" != "0" ]]; then
    "$TIMEOUT_BIN" "$DISPATCH_TIMEOUT" scripts/discovery.sh >"$log" 2>&1
  else
    scripts/discovery.sh >"$log" 2>&1
  fi
  local rc=$?
  (( rc == 0 )) && echo "    ✓ discovery completed" || echo "    ✗ discovery failed (rc=$rc) — see $log"
}

# NOTE: poll_role's filter excludes only `blocked` and `agent:human`. Issues in
# the `po` lane always carry `needs-clarification` as well — that is deliberate
# and must NOT be filtered out here, or clarification questions would never be
# answered.
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
echo "  discovery-cooldown=$(( DISCOVERY_COOLDOWN / 3600 ))h (only when backlog empty)"
echo "  logs → $LOG_DIR/   state → $STATE_DIR/   kill switch → touch $STOP_FILE"
echo

while true; do
  should_stop && cleanup
  echo "[$(date +%H:%M:%S)] polling…"
  for role in "${ROLES[@]}"; do
    should_stop && cleanup
    case "$role" in
      discovery) poll_discovery ;;
      adr)       poll_adr ;;
      prepare)   poll_prepare ;;
      *)         poll_role "$role" ;;
    esac
  done
  sleep "$POLL_INTERVAL"
done