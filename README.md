# Coffee Shop POS (Multi-Agent Team)

Repo + GitHub configuration for the internal coffee-shop POS built by the
multi-agent team. See `docs/adr/0001-initial-stack.md` for the stack and
architecture decisions.

## What's in this bundle

Two kinds of thing — treat them differently:

**Run-once setup (scripts, not committed as-is):**
- `scripts/setup/*.sh` — labels, Projects v2 fields, branch protection
- Run these against your repo once, in the order below.

**Permanent repo files (commit these to the repo root):**
- `CLAUDE.md` — role + project context, auto-read by Claude Code (Tech Lead, QA)
- `AGENTS.md` — role + project context, auto-read by Codex (PO, Dev)
- `docs/adr/0001-initial-stack.md` — the stack/architecture decision record
- `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md` — issue/PR templates
- `.github/workflows/path-restriction.yml` + `scripts/ci/check_path_restrictions.py` — the path-restriction CI check
- `.github/agent-access.json` — role → allowed-paths map for that check

## Prerequisites
- `gh auth login` already run, with an account that has admin rights on the target repo
  (branch protection requires admin, not just write)
- The repo already exists
- A Projects v2 board already exists (create via UI or `gh project create --owner <owner> --title "..."`)

## Run order

```bash
chmod +x scripts/setup/*.sh

# 1. Labels
./scripts/setup/01-labels.sh <owner/repo>

# 2. Projects v2 fields (Status, Priority)
./scripts/setup/03-project-fields.sh <owner> <project-number>

# 3. Branch protection — do this LAST, after the path-restriction CI
#    check job actually exists in .github/workflows/, or merges will
#    block on a check that never reports
./scripts/setup/02-branch-protection.sh <owner/repo> <default-branch>
```

Copy `.github/ISSUE_TEMPLATE/*.yml`, `.github/ISSUE_TEMPLATE/config.yml`, and
`.github/pull_request_template.md` into your repo — these don't need a script,
GitHub picks them up automatically once committed.

## Important caveat — Issue Types vs. labels

Native GitHub Issue Types (Epic/Story/Task/Bug as a first-class field, not a label)
**only work on repos owned by a GitHub Organization**, and must be defined first in
Organization Settings → Issue Types (no CLI command creates new types, only
`gh issue create/edit --type` to *use* ones that already exist).

Everything in this setup uses **labels** (`type:epic`, `type:story`, etc.) instead,
which works identically on a personal-account repo or an org repo. If your repo is
under an org, you can layer native Issue Types on top later — define them in Org
Settings, then use `gh issue edit <n> --type <TypeName>` alongside (or instead of)
the `type:*` labels. Not required for anything else here to function.

## What's intentionally not automated here

- Sub-issue hierarchy and blocked-by dependencies: `gh issue develop`/`gh issue edit`
  gained hierarchy and dependency support in gh CLI v2.94.0+ — set these per-issue
  as Tech Lead creates the breakdown during In Preparation, not as a one-time setup step.
- The path-restriction CI check itself (job that fails a PR touching paths outside
  a role's allowed set) — this is application code, not repo config, and needs to
  exist before step 3 above is run.
- Per-role bot identities/PATs and MCP server config — separate step, since it
  depends on how you want to manage bot accounts (real GitHub users vs. a GitHub App).
