# ADR 0004: Trading Day, Tender Split & Cash Reconciliation

- **Status:** Proposed
- **Date:** 2026-07-25
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001. ADR 0001 names Catalog, Inventory
  and Sales/Orders and fixes the money/append-only/idempotency conventions, but
  it defines no trading-day boundary, no tender split, no cash counting and no
  cash expenses. This ADR decides who owns those, and what the cash arithmetic
  is.

---

## Context

Story #80 ("View and export back-office business reports") asks for an owner
dashboard and a Reports screen with a daily cash reconciliation and a CSV
export. Its own Scope Notes flag two blockers, both real:

1. **DEPENDENCY** — the reports need recorded trading days, orders, cash and
   online payment amounts, cash tips, closing cash counts, and cash expenses.
   No prerequisite story defines those records or the workflows that create
   them.
2. **ARCHITECTURE GAP** — ADR 0001 defines Sales/Orders but not the ownership
   or rules for trading-day reconciliation, actual cash counts, or cash
   expenses.

The current schema confirms the gap. `Sale` carries `subtotalCents`,
`taxCents`, `totalCents`, `recordedAt` and lines — and nothing else. There is
no trading-day entity, no payment/tender record, no tip field, no cash count,
and no expense record. Every figure on the requested reconciliation table
except gross sales is therefore currently underivable.

Three facts constrain the decision:

- **"Today" means the open trading day, not the calendar date.** The story is
  explicit, and v1 behaves that way (discovery, 2026-07-25: the Dashboard
  reported the open business day Jul 23 while the calendar date was Jul 25).
  A report cannot get this right by bucketing `recordedAt` by date — the day a
  sale belongs to has to be recorded at the time of the sale.
- **Reconciliation is a cash-drawer lifecycle, not a sale.** Opening float,
  closing count, and cash expenses are not transactions against the menu; they
  have a different lifecycle, a different actor, and a different write path
  from a sale.
- **Reporting is strictly read-only.** The story's final acceptance criterion
  makes non-mutation a requirement of the feature, not just a UI convention.

This ADR establishes new money arithmetic (expected cash, tips, cash expenses,
variance) and a new day-boundary invariant, so it is a required decision under
the high-risk-area rule rather than an optional one. It does **not** decide UI
questions (chart axis behaviour, top-N caps, date-input validation) — those
belong to the story's acceptance criteria.

---

## Decision

### 1. A fourth bounded context: **Cash & Trading Day**

Added alongside Catalog, Inventory and Sales/Orders as a distinct NestJS module
(`apps/api/src/trading-day`). It owns the trading-day lifecycle and every cash
record that is not a sale:

- `TradingDay` — `id`, nullable `location_id`, `businessDate` (a DATE, not a
  timestamp), `status` (`OPEN` | `CLOSED`), `openedAt`, `closedAt`,
  `openingFloatCents`, `openedByStaffMemberId`, `closedByStaffMemberId`.
- `CashCount` — an append-only counted-cash record against a trading day:
  `countedCents`, `countedAt`, `countedByStaffMemberId`. The day's *actual
  cash* is its latest `CashCount`.
- `CashExpense` — append-only cash paid out of the drawer during a trading day:
  `amountCents`, `description`, `recordedAt`.

