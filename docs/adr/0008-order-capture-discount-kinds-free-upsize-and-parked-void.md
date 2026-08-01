# ADR 0008: Order Capture — Discount Kinds, Free-Upsize Promotion, Line Preferences & Parked-Order Void

- **Status:** Proposed
- **Date:** 2026-08-02
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001, ADR 0004 and ADR 0007. **Amends
  ADR 0005 §2 and §4.** ADR 0005 fixed the order's shape from the read side and
  listed, as explicit revisit triggers, the three things story #195 now asks
  for: a second discount kind, an order-level discount, and voiding a parked
  order. This ADR is that revisit. It also decides the two capture-side
  concepts ADR 0005 never had to name — the free-upsize promotion and per-line
  taste preferences — and states the settlement validation rules as binding
  arithmetic rather than screen behaviour.

---

## Context

Story #195 ("Take, park, and settle customer orders") is the order **capture**
story ADR 0005 §8 named and deferred: "The order capture path (parking,
completing, voiding, settling change) belongs to a new `apps/api/src/orders`
module owned by the upstream capture story of ADR 0004 §6. It does not exist
yet." That module still does not exist. `apps/api/src/sales` is a scaffold that
today owns only ADR 0007's active-cashier endpoints; nothing in the codebase
writes a `Sale`.

Most of what #195 needs is already decided and already in the schema on
`master`. `Sale` carries `dayOrderNumber`, `status`, `customerName`,
`serviceType`, `subtotalCents`, `discountCents`, `cashReceivedCents`,
`changeOwedCents`, `changeSettledAt`, `completedAt`, `voidReason`,
`cashierStaffMemberId` and `cashierNameSnapshot`; `SaleLine` carries
`lineGrossCents`, `discountKind`, `discountCents`, `lineTotalCents` and its name
snapshots; `SalePayment` carries `CASH` | `ONLINE` splits. Per-trading-day
numbering under a row lock (ADR 0005 §3), withheld-change semantics (§5),
walk-in as NULL (§6), and server-resolved cashier attribution at order start
(ADR 0007 §6) all stand unchanged and this ADR does not reopen them.

Five of the story's acceptance criteria are **not** covered, and four of the
five sit in the money high-risk area:

1. **"a PWD or Senior discount of 20%".** `LineDiscountKind` is
   `NONE | SENIOR`. ADR 0005 §4 states the enum is deliberate and lists "a
   second discount kind appears" as the trigger to re-decide.
2. **"one or more free upsizes, valued at ₱30 each, only when the order
   contains a product in a coffee category. Each free upsize reduces the amount
   due."** This is an **order-level** reduction with an **eligibility
   predicate** over Catalog. Nothing in the schema represents it, ADR 0005 §4's
   total formula has no term for it, and "coffee category" is not a concept
   Catalog carries today — `Category` has `name`, `sortWeight`, `active` and
   nothing else.
3. **"Staff can void a persisted order by providing a reason."** Persisted
   includes **parked**. ADR 0005 §2 implements void as a correcting `Sale`
   (`kind = VOID`, `correctsSaleId`) with negative-signed payment rows — which
   is meaningless for a parked order that has no payments and no revenue to
   negate, and would burn a second `dayOrderNumber` on a phantom row. ADR 0005
   named this exactly: "Order-level void is wanted without a correcting row
   (e.g. voiding a parked order) → re-decide §2; today a parked order that is
   abandoned has no representation, which is a gap the capture story must
   raise." This is that raise.
4. **"any combination of Sweeter, Stronger, Less sweet, and Less ice, and …a
   free-text taste note."** No representation on `SaleLine`. It is not money,
   but it changes the **line merge rule** in (5), which is.
5. **"Tapping the same size of the same undiscounted product again increases
   that line's quantity."** Whether two taps produce one line of quantity 2 or
   two lines of quantity 1 determines `lineGrossCents`, and with a percentage
   discount and per-line half-up rounding (ADR 0005 §4) those two shapes can
   differ by a cent. The merge key is therefore arithmetic, not UI.

Two further constraints. ADR 0004 §3's `expected_cash` and ADR 0006's cup-and-lid
reconciliation are **merged, screen-visible** read models; any new money term
must either flow through them correctly or be explicitly excluded. And ADR 0005
§4's rounding rule (half-up, per line, percentage discounts only) must remain
the only place in the system where a figure divides — or it stops being a rule.

---

## Decision

### 1. `apps/api/src/orders` is the capture module; `reporting` stays read-only

Create `apps/api/src/orders`, owning every write path in this story: create,
mutate-while-parked, park, resume, void, and settle. It owns `Sale`, `SaleLine`
and `SalePayment` writes exclusively.

