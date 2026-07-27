# ADR 0005: Order Lifecycle, Line Discounts & Change Settlement

- **Status:** Proposed
- **Date:** 2026-07-26
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001 and amends ADR 0004 §3. ADR 0001
  fixes integer-cents money, append-only sales and idempotent sale writes.
  ADR 0004 adds the trading day, the tender split and the cash arithmetic — and
  explicitly leaves rounding undefined because none of its figures divide. This
  ADR decides the order's own shape: how an order is numbered within a trading
  day, how a parked order can be mutable inside an append-only context, how a
  percentage line discount rounds, and what "change owed" actually means.

---

## Context

Story #93 ("View read-only back-office order history") asks for an owner-facing
read-only list and detail view over every order across every business day. Its
acceptance criteria name 23 fields. Almost none of them exist.

The current schema carries `Sale` (`kind`, `correctsSaleId`, `subtotalCents`,
`taxCents`, `totalCents`, `cashTipCents`, `recordedAt`, `tradingDayId`),
`SalePayment` (`CASH` | `ONLINE`, `amountCents`) and `SaleLine` (`quantity`,
`unitPriceCents`, `lineTotalCents`, name snapshots). There is no order number,
no customer, no service type, no parked state, no discount of any kind, no cash
received, no change owed or settlement time, no completion timestamp distinct
from `recordedAt`, and no void reason. A search across `apps/`, `packages/` and
`e2e/` for these concepts returns nothing.

Story #93 is, by the PO's binding decision, **strictly the read-only
projection** — it must not absorb order capture. But a read model cannot be
designed, let alone e2e-tested against seeded rows, until the shape of the
records it reads is fixed. That is the same position story #80 was in, and
ADR 0004 §6 settled the pattern: fix the shape in an ADR so the capture story
and the read-only story can be prepared in parallel and merged in order.

Four of those fields are not schema detail. They are invariants, and three of
them sit in the money high-risk area:

1. **A Senior discount is 20% per discounted line.** This is the first figure
   anywhere in the system that divides. ADR 0004 §3 states outright that v1
   "defines no rounding rule" and that introducing one "would be a change to
   this ADR, not an implementation detail." A percentage discount is precisely
   that change.
2. **"Change owed" does not mean the arithmetic change due.** v1 discovery
   (2026-07-26) is unambiguous: Jul 17 #7 took ₱300.00 cash against a ₱200.00
   order and records **Change owed ₱0.00**, while Jul 23 #1 took ₱100.00
   against ₱50.00 and records **Change owed ₱50.00** with **Change settled**
   forty seconds after completion. The field records change *withheld*, not
   change *due* — and the withheld cash is physically in the drawer, which
   ADR 0004's `expected_cash` does not currently account for.
3. **Order numbers restart at 1 each business day** and are shared across
   Completed, Parked and Void: Jul 20 ran #1 completed, #2 completed, #3
   parked, #4 void. Numbers must survive gaps and status changes without
   renumbering, which makes allocation a concurrency-sensitive invariant, not
   a display concern.
4. **A parked order is mutable.** Its items and totals are fully populated
   while its payment, completion and change fields are blank. That collides
   head-on with ADR 0001's append-only rule for sales, and it has to be
   resolved deliberately rather than discovered during implementation.

Two further discovery facts constrain the decision. A voided order (Jul 20 #4,
₱250.00 Cash) is **absent from that day's reported cash sales** (₱5,000.00) —
so v1 excludes voids from revenue rather than netting them. And the Dashboard's
Orders tile read **1** for Jul 23, which had one completed and one parked order
— so parked orders are excluded from order counts. Both facts bear on the
reporting read model already merged in #90.

---

## Decision

### 1. The order is the `Sale`. No new bounded context, no second entity

Order History is Sales/Orders (ADR 0001) viewed from the back office. The
concepts above are added to `Sale`, `SaleLine` and `SalePayment` rather than to
a parallel `Order` table.

Rejected alternative: a mutable `Order` (draft) that spawns an immutable `Sale`
on completion. It duplicates lines and totals, forces the history read model to
union two tables with different shapes, and makes the shared per-day number
span two sequences. The cost of that duplication is higher than the cost of the
narrowly scoped mutability decided in §2.

New columns on `Sale`:

