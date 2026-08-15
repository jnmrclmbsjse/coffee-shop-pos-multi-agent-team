#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$repo_root/scripts/dependency-utils.sh"

assert_refs() {
  local name="$1" expected="$2" body="$3" actual
  actual="$(blocked_by_issue_numbers "$body")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s\nexpected:\n%s\nactual:\n%s\n' \
      "$name" "$expected" "$actual" >&2
    return 1
  fi
}

assert_refs \
  "GitHub issue-form section with multiple blockers" \
  $'167\n169' \
  $'### Parent User Story\n\n#165\n\n### Blocked By\n\n#167, #169\n\n### Pull Request\n\n#999'

assert_refs \
  "legacy inline field" \
  $'128\n130' \
  $'Parent: #120\nBlocked By: #130, #128\nNotes: #999'

assert_refs \
  "case-insensitive heading" \
  "42" \
  $'### BLOCKED BY\n\nDepends on #42.\n\n### Notes\n\n#43'

assert_refs \
  "missing dependency field" \
  "" \
  $'### Parent User Story\n\n#165\n\n### Pull Request\n\n_Filled by Dev._'

# The issue-form template emits `##`, not `###`. Hard-coding `###` made every
# task created after that template change parse as unblocked — which both
# disabled the poller's dependency gate and stranded dependents in
# merge-and-advance (#327). Cover every heading depth in use.
assert_refs \
  "h2 issue-form section (current template)" \
  $'325\n326' \
  $'## Parent User Story\n\n#324\n\n## Blocked By\n\n#326, #325\n\n## Acceptance Criteria\n\n- #999'

assert_refs \
  "h2 section terminated by an h2 heading" \
  "326" \
  $'## Blocked By\n\n#326\n\n## Notes\n\n#777'

assert_refs \
  "h2 'None' placeholder yields no blockers" \
  "" \
  $'## Blocked By\n\n_None._\n\n## Acceptance Criteria\n\n- #999'

echo "dependency parsing tests passed"
