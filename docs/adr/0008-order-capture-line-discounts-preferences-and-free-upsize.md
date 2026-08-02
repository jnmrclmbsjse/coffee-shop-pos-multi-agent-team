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

**2. The free upsize is an amount off, not a percentage.** The story requires one
or more free upsizes when the order contains a coffee product; each reduces the
amount due by ₱30 and must be "shown separately from PWD or Senior discounts".
ADR 0005's second revisit trigger — "**A discount is ever expressed as an amount
off rather than a percentage** → §4's single rounding rule is no longer the whole
story; re-decide before mixing the two" — fires here. It is the first money
reduction in the system that is not a percentage of a line's gross, so how it
composes with the percentage discount on the same line, and how eligibility is
determined, both have to be decided rather than left to a dev task.

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

PWD and Senior are **both 20%**, rounded half-up exactly as ADR 0005 §4
requires. What they are 20% *of* is stated here rather than assumed: the flat
free upsize (§4) is subtracted **first**, and the percentage is taken on what
remains.

```
lineGrossCents    = unitPriceCents × quantity
discountBaseCents = lineGrossCents - freeUpsizeCents        # §4, flat, 0 on most lines
discountCents     = round_half_up(discountBaseCents × 20 / 100)   # PWD or SENIOR
discountCents     = 0                                             # NONE
lineTotalCents    = discountBaseCents - discountCents
                  = lineGrossCents - freeUpsizeCents - discountCents
```