| Column | Type | Notes |
|---|---|---|
| `dayOrderNumber` | `Int`, required | Per trading day, from 1. See §3. |
| `status` | `OrderStatus`, required | `PARKED` \| `COMPLETED`. See §2. |
| `customerName` | `String?` | **NULL means walk-in.** See §6. |
| `serviceType` | `ServiceType`, required | `DINE_IN` \| `TAKE_OUT`. |
| `discountCents` | `Int`, default 0 | Σ of the lines' `discountCents`. See §4. |
| `cashReceivedCents` | `Int?` | Cash physically taken. NULL when no cash tender. |
| `changeOwedCents` | `Int`, default 0 | Change **withheld**, not change due. See §5. |
| `changeSettledAt` | `DateTime?` | When withheld change was handed over. See §5. |
| `completedAt` | `DateTime?` | NULL while `PARKED`. See §7. |
| `voidReason` | `String?` | Required when `kind = VOID`. See §2. |

New columns on `SaleLine`:

| Column | Type | Notes |
|---|---|---|
| `lineGrossCents` | `Int`, required | `unitPriceCents × quantity`, pre-discount. |
| `discountKind` | `LineDiscountKind`, required | `NONE` \| `SENIOR`. |
| `discountCents` | `Int`, default 0 | Stored, never recomputed. See §4. |

`lineTotalCents` keeps its existing name and becomes explicitly the
**post-discount** line total (`lineGrossCents - discountCents`), matching v1:
the Senior line showed Line total ₱120.00 against a ₱150.00 unit price.

### 2. Void stays a correcting record. Parked is the one mutable status

These are two different mechanisms and conflating them is the trap.

**Void is not a status.** It remains ADR 0004 §2's correcting `Sale`
(`kind = VOID`, `correctsSaleId`) with its own negative-signed payment rows and
its own `tradingDayId`. `voidReason` is a required column on that correcting
row. Order History therefore **derives** the displayed status `Void` from the
existence of a correction, and shows the correcting row's `voidReason`; the
voided original keeps its own `dayOrderNumber`, which is why Jul 20 #4 still
occupies a number.

