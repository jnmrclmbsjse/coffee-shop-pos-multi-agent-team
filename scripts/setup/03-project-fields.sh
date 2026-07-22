#!/usr/bin/env bash
# Creates the Status and Priority custom fields on an existing Projects v2 board.
# Create the project itself first (via UI, or `gh project create --owner <owner> --title "..."`)
# then pass its number here.
#
# Usage: ./03-project-fields.sh <owner> <project-number>
# NOTE: verify flags against `gh project field-create --help` for your installed
# gh version before running — Projects v2 CLI syntax has shifted across releases.
set -euo pipefail
OWNER="${1:?Usage: 03-project-fields.sh <owner> <project-number>}"
PROJECT="${2:?Provide the project number, e.g. 3}"

gh project field-create "$PROJECT" \
  --owner "$OWNER" \
  --name "Status" \
  --data-type SINGLE_SELECT \
  --single-select-options "Backlog,In Preparation,Ready for Dev,In Dev,Ready for Review,Changes Requested,Ready for QA,In QA,QA Rejected,QA Accepted,Done"

gh project field-create "$PROJECT" \
  --owner "$OWNER" \
  --name "Priority" \
  --data-type SINGLE_SELECT \
  --single-select-options "Must,Should,Could,Won't"

echo "Fields created. Verify with: gh project field-list $PROJECT --owner $OWNER"
echo "Note: the default GitHub-provided 'Status' field on a new Projects v2 board"
echo "may already exist with different options — check for a duplicate before running."
