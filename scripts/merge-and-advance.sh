#!/usr/bin/env bash
# merge-and-advance.sh <pr-number> <issue-number>
# The human merge gate + status transition, folded into one command.
# Run this yourself after Tech Lead has approved a PR.
set -euo pipefail
PR="${1:?Usage: merge-and-advance.sh <pr-number> <issue-number>}"
ISSUE="${2:?Provide the issue number}"

gh pr merge "$PR" --squash --delete-branch
gh issue edit "$ISSUE" --add-label agent:qa --remove-label agent:tech-lead
# Projects v2 status → Ready for QA (fill in project/field IDs for your board,
# or do this line via the GitHub MCP / gh project item-edit):
echo "MERGED PR #$PR, relabeled #$ISSUE agent:qa."
echo "NOW set Projects status of #$ISSUE to 'Ready for QA' (gh project item-edit"
echo "or GitHub MCP) — fill in your project/field/item IDs here to automate it."
