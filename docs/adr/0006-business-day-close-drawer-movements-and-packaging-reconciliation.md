# ADR 0006: Business-Day Close — Drawer Movements, the Closing Record & Packaging Reconciliation

- **Status:** Proposed
- **Date:** 2026-07-31
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001. **Amends ADR 0004 §3** (the
  expected-cash formula) and **§4** (what a close writes). Incorporates
  ADR 0005 §5's outstanding-change amendment into the same single formula.
  ADR 0004 decided the trading day, the tender split and cash arithmetic, but
  it knows only one non-sale drawer record (`CashExpense`), stores nothing
  about *why* a day's cash was off, and says nothing about cup-and-lid stock.

---

## Context

Story #123 ("Open and close the daily business day") is the capture story that
ADR 0004 §6 said had to exist before reporting could be tested against real
records. Opening is already served by the merged schema: `TradingDay` carries
`businessDate`, `dayType` (`NORMAL` | `PEAK`), `openingFloatCents`,
`openedByStaffMemberId`, and the partial unique index that permits at most one
`OPEN` day per location. Nothing about opening needs a new decision.

Closing does. The story's own Scope Notes name the gap, and discovery
(2026-07-31, `/pos/close`) shows what v1 actually puts on that screen:

- A cash summary with **eight** rows — Cash float, Cash sales, Online sales
  (excluded), Cash tips, **Cash in**, **Cash out**, Expenses (cash), Expected
  cash. The current schema has records for four of them. There is no cash-in
  and no cash-out record anywhere in `apps/`, `packages/` or the schema, and
  `expected_cash` in `packages/shared/src/money.ts` has no term for either.
- A **Discrepancy reason** free-text field. Nothing stores it. `TradingDay`
  has `closedAt` and `closedByStaffMemberId` and no room for a reason, and
  ADR 0004 derives variance rather than recording it.
- A **Cup / lid balance** table (Item / Expected / Actual / Var) over the
  reconciled inventory items. Its inputs are spread across three bounded
  contexts — Catalog owns the variant→cup/lid mapping
  (`ProductVariant.cupInventoryItemId` / `lidInventoryItemId`), Sales/Orders
  owns the completed lines that consumed them, Inventory owns the opening and
  closing `StockCount`s and the delivery/wastage `StockMovement`s. ADR 0001
  keeps those contexts distinct and ADR 0004 says outright that the trading day
  "is not a stock-count phase". No ADR says who computes this figure, and it
  sits one careless step away from the v1 non-goal "real-time stock ledger".

Two further facts constrain the decision.

**v1 shows a negative expected packaging quantity when the opening count is
missing.** Discovery observed Expected `-1` for both cup and lid on a day with
no opening count and one completed drink. That is not a small display bug: it
is the arithmetic silently treating "no baseline" as "baseline zero". The story
requires that a missing actual value be distinguishable from a recorded zero;
the same requirement applies to the expected side, and it has to be decided
here because it is the shape of the calculation, not a rendering choice.

**ADR 0005 §5 already amended expected cash and the amendment was never
implemented.** `reporting.service.ts` computes
`float + cash_sales + tips - cash_expenses`, with no `outstanding_change` term.
Story #123's acceptance criteria list the cash-summary rows and do not mention
withheld change either. If this ADR writes the formula without confronting
that, v2 ships two different expected-cash figures — one merged in reporting,
one on the close screen — which is exactly the drift ADR 0004 §5 was written to
prevent.

This ADR establishes new money arithmetic and a new closing record, so it is a
required decision under the high-risk-area rule. It does not decide screen copy,
field ordering or whether the close button is disabled before validation —
those are story #123's acceptance criteria.

---

## Decision

### 1. One `CashMovement` table replaces `CashExpense`

Cash in, cash out and cash expenses are the same kind of thing — an
append-only, drawer-affecting record against a trading day that is not a sale.
They get one table, not three:

```prisma
enum CashMovementKind { CASH_IN  CASH_OUT  EXPENSE }

model CashMovement {
  id                      String           @id @default(uuid()) @db.Uuid
  tradingDayId            String           @map("trading_day_id") @db.Uuid
  kind                    CashMovementKind
  amountCents             Int              @map("amount_cents")
  description             String
  recordedByStaffMemberId String?          @map("recorded_by_staff_member_id") @db.Uuid
  recordedAt              DateTime         @default(now()) @map("recorded_at")
  ...
  @@index([tradingDayId, recordedAt])
  @@map("cash_movements")
}
```

