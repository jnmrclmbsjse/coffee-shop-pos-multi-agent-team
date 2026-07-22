#!/usr/bin/env bash
# Creates all labels for the multi-agent workflow.
# Usage: ./01-labels.sh <owner/repo>
# Requires: gh auth login already run, with repo write access.
set -euo pipefail
REPO="${1:?Usage: 01-labels.sh <owner/repo>}"

declare -A LABELS=(
  # Routing / automation trigger — what each poller (amux) watches
  ["agent:po"]="5319e7|PO agent should act next"
  ["agent:tech-lead"]="5319e7|Tech Lead agent should act next"
  ["agent:design"]="5319e7|UI/UX agent should act next"
  ["agent:dev"]="5319e7|Dev agent should act next"
  ["agent:qa"]="5319e7|QA agent should act next"
  ["agent:human"]="d93f0b|Escalated — no agent should touch this"

  # Type (safe default — works on personal accounts and orgs alike;
  # superseded by native Issue Types if you're on an org with that configured)
  ["type:epic"]="8250df|"
  ["type:story"]="8250df|"
  ["type:design-task"]="8250df|"
  ["type:dev-task"]="8250df|"
  ["type:qa-task"]="8250df|"
  ["type:bug"]="8250df|"

  # Priority (MoSCoW)
  ["moscow:must"]="b60205|"
  ["moscow:should"]="d93f0b|"
  ["moscow:could"]="fbca04|"
  ["moscow:wont"]="c5def5|"

  # Flow control
  ["blocked"]="000000|Automation should skip issues carrying this label"
  ["needs-clarification"]="e99695|Kicked back to you or PO instead of guessing"
)

for name in "${!LABELS[@]}"; do
  IFS='|' read -r color desc <<< "${LABELS[$name]}"
  echo "Creating label: $name"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force
done

echo "Done. Verify with: gh label list --repo $REPO"
