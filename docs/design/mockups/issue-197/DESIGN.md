> This mockup is an advisory design reference, not a pixel specification. It demonstrates required behavior, information hierarchy, states, and accessibility expectations. Production implementation may vary where the acceptance criteria remain intact.

# UCM Coffee Studio POS: Take Order workspace

Issue #197, design task #200

## Preserve-mode audit

### Source and mode

This is a preserve-mode extension of the shipped UCM staff POS. The project workspace did not contain sibling mockup files, so the authoritative audit source for this artifact is the token and convention set supplied in the issue brief.

The active frontend skill normally targets marketing and editorial surfaces, not dense product workspaces. For this task, only its preserve-mode audit, accessibility, density, responsive, interaction-state, and pre-flight guidance applies. The product system remains UCM's existing staff POS rather than adopting a new component library.

### Preserved system

- Full-bleed staff shell with UCM lockup, Staff role, signed-in user, branch, business day, register, and active cashier.
- Flat horizontal staff navigation with Take Order active.
- Two-column catalog and current-order split at the tablet target.
- Hairline row structure, restrained elevation, 6px controls, and 10px panels.
- Existing system type stack, with the established mono stack for money.
- 44px minimum touch targets, 48px fields, and a 3px focus ring with 2px offset.
- Active cashier control and the supported neutral `No cashier selected` state.
- Dashed `Mockup only / Review states` panel, visibly outside production UI.

### Preserved tokens

`styles.css` reproduces the supplied tokens as custom properties:

- Colors: `--background`, `--surface`, `--foreground`, `--muted`, `--border`, `--accent`, `--accent-hover`, `--accent-pressed`, `--danger`, `--danger-surface`, `--warn-ink`, `--warn-surface`, `--warn-border`, `--focus`, `--ink-soft`, `--surface-subtle`, and `--border-strong`.
- Type: `--font-sans` and `--font-mono`.
- Space: `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-8`, `--space-10`, and `--space-12`.
- Shape: `--radius-sm` at 6px and `--radius-md` at 10px.
- Controls: `--touch-target` at 44px and `--field-height` at 48px.
- Elevation: `--shadow-control` exactly matches the supplied control shadow.

Three additions are narrowly scoped and derived from the existing system:

- `--promotion-ink`, `--promotion-surface`, and `--promotion-border` distinguish free upsize promotions from PWD and Senior discounts without introducing a second brand accent.
- `--success-surface` provides a pale state surface for selected and available controls while the existing accent supplies the ink and border.
- `--shell-header-height` documents shell layout intent and is unset at the narrow breakpoint.

### Defects resolved from v1

1. Zero line discounts render as plain `₱0.00`. A minus sign is shown only when a real deduction exists, so `−₱0.00` never appears.
2. Dine-in is visibly selected and programmatically selected with `aria-pressed="true"` by default.
3. Take Order carries `aria-current="page"`.
4. The staff nav no longer uses an oversized intrinsic row. At 1024px, it uses a bounded grid with compact labels so page-level horizontal overflow does not occur.

## Design rationale

### Staff shell

The shell keeps identity, session context, cashier control, and navigation in separate bands. This preserves the familiar information while preventing the header from becoming a single 1287px-wide row. Context cells truncate safely, lower-priority context collapses below 900px, and the four primary mobile destinations remain visible at 390px.

The active cashier is a button because it changes a session setting. `No cashier selected` uses foreground, muted, surface, and border tokens only. It is a supported operating state, not a warning or error.

### Catalog and availability

Categories and products remain in maintained order: Non Coffee before Coffee, with Milky Choco, House Blend, and Signature Latte beneath their categories. A size button is the add action, which keeps size and current price together at the decision point.

A sold-out product stays structurally present. Its card uses a neutral striped surface, an explicit `Sold out · Unbuyable` label, a dashed size action, line-through pricing, and a disabled control. This does not depend on opacity and cannot be confused with the loading skeleton. The stock toggle remains enabled and changes to `Mark available`, so recovery is possible from the same card.

### Current order and line rows

The order header places customer, service type, order number, and frozen cashier attribution before the line list. Blank customer means walk-in directly in the field copy. Dine-in is the default both visually and semantically.

The line row uses three layers:

1. Product identity, size, unit price, quantity, and total.
2. Compact semantic chips for preferences, promotion, and discount, followed by the note on its own line.
3. A consistent action rail for quantity, preferences, discount, and remove.