- `CashExpense` is **migrated, not kept alongside**: create `cash_movements`,
  backfill every `cash_expenses` row with `kind = 'EXPENSE'`, drop
  `cash_expenses`. Two tables with an identical shape and a different name
  would guarantee that some future query sums one and forgets the other.
- `amountCents` stays **signed**, preserving ADR 0004 §4's correction pattern
  ("expense corrections are recorded as new signed rows"). `kind` gives the
  direction, the sign gives correction. A `CASH_OUT` of ₱500 is
  `kind = CASH_OUT, amountCents = 50000`; reversing it is a second `CASH_OUT`
  row of `-50000`, never an edit.
- `description` is required on every movement, including cash in and cash out.
  A drawer adjustment with no stated reason is not auditable, and this is the
  only place the reason can live.

Creating cash movements is **not** story #123's work — the story reads them and
renders zeros until the movement-capture story exists (see §7). Only the table
and the read path land here.

### 2. Expected cash (binding — supersedes ADR 0004 §3 and ADR 0005 §5)

For a trading day, all integer cents, no division, no rounding rule:

```
cash_sales         = Σ SalePayment.amountCents  where method = CASH
online_sales       = Σ SalePayment.amountCents  where method = ONLINE
gross_sales        = cash_sales + online_sales
tips               = Σ Sale.cashTipCents
cash_in            = Σ CashMovement.amountCents where kind = CASH_IN
cash_out           = Σ CashMovement.amountCents where kind = CASH_OUT
cash_expenses      = Σ CashMovement.amountCents where kind = EXPENSE
outstanding_change = Σ Sale.changeOwedCents     where changeSettledAt IS NULL

expected_cash = openingFloatCents
              + cash_sales + tips + cash_in + outstanding_change
              - cash_out - cash_expenses

actual_cash   = latest CashCount.countedCents      (null while OPEN)
variance      = actual_cash - expected_cash        (null while OPEN)
```

- `online_sales` is displayed and **contributes nothing**. Only amounts that
  physically move drawer cash are terms.
- Parked orders need no exclusion clause: they have no `SalePayment` rows
  (ADR 0005 §2). Voids need none either: a void is a correcting `Sale` carrying
  negative payment rows on its own trading day (ADR 0004 §2), so it nets out
  where it actually happened.
- **`outstanding_change` stays in the formula.** ADR 0005 §5 is merged and its
  reasoning holds — withheld change is physically in the drawer. Story #123's
  cash summary must therefore render it as a labelled row; a term that moves
  expected cash without appearing on screen makes the figure unexplainable to
  the person counting the drawer. This is an acceptance-criterion addition for
  the PO, flagged rather than absorbed.
- There is exactly **one implementation** of this formula:
  `calculateCashReconciliation` in `packages/shared/src/money.ts`. The close
  screen and the reporting read model both call it. Reporting's
  `loadDailyReadModel` gains the movement and outstanding-change terms in the
  same change — the two figures are not permitted to differ for one release.

### 3. `varianceCents` is the stored name; "Discrepancy" is screen copy

ADR 0004 standardised the technical name on `variance` after v1 carried three
names for one figure. That holds: schema, DTOs, API and CSV say
`varianceCents`. The staff-facing close screen may label it "Discrepancy" as
story #123 words it — screen copy is the PO's, one stored name is mine. The
sign convention is unchanged: positive is over, negative is short, zero is a
recorded zero and renders as `₱0.00`, never as "—".

### 4. Closing writes a `DayClosing` snapshot

Closing a day is one transaction that: appends a `CashCount`, writes one
`DayClosing`, and performs ADR 0004 §4's single permitted `OPEN → CLOSED`
transition on the `TradingDay`.