`apps/api/src/reporting` keeps ADR 0005 §8's property — no POST/PATCH/DELETE
routes at all — and story #142's history views continue to read through it.
`apps/api/src/sales` keeps ADR 0007's active-cashier endpoints and gains
nothing; the orders service **calls** it (or its service) to resolve the
device's current cashier, per ADR 0007 §6, and never accepts a cashier identity
from the request body.

Product browsing and the temporary sold-out toggle are **Catalog**
(`Product.available`, already on the schema, already owned by story #40). The
orders module reads Catalog for pricing and eligibility and never writes it.
This is the contexts boundary from CLAUDE.md held intact: one write owner per
concept.

### 2. `LineDiscountKind` gains `PWD`. The enum survives; the rate does not move

```prisma
enum LineDiscountKind {
  NONE
  SENIOR
  PWD
}
```

- **PWD and Senior are both 20% of `lineGrossCents`**, computed and rounded
  exactly as ADR 0005 §4 already specifies (half-up, per line, to the cent).
  No new arithmetic and no second rounding site.
- They are **mutually exclusive per line** — `discountKind` is one value, not a
  set. A line is undiscounted, Senior, or PWD.
- `discountKind` and `discountCents` remain **stored at capture and never
  recomputed at read time** (ADR 0005 §4, unchanged).
- **No identification capture.** The story is explicit that PWD/Senior ID
  details are not requested or stored, and no column for them exists or may be
  added. The discount kind is the entire record of the claim.

**Why the enum survives its own revisit trigger.** ADR 0005 anticipated moving
to a discount table with a stored per-line rate. That move is not yet earned:
PWD and Senior share one statutory rate, so a rate column would hold the same
constant on every discounted row and buy nothing. The trigger is re-armed
below, sharpened: it is a **differently-rated** or **stackable** kind that
forces the table, not merely a third label.

### 3. The free upsize is an order-level promotion with a stored value

Two new columns on `Sale`:

| Column | Type | Notes |
|---|---|---|
| `freeUpsizeCount` | `Int`, default 0 | Number of free upsizes granted. `>= 0`. |
| `freeUpsizeCents` | `Int`, default 0 | Their total value, **stored, never recomputed**. |

```
FREE_UPSIZE_VALUE_CENTS = 3000                       # ₱30.00, capture-path constant
freeUpsizeCents         = freeUpsizeCount × 3000
```

- Like the line discount, the **value is frozen at capture**. Changing the
  upsize value later must not retroactively alter a past order's total.
- It is deliberately **order-level, not a line**. It does not name which drink
  was upsized, because the story does not ask staff to say. Adding a phantom
  `SaleLine` to carry it would corrupt `subtotalCents`, the line-total sum
  invariant, and the packaging derivation in §7.
- It is **not** folded into `Sale.discountCents`. That column stays Σ of the
  lines' `discountCents` (ADR 0005 §4), so the story's "subtotal, total
  discount, amount due" display and the history projection both keep a single
  unambiguous meaning for each figure. How the workspace labels the upsize line
  in its running total is a design question, not this one.

**Eligibility.** A free upsize may be recorded **only if the order contains at
least one line whose product's category is flagged as coffee.** Catalog gains:

```prisma
model Category {
  // ...existing fields
  isCoffee Boolean @default(false) @map("is_coffee")
}
```

- The predicate is **evaluated server-side on every write** that sets or
  changes `freeUpsizeCount`, against the order's current lines. The client may
  hide the control, but the server decides. Removing the last coffee line from
  an order that carries upsizes must reset `freeUpsizeCount` and
  `freeUpsizeCents` to 0 in the same transaction rather than leaving an
  ineligible order settleable.
- **Which categories are coffee is data, not architecture.** The flag is
  provisioned by seed/migration in v1 — the same stopgap ADR 0007 §1 took for
  the roster↔account link — and the admin control for it belongs to Catalog
  story #40, not here. Story #195 must not grow a category-editing screen.
- The flag lives on `Category`, not `Product`, because the story says "a
  product in a coffee category". Multiple categories may be flagged.

### 4. Order total arithmetic (binding — amends ADR 0005 §4)

```
lineGrossCents  = unitPriceCents × quantity
discountCents   = round_half_up(lineGrossCents × 20 / 100)   # SENIOR or PWD
discountCents   = 0                                          # NONE
lineTotalCents  = lineGrossCents - discountCents

Sale.subtotalCents   = Σ lineGrossCents                      (pre-discount)
Sale.discountCents   = Σ line discountCents                  (line discounts only)
Sale.freeUpsizeCents = freeUpsizeCount × 3000
Sale.taxCents        = 0                                     (ADR 0004 §3, unchanged)
Sale.totalCents      = subtotalCents - discountCents - freeUpsizeCents + taxCents
```

- **`totalCents` is the amount due.** It must be `>= 0`, enforced on the
  capture path in application code. An upsize count large enough to drive the
  total negative is rejected at the point it is entered; it is not clamped
  silently.
- **Totals are always server-computed.** The capture endpoints accept lines,
  quantities, discount kinds and an upsize count — never `subtotalCents`,
  `discountCents`, `freeUpsizeCents` or `totalCents`. Any such field in a
  request body is ignored, not trusted. This is what makes the story's "staff
  cannot directly edit calculated totals" structural rather than a disabled
  input.
- **`freeUpsizeCents` introduces no new rounding.** `3000 × n` is exact. ADR
  0005 §4's half-up rule remains the only division in the system.
- **ADR 0004 §3's cash arithmetic is unchanged and needs no amendment.**
  `cash_sales` and `online_sales` sum `SalePayment.amountCents`, and §6 below
  requires the payments to sum to `totalCents` exactly — so the upsize reduces
  reported sales through the payment rows automatically, with no new term.
  This is the reason the promotion reduces the total rather than being recorded
  as a separate give-away figure.

### 5. Line preferences, the free-text note, and the merge key

```prisma
enum TastePreference {
  SWEETER
  STRONGER
  LESS_SWEET
  LESS_ICE
}

model SaleLine {
  // ...existing fields
  preferences TastePreference[]
  tasteNote   String?           @map("taste_note")
}
```

- A Postgres enum array, not four booleans and not free text. The story asks
  for "any combination", including combinations that read as contradictory
  (Sweeter **and** Less sweet) — the system records what staff selected and
  does not arbitrate. A fifth preference is a migration either way; the array
  keeps `SaleLine` from growing a column per option and keeps the history
  projection a single field.
- `tasteNote` is free text, nullable, and **never parsed** — it is not a
  second channel for preferences.
- Preferences and the note are **per line**. The story's "preferences on one
  line do not alter another line" is satisfied by construction.

**Merge key (binding).** Adding a product size to an open order increments an
existing line's `quantity` **if and only if** every one of these matches an
existing line: `productVariantId`, `discountKind = NONE` on both, an empty
`preferences` array on both, and a NULL `tasteNote` on both. Otherwise a **new
line** is appended.

- A discounted, preference-bearing or annotated line is **never** merged into,
  because merging would change which gross the 20% is taken on and, with
  half-up per-line rounding, can shift the order total by a cent.
- Quantity increase/decrease and line removal are permitted **only while
  `status = PARKED`** (§7). Decrementing to zero removes the line.

### 6. Settlement validation (binding)

Settlement is the single `PARKED → COMPLETED` transition. All of the following
are enforced server-side, in the settling transaction; a client-side check is a
convenience, never the gate.

```
cash_portion   + online_portion = totalCents      # exactly, both >= 0
cashReceivedCents defaults to cash_portion when omitted
cashReceivedCents >= cash_portion                 # rejected otherwise
arithmetic_change_due = cashReceivedCents - cash_portion     # derived, shown pre-settlement
0 <= changeOwedCents <= arithmetic_change_due     # withheld ≤ change due
cashTipCents > 0 requires cash_portion > 0
```

- **Payment rows.** A cash-only order writes one `CASH` `SalePayment`; an
  online-only order one `ONLINE`; a split writes both. A zero-valued portion
  writes **no row** for that method, so `Σ SalePayment.amountCents = totalCents`
  holds for every completed order and ADR 0004 §3's sums stay correct.
- **`cashReceivedCents` stays NULL when there is no cash portion**, per ADR
  0005 §5. Blank-means-exact applies only to a cash-bearing payment.
- **`changeOwedCents` is withheld change, not change due** — ADR 0005 §5
  stands unchanged, including that settling it sets `changeSettledAt` without
  decrementing the amount, and that it feeds `outstanding_change` in expected
  cash. The capture path is what writes it; the story's "the outstanding amount
  remains visible and owed until staff confirms it was handed over" is the
  `changeSettledAt` write.
- **The tip rule is a capture-path invariant, not a screen rule.** A tip
  without cash in the tender would inflate `expected_cash` (ADR 0004 §3
  includes tips because they are physically in the drawer) against a drawer
  that never received it.
- **`cashReceivedCents >= cash_portion` is enforced here but not as a database
  `CHECK`** — ADR 0005 §5 requires historical v1 rows that breach it to remain
  importable and displayable.

### 7. Parked is mutable, void is two mechanisms (amends ADR 0005 §2)

```prisma
enum OrderStatus {
  PARKED
  COMPLETED
  VOIDED
}
```

ADR 0005 §2 declared `OrderStatus` "deliberately two-valued" and derived the
Void label solely from the existence of a correcting row. That was correct for
the read-only story, which only ever saw completed orders voided. It does not
survive contact with a parked order, so:

- **Voiding a COMPLETED order is unchanged.** It remains a correcting `Sale`
  (`kind = VOID`, `correctsSaleId`, required `voidReason`, negative-signed
  payment rows, its own `tradingDayId` and its own `dayOrderNumber`). The
  original keeps its number and its `COMPLETED` status. ADR 0005 §2, ADR 0004
  §2 and the merged reporting read model are untouched by this ADR on that
  path.
- **Voiding a PARKED order transitions the row itself** `PARKED → VOIDED`,
  writing `voidReason` on that same row. **No correcting `Sale` is created** —
  there are no payments to negate, no revenue to reverse, and a phantom row
  would consume a second `dayOrderNumber` for an order that never happened.
  The parked row keeps the number it was allocated at park time, which is
  precisely ADR 0005 §3's "gaps are legitimate history".
- **The mutability invariant is restated, tightened:** application code must
  not `UPDATE` a `sales` row, or any of its lines or payments, unless that
  row's stored `status` is `PARKED`. `PARKED` has exactly **two** exits —
  `→ COMPLETED` and `→ VOIDED` — and both freeze the row permanently. There is
  no transition out of `COMPLETED` or `VOIDED`. The single exception already
  granted by ADR 0005 §5 stands: `changeSettledAt` may be set once on a
  `COMPLETED` row.
- **Displayed status is derived** as: a correcting row exists → `Void`; else
  `status = VOIDED` → `Void`; else `status` verbatim. Every consumer —
  #142's history, reporting — must derive it the same way.
- **An order with no items is never persisted.** Per the story, the first item
  is what creates the row (and allocates the number). An emptied parked order
  is voided or discarded before persistence, never left as a zero-line row.

**Consequences for the merged read models, which the dev tasks must apply:**

- `order_count` in `apps/api/src/reporting/reporting.service.ts` must require
  `status = 'COMPLETED'` — ADR 0005 §2 already flagged this; adding `VOIDED`
  makes it non-optional, because a voided parked order would otherwise count.
- Cash and online sums need no change: `PARKED` and `VOIDED` orders have no
  `SalePayment` rows.
- ADR 0006's cup-and-lid derivation must exclude `status != 'COMPLETED'`
  alongside its existing exclusion of voided-by-correction orders. This
  satisfies the story's "does not contribute to …cup-and-lid usage".

### 8. A free upsize does not change packaging derivation in v1

ADR 0006 derives expected cup and lid usage from `SaleLine.productVariantId` →
`ProductVariant.cupInventoryItemId` / `lidInventoryItemId`. A free upsize means
a larger cup was physically served, but the order records no line change and no
alternate variant, so the derivation continues to draw down the **sold
variant's** cup and lid.

This is a **knowingly accepted understatement** of large-cup usage, bounded by
`freeUpsizeCount` per day and visible as packaging variance at close. The
alternative — inferring which variant was upsized to — requires a size ladder
in Catalog that does not exist and that no story has asked for. It is not
invented here to close a rounding-level gap in a manual count.

### 9. Idempotency and order numbering

ADR 0001's idempotent sale write and ADR 0005 §3's numbering both stand. Made
explicit for the capture path:

- The **client-generated ID identifies the order**, is supplied when the first
  item creates it, and is unique. A replayed create returns the existing order
  and allocates **no** second `dayOrderNumber`.
- **Settlement is idempotent by conditional transition.** The
  `PARKED → COMPLETED` update is guarded on the row's current
  `status = 'PARKED'` within the settling transaction; a replay finds
  `COMPLETED`, writes nothing, creates no duplicate `SalePayment` rows, and
  returns the already-completed order. Idempotency is the database's job here,
  not a request-deduplication cache.
- Numbers are allocated under the `SELECT … FOR UPDATE` lock on the
  `trading_days` row (ADR 0005 §3, unchanged), at the moment the order is first
  persisted.
- **No open trading day, no order.** Every `Sale` requires a `tradingDayId`
  (ADR 0004 §2) and numbering is per day, so order capture requires an `OPEN`
  trading day — story #123's foundation, and a hard dependency rather than a
  degraded mode.
- **Cashier attribution is resolved server-side at order start** from the
  device's current `CashierSelection` and snapshotted into
  `Sale.cashierStaffMemberId` / `cashierNameSnapshot`, exactly per ADR 0007 §6.
  Both NULL when no cashier is active; an order is never blocked by that.
  Later selection changes never rewrite a persisted order.

---

## Consequences

**Positive**

- The story's four uncovered money behaviours — PWD, the upsize promotion, the
  total formula, settlement validation — are each one stated rule with one
  enforcement site, so a reviewer can check them against this file rather than
  against a screen.
- The upsize reduces the total rather than being tracked beside it, so ADR
  0004's expected-cash arithmetic and the merged reporting read model need no
  change at all. That is the cheapest possible integration with a screen the
  owner already sees.
- Storing `freeUpsizeCents` and `discountCents` rather than recomputing means
  no future rate change can rewrite a past order's total — the same property
  ADR 0005 §4 established for line discounts, extended to the promotion.
- Voiding a parked order by status transition keeps `dayOrderNumber` honest and
  keeps every void out of revenue by construction, with no zero-value phantom
  rows in history.
- Server-computed totals and a server-evaluated coffee-category predicate mean
  neither can be defeated by a crafted request, which is what makes the
  story's "staff cannot edit calculated totals" true rather than promised.
- Confining every order write to `apps/api/src/orders` keeps `reporting`
  structurally read-only, so story #142 stays cheap to review.

**Negative / accepted trade-offs**

- The Void label now has **two** sources (a correcting row, or
  `status = VOIDED`) instead of one. Every consumer must derive it identically,
  and a consumer that checks only one source is silently wrong. Accepted
  because the alternative — a payment-less correcting `Sale` — puts a fictional
  order in history and burns a day order number.
- `OrderStatus` is no longer two-valued, so ADR 0005's flat statement about it
  is now wrong on its own and must be read with this ADR. Two ADRs are now
  required to understand one enum.
- Two merged read models (`order_count`, ADR 0006's packaging derivation) must
  be edited as part of this story. They are correct today only because no
  `Sale` row exists; they become wrong the moment the first parked or voided
  order is written. This is dev-task work with a real regression risk, not
  bookkeeping.
- `Category.isCoffee` is seed-provisioned with no admin UI, so changing which
  categories are coffee needs an ops change until story #40 adopts the flag. A
  new coffee category added through the Catalog screen defaults to `false` and
  silently blocks upsizes on its products until someone notices.
- The upsize records no attribution to a drink, so the packaging count
  understates large-cup usage by design (§8), and nobody can later ask "which
  products get upsized most" from v1 data.
- Keeping the discount enum rather than moving to a rate table defers a
  migration that a third, differently-rated discount will force — and that
  migration will then have to backfill rates onto historical rows.
- The merge key excludes any line with preferences, which means an order of
  four identical drinks that all want "less ice" is four lines, not one of
  quantity four. Correct arithmetically, more tapping for staff.

## Revisit triggers

- **A discount with a rate other than 20%, or two discounts stackable on one
  line, or an order-level discount** → ADR 0005 §4's trigger, re-armed and
  sharpened: the enum stops being sufficient, move to a discount table with a
  stored rate per line and backfill historical rows.
- **A discount is ever expressed as an amount off rather than a percentage** →
  ADR 0005 §4's rule is no longer the whole story; re-decide before mixing.
- **PWD/Senior identification ever has to be captured or validated** → this ADR
  forbids storing it; that is a privacy decision needing its own ADR, not a
  column.
- **The free upsize gains a second value, a per-product value, or has to name
  the upsized drink** → §3 and §8 both fall; a `SaleUpsize` child table and a
  Catalog size ladder become necessary together.
- **Any second order-level give-away appears** (voucher, comp, staff drink) →
  `freeUpsizeCents` stops being a general enough term; re-decide §4's formula
  before adding a third subtraction.
- **Packaging variance is traced to upsizes** → §8's accepted understatement is
  no longer acceptable; revisit with ADR 0006.
- **A parked order needs to survive a trading-day close, or move between days**
  → ADR 0005 §2's trigger, unchanged and now more likely, since §7 gives parked
  orders a longer life.
- **A voided parked order ever needs to be resumed, or a void ever needs
  reversing** → §7's permanent freeze falls; re-decide before adding any exit
  from `VOIDED`.
- **Taste preferences need to affect price, or a fifth option appears often** →
  the enum array stops paying for itself; consider a modifier table with its
  own price delta, which would also drag §4's formula.
- **Concurrent registers or a second branch go live** → ADR 0005 §3's row lock
  and ADR 0007's client-supplied `deviceId` both need revisiting, together.
