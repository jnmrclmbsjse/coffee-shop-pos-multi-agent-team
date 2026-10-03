# Reports — cash float, reconciliation paging, product sales sort and All time

Story #411 · Design Task #440 · mode: **spec** (Tech Lead verdict — no Open
Design run)

Screen: `apps/web/src/reporting/ReportsPage.tsx` (route `/reports`), with
`ReconciliationTable` and `ProductSalesTable` in
`apps/web/src/reporting/components.tsx`. Nothing else on the screen changes:
`ReportTypeNavigation`, `.reporting-page-head`, `.report-filter`,
`ReportTotals`, `DateRangeLabel` and the `.applied-range` line are untouched,
and so is the Expenses / Daily inventory sibling pair.

## Design read

Four changes land in one shipped screen, and three of the four already have a
working precedent in this codebase. The design job is therefore mostly
**choosing which shipped idiom each change adopts and saying so once**, not
inventing anything.

The genuinely new idea is the fourth: **one panel on the page is allowed to be
off-range.** Everything on `/reports` today is scoped by one date range, stated
once in `.applied-range` at the top of `.reporting-content`. All time breaks
that — Product sales leaves the range while the totals, Daily reconciliation
and the CSV stay on it. If that state is not visible *inside the panel that
changed*, the page silently lies: a reader who glanced at "Showing 1 Sep to 30
Sep" at the top will read the product numbers as September's. The affordance
below is sized for that risk, not for decoration.

Five decisions are made and justified, because each had a defensible
alternative the Design Task asked to be chosen between:

1. **Cash float sits between Tips and Cash in** — making every addend of
   Expected cash appear to the left of Expected cash.
2. **Pagination reuses `.order-pagination` buttons but drops the numbered
   window** — `Previous · Page 2 of 4 · Next`, which is exactly the criterion
   and survives a 390 px viewport.
3. **Page controls are hidden, not disabled, at one page.** The story allows
   either; this picks hidden.
4. **Product sales sorts from the column headers** (`.order-sort` +
   `aria-sort`), not from a segmented control.
5. **The All time affordance uses the `promotion` token family**, not
   `--accent` / `--focus` as the Design Task suggested. Reason under
   *Findings*, F5.

No new token is needed. No new component is needed. Three new CSS classes and
one new modifier are, and all four are small deltas on shipped rules built
entirely from shipped tokens.

---

## Placement

All four changes live inside the two existing `<section className="report-panel">`
elements rendered by `ReportsPage` at lines 134–135, in their current order
(`ReportTotals` → `ReconciliationTable` → `ProductSalesTable`). The
`.reporting-content` grid gains no child.

### Daily reconciliation panel

```
section.report-panel
  header.report-panel-head        ← sub-caption copy changes (Copy, C1)
  p.report-scroll-hint            ← unchanged
  div.report-table-region         ← unchanged wrapper
    table.reconciliation-table    ← gains one column; renders a page, not all rows
  nav.order-pagination.report-pagination   ← NEW, panel footer
```

The pagination nav is the last child of the panel, outside
`.report-table-region` so it never scrolls horizontally with the table.
`.report-panel` already sets `overflow: hidden` and a `--radius-md` corner, so
a footer with `border-top: 1px solid var(--border)` seats correctly against the
rounded edge — the same construction `.report-scope-footer` uses in
`DailyInventoryReportPage.tsx:131`.

### Product sales panel

```
section.report-panel
  header.report-panel-head
    div > h2 + p                  ← unchanged copy
    span.state-badge.promotion    ← NEW, only while All time is active
  p.product-sales-scope           ← NEW, always rendered (two variants)
  div.restock-scope-toggle        ← REUSED verbatim, holds the All time checkbox
  div.report-table-region
    table.product-sales-table     ← two headers become sort buttons
```

`.report-panel-head` is already `display: flex; justify-content: space-between`
with the heading block as its only child, so the badge drops into the right-hand
slot with no layout change — the same slot `.read-only-label` occupies in
`.reporting-page-head`.

The scope line sits **above** the toggle, matching `RestockNeedsPanel`, where
`.restock-copy` states what the list is built from and `.restock-scope-toggle`
follows it (`components.tsx`, Restock needs). Reader learns the state, then
finds the control that changes it.

---

## Components

