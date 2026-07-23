#!/usr/bin/env bash
# Sets up the Projects v2 custom fields for the multi-agent board.
#
# IMPORTANT — Status cannot be created via the API:
#   "Status" is a RESERVED field name in Projects v2. Every new board ships with
#   a default Status field (Todo / In Progress / Done). You cannot create another
#   one (GraphQL: "Name cannot have a reserved value" / "Name has already been
#   taken"). You must EDIT the existing field's options in the web UI instead.
#   This script therefore only creates Priority, and prints the Status options
#   for you to paste into the UI.
#
# Usage: ./03-project-fields.sh <owner> <project-number>
set -euo pipefail
OWNER="${1:?Usage: 03-project-fields.sh <owner> <project-number>}"
PROJECT="${2:?Provide the project number, e.g. 3}"

echo "==> Creating Priority field (MoSCoW)…"
if gh project field-create "$PROJECT" \
  --owner "$OWNER" \
  --name "Priority" \
  --data-type SINGLE_SELECT \
  --single-select-options "Must,Should,Could,Won't"
then
  echo "    Priority created."
else
  echo "    Priority not created (likely already exists) — continuing."
fi

cat <<'MANUAL'

==> MANUAL STEP REQUIRED: Status field options
    Status is reserved and pre-existing; edit it in the web UI:
      Project board → ⋯ menu → Settings → Status field → edit options

    Delete the defaults (Todo / In Progress) and set these eleven
    (you can keep the existing "Done" — we use that name too):

      Backlog
      In Preparation
      Ready for Dev
      In Dev
      Ready for Review
      Changes Requested
      Ready for QA
      In QA
      QA Rejected
      QA Accepted
      Done

==> ALSO RECOMMENDED: auto-add workflow
    Project board → ⋯ → Workflows → "Auto-add to project"
    Enable it for this repo so agent-created issues land on the board
    automatically. Without it, every new issue must be added by hand.

MANUAL

echo "==> Verify fields with:"
echo "    gh project field-list $PROJECT --owner $OWNER"