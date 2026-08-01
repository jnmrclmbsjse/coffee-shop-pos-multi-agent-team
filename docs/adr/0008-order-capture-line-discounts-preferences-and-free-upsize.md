# ADR 0008: Order Capture — PWD/Senior Line Discounts, Per-Line Preferences & the Free-Upsize Promotion

- **Status:** Proposed
- **Date:** 2026-08-02
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0005 and amends ADR 0005 §4. ADR 0005
  fixed the order's shape (per-day numbering, the `PARKED` mutability
  exception, withheld change, the `SENIOR` line discount and its half-up
  per-line rounding) and explicitly reserved the capture path for "a new
  `apps/api/src/orders` module owned by the upstream capture story" that did
  not exist yet. Story #197 is that story. This ADR decides the three money
  and record-shape questions it raises that ADR 0005 did not answer, and
  reconciles the discount conflict ADR 0005 left behind.

---

## Context

Story #197 ("Take, manage, and settle customer orders") is the order **capture**
workflow ADR 0005 §8 deferred. Most of it is implementation against invariants
that are already decided: order numbering (ADR 0005 §3), the `PARKED →
COMPLETED` freeze (§2), void as a correcting `Sale` (§2), withheld change and
`changeSettledAt` (§5), walk-in as NULL `customerName` (§6), the cash/online
tender split (ADR 0004 §3), cash tips excluded from revenue (ADR 0004), and
cashier attribution columns (ADR 0003, ADR 0007). None of that is reopened here.

Four things in the story are **not** covered by a merged decision, and three of
them sit in the money high-risk area. The PO flagged all of them in the story's
Scope Notes as architecture gaps.

**1. PWD is a second discount kind, and ADR 0005 says there is only one.**
ADR 0005 §4 states "'Senior' is the only discount v1 recognises" and models
`discountKind` as a two-valued enum precisely because one rate served one kind.
Story #197 requires "None, PWD, or Senior" per line, each reducing that line's
gross by 20%. ADR 0005's own first revisit trigger — "**A second discount kind
appears** → `discountKind` stops being sufficient; move to a discount table with
a stored rate per line" — fires exactly here. The board currently contradicts
itself and cannot be broken down until it does not.

**2. The free upsize is an amount off, not a percentage, and it is not a line
discount.** The story requires one or more free upsizes when the order contains
a product from a category whose name contains "coffee"; each reduces the amount
due by ₱30 and must be "shown separately from PWD or Senior discounts". ADR
0005's second revisit trigger — "**A discount is ever expressed as an amount off
rather than a percentage** → §4's single rounding rule is no longer the whole
story; re-decide before mixing the two" — fires here. It is also the first
figure that reduces the order total without belonging to any single line, which
collides with ADR 0005 §4's stated property that per-line rounding makes the
displayed line totals sum to the order total exactly.

**3. Per-line preferences have no representation.** Each line can independently
carry any combination of Sweeter, Stronger, Less sweet, Less ice, plus an
optional free-text note. `SaleLine` today carries quantity, prices, discount and
two name snapshots and nothing else. A grep for `preference`, `sweeter`,
`upsize` and `pwd` across `docs/adr/`, `packages/shared/`, `apps/` and the
Prisma schema returns nothing. Preferences also silently change a behaviour the
story specifies: "repeatedly selecting the same undiscounted product and size
increases that line's quantity rather than creating unnecessary duplicate
lines." What counts as "the same" line is now a decision, not an obvious one.

**4. The order grid needs staff read access to the catalog, which it does not
have.** `apps/api/src/catalog/products.controller.ts` is `@Roles(Role.ADMIN)` at
the class level; the only staff-reachable route is
`PATCH :id/availability`, which is already `@Roles(ADMIN, STAFF)` — so the
story's sold-out toggle needs no permission change, but a signed-in STAFF user
today cannot list the products they are meant to sell. That is a permission-rule
change and belongs in an ADR rather than in a dev task's judgement.

The catalog side is otherwise settled: `Product.available`, `Category.name`,
`Category.sortWeight`, `ProductVariant.name/priceCents/sortWeight/active` all
exist and are maintained by story #40. Availability is a catalog flag and does
**not** touch inventory — ADR 0001's "no real-time stock ledger" non-goal is not
implicated, and neither is any other v1 non-goal: this story is online,
browser-only, and adds no hardware or BOM depletion.

---

## Decision

### 1. Capture lives in a new `apps/api/src/orders` module. `reporting` stays read-only

