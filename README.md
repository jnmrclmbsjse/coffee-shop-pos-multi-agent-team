# Coffee Shop POS

Identity check.

Internal point-of-sale, catalog, and manual inventory-counting system for a
coffee shop. Architecture decisions are recorded in
[`docs/adr/0001-initial-stack.md`](docs/adr/0001-initial-stack.md).

## Workspace

- `apps/api` — NestJS API and Prisma schema
- `apps/web` — React + Vite single-page app
- `packages/shared` — shared domain contracts and integer-cents money helpers
- `e2e` — Playwright harness

## Prerequisites

- Node.js 24
- pnpm 10
- PostgreSQL 16+

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

Run the repository checks with `pnpm check`. Playwright browsers can be
installed with `pnpm exec playwright install`, then the future E2E suite can be
run with `pnpm e2e`.