```prisma
model DayClosing {
  id                 String   @id @default(uuid()) @db.Uuid
  tradingDayId       String   @unique @map("trading_day_id") @db.Uuid
  cashCountId        String   @unique @map("cash_count_id") @db.Uuid
  openingFloatCents  Int      @map("opening_float_cents")
  cashSalesCents     Int      @map("cash_sales_cents")
  onlineSalesCents   Int      @map("online_sales_cents")
  cashTipsCents      Int      @map("cash_tips_cents")
  cashInCents        Int      @map("cash_in_cents")
  cashOutCents       Int      @map("cash_out_cents")
  cashExpensesCents  Int      @map("cash_expenses_cents")
  outstandingChangeCents Int  @map("outstanding_change_cents")
  expectedCashCents  Int      @map("expected_cash_cents")
  actualCashCents    Int      @map("actual_cash_cents")
  varianceCents      Int      @map("variance_cents")
  varianceReason     String?  @map("variance_reason")
  closedByStaffMemberId String @map("closed_by_staff_member_id") @db.Uuid
  closedByNameSnapshot  String @map("closed_by_name_snapshot")
  closedAt           DateTime @default(now()) @map("closed_at")
  lines              DayClosingLine[]
  @@map("day_closings")
}

model DayClosingLine {
  id              String @id @default(uuid()) @db.Uuid
  dayClosingId    String @map("day_closing_id") @db.Uuid
  inventoryItemId String @map("inventory_item_id") @db.Uuid
  itemNameSnapshot String @map("item_name_snapshot")
  expectedQty     Int?   @map("expected_qty")
  actualQty       Int?   @map("actual_qty")
  varianceQty     Int?   @map("variance_qty")
  @@unique([dayClosingId, inventoryItemId])
  @@map("day_closing_lines")
}
```

- **Snapshot, not derivation.** Every figure above is derivable at close time,
  and every one of its inputs can legitimately change afterwards: a corrected
  `StockCount` is appended (ADR 0001), a later `CashCount` is appended
  (ADR 0004 §4), withheld change is settled. The story requires that the
  recorded closing result is "not silently edited". Storing it is the only way
  to keep that true while the underlying records stay append-only.
- **Where the snapshot and a live recomputation disagree, both are correct and
  neither is a bug.** The snapshot says what was recorded at close; reporting
  keeps deriving current figures per ADR 0004 §5. Any screen showing both must
  label which it is showing.
- **One closing per trading day**, enforced by the unique index on
  `trading_day_id` — not by application code alone. This is the backstop for a
  double-submitted close.
- `varianceReason` is **nullable even when `varianceCents ≠ 0`**. v1 does not
  require it, story #123 says staff "can" enter one, and inventing a hard
  requirement here would be a silent scope addition. Whether a non-zero
  variance should demand a reason is a PO question, and discovery has already
  put it to the human.
- `closedByStaffMemberId` is **required** and must reference an active staff
  member, resolved at write time; `closedByNameSnapshot` follows ADR 0003's
  attribution-snapshot pattern so a later roster change cannot rewrite history.
- Nothing re-opens a closed day (ADR 0004 §4, unchanged). A corrected count is
  a new `CashCount` on the closed day; it does not alter the `DayClosing`.

### 5. Packaging reconciliation is owned by Inventory, computed at read time

The cup-and-lid table is an **Inventory** read model
(`apps/api/src/inventory`), exposed as a day-scoped projection. It owns no new
tables. Catalog and Sales/Orders are read across the module boundary through
their own services; neither gains a stock concern, and Inventory gains no sales
concern beyond reading completed lines for one day.

For each `InventoryItem` with `reconciled = true`, on a trading day with
`businessDate` *D* and location *L*:

```
opening   = the day's OPEN-phase StockCount line quantity for the item
deliveries = Σ StockMovement.quantity  (D, L, item, type = DELIVERY)
wastage    = Σ StockMovement.quantity  (D, L, item, type = WASTAGE)
sold       = Σ SaleLine.quantity for COMPLETED, non-voided sales on this
             trading day whose ProductVariant maps this item as cup or lid

expected  = opening + deliveries - wastage - sold      when opening exists
expected  = NULL                                       when it does not
actual    = the day's CLOSE-phase StockCount line quantity, else NULL
variance  = actual - expected                          NULL if either is NULL
```

- **A missing opening count makes `expected` NULL, never a negative number.**
  Without a baseline there is no balance to reconcile, and v1's `-1` is the
  absence of a baseline rendered as a quantity. NULL renders "—", the same
  treatment the story mandates for a missing actual, and for the same reason:
  unknown is not zero.
- **Corrections win.** Where a `StockCount` has corrections
  (`correctsStockCountId`), the latest correction in the chain supplies the
  line quantity, matching ADR 0001's append-only-corrections rule.
- `sold` counts a variant once per mapped role: a variant mapping the same
  `InventoryItem` as both cup and lid draws it down twice, because it does.
