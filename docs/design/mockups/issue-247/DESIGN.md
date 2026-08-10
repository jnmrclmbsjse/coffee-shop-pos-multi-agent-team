# UCM Coffee Studio — stating how many servings a product hands over (#247)

Mockup: `docs/design/mockups/issue-247/index.html` (single self-contained file,
no external requests, no JavaScript — open it directly from disk).

Design Task: #268. Story: #247. Architecture: ADR 0010.

## Design read

Preserve mode. Story #247 is an arithmetic correction and almost all of it is
invisible; ADR 0010 §1 already settled that the fact lives on
`Product.packagingServings`, an integer defaulting to 1, maintained in the
existing product editor. Exactly one thing had to be designed: how an
administrator states that a product hands over more than one drink.

Design dials are `DESIGN_VARIANCE: 2`, `MOTION_INTENSITY: 0`, `VISUAL_DENSITY: 5`.
No motion, no new fonts, no new colour, no new control vocabulary. The sheet is
developer documentation for Dev and Tech Lead, not a screen.

The whole risk of this story is a mis-set value: it silently skews the close
screen's cup/lid variance and produces no error anywhere. Copy therefore carries
more weight than layout here, and the two decisions that matter are (a) not
making the field read as a pricing control, and (b) whether a wrong value is
discoverable outside the editor.

## Bound visual system

Production tokens used verbatim from `docs/design/tokens.json` — the cool
neutral surfaces, `--focus` green ring, `--danger` error ink, the
Apple/Inter/system sans stack, 6px/10px radii, the existing space scale, and the
44px touch minimum. The existing `promotion` colour family
(`--promotion-ink` / `--promotion-surface` / `--promotion-border`) is reused for
the non-default marker; those three custom properties are already declared in
`apps/web/src/styles.css`.

**No new design token was added.** `docs/design/tokens.json` is unchanged by
this story.

## Decisions

### 1. Field treatment — a plain native number input

A native `<input type="number" min="1" step="1">`, defaulted to 1, added as a
third `.catalog-field` **below** the existing `.product-detail-grid`
(Category / Product name keep their exact 0.8fr/1.2fr grid) and **above** the
`.state-settings` cards.

Rejected alternatives, and why:

- **Stepper with −/+ buttons** — adds two tab stops and two 44px targets to a
  field that is correct-by-default on essentially every product in the shop. It
  spends interaction cost on the rare case.
- **Disclosure toggle ("hands over more than one serving") revealing a count** —
  hides a consequential value behind a control, and makes an already-set 2
  invisible unless the disclosure happens to be open. For a value whose failure
  mode is silence, always-visible beats progressively-disclosed.

The plain input matches the page's existing vocabulary (labelled inputs plus
`Switch` toggles), so it needs no new control pattern. Placement above the state
toggles is deliberate: the field describes *what one sold item means*, not
whether the item can be sold.

The input is rendered at a fixed 112px width rather than full-bleed — it holds a
one- or two-digit integer, and a full-width input would over-signal its
importance relative to Product name.

### 2. Production copy (binding — this is the deliverable)

| Slot | String |
| --- | --- |
| Label | `Drinks handed over per item sold` |
| Help | `Used only to count cups and lids. It does not change the product price, discounts, tax, or order total.` |
| Error | `Enter a whole number of 1 or greater.` |

"Packaging servings" is the schema's name and must not surface in the UI. The
label states the shop's fact — how many drinks cross the counter for one sold
unit. The help text names the exclusion explicitly (price, discounts, tax,
order total) because ADR 0010 §1 makes the price boundary binding and an admin
reading this as "charge for two" would be a genuine operational failure.

One error string covers blank, zero, negative, and fractional input. Splitting
it into four messages would add translation and test surface for no admin
benefit — the corrective action is identical in every case.

### 3. Field states

Specimens in the sheet cover: rest at the default 1, rest at 2 with the
non-default badge, hover (`border-color: var(--muted)`), focus-visible (the real
3px `color-mix(in oklch, var(--focus) 22%, transparent)` ring), and invalid
(`aria-invalid="true"` plus `.catalog-field-error`). Following the existing
product-editor pattern, help and error are mutually exclusive and
`aria-describedby` points at whichever one is rendered.

