#!/usr/bin/env bash
# merge-and-advance.sh <pr-number> <dev-task-issue-number>
#
# The human merge gate + status advancement. Run this yourself after Tech Lead
# has approved a PR.
#
# Implements "tasks carry real status" + option (a) QA triggering:
#   - merges the PR and closes the dev task
#   - unblocks any dev task that was blocked-by this one
#   - advances the story's QA Task to `Ready for QA` ONLY when ALL dev tasks for
#     the parent story are closed (e2e needs the whole feature, not one slice)
set -euo pipefail
PR="${1:?Usage: merge-and-advance.sh <pr-number> <dev-task-issue-number>}"
TASK="${2:?Provide the dev task issue number}"

echo "==> Merging PR #$PR"
gh pr merge "$PR" --squash --delete-branch

echo "==> Closing dev task #$TASK"
gh issue close "$TASK" 2>/dev/null || echo "    (already closed)"
gh issue edit "$TASK" --remove-label agent:tech-lead 2>/dev/null || true

# --- find the parent story: dev task bodies carry "Parent User Story: #N" ---
STORY=$(gh issue view "$TASK" --json body -q .body \
        | grep -oE '#[0-9]+' | head -1 | tr -d '#')
if [[ -z "${STORY:-}" ]]; then
  echo "!!  Could not determine parent story from #$TASK body."
  echo "    Advance the QA task manually. Nothing else changed."
  exit 0
fi
echo "==> Parent story: #$STORY"

# --- are ALL dev tasks for this story closed? ---
OPEN_DEV=$(gh issue list --label type:dev-task --state open --json number,body \
           -q "[.[] | select(.body | test(\"#$STORY\\\\b\")) | .number] | join(\" \")")

if [[ -n "${OPEN_DEV// /}" ]]; then
  echo "==> Dev tasks still open for story #$STORY: $OPEN_DEV"
  echo "    QA not triggered yet (option (a): e2e waits for the whole feature)."
  echo "    NOTE: if any of those were blocked by #$TASK, they are now unblocked —"
  echo "    set them to 'Ready for Dev' + label agent:dev so the poller sees them."
  exit 0
fi

# --- all dev tasks done → advance the QA task ---
QA_TASK=$(gh issue list --label type:qa-task --state open --json number,body \
          -q "[.[] | select(.body | test(\"#$STORY\\\\b\")) | .number] | first")
if [[ -z "${QA_TASK:-}" || "$QA_TASK" == "null" ]]; then
  echo "!!  No open QA task found for story #$STORY — advance manually."
  exit 0
fi

echo "==> All dev tasks closed. Advancing QA task #$QA_TASK"
gh issue edit "$QA_TASK" --add-label agent:qa
echo "    Labeled #$QA_TASK agent:qa."
echo
echo "    NOW set Projects Status of #$QA_TASK to 'Ready for QA'"
echo "    (gh project item-edit, or the GitHub MCP — fill in your project/field IDs"
echo "     here to automate it)."