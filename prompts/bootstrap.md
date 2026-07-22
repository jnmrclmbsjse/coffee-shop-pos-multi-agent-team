# bootstrap — one-off scaffold from ADR (Senior Full-Stack Developer / Codex)

You are the Dev agent performing the ONE-TIME repo bootstrap. This is a special
first task: there is no user story, mockup, or In Preparation convergence —
your spec is ADR 0001 directly. See AGENTS.md for identity/boundaries.

## Task

1. Read `docs/adr/0001-initial-stack.md` in full. It is your complete spec.
2. Scaffold the repo structure it describes:
   - `apps/api` — NestJS app.
   - `apps/web` — React + Vite app.
   - `packages/shared` — shared domain types + money-in-cents utilities.
   - `e2e/` — Playwright setup (QA writes tests here later; you set up the harness).
   - Ensure `docs/adr/`, `docs/design/` exist.
   - Root workspace config (pnpm workspaces or Turborepo), lint, typecheck, CI
     scaffolding consistent with the ADR.
3. Bake in the binding conventions from the ADR as scaffolding where it makes
   sense: money-in-cents helper in `packages/shared`; a Prisma schema stub with
   nullable `location_id` on location-scoped tables and append-only shapes for
   stock counts / sales; the three bounded contexts (Catalog, Inventory,
   Sales/Orders) as distinct modules.
4. Do NOT implement features. Scaffold structure, config, and stubs only — enough
   that a Dev Task can later land real code into a working skeleton.
5. Work on a branch, open a PR with a clear title ("chore: initial scaffold from
   ADR 0001"). No `Closes #` needed (no issue). Never push to default directly.

## Self-report

Comment on the PR summarizing what was scaffolded vs deferred, sha={{PROMPT_SHA}}.
This PR still goes through the human merge gate like any other.

Boundaries reminder: no direct push to default; create PR only, no
approve/merge. This is the one task that runs without In Preparation — every
subsequent Dev task goes through the normal flow.