No disabled or read-only state is proposed — the page has no precedent for one
and no permission tier requires it.

At 390px the field spans the full column, consistent with the existing
`.catalog-field` collapse; the badge wraps below the input rather than being
truncated.

### 4. Products list — yes, show a marker (decision, not a hedge)

Products whose `packagingServings > 1` show one badge **inside the existing
Product name cell**, reading e.g. `2 drinks / sale`, in the promotion colours.
Products at 1 show nothing.

A sixth column was rejected: it would spend permanent table width on an
exception that will apply to a handful of rows. Putting the marker in the name
cell also means the below-900px `td[data-label]` stacked-card collapse needs no
change at all — the badge simply travels with the name.

### 5. Close-of-day cup/lid balance — no visual change, and no annotation

The `Cup / lid balance` section is rendered in the sheet unchanged: the same
Item / Expected / Actual / Var columns, the same `—` treatment for unknown
counts, the same empty state. ADR 0010 §3 leaves the `NULL`-on-missing-opening
rule untouched.

Recommendation on the open question: **add no cashier-facing annotation.**
Expected already means packaging usage, not order-line count, so nothing is
being contradicted. Explaining promotion arithmetic at the end of a shift adds
reading cost for information the closing cashier cannot act on, and this screen
has a standing history of layout regressions. The annotation in the mockup is
labelled as developer documentation and is explicitly not product UI.

## Accessibility

- Visible `<label for>` association; the required `*` is `aria-hidden`.
- `aria-describedby` → help in the valid state, → error only in the invalid
  state.
- `aria-invalid="true"` set only after validation fails, not on first render.
- `type="number"` gives Arrow Up/Down increment for free, but spinner styling is
  browser-dependent, the scroll wheel can alter a focused value, and decimal
  separators are locale-dependent — so API-side integer validation stays
  authoritative regardless of what the control accepts.
- Input keeps the production 44px minimum height. No custom buttons, so no extra
  tab stops.
- The badge's 7px dot is decorative and `aria-hidden`; the text carries the
  meaning.

## Implementation handoff

### Requirements (from the story, ADR 0010, and accessibility obligations)

- The field is required, minimum 1, integer, defaulting to 1 on new and existing
  products (story AC 1).
- Blank, zero, negative, or fractional input blocks save and shows a validation
  message (story AC 2).
- The help copy must state that the value affects cup and lid counting only and
  does not affect price — ADR 0010 §1 makes the price boundary binding.
- Label/`aria-describedby`/`aria-invalid` wiring as described above.
- The close screen's structure, columns, empty state, and unknown-count
  behaviour do not change.

### Advisory (Dev's call, argued above but not binding)

- The native number input over a stepper or disclosure, and its 112px width.
- Placement below the details grid and above the state toggles.
- The exact wording of the three strings — recommended as written, since the
  price-exclusion sentence is doing real work, but the requirement is the
  meaning, not the characters.
- The products-list badge in the name cell instead of a sixth column.
- No annotation on the close screen.

### Proposed material changes to shared shells / components

Two, both small, both additive:

1. **`.state-badge` gains a `promotion` variant** —
   `color: var(--promotion-ink); background: var(--promotion-surface);
   border: 1px solid var(--promotion-border)`, with the dot in
   `--promotion-ink`. `StateBadge` in `apps/web/src/catalog/components.tsx`
   currently renders only `positive`/`neutral` from a boolean, so this marker
   either needs a variant prop or a separate small badge component — Dev's
   choice. Reason: the existing `positive` green reads as "this is good/on",
   which is wrong for a factual exception marker, and the promotion colour
   family already exists in the tokens for exactly this semantic.
2. **Two new layout-only classes**: `.servings-field` (the field wrapper) and
   `.servings-input-row` (input + badge on one row, wrapping at narrow widths),
   plus `.product-name-cell` in the products table for the name-plus-badge pair.
   No new tokens; these only compose existing spacing values.

Nothing else in `ProductEditorPage`, `ProductsPage`, or the trading-day close
page is asked to change.
