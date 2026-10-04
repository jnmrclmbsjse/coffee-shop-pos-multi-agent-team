# Story #412 — Grouped allowance, bonus, and advance lines on the payslip

Story [#412](https://github.com/jnmrclmbsjse/coffee-shop-pos-multi-agent-team/issues/412)
· Design Task #453 · mode: **spec** (Tech Lead verdict — no Open Design run)

Screen: `apps/web/src/compensation/PayslipView.tsx`, inside the `captureRef`
`<article className="payslip-artifact">` that `html-to-image` rasterizes.
Route: Admin → Compensation → Payslip tab (`apps/web/src/compensation/CompensationPage.tsx`).

**This is an advisory implementation reference, not a second set of acceptance
criteria.** The acceptance criteria on #412 and ADR 0014 are binding; the
*Implementation handoff* section at the end separates what is inherited from
what is recommended.

## Design read

Nothing new is built. Two shipped tables change the **content** of their
existing `<td>` + `<span>` metadata rows:

| Table | Class | Source today | Source after |
|---|---|---|---|
| Payslip earnings | `.payslip-artifact-table` | `summary.adjustments` filtered `kind !== ADVANCE` | `summary.adjustmentGroups` filtered `kind !== ADVANCE` |
| Salary advances | `.payslip-artifact-table.payslip-advance-table` | `summary.adjustments` filtered `kind === ADVANCE` | `summary.adjustmentGroups` filtered `kind === ADVANCE` |

The one real design problem the Design Task names is **how a multi-date group
reads**, including a date that repeats. The answer below needs **no new
component, no new class, and no new token** — the metadata `<span>` already
ships, already renders at 12px in `--muted`, and already wraps. One advisory
one-property CSS change is proposed (§ Implementation handoff), and that is all.

Out of scope and untouched, as the Design Task states: the category totals
`<dl>`s, the net payable block, the generated-timestamp line, the range/staff
form, and every adjustment record/edit/delete surface on `CompensationPage` and
`AdjustmentsView`.

---

## Placement

Unchanged. The grouped lines sit exactly where the per-item lines sit today:

- **Earnings table** — `PayslipView.tsx:493-509`, in the `<tbody>` after the
  conditional `Salary` and `Commission` rows, inside
  `<section className="payslip-zone">` labelled by `#payslip-earnings-title`.
- **Advances table** — `PayslipView.tsx:537-544`, the whole `<tbody>` of the
  Deductions zone.

No row moves between zones, no zone is added, no heading changes. The
`Amount` column keeps its position, its right alignment, its tabular-nums
monospace stack and its `nowrap` (`.payslip-artifact-table td:last-child`).

The two render gates stay as they are: the earnings table still renders only
when `summary.earningsTotalCents !== 0`, and the advances table still renders
only when there is at least one in-range advance (the `advances.length === 0`
branch and its `.payslip-zone-note` copy are unchanged — just compute the
emptiness from `adjustmentGroups` instead of `adjustments`; a kind with no
items has no groups and vice versa).

---

## Components and classes to reuse

Everything already exists. Cite, do not re-decide:

| Need | Reuse | Where it already ships |
|---|---|---|
| The row | `<tr>` with two `<td>` in `.payslip-artifact-table` | `PayslipView.tsx:493-509` |
| Description line | first `<td>`, bare text node | same |
| Metadata line (kind, count, dates) | the `<span>` child of that `<td>` — `display:block; color:var(--muted); font-size:12px` (`.payslip-artifact-table td > span`) | `styles.css` `.payslip-artifact-table td > span` |
| Amount | second `<td>` — `.payslip-artifact-table td:last-child` | same |
| Negative amount colour | `.payslip-advance-table td:last-child { color: var(--danger) }` | `styles.css` |
| Money formatting | `formatMoney(cents)` | `apps/web/src/reporting/format.ts:27` |
| Date formatting | `formatBusinessDate(iso)` / `formatBusinessDate(iso, 'short')` | `apps/web/src/reporting/format.ts:81` |
| sr-only table caption | `<caption className="sr-only">` | `PayslipView.tsx:473`, `:529` |

**No count chip.** `.staff-page-heading-badge` was considered as the Design Task
suggested and is **not recommended** — see *Alternatives considered*.

---

## The grouped line

The group comes from the API as `PayslipAdjustmentGroup` (#454): `kind`,
`description`, `totalCents`, `effectiveDates` (one entry **per item**,
ascending, duplicates retained), `itemCount`, `adjustmentIds`. The browser
renders those fields and computes no arithmetic (ADR 0014 §3).

### Structure (both tables)

```html
<tr>
  <td>
    Transportation allowance
    <span>Allowance · 3 items · Sep 1, Sep 1, Sep 3</span>
  </td>
  <td>₱1,500.00</td>
</tr>
```

Three segments in the `<span>`, in this order, joined by a middle dot with hair
spacing — the literal separator string is `" · "` (space, U+00B7, space):

1. **Kind label** — `Allowance` or `Bonus` in the earnings table, exactly the
   two strings shipped today. **Omitted in the advances table**, where the
   column header `Salary advance` already states the kind — also as today.
2. **Item count** — `{itemCount} items`. **Present only when
   `itemCount > 1`.** This segment is what makes a repeated date legible: the
   reader (and the screen-reader listener) is told how many dates to expect
   before hearing them.
3. **Date list** — every entry of `effectiveDates`, in the order the API sent
   them (ascending), joined by `", "`. **One entry per item; a date that
   repeats is printed again.** Three items on 2026-09-01 renders
   `Sep 1, Sep 1, Sep 1`.

`key` for the row: the group's first `adjustmentIds[0]`. It is stable, unique
across both tables, and does not require a synthetic key.

### Date style: `short` for groups, `long` for singletons

`formatBusinessDate` has two styles: `'long'` → `September 1, 2026`, `'short'`
→ `Sep 1`.

- **`itemCount === 1`** → `'long'`, i.e. the line is byte-for-byte what ships
  today (see *Single-item group* below).
- **`itemCount > 1`** → `'short'`. Three long dates is 66 characters of 12px
  muted text before the amount column; three short dates is 22. The long form
  also contains its own commas, which makes a comma-joined list of long dates
  genuinely hard to parse (`September 1, 2026, September 1, 2026`).
- **Exception — a range that crosses a calendar year.** When
  `summary.from` and `summary.to` fall in different years, use `'long'` for
  multi-item groups too, because `'short'` drops the year and `Jan 3, Dec 28`
  would then be unreadable. One comparison of the two year substrings; no other
  branch. A 15-day cutoff never crosses a year, so this is the rare path, but
  the payslip range is free-form and a December-to-January range is reachable.

### Single-item group — identical to today

A description appearing once renders exactly as the current per-item row, with
no count segment and no `·` separator:

```html
<tr>
  <td>Rice allowance<span>Allowance, September 1, 2026</span></td>
  <td>₱800.00</td>
</tr>
```

and in the advances table, `<span>September 1, 2026</span>`. The comma after
the kind label is the shipped separator and is kept for this case on purpose:
the one-item line is not a new thing and should not look like one. `1 item`
never appears anywhere, so the count segment never needs a singular form.

### Long date lists wrap. Nothing collapses, at any width, ever.

The Design Task asks how a long date list behaves at narrow widths and how that
interacts with the PNG. **The answer is that it behaves identically, because
nothing is ever hidden.** The metadata `<span>` is a normal wrapping block
inside a wrapping `<td>`; a group of twelve items wraps the date list onto as
many lines as it needs and the row gets taller.

**Forbidden, in the strongest terms this document can offer:** `text-overflow:
ellipsis`, `-webkit-line-clamp`, `max-height` + `overflow:hidden`, a horizontal
scroll container, a "+4 more" affordance, a tooltip holding the overflow, or any
disclosure the reader must operate. The PNG is the same DOM
(ADR 0014 §5) — the export rasterizes `#payslip-capture-node` and excludes only
`[data-payslip-export-exclude]`. Anything visually collapsed on screen is
collapsed **in the downloaded payslip**, which is the record a staff member is
handed. A truncated date list there is lost data in a financial document, and
criterion 7 ("the PNG shows the same grouped lines") would be satisfied in the
letter while failing in substance.

Taller rows are also free in the export: `toPng` is already pinned to
`node.offsetHeight` and already verifies the rasterized height against it
(`PayslipView.tsx:238-261`), so a long payslip is measured, not truncated.

---

## Interaction and states

Every state on this screen already ships and **none of them change**. Cited so
Dev does not re-derive them:

| State | Treatment | Already at |
|---|---|---|
| Default (payslip rendered) | the grouped rows above | — |
| Loading | `.payslip-loading` skeleton, `aria-busy="true"` | `PayslipView.tsx:362-372` |
| Empty range | `.payslip-empty` `role="status"`, no artifact, no download button | `:374-386` |
| No earnings in range | `.payslip-zone-note` — "No salary, commission, allowance, or bonus earnings fall inside this range." | `:465-470` |
| No advances in range | `.payslip-zone-note` — "No salary advances in this range." | `:526` |
| Submitting the range form | button label `Generating…`, `disabled` | `:344-350` |
| Preparing the PNG | button label `Preparing image…`, `aria-busy` on the artifact | `:411-419` |
| Download succeeded / failed | `.payslip-download-status` success / danger notice | `:567-580` |
| Range validation error | `.report-range-error` `role="alert"` | `:352-356` |

There is **no new interactive element**, no hover state, no focus target and no
tab stop added by this story. A grouped row is static text. Focus order inside
the artifact is unchanged (the `Download PNG` button remains the only control).

**No new live region.** The payslip appears in response to an explicit submit
and the grouping is not a separate async step; announcing group counts would be
noise. Do not add one.

---

## Responsive

Use the breakpoints `styles.css` already uses for the payslip — **1180px, 760px
and 540px**. (The Design Task names 480/767/1024; those are not this screen's
breakpoints. See *Findings*.)

The artifact is `width: min(760px, 100%); margin: 0 auto` and its zones get
`padding: var(--space-4)` side padding at ≤760px. Within that:

- **≥761px** — as specified above. Two-column table; the amount column takes
  what it needs (`nowrap`), the item column takes the rest and wraps.
- **≤760px** — no change needed. The narrower item column wraps the date list
  sooner, which is the intended behaviour, not a degradation.
- **≤540px** — the `@media (max-width: 540px)` block in `styles.css` converts
  **only `.payslip-daily-table`** to stacked `display:block` rows with
  `::before { content: attr(data-label) }`. `.payslip-artifact-table` is
  deliberately *not* in that block and must stay a two-column table: it is
  already a label/value pair, so stacking it would double the labelling. **Do
  not add `data-label` attributes to the grouped rows** and do not extend that
  block to `.payslip-artifact-table`.
- The amount column must keep `white-space: nowrap`. `₱1,500.00` breaking
  across lines inside a money column is the one thing narrow width could
  genuinely damage, and the shipped rule already prevents it.

No new media query is required by this story.

---

## Accessibility

- **The row stays one `<tr>` with two `<td>`s** in a two-column table. No
  nested table, no `rowspan`, no `<ul>` inside the cell, no `role` override.
  The Design Task asks how a screen reader reads "3 items, Oct 1, Oct 1, Oct 3"
  without nesting the table: it reads the cell's text run linearly, which is
  why the count segment is placed **before** the dates. "Transportation
  allowance, Allowance, 3 items, Sep 1, Sep 1, Sep 3" is self-describing — the
  listener knows a three-item list is coming and that the repetition is data,
  not a stutter. A list marked up as a list would add "list, 3 items, bullet…"
  verbosity inside a table cell for no gain.
- **A comma-joined text run, not list markup**, for the same reason. The middle
  dot separates the segments visually; screen readers pause on the surrounding
  spaces and most do not announce U+00B7 as a word.
- **Do not put an `aria-label` on the `<tr>` or the `<td>`.** It would replace
  the cell's own text, so the description — the thing that identifies the line —
  would stop being announced.
- The `<caption className="sr-only">` on each table (`Payslip earnings`,
  `Salary advances`) is unchanged and remains the only accessible name the
  tables need.
- Nothing distinguishes a grouped row by colour alone; the count is text. The
  muted metadata line is `var(--muted)` on `var(--surface)`, the shipped
  pairing for every secondary line in this artifact.
- Date text stays at the shipped 12px with no further reduction. If a design
  impulse arises to shrink the date list to fit, refuse it — 12px is already
  the floor in use here.

---

## Copy (exact strings)

Separator between segments: `" · "` (U+00B7 with a space either side).
Separator inside the date list: `", "`.

| Case | `<td>` text | `<span>` text | Amount |
|---|---|---|---|
| Allowance group, 3 items | `Transportation allowance` | `Allowance · 3 items · Sep 1, Sep 1, Sep 3` | `₱1,500.00` |
| Bonus group, 2 items | `Perfect attendance` | `Bonus · 2 items · Sep 15, Sep 30` | `₱2,000.00` |
| Allowance, 1 item | `Rice allowance` | `Allowance, September 1, 2026` | `₱800.00` |
| Bonus, 1 item | `Holiday bonus` | `Bonus, September 30, 2026` | `₱1,000.00` |
| Advance group, 2 items | `Cash advance` | `2 items · Sep 5, Sep 5` | `−₱1,200.00` |
| Advance, 1 item | `Cash advance` | `September 5, 2026` | `−₱600.00` |
| Multi-item group, range crosses a year | `Load allowance` | `Allowance · 2 items · December 28, 2026, January 3, 2027` | `₱400.00` |

- The description is **verbatim** as the API sent it — the spelling from the
  earliest-dated item, earliest-recorded on a tie (criterion 3). The browser
  does not trim, case-fold, title-case or truncate it. ADR 0014 §2.
- Money is pesos with two decimals from `formatMoney`; advances keep the
  shipped `−` prefix (U+2212 minus, not a hyphen) and `var(--danger)`.
- Count copy is always plural (`2 items`, `3 items`, …) because the segment is
  omitted at `itemCount === 1`.
- **No new empty, error, or notice string is introduced by this story.** Every
  zone note, validation message, and download message stays exactly as it is.

---

## Implementation handoff

### Inherited — not design opinions, already binding

- **Grouping and all sums are server-side** (ADR 0014 §3, task #454). The web
  task renders `summary.adjustmentGroups` and must not group, re-key, re-sort,
  de-duplicate, or sum anything in the browser. `totalCents` is displayed, never
  recomputed from the group's items.
- **`adjustments` stays on the contract** and keeps its current meaning
  (ADR 0014 §7). `hasPayslip` may keep reading it. The new field is additive.
- **One date entry per item, duplicates retained** (criterion 4). The view must
  not collapse `effectiveDates` — not with `Set`, not with a de-dupe, not
  visually.
- **Date entries are rendered in the order the API sent them** (ascending).
  Criteria 3 and 4 fix which dates and how many, not their order; the API
  guarantees ascending, so the view sorts nothing. QA may assert ascending.
- **Grouped-line order is the API's order** (criterion 4: earliest effective
  date, ties by earliest-recorded first item). The view renders
  `adjustmentGroups` in sequence and applies no sort of its own.
- **Totals are unchanged by grouping** (criterion 6). The category totals
  `<dl>`s, the earnings total and net payable keep their existing fields and
  code paths; a group total is never substituted for a category total.
- **The PNG is the screen** (ADR 0014 §5, criterion 7). The capture node stays
  the single `<article id="payslip-capture-node">`; no export-specific
  rendering, no second markup path, and nothing excluded from the export beyond
  the existing `data-payslip-export-exclude` download button.
- **Record / edit / delete are untouched** (criterion 8). `AdjustmentsView`
  keeps listing items individually; grouping is display-only and lives in
  `PayslipView` alone.
- **Accessibility (binding):** the grouped row carries its information as text,
  not colour or position; no `aria-label` replaces cell content; the sr-only
  captions stay; the table keeps its two-column semantics.
- **Admin-only**, via the shipped guards on `CompensationController`. Nothing
  here adds an authorization surface.

### Advisory — recommended defaults Dev may deviate from with reason

- The three-segment `<span>` (kind · count · dates) and the `" · "` separator.
- Omitting the count segment at `itemCount === 1`, and keeping that line's
  shipped `", "` separator so a singleton reads exactly as it does today.
- `'short'` dates for multi-item groups, `'long'` for singletons, and `'long'`
  for multi-item groups when the payslip range crosses a calendar year.
- Wrap-never-truncate for long date lists, and the explicit prohibition on
  ellipsis / clamp / scroll / disclosure. **This one is advisory in form only** —
  a collapsing treatment would drop data from the PNG, so a deviation here needs
  Tech Lead sign-off, not just a reason.
- Keying the row on `adjustmentIds[0]`.
- Not extending the ≤540px stacked-row block to `.payslip-artifact-table`.

### Proposed material change to a shipped class — one property

```css
.payslip-artifact-table td:first-child {
  padding-right: var(--space-4);
}
```

**Reason:** `.payslip-artifact-table th, td` ships `padding: var(--space-2) 0`,
so the item cell has zero horizontal padding. Today that is fine — the longest
item text is a short description plus one date. A wrapped multi-date list fills
the column to its edge and can sit flush against the right-aligned amount, which
reads as two numbers colliding at exactly the moment the row is hardest to scan.
One token-valued property on the first cell fixes it; the Salary and Commission
rows are unaffected in practice.

Dev may skip it if the rendered result is legible without it — it is a polish
change, not a correctness one. It names a token (`--space-4`), adds no class,
and does not touch the amount column.

No other change to a shared shell, component, or class is proposed. **No new
token is needed by this design.**

### Findings (for a human to decide, not for Dev to act on)

1. **Breakpoint mismatch in the Design Task.** #453 asks for the treatment "at
   the 480 / 767 / 1024 breakpoints". The shipped payslip CSS uses **1180px,
   760px and 540px**, and 480/767/1024 appear nowhere in the payslip section of
   `styles.css`. This spec is written against the shipped three. If the
   480/767/1024 set is meant to become this app's standard scale, that is a
   `styles.css`-wide reconciliation and far larger than #412.
2. **Uncommitted `styles.css` work was deliberately not relied on.** The working
   tree currently holds unstaged payslip changes — `container-type: inline-size`
   on `.payslip-view` plus `@container (max-width: 85rem)` and `60rem` rules for
   `.payslip-filter`. They are not in `HEAD`, so they are not shipped truth, and
   this spec is written against committed CSS. They affect the filter form, not
   either table, so the spec holds either way. Flagging it because a container
   query on the payslip's own width would be a *better* basis for the table's
   responsive behaviour than a viewport media query (the admin sidebar makes the
   viewport a poor proxy) — worth picking up if that work lands.
3. **`styles.css` and `tokens.json` remain out of sync**, as the charter notes:
   `--touch-min`, `--field-h`, `--cashier-key-size`, the `--logo-*` family and
   `--z-modal*` exist only in `styles.css`; `levelSelector.*` and `staffShell.*`
   exist only in `tokens.json`. Not caused by and not blocking #412 — recorded
   because this spec treats `styles.css` as shipped truth and a reader should
   know the two views disagree.
4. **The `.payslip-artifact-table` item cell is a `<td>`, not a
   `<th scope="row">`**, while `.payslip-daily-table` uses `<th scope="row">`
   for its row headers. The Design Task calls it "the row header cell". This
   spec leaves it as the shipped `<td>` — changing it is a markup change to
   rows this story does not otherwise touch, and it would alter how every
   existing payslip row is announced. Worth a deliberate decision someday;
   not inside #412.

### Alternatives considered and rejected

- **A count chip** (`.staff-page-heading-badge`, dashed `--border-strong` on
  `--surface-subtle`). Rejected on three grounds: it is a staff-page class and
  reusing it here couples two unrelated areas of the stylesheet; at 28px
  min-height and 750 weight it is visually heavier than the 12px muted line it
  would sit in, so it would draw more attention than the amount; and it solves
  nothing the text `3 items` does not already solve, while adding a second thing
  for the PNG to render. Plain text costs no CSS at all.
- **`Sep 1 (×2)` collapsed with a multiplier.** Rejected: criterion 4 requires
  one date entry per item, and the multiplier form is exactly the rendering the
  revised criteria ruled out.
- **A nested table or a `<ul>` of dates inside the cell.** Rejected for the
  screen-reader verbosity described above, and because the PNG would then carry
  a nested table's borders and spacing into a document that is deliberately flat.
- **A separate "Dates" third column.** Rejected: the table is a two-column
  item/amount pair across the whole artifact, including the Salary and
  Commission rows that have no dates, and a third column would need the
  ≤540px stacked treatment the artifact table deliberately avoids.
- **Showing both the group line and its items (expandable).** Rejected: the
  story's purpose is a shorter payslip, a disclosure control cannot exist in a
  PNG, and the itemized view already exists on `AdjustmentsView`.
