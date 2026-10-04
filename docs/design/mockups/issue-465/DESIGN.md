# Service filter — admin Order History

**Story:** #465 · **Design Task:** #468 · **Mode:** `spec` (no Open Design, no new
visual language) · **Screen:** admin Order History

This is a fourth instance of a pattern the screen already ships three times. The
spec below is mostly citation. Two things are genuinely new and are marked as
findings: the filter bar's base grid is hard-coded to exactly four controls, and
the Design Task names a route that does not exist.

---

## Placement

One new control, one existing region.

| | |
|---|---|
| Component | `apps/web/src/pages/OrderHistoryPage.tsx` |
| Region | the `<section className="order-history-filters">` at `:271` |
| Route | **`/order-history`** (`App.tsx:543`), reached from the admin sidebar entry `Order History` (`App.tsx:74`) |
| DOM position | a fourth `<label>`, **after Payment (`:297-308`) and before Rows per page (`:309-328`)** |

Payment is the nearest sibling in meaning, and `Rows per page` is a display
control rather than a filter, so it stays last. This also makes the visible order
match the table's own column order (Customer, Service, Status, Payment method),
with the one deliberate exception that Service follows Status and Payment in the
bar because it is being added to an established sequence and reordering the
shipped two would be churn for no gain.

> **Finding — Design Task route is wrong.** #468 names the screen
> `/reports/orders`. There is no such route. The admin Order History page is
> mounted at `/order-history` and its detail page at `/order-history/:id`
> (`App.tsx:543-546`); `/reports` is a different page (`ReportsPage`). The
> component path in #468 is correct — only the URL is wrong. Recorded here so Dev
> and QA do not navigate to a 404.

---

## Components and classes

Reuse, verbatim, the markup shape of the Payment select (`OrderHistoryPage.tsx:297-308`):

```tsx
<label>
  <span>Service</span>
  <select
    value={query.serviceType ?? ''}
    onChange={(event) => updateFilter('serviceType', event)}
  >
    <option value="">All</option>
    <option value="DINE_IN">Dine-in</option>
    <option value="TAKE_OUT">Take-out</option>
  </select>
</label>
```

No new class, no new component, no wrapper element. Everything visual comes from
rules that already exist:

| Concern | Existing rule | Tokens it uses |
|---|---|---|
| Caption above the control | `.order-history-filters label > span` (`styles.css:4761`) | `--ink-soft` |
| Stacked label/control cell | `.order-history-filters label` (`:4755`) | 6px gap (literal in the shipped rule — see token findings) |
| Control box | `.order-history-filters select` (`:4767`) | `--field-h`, `--border-strong`, `--radius-sm`, `--surface`, `--fg` |
| Hover | `:4784` | `--muted` |
| Focus ring | `:4789` | `--focus` |
| Small-viewport height floor | `.order-history-filters select:not([multiple])` (`:10764`) | `--field-h` as `min-height`, so a scaled system font does not clip the label |
| Card surface | `.order-history-filters` (`:4743`) | `--space-3`, `--space-4`, `--border`, `--radius-md`, `--surface` |

`updateFilter` (`OrderHistoryPage.tsx:217`) is currently typed
`key: 'status' | 'paymentMethod'`. Add `'serviceType'` to that union and nothing
else in the handler changes — it already does `value || undefined`, which is
exactly the "All is the absence of the param" behaviour the other two selects
have.

### Finding (material, blocking) — the filter grid is hard-coded to four controls

`.order-history-filters` (`styles.css:4743`) declares:

```css
grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(148px, 190px));
```

`repeat(3, …)` is the three existing selects. A fifth child lands in an implicit
fifth column with no track sizing and the row overflows its card. This is not a
styling preference — the control is unusable at the narrow end of the range where
the base rule applies without a CSS change.

**The arithmetic.** The base rule governs widths **above 1100px** (the first
`@media` override is `max-width: 1100px`, `styles.css:5159`), so the worst case is
a 1101px viewport. Content width there:

```
1101  viewport
−228  .catalog-admin-shell sidebar (styles.css:527; it stays until 760px)
− 64  .reporting-page padding, 2 × --space-8 (styles.css:3327)
− 32  filter-card padding, 2 × --space-4
−  2  card borders
= 775px available to the grid
```

