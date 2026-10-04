#!/usr/bin/env bash
# engine-override.test.sh — CODEX_LANES_ENGINE must route the Codex lanes to the
# engine it names, and refuse anything else instead of silently picking one.
#
# The override is temporary (Codex credits ran out), so the test also pins the
# revert path: CODEX_LANES_ENGINE=codex must give back the real Codex command.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

PASS=0; FAIL=0
ok()  { echo "  ok   — $1"; PASS=$(( PASS + 1 )); }
bad() { echo "  FAIL — $1"; FAIL=$(( FAIL + 1 )); }

probe() { # <engine-or-empty> → prints CODEX_EXEC|CLAUDE_EXEC|bg-flag
  env -u CODEX_LANES_ENGINE -u CLAUDE_CODE_DISABLE_BACKGROUND_TASKS \
      ${1:+CODEX_LANES_ENGINE=$1} bash -c \
      'source scripts/_common.sh; printf "%s|%s|%s" "$CODEX_EXEC" "$CLAUDE_EXEC" "${CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:-}"'
}

echo "1. claude routes the Codex lanes to Claude Code"
IFS='|' read -r codex claude bg <<<"$(probe claude)"
[[ "$codex" == "$claude" ]] && ok "CODEX_EXEC == CLAUDE_EXEC" || bad "CODEX_EXEC is '$codex'"
[[ "$bg" == "1" ]] && ok "background tasks disabled" || bad "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS='$bg'"

echo "2. codex (the revert) restores the Codex command"
IFS='|' read -r codex claude bg <<<"$(probe codex)"
[[ "$codex" == codex* ]] && ok "CODEX_EXEC is the codex CLI" || bad "CODEX_EXEC is '$codex'"
[[ -z "$bg" ]] && ok "background flag not forced" || bad "background flag set under codex"

echo "3. the committed default"
IFS='|' read -r codex claude bg <<<"$(probe "")"
echo "     (default routes Codex lanes to: $([[ "$codex" == "$claude" ]] && echo claude || echo codex))"
[[ -n "$codex" ]] && ok "default resolves to an engine" || bad "default left CODEX_EXEC empty"

echo "4. an unknown engine is refused"
if env CODEX_LANES_ENGINE=gpt bash -c 'source scripts/_common.sh' >/dev/null 2>&1; then
  bad "CODEX_LANES_ENGINE=gpt was accepted"
else
  ok "CODEX_LANES_ENGINE=gpt refused"
fi

echo
echo "engine-override: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
