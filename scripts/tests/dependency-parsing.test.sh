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

echo "dependency parsing tests passed"