| | Minimum track total |
|---|---|
| Today (4 controls) | 220 + 3×148 + 3×12 = **700px** — fits, 75px slack |
| With Service (5 controls) | 220 + 4×148 + 4×12 = **860px** — **overflows by ~85px** |

**Recommended change** (one value plus one `repeat` count):

```css
/* styles.css:4745 */
grid-template-columns: minmax(220px, 1fr) repeat(4, minmax(148px, 190px));

/* styles.css:5159 — raise the existing breakpoint; the rules inside are unchanged */
@media (max-width: 1280px) { … }
```

At 1281px the available width is 1281 − 228 − 64 − 32 − 2 = 955px against the
860px minimum, so the five-column row has ~95px of slack — comparable to today's.
Below 1280px the existing two-column rule takes over and already handles any
number of controls.

This is a **material change to a shipped rule**, so it is called out rather than
assumed. Two things make it low-risk:

- **No new breakpoint is introduced** — `1100px` becomes `1280px`; the
  `760px` and `540px` rules are untouched.
- **`.order-history-filters` has exactly one consumer.** `grep` across
  `apps/web/src` returns `OrderHistoryPage.tsx:271` and nothing else; the staff
  order ledger uses `.staff-order-filters`
  (`apps/web/src/orders/StaffOrderHistoryPage.tsx:527`). The staff-ledger
  regression surface the Tech Lead flagged is real for `orderHistoryFilters` and
  `orderHistoryFormat`, but **it does not extend to this CSS.**

An alternative that avoids touching the breakpoint —
`grid-template-columns: minmax(220px, 1fr) repeat(auto-fit, minmax(148px, 190px))`
— is *not* recommended: `auto-fit` would also silently re-flow the existing three
selects at widths where they currently hold a fixed row, which is a larger
behavioural change than the one this story needs.

---

## Interaction

The select is uncontrolled in behaviour terms — every state below already exists
on this page and is inherited, not built.

| State | Trigger | What the user sees |
|---|---|---|
| **Default** | page load with no `serviceType` in the URL | `All`; the list is not filtered by service |
| **Selection** | choosing `Dine-in` / `Take-out` | `updateQuery` writes `serviceType` to the URL with `replace: true`, drops `page` (`resetPage` defaults `true`, `:199`), and the `queryKey` effect (`:169`) refetches |
| **Loading (refilter)** | a selection while rows are on screen | the results `<section>` keeps its rows and sets `aria-busy` (`:337`); `Updating…` appears in `.order-results-toolbar` (`:344`). The table is **not** replaced by a spinner — this is the shipped refilter behaviour and must not change |
| **Loading (first paint)** | a deep link carrying `serviceType` | `<ReportingLoading label="Loading order history…" />` (`:333`), as today |
| **Empty** | the filter combination matches nothing | the existing `.order-empty` block (`:348-354`) |
| **Error** | the request fails | the existing `<ReportingNotice>` (`:331`); the select keeps its selection so the user can change it |
| **Disabled** | — | **never.** No filter on this screen disables while loading, and the Service select must not either |
| **Confirmation** | — | none. This is a read-side filter; cite nothing, add nothing |

Back to `All` is a selection like any other: it deletes the URL param and refetches.

Two behaviours the story asks for are **already free** and must be asserted, not
built:

- **Return to page 1.** `updateQuery` deletes `page` unless `resetPage` is
  `false`, and only `setPage` passes `false` (`:212`, `:245-252`).
- **Survives reload.** The filter lives in `searchParams`, so
  `parseOrderHistoryQuery` rehydrates it (`orderHistoryFormat.ts:57`).

**Unrecognised URL value.** `parseOrderHistoryQuery` must drop an unknown
`serviceType` the same way it drops an unknown `status` — an enum-membership
check that simply omits the key (`orderHistoryFormat.ts:68-75`). The user-visible
result is `All` selected and an unfiltered list, with no error and no notice. The
junk value stays in the URL untouched; the existing filters behave the same way
and changing that is out of scope.

---

## Responsive

No new breakpoint. With the base rule corrected as above:

| Width | Layout | Filter bar |
|---|---|---|
| ≥1281px | five columns | Customer (flexible) + four selects, one row |
| 760–1280px | `repeat(2, minmax(0, 1fr))`, Customer `grid-column: 1 / -1` (`styles.css:5160-5166`) | Customer full width, then Status/Payment and Service/Rows per page — **three rows instead of two**, about 70px taller |
| ≤760px | same two columns, `--space-4` padding (`:5174`) | as above |
| ≤540px | single column (`:5199`), Customer's span reset (`:5203`) | five stacked rows, each at least `--field-h` |

Nothing drops, nothing scrolls in its own container, nothing collapses behind a
disclosure. The filter card grows vertically and pushes the results toolbar and
table down; the table keeps its own `.report-table-region` horizontal scroll
(`:360`) and the `Swipe horizontally to see all order fields.` hint, both unchanged.

At 540px the bar becomes five stacked fields plus the card padding, roughly 400px
tall. That is tall but consistent with every other stacked filter bar in the admin
app, and it is above the fold-break rather than between the user and the results.
Collapsing the filters behind a disclosure at narrow widths would be a new
pattern this screen does not have, and is explicitly **not** recommended here.

---

## Accessibility

- **Accessible name.** `<label><span>Service</span><select>` — the implicit label
  association gives the select the name `Service`, identically to Status
  (`:286`) and Payment (`:298`). **Do not add `aria-label`, `aria-labelledby`, or
  an `id`/`for` pair.** The visible text `Service` matches the table column header
  (`:385`), so the filter and the column it filters read the same.
- **Focus order** follows DOM order: Customer → Status → Payment → **Service** →
  Rows per page → the results toolbar → the table region (`tabIndex={0}`) → the
  sort buttons. Inserting before Rows per page keeps the filters contiguous.
- **Keyboard path.** Native `<select>`. Nothing to build; no roving tabindex, no
  key handlers, no listbox.
- **Focus return.** The select keeps DOM focus across the refetch, because the
  list updates in place and the component is never unmounted. Nothing may call
  `focus()` or `blur()` in the change handler — this app has had two bugs from
  programmatic refocus after a state change, and there is no reason to add a third.
- **Live region.** The `Showing 1-10 of N orders` line already carries
  `aria-live="polite"` (`:339`), so the new result count is announced after a
  filter change. **Add no second live region.** `aria-busy` on the results section
  (`:337`) already conveys the in-flight state.
- **Empty state.** `.order-empty` leads with an `<h2>`, so a screen-reader user
  reaching it by heading navigation gets `No sales orders` — unchanged, and it is
  the correct announcement for a Service filter that matches nothing.
- **Colour.** The control carries no colour-only meaning; the selected value is
  text. Focus is a `--focus` border plus a 3px `color-mix` ring (`:4789-4793`),
  i.e. not colour alone.
- **Touch target.** `--field-h` (48px) exceeds `--touch-min` (44px), and
  `styles.css:10764` converts it to a `min-height` below 767px so a scaled system
  font grows the control rather than clipping it.
- **Reduced motion.** The only animation on this screen is
  `order-history-enter` on the page container; it is already suppressed at
  `styles.css:5293`. The select adds no motion.

---

## Copy

Exact strings. No new copy is introduced by this story.

| Element | String |
|---|---|
| Filter caption | `Service` |
| Option (default) | `All` |
| Option | `Dine-in` |
| Option | `Take-out` |
| Empty-state heading (existing) | `No sales orders` |
| Empty-state body (existing) | `Clear the current filters or search to see available orders.` |
| Fetch error (existing) | `Order history could not be loaded. Try again.` |

**Accepted deviation — hyphenation.** The story prose writes the options as
"Dine in / Take out". The shipped Service column renders `Dine-in` / `Take-out`
via `formatServiceType` (`apps/web/src/reporting/orderHistoryFormat.ts:99`). A
filter must read the same as the column it filters, so the hyphenated form wins.
This was accepted by the Tech Lead, recorded on #468, and the story's AC 1 was
amended to the hyphenated strings during the QA testability loop — so the AC, the
column, the filter options and the e2e assertions now all carry one spelling.

