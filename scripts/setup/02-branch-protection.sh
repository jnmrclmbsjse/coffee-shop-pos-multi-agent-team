#!/usr/bin/env bash
# Sets branch protection on the default branch:
#  - no direct pushes (PR required) — this is what enforces Dev's
#    "no direct push to default" restriction at the platform level
#  - 1 required approving review (Tech Lead's PAT is the one with approve rights)
#  - author cannot approve their own PR
#  - required status check placeholder for the path-restriction CI job (§ path-restriction)
#
# Usage: ./02-branch-protection.sh <owner/repo> <branch> [required-check-name]
set -euo pipefail
REPO="${1:?Usage: 02-branch-protection.sh <owner/repo> <branch> [required-check-name]}"
BRANCH="${2:?Provide the default branch name, e.g. main}"
CHECK_NAME="${3:-path-restriction-check}"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=${CHECK_NAME}" \
  -F "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=false" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"

echo "Branch protection applied to ${REPO}@${BRANCH}."
echo "NOTE: '${CHECK_NAME}' must exist as an actual CI job before this becomes effective —"
echo "GitHub will otherwise show the check as pending forever and block all merges."
echo "Verify with: gh api repos/${REPO}/branches/${BRANCH}/protection"
