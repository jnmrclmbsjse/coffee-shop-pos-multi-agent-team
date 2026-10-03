# Coffee Shop POS

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

## Agent orchestrator

The orchestrator continuously polls GitHub issues and dispatches the agent lane
or lanes named after the script. Run it from the repository root:

```bash
./scripts/poll.sh <lane> [lane ...]
```

For example, run only the ADR lane with:

```bash
./scripts/poll.sh adr
```

The positional parameters are lane names. More than one can be supplied; the
poller checks them in the order given on every cycle. With no parameter, it
defaults to `dev`.

| Parameter | What it watches and dispatches |
|---|---|
| `prepare` | Open, unprepared `type:story` issues that are not escalated, ADR-blocked, or awaiting clarification; runs the PO preparation workflow. |
| `po` | Issues labeled `agent:po`, normally stories that need product clarification. |
| `dev` | Issues labeled `agent:dev`; skips work whose blocking issues are still open. |
| `tech-lead` | Issues labeled `agent:tech-lead` for technical review. |
| `qa` | Issues labeled `agent:qa` for QA testing. |
| `deploy` | Issues labeled `agent:deploy` for deployment. |
| `adr` | Stories labeled `blocked-on-adr`; tracks their ADR pull request, dispatches revisions when `adr-changes-requested` is set, and unblocks the story after the ADR merges. |
| `discovery` | Runs discovery when the backlog is empty, subject to the discovery cooldown. |

Common invocations:

```bash
# Development lane only (also the default when no lane is supplied)
./scripts/poll.sh dev

# Check several lanes in this order on every polling cycle
./scripts/poll.sh prepare po dev tech-lead qa deploy adr discovery

# Preview dispatches without running agents
DRY_RUN=1 ./scripts/poll.sh adr
```

Runtime behavior can be adjusted by placing environment variables before the
command:

| Variable | Default | Meaning |
|---|---:|---|
| `POLL_INTERVAL` | `60` | Seconds between polling cycles. |
| `MAX_ATTEMPTS` | `2` | Consecutive failures allowed for one issue before escalation. |
| `MAX_DISPATCHES` | `6` | Total dispatches allowed for one issue before treating it as a workflow loop. |
| `DISPATCH_TIMEOUT` | `3600` | Maximum seconds for one agent run; `0` disables the timeout. On macOS, install GNU coreutils to provide `gtimeout`; without `timeout` or `gtimeout`, this limit cannot be enforced. |
| `MAX_SESSION_HOURS` | `8` | Total poller runtime before a graceful stop; `0` disables the session limit. |
| `MAX_PER_HOUR` | `20` | Maximum dispatches across all lanes in a rolling hour. |
| `DISCOVERY_COOLDOWN` | `14400` | Minimum seconds between discovery runs. |
| `DRY_RUN` | `0` | Set to `1` to show what would be dispatched without running agents. |

For example:

```bash
POLL_INTERVAL=30 MAX_SESSION_HOURS=2 ./scripts/poll.sh dev qa
```

Logs are written to `logs/` and poller state to `.poll-state/`. To stop safely
after the current dispatch, run `touch .poll-stop`; remove that file before
starting the orchestrator again. `Ctrl-C` also stops the poller and releases its
lane locks.