`freeUpsizeCents` is the flat promotion term decided in §4; it is 0 on every
line that carries no free upsize, in which case `discountBaseCents =
lineGrossCents` and this reduces exactly to ADR 0005 §4's formula. The
composition order is argued in §4 and is binding.

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
productVariantId       AND  discountKind = NONE   AND  preferences = []
AND  preferenceNote IS NULL  AND  freeUpsizeCount = 0
```

`freeUpsizeCount = 0` joins the key because §4 makes the upsize a line-level
term: a line carrying an upsize is a specific upgraded cup, and merging a plain
cup into it would silently change how many drinks the ₱30 applied to.

Otherwise a new line is created. This is the literal reading of the story's
"the same **undiscounted** product and size" and it is the only rule that cannot
silently merge two lines a customer meant to differ. A consequence to accept:
adding a preference or a discount to a line does not retro-merge or split it,
and two lines that become identical through editing stay two lines. Merging on
edit would change quantities under the staff member's hands; we do not do it.

### 4. The free upsize is a **line** discount — a flat ₱30 off, attached only to eligible coffee lines

New columns on `SaleLine`:

| Column | Type | Notes |
|---|---|---|
| `freeUpsizeCount` | `Int`, default 0 | Number of free upsizes on this line. |
| `freeUpsizeCents` | `Int`, default 0 | `freeUpsizeCount × 3000`. Stored, never recomputed. |
| `freeUpsizeEligible` | `Boolean`, required | Eligibility snapshot at capture. See below. |

New column on `Sale`:

| Column | Type | Notes |
|---|---|---|
| `freeUpsizeCents` | `Int`, default 0 | Σ of the lines' `freeUpsizeCents`. Stored, shown as its own figure. |

- **The rate is ₱30 = `3000` cents per upsize**, a capture-path constant in the
  `orders` module, in the same place as the 20% discount rate.
  `freeUpsizeCents = freeUpsizeCount × 3000`, computed once at capture and
  **stored**. Changing the promotion later must not restate a past order, which
  is the same rule ADR 0005 §4 set for `discountCents`.
- The upsize **attaches to the line it upgrades**, not to the order. An upsize is
  a bigger cup of a specific drink; the record should say which drink got it.
  This also means the promotion cannot be applied to an order that merely
  *contains* a coffee — it can only be applied to the coffee line itself, which
  is the behaviour the shop actually operates.
- It is a line discount but **not** a `LineDiscountKind`. `discountKind` stays a
  single-valued enum carrying the customer's statutory category; the upsize is a
  promotion on the product and the two apply to the same line independently. The
  story's "shown separately from PWD or Senior discounts" is satisfied by them
  being separate columns and separate figures on screen, not by putting the
  upsize somewhere other than the line.
- **Composition order on a line is binding: the flat ₱30 comes off first, then
  the 20% is taken on what remains.** The upsize reduces the base the percentage
  is computed on; it is never itself discounted, because it is already gone from
  the base by the time the percentage applies.

  ```
  discountBaseCents = lineGrossCents - freeUpsizeCents
  discountCents     = round_half_up(discountBaseCents × 20 / 100)
  lineTotalCents    = discountBaseCents - discountCents
  ```

  The reasoning is that the ₱30 is the **shop's own promotion** and the 20% is a
  **statutory entitlement on the amount the customer is actually charged**. The
  customer is not being charged the ₱30, so it is not part of what the 20%
  applies to. Netting the promotion first and applying the statutory discount to
  the net is also the ordering Philippine practice expects for PWD and Senior
  discounts, so this is the ordering the shop can defend on a receipt.

  Worked example, one ₱150 coffee with a free upsize and Senior:
  `discountBase = 15000 - 3000 = 12000`; `discount = 2400`;
  `lineTotal = 9600`. The other ordering would have charged `9000` — the
  customer is ₱6 worse off per upsized discounted line under this rule, and that
  is the intended outcome, not an artefact.

  Because the upsize is a whole number of ₱30 units, the base stays an integer
  number of cents and the flat term introduces no rounding of its own: ADR 0005
  §4's single half-up rounding remains the only rounding in the system, applied
  once per line to the percentage term.
- `Sale.discountCents` keeps its ADR 0005 §4 meaning — **Σ of the lines'
  `discountCents`, PWD/Senior only.** The upsize is summed into its own
  `Sale.freeUpsizeCents` and never enters `discountCents`. Any report or view
  that reads `discountCents` as "line discounts" stays correct without change.

**Eligibility is a catalog flag, not a name match.** New column in Catalog:

| Table | Column | Type | Notes |
|---|---|---|---|
| `Category` | `freeUpsizeEligible` | `Boolean`, default `false` | Admin-maintained. Products inherit it from their category. |

- A line is eligible if its product's category had `freeUpsizeEligible = true`
  **at capture time**; that answer is frozen onto the line as
  `SaleLine.freeUpsizeEligible`. Eligibility is judged from the frozen record,
  never from a live join — the same freezing rule as prices and names, so
  re-flagging a category later cannot rewrite whether a past order qualified.
- This replaces the "category name contains `coffee`" substring rule that an
  earlier draft of this ADR proposed. A name-substring rule silently changes
  which drinks qualify on a rename, is invisible in the catalog UI, and forces
  every consumer to re-implement the same string test. An explicit flag is one
  boolean, maintained where the rest of the category is maintained.
- The flag lives on `Category`, not `Product`, because the promotion is
  category-shaped in the shop's own terms ("coffee drinks") and one toggle per
  category is far less to maintain than one per product. A product-level
  override is a revisit trigger, not a v1 column.
- **Scope consequence:** this is a Catalog schema change plus an admin toggle in
  the category form, which story #197 did not itself ask for. It is small, but
  it is a real addition to the breakdown and gets its own dev task, sequenced
  before the capture work that reads the flag. The seed/migration sets
  `freeUpsizeEligible = true` for the shop's existing coffee categories so
  current behaviour is preserved on day one.
- On an ineligible line, `freeUpsizeCount` must be 0 and the API rejects a
  non-zero count. When no line on the order is eligible, the free upsize is
  unavailable at all, which is what the story requires.
- **Acceptance-criteria impact.** Story #197's criterion is written per-order
  ("staff can apply one or more free upsizes when the order contains a product
  from a category whose name contains 'coffee'"). This decision makes it
  per-line and eligibility flag-driven. The observable outcome for an order of
  coffee only is identical; what changes is that on a mixed order the upsize
  attaches to a chosen coffee line rather than to the order. The criterion needs
  rewording by the PO during breakdown — flagged rather than reinterpreted here.

**Bound on multiple upsizes.** Per line, `0 ≤ freeUpsizeCount ≤ quantity`. One
upsize per cup is the only bound the story's own model supports — an upsize is a
bigger drink, so it cannot exceed the drinks on that line — and it keeps the
promotion from being used as an unbounded discount field. Additionally,
**`freeUpsizeCents` must not exceed `lineGrossCents`** — an upsize on a line
cheaper than ₱30 per unit is rejected rather than clamped, because a clamp would
silently record a value the staff member did not choose. Because the percentage
is now taken on the already-reduced base, that one bound is enough:
`discountBaseCents ≥ 0` implies `lineTotalCents = 0.8 × discountBaseCents ≥ 0`,
so no separate non-negativity rule is needed on the line total and order-level
`totalCents` is ≥ 0 by construction.

### 5. Order totals (binding). Amends ADR 0005 §4

```
Sale.subtotalCents    = Σ line lineGrossCents             (pre-discount gross)
Sale.freeUpsizeCents  = Σ line freeUpsizeCents            (₱30 × upsizes, §4)
Sale.discountCents    = Σ line discountCents              (PWD/Senior only, §2)
Sale.taxCents         = 0                                 (v1, unchanged)
Sale.totalCents       = subtotalCents
                        - freeUpsizeCents
                        - discountCents
                        + taxCents
