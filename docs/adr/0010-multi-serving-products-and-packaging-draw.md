# ADR 0010: Multi-Serving Products and the Packaging Draw

- **Status:** Proposed
- **Date:** 2026-08-09
- **Decision owner:** Technical Lead
- **Supersedes / extends:** **Amends ADR 0006 §5** (the `sold` term of the
  packaging reconciliation formula). Extends ADR 0001 (bounded contexts,
  append-only corrections) and follows ADR 0003's attribution-snapshot pattern.
  Does not touch ADR 0005/0008 pricing, discounts or free upsize.

---

## Context

Story #247 reports a recurring reconciliation error: a buy-one-take-one product
is one line on the order and one item on the receipt, but it hands two drinks
across the counter — two cups and two lids. Every such sale under-counts
packaging by exactly one serving, so the daily cup-and-lid variance on the close
screen is wrong by a predictable amount on every trading day the shop runs the
promotion.

ADR 0006 §5 is the binding statement of the figure that is wrong:

```
sold = Σ SaleLine.quantity for COMPLETED, non-voided sales on this
       trading day whose ProductVariant maps this item as cup or lid
```

That term is implemented once, in
`apps/api/src/inventory/packaging-reconciliation.service.ts`, which adds
`line.quantity` to the cup total and to the lid total. The arithmetic is not
defective; its premise is. It assumes one sold unit consumes one set of
packaging, and nothing anywhere in the system records that a product might not.

Nothing models the promotion today. `Product` carries `sku`, `name`,
`categoryId`, `active`, `available`. `ProductVariant` carries the size, its
price, and the `cupInventoryItemId` / `lidInventoryItemId` mapping. A shop
running buy-one-take-one creates it as an ordinary product with a promotional
name and a promotional price — which is the right call for pricing and is
exactly why packaging is wrong: the price is stated, the second cup is not.

The story's Scope Notes fence the decision on three sides, and they are correct
constraints rather than PO preferences:

- It must not become a **promotions engine**. This story does not introduce
  mix-and-match, customer choice of the free item, or promotion pricing.
- It must not become a **real-time stock ledger** (ADR 0001 v1 non-goal, restated
  in ADR 0006 §5). Nothing is written on sale, no `StockMovement` is generated.
- It must not become **recipe/BOM depletion**. This is cups and lids — the two
  columns Catalog already carries — never beans or milk.

So the decision is narrow and specific: where does the fact "this product hands
over two servings" live, and which packaging arithmetic reads it.

This ADR is not one of the four canonical high-risk areas (auth, money,
deletion, secrets). It is written anyway because it amends a merged ADR's
binding formula and adds two columns to merged tables. Leaving that in a task
body's technical notes would leave ADR 0006 §5 stating arithmetic the code no
longer performs.

---

## Decision

### 1. `Product.packagingServings` — an integer on Catalog, not a promotion type

Catalog gains one column:

```prisma
model Product {
  ...
  packagingServings Int @default(1) @map("packaging_servings")
}
```

- **On `Product`, not `ProductVariant`.** A buy-one-take-one offer is a property
  of the product being sold, not of the cup it comes in. Putting it on the
  variant would require the admin to repeat it on every size and would let
  Regular and Large silently disagree about how many drinks the same promotion
  hands over. Variants keep what varies by size: price and the cup/lid mapping.
- **On `Product`, not `Category`.** `Category.freeUpsizeEligible` (ADR 0008) is
  category-level because upsize eligibility genuinely is a class-wide rule. A
  promotion is not: a shop runs buy-one-take-one on named drinks, not on the
  whole Espresso category.
- **An integer, not a `buyOneTakeOne` boolean.** The boolean would encode "2" in
  code at every read site, and the next promotion that hands over three would be
  a schema migration instead of a data edit. The integer is not more general in
  any way that matters — it is the count of servings a single sold unit hands
  over, which is a fact the shop already knows when it defines the product.
- **Constrained `>= 1`** by a database check constraint, not application code
  alone. Zero or negative would make packaging usage vanish or run backwards,
  and no valid product hands over less than one serving.
- **It affects packaging only.** `packagingServings` is not a term in any price,
  discount, tax, or total; it does not multiply `unitPriceCents`, and it is not
  a quantity anywhere in Sales/Orders. A buy-one-take-one product is one unit
  sold at one price. Its name in the schema says `packaging` for that reason,
  and any future read of it outside packaging arithmetic is a new decision, not
  an extension of this one.

Maintenance is part of the existing product editor (`ProductEditorPage`,
`catalog.dto.ts`, `products.controller.ts`) — a field on the form staff already
use, defaulting to 1. No new screen, no new permission (ADR 0002's existing
admin catalog access applies unchanged).

### 2. The sale snapshots the servings count; reconciliation reads the snapshot

`SaleLine` gains:

```prisma
model SaleLine {
  ...
  packagingServingsSnapshot Int @default(1) @map("packaging_servings_snapshot")
}
```

