# UCM Coffee Studio POS: Par levels correction

## Design read

This is a preserve-mode correction to an existing internal admin form. The supplied UCM tokens, field geometry, system font, legends, and two-day structure remain the visual contract. The level selector reuses the staff counting screen's radio-tile interaction model without introducing a new component aesthetic.

Design variance is 3, motion intensity is 2, and visual density is 6. The result is intentionally static, compact, and operational.

## Decision

For a level-counted item, each day type contains one required eight-value radio group. The sequence is the meaning: Empty, Low, Quarter, One-third, Half, Two-thirds, Three-quarters, Full. The visible hint states the endpoints so the set reads as an ordinal scale without a red-to-green ramp, status color, or decorative fill.

The selected tile uses the same `--accent-pressed` fill as the staff selector. Labels, source order, native radio behavior, and the group legend carry the meaning without relying on color. Low and Urgent thresholds do not appear in the level-counted variant.

## Width strategy

Eight 72px-minimum options cannot fit in each half of the current desktop `.par-level-grid`. The chosen layout is:

- Wide desktop above 1220px: the day types remain side by side. Each level scale uses four columns by two rows.
- At the existing max-width 1220px breakpoint: day types become a single column. Each full-width scale expands to eight columns in one row, retaining the staff selector's full-row rhythm.
- At 900px and below: each scale returns to four columns by two rows.
- At 430px and below: each scale becomes two columns by four rows.

All labels retain a minimum 48px height, exceeding the 44px touch-target requirement. The 1220px rule for `.par-level-grid` is reproduced verbatim.

## Validation behavior

Both Normal day and Peak day are required for a level-counted item. Validation appears only after a save attempt. The section uses the existing form summary sentence, and the invalid day fieldset gets `aria-invalid="true"`, a danger border and surface, and an associated inline message. The inline copy names Peak day, so the error does not depend on color or position.

Native radios with a shared `name` preserve single-selection semantics and browser arrow-key traversal. Each day remains a separate `fieldset` with its own visible `legend`. The error is associated with the fieldset through `aria-describedby`.

## Count-method switch

The sheet includes the existing Count method radios only as context. Selecting Level immediately replaces the quantity controls with two empty level groups. No quantity value is mapped, copied, or defaulted. Before save, returning to Quantity restores the in-form quantity entries. The warning-surface note makes the unsaved transition explicit without implying that level targets affect Restock Status.

The demo is interactive so Dev can confirm the state swap. This is state replacement, not animation, and no transition is added.

## Production copy

### Section and quantity variant

- Section heading: `Par levels`
- Quantity section hint: `Set independent targets for normal and peak days. Zero is valid.`
- Day legends: `Normal day`; `Peak day`
- Required quantity label: `Par quantity *` (the asterisk is hidden from assistive technology)
- Optional quantity labels: `Low threshold`; `Urgent threshold`
- Optional input placeholder: `Optional`

### Level variant

- Section heading: `Par levels`
- Level section hint: `Set independent targets for normal and peak days.`
- Day legends: `Normal day`; `Peak day`
- Scale hint: `Choose one target from Empty to Full.`
- Level labels in order: `Empty`; `Low`; `Quarter`; `One-third`; `Half`; `Two-thirds`; `Three-quarters`; `Full`

### Validation

- Form summary: `Review the highlighted item and par-level fields before saving.`
- Peak day field error: `Choose a level for Peak day.`
- If Normal day is the affected group, use the parallel copy: `Choose a level for Normal day.`

### Pre-save method switch

- Context legend: `Count method`
- Method labels: `Quantity`; `Level`
- Level-selected notice: `Not saved yet. No quantity values were converted. Switching back to Quantity restores the entries from before this change.`
- Quantity-restored notice: `Not saved yet. The quantity entries from before the method change are restored.`

## Tokens

No new design token is proposed. The mockup uses only the supplied UCM token set. The standalone sheet declares those tokens in `:root`; Dev can omit that block when lifting rules into `apps/web/src/styles.css`.

## Implementation handoff

### Requirements

- Render exactly one level value per day type for level-counted items.
- Use the closed eight-value order: Empty, Low, Quarter, One-third, Half, Two-thirds, Three-quarters, Full.
- Require both Normal day and Peak day before save.
- Do not render or store Par quantity, Low threshold, or Urgent threshold for a level-counted item.
- Do not convert, copy, or default quantity values when Count method changes to Level.
- Re-present controls immediately when Count method changes before save.
- Restore the previous quantity entries when the admin switches back before save.
- Do not imply any Restock Status behavior. Saved level targets remain inert outside this editor for this story.
- Do not use good/bad color semantics for the scale.
- Use separate native radio groups with fieldset and legend semantics.
- Keep every target at least 44px, provide a visible `--focus` ring, and retain keyboard arrow-key traversal.
- Put `aria-invalid="true"` on an invalid day group and associate its named inline error using `aria-describedby`.
- Block save when either day type is unset and show the existing form summary sentence.

### Advisory

- Use four columns by two rows for each half-width desktop group. This is the clearest fit without shrinking labels or reducing targets below the current field height.
- Expand to the familiar eight-across staff rhythm only after `.par-level-grid` becomes one column at 1220px.
- Return to four columns at 900px and two columns at 430px to protect label fit and touch size.
- Keep the endpoint hint visible. It explains ordinality more reliably than a color ramp and survives any future dark shell.
- Preserve each day legend directly on its bordered fieldset. This makes different Normal and Peak selections unambiguous at a glance.
- Keep the pre-save notice near Count method context, but implement it with the app's existing inline notice component if one already exists.

### Proposed material changes to shared shells or components

- Generalize the staff counting selector into a shared level-scale component that accepts `name`, `legend`, `value`, `onChange`, `aria-invalid`, `aria-describedby`, and a responsive column mode. Reason: both screens must share value order, radio behavior, selected styling, focus treatment, and accessible semantics.
- Keep layout policy outside the base option tile. The staff screen can retain eight-across, while the editor supplies four, eight, four, and two-column responsive rules. Reason: pixel matching is not the goal; a shared mental model and behavior are.
- Centralize the eight `StockLevel` labels and order in one typed constant. Reason: it prevents drift between staff counting and admin editing while keeping the domain closed and non-extensible in the UI.