- **Parked and void orders never reduce `expected`.** Parked orders are
  excluded by `status = COMPLETED`; a sale with a correcting VOID row is
  excluded along with the correcting row itself — packaging is not added back
  by a void, and the original is not counted.
- **This is not a stock ledger and must not become one.** It is a single-day,
  date-bounded figure derived on request from records that already exist. No
  running balance is stored, nothing is written on sale, and no `StockMovement`
  is generated by a drink sale. The v1 non-goal stands. It also stays strictly
  packaging: the cup and lid columns Catalog already carries, never a recipe or
  bill of materials, never milk or beans.

### 6. Composition, idempotency and access

- The close screen's payload is composed by the **Cash & Trading Day** module
  (`GET /trading-day/current/closing-summary`), which calls Inventory's
  reconciliation service for the packaging block. Trading Day composes; it does
  not compute stock.
- Open and close are **idempotent on a client-generated ID** (ADR 0004 §4).
  Close additionally performs its state change as a conditional
  `UPDATE ... WHERE status = 'OPEN'`, so a lost race closes once and the second
  request returns the existing closing rather than writing a second one. The
  `DayClosing` unique index is the database backstop; opening relies on the
  existing partial unique index.
- Access reuses ADR 0002's session and `RolesGuard`. Open and close are
  **STAFF-accessible POS operations** — that is what the story asks for and it
  is the role staff already hold for the POS workspace. **No new permission
  rule, no new session model, no new secret handling** is introduced.

### 7. Sequencing (consequence, not a technical choice)

Story #123 can be built and tested in full against the records that exist
today. The rows it reads but nothing yet writes — cash in, cash out, cash
expenses, and the sale-side cash/online/tips/packaging figures — render as
zeros and an empty packaging table until their capture stories land. The
story's own Scope Notes already flag both missing foundations; this ADR fixes
their shape so those stories and this one can be prepared in parallel and
merged in any order.

---

## Consequences

**Positive**
- One drawer-movement table means one place to sum, and a query cannot forget
  a category of cash by forgetting a table.
- One expected-cash implementation in `packages/shared` means the close screen
  and the owner's report cannot disagree — and forces ADR 0005 §5's unpaid
  amendment to be settled now rather than discovered as a variance later.
- A stored `DayClosing` makes "the closing record is not silently edited"
  structurally true while every underlying record stays append-only.
- Making a missing opening count produce NULL removes a v1 arithmetic error at
  the source instead of formatting over it.
- Packaging reconciliation as a derived, day-bounded Inventory projection gives
  the shop the number it needs with no ledger to keep correct.

**Negative / accepted trade-offs**
- Dropping `cash_expenses` is a destructive migration on a merged table. It is
  backfilled, and it is cheap now precisely because so little data exists;
  it would not be later.
- Snapshot and derivation can disagree after a late correction. Deliberate, but
  it means two numbers with one name, and every screen showing either must say
  which.
- The `DayClosing` cash columns duplicate figures derivable from other tables.
  Accepted: that duplication *is* the audit record.
- `outstanding_change` appearing on the close screen changes a figure the PO
  did not ask for. Correct, and visible rather than silent — but it needs the
  PO's sign-off.
- Packaging reconciliation reads across three bounded contexts in one query
  path. Contained inside Inventory, but it is the least separable read model in
  the system.
- Making `varianceReason` optional means a shortage can be recorded with no
  explanation, exactly as v1 permits.

## Revisit triggers

- **A non-zero variance is required to carry a reason** → `varianceReason`
  becomes conditionally required, enforced on the capture path.
- **Closing a day is to be blocked without a closing stock count** → the
  advisory warning becomes a precondition; revisit §4's transaction and §5's
  NULL handling together.
- **A closed day must be corrected in place** → revisit ADR 0004 §4's no-reopen
  rule and decide an explicit adjustment record against `DayClosing`.
- **Packaging reconciliation is wanted across a date range, or per shift** →
  the read-time projection stops being cheap; introduce a stored daily
  packaging summary behind the same read model.
- **Recipe/BOM depletion enters scope** → §5 is the wrong shape entirely; the
  v1 non-goal would be lifted and a real consumption model decided.
- **A second branch goes live** → `location_id` on `CashMovement` and the
  day-scoped packaging query need the same treatment ADR 0001 defers.
- **Non-cash tips or card tender arrive** → §2's terms change; ADR 0004's
  trigger for the same applies here first.