### 1. Cash float column — `<th className="num">`, no new anything

A fourteenth column, inserted **between `Tips` and `Cash in`**:

| 1 | 2 | 3 | 4 | 5 | 6 | **7** | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Date | Status | Cash sales | Online sales | Gross | Tips | **Cash float** | Cash in | Cash out | Cash expenses | Outstanding change | Expected cash | Actual cash | Variance |

**Why there.** `calculateCashReconciliation` (`packages/shared/src/money.ts:123`)
computes `expectedCash = openingFloat + cashSales + tips + cashIn +
outstandingChange − cashOut − cashExpenses`. Opening float is its *first* term.
Placing Cash float at position 7 puts every addend of Expected cash to the left
of Expected cash, so the row reads left-to-right as the arithmetic that produces
it. Appending it at the far right — the other obvious option — would put the
largest single input to Expected cash on the wrong side of its own result, and
behind a horizontal scroll on a tablet.

Markup is the shipped money-cell idiom, unchanged:

```jsx
<th scope="col" className="num">Cash float</th>
...
<td className="num">{formatMoney(row.openingFloatCents)}</td>
```

`openingFloatCents` is `MoneyCents`, never null (`DailyReadModel` line 56; the
field is non-nullable on the trading day). A zero float therefore renders
**`₱0.00`**, not `—`. The `—` / `aria-label` treatment in this table is reserved
for `actualCashCents === null`, which means *not recorded*; a recorded float of
zero is a different fact and must not borrow that vocabulary.

The row key changes from `row.date` to `row.tradingDayId` (#441 supplies it).
Not cosmetic: this story admits two trading days on one business date.

### 2. Reconciliation pagination — `.order-pagination` reused, numbered window dropped

```jsx
<nav className="order-pagination report-pagination"
     aria-label="Daily reconciliation pages">
  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
    Previous
  </button>
  <p className="report-pagination-status" role="status" tabIndex={-1}>
    Page {page} of {totalPages} · Trading days {firstIndex}–{lastIndex} of {rows.length}
  </p>
  <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
    Next
  </button>
</nav>
```

**Reuse `.order-pagination` as-is for the buttons.** `styles.css:4870` already
gives them `min-width`/`min-height: var(--touch-min)`, `--border-strong`,
`--radius-sm`, `--surface`, a `--focus`/`--accent` hover and a `--muted`
disabled state. Nothing about those buttons needs to change for this panel.

**Drop the numbered `PageButton` window.** `OrderHistoryPage.tsx:146`
(`pageWindow`) renders up to five numbered buttons because order history pages
over hundreds of server-paged orders, where jumping to page 9 is a real task. A
report range holds at most a handful of pages of a client-side slice and is read
sequentially. Seven 44 px targets also do not fit a 390 px viewport once the
page padding is taken off (`7 × 44 + 6 × 6 = 344 px` against ~358 px of content
width, before the status text). `Previous · Page 2 of 4 · Next` is exactly what
the criterion asks for and needs no narrow-screen escape hatch.

Two new classes, both pure layout on shipped tokens:

```css
/* Pagination footer for a report panel. Reuses .order-pagination's buttons;
   spreads them around a page-position status instead of the numbered window
   order history needs. */
.report-pagination {
  justify-content: space-between;   /* overrides .order-pagination's flex-end */
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border);
}

.report-pagination-status {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
}

.report-pagination-status:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
```

`font-size: 13px` and `--ink-soft` are the shipped values for secondary panel
copy (`.report-footnote, .restock-copy, .report-scope-footer,
.report-read-only-note`, `styles.css:3948`). See F3 — the right long-term move
is to add `.report-pagination-status` to that selector list rather than restate
it; the block above is written out only so the delta is legible.

**Hidden, not disabled, when `totalPages <= 1`.** Do not render the `<nav>` at
all. `.order-pagination` reserves `min-height: 68px`; a dead 68 px band with two
greyed buttons under a five-row table reads as a broken control, and
`.report-panel` is a static report surface, not a server-paged list where the
chrome's permanence tells you more pages exist. This also keeps the empty state
(`No days in this range.`) exactly as it ships. The story explicitly permits
either; this is the pick, and e2e should assert absence, not `disabled`.

### 3. Product sales sort — `aria-sort` headers, not a segmented control

Adopt the `SortHeader` idiom from `OrderHistoryPage.tsx:85`: `.order-sort` /
`.order-sort-numeric` inside a `<th aria-sort>`.

**Why this and not `.restock-scope-toggle`.** The two sortable things *are
columns of this table* and both are numeric and right-aligned. The header
button puts the control on the thing it reorders, carries the direction glyph in
the same cell, and gives assistive technology `aria-sort` for free — none of
which a detached segmented control above the table does. `.restock-scope-toggle`
is the right idiom for the All time switch below, because *that* changes which
rows exist rather than their order, and the two must not look like one control.

Two differences from order history, both forced by the acceptance criteria:

- **Direction is fixed.** The story says "highest first" for both modes; there
  is no ascending state. `aria-sort` is `"descending"` on the active column and
  `"none"` on the other. The glyph is `↓` on the active column and empty
  otherwise — the same `<span aria-hidden="true">` slot, which `.order-sort span`
  already reserves at `min-width: 12px` so headers do not shift on sort.
- **Clicking the active header re-applies the same sort and changes nothing.**
  It is not disabled — a disabled header reads as "unsortable" — and its
  `aria-label` already ends in "sorted descending", which tells a screen-reader
  user there is nothing further to get.

The `Product` header is not sortable and gains no button; product name is the
first tie-break of both modes, not a mode of its own.

Sort is **client-side over `report.topProducts` / the all-time array**, and must
reproduce the server's documented order exactly (#441 keeps the API on
`revenue DESC, name ASC, id ASC`):