The worst-case row uses the long Signature Latte name, four preferences, a preparation note, Senior discount, quantity two, and two free upsizes. It is deliberately visible in the default populated state. Reducing quantity one to zero removes the line. Reducing quantity also keeps any existing upsize count within the new quantity.

### Parked orders

Two walk-ins are distinguished with service type and parked time in addition to item count and total. These are the smallest extra facts that help staff choose correctly without adding customer data that may not exist. Resuming preserves the order's original cashier attribution.

### Preferences sheet

Preferences are checkboxes because any combination is valid. Sweeter and Less sweet may coexist. When both are selected, the interface presents a quiet confirmation prompt rather than blocking the record allowed by ADR 0008 section 3.

The note counter measures trimmed content. Whitespace-only content saves as absent. Up to 255 trimmed characters is accepted. More than 255 is rejected with a visible, live, programmatically associated error.

### Discount and promotion controls

The discount sheet is a single-choice radio group with None, PWD, and Senior. It explicitly states that no ID details are recorded. The selection affects only the active line.

Free upsize is labelled Promotion and uses a cool neutral treatment distinct from the red-ink discount treatment. Eligibility comes from the line's category flag in the data model. The control rejects counts outside zero through line quantity and rejects non-zero use on an ineligible line. The unavailable example explains the category-flag rule instead of implying a product-name convention.

### Totals and arithmetic

The totals appear in the required order:

1. Pre-discount subtotal
2. Free upsize
3. Line discounts
4. Amount due

All application values use integer cents. Formatting happens only at the view boundary, preventing floating-point artifacts. The line math subtracts each ₱30 free upsize first, then applies 20% to the remainder, rounded half-up to the nearest cent.

The literal worked example is available beneath the totals: `₱150 eligible line - ₱30 free upsize = ₱120 discount base. Senior discount ₱24. Line total ₱96.` The default populated order also proves the arithmetic: ₱458 subtotal, ₱60 free upsize, ₱48 Senior discount, and ₱350 amount due. Its visible line totals are ₱192 and ₱158, which add to ₱350.

No editable total field exists.

### Charge and payment

Payment method uses tab semantics with three mutually exclusive panels.

- Cash accepts a cash-received amount. Blank explicitly means exact cash. Below the amount due is rejected. Above it produces change due.
- Online settles the full amount and renders no cash-received or change inputs.
- Split requires non-negative Cash and Online portions that sum exactly to the amount due. A live remainder makes the incomplete amount visible while typing. Cash received is validated against only the Cash portion, with blank meaning exact Cash portion.
- Cash tip remains separate from product payment and sales revenue. It increases expected cash and is available even for a fully Online order.
- Change still owed defaults deliberately to ₱0.00 and accepts only zero through calculated change due.

The completion confirmation repeats method, amount due, paid breakdown, cash tip, change due, change still owed, and frozen cashier attribution.

### Void flow

Void is unavailable before completion and after an order is already void. The sheet explains parked and already-void reasons separately. A trimmed, non-blank reason is required. The consequence text states that the original remains visible as void, the void is not revenue, and any correction is a new order.

### Outstanding change follow-up

The Orders review includes before and after rows. Confirming handover changes status and records settlement time, but the original owed amount stays visible and labelled as part of the permanent order record. Settlement is therefore not presented as a deduction.

### Business day and operational states

Empty, loading, and no-business-day states are distinct:

- Empty explains how to start an order.
- Loading uses shape-matched neutral skeleton rows and a live status.
- No business day open blocks the workspace with a direct explanation and a route to open the day.

### Responsive and motion

At 1024px, the workspace is a 58/42 split inside the viewport. At narrower tablet widths it moves to 55/45. Below 768px, catalog and order become a single column with a sticky action row, explicit one-column product layout, mobile-safe dialogs, and a horizontally scrollable mockup review control only. The production interface itself has no page-level horizontal scroll at 390px.

Motion intensity is 2. There is no automatic or decorative animation. Only immediate press feedback is used. The reduced-motion query removes any residual transition or animation duration.

## Accessibility notes