Populated in `OrdersService.lineCreateData` from the resolved product at the
moment the line is added, exactly as `freeUpsizeEligible`, `productNameSnapshot`
and `variantNameSnapshot` already are.

**Why this one is snapshotted while the cup/lid mapping is not.** The two look
alike and are not. `cupInventoryItemId` is a *reference to the row being
reconciled* — resolving it live is what makes the projection able to say which
inventory item a sale drew from, and ADR 0006 §5 deliberately derives it at read
time. `packagingServings` is the *quantity of that draw*, and the quantity was
settled the moment the drinks crossed the counter. If an admin ends the
promotion tomorrow and sets the product back to 1, a live read must not
retroactively decide that yesterday's sales used half the cups they used. ADR
0001's append-only-corrections rule and ADR 0003's attribution-snapshot pattern
both say the same thing: a later catalog edit does not rewrite what happened.

Existing `sale_lines` backfill to `1`, which is not a default standing in for
missing data — it is the correct history. Every sale recorded before this change
handed over one serving per unit.

### 3. The amended `sold` term (binding — supersedes ADR 0006 §5's `sold` line)

Every other line of ADR 0006 §5 stands unchanged. Only `sold` changes:

```
sold = Σ (SaleLine.quantity × SaleLine.packagingServingsSnapshot)
       for COMPLETED, non-voided sales on this trading day
       whose ProductVariant maps this item as cup or lid

expected = opening + deliveries - wastage - sold      when opening exists
expected = NULL                                       when it does not
```

- A quantity of 3 of a 2-serving product draws **6** cups and **6** lids.
- An ordinary product has `packagingServingsSnapshot = 1` and its arithmetic is
  unchanged — `quantity × 1`. Nothing is doubled that was not doubled before.
- ADR 0006 §5's per-role rule is unchanged and composes: a variant mapping the
  same `InventoryItem` as both cup and lid draws `quantity × servings` twice,
  because it does.
- **Parked and void sales need no new exclusion.** They are already excluded by
  the existing predicate (`status = COMPLETED`, `kind = PURCHASE`, no `VOID`
  correction), and a multiplier applied to an excluded row is still excluded. A
  void does not add packaging back; the original is simply never counted.
- The `NULL`-on-missing-opening-count rule (ADR 0006 §5) is untouched. A larger
  `sold` must not resurrect the negative-expected bug this replaced.
- This remains a read-time, day-bounded projection owned by Inventory. It stores
  no balance, writes nothing on sale, and generates no `StockMovement`. The v1
  non-goal stands.

### 4. What this does not decide

- No promotion pricing, mix-and-match, or customer selection of a different free
  product. The second serving is the same variant as the first, by definition of
  the field: one product, N servings of *its own* packaging.
- No ingredient consumption. `packagingServings` is read by the packaging
  projection and by nothing else.
- No change to `DayClosing` / `DayClosingLine`. The close snapshot already stores
  `expectedQty`; it stores a correct number now instead of an incorrect one.

---

## Consequences

**Positive**
- The reconciliation error is fixed at its premise rather than patched at the
  call site, and the fix is one multiplication in the one place ADR 0006 §5
  already named as the single implementation.
- Ordinary products are provably unaffected: their multiplier is 1.
- Snapshotting means ending the promotion cannot silently rewrite past closes,
  and a stored `DayClosing` and a live recomputation stay consistent for this
  term.
- An integer keeps the shop's next packaging arrangement a data edit.

**Negative / accepted trade-offs**
- Two columns on two merged tables plus a backfill migration, for a field that
  is `1` on almost every row.
- Catalog now carries an attribute that only Inventory reads. The alternative —
  an Inventory-side table mapping products to servings — would duplicate the
  product list and drift from it. Accepted: the coupling is one integer, and
  ADR 0006 §5 already reads Catalog across the boundary.
- A promotion defined by pricing alone (two half-price drinks rung as quantity
  2) is *not* covered and does not need to be — it already counts correctly.
  Staff must understand that `packagingServings` describes one sold unit, and
  a mis-set value silently skews variance in the direction of the error.
- Snapshot and current catalog value can disagree for a product whose servings
  changed. Deliberate, and the same trade-off ADR 0006 §4 already accepted.

## Revisit triggers

- **A promotion needs the free item to be a different product** → the "same
  variant, N servings" premise breaks; a real promotion model is required and
  §1 is the wrong shape.
- **`packagingServings` is wanted as a term in price or discount arithmetic** →
  that is money arithmetic under the high-risk rule and needs its own ADR;
  §1's packaging-only restriction is binding until then.
- **Recipe/BOM depletion enters scope** → ADR 0006 §5's own trigger fires first
  and this multiplier is subsumed by a real consumption model.
- **Servings must vary by size** → move the column from `Product` to
  `ProductVariant` and decide the admin's per-size maintenance story.
- **Packaging reconciliation is wanted across a date range or per shift** →
  ADR 0006's trigger for a stored daily packaging summary applies; the snapshot
  column makes that summary derivable, which is a reason to prefer it.
