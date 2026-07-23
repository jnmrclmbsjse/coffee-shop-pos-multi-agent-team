#!/usr/bin/env bash
# po-intake.sh "<requirement text>"  — PO turns a requirement into a User Story.
# Takes the requirement as an argument (quote it), NOT an issue number.
# For a long requirement, put it in a file and pass: "$(cat req.txt)"
set -euo pipefail
source "$(dirname "$0")/_common.sh"
REQUIREMENT="${1:?Usage: po-intake.sh \"<requirement text>\"}"

sha="$(prompt_sha)"
# Substitute placeholders literally (handles arbitrary chars incl. & / \ % in
# the requirement) by passing values via env and using awk index/substr, which
# does NOT interpret & in replacements the way gsub does.
export OD_REQ="$REQUIREMENT" OD_SHA="$sha"
PROMPT="$(awk '
  function repl(line, key, val,   i, out) {
    while ((i = index(line, key)) > 0) {
      out = out substr(line, 1, i-1) val
      line = substr(line, i + length(key))
    }
    return out line
  }
  { line = repl($0, "{{REQUIREMENT}}", ENVIRON["OD_REQ"])
    line = repl(line, "{{PROMPT_SHA}}", ENVIRON["OD_SHA"])
    print line }
' "$PROMPTS_DIR/po-intake.md")"

$CODEX_EXEC "$PROMPT"