# DESIGN — Open / Close business day

UCM Coffee Studio · staff POS workspace · issue-123
**Preserve-mode extension.** Eight mockups already shipped in this system. No
new visual language was introduced.

Dials: `DESIGN_VARIANCE 4` · `MOTION_INTENSITY 3` · `VISUAL_DENSITY 6`.

---

## 0. The three pinned decisions

A downstream dev task builds to these, so they are settled here rather than left
open. Each is stated as the exact rendering, then the reasoning.

### 0.1 The change-owed row — exact copy

| Slot | Exact string |
|---|---|
| Row label | `Change owed (still in drawer)` |
| Sub-line under the label | `Change a customer is owed but has not been handed yet. It is still physically in the drawer, so you will count it.` |
| Operator | `+` |
| Position | Row 8 of 9, immediately above `Expected cash` |

The brief's working label was `Change owed (in drawer)`. Shipped copy is
`Change owed (still in drawer)`. The word **still** is doing the work: it tells
an unfamiliar staff member that this is money on its way out that has not left,
which is the entire reason the row exists. Without *still*, "in drawer" reads as
a category name and the row looks like a second float.

The sub-line is mandatory, not optional polish. This row has no precedent in the
shipped build, so it is the one row on the screen where a staff member has no
prior mental model to fall back on. It is also the only row carrying an
explanatory sub-line other than `Cash float` and `Online sales (excluded)` — the
three rows that are not self-evident. Every other row is a bare label.

**Placement.** Last before the total, and given `.row-highlight`: a
`--surface-subtle` fill and a 3px `--border-strong` inset bar on the leading
edge. It is the newest and least familiar row, and it sits directly against the
number it modifies, so the reason it changes the total is one line of eye travel
away. The highlight is a neutral token, not `--accent`: this row is not an
affirmative state, it just needs to be found.

### 0.2 Short / over discrepancy — exact rendering

The shipped build renders `₱-0.50`. That is rejected. A minus sign wedged
between the currency symbol and the digits is easy to miss on a tablet held at
arm's length, and it makes direction a punctuation detail rather than a word.

Shipped rendering, three cases:

| Case | Rendering | Container |
|---|---|---|
| Balanced | `Balanced` + `₱0.00` | `--accent` tinted, `--accent-pressed` label |
| Short | `▾ Short` + `₱4.50` + `Drawer holds less than expected.` | `--warn-*` |
| Over | `▴ Over` + `₱1.25` + `Drawer holds more than expected.` | `--warn-*` |

Rules that fall out of this:

- **The amount is always unsigned.** Direction is carried by the word `Short` or
  `Over`, set in uppercase 12px/800 with `0.07em` tracking above the amount. A
  word cannot be misread the way a 1px minus stroke can.
- **The caret is redundant reinforcement, never the only signal.** `▾` and `▴`
  are `aria-hidden`; a screen reader gets "Short ₱4.50". They are static glyphs,
  not motion.
- **Zero is `₱0.00`, never an em dash.** A counted drawer that lands exactly on
  expected is a real result, not a missing figure.
- **The note line names the drawer, not the maths.** "Drawer holds less than
  expected" is checkable against the thing in front of the staff member.
- The same word pair carries the cup/lid `Var` column: `▾ 4 short`, `▴ 2 over`,
  `0`. One vocabulary for both reconciliations.

**Why not `--danger` / `--accent` for the pair.** Both readings are wrong.
`--accent` is reserved in this system for action, selection, focus and
affirmative state; an overage is none of those — it usually means a sale was
mis-keyed. And a shortage of ₱4.50 from change given is routine, not an error
condition; dressing it in `--danger` next to genuine validation errors that use
the same token would flatten the difference between "your day did not close" and
"the drawer is off by small change". Both directions therefore use the single
additive `--warn-*` family, and direction is carried entirely by the word. Only
`Balanced` earns `--accent`, because balanced *is* an affirmative state.

### 0.3 Does the em dash survive next to a legitimate zero?

**No, not on its own.** A bare `—` is rejected.

Tested by putting the cases in the same column, adjacent, in the shipped table:

```
Item              Expected           Actual              Var
12 oz hot cup     240                236                 ▾ 4 short
16 oz cold cup    — no opening count 180                 — needs both counts
12 oz sip lid     0                  0                   0
16 oz dome lid    150                — not in count      — needs both counts
8 oz espresso cup 96                 98                  ▴ 2 over
```

Row 3 is a genuine counted zero sitting between two unknown rows. In a
right-aligned, tabular-nums, 14px dense column, a lone `—` and a lone `0` are
both a single short glyph at the same optical weight and the same position. A
staff member scanning the column reads glyph shape, not glyph identity. The
distinction does not survive.

**Shipped treatment.** The em dash is kept as the marker but it never travels
alone — it always carries its reason inline:

```html
<span class="unknown">
  <span class="dash" aria-hidden="true">—</span>
  <span class="why">no opening count</span>
  <span class="sr-only">Unknown: no opening count</span>
</span>
```

