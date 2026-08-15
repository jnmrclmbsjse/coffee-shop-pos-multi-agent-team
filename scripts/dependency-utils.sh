#!/usr/bin/env bash

# blocked_by_issue_numbers <issue-body>
#
# GitHub issue forms render the "Blocked By" input as a Markdown heading with
# its value on following lines. Older issues used an inline "Blocked By: ..."
# line. Accept both shapes, stop at the next issue-form heading, and ignore
# unrelated issue references elsewhere in the body.
#
# Match ANY heading depth. This originally hard-coded `###`, but the issue-form
# template later began emitting `##` — so every task created after that change
# parsed as having ZERO blockers. That silently disabled both consumers: the
# poller's dependency gate (blocked dev tasks became dispatchable again — the
# very #130 regression the gate exists to prevent) and merge-and-advance's
# unblock step, which strands each dependent with its `blocked` label forever
# because poll_role filters that label out. #327 was stranded exactly this way.
# Depth-agnostic matching keeps both legacy `###` and current `##` issues working.
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
      normalized ~ /^#+[[:space:]]+blocked by[[:space:]]*$/ {
        in_blocked_by = 1
        next
      }
      in_blocked_by && /^#+[[:space:]]+/ {
        in_blocked_by = 0
      }
      in_blocked_by {
        print
      }
    ' | grep -oE '#[0-9]+' | tr -d '#' | sort -nu
  } || true)"
  printf '%s' "$refs"
}