| Mode | Comparator |
|---|---|
| Revenue (default) | `revenueCents` desc → `productName` A–Z → `productId` asc |
| Qty sold | `quantitySold` desc → `productName` A–Z → `productId` asc |

Compare names with a stable locale-independent comparison so the browser's
collation cannot disagree with Postgres's `ORDER BY product.name ASC` on the
default revenue sort — otherwise the panel reorders rows on mount for no reason
the user can see.

### 4. All time — `.restock-scope-toggle` + a scope line + a badge

**The control** is `.restock-scope-toggle` reused verbatim
(`styles.css:10777`, shipped in `RestockNeedsPanel`). It is already *the*
"change this one panel's scope" control in the reporting surface, already
`--touch-min` tall with an `--accent` accent-colour checkbox, and already pads
to line up with the copy band above it.

```jsx
<div className="restock-scope-toggle">
  <label htmlFor="product-sales-all-time">
    <input
      id="product-sales-all-time"
      type="checkbox"
      checked={allTime}
      onChange={(event) => setAllTime(event.target.checked)}
    />
    <span>Show all time</span>
  </label>
</div>
```

**The scope line** is rendered in **both** states, not only while All time is
active. A line that only appears in one state gives a reader nothing to compare
against and gives e2e no stable locator for "switched back".

```jsx
<p className={`product-sales-scope${allTime ? ' is-all-time' : ''}`} role="status">
  …
</p>
```

```css
/* Product sales scope band. Says which period THIS panel covers, because
   All time lets it differ from the range stated once at the top of the page. */
.product-sales-scope {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--border);
  color: var(--ink-soft);
  font-size: 13px;
}

.product-sales-scope.is-all-time {
  color: var(--promotion-ink);
  border-bottom-color: var(--promotion-border);
  background: var(--promotion-surface);
}
```

This is `.restock-copy`'s geometry exactly (`styles.css:3962`) plus one state
modifier — see F3 for the recommended alias rather than a copy.

**The badge** appears only while All time is active, in the panel head's
right-hand slot:

```jsx
{allTime && (
  <span className="state-badge promotion">
    <span aria-hidden="true" />
    All time
  </span>
)}
```

`.state-badge.promotion` ships at `styles.css:1175` and is already used for a
non-error, non-success informational state (`catalog/components.tsx:168`). It
carries its own dot, border and `--promotion-*` colours, so the badge and the
scope band read as one treatment.

**Colour is never the only signal.** The badge carries the words "All time", the
scope band states it in a sentence, and the sentence also names what did *not*
move. The `--promotion-*` tint is the third cue, not the first.

---

## Interaction

### Daily reconciliation

