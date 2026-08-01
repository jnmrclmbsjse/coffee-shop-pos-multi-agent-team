#!/usr/bin/env bash

# blocked_by_issue_numbers <issue-body>
#
# GitHub issue forms render the "Blocked By" input as a Markdown heading with
# its value on following lines. Older issues used an inline "Blocked By: ..."
# line. Accept both shapes, stop at the next issue-form heading, and ignore
# unrelated issue references elsewhere in the body.
blocked_by_issue_numbers() {
  local body="${1:-}" refs
  refs="$({
    printf '%s\n' "$body" | awk '
      {
        normalized = tolower($0)
      }
      normalized ~ /^[[:space:]]*blocked by:[[:space:]]*/ {
        print
        next
      }
      normalized ~ /^###[[:space:]]+blocked by[[:space:]]*$/ {
        in_blocked_by = 1
        next
      }
      in_blocked_by && /^###[[:space:]]+/ {
        in_blocked_by = 0
      }
      in_blocked_by {
        print
      }
    ' | grep -oE '#[0-9]+' | tr -d '#' | sort -nu
  } || true)"
  printf '%s' "$refs"
}