- Unknown cells are `--muted` at weight 500; real quantities are `--fg` at
  weight 600 with `tabular-nums`. Colour and weight separate them before the
  glyph does.
- The reason is 11px lowercase, deliberately not a number shape, so the cell has
  a visibly different silhouette from a numeral.
- The reason strings are specific, not generic: `no opening count`,
  `no closing count`, `not in count`, `needs both counts`. They tell the staff
  member which count to go do.
- Screen readers get `Unknown: no opening count`, never a naked dash.

This is what makes the fix to the shipped `-1` defect complete. Rendering `-1`
was wrong because it was a quantity. Rendering `0` would be worse, because it is
a *plausible* quantity. Rendering a bare `—` is better but still not readable
in-column. The reason label is the part that actually works.

---

## 1. What was inherited unchanged

- Compact top bar with shop identity, `Staff` role tag, signed-in staff,
  business date, and context chips. Full-width, capped at 1440px.
- Flat horizontally-scrollable nav; `aria-current="page"` on the active entry.
- Skip link first in the document.
- Panels: `--surface` on `--bg`, 1px `--border`, `--radius-panel`, 24px padding.
- 48px field height, ≥44px touch targets, 3px `--focus` ring at 2px offset,
  control shadows capped at 5px blur.
- 32px content padding, 16px below 768px.
- Weight-led type. No display face, no second family — `--font` throughout, and
  hierarchy comes from weight (500/600/700/800) and size, which is what the
  shipped inventory screens do.

**This is not the back office.** No 232px sidebar, no card-per-metric dashboard
grid, no elevation stack. It is a full-bleed counter surface with a horizontal
nav, and the two screens are built as a linear top-to-bottom sequence a standing
staff member works down.

## 2. Nav placement

```
Open Day │ Take Order │ Order History │ Cash & Expenses │ Close Day ┊ Opening │ Closing │ Restock │ Deliveries & wastage
   ▲          (v1)          (v1)             (v1)            ▲
 shipped now                                             shipped now
```

The eventual v1 flat order is Open Day / Take Order / Order History / Cash &
Expenses / Close Day, then the inventory group. The two new entries are placed
at the two ends of that run **now**, with the three unbuilt slots rendered
in-position and inert (`aria-disabled="true"`, muted, weight 500, no hover). When
Take Order, Order History and Cash & Expenses land they replace inert entries in
place: no re-layout, no reordering, no change to the day-shape story the nav
tells left-to-right. A hairline `.nav-sep` divides the day/order group from the
inventory group.

Inert entries are still keyboard-reachable and still announce their state, so
the nav does not lie about what exists.

## 3. Screen 1 composition

**Form state.** One panel, `Day setup`, four fields on an
`auto-fit / minmax(240px, 1fr)` grid — two columns on a landscape tablet, one
below 768px. Day type is a `fieldset`/`legend` with two 48px radio cards rather
than a select, because it is a two-way choice made every single morning and a
select would cost a tap and hide the options. Selection uses `--accent` fill at
6% plus a 1px inset ring — the same selection language as elsewhere.

Required fields carry an explicit `Required` tag in `--danger` on
`--danger-surface`. It is small (10px/800, `0.08em`) and it appears on all four,
so it reads as a field property rather than an alarm.

**Summary state.** A distinct component, not the form with fields disabled. A
`--accent` tinted header carrying the `DAY OPEN` badge, the long date and the
day-type chip; then a five-cell hairline `dl` grid; then a footer.

The footer is the answer to "does the absence of a button read as deliberate":

> Take orders and record cash against this day; close it at end of shift.
> *This day is already set. Its date, type, float and opener are fixed for the
> rest of the shift, so there is nothing to submit here. Closing happens on
> Close Day.*

The second sentence names what is fixed, says explicitly that there is nothing
to submit, and hands off to where the next action lives. The panel closes with a
filled `--surface-subtle` footer rather than trailing off into whitespace, so it
terminates visually — an unfinished form ends in a button, and this ends in a
statement.

## 4. Screen 2 composition

Four stacked panels in the order the work happens: advisory (conditional) →
cup/lid balance → cash summary → count and close. Vertical order is the
procedure; there is no two-column split, because a staff member holding a tablet
in one hand and notes in the other works down, not across.

**Advisory banner.** `--warn-surface` fill, `--warn-border` 1px border, 4px
`--warn-border` leading bar, `--warn-ink` heading. Full panel width, above the
reconciliation, with an `Advisory` tag inline in the heading. It uses the same
structural shape as the error panel (leading bar, bold heading, body) so it is
impossible to skim past — and a completely different hue from `--danger`, plus
an explicit second line, *"You can still close the day without it."* That
sentence is what stops it reading as a blocker.

`--danger` is the wrong token because red on this surface means "your submission
failed and nothing changed". Proceeding past this banner is a legitimate,
supported choice.