```

The two deductions are written in the order §4 applies them — upsize first, then
the percentage — because `discountCents` is now computed on the post-upsize base
and the formula should read the way the money is actually taken off.

Every term is a sum over the lines, so the story's "the visible line amounts add
up to the visible order amount" holds exactly:
`Σ lineTotalCents = subtotalCents - freeUpsizeCents - discountCents =
totalCents`, with no residual (ADR 0005 §4's per-line rounding, plus §4's flat
upsize which rounds nothing). Making the upsize a line term rather than an
order-level deduction is what preserves that property rather than merely leaving
it undisturbed.

The four figures the story requires on screen — pre-discount subtotal,
free-upsize value, line discounts, amount due — are the four terms above, in
that order, and the screen must show them as such rather than netting any of
them together. Showing them in deduction order is what lets a customer or an
auditor check the ₱30-then-20% arithmetic off the screen itself. Each line
additionally shows its own upsize separately from its own PWD/Senior discount.

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
  Before that, the order exists only in the browser. This is half of what makes
  the story's "attempting to park an empty order discards it" true structurally:
  an order that never had a line has no row to discard. The other half is the
  next bullet — the row must also go away when its last line is removed.
- **An order row does not outlive its last line.** Removing the only remaining
  line — whether by `removeLine`, or by decrementing the last unit of the only
  line, which deletes that line — **deletes the `PARKED` `Sale` row** in the
  same transaction, instead of leaving a zero-total row behind. "No empty order
  exists" is therefore an invariant along every path, not just the create path.
  Without this, ordinary line removal strands a `PARKED` row that still holds a
  `dayOrderNumber`, is returned by `GET /orders/parked`, can never be completed
  (`complete()` rejects an empty order), and has no route that can remove it.
  - This is a **cascade of line removal**, not the abandon route the last bullet
    still declines. It is reachable only by emptying an order line by line; a
    parked order that still has lines cannot be deleted.
  - `complete()`'s empty-order rejection **stays** as a backstop. It should now
    be unreachable through the API, and that is the point.
  - **Idempotency is unaffected, but the order number is not stable across a
    discard.** The browser may re-add a line under the same `clientGeneratedId`
    (ADR 0001); because the previous row is gone, that creates a **new** row and
    allocates a **new** `dayOrderNumber`. Staff who empty an order and then
    refill it are starting a genuinely new order and may see a different number.
    The web app (#204) must therefore treat the order number as server-owned and
    re-read it after a discard rather than caching the first value it saw.
  - **Interaction with ADR 0005 §3's "numbers are never reassigned".** Because
    allocation is `MAX(day_order_number) + 1`, discarding the row that currently
    holds the day's highest number lets the next order draw that same number.
    This does not weaken §3: §3 forbids renumbering or recycling across rows
    that **exist**, and no two surviving records ever share a number. A
    discarded row leaves no history to collide with, so reuse here is not
    observable. Discarding a row that is *not* the highest still leaves a
    permanent gap, which §3 already calls legitimate history.
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
- **Abandoning a *non-empty* parked order still has no representation** — ADR
  0005 flagged this as a gap for the capture story. This story does not add one:
  a parked order that still has lines and is never resumed simply stays parked,
  and no delete route exists for it. Emptying an order line by line is not that
  route; it discards the row as a consequence of removing the lines, and staff
  cannot use it to dismiss an order they want to keep the contents of. Restated
  as a revisit trigger.

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
- Making the free upsize a line term keeps `Σ lineTotalCents = totalCents`
  exactly, records which drink was upgraded, and still keeps ADR 0005 §4's
  rounding as the only rounding in the system (the ₱30 is flat). Keeping it out
  of `discountCents` means the merged reporting read model needs no change.
- Taking the ₱30 off before the 20% means the statutory discount is computed on
  the amount actually charged, which is the defensible reading for PWD and
  Senior and the one the shop can show on a receipt. It also collapses the
  line's non-negativity guard into a single bound on the upsize.
- A `Category.freeUpsizeEligible` flag makes eligibility explicit and
  maintainable in the catalog UI, and `SaleLine.freeUpsizeEligible` freezes the
  answer, so neither a rename nor a later re-flagging can rewrite whether a past
  order qualified.
- Creating the row on first line rather than on order start makes "an empty
  parked order cannot exist" structural, and stops empty orders from consuming
  day order numbers.
- Freezing cashier attribution at creation gives reviewers a one-line rule and
  closes the behaviour #165 deferred.
- The preference merge key is stated explicitly, so a reviewer can check it
  rather than infer it from the UI's behaviour.

**Negative / accepted trade-offs**
- The eligibility flag is a **Catalog** change made by a Sales/Orders story. It
  adds a migration, a column on `Category`, an admin toggle, and a seed step that
  must flag the existing coffee categories or the promotion silently disappears
  on deploy. That is more work than a substring test would have been, and it is
  worth it: the rule becomes visible and editable instead of hiding in a string
  comparison.
- Eligibility is per **category**, so a shop that wants one non-coffee drink
  eligible has to either move it or flag its whole category. Accepted for v1.
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
- Rejecting rather than clamping means staff can construct a line the API
  refuses to accept — an upsize worth more than the line's gross. Preferable to
  recording a number nobody chose, but it is a dead end the UI must prevent
  reaching.
- The composition order costs the customer ₱6 per upsized PWD/Senior line
  against the alternative ordering (20% of ₱3000). It is a deliberate choice of
  the legally defensible ordering over the more generous one, and it means the
  two reductions are **not** independent: changing either rate changes the other
  term's effect, so §2 and §4 have to be revisited together.
- Widening two catalog reads to STAFF is a real permission change. Small and
  read-only, but it means product cost-free data (names, prices, availability)
  is now visible to every signed-in staff account, which was previously
  admin-only by accident rather than by decision.
- `Sale` gains one more column and `SaleLine` gains five. The order tables are
  getting wide; a future reader needs ADR 0001, 0004, 0005 and this one to
  understand them.
- §6's discard-on-empty means a `PARKED` `Sale` row is the one order record that
  can be **deleted** rather than only appended to. The append-only guarantee
  (ADR 0001) is unchanged for everything that matters — it covers `COMPLETED`
  rows and their payments, none of which this touches — but "sales rows are
  never deleted" is no longer literally true of every row, and anyone reading
  the schema needs §6 to know why.
- An order number staff have already seen can change if they empty and refill
  the order. Nothing today prints or announces the number before completion, so
  this is currently invisible; it becomes a real problem the day something does,
  which is why it is a revisit trigger below.

## Revisit triggers

- **A third discount kind appears, or PWD and Senior stop sharing one rate** →
  the enum stops being sufficient; move to a discount table with a stored rate
  per line, as ADR 0005 originally anticipated, and re-decide whether
  order-level discounts allocate to lines.
- **The free upsize stops being a flat ₱30 or becomes percentage-based** → §4's
  "the flat term rounds nothing" stops holding, and §2's `discountBaseCents`
  gains a second rounding step ahead of the percentage; re-decide the
  composition order and the rounding rule together.
- **A promotion appears that must not reduce the statutory discount base** →
  §4's single ordering (promotion first, then 20%) stops being sufficient;
  promotions would need a per-promotion flag saying whether they precede the
  statutory discount, which is the point at which the promotions table in the
  trigger below becomes mandatory rather than merely tidier.
- **A second promotion appears** → `freeUpsizeCount`/`freeUpsizeCents` stop
  being a general mechanism; move to a promotions table before adding a second
  pair of promotion columns to `SaleLine`.
- **Eligibility needs to be per product rather than per category, or a
  promotion needs to apply to an order rather than a line** → §4's
  `Category.freeUpsizeEligible` becomes insufficient; add the product-level
  override or an order-level promotion row rather than overloading the flag.
- **Preferences need to be reported on** — i.e. someone asks a question that
  requires filtering or counting *across* orders, such as "how many Less-ice
  drinks did we sell in July" or "which products most often get a note". The
  array column stores preferences fine but cannot answer those efficiently;
  a join table with one row per preference is what makes them queryable.
- **The preference set stops being closed** — i.e. the four values
  (`SWEETER`, `STRONGER`, `LESS_SWEET`, `LESS_ICE`) stop being the complete
  list, either because staff can type their own or because an admin screen
  starts maintaining them. A Postgres enum is fixed at migration time, so a
  user-editable set has to become rows in a table instead. Adding a *fifth
  fixed* value by migration does **not** fire this trigger; the set is still
  closed, just longer.
  Either of the two above → move `LinePreference[]` to a join table.
- **An abandoned *non-empty* parked order needs to disappear from the board** →
  §6 has no answer today; emptying it line by line is the only path that removes
  a row, and that is deliberately not an abandon route. Re-decide alongside
  ADR 0005 §2's same trigger.
- **A parked order needs a `dayOrderNumber` that survives being emptied** —
  e.g. the number gets printed, called out, or written on a cup before the order
  is completed, so staff cannot tolerate it changing. §6's discard-and-reallocate
  stops being acceptable at that point; the alternatives are reserving the
  number against the `clientGeneratedId` rather than the row, or refusing to
  remove the final line. Re-decide with ADR 0005 §3.
- **Attribution is wanted for who *completed* an order as distinct from who
  started it** → §7 records one cashier per row; a second column, or an event
  log, is the change.
- **Tax becomes non-zero** → §5's `totalCents` formula must decide whether the
  discount and the upsize apply pre- or post-tax (ADR 0004's and ADR 0005's
  same trigger).
- **Concurrent registers go live** → ADR 0005 §3's trading-day row lock now also
  serialises every first-line-add, not just completion. Revisit it together with
  numbering.
