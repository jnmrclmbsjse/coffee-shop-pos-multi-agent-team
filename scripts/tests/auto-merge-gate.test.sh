#!/usr/bin/env bash
# auto-merge-gate.test.sh — auto_merge_story_pr must REFUSE safely.
#
# This function replaced the design agent arming `gh pr merge --auto` on its own
# PR. Its whole value is in what it declines to merge, so each refusal path gets
# a case. `gh` is stubbed via PATH; nothing here touches the network.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
source scripts/_common.sh

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT
PATH="$STUB_DIR:$PATH"
export GH_CHECKS=""

PASS=0; FAIL=0
ok()  { echo "  ok   — $1"; PASS=$(( PASS + 1 )); }
bad() { echo "  FAIL — $1"; FAIL=$(( FAIL + 1 )); }

# Build a fake `gh`. Scenario is passed through env vars the stub reads.
cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
# $GH_OPEN_PRS   : space-separated open PR numbers
# $GH_BODY_<n>   : that PR's body
# $GH_FILES_<n>  : newline-separated changed paths
# $GH_CHECKS     : json for `gh pr checks`
# $GH_MERGEABLE  : MERGEABLE | CONFLICTING
# writes each merge attempt to $GH_MERGE_LOG
case "$1 $2" in
  "pr list") printf '%s\n' $GH_OPEN_PRS; exit 0 ;;
  "pr view")
      n="$3"
      for a in "$@"; do case "$a" in .body) eval "printf '%s' \"\$GH_BODY_$n\""; exit 0 ;;
        '.files[].path') eval "printf '%s\n' \"\$GH_FILES_$n\""; exit 0 ;;
        .mergeable) printf '%s' "${GH_MERGEABLE:-MERGEABLE}"; exit 0 ;;
        .headRefName) printf 'design/issue-%s' "$n"; exit 0 ;;
      esac; done
      exit 0 ;;
  "pr checks")
      # Build the default OUTSIDE a ${...:-} default: bash ends the expansion at
      # the first '}', so an inline JSON default emits mangled JSON.
      _dflt='[{"bucket":"pass"}]'
      _j="${GH_CHECKS}"; [[ -z "$_j" ]] && _j="$_dflt"
      printf '%s' "$_j"
      # gh exits non-zero while any check is pending or failing.
      GH_J="$_j" python3 -c "import json,os,sys; d=json.loads(os.environ['GH_J']); sys.exit(0 if d and all(c['bucket']=='pass' for c in d) else 1)" ;;
  "pr merge") echo "$3" >> "$GH_MERGE_LOG"; exit 0 ;;
  "api -X"|"api") exit 0 ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/gh"

run_case() { GH_MERGE_LOG="$STUB_DIR/merged"; : > "$GH_MERGE_LOG"; export GH_MERGE_LOG; }
merged_prs() { tr '\n' ' ' < "$GH_MERGE_LOG" | sed 's/ $//'; }

echo "1. unknown role is refused outright"
run_case; export GH_OPEN_PRS="1" GH_BODY_1="for #50" GH_FILES_1="docs/design/x.html"
auto_merge_story_pr dev 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "role 'dev' merged nothing" || bad "merged $(merged_prs) for unknown role"

echo "2. no PR in scope → nothing merged"
run_case; export GH_OPEN_PRS="2" GH_BODY_2="for #50" GH_FILES_2="e2e/foo.spec.ts"
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "an e2e-only PR is not the design PR" || bad "merged a QA PR as uiux"

echo "3. #84 must not match a PR referencing #840"
run_case; export GH_OPEN_PRS="3" GH_BODY_3="design for #840" GH_FILES_3="docs/design/mockups/issue-840/index.html"
auto_merge_story_pr uiux 84 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "substring #84/#840 rejected" || bad "merged #840's PR for story #84"

echo "4. mixed-scope PR is refused"
run_case; export GH_OPEN_PRS="4" GH_BODY_4="for #50"
export GH_FILES_4="docs/design/mockups/issue-50/index.html
scripts/poll.sh"
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "design PR carrying scripts/poll.sh refused" || bad "merged an out-of-scope PR"

echo "5. two candidate PRs → ambiguous, merge neither"
run_case; export GH_OPEN_PRS="5 6" GH_BODY_5="for #50" GH_BODY_6="also for #50"
export GH_FILES_5="docs/design/a.html" GH_FILES_6="docs/design/b.html"
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "ambiguous pair left for a human" || bad "merged $(merged_prs) while ambiguous"

echo "6. failing checks → refused"
run_case; export GH_OPEN_PRS="7" GH_BODY_7="for #50" GH_FILES_7="docs/design/a.html"
export GH_CHECKS='[{"bucket":"pass"},{"bucket":"fail"}]'
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "red CI refused" || bad "merged with a failing check"
export GH_CHECKS=""

echo "7. pending checks → refused"
run_case; export GH_OPEN_PRS="8" GH_BODY_8="for #50" GH_FILES_8="docs/design/a.html"
export GH_CHECKS='[{"bucket":"pending"}]'
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "unsettled CI refused" || bad "merged with pending checks"
export GH_CHECKS=""

echo "8. conflicting branch → refused"
run_case; export GH_OPEN_PRS="9" GH_BODY_9="for #50" GH_FILES_9="docs/design/a.html"
export GH_MERGEABLE="CONFLICTING"
auto_merge_story_pr uiux 50 2>/dev/null
[[ -z "$(merged_prs)" ]] && ok "conflicting PR refused" || bad "merged a conflicting PR"
unset GH_MERGEABLE

echo "9. the clean case DOES merge"
run_case; export GH_OPEN_PRS="10" GH_BODY_10="design for #50" GH_FILES_10="docs/design/mockups/issue-50/index.html"
auto_merge_story_pr uiux 50 2>/dev/null
[[ "$(merged_prs)" == "10" ]] && ok "green, in-scope, unambiguous PR merged" || bad "clean case did not merge (got '$(merged_prs)')"

echo
echo "auto-merge-gate: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