The capture path — start, add/amend lines, park, resume, charge, complete, void,
settle change — is a new `apps/api/src/orders` NestJS module, exactly as ADR
0005 §8 reserved. It owns the write routes over `Sale`, `SaleLine` and
`SalePayment`.

`apps/api/src/reporting` keeps **no POST/PATCH/DELETE routes at all** (ADR 0004
§5, ADR 0005 §8). The existing read-only order-history endpoints stay there. No
capture route is added to `reporting` for convenience, ever — that property is
what makes stories #93 and #80 cheap to review.

The existing `apps/api/src/sales` module is not extended into the order
workflow; where its responsibilities overlap, `orders` is the owner and `sales`
is left alone by this story.

### 2. `discountKind` stays an enum and gains `PWD`. It does **not** become a discount table

This amends ADR 0005 §4's "Senior is the only discount v1 recognises".

```prisma
enum LineDiscountKind {
  NONE
  PWD
  SENIOR
}
```

PWD and Senior are **both 20% of the line's gross**, computed and rounded
identically to ADR 0005 §4:

```
lineGrossCents = unitPriceCents × quantity
discountCents  = round_half_up(lineGrossCents × 20 / 100)   # PWD or SENIOR
discountCents  = 0                                          # NONE
lineTotalCents = lineGrossCents - discountCents
```

ADR 0005's revisit trigger anticipated a discount **table with a stored rate per
line**. We deliberately do not take that step, because the second kind arrived
carrying the *same* rate as the first. A table would add a join, a seed, and a
rate that can drift per row, to express a distinction that is purely which
statutory category the customer belongs to. The enum already gives us the two
properties that matter — the kind is stored, and `discountCents` is stored and
never recomputed at read time, so changing the rate later cannot retroactively
alter a past order.

- Applied **independently per line**. Applying PWD or Senior to one line never
  cascades to another. There is no order-level discount.
- **No customer ID details are recorded.** The story is explicit, and capturing
  a PWD or Senior ID number would be personal data with a retention question
  that v1 has not decided and does not need. `discountKind` is the whole record.
- Both kinds are equally eligible on every line. v1 recognises no
  product-level exclusion.
- The read model renders `NONE` / `PWD` / `SENIOR` as "None" / "PWD" / "Senior".
  Labels are presentation over a stored kind, not free text (ADR 0005 §4).
- The rate stays a capture-path constant, not a per-line column. It lives in one
  place in the `orders` module.

The trigger to move to a rate-bearing table is restated at the bottom and is now
narrower: a third kind, or a second **rate**, is what forces the table.

### 3. Per-line preferences are a bounded enum set plus one note, stored on the line

```prisma
enum LinePreference {
  SWEETER
  STRONGER
  LESS_SWEET
  LESS_ICE
}
```

New columns on `SaleLine`:

| Column | Type | Notes |
|---|---|---|
| `preferences` | `LinePreference[]`, default `[]` | Any combination; order not significant. |
| `preferenceNote` | `String?` | Free text, NULL when absent. Trimmed; empty string is stored as NULL. |

- A Postgres enum **array column**, not a join table. Preferences have no
  identity, no lifecycle and no independent queries in v1; a `sale_line_prefs`
  table would buy nothing and cost every read a join. The set is closed and
  small, so an enum keeps the four values checkable in the database rather than
  spelled correctly by convention.
- **Set semantics.** `[SWEETER, LESS_ICE]` and `[LESS_ICE, SWEETER]` are the
  same preference set. Capture normalises to enum declaration order before
  writing so that stored rows compare and display consistently.
- Contradictory combinations (`SWEETER` with `LESS_SWEET`) are **not** rejected
  by the schema or the API. v1 has no evidence that they are invalid to a barista
  and the story does not ask for the rule; the UI may discourage the pairing but
  the record accepts it.
- Preferences are **line-local by construction**, which is what satisfies the
  story's "preferences on one line do not affect another" — there is no
  order-level preference field to leak through.
- Like names and prices, preferences are part of the frozen order record
  (ADR 0005 §2) and are never recomputed or re-derived.
- `preferenceNote` is free text on an internal, staff-only screen. It is not
  rendered as HTML anywhere; the web app renders it as text and the API stores
  it verbatim up to a 255-character limit enforced by DTO validation.

**Line identity for the quantity-merge rule (binding).** Adding a product and
size increments an existing line's quantity **if and only if** every one of
these matches an existing line on the open order:

```
productVariantId  AND  discountKind = NONE  AND  preferences = []  AND  preferenceNote IS NULL
```

Otherwise a new line is created. This is the literal reading of the story's
"the same **undiscounted** product and size" and it is the only rule that cannot
silently merge two lines a customer meant to differ. A consequence to accept:
adding a preference or a discount to a line does not retro-merge or split it,
and two lines that become identical through editing stay two lines. Merging on
edit would change quantities under the staff member's hands; we do not do it.

### 4. The free upsize is an order-level amount-off, not a line discount

New columns on `Sale`:

| Column | Type | Notes |
|---|---|---|
| `freeUpsizeCount` | `Int`, default 0 | Number of free upsizes applied. |
| `freeUpsizeCents` | `Int`, default 0 | Total value deducted. Stored, never recomputed. |

New column on `SaleLine`:

| Column | Type | Notes |
|---|---|---|
| `categoryNameSnapshot` | `String`, required | Category name as at capture. See eligibility below. |

- **The rate is ₱30 = `3000` cents per upsize**, a capture-path constant in the
  `orders` module, in the same place as the 20% discount rate.
  `freeUpsizeCents = freeUpsizeCount × 3000`, computed once at capture and
  **stored**. Changing the promotion later must not restate a past order, which
  is the same rule ADR 0005 §4 set for `discountCents`.
- It is **not** allocated across lines and **not** a `LineDiscountKind`. The
  story requires it "shown separately from PWD or Senior discounts", and it is
  a whole-order promotion whose count is not tied to any particular line. An
  allocation would have to invent a rule for which line absorbs it and would
  reintroduce exactly the rounding residue ADR 0005 §4 removed.
- Because it is not divided, it needs **no rounding rule**. ADR 0005 §4's
  half-up rounding remains the only rounding in the system and still applies to
  percentage line discounts only. Mixing an amount-off with a percentage is safe
  here precisely because the two never apply to the same figure.
- `Sale.discountCents` keeps its ADR 0005 §4 meaning — **Σ of the lines'
  `discountCents`, and nothing else.** The free upsize never enters it. Any
  report or view that reads `discountCents` as "line discounts" stays correct
  without change.

**Eligibility.** At least one line on the order must have a
`categoryNameSnapshot` containing the substring `coffee`, case-insensitively.

- Evaluated against the **snapshot on the line**, not a live join to
  `Category`. Category names are editable, and eligibility must be judged by
  what was true when the order was taken — the same freezing rule as prices and
  names. This is why `categoryNameSnapshot` is added; it also gives the order
  history a category to display without a join.
- A **name-substring** rule is genuinely what the story specifies, and it is
  the rule the shop already operates. It is fragile — renaming a category
  breaks eligibility for future orders — and that fragility is called out as a
  revisit trigger rather than hidden behind a flag the catalog does not have.
  Introducing a `promoEligible` boolean on `Category` would be a catalog schema
  and UI change this story did not ask for.
- When no line qualifies, the free upsize is unavailable: `freeUpsizeCount`
  must be 0 and the API rejects a non-zero count.

**Bound on multiple upsizes.** `0 ≤ freeUpsizeCount ≤ Σ quantity of qualifying
lines`. One upsize per qualifying cup is the only bound the story's own model
supports (an upsize is a bigger drink, so it cannot exceed the drinks on the
order), and it is what keeps the promotion from being used as an unbounded
discount field. Additionally, `totalCents` must be **≥ 0** after the deduction;
an upsize count that would drive the order negative is rejected rather than
clamped, because a clamp would silently record a value the staff member did not
choose.

### 5. Order totals (binding). Amends ADR 0005 §4

```
Sale.subtotalCents    = Σ lineGrossCents                  (pre-discount gross)
Sale.discountCents    = Σ line discountCents              (PWD/Senior only)
Sale.freeUpsizeCents  = freeUpsizeCount × 3000
Sale.taxCents         = 0                                 (v1, unchanged)
Sale.totalCents       = subtotalCents
                        - discountCents
                        - freeUpsizeCents
                        + taxCents
```