- Semantic header, nav, main, section, aside, fieldset, legend, dialog, table-role, definition-list, and button elements are used.
- Take Order uses `aria-current="page"`.
- Service type uses explicit `aria-pressed` state, with Dine-in selected by default.
- Payment method uses tabs with `aria-selected`.
- Focus is visible on every interactive element with the required 3px ring and 2px offset.
- Every interactive control is at least 44px in both dimensions in production UI. The compact mockup-only state buttons are outside production UI and expand to 44px on mobile.
- Totals, validation, note count, toasts, and settlement feedback use live regions where state changes matter.
- Errors are associated through `aria-describedby` and are also visible in context.
- Disabled states retain readable labels and explanation. Sold out does not rely on opacity.
- The prototype is fully keyboard operable despite touch being the primary modality.

## Implementation handoff

### 1. Requirements

These are binding requirements inherited from the story acceptance criteria, ADR 0005, ADR 0008, and accessibility obligations.

- Preserve maintained category and product order, availability, sizes, and current prices.
- Sold-out products stay visible, cannot be added, and can be restored from the product card.
- Dine-in is the visible and programmatic default.
- Customer name is optional, and blank means walk-in.
- Preferences, discount, and free upsize attach per line and never cascade.
- Sweeter and Less sweet together must be accepted.
- Notes trim whitespace, ignore whitespace-only input, accept at most 255 characters, and reject longer content.
- Exactly one of None, PWD, or Senior may apply to a line. No ID-capture fields are permitted.
- Free upsize eligibility comes from the category `freeUpsizeEligible` flag. Counts must be integer values from zero through quantity. Each upsize is a ₱30 promotion. Invalid counts are rejected, not clamped.
- Totals remain separate and ordered as pre-discount subtotal, free upsize, line discounts, amount due.
- Free upsize value is deducted before a PWD or Senior discount. The discount is 20% of the remainder, rounded half-up to the nearest cent.
- Money uses integer cents in application state. Visible line totals must reconcile to amount due. No total is editable.
- Cash, Online, and Split follow the payment validation rules in the brief. Cash tips and change owed remain separate from product revenue.
- Change-owed settlement records time without erasing or deducting the original amount owed.
- Only completed, not-yet-void orders may be voided. A trimmed reason is required. Corrections are new orders.
- Orders may proceed without an active cashier. Attribution freezes when the order starts.
- No business day open prevents starting an order and provides a path to open the day.
- All controls meet 44px touch size, WCAG AA contrast, visible focus, semantic state, label, live-region, error-association, and keyboard requirements.

### 2. Advisory

These are interaction, layout, responsive, and visual recommendations. Development owns these judgement calls. Pixel matching is not the goal and is not an acceptance criterion.

- Keep the 58/42 catalog-order split at 1024px while line editing remains efficient.
- Use service type and parked time to distinguish otherwise identical walk-ins.
- Keep per-line details in semantic chips with the note on a separate line.
- Keep promotion treatment visually distinct from discount treatment.
- Keep the arithmetic explainer close to totals, whether as disclosure or always-visible help.
- Retain a single-column mobile order flow with the action bar available near the thumb zone.
- Keep motion limited to press feedback and state confirmation.
- The review-state panel is a design-review aid only and should not ship in production.

### 3. Proposed material changes to shared shell or components

These changes should receive explicit Tech Lead review.

#### `StaffWorkspaceLayout`

Proposed change: split identity/context and staff navigation into bounded rows, allow low-priority context cells to collapse responsively, and guarantee `overflow-x: hidden` at the page shell.

Reason: v1 exposes 587px of a 1287px header row at 1024px. The proposed row structure preserves all context while preventing shell-level horizontal overflow.

#### Staff nav

Proposed change: render the nav as a constrained seven-column grid at tablet width, use compact labels, hide lower-priority destinations behind the existing mobile navigation pattern below 768px, and set `aria-current="page"` on Take Order.

Reason: resolves the v1 overflow and the missing current-page semantic without changing route labels or information architecture.

#### `CashierSelection`

Proposed change: expose `No cashier selected` as a first-class neutral option, return a stable no-attribution value, and show copy that changes affect only future orders.

Reason: no cashier is allowed by the domain. Existing orders need immutable attribution even when the session selection changes.

#### `StaffOrderHistoryPage`

Proposed change: add an action for `Change still owed` rows that records handover time, then render both the original owed amount and settlement state.

Reason: settlement is an event, not a monetary deduction. Keeping the original amount visible preserves the audit record required by the story.

## Review-state map

The dashed review panel exposes empty, loading, populated, worst-case line, preferences, discount, free upsize, sold out, no business day, Cash, Online, Split, change owed, completed confirmation, void, and no-cashier states. It also links to the Orders view for before and after outstanding-change settlement.