This preserves append-only, keeps the merged reporting read model (#90)
arithmetically correct with no change, and satisfies the story's "Status is
shown as Completed, Parked, or Void" as a projection rather than a stored
enum. The `OrderStatus` enum is deliberately two-valued — `VOID` is **not** a
member of it.

**Parked is a bounded exception to append-only.** A `Sale` row is mutable if
and only if `status = PARKED`. On the transition `PARKED → COMPLETED` it
freezes permanently, and no transition out of `COMPLETED` exists — a completed
order is corrected only by a correcting `Sale`.

This is the same shape ADR 0004 §4 already established for the trading day
("the single permitted mutation is `OPEN → CLOSED`"), applied one level down.
It is stated as an invariant so that reviewers can check it: **application code
must not `UPDATE` a `sales` row, or any of its lines or payments, unless that
row's stored `status` is `PARKED`.**

Consequence for reporting, which must be applied to the merged read model:
`order_count` in `apps/api/src/reporting/reporting.service.ts` currently counts
`kind = 'PURCHASE'` and would count parked orders. It must additionally require
`status = 'COMPLETED'`, matching v1's Orders tile. Payment sums need no change,
because a parked order has no `SalePayment` rows.

### 3. Per-trading-day order numbers, allocated under a row lock

`dayOrderNumber` is unique per trading day, enforced in the database by a
unique index on `(trading_day_id, day_order_number)` — not in application code
alone.

- Allocated as `MAX(day_order_number) + 1` **within the trading day**, in the
  same transaction as the sale insert, after taking a `SELECT ... FOR UPDATE`
  lock on the order's `trading_days` row. The lock, not the unique index, is
  what makes concurrent registers correct; the index is the backstop.
- Allocated to **parked** orders at park time, and to correcting (void) rows.
  All statuses draw from one sequence.
- **Never reassigned.** A number is not recycled and remaining orders are not
  renumbered, for any reason. Gaps are legitimate history.
- Numbering resets with the trading day, so `(businessDate, dayOrderNumber)` —
  not `dayOrderNumber` alone — is what identifies an order to the owner. Any
  sort or lookup on the number is day-then-number.
- Idempotent replay (ADR 0001) must return the **existing** row's number for a
  repeated `clientGeneratedId` and must not allocate a second number.

### 4. Line discount arithmetic (binding)

The Senior discount is **20% of the line's gross**, computed per line.

```
lineGrossCents  = unitPriceCents × quantity
discountCents   = round_half_up(lineGrossCents × 20 / 100)      # SENIOR
discountCents   = 0                                              # NONE
lineTotalCents  = lineGrossCents - discountCents

Sale.subtotalCents = Σ lineGrossCents        (pre-discount)
Sale.discountCents = Σ line discountCents
Sale.totalCents    = subtotalCents - discountCents + taxCents
```

- **Rounding is half-up, to the cent, per line** — never on the order total.
  Per-line rounding is what makes the displayed line totals sum to the order
  total exactly, with no residual to hide. This is the rounding rule ADR 0004
  §3 deferred; it applies to percentage discounts only, and no other figure in
  the system divides.
- `discountCents` and `discountKind` are **stored at capture time and never
  recomputed at read time.** The history view must show what was actually
  charged, so changing the Senior rate later cannot retroactively alter a past
  order. The rate is a capture-path constant; it is not stored per line.
- `discountKind` is an enum, not a nullable rate. "Senior" is the only
  discount v1 recognises, and the read model renders `NONE` as "None" — the
  labels are presentation over a stored kind, not free text.
- `taxCents` stays `0` in v1 (ADR 0004 §3 unchanged). `subtotalCents` is
  redefined as pre-discount gross; where no discount exists, this is identical
  to today's meaning, so no migration of existing rows' values is required.

### 5. Change owed is withheld change, and it amends ADR 0004's expected cash

`changeOwedCents` records cash the customer is **still owed because it was not
handed over** — not the arithmetic difference between cash received and the
amount due. v1 behaves this way and the owner reads the field that way, so v2
keeps the semantics and fixes the naming.

```
arithmetic change due  = cashReceivedCents - (cash tender for the order)   # derived, not stored
changeOwedCents        = the portion of that deliberately withheld          # stored
```

- `changeOwedCents = 0` when change was given at the counter, even though
  received exceeded the amount due (v1: Jul 17 #7, ₱300.00 for ₱200.00).
- `changeSettledAt` non-NULL requires `changeOwedCents > 0`.
- Settlement **does not decrement** `changeOwedCents`. The amount stays as the
  historical record of what was owed and `changeSettledAt` records that it was
  paid — append-only in spirit, and the reason the list column alone cannot
  distinguish outstanding from settled. How the list presents that distinction
  is story #93's acceptance criteria, not this ADR.
- `cashReceivedCents` must be **≥ the order's cash tender amount**, enforced on
  the capture path in application code, not as a database `CHECK`. v1 holds at
  least one record that breaches it (Jul 17 #1: total ₱100.00, cash received
  ₱90.00), so the constraint must not make historical data unimportable, and
  the read model must display whatever is stored without validating it.

**Amendment to ADR 0004 §3.** Withheld change is cash sitting in the drawer
that does not belong to the shop, so the expected-cash formula gains a term:

```
outstanding_change = Σ Sale.changeOwedCents   where changeSettledAt IS NULL
expected_cash      = openingFloatCents + cash_sales + tips
                     - cash_expenses + outstanding_change
```

Without this term, any day with unsettled change reconciles short by exactly
that amount and the owner sees a false negative variance. This is a change to
the merged reporting read model (#90) and belongs to a dev task on story #80's
reporting module, **not** to read-only story #93 — flagged to the PO in the
self-report on #93.

### 6. Customer, walk-in, and service type

- `customerName` is nullable. **NULL is the stored representation of a walk-in
  order**; the literal string "Walk-in" is never written to the database. The
  read model renders NULL as "Walk-in". v1's "Walk-in 1" / "Walk-in 2" records
  are genuinely named customers and import as their literal text.
- Customer-name search is a case-insensitive substring match over
  `customerName` and does **not** match the rendered "Walk-in" label, matching
  v1. Whether that is the desired behaviour is an acceptance-criteria question
  for the PO, not an architecture one.
- `serviceType` is required on every order, including parked and void ones —
  v1 shows it on all three.

### 7. `completedAt` is independent of the trading day

`completedAt` is a distinct nullable column, not a reuse of `recordedAt`
(which stays the row's write time, per ADR 0001).

- NULL while `PARKED`, and NULL on a correcting (void) row.
- **Not constrained to its trading day's `businessDate`.** v1 holds orders
  whose completion timestamp is four days after their business day (Jul 17 →
  Jul 21) and a day before it (Jul 20 → Jul 19). `tradingDayId` remains the
  sole authority for which day an order belongs to (ADR 0004 §2), so a
  divergent `completedAt` cannot corrupt any report. The read model displays
  both plainly.

### 8. The read-only history endpoints live in the `reporting` module

Order History's list and detail endpoints are added to the existing
`apps/api/src/reporting` module, which by ADR 0004 §5 owns no tables and has
**no POST/PATCH/DELETE routes at all**. Placing them there is what makes story
#93's "read-only, and no create/edit address exists" criterion structurally
true rather than a UI promise — the same property that made it cheap to review
for #80.

The order **capture** path (parking, completing, voiding, settling change)
belongs to a new `apps/api/src/orders` module owned by the upstream capture
story of ADR 0004 §6. It does not exist yet and is not story #93's work.

Aggregation is at query time, date- and page-bounded, per ADR 0004 §5. Access
reuses `@Roles(ADMIN)` + `RolesGuard`; **no new permission rule and no new
session model** is introduced by this ADR.

---

## Consequences

**Positive**
- Void keeps one mechanism across reporting and history, so the merged #90 read
  model stays correct and the owner cannot see a voided order counted as
  revenue.
- Storing `discountCents` per line means the history can never disagree with
  what was charged, and the line totals always sum to the order total.
- Confining mutability to `status = PARKED` gives reviewers a one-line rule to
  check, and keeps every completed order genuinely immutable.
- A row lock plus a unique index makes per-day numbering correct under
  concurrent registers, which a second branch will need.
- Naming withheld change explicitly, and putting it into expected cash, removes
  a real reconciliation error v1 carries silently.
- Read-only history in the write-route-free `reporting` module makes the
  story's central criterion structural.

**Negative / accepted trade-offs**
- Append-only now has an exception. Narrow and stated, but it is no longer a
  flat rule, and every future reader of ADR 0001 needs this ADR alongside it.
- A `FOR UPDATE` lock on the trading-day row serialises order creation within a
  day. Fine for one shop's register throughput; it is a bottleneck to revisit
  before many concurrent registers.
- The displayed status is derived from two sources (`status` plus the existence
  of a correcting row), so it is more expensive to query than a single stored
  enum would be, and every consumer must derive it the same way. Accepted to
  avoid two truths about voids.
- Amending expected cash means this ADR changes a figure the owner has already
  seen on a merged screen. That is the correct fix, but it is a visible change
  in reported numbers, not a silent one.
- Redefining `subtotalCents` as pre-discount is a semantic change to an
  existing column. Safe only because no discounted row exists yet; it would not
  be safe later.
- Rounding half-up favours the shop by at most one cent per discounted line.
  Deliberate, and small enough not to warrant a per-order compensation pass.

## Revisit triggers

- **A second discount kind appears** (student, staff, promo, order-level) →
  `discountKind` stops being sufficient; move to a discount table with a stored
  rate per line, and re-decide whether order-level discounts allocate to lines.
- **A discount is ever expressed as an amount off rather than a percentage** →
  §4's single rounding rule is no longer the whole story; re-decide before
  mixing the two.
- **Parked orders need to survive a trading-day close, or move between days** →
  re-decide §2; the current model ties a parked order to the day it was opened
  on and nothing migrates it.
- **Order-level void is wanted without a correcting row** (e.g. voiding a
  parked order) → re-decide §2; today a parked order that is abandoned has no
  representation, which is a gap the capture story must raise.
- **Concurrent registers or a second branch go live** → revisit §3's row lock
  and whether numbering is per location per day.
- **Tax becomes non-zero** → revisit §4's `totalCents` formula and whether
  discount applies pre- or post-tax (ADR 0004's same trigger applies).
- **Cashier attribution is wanted on the order** → this ADR adds no staff
  column; ADR 0003's `StaffMember` is the join, and discovery flagged that v1's
  Order History shows no cashier at all. That is a PO scope question first.
