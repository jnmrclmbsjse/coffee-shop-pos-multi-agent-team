# Staff order history payment facts

## Design read

Preserve-mode extension of one existing internal POS component for staff, engineers, and QA. The visual language remains utilitarian, compact, and token-driven. Design variance is 2, motion intensity is 0-1, and visual density is 6. This reference does not redesign the card, page, filters, or shell.

## Decision and rationale

Place **Cash received** and **Expected change** inside the existing `.staff-order-payment` strip, immediately after its tender rows. Wrap only the new content in `.staff-order-payment-facts` and separate it from tender rows with one internal `border-top` using `--borderStrong`.

This is the least disruptive placement because both values describe the recorded payment and its read-time arithmetic. Adding them to `.staff-order-meta` would expand a stable four-column summary grid, reduce scanability at narrow widths, and make payment derivation look like general order metadata. A new sibling block would give the values the same structural weight as `.staff-order-change`, incorrectly suggesting another operational workflow. Extending `.staff-order-payment` keeps tender inputs and derived facts in one reading sequence while the existing change block remains visually and semantically separate.

The two new rows use the existing payment-row rhythm: 13px/700 labels, justified values, mono money, and the subtle payment surface. They are read-only and add no button, mutation, or product state. The persistent explanation reads: **Expected change uses the Cash row only. Online payment and cash tips are not included.** This makes split-payment arithmetic explicit and avoids implying a cash hand-back amount.

Unavailable is a muted em dash with a specific accessible name. A real zero remains formatted money (`₱0.00`). Negative results remain formatted money and add the visible phrase **Recorded as-is** in neutral muted text. No warning or danger color is used because the record is historical and no action is available.

For voided orders, the new rows remain under the visible context **Original payment record**. Values must come from the original order snapshot, never the correcting record.

The existing `.staff-order-change.is-owed|.is-given` block is unchanged. In the reference it remains outside `.staff-order-payment`, retains its existing label, amount, optional timestamp, and confirmation button, and can appear together with Expected change.

This mockup is an advisory reference. Its presentation choices are not extra acceptance criteria.

## Token statement

The reference binds only the supplied shipped tokens: background, surface, foreground, muted, border, borderStrong, inkSoft, surfaceSubtle, accent, danger, dangerSurface, warnInk, warnSurface, warnBorder, focus, successSurface, the supplied spacing scale, 6px and 10px radii, 44px minimum touch target, system sans, JetBrains Mono / IBM Plex Mono, and the control shadow. No new color, spacing, radius, typography, or elevation token is proposed.

The standalone CSS aliases camel-case product token names to CSS custom-property spelling where needed (`--border-strong`, `--ink-soft`, and similar). Values are unchanged.

## Copy deck

All visible strings and accessible labels rendered by this reference are enumerated below. Dynamic order numbers, times, names, item lines, status values, and formatted money are included by state.

### Reference scaffolding (non-shipping)

- Document title: `Staff order history payment facts reference`
- `Advisory implementation reference`
- `Staff order history payment facts`
- `Add two read-only historical values without changing the card’s existing hierarchy or operational change workflow.`
- Accessible label: `Reference settings`
- `Story #340`
- `Design task #341`
- `Preserve mode`
- Navigation accessible label: `Reference sections`
- Navigation: `Placement`, `State coverage`, `Narrow width`, `Implementation notes`
- `Recommended placement`
- `Extend the payment strip`
- `Add the two facts after the tender rows, separated by one internal rule. Keep metadata, order lines, and the existing change block untouched.`
- `Why this placement:`
- `the values explain payment arithmetic, while the existing change block records an operational handover state. Keeping them as siblings would imply equal behavior.`
- `State coverage`
- `One structure, ten data conditions`
- `The controls below belong to this reference only. They do not propose controls for the product.`
- Switcher legend: `Choose an order state`
- Switcher labels: `Cash with change due`, `Exact cash, zero`, `Negative legacy value`, `Cash with tip`, `Split cash + online`, `Online only`, `Received, no cash row`, `Parked`, `Voided after completion`, `Outstanding handover`
- `Standard card width`
- `Reference viewport`
- `Narrow-width rendering`
- `Same content at 390px`
- `Metadata collapses to two columns. Payment rows, the explanation, and any change handover block remain full width.`
- `Small touch screen`
- `390px content width`
- `Reference boundary`
- `Scaffolding is not product UI`
- `.prototype`, `.prototype-head`, `.prototype-nav`, `.mockup-section`, `.section-label`, `.assessment-note`, `.state-switcher`, `.preview-frame`, followed by `are non-shipping.`

### Product strings shared across cards