| State | Trigger | What the user sees |
|---|---|---|
| Default | report loads, >15 days | Rows 1–15 of the newest-first list; footer reads `Page 1 of N`; `Previous` disabled |
| Mid-range page | `Next` / `Previous` | The 15 rows for that page; status updates and is announced; totals above are untouched |
| Last page | `Next` on page `N−1` | Remaining 1–15 rows; `Next` becomes disabled |
| Single page | ≤15 days in range | No `<nav>` at all; table renders every row |
| Empty | 0 days in range | Existing `No days in this range.`; no scroll hint, no nav |
| Range re-applied | `Apply range` submit | Page resets to 1 **before** the fetch resolves |
| Refreshing | fetch in flight with a report already shown | Existing `.reporting-content[aria-busy]` + `Updating…` in `.applied-range`; the current page stays visible |
| Range fails | fetch rejects | Existing page-level `ReportingNotice`; the previous report and its page remain |

**Page reset is owned by `ReportsPage`, not by the table.** Hold `page` in
`ReportsPage` and call `setPage(1)` at the top of `loadReport`, beside the
existing `setLoading(true)` / `setPageError('')`. Keying `ReconciliationTable`
on `` `${report.from}:${report.to}` `` is the tempting alternative and is wrong:
re-applying the *same* range produces the same key and leaves the user on page 4
of a reload. Resetting inside `loadReport` also covers the initial mount.

**Slice, do not re-sort.** `#441` returns the rows already in the required
order. The page is `rows.slice((page − 1) * 15, page * 15)`. Guard `page`
against a shrinking list (`Math.min(page, totalPages)`) so a narrowed range
cannot strand the view past the end.

### Product sales

| State | Trigger | What the user sees |
|---|---|---|
| Default | report loads | Range scope line; `Show all time` unchecked; Revenue header `aria-sort="descending"` with `↓` |
| Sorted by quantity | click `Qty sold` | Rows reorder in place; `↓` moves; both `aria-sort` values swap; focus stays on the pressed button |
| Re-click active header | click the sorted header | No change. Not an error, not a toggle to ascending |
| All time loading | check `Show all time`, first time | Badge and all-time scope line appear immediately; table area replaced by `Loading all-time product sales…` |
| All time | fetch resolves | All-time rows under the **current** sort; badge + tinted scope line |
| All time cached | uncheck, then re-check | Instant; no second fetch unless the earlier one failed |
| All time empty | fetch resolves to `[]` | `No product sales have been recorded yet.` |
| All time failed | fetch rejects | Panel-scoped `ReportingNotice`; toggle **stays checked** |
| Range empty | range has no sales | Existing `No sales in this range.`, unchanged |

**Fetch on first toggle-on, then cache.** Do not prefetch all-time product
sales with the report: it is a whole-history aggregate the administrator may
never ask for, and paying for it on every range change is the wrong default.

**Sort state and All time both survive a range change.** They are view
preferences of one panel; All time in particular ignores the range by
definition, and silently dropping back to range scope on `Apply range` would
reintroduce exactly the misreading this design is guarding against.

**The all-time failure must not use the page-level `pageError`.** Setting it
would render `.reporting-notice` above `ReportTotals` and tell the
administrator the whole report failed when the totals, the reconciliation table
and the CSV are all fine. Hold a separate `allTimeError` and render
`<ReportingNotice>` **inside** the Product sales panel, where the table would
be. Leaving the toggle checked keeps the failure attached to the thing that
failed; unchecking returns to the range table and re-checking retries.

---

## Responsive

Breakpoints are the two `styles.css` already uses on this page: `760px` and
`540px`.

**≥761 px.** Unchanged for everything above. The reconciliation table grows one
column; `.reconciliation-table { min-width }` must rise from `1060px` to
**`1160px`** (see F2) so the new money column cannot be crushed before
`.report-table-region` starts scrolling.

**≤760 px.**
- `.report-scroll-hint` already becomes `display: block` — the reconciliation
  hint copy stands unchanged.
- `.report-panel-head` already becomes `flex-direction: column; align-items:
  flex-start`, so the **All time** badge stacks under the heading rather than
  being squeezed beside it. No rule needed.
- The pagination footer and the scope band join the existing padding-reduction
  group at `styles.css:4104` (`.report-footnote, .restock-copy,
  .report-scope-footer`), taking `padding-left/right: var(--space-4)`.
