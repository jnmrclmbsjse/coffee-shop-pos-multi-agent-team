#!/usr/bin/env bash
# design-mode.test.sh — resolve_design_mode must pick spec unless the Tech Lead
# labeled the story's Design Task `design:net-new`, and must refuse a bad
# DESIGN_MODE instead of running in an unknown mode.
#
# A wrong answer either way is silent: spec on a net-new screen specifies
# against components that do not exist, and open-design on an existing screen
# invents a look Dev then has to argue back down. `gh` is stubbed via PATH;
# nothing here touches the network.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
source scripts/_common.sh

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT
PATH="$STUB_DIR:$PATH"

PASS=0; FAIL=0
ok()  { echo "  ok   — $1"; PASS=$(( PASS + 1 )); }
bad() { echo "  FAIL — $1"; FAIL=$(( FAIL + 1 )); }

# $GH_SUBISSUE_HIT : non-empty → the sub-issue query returns a labeled task
# $GH_TASK_BODIES  : bodies of design:net-new Design Tasks for the fallback list
# $GH_API_FAIL     : non-empty → `gh api` errors (sub-issue lookup unavailable)
cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  api\ *)
      [[ -n "${GH_API_FAIL:-}" ]] && { echo "HTTP 502" >&2; exit 1; }
      [[ -n "${GH_SUBISSUE_HIT:-}" ]] && echo 501
      exit 0 ;;
  "issue list") printf '%s\n' "${GH_TASK_BODIES:-}"; exit 0 ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/gh"

expect() { # <label> <expected> [env assignments...]
  local label="$1" want="$2"; shift 2
  local got
  got="$(env -u DESIGN_MODE -u GH_SUBISSUE_HIT -u GH_TASK_BODIES -u GH_API_FAIL \
         "$@" bash -c 'source scripts/_common.sh; resolve_design_mode 12' 2>/dev/null)"
  if [[ "$got" == "$want" ]]; then ok "$label → $want"; else bad "$label: want '$want', got '$got'"; fi
}

echo "1. default and label-driven resolution"
expect "no labeled Design Task"                spec
expect "labeled sub-issue"                     open-design GH_SUBISSUE_HIT=1
expect "labeled task body names the story"     open-design "GH_TASK_BODIES=### Parent User Story
#12"
expect "sub-issue API down, body fallback"     open-design GH_API_FAIL=1 "GH_TASK_BODIES=Parent: #12."
expect "#123 does not match story #12"         spec "GH_TASK_BODIES=Parent: #123"
expect "#1 does not match story #12"           spec "GH_TASK_BODIES=Parent: #1"

echo "2. DESIGN_MODE override"
expect "override spec beats the label"         spec DESIGN_MODE=spec GH_SUBISSUE_HIT=1
expect "override open-design without a label"  open-design DESIGN_MODE=open-design

echo "3. invalid DESIGN_MODE is refused"
if env DESIGN_MODE=mockup bash -c 'source scripts/_common.sh; resolve_design_mode 12' >/dev/null 2>&1; then
  bad "DESIGN_MODE=mockup was accepted"
else
  ok "DESIGN_MODE=mockup refused"
fi

echo "4. the wrapper substitutes {{DESIGN_MODE}} and the prompt declares it"
grep -q '{{DESIGN_MODE}}' prompts/uiux-mockup.md \
  && ok "uiux-mockup.md declares {{DESIGN_MODE}}" || bad "uiux-mockup.md lost {{DESIGN_MODE}}"
grep -q 'resolve_design_mode' scripts/uiux-mockup.sh \
  && grep -q 'DESIGN_MODE\\}\\}/\$MODE' scripts/uiux-mockup.sh \
  && ok "uiux-mockup.sh resolves and substitutes the mode" \
  || bad "uiux-mockup.sh does not resolve/substitute the mode"

echo
echo "design-mode: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