**Suggestion for Dev, not a requirement:** render the two options from
`formatServiceType(ServiceType.DINE_IN)` / `formatServiceType(ServiceType.TAKE_OUT)`
rather than as literals, so the filter cannot drift from the column it filters.
The literal strings above are what must appear either way.

No money is introduced or changed by this story. The Total column keeps
`formatMoney`, which renders pesos with two decimals (`₱1,234.50`).

---

## Token findings

No new token is needed, and no literal value may be introduced. Two notes:

1. **The charter's stale mismatch list.** The UI/UX charter states that
   `--field-h` and `--touch-min` exist in `styles.css` but not in
   `docs/design/tokens.json`. That is **no longer true** — both are present as
   `control.fieldHeight` and `control.minimumTouchTarget`, as are the `--logo-*`
   family and `--cashier-key-size` (`cashierPicker.keypadKeySize`). The surviving
   gap is the `--z-modal*` family, which `tokens.json` does not carry. Nothing in
   this story touches it; flagged only so the charter's list can be corrected
   rather than re-reported by the next design run.
2. **One literal in the rule being reused.** `.order-history-filters label`
   (`styles.css:4758`) uses a literal `gap: 6px` where no spacing token matches —
   `--space-1` is 4px and `--space-2` is 8px. This is pre-existing and the new
   control inherits it. **Do not change it as part of this story** and do not copy
   the literal anywhere new; it is recorded as a finding for a human to decide
   whether a 6px step belongs in the scale.

---

## Implementation handoff

### Inherited requirements — binding, not advisory

From the story's acceptance criteria, the ADRs, and accessibility obligations.
Dev may not trade these away.

1. The options are exactly `All`, `Dine-in`, `Take-out`, with `All` the default
   and the absence of the URL param.
2. The URL param is `serviceType`, carrying the shared `ServiceType` enum values
   `DINE_IN` / `TAKE_OUT` (`packages/shared/src/domain.ts:578`) — matching the
   `status` / `paymentMethod` naming already used by the URL, the API client
   (`apps/web/src/reporting/api.ts:62-80`) and the endpoint.
3. The filter composes with status, payment, customer search, sort and pagination;
   every visible row satisfies all of them and the sort is retained.
4. **The filter must reach the count query as well as the page query**
   (`orderHistoryFilters`, `apps/api/src/reporting/reporting.service.ts:919`; the two call sites are the page query at `:451` and the count query at `:535`). If only the page query is
   filtered, the rows are right and the `Showing … of N` line and the page buttons
   lie. This is the single highest-risk defect in the story.
5. Changing the filter from page 2 or later returns to page 1, with
   `aria-current="page"` on the page-1 button (`OrderHistoryPage.tsx:138`).
6. The selection is restored from the URL after reload; an unrecognised value
   falls back to `All` and does not filter.
7. The select's accessible name comes from the existing `<label><span>` wrapping.
   No `aria-label`. No second live region.
8. The staff order ledger gains no Service filter and its behaviour does not
   change. Scope `orderHistoryFilters` and `orderHistoryFormat` edits so the
   staff path is unaffected.
9. ADR 0001 conventions are untouched by this story: no money arithmetic, nothing
   written or deleted, no new location scoping. It is a read-side `WHERE`.

### Advisory recommendations — Dev may deviate with reason

- The DOM position after Payment and before Rows per page.
- Deriving the option labels from `formatServiceType` rather than hard-coding them.
- The two-column reflow producing three rows at 760–1280px, rather than any
  narrow-width disclosure or horizontal scroll.
- Leaving an unrecognised `serviceType` value in the URL rather than rewriting it.

### Proposed material change to a shared shell or component

One, and it is required for the control to be usable:

| What | Why |
|---|---|
| `.order-history-filters` base `grid-template-columns` → `repeat(4, minmax(148px, 190px))`, and the existing `@media (max-width: 1100px)` → `1280px` (`styles.css:4745`, `:5159`) | The base grid declares exactly four tracks. A fifth child overflows the card by ~85px at 1101px (arithmetic above). Raising the existing breakpoint adds no new breakpoint and the rule is consumed by one component only, so the staff ledger cannot regress. |

Nothing else in `styles.css` changes, and no application component outside
`OrderHistoryPage.tsx` is touched.