- `.order-pagination` is already `flex-wrap: wrap`. With only three children the
  row holds at 390 px (`2 × 44 px` buttons + status); if the status wraps it
  lands on its own line and the buttons stay at the row's edges, which is
  acceptable and needs no rule.

**≤540 px.** Nothing further. The Product sales table has three columns, no
`min-width` and fits; the two sort buttons are `min-height: var(--touch-min)`
from `.order-sort` and sit inside cells that are already `white-space: nowrap`.

Nothing here hides a control at any width. Both pagination buttons, the sort
headers and the All time toggle remain reachable on a 390 px viewport.

---

## Accessibility

**Reconciliation table.**
- The new header is `<th scope="col" className="num">Cash float</th>` — same
  association as the thirteen beside it.
- `aria-label="Daily reconciliation table, horizontally scrollable"` on
  `.report-table-region` stands; it is still true and still the only thing the
  `tabIndex={0}` scroll region needs.
- Row keys move to `tradingDayId`. Two rows on one business date currently
  collide on `key`, which lets React reuse the wrong DOM node and hand a screen
  reader a row of mixed values.

**Pagination.**
- `<nav aria-label="Daily reconciliation pages">` distinguishes it from any
  future nav in the same landmark, matching `aria-label="Order history pages"`.
- The status paragraph is `role="status"`, so each page change announces
  `Page 2 of 4 · Trading days 16–30 of 47` without stealing focus.
- **Focus on a disabling edge.** Pressing `Previous` onto page 1, or `Next` onto
  the last page, disables the button the user just pressed and drops focus to
  `<body>` — a keyboard user loses their place mid-table. Move focus to the
  status paragraph (`tabIndex={-1}`, `.focus()` in the click handler) when, and
  only when, the press disables the pressed button. The `:focus-visible` rule
  above gives that landing a visible ring. *(Advisory — order history has the
  same gap and this design does not fix it there.)*
- The table is rebuilt on page change, so position within it is not preserved;
  the announced status is what re-orients the user.

**Sort headers.**
- `aria-sort` on the `<th>`, `"descending"` / `"none"`; the button's
  `aria-label` is `Qty sold, sorted descending` or `Qty sold, not sorted`,
  exactly as `SortHeader` builds it.
- The arrow is `aria-hidden`; direction reaches assistive technology through
  `aria-sort` and the label only.
- Focus stays on the pressed header button — React re-renders the same element,
  so no focus management is required. Do not key the `<thead>` on the sort.

**All time.**
- The checkbox is a real `<input type="checkbox">` inside its `<label
  htmlFor>`; checked state is the control's own, with no `aria-pressed`
  duplication.
- The scope paragraph is `role="status"`, so toggling announces the full new
  scope sentence — including the clause about what stayed on the range. That
  sentence, not the colour, is what a screen-reader user gets.
- The badge is plain text inside `.state-badge.promotion`; its dot `<span>` is
  `aria-hidden="true"`, matching `catalog/components.tsx`.
- Loading uses the shipped `ReportingLoading` (`role="status"`), so the fetch
  announces itself; the failure uses `ReportingNotice` (`role="alert"`).

**Contrast.** `--promotion-ink` on `--promotion-surface` is the shipped pairing
already used for `.state-badge.promotion` and `.adjustment-kind.bonus`; no new
colour pair is introduced.

---

## Copy

Exact user-facing strings. Money is `formatMoney` (`₱1,234.50`).

**Daily reconciliation**

| Id | Where | String |
|---|---|---|
| C1 | `.report-panel-head` sub-caption | `Trading days are ordered from newest to oldest. The CSV export keeps its original oldest-to-newest order.` |
| C2 | New column header | `Cash float` |
| C3 | Pagination status | `Page {page} of {total} · Trading days {first}–{last} of {count}` |
| C4 | Pagination buttons | `Previous` / `Next` |
| C5 | Nav label | `Daily reconciliation pages` |
| C6 | Empty (unchanged) | `No days in this range.` |

C1's first sentence is **required** — the shipped sub-caption says "oldest to
newest" and would become false. Its second sentence is **advisory**: the CSV's
order is deliberately diverging from the table's, and the only place the
administrator can learn that without opening the file is here. Drop it if Tech
Lead judges the caption too long; do not drop the first sentence.

**Product sales**

