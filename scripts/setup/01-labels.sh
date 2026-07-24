#!/usr/bin/env bash
# Creates all labels for the multi-agent workflow.
# Usage: ./01-labels.sh <owner/repo>
# Idempotent — safe to re-run; --force updates existing labels.
#
# NOTE: deliberately does NOT use `declare -A`. macOS ships bash 3.2, which has
# no associative arrays — the previous version of this script silently failed
# there, which is why `blocked` was missing and the poller's gating never fired.
set -euo pipefail
REPO="${1:?Usage: 01-labels.sh <owner/repo>}"

# name|color|description
LABELS='
agent:po|5319e7|PO agent should act next
agent:tech-lead|5319e7|Tech Lead agent should act next
agent:design|5319e7|UI/UX agent should act next
agent:dev|5319e7|Dev agent should act next
agent:qa|5319e7|QA agent should act next
agent:human|d93f0b|Escalated — no agent should touch this
type:epic|8250df|Feature/initiative container (never goes on the board)
type:story|8250df|User story
type:design-task|8250df|Design task
type:dev-task|8250df|Implementation task
type:qa-task|8250df|e2e test authoring task
type:bug|8250df|Defect found by QA
moscow:must|b60205|MoSCoW: Must have
moscow:should|d93f0b|MoSCoW: Should have
moscow:could|fbca04|MoSCoW: Could have
moscow:wont|c5def5|MoSCoW: Won'"'"'t have (this time)
blocked|000000|Dependency unmet — the poller skips these
needs-clarification|e99695|Kicked back to PO or the human instead of guessing
blocked-on-adr|0e8a16|Story blocked pending human review of an ADR PR
escalation-digest|ededed|Daily digest issue collecting overnight escalations
'

count=0
echo "$LABELS" | while IFS='|' read -r name color desc; do
  [[ -z "${name// /}" ]] && continue
  printf '  %-24s ' "$name"
  if gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null 2>&1; then
    echo "ok"
  else
    echo "FAILED"
  fi
done

echo
echo "Verify with: gh label list --repo $REPO --limit 50"
echo "Expected: 20 labels."