`TradingDay` is **not** a stock-count phase and must not be conflated with
Inventory's `StockCount` (which is keyed by `(location_id, business_date,
phase)` per ADR 0001). Inventory counts stock; this counts money. They share a
business date and nothing else.

**Invariant: at most one `OPEN` trading day per location.** Enforced in the
database by a partial unique index on `(location_id)` where `status = 'OPEN'`,
not only in application code.

### 2. Sales carry their trading day and their tender split

Sales/Orders keeps ownership of the sale, and gains two things:

- **`Sale.tradingDayId` — required, assigned at write time**, never derived
  from `recordedAt`. This is what makes the dashboard's "today", the daily
  reconciliation, and the CSV deterministic and stable, including for sales
  recorded after midnight on a day that is still open.
- **`SalePayment`** — one row per tender against a sale: `method`
  (`CASH` | `ONLINE`), `amountCents`. Modelled as rows rather than two columns
  on `Sale` so a split payment needs no schema change. The sum of a purchase's
  payment rows must equal its `totalCents`.
- **`Sale.cashTipCents`** — an integer-cents column on the sale. v1 records
  cash tips only; a tip is not a `SalePayment` because it is not payment for
  goods and must not enter gross sales.

Voids follow ADR 0001: a correcting `Sale` (`kind`, `correctsSaleId`) carries
its own negative-signed payment rows and its own `tradingDayId` — the trading
day of the correction, not of the original. Reconciliation reflects the drawer
as it actually was on each day.

### 3. Cash arithmetic (binding)

All quantities are integer cents (ADR 0001). No figure below involves division,
so **v1 defines no rounding rule** — introducing one would be a change to this
ADR, not an implementation detail.

For a trading day:

```
cash_sales      = Σ SalePayment.amountCents   where method = CASH
online_sales    = Σ SalePayment.amountCents   where method = ONLINE
gross_sales     = cash_sales + online_sales
tips            = Σ Sale.cashTipCents
cash_expenses   = Σ CashExpense.amountCents
expected_cash   = openingFloatCents + cash_sales + tips - cash_expenses
actual_cash     = latest CashCount.countedCents        (null while OPEN)
variance        = actual_cash - expected_cash          (null while OPEN)
```

- `gross_sales` **excludes tips** — a tip is not revenue. It is in
  `expected_cash` because it is physically in the drawer.
- `expected_cash` is **net of cash expenses**, matching v1 (discovery: Jul 20
  had ₱500.00 of cash expenses and an expected figure reduced accordingly).
- An **open** day has an `expected_cash` but **null** `actual_cash` and **null**
  variance — not zero. Null and zero mean different things and must render
  differently ("—" on screen, empty field in CSV).
- **Sign convention:** `variance` is positive when the drawer holds more than
  expected (over) and negative when it holds less (short).

**Terminology is standardised on "variance"** (`varianceCents`) across schema,
API, screen and CSV. v1 called the same figure "Variance" on screen,
"Discrepancy" in the CSV and `cash_discrepancy` in the database; that
inconsistency is not carried into v2.

### 4. Append-only, with one permitted state transition

- `Sale`, `SalePayment`, `CashCount` and `CashExpense` are **append-only** —
  corrections are new records, never edits (ADR 0001).
- The single permitted mutation in this context is the trading day's
  `OPEN → CLOSED` transition (setting `status`, `closedAt`,
  `closedByStaffMemberId`). **Re-opening a closed day is not supported in v1**;
  a corrected count is a new `CashCount` appended to the closed day, so
  `actual_cash` and variance move while the history of what was counted stays
  intact.
- Day open/close writes are **idempotent** on a client-generated ID, on the
  same grounds as sale writes (ADR 0001) — double-submitting "close day" must
  not produce two closes.

### 5. Reporting is a read-only projection

A separate `reporting` module (`apps/api/src/reporting`) exposes read-only
admin endpoints only. It owns **no tables**. It reads from Sales/Orders and
Cash & Trading Day and returns aggregates; it has no POST/PATCH/DELETE routes
at all, which is what makes the story's read-only criterion structurally true
rather than a UI promise. CSV export is a rendering of the same read model, not
a second query path — the export and the screen cannot disagree.

v1 aggregates **at query time** (SQL `GROUP BY` over sales joined to trading
days). No materialised view, no summary table, no nightly job: the data volume
is one shop's trading history and the ranges are date-bounded.

Access reuses the existing `@Roles(ADMIN)` + `RolesGuard`. **No new permission
rule and no new session model** is introduced by this ADR.

### 6. Delivery sequencing (consequence for the PO, not a technical choice)

The capture side decided here — recording a trading day, its float, the tender
split on each sale, tips, cash expenses and the closing count — is **not** in
story #80, and no story defines it. Reporting cannot be built or tested against
records that nothing creates. Story #80 needs at least one upstream capture
story (trading day open/close + cash count + cash expenses, and the tender
split on the sale path) before its acceptance criteria are reachable. This ADR
fixes the shape so the two can be prepared in parallel, but not merged out of
order.

---

## Consequences

**Positive**
- The dashboard, the reconciliation table and the CSV all derive from one
  read model, so they cannot drift apart.
- Recording `tradingDayId` on the sale makes business-day semantics exact
  rather than reconstructed, including across midnight.
- Payment rows accommodate split tender later with no migration.
- A reporting module with no write routes makes read-only a structural
  property, cheap to review and hard to regress.
- Standardising on "variance" removes a v1 naming inconsistency before any v2
  code carries it forward.

**Negative / accepted trade-offs**
- A fourth bounded context is more scaffolding than folding cash into
  Sales/Orders. Accepted: the drawer lifecycle has a genuinely different write
  path and actor, and merging them is the harder thing to undo.
- Query-time aggregation will get slower as history grows; accepted for a
  single shop with date-bounded ranges.
- No re-open means an incorrectly closed day is corrected by appending a count
  rather than by editing the day. That is deliberate (audit trail) but will
  feel indirect to the owner.
- `Sale.tradingDayId` being required means the sale write path cannot land
  before the trading-day write path. That ordering is a real constraint on
  delivery, stated above.
- Cash tips only. A card/online tip has nowhere to go in this model.

## Revisit triggers

- **Online/card tips become a requirement** → `cashTipCents` on the sale is the
  wrong shape; move tips to their own rows keyed by tender method.
- **Non-cash tender proliferates** (GCash vs card vs voucher reported
  separately) → `SalePayment.method` becomes a reference table rather than an
  enum.
- **Report latency becomes noticeable, or multi-year ranges are wanted** →
  introduce a materialised daily-summary projection behind the same read model
  (the reporting module's read-only boundary is the seam for this).
- **A second branch goes live** → revisit the one-open-day-per-location index
  and whether reporting defaults to a single location or consolidates
  (ADR 0001's `location_id` nullability is revisited at the same time).
- **The owner needs to correct a closed day's float or expenses** → revisit the
  no-re-open rule and decide an explicit adjustment record instead.
- **Tax becomes non-zero on the money path** → revisit §3; `gross_sales` is
  currently the sum of tender and would need an explicit gross/net decision.
