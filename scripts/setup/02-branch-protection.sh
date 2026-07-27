#!/usr/bin/env bash
# Sets branch protection on the default branch.
#
#  - no direct pushes (PR required) — enforces "Dev never pushes to default"
#    at the platform level rather than by prompt trust
#  - required status checks: the path-restriction CI job AND the `check` job
#    (lint + typecheck + test + build from ci.yml). `check` is required so a red
#    build cannot merge in ANY lane — design/dev/qa, UI click, or
#    merge-and-advance.sh's unconditional `gh pr merge`. It was missing before,
#    which is how a lint-failing design PR (#88) merged and reddened master.
#    strict=false deliberately: with several PRs landing, `strict: true` makes
#    every branch stale the moment another merges ("not up to date with base"),
#    forcing a rebase round-trip per PR. Unworkable for an autonomous pipeline.
#  - required_approving_review_count = 0 by default, so auto-merge works on
#    green CI without an approval deadlock (you have one machine account; you
#    cannot approve your own PRs). Raise to 1 once per-role GitHub App
#    identities exist.
#
# Usage: ./02-branch-protection.sh <owner/repo> <branch> [check-names-csv] [review-count]
#   check-names-csv: comma-separated required check contexts
#                    (default: "path-restriction-check,check")
set -euo pipefail
REPO="${1:?Usage: 02-branch-protection.sh <owner/repo> <branch> [check-names-csv] [review-count]}"
BRANCH="${2:?Provide the default branch name, e.g. master}"
CHECK_NAMES="${3:-path-restriction-check,check}"
REVIEWS="${4:-0}"

# Split the comma-separated check names into a JSON array of non-empty contexts.
CONTEXTS_JSON="$(printf '%s' "$CHECK_NAMES" | jq -R 'split(",") | map(select(length > 0))')"

# NOTE: this endpoint needs a real JSON body — `gh api -f` stringifies values
# ("true" instead of true, "0" instead of 0) and 422s on the nested objects.
jq -n \
  --argjson contexts "$CONTEXTS_JSON" \
  --argjson reviews "$REVIEWS" '
{
  required_status_checks: { strict: false, contexts: $contexts },
  enforce_admins: true,
  required_pull_request_reviews: {
    required_approving_review_count: $reviews,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false
}' | gh api --method PUT \
      -H "Accept: application/vnd.github+json" \
      "repos/${REPO}/branches/${BRANCH}/protection" \
      --input -

echo
echo "Branch protection applied to ${REPO}@${BRANCH}."
echo "  required checks : ${CHECK_NAMES}"
echo "  required reviews: ${REVIEWS}"
echo
echo "WARNING: every listed check must exist and actually run on PRs, or every"
echo "merge will block on a check that never reports. Verify first:"
echo "  gh run list --workflow=path-restriction.yml --limit 5"
echo "  gh run list --workflow=ci.yml --limit 5"
echo
echo "Verify protection with:"
echo "  gh api repos/${REPO}/branches/${BRANCH}/protection"