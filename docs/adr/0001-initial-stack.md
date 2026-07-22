# ADR 0001: Initial Stack & Architecture

- **Status:** Accepted
- **Date:** 2026-07-23
- **Decision owner:** Technical Lead (verified against running codebase by the Claude Code Tech Lead agent before bootstrap)
- **Context product:** Internal POS + inventory + product/catalog management for a coffee shop

---

## Context

An internal point-of-sale tool for a single coffee shop, with a second branch
imminent. Users are admin and staff only. The product owner is non-technical by
design (writes user-facing stories); the developers are AI agents; the sole
human reviewer's strongest stack is TypeScript/React. Overriding delivery goal:
ship as fast as is responsible.

The domain is smaller than a typical retail POS because of two facts established
during stack discussion:

1. A coffee shop is a **transformation business**, not resale — but recipe/BOM
   depletion is explicitly **out of v1 scope** (see Non-Goals). This removes the
   real-time inventory complexity a resale POS would carry.
2. Inventory in v1 is **manual open/close counting**, mirroring the shop's actual
   workflow — not a live-depleting ledger. Stock is a count log, not a
   transactional balance.

These two facts, plus "one register per shop," mean the classic POS concurrency
and BOM problems do not apply to v1. The architecture is deliberately sized to
that reality rather than to a generic POS.

---

## Decision

### Stack

- **Language:** TypeScript end-to-end.
- **Backend:** NestJS.
- **Frontend:** React (Vite).
- **Database:** PostgreSQL.
- **ORM:** Prisma.
- **Repo shape:** Two-app repository (`apps/api`, `apps/web`) — a pragmatic
  monolith, not a package-heavy monorepo. Shared domain types live in a small
  shared location (`packages/shared` or an equivalent path shared by both apps).
- **E2E tests:** Playwright, at repo root `e2e/`.
- **Hosting:** AWS, containerized — Node API container (ECS/Fargate or EC2),
  static React SPA on S3 + CloudFront. Deliberately the most boring, well-trodden
  AWS deployment shape available.

### Key rationale

1. **Reviewer-fit is a first-class selection criterion.** The system's quality
   ceiling is bounded by how fast the sole human reviewer catches a bad PR.
   TypeScript + React is that reviewer's strongest stack, so the whole system is
   built in it. This is why Laravel and Python/FastAPI were rejected despite
   both being reasonable — neither is the reviewer's fastest-to-review stack, and
   review is the bottleneck.
2. **Agent-legibility.** NestJS enforces module/controller/service structure and
   Prisma centralizes the schema in one declarative file. Framework-enforced
   structure does part of the Tech Lead's boundary-keeping automatically and
   keeps agent-generated code consistent across many PRs — worth the marginal
   extra scaffolding over a less-opinionated option (e.g. Next.js API routes).
3. **Single language, shared domain types.** Core entities (`Product`,
   `Order`, `LineItem`, `StockCount`) are defined once and shared across API and
   web, rather than duplicated and drifting.
4. **Postgres for correctness on the money path.** Even without stock
   concurrency, sales totals require real ACID guarantees.

### Bounded contexts

Kept as distinct modules from day one:

- **Catalog** — product/menu definitions: SKU, name, price, category, variants
  (e.g. size). This is the sellable menu.
- **Inventory** — raw-stock count records and open/close variance, per location.
- **Sales/Orders** — recording transactions.

Catalog and inventory are intentionally separate; conflating them is a common
source of later pain. In v1 they are only loosely coupled (a sale references
catalog items; inventory counting is a parallel manual process, not
transactionally linked to sales).

### Cross-cutting conventions (binding)

1. **Money is stored and computed in integer minor units (cents).** Never
   floats. Applies to all prices, totals, and monetary fields end to end.
2. **`location_id` on all location-scoped tables, nullable for now.** Second
   branch is imminent; this is cheap insurance against a painful retrofit. No
   inter-branch logistics or transfer features in v1 — just ownership scoping.
   A stock count record is keyed by `(location_id, business_date, phase)` where
   phase ∈ {open, close}.
3. **Idempotent sale writes.** Each sale carries a client-generated ID and its
   write is replayable without double-recording. No offline sync in v1, but this
   keeps that door open at near-zero cost and guards against double-submit.
4. **Append-only for stock counts and sales.** Records are immutable once
   written; corrections are new records, not edits. Provides an audit trail the
   business will eventually need and keeps history honest.

---

## Non-Goals (explicit v1 exclusions)

These are deliberately excluded. Any story implying one of these should be
bounced to the Product Owner for scoping, not silently implemented.

- **No offline mode.** Web/browser app, connectivity assumed — not just for v1,
  likely permanently. No local terminal DB, no sync engine.
- **No hardware integration.** No receipt printers, cash drawers, or scanner
  drivers. (Barcode scanners, if ever used, act as keyboard input and need no
  integration.) Browser-based UI only.
- **No recipe/BOM depletion.** Selling a latte does not auto-deplete beans/milk
  in v1. Inventory is manual open/close counting.
- **No inter-branch logistics.** No stock transfers between locations.
- **No real-time stock ledger.** Stock is counted, not continuously decremented.

---

## Consequences

**Positive**
- Fast to ship: boring, single-language, well-trodden AWS deployment.
- Low review friction: everything in the reviewer's strongest stack.
- Structurally consistent agent output via NestJS + Prisma conventions.
- Branch-ready and audit-ready without building either feature yet.

**Negative / accepted trade-offs**
- NestJS + React is two deployables vs. a single Next.js app — marginally more
  scaffolding, accepted for the structural-enforcement benefit.
- Some conventions (idempotent writes, append-only, nullable `location_id`)
  add minor upfront discipline for features not yet needed. Accepted as cheap
  insurance against expensive retrofits.
- Deferring BOM depletion means inventory variance is manual and coarse in v1;
  revisited when/if real-time depletion becomes a requirement.

**Revisit triggers**
- Real-time / recipe-based inventory becomes a requirement → revisit inventory
  model (the append-only count log is a reasonable foundation to build on).
- Offline selling becomes a hard requirement → revisit; idempotent write path
  is the hook that makes this tractable.
- More than a few locations, or inter-branch operations → revisit
  `location_id` nullability and add location as a required, first-class concept.

---

## First execution step

This ADR is a **decision document, not a scaffold**. Per the team's role
boundaries, the Technical Lead decides and records; the Developer executes.
The first Developer task is a one-off **bootstrap** task that takes this ADR as
its spec and creates the repo structure, config, and boilerplate accordingly.
It runs through the standard Dev pickup mechanism but without the full
`In Preparation` convergence, since no user story, mockup, or acceptance
criteria exist yet.
