#!/usr/bin/env bash
# merge-and-advance.sh <pr-number> <dev-task-issue-number>
#
# Human merge gate + status advancement.
#   - merges the PR, closes the dev task, sets its Status to `Done`
#   - advances the story's QA Task to `Ready for QA` ONLY when ALL dev tasks
#     for the parent story are closed (option (a): e2e needs the whole feature)
#
# Requires: OD_PROJECT_NUMBER and OD_PROJECT_OWNER (export in your shell profile),
# plus `jq`. All other Projects v2 IDs are looked up dynamically.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
as_human

PR="${1:?Usage: merge-and-advance.sh <pr-number> <dev-task-issue-number>}"
TASK="${2:?Provide the dev task issue number}"

OWNER="${OD_PROJECT_OWNER:?Set OD_PROJECT_OWNER (e.g. your GitHub login)}"
PROJECT="${OD_PROJECT_NUMBER:?Set OD_PROJECT_NUMBER (the board number)}"

# ---------- Projects v2 helpers (dynamic ID lookup) ----------
_project_json() { gh project view "$PROJECT" --owner "$OWNER" --format json; }
_fields_json()  { gh project field-list "$PROJECT" --owner "$OWNER" --format json; }
_items_json()   { gh project item-list "$PROJECT" --owner "$OWNER" --limit 500 --format json; }

PROJECT_ID="$(_project_json | jq -r '.id')"
STATUS_FIELD_JSON="$(_fields_json | jq -r '.fields[] | select(.name=="Status")')"
STATUS_FIELD_ID="$(jq -r '.id' <<<"$STATUS_FIELD_JSON")"

# set_status <issue-number> <option-name>
set_status() {
  local issue="$1" option="$2" item_id option_id
  item_id="$(_items_json | jq -r --argjson n "$issue" \
      '.items[] | select(.content.number==$n) | .id' | head -1)"
  if [[ -z "$item_id" || "$item_id" == "null" ]]; then
    echo "    !! #$issue is not on the board — cannot set '$option'. Add it, then re-run."
    return 1
  fi
  option_id="$(jq -r --arg o "$option" \
      '.options[]? | select(.name==$o) | .id' <<<"$STATUS_FIELD_JSON" | head -1)"
  if [[ -z "$option_id" || "$option_id" == "null" ]]; then
    echo "    !! Status option '$option' does not exist on this board."
    echo "       Add it in the UI (Status field options) and re-run."
    return 1
  fi
  gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" \
     --field-id "$STATUS_FIELD_ID" --single-select-option-id "$option_id" >/dev/null
  echo "    #$issue → Status '$option'"
}

# ---------- merge ----------
echo "==> Merging PR #$PR"
gh pr merge "$PR" --squash --delete-branch

echo "==> Closing dev task #$TASK"
gh issue close "$TASK" >/dev/null 2>&1 || echo "    (already closed)"
gh issue edit "$TASK" --remove-label agent:tech-lead >/dev/null 2>&1 || true
# Dev tasks are finished at merge — QA's verdict lands on the QA task, not here.
set_status "$TASK" "Done" || true

# ---------- find parent story ----------
STORY=$(gh issue view "$TASK" --json body -q .body | grep -oE '#[0-9]+' | head -1 | tr -d '#')
if [[ -z "${STORY:-}" ]]; then
  echo "!!  Could not determine parent story from #$TASK body. Advance QA manually."
  exit 0
fi
echo "==> Parent story: #$STORY"

# ---------- all dev tasks closed? ----------
# ---------- unblock anything that was waiting on this task ----------
# Tasks record their blocker as "Blocked By: #<n>" in the body (set by Tech Lead).
echo "==> Checking for tasks blocked by #$TASK"
BLOCKED_BY_THIS=$(gh issue list --state open --label blocked --json number,body \
  -q "[.[] | select(.body | test(\"Blocked By.*#$TASK\\\\b\")) | .number] | .[]")
if [[ -n "${BLOCKED_BY_THIS:-}" ]]; then
  while read -r dep; do
    [[ -z "$dep" ]] && continue
    echo "    unblocking #$dep"
    gh issue edit "$dep" --remove-label blocked --add-label agent:dev >/dev/null
    set_status "$dep" "Ready for Dev" || true
  done <<< "$BLOCKED_BY_THIS"
else
  echo "    none"
fi

OPEN_DEV=$(gh issue list --label type:dev-task --state open --json number,body \
           -q "[.[] | select(.body | test(\"#$STORY\\\\b\")) | .number] | join(\" \")")
if [[ -n "${OPEN_DEV// /}" ]]; then
  echo "==> Dev tasks still open for story #$STORY: $OPEN_DEV"
  echo "    QA not triggered yet (e2e waits for the whole feature)."
  exit 0
fi

# ---------- advance QA task ----------
QA_TASK=$(gh issue list --label type:qa-task --state open --json number,body \
          -q "[.[] | select(.body | test(\"#$STORY\\\\b\")) | .number] | first")
if [[ -z "${QA_TASK:-}" || "$QA_TASK" == "null" ]]; then
  echo "!!  No open QA task found for story #$STORY — advance manually."
  exit 0
fi

echo "==> All dev tasks closed. Advancing QA task #$QA_TASK"
gh issue edit "$QA_TASK" --add-label agent:qa >/dev/null
set_status "$QA_TASK" "Ready for QA" || true
echo
echo "    Next: ./scripts/qa-test.sh $QA_TASK"