- Title pattern: `Order #[number] · Walk-in`
- Metadata labels: `Payment`, `Completion`, `Cashier`, `Total`
- Status values: `Completed`, `Parked`, `Voided`
- Tender labels: `Cash`, `Online`, `Cash tip`
- Split tender container aria-label: `Split payment`
- Parked payment value: `Not settled`
- Parked completion value: `Not completed`
- Parked tender text: `No recorded payment`
- New field labels: `Cash received`, `Expected change`
- Persistent explanation: `Expected change uses the Cash row only. Online payment and cash tips are not included.`
- Negative-value annotation: `Recorded as-is`
- Void context: `Original payment record`
- Order-line list aria-label: `Order lines`
- Existing change labels: `Change handed over`, `Change owed`
- Existing timestamp pattern: `Handed over at [time]`
- Existing button: `Confirm change handed over`
- Void reason pattern: `Void reason: [reason]`

### Exact unavailable strings and aria-labels

- Visible unavailable string for both fields: `—`
- Cash received unavailable markup: `<span aria-label="Cash received not recorded">—</span>`
- Expected change unavailable markup: `<span aria-label="Expected change not available">—</span>`

These labels are intentionally asymmetric. **Cash received not recorded** identifies the missing source fact. **Expected change not available** identifies a derivation that cannot be performed because one or both required inputs are absent. QA should assert these exact accessible names.

The required unavailable em dash is the only intentional exception to the reference skill's general dash restriction. It follows the shipped reporting precedent and the accepted criteria.

### State-specific rendered content

Money follows the existing `formatMoney` presentation using `Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" })` in this standalone reference.

1. Cash with change due: `Order #12 · Walk-in`; `Completed`; Payment `Cash`; Completion `10:42 AM`; Cashier `Mika Santos`; Total `₱200.00`; Cash `₱200.00`; Cash received `₱500.00`; Expected change `₱300.00`; lines `2 × Iced latte` `₱180.00`, `1 × Espresso shot` `₱20.00`; `Change handed over`; `Handed over at 10:43 AM`; `₱300.00`.
2. Exact cash, zero: `Order #13 · Walk-in`; `Completed`; Payment `Cash`; Completion `10:51 AM`; Cashier `Mika Santos`; Total `₱180.00`; Cash `₱180.00`; Cash received `₱180.00`; Expected change `₱0.00`; line `2 × Cappuccino` `₱180.00`.
3. Negative legacy value: `Order #14 · Walk-in`; `Completed`; Payment `Cash`; Completion `11:03 AM`; Cashier `Paolo Reyes`; Total `₱220.00`; Cash `₱220.00`; Cash received `₱200.00`; Expected change `-₱20.00`; `Recorded as-is`; line `2 × Flat white` `₱220.00`.
4. Cash with tip: `Order #15 · Walk-in`; `Completed`; Payment `Cash`; Completion `11:14 AM`; Cashier `Paolo Reyes`; Total `₱200.00`; Cash `₱200.00`; Cash tip `₱50.00`; Cash received `₱500.00`; Expected change `₱300.00`; line `2 × Cold brew` `₱200.00`.
5. Split cash + online: `Order #16 · Walk-in`; `Completed`; Payment `Split`; Completion `11:26 AM`; Cashier `Lia Mendoza`; Total `₱450.00`; Cash `₱200.00`; Online `₱250.00`; Cash received `₱500.00`; Expected change `₱300.00`; lines `3 × Spanish latte` `₱360.00`, `1 × Banana loaf` `₱90.00`.
6. Online only: `Order #17 · Walk-in`; `Completed`; Payment `Online`; Completion `11:37 AM`; Cashier `Lia Mendoza`; Total `₱240.00`; Online `₱240.00`; Cash received unavailable; Expected change unavailable; line `2 × Matcha latte` `₱240.00`.
7. Received, no cash row: `Order #18 · Walk-in`; `Completed`; Payment `Online`; Completion `11:49 AM`; Cashier `Mika Santos`; Total `₱160.00`; Online `₱160.00`; Cash received `₱500.00`; Expected change unavailable; line `2 × Americano` `₱160.00`.
8. Parked: `Order #19 · Walk-in`; `Parked`; Payment `Not settled`; Completion `Not completed`; Cashier `Paolo Reyes`; Total `₱280.00`; `No recorded payment`; Cash received unavailable; Expected change unavailable; lines `2 × Mocha` `₱240.00`, `1 × Extra shot` `₱40.00`.
9. Voided after completion: `Order #20 · Walk-in`; `Voided`; Payment `Cash`; Completion `12:08 PM`; Cashier `Lia Mendoza`; Total `₱200.00`; Cash `₱200.00`; `Original payment record`; Cash received `₱500.00`; Expected change `₱300.00`; line `2 × Cold brew` `₱200.00`; `Void reason: Duplicate order`.
10. Outstanding handover: `Order #21 · Walk-in`; `Completed`; Payment `Cash`; Completion `12:19 PM`; Cashier `Mika Santos`; Total `₱350.00`; Cash `₱350.00`; Cash received `₱500.00`; Expected change `₱150.00`; lines `2 × Caramel latte` `₱280.00`, `1 × Croissant` `₱70.00`; `Change owed`; `₱150.00`; `Confirm change handed over`.