The story's "the visible line amounts add up to the visible order amount" is
satisfied at the line-discount level: `Σ lineTotalCents = subtotalCents -
discountCents`, exactly, with no residual (ADR 0005 §4's per-line rounding).
The free upsize is then a separately displayed order-level deduction between
that figure and the amount due. The four figures the story requires on screen —
pre-discount subtotal, line discounts, free-upsize value, amount due — are the
four terms above, in order, and the screen must show them as such rather than
netting any of them together.

`totalCents` is the **amount due**. The cash tip is not part of it: `cashTipCents`
stays a separate column excluded from sales revenue (ADR 0004), and is
cash-only in v1.

**Tender validation** (capture path, application code, not database `CHECK`):

- Σ `SalePayment.amountCents` for a completed order **must equal**
  `totalCents`. Split payments that do not sum to the amount due are rejected.
- No payment portion may be negative.
- Online-only settlement writes no `cashReceivedCents` and no change.
- For cash and split, a **blank** cash-received input means "exact cash
  received" and is recorded as `cashReceivedCents = the order's cash tender`.
  An entered amount **below** the cash tender is rejected with a clear message.
  Note this is *stricter than* ADR 0005 §5, which requires the read model to
  tolerate historical rows that breach it (v1 holds at least one). The rule
  binds the capture path only; the read model still displays whatever is stored.
- Withheld change, `changeOwedCents`, `changeSettledAt` and the expected-cash
  term are ADR 0005 §5 unchanged. Settlement does not decrement the amount owed.

### 6. Order creation, the parked lifecycle, and idempotency

- A `Sale` row is created **on the first line added**, inside the transaction
  that allocates `dayOrderNumber` under the trading-day row lock (ADR 0005 §3).
  Before that, the order exists only in the browser. This is what makes the
  story's "attempting to park an empty order discards it" true structurally:
  an empty order has no row to discard, so no empty parked order can exist and
  no order number is consumed by one.
- The order is created with `status = PARKED`. Parking is therefore a save, not
  a state change, and resuming is a read. The `PARKED → COMPLETED` transition
  freezes the row permanently (ADR 0005 §2): **application code must not
  `UPDATE` a `sales` row, or any of its lines or payments, unless that row's
  stored `status` is `PARKED`.**
- Creation requires an **open trading day**. With no open day the capture
  endpoints reject the request and the UI explains that the day must be opened
  first; it does not silently create one.
- **Idempotency** is ADR 0001's `clientGeneratedId` on the `Sale`: the browser
  generates it when the order starts and reuses it for every save and for the
  completion attempt. A replayed create returns the existing row and its
  existing `dayOrderNumber` and allocates no second number (ADR 0005 §3). A
  replayed completion against an already-`COMPLETED` row returns that row
  unchanged rather than erroring or double-recording.
- Void remains a correcting `Sale` with `kind = VOID`, `correctsSaleId`, a
  required `voidReason`, its own `dayOrderNumber` and negative-signed payments
  (ADR 0005 §2). Only a `COMPLETED` order can be voided. A corrected purchase is
  a new order.
- **Abandoning a parked order still has no representation** — ADR 0005 flagged
  this as a gap for the capture story. This story does not add one: a parked
  order that is never resumed simply stays parked, and no delete route exists.
  Restated as a revisit trigger.

### 7. Cashier attribution is fixed when the order row is created

`Sale.cashierStaffMemberId` and `Sale.cashierNameSnapshot` (ADR 0003, ADR 0007)
are written **once**, in the same transaction that creates the row, from the
active cashier selection as it stands at that moment.

- Both are NULL when no active cashier is selected. A NULL cashier is a
  deliberate, valid record — not an error and not a blocker: the order can be
  started, parked, resumed, charged, completed and voided without one.
- They are **never updated afterwards**, including while the order is `PARKED`,
  and including on resume. Selecting, changing or clearing the active cashier
  later changes nothing about orders already started. This is a named exception
  to §6's "a `PARKED` row is mutable" — these two columns are immutable from
  creation.
- A correcting (void) row records the cashier active **at void time**, which may
  differ from the original's. Attribution answers "who did this action", and the
  void is a different action.

### 8. STAFF gain read access to the catalog

`apps/api/src/catalog/products.controller.ts` and `categories.controller.ts` are
class-level `@Roles(Role.ADMIN)`. Staff cannot currently list what they are
meant to sell.

The decision is to widen **reads only**, and only the two list routes the order
grid needs — `GET /catalog/products` and `GET /catalog/categories` — to
`@Roles(Role.ADMIN, Role.STAFF)`. Every create, update, delete and reorder route
stays ADMIN-only. `PATCH /catalog/products/:id/availability` is already
`@Roles(ADMIN, STAFF)` and is unchanged, so the story's sold-out toggle needs no
new permission.

- **No new session model, no new role, no new guard.** This is one existing
  role gaining read access to two existing read routes, expressed the same way
  every other route in the codebase expresses it.
- Availability is a **catalog** flag. Toggling it does not decrement stock and
  does not touch Inventory — ADR 0001's bounded contexts stay distinct and the
  "no real-time stock ledger" non-goal is untouched.
- The grid reads on load; live push to already-open screens is explicitly not
  required by the story and no realtime transport is introduced.

---

## Consequences

**Positive**
- The board stops contradicting itself: PWD and Senior are one decided rule
  rather than a merged ADR and a story disagreeing.
- Keeping `discountKind` an enum means no join on the hot read path and no
  per-row rate that can drift, and the stored-not-recomputed rule already
  protects history from a future rate change.
- Making the free upsize order-level keeps ADR 0005 §4's rounding as the only
  rounding in the system, and keeps `Sale.discountCents` meaning exactly what
  the merged reporting read model already assumes it means.
- `categoryNameSnapshot` makes promotion eligibility judgeable from the frozen
  record alone, so a category rename cannot rewrite whether a past order
  qualified — and gives order history a category without a join.
- Creating the row on first line rather than on order start makes "an empty
  parked order cannot exist" structural, and stops empty orders from consuming
  day order numbers.
- Freezing cashier attribution at creation gives reviewers a one-line rule and
  closes the behaviour #165 deferred.
- The preference merge key is stated explicitly, so a reviewer can check it
  rather than infer it from the UI's behaviour.

**Negative / accepted trade-offs**
- A "category name contains coffee" eligibility rule is genuinely fragile.
  Renaming a category silently changes which future orders qualify, and there
  is no place in the catalog UI that warns about it. Accepted because it is the
  shop's actual rule and the alternative is catalog schema this story did not
  ask for — but it is the trigger most likely to fire.
- `LinePreference[]` as an array column means preferences cannot be filtered or
  aggregated efficiently. v1 never does either; if reporting ever wants "how
  many Less ice drinks", this becomes a join table.
- The merge key means a line with a note never merges, so an order can carry
  several lines of the same drink that a staff member perceives as one. That is
  the correct behaviour for a barista ticket and the wrong behaviour for a
  tidy-looking screen; we chose the ticket.
- Two rates now live as constants in the `orders` module (20% and ₱30). They
  are not configurable, and changing either is a code change with a migration
  question about in-flight parked orders.
- Rejecting rather than clamping a negative total means staff can construct an
  order that the API refuses to complete. Preferable to recording a number
  nobody chose, but it is a dead end the UI must prevent reaching.
- Widening two catalog reads to STAFF is a real permission change. Small and
  read-only, but it means product cost-free data (names, prices, availability)
  is now visible to every signed-in staff account, which was previously
  admin-only by accident rather than by decision.
- `Sale` gains two more columns and `SaleLine` gains three. The order tables are
  getting wide; a future reader needs ADR 0001, 0004, 0005 and this one to
  understand them.

## Revisit triggers

- **A third discount kind appears, or PWD and Senior stop sharing one rate** →
  the enum stops being sufficient; move to a discount table with a stored rate
  per line, as ADR 0005 originally anticipated, and re-decide whether
  order-level discounts allocate to lines.
- **The free upsize stops being a flat ₱30, becomes percentage-based, or needs
  to name the line it upgraded** → §4's "not allocated to lines" is no longer
  tenable; re-decide allocation and rounding together.
- **A second promotion appears** → `freeUpsizeCount`/`freeUpsizeCents` stop
  being a general mechanism; move to a promotions table before adding a third
  pair of columns to `Sale`.
- **Promotion eligibility needs to survive a category rename, or a
  non-"coffee" category becomes eligible** → replace the substring rule with an
  explicit catalog flag; this is the most likely trigger in the list.
- **Preferences need to be reported on, or the set stops being closed (staff can
  add their own)** → move `LinePreference[]` to a join table with its own rows.
- **An abandoned parked order needs to disappear from the board** → §6 has no
  answer today; re-decide alongside ADR 0005 §2's same trigger.
- **Attribution is wanted for who *completed* an order as distinct from who
  started it** → §7 records one cashier per row; a second column, or an event
  log, is the change.
- **Tax becomes non-zero** → §5's `totalCents` formula must decide whether the
  discount and the upsize apply pre- or post-tax (ADR 0004's and ADR 0005's
  same trigger).
- **Concurrent registers go live** → ADR 0005 §3's trading-day row lock now also
  serialises every first-line-add, not just completion. Revisit it together with
  numbering.
