# Project Context

Internal POS + inventory + product/catalog management for a coffee shop
(single location, second branch imminent). Users are admin and staff only.

**Stack:** TypeScript end-to-end. NestJS (`apps/api`), React + Vite (`apps/web`),
PostgreSQL + Prisma, shared domain types in `packages/shared`. Playwright e2e at
repo-root `e2e/`. Deployed containerized on AWS.

**Binding conventions (see ADR 0001 for full detail):**
- Money in integer cents, never floats.
- `location_id` on location-scoped tables, nullable for now (branch-readiness).
- Sale writes idempotent (client-generated ID, replayable).
- Stock counts and sales are append-only; corrections are new records, not edits.

**Bounded contexts:** Catalog (menu definitions), Inventory (manual open/close
counts, NOT a live ledger in v1), Sales/Orders. Keep them distinct.

**v1 Non-Goals:** offline mode, hardware integration, recipe/BOM depletion,
inter-branch logistics, real-time stock ledger. PO: write stories in
user-facing terms; if a request implies one of these, it needs explicit
scoping. Dev: bounce anything implying these via `needs-clarification`.

**VCS rule (hard):** no AI attribution anywhere. Never add a `Co-Authored-By:
Claude …` trailer, a "Generated with Claude Code" line, or any similar
attribution to a commit message or PR description.

Full architecture decisions live in `docs/adr/` — read that before assuming
anything not stated here.

`AGENTS.md` is a symlink to this file. Codex reads that name, Claude Code reads
this one, and they must not be allowed to say different things. They used to be
two separate files documenting two disjoint halves of the role set, which is
how the Tech Lead's merge rights came to be documented backwards in one and
correctly in the other.

---

# The agentic pipeline

**If you are an agent dispatched by a lane, the role sections are not in this
file.** Your charter was injected into your prompt by `render()`. This section
exists for someone working on the pipeline itself.

## Where things live

| Path | What it is |
|---|---|
| `charters/_shared.md` | cross-role contract — self-reporting, board statuses, scope discipline. Injected into EVERY lane |
| `charters/<role>.md` | one charter per role: `po`, `techlead`, `uiux`, `qa`, `dev`, `deploy`, `discovery` |
| `prompts/` | one template per lane, plus `_conventions.md` |
| `scripts/` | wrappers, the poller, `ci/`, `setup/`, `tests/` |
| `docs/adr/` | architecture decisions (Tech Lead owns) |
| `docs/design/` | mockups + design tokens (UI/UX owns) |
| `infra/` | Pulumi + `DEPLOYMENT.md` (Release/Deploy owns) |

## The charter rule

**A charter belongs to a role. The engine is swappable; the role is not.**

Codex runs the PO, Dev and Deploy lanes; Claude runs Tech Lead and QA; UI/UX and
Discovery run on either. That is a scheduling fact, not a boundary — so charters
are keyed on the **role** and injected, never discovered by file name and never
split across two documents by engine.

`render()` substitutes `{{CHARTER}}` with `charters/_shared.md` plus the role's
own charter. A template that declares `{{CHARTER}}` and is rendered **without a
role fails loudly**, because a lane running with the literal text `{{CHARTER}}`
in its prompt would run with no boundaries at all and still look like it worked.

Two lanes do not take an issue number and so cannot use `render()` —
`po-intake.sh` (free requirement text, awk-substituted) and `discovery.sh` (no
issue at all). Both call `charter <role>` directly. If you add a third such
lane, it must do the same.

Verify the whole mechanism with:

```bash
./scripts/tests/charter-injection.test.sh
```

## Lane map

| Lane | Trigger | Script | Engine | Role charter |
|---|---|---|---|---|
| intake | human, no label | `po-intake.sh` | Codex | `po` |
| `prepare` | no `agent:*`, In Preparation | `po-prepare.sh` | Codex | `po` |
| ├─ Step 1 | spawned by prepare | `techlead-feasibility.sh` | Claude | `techlead` |
| ├─ Step 2 | spawned by prepare | `qa-testability.sh` | Claude | `qa` |
| └─ Step 3 | spawned by prepare | `uiux-mockup.sh` | either | `uiux` |
| `po` | `agent:po` + `needs-clarification` | `po-clarify.sh` | Codex | `po` |
| `dev` | `agent:dev` | `dev-pickup.sh` | Codex | `dev` |
| `tech-lead` | `agent:tech-lead` | `techlead-review.sh` | Claude | `techlead` |
| `adr` | `blocked-on-adr` + revise trigger | `techlead-adr-revise.sh` | Claude | `techlead` |
| `qa` | `agent:qa` | `qa-test.sh` | Claude | `qa` |
| `deploy` | `agent:deploy` | `deploy.sh` | Codex | `deploy` |
| `discovery` | backlog empty + cooldown | `discovery.sh` | either | `discovery` |

The one label nothing else applies is `agent:deploy` — QA applies it on pass
(`prompts/qa-test.md`). Break that and the deploy lane silently starves.

Two lanes land their own PR. The **design** lane's merge lives in its wrapper
(`auto_merge_story_pr uiux` in `scripts/uiux-mockup.sh`), CI-gated, with the
agent holding no merge path at all — do not put `gh pr merge` back into
`prompts/uiux-mockup.md`. The **QA** lane still arms `--auto` from inside its
own prompt; since `master` requires 0 approving reviews, that merges on green CI
with no review. `auto_merge_story_pr` already carries a `qa` scope
(`e2e/`) if you want to move QA behind the same gate.

## Editing rules

- **Edit a charter in `charters/`, never in a rendered prompt.** The prompts
  hold a placeholder, not a copy.
- **Adding a lane means three entries in `poll.sh`** — `label_for`,
  `script_for`, `single_for`. A lane missing from either of the first two is
  refused loudly on purpose (`NOT WIRED`); without that guard every open issue
  gets escalated to `agent:human` in one cycle.
- A new role means a new `charters/<role>.md`, a `{{CHARTER}}` placeholder in
  its template, and the role passed at the `render()` call site.