**Tables.** Real `<table>` in a `.table-scroll` region with `overflow: auto`,
`tabindex="0"`, `role="region"` and an accessible name, so keyboard users can
scroll it. `thead th` is `position: sticky; top: 0`. The wrapper caps at 420px
so long item lists scroll inside the panel rather than pushing the close action
off screen. Below 768px a `.scroll-hint` line appears; the table keeps its
comparison structure and scrolls sideways instead of collapsing into stacked
cards, because a variance table that cannot be read column-against-column is not
a variance table.

**Empty state** for no reconciled items: dashed `--border-strong`, centred,
naming what is absent and how to change it. Never placeholder rows.

## 5. The `−₱0.00` question — decided: keep the sign

The shipped build renders a zero cash-out as `−₱0.00`. **Kept**, with one
change: the sign is rendered as a separate fixed-width `.op` span before the
amount, not concatenated into the money string.

Reasoning. The sign in the cash summary is a property of **the row**, not of
**the value**. `Cash out` subtracts from expected cash whether today's cash out
is ₱0.00 or ₱850.00. If the sign disappeared at zero, the row's direction would
flicker with its data, and a staff member scanning the column for what adds and
what subtracts would get a different answer on a quiet day than on a busy one.
Odd-looking is a cheap price for a column that always means the same thing.

Two supports so it does not read as a typo:

- The label carries the direction too — `Cash out (−)`, `Expenses (cash) (−)` —
  exactly as specified. Label and value agree.
- `.op` is fixed-width (`1.4em`) and `.op--minus` is `--danger`-tinted, so the
  minus rows form a visible vertical run down the column. Direction is legible
  as a column pattern, not just per-row.

`Cash float` and `Online sales (excluded)` get a blank operator: the float is the
starting point, not an adjustment, and the online row explicitly contributes
nothing. The blank is deliberate and the label says why.

Screen readers get `minus ₱0.00` / `plus ₱0.00` via an `sr-only` word, since a
lone `−` glyph is announced unreliably.

## 6. Money

Formatted from **integer cents** everywhere, via one `peso(cents)` function. No
floats. The only string-to-number conversion is `parseMoneyToCents`, which
accepts `^\d+(\.\d{1,2})?$`, rejects everything else, and returns an integer.
It distinguishes three outcomes the UI needs to tell apart: `null` (not
entered), `NaN` (entered but invalid), and an integer (valid, possibly zero).

## 7. Motion

`MOTION_INTENSITY 3`. One 140ms `fade-in` on state entry — the error panel, the
advisory, the day-open summary and the blocking panel. Nothing else animates:
no hover transitions, no scroll reveals, no loading spinner. The in-flight state
is a disabled button with changed label plus a text note, because a staff member
needs to know whether to press again, and a spinner does not answer that.
`prefers-reduced-motion: reduce` collapses the fade.

## 8. Accessibility

- Landmarks: `header`, `nav[aria-label]`, `main[tabindex="-1"]` as the skip
  target.
- `role="status" aria-live="polite"` per screen for validation results and state
  changes; the discrepancy readout is its own `output` with a polite live
  region, so the live value is announced without re-announcing the whole form.
- Invalid fields get `aria-invalid` and `aria-describedby`; focus moves to the
  first invalid control on failed submission.
- Errors are never colour-only: a `!` marker, a bold heading, a leading bar and
  the field-level text all carry the state.
- All interactive targets ≥44px; 48px for anything in the primary flow.
- Contrast: `--fg` on `--surface` ≈ 14:1; `--muted` on `--surface` ≈ 5.5:1;
  `--warn-ink` on `--warn-surface` ≈ 6.4:1; white on `--accent` ≈ 4.6:1 at the
  ≥16px/700 button size. All pass AA for their size.

## 9. Error copy convention (inherited, applied to both screens)

Order is fixed: **what did not happen → what remained unchanged → the specific
problems → what to do next.**

Open:
> **No business day was opened.**
> Nothing changed. There is still no open day, no cash float on record, and no
> orders or cash can be taken yet.
> · Business date is empty.
> · Day type was not chosen.
> Fix the fields marked above, then press Open day again.

Date already used:
> · **Jul 22 2026** already belongs to a closed business day.

Close:
> **No business day was closed.**
> Nothing changed. The day is still open, the drawer count was not recorded, and
> the cup/lid variances were not snapshotted.

The empty-money case names the escape hatch explicitly — *"Enter **0** if the
drawer starts empty"* — because zero is valid on both screens and a staff member
who leaves the field blank is usually trying to say zero.

## 10. Required vs optional treatment

The shipped build leaves `Closed by` looking optional. Fixed. All four open-form
fields and both required close-form fields carry the `Required` tag; the
discrepancy reason carries an `Optional` tag in `--muted` on `--surface-subtle`.
Both states are labelled, so silence never has to be interpreted.

The reason field stays optional at every discrepancy value. Making it
conditionally required would stall the close on a shift change, and a required
free-text field reliably produces `.` as its value.