| Id | Where | String |
|---|---|---|
| C7 | Panel sub-caption (unchanged) | `Base products, with all variants combined.` |
| C8 | Scope line, range | `Showing the selected report range.` |
| C9 | Scope line, all time | `Showing all time — every recorded business day. The totals, Daily reconciliation and the CSV export still cover the selected report range.` |
| C10 | Badge | `All time` |
| C11 | Toggle label | `Show all time` |
| C12 | Sort header labels (unchanged) | `Qty sold` / `Revenue` |
| C13 | Sort button `aria-label` | `{label}, sorted descending` / `{label}, not sorted` |
| C14 | Loading | `Loading all-time product sales…` |
| C15 | Load failure | `All-time product sales could not be loaded. Uncheck and re-check Show all time to try again.` |
| C16 | Empty, all time | `No product sales have been recorded yet.` |
| C17 | Empty, range (unchanged) | `No sales in this range.` |

C9 is the single most important string in this design. It names the new scope
and, in the same breath, names the three things that did **not** change scope.
Shortening it to "Showing all time" removes the half that prevents the
misreading.

---

## Findings

**F1 — The table and the CSV stop being column-identical, on purpose.**
`toCsv` (`reporting.service.ts:535–564`) lists exactly the thirteen headers
`ReconciliationTable` renders, in the same order. That parity has held since
#80 and is not enforced anywhere. This story breaks it twice over: the table
gains Cash float and the CSV does not, and the table inverts its row order
while the CSV must not. Both are correct per the acceptance criteria. The only
guard is #443's CSV regression coverage, and C1's second sentence is the only
place a user is told. Flagging so the divergence is a recorded decision rather
than something a later reader finds and "fixes".

**F2 — `.reconciliation-table { min-width: 1060px }` must change, and table
min-widths are untokenized.** A fourteenth money column needs roughly 110 px at
the shipped `14px` cell padding and mono numerals; `1160px` is the
recommendation. There is no token for it — `.reconciliation-table` (1060px),
`.packaging-report-table` (1040px) and `.restock-report-table` all carry bare
pixel literals, which is shipped practice for this one property. Raising a
`--table-min-*` family is out of scope here; noting that the literal is
deliberate, matches its neighbours, and is the one number in this document that
is not a token.

**F3 — `.restock-copy` has become the generic "panel copy band" and should be
renamed or aliased.** It is defined with `.report-footnote`,
`.report-scope-footer` and `.report-read-only-note` at `styles.css:3948`, and
this design wants its exact geometry twice more (`.product-sales-scope`,
`.report-pagination-status`) in a panel that has nothing to do with restocking.
Recommend adding a neutral `.report-panel-copy` to both that shared rule and
the `.restock-copy` block, then letting the new classes use it — rather than a
third and fourth copy of the same four declarations. A human should decide
whether to go further and migrate `.restock-copy`'s call sites.

**F4 — `.report-status-open` hardcodes two `oklch()` literals**
(`styles.css:3473`), in the same table this story edits. `oklch(35% 0.11 145)`
and `oklch(96% 0.025 145)` are in the accent hue family but match no token;
nothing updates them if the palette moves. Pre-existing and out of scope —
recorded because it sits two columns from the new one, and because it is the
kind of value that looks like a token at a glance.

**F5 — Deliberate deviation from the Design Task's token suggestion.** #440
proposed `--accent`, `--focus` or `--muted` for the "All time is active"
emphasis. This design uses `--promotion-ink` / `--promotion-surface` /
`--promotion-border` instead. `--accent` and `--focus` are the same green that
means *affirmative* throughout this app — primary buttons, `.report-status-open`,
`--success-surface`, `.state-badge.positive`; tinting a panel with it would
read as "this panel is good", not "this panel is on a different period".
`--muted` is the opposite failure: it de-emphasises the one thing that must be
noticed. The promotion family is the shipped **informational** emphasis, already
carrying a ready-made badge variant. It satisfies the task's actual constraint —
an existing token, no new one — and the deviation is only in which one.

**F6 — `styles.css` / `tokens.json` drift touching this work.** Both files
carry everything this design names, so nothing here is blocked. Two mismatches
noticed while checking: `tokens.json` defines `space.10` (40px) and `space.12`
(48px) with no `--space-10` / `--space-12` in `styles.css`, and `styles.css`
defines `--z-modal-backdrop` / `--z-modal` with no counterpart in
`tokens.json`. Neither is used here. Recorded per the standing rule that a
token present in only one of the two views is a finding for a human to
reconcile.

