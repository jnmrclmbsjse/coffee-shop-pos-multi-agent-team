# Story #351 design specification

## Design read

Preserve-mode extension of the shipped staff Cash & Expenses screen for a tablet-first POS. The existing UCM utility language remains unchanged: cool light surfaces, system typography, compact bordered panels, 6px controls, 10px panels, and green reserved for action and affirmative state.

Design dials: `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, `VISUAL_DENSITY: 6`.

## Existing-screen audit

- Brand tokens: copied from `docs/design/tokens.json` and the shipped issue #154 mockup.
- Information architecture: one Staff route, one Cash & Expenses page, entry panel on the left and ledger on the right.
- Existing content blocks: staff shell, page heading, business-day context, record-entry form, and today's ledger.
- Preserved patterns: shell header and nav, 1440px cap, 32px workspace padding, existing kind badges, tabular money, sticky-width ledger table, 48px fields, and error/success messages.
- Retired patterns: none. This is an additive feature, not a visual cleanup.
- Existing dial reading: low variance, low motion, medium-high operational density.
- SEO: not applicable to this authenticated staff surface. Route and page title remain stable.

## Interaction model

The row-level Amend action replaces the left `Record an entry` panel with `Amend entry` on the same page. The ledger stays visible. Review replaces the form in the same panel. Confirm appends the correction and returns focus context to the updated ledger. Cancel returns to the ordinary page and records nothing.

The prototype's dashed Story #351 state selector is a review fixture only. It is not proposed production UI.

## Responsive model

- At widths above 1050px, keep the shipped two-column form and ledger layout.
- At widths from 768px through 1050px, stack amendment content above the ledger to protect field and table width.
- Below 768px, use 16px page and panel padding, stack every multi-column group, and allow the ledger wrapper to scroll horizontally.
- Do not shrink the data table below its readable minimum width.
- Keep all actions at least 44px high. Primary form actions remain 48px.

## Accessibility model

- Every ledger row has a row header for kind and an accessible row label containing amount, status, and correction link text.
- `Effective`, `Superseded`, `Corrects`, and `Corrected by` are visible text. Color is supplementary.
- Superseded values are not struck through or faded below readable contrast.
- Disabled Amend actions use `aria-describedby` to explain closed-day and already-superseded states.
- The review step uses `role=status` language that says nothing has been recorded.
- Conflict and validation results are announced. Invalid inputs use `aria-invalid` and `aria-describedby`.
- Category removal on a kind change is announced.
- Keyboard focus uses the binding 3px ring with 2px offset.

## Implementation handoff

This mockup is an advisory implementation reference, not a second layer of acceptance criteria.

### REQUIREMENTS inherited from the story acceptance criteria, ADR 0015, and accessibility obligations

1. Amendments append a complete replacement `CashMovement` linked through `amendsCashMovementId`. No existing row is edited.
2. The list returns and renders every row, including superseded rows. No delete, void, hide, or filter action is introduced.
3. A target can be amended only while its trading day is OPEN and only when it has not already been superseded.
4. The database unique constraint on `amendsCashMovementId` remains the one-correction-per-entry guarantee. Amendment chains remain allowed because a correction can itself be corrected.
5. Kind, amount, description, and category are all correctable. Category is accepted only for Expense.
6. Every amount is a positive integer magnitude in storage and a positive peso magnitude in the UI. Kind carries direction.
7. There is no separate reason-for-amendment field.
8. Both aggregation paths use only effective rows. The client consumes server totals and does not own the effective-set rule.
9. Day-closed and already-superseded conflicts return 409. The superseded conflict includes the superseding row id. Field validation returns 400.
10. Every rejected request records nothing and changes no totals.
11. The write stays idempotent by client-generated correction id and preserves current STAFF authorization.
12. Peso display uses `₱`, two decimals, thousands separators, and tabular figures.
13. Status and linkage are conveyed through text and accessible names, not color or strikethrough alone.
14. Controls are keyboard reachable, focus is visible, review and failures are announced, and invalid fields are programmatically described.

### ADVISORY interaction, layout, responsive and visual recommendations Dev may deviate from

1. Place Amend in a new final ledger column so the entry remains the object being acted upon.
2. Keep disabled Amend actions visible with a short reason rather than removing them.
3. Replace the left entry panel in place during amend and review so the ledger remains spatially stable.
4. Present original values in a compact neutral block above the correction form.
5. Clear and remove Category when kind changes away from Expense, then announce the change.
6. Use side-by-side original and proposed review columns above 768px and stacked columns below it.
7. Emphasize only changed review fields with the existing warning family.
8. Use the existing warning surface for superseded rows and existing success surface for effective correction rows.
9. Add plain link sentences such as `Corrected by CM-1848 to ₱80.00 Cash in` so staff do not calculate differences.
10. For chains, add explicit ordinal labels and name both adjacent links on middle rows.
11. Keep the ledger horizontally scrollable at narrow widths rather than compressing columns into ambiguity.
12. Use `Cancel, record nothing` in review and amendment contexts.

### PROPOSED MATERIAL CHANGES to existing shared shell or components named in the Tech Lead breakdown

#### Shared staff shell

None. Keep header, workspace navigation, user context, route, spacing, and responsive shell behavior unchanged.

#### `CashAndExpensesPage`

1. Add amendment selection, draft, review, submitting, and conflict state to the page. Reason: the story remains on the existing route and needs an in-place flow.
2. Add an amendment submit path using the dedicated ADR endpoint and a stable client-generated id. Reason: idempotency and target-specific preconditions differ from ordinary entry creation.
3. On a successful amendment, refresh or reconcile the server-provided list and totals. Reason: effectiveness and the superseding id are server-owned facts.
4. On already-superseded 409, retain the returned superseding id and offer a refresh action. Reason: retry cannot succeed and the next useful action is to inspect the winner.
5. On day-closed 409, reload day state and render the existing closed-day treatment. Reason: the close snapshot must remain read only.

#### Ledger table markup: `staff-cash-ledger`, `staff-cash-kind`, `staff-cash-amount`, `staff-cash-detail`, `staff-cash-table-wrap`

1. Preserve all five named classes and existing type, amount, detail, by, and time columns. Reason: this is a compatible extension of shipped markup and styling.
2. Add `Record status` and `Action` columns. Reason: effectiveness and amendment availability need visible, keyboard-reachable treatment.
3. Promote the first body cell to a row header or add an equivalent accessible row label. Reason: status and linkage must be understandable row by row with assistive technology.
4. Add state classes for superseded and correction rows, while keeping visible text. Reason: scanning can be accelerated visually without making color the only signal.
5. Render both `amendsCashMovementId` and `supersededByCashMovementId` as plain link copy. Reason: pairs and chains must remain readable without client inference.
6. Keep `staff-cash-amount` as a positive, tabular peso value and keep the existing plus/minus glyph inside `staff-cash-kind`. Reason: kind alone carries direction.

## Pre-flight decisions

- One fixed light theme, matching the shipped staff screen.
- One accent family, with no added tokens.
- One radius rule: 6px controls and 10px panels, inherited from the binding system.
- No decorative imagery, motion, gradients, icons, or new dependencies. They do not serve a dense staff tool.
- No em-dash characters, negative correction amounts, hidden rows, or ambiguous status-only color.