## Accessibility

- The unavailable glyph has a specific accessible name and never stands in for a real zero.
- Zero is emitted by `formatMoney(0)` as `₱0.00`, not by a fallback branch.
- Negative expected change remains a signed monetary value. The adjacent text **Recorded as-is** communicates historical context without relying on color.
- The explanatory sentence is persistent and associated to `.staff-order-payment-facts` with `aria-describedby`.
- The void-only context **Original payment record** is also associated with the new facts through `aria-describedby`.
- Existing semantic elements remain: `article`, heading, `dl` metadata, `ul` order lines, and the existing button where change is owed.
- The reference switcher uses real buttons with `aria-pressed`; it is non-shipping and controls reference state only.
- Keyboard focus uses the shipped focus token and a 3px visible outline. Reference controls meet the 44px minimum touch target.
- At narrow widths, the metadata grid becomes two columns and values can wrap without clipping or horizontal scrolling.
- Meaning is carried by text, sign, currency formatting, and accessible names. Color is supplementary.

## Implementation handoff

### A. Inherited requirements

These come from the story, accepted criteria, ADRs described in the brief, existing reporting precedent, and accessibility obligations. They are not optional design suggestions.

- Render Cash received and Expected change per staff order card as read-only facts.
- Gate Cash received only on whether its own recorded value is present.
- Use `Cash received not recorded` as the exact accessible name for its unavailable em dash.
- Derive Expected change at read time as cash received minus the cash payment portion. Do not store it.
- Gate Expected change on both inputs being present. Use `Expected change not available` as the exact accessible name for its unavailable em dash.
- Preserve real zero as formatted `₱0.00`.
- Preserve negative results without clamping and without replacing them with unavailable.
- Exclude online payment and cash tip from the derivation.
- For split payment, use only the cash portion.
- For parked orders with no recorded payment, render both values unavailable.
- For voided orders, read the original order's cash received and original cash portion. Do not substitute correcting-record negatives.
- Keep the path read-only. Add no new mutations or product controls.
- Use the existing `formatMoney` helper in production.
- Leave `.staff-order-change.is-owed|.is-given` completely unchanged and allow it to coexist with the new values.

### B. Advisory recommendations

These recommendations solve hierarchy, scanability, responsive behavior, and historical-anomaly communication. The mockup does not turn them into additional acceptance criteria.

- Place the facts after tender rows in `.staff-order-payment` so the calculation reads in source-to-result order.
- Separate the new fact group with one existing-token border. Do not create another colored block.
- Keep labels at the existing payment-row typography and money in the existing mono numeral stack.
- Keep the explanatory sentence persistent: `Expected change uses the Cash row only. Online payment and cash tips are not included.`
- Annotate a negative result with `Recorded as-is` in neutral text. Do not use danger styling, an alert role, an icon, or an action.
- Add `Original payment record` above the two facts only on voided cards.
- Collapse the existing metadata grid from four to two columns below 768px. Keep all payment rows full width.
- Permit the note and long values to wrap. Never clip or horizontally scroll the card.

### C. Proposed material changes to named structures

1. `.staff-order-card`: **No material structure or visual change proposed.** Reason: the accepted work is additive inside its existing payment region.
2. `.staff-order-meta`: **No new fields and no desktop structure change proposed.** The reference shows the existing responsive two-column collapse only. Reason: adding payment facts would overload the four-column summary and make derivation harder to read.
3. `.staff-order-payment`: **Add one child group, `.staff-order-payment-facts`, after all existing tender rows.** The group contains an optional void context paragraph, two read-only fact rows, and one persistent explanatory paragraph. Reason: source tender, derived result, and derivation rule remain adjacent without creating a competing card region.
4. `.staff-order-change`: **No markup, copy, styling, or behavior change proposed.** Reason: it represents a distinct operational handover state and is explicitly outside this design task.

Suggested React branching, using existing domain names rather than adding state:

```tsx
const cashPaymentPortionCents = getCashPaymentPortion(order);
const expectedChangeCents =
  order.cashReceivedCents != null && cashPaymentPortionCents != null
    ? order.cashReceivedCents - cashPaymentPortionCents
    : null;
```

The production renderer should test `!= null`, not truthiness, so zero remains a real value. The void path must resolve `order` to the original historical payment source before this derivation.
