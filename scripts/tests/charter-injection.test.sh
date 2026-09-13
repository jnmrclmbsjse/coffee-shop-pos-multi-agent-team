#!/usr/bin/env bash
# charter-injection.test.sh — the charter mechanism must never fail silently.
#
# A lane that ships the literal text "{{CHARTER}}" to its engine runs with no
# boundaries at all and still looks like it worked. That is the failure this
# whole mechanism exists to end, so it gets a test.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
source scripts/_common.sh

PASS=0; FAIL=0
ok()   { echo "  ok   — $1"; PASS=$(( PASS + 1 )); }
bad()  { echo "  FAIL — $1"; FAIL=$(( FAIL + 1 )); }

echo "1. every role named in the lane map has a charter file"
for role in po techlead uiux qa dev deploy discovery; do
  [[ -f "charters/${role}.md" ]] && ok "charters/${role}.md exists" \
                                 || bad "charters/${role}.md MISSING"
done

echo "2. charter() concatenates _shared.md + the role's own"
out="$(charter qa 2>/dev/null)"
grep -q "Shared context" <<<"$out" && ok "shared block present" \
                                   || bad "shared block missing from charter qa"
grep -q "## Role: QA" <<<"$out" && ok "role block present" \
                                || bad "role block missing from charter qa"

echo "3. charter() refuses an unknown role"
if charter nonsense >/dev/null 2>&1; then
  bad "charter nonsense succeeded — it must fail"
else
  ok "charter nonsense refused"
fi

echo "4. every template declaring {{CHARTER}} resolves it when given a role"
# A case function, not `declare -A`: macOS ships bash 3.2, which has no
# associative arrays. The rest of scripts/ avoids them for the same reason.
role_of() {
  case "$1" in
    po-intake.md|po-prepare.md|po-clarify.md)             echo po ;;
    dev-pickup.md)                                        echo dev ;;
    techlead-feasibility.md|techlead-review.md|techlead-adr-revise.md)
                                                          echo techlead ;;
    qa-testability.md|qa-test.md)                         echo qa ;;
    uiux-mockup.md)                                       echo uiux ;;
    deploy.md)                                            echo deploy ;;
    discovery.md)                                         echo discovery ;;
    *)                                                    echo "" ;;
  esac
}
for tpl in prompts/*.md; do
  name="$(basename "$tpl")"
  [[ "$name" == "_conventions.md" ]] && continue
  grep -q '{{CHARTER}}' "$tpl" || continue
  role="$(role_of "$name")"
  if [[ -z "$role" ]]; then
    bad "$name declares {{CHARTER}} but this test has no role for it"
    continue
  fi
  rendered="$(render "$name" 999 "$role" 2>/dev/null)"
  if [[ -z "$rendered" ]]; then
    bad "$name rendered empty for role $role"
  elif grep -q '{{CHARTER}}' <<<"$rendered"; then
    bad "$name still contains {{CHARTER}} after rendering as $role"
  else
    ok "$name resolves as $role"
  fi
done

echo "5. render() REFUSES a {{CHARTER}} template with no role"
if render qa-test.md 999 >/dev/null 2>&1; then
  bad "render qa-test.md with no role succeeded — it must refuse"
else
  ok "render refuses a charter template with no role"
fi

echo "6. no wrapper builds a charter prompt by hand"
# po-intake.sh and discovery.sh legitimately bypass render() (no issue number),
# so they must call charter() themselves. Anything else that names a template
# with {{CHARTER}} must go through render() with a role.
for w in scripts/po-intake.sh scripts/discovery.sh; do
  grep -q 'charter ' "$w" && ok "$(basename "$w") injects its charter directly" \
                          || bad "$(basename "$w") bypasses render() without calling charter()"
done

echo "7. every render() call site passes a role"
while read -r line; do
  case "$line" in
    *"render <template"*|*"# render"*) continue ;;
  esac
  # third argument present?
  if [[ "$line" =~ render[[:space:]]+[a-z0-9./-]+\.md[[:space:]]+\"?\$?[A-Za-z_{}\"]+\"?[[:space:]]+[a-z]+ ]]; then
    ok "role passed: $(sed 's/^ *//' <<<"${line#*:}")"
  else
    bad "no role at call site: $(sed 's/^ *//' <<<"$line")"
  fi
done < <(grep -n 'render [a-z0-9-]*\.md' scripts/*.sh | grep -v '_common.sh')

echo
echo "charter-injection: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