---

## Implementation handoff

### Binding — inherited from the story, ADRs and accessibility

Not negotiable by this design; it only says *where* each lands.

- Newest business date first; later `opened_at` first on a tie; higher trading
  day id first on a full tie. Ordered in SQL by #441 — the page slices, it does
  not sort.
- A Cash float column showing the opening float recorded at open.
- 15 trading days per page, with next/previous and a current-page / total-pages
  indication.
- Page resets to the first page whenever a range is applied.
- Controls hidden **or** disabled at ≤15 days — the story allows either; this
  design picks hidden and e2e should assert that.
- Totals cover the whole range regardless of the visible page.
- Product sales defaults to revenue, highest first.
- Sortable by quantity sold or revenue, highest first; ties by product name
  A–Z, then product id ascending, in **both** modes.
- All time shows every recorded business day; while active the panel says so;
  totals, Daily reconciliation and CSV stay on the selected range; the
  administrator can switch back.
- Product sales is not paginated.
- The CSV export is unchanged — same rows, order and columns.
- Money renders through `formatMoney` as integer cents (ADR 0001). A zero float
  is `₱0.00`, never `—`.
- `aria-sort` on sortable headers; `role="status"` on the page-position and
  scope lines; colour never the sole carrier of the All time state; every
  control ≥ `--touch-min`.

### Advisory — this design's recommendations

Dev may integrate these differently with a line of reasoning; Tech Lead reviews
the deviation, not the pixels.

- Cash float at position 7, between Tips and Cash in.
- `Previous · Page N of M · Next` without the numbered `pageWindow`.
- `page` state in `ReportsPage` with `setPage(1)` inside `loadReport`, rather
  than a `key` on the table.
- `Math.min(page, totalPages)` guard against a shrinking range.
- Sort via `.order-sort` headers rather than a segmented control; active header
  re-click is a no-op, not a direction toggle.
- Locale-independent name comparison so the client sort matches Postgres.
- Scope line rendered in **both** scopes, not only while All time is active.
- All-time data fetched on first toggle-on and cached; not prefetched.
- Sort choice and All time persist across a range change.
- All-time failure held in panel-local state and rendered inside the panel —
  explicitly **not** the page-level `pageError`.
- `.reconciliation-table` min-width `1060px → 1160px`.
- Focus moved to the pagination status when a press disables the pressed button.
- C1's second sentence (the CSV-order note) and C9's second sentence.

### Proposed material changes to shared shells or components

Each is a delta on something more than one screen can see. Named so they are
reviewed as such rather than arriving inside a feature diff.

1. **`ReportingLoading` gains an optional `className`** (`components.tsx:47`).
   The all-time fetch needs an in-panel loading state, and `.reporting-loading`
   ships with its own `1px` border, `--radius-md` and `margin-bottom:
   var(--space-6)` — correct as a page-level block, a nested card inside
   `.report-panel`. Recommended: pass `report-panel-loading`, a modifier that
   zeroes `border`, `border-radius` and `margin-bottom` and keeps the spinner
   row. The alternative — a second loading component for panels — fragments the
   one `role="status"` loading idiom the reporting surface has.
   *Reason: shared component signature; used by three reporting pages.*

2. **`.report-pagination` / `.report-pagination-status` are named generically on
   purpose.** Expenses and Daily inventory are the obvious next panels to page,
   and `.order-pagination` is named for order history. Reviewing the names now
   is cheaper than renaming after a second caller.
   *Reason: new shared CSS, deliberately not scoped to this panel.*

3. **`.report-panel-copy` alias for `.restock-copy`** — F3. A rename with no
   visual change, touching a selector list four other classes already share.
   *Reason: shared CSS rule; affects Daily inventory's panels if migrated.*

4. **`.product-sales-scope` is panel-scoped and should stay so.** It is listed
   here only to say it is *not* proposed as shared: the "one panel is off-range"
   state has exactly one instance today, and generalising it before a second
   caller exists is the drift `docs/ui-reconciliation.md` records.
   *Reason: declared non-shared so a later reader does not promote it by
   default.*
