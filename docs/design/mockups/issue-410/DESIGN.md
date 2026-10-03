# Discrepancy confirmation dialog — Close business day

Story #410 · Design Task #428 · mode: **spec** (Tech Lead verdict — no Open
Design run)

Screen: `apps/web/src/trading-day/StaffTradingDayPages.tsx` →
`CloseBusinessDayPage`, route `/pos/close`. Nothing else changes.

## Design read

This story adds one thing to a screen that already works: a confirmation step
between pressing `Close day` and the day closing. Every figure the dialog shows
is already rendered on the page above the form — `PackagingSummary` for the cup
/ lid rows, `.staff-discrepancy` for cash — so the dialog is a **restatement of
what is already on screen**, filtered to the entries that do not balance. It
must therefore read as the same screen, in the same words, with the same colour
treatment. A second vocabulary for "short" would be the defect here.

Three decisions are made below and justified, because each had a defensible
alternative the Design Task asked to be chosen between:

1. the shell is **`.logout-dialog`**, co-classed, not `.inventory-modal`;
2. the discrepancy list is a **list, not a table** — the on-page table cannot
   fit in a dialog;
3. the variance classes must be **scoped**, because the bare `.variance-over` /
   `.variance-short` globals render in different colours than the close screen
   uses. This is the one real trap in the story and it is spelled out under
   *Findings*.

No new token is needed. No new component is needed. One new modifier class and
one new list block are, and both are deltas on shipped CSS rather than new
shells.

---

## Placement

The dialog is **not** part of the page's layout flow. It renders through
`createPortal(…, document.body)` exactly as `StaffLogoutControl` does
(`apps/web/src/auth/LogoutControls.tsx`), so the `.staff-inventory-workspace`
main element and the `.staff-close-layout` grid are untouched and the backdrop
can cover the staff shell header.

It is owned by `CloseBusinessDayPage` and gated inside `handleSubmit`, after the
existing `fieldErrors` early returns and before `closeBusinessDay()` — the
story's "validation first" criterion. The form markup above it
(`.staff-close-day-form`, its `.staff-close-form-grid`, the optional
`Discrepancy reason` textarea, `<FormMessages>`, and the
`.staff-inventory-actions` submit row) is unchanged.

The trigger is the existing submit button (`StaffTradingDayPages.tsx:1141`). It
gains the two attributes `SignOutButton` already sets when it opens a dialog:

```
aria-haspopup="dialog"
aria-expanded={confirmOpen}
```

Nothing else about that button changes; it keeps `type="submit"`, its
`disabled={isSubmitting}` and its `Closing day…` label.

---

## Components

### Shell — `.logout-dialog`, co-classed

Use the `.logout-dialog-backdrop` / `.logout-dialog` / `.logout-dialog-actions`
family (`styles.css:5955–6032`) as the base, co-classed with one new modifier:

```
<div class="logout-dialog-backdrop">
  <div class="logout-dialog close-confirm-dialog" role="dialog" …>
```

Co-classing a shipped shell with a screen-specific modifier is the established
pattern here — `AdjustmentsView.tsx:401` renders
`class="inventory-modal staff-modal compensation-modal adjustment-modal"` and
each modifier adds only its delta.

**Why `.logout-dialog` and not `.inventory-modal`.** `.logout-dialog` is the
only shipped *confirmation* dialog. Its actions row is exactly two buttons,
`flex: 1` each at `min-height: calc(var(--touch-min) + var(--space-1))`, with
the safe action first in DOM order and `.is-primary` second — which is this
dialog's action model with no change. `.inventory-modal` is a form shell: its
`.inventory-modal-actions` is a four-column `auto 1fr auto auto` grid built for
a delete / spacer / cancel / save row, and it carries `.inventory-modal-head`
and a `form` child with its own padding. Adopting it would mean replacing its
actions row and suppressing its head — more delta, for a shell whose purpose is
different.

**What the modifier must add.** `.logout-dialog` is sized for a fixed two-line
body (`width: min(100%, 420px)`, no `max-height`, no `overflow`). This dialog's
body is unbounded — one entry per reconciled cup / lid item, plus cash. So
`.close-confirm-dialog` adds, and nothing else:

- `width: min(100%, 520px)` — wider than 420px because each entry carries three
  labelled figures; narrower than `.inventory-modal`'s 560px and
  `.cashier-dialog`'s 760px because there is still only one column of content;
- `max-height: calc(100svh - var(--space-8))`, the cap `.cashier-dialog`
  already uses (`styles.css:6304`);
- `display: grid; grid-template-rows: auto auto 1fr auto; gap: var(--space-4)`
  so the heading, the admin-visibility line and the actions are fixed and the
  **list is the only scrolling child**;
- on the list block: `overflow-y: auto; overscroll-behavior: contain`.

Scrolling the list rather than the panel is what keeps `Close day anyway` and
`Go back` on screen with many entries. `.inventory-modal` scrolls the whole
panel, which would push both actions below the fold.

> `.cashier-dialog` caps with `100svh` and `.inventory-modal` with `100dvh`.
> Prefer `svh`: on a staff tablet with browser chrome that hides on scroll,
> `dvh` makes the panel resize mid-interaction. See *Findings*.

### Entry list — new block, `.close-confirm-list`

A `<ul>`, one `<li>` per discrepancy, cash first, then the cup / lid entries in
`summary.packaging` order (the order `PackagingSummary` already renders, so the
dialog and the table agree row for row).

Each `<li>` is:

- `<p class="close-confirm-entry-name">` — the entry name;
- `<dl class="close-confirm-entry-figures">` — labelled figures as
  `<div><dt>…</dt><dd>…</dd></div>` groups, the same `dl`-of-`div` shape
  `.staff-cash-summary` uses (`StaffTradingDayPages.tsx:650`).

Cash carries **one** figure group (`Balance`). Cup / lid entries carry **three**
(`Expected`, `Actual`, `Balance`). Styling: `--space-3` gap between entries, a
`1px solid var(--border)` top border on `li + li`, `--muted` at 12px / 650 for
the `<dt>` labels, and `font-variant-numeric: tabular-nums` on the `<dd>`s —
every value a token, matching `.staff-discrepancy > span` and
`.staff-packaging-table td`.

**Why a list and not the table.** `.staff-packaging-table table` is declared
`min-width: 700px` (`styles.css:7474`) and is paired with a
`.staff-table-scroll-hint` that appears below 767px. A 520px dialog cannot host
it, and nesting a horizontally scrolling region inside a vertically scrolling
dialog is poor on touch. Separately, a four-column table cannot carry both
entry kinds without empty cells: cash has no expected or actual quantity. The
list stacks figures per entry, so cash renders with one figure and a cup / lid
item with three, in the same visual rhythm.

### Reused value vocabulary — do not re-derive

The dialog must call the page's own helpers for every string:

| Figure | Helper | Example output |
|---|---|---|
| cash balance | `discrepancyText(discrepancyCents, actualCash)` | `▴ Over ₱120.00`, `▾ Short ₱45.50` |
| cup / lid expected | `packagingExpected(row)` | `480`, `— no opening count` |
| cup / lid actual | `packagingActual(row, summary.hasClosingStockCount)` | `455`, `— no closing count`, `— not in count` |
| cup / lid balance | `packagingVariance(row)` | `▾ Short 25`, `— needs both counts` |

Those helpers are currently module-private but already pure and already used by
both `PackagingSummary` and the form. The `▴` / `▾` glyphs and the words
`Over` / `Short` come from them, so the dialog cannot drift from the table
behind it.

The `— needs opening count` / `— needs closing count` / `— needs both counts`
strings are what satisfies the story's "balance is shown as unknown rather than
over or short", and they also satisfy QA's note that *which* count is missing
stays recoverable from the row. The dialog does not substitute the literal word
"unknown"; `packagingVariance()` already says more while meaning the same, and
the expected / actual columns independently show their own missing-count text.

### Figure classes — scoped, mirroring the table

Apply the same class logic `PackagingSummary` uses
(`StaffTradingDayPages.tsx:707–726`), and `discrepancyClass()` for cash:

| Cell | Class |
|---|---|
| cash balance | `discrepancyClass(discrepancyCents)` → `over` / `short` |
| expected, `expectedQty === null` | `unknown` |
| actual, `actualQty === null` | `unknown` |
| balance, `varianceQty === null` | `unknown` |
| balance, `varianceQty < 0` / `> 0` | `variance-short` / `variance-over` |

These must be scoped under `.close-confirm-list` with the **same declarations
the staff table uses** — `--warn-ink` for both directions, `--muted` for
`unknown` — not left to inherit the global `.variance-over` / `.variance-short`
rules at `styles.css:4018–4024`. Those globals are `--focus` (green) and
`--danger` (red). See *Findings*; this is the one place a correct-looking
implementation renders the wrong thing.

`variance-balanced` never appears: balanced entries are not listed.

---

## Interaction

### States

| State | Trigger | What the user sees |
|---|---|---|
| **Closed (no dialog)** | `Close day` pressed, no discrepancy | No dialog. The close request fires directly, as today. |
| **Field-invalid** | `Close day` pressed, actual cash or Closed by missing | No dialog. Existing `Field` errors render and `focusField()` moves focus to the first one — today's behaviour, unchanged. |
| **Open** | `Close day` pressed, form valid, ≥1 discrepancy | Backdrop over the page; panel with heading, admin-visibility line, the discrepancy list, two actions. Focus on `Go back`. Page behind cannot be scrolled or reached. |
| **Submitting** | `Close day anyway` pressed | Dialog stays open. Both buttons `disabled`; the primary shows the spinner and `Closing day…`. The form's own submit button is also disabled (`isSubmitting`). Backdrop click and Escape are inert while busy. |
| **Success** | close request resolves | Dialog unmounts. The page switches to its existing closed branch — `.staff-close-success` "Business day closed." and `LatestClosingPanel`. |
| **Failed** | close request rejects | Dialog unmounts. The existing error renders in `<FormMessages>` on the form, with everything entered retained. Focus returns to `Close day`. |
| **Dismissed** | `Go back`, Escape, or backdrop | Dialog unmounts. Nothing entered is lost. The day is not closed. Focus returns to `Close day`. |
| **Re-opened** | `Close day` pressed again, discrepancy remains | Dialog opens again, recomputed from the current values. Not remembered, not suppressed. |

### Pinned behaviours

- **Where the failure error lands.** The dialog is dismissed when the request
  resolves, success or failure, and a failure's message appears in
  `<FormMessages>` on the form behind — the location the close error already
  uses (`StaffTradingDayPages.tsx:1139`). That block carries `role="alert"`,
  so mounting it announces the failure even though focus has returned to the
  `Close day` button. The dialog gets **no error region of its own**; the
  shipped `.logout-dialog-error` class is deliberately not used, so there is
  exactly one place a close error can appear. (This pins the reading QA
  recorded on #410 and the Design Task asked to settle.)
- **In-flight, not re-entrant.** `Close day anyway` is disabled while
  `isSubmitting`, so a second press cannot submit. Escape and the backdrop are
  also inert while busy — `.logout-dialog`'s `close()` already early-returns on
  `busy`, which is the behaviour to copy, not re-derive.
- **The dialog never touches `clientGeneratedId`.** Opening, dismissing or
  re-opening it must not call `resetAttemptId()`. That ref is reset only by the
  three input `onChange` handlers (lines 1066 / 1100 / 1122) and must stay that
  way, or a `Go back` → `Close day anyway` cycle mints a second attempt id for
  one close and breaks the replayable-write convention. The dialog is a view
  over existing state and owns no submission identity.
- **The reason field stays outside.** The optional `Discrepancy reason`
  textarea stays on the form, keeps its value across a dismissal, and remains
  optional. The dialog contains no reason input and no acknowledge checkbox.
- **One entry renders as a list of one.** There is no special-cased single
  layout. `max-height` is a cap, so the panel shrinks to its content and a
  one-entry dialog is short. The heading copy is written to read correctly for
  one entry and for many.
- **A day with no closing count lists every item.** With
  `summary.hasClosingStockCount` false, every reconciled item's `actualQty` is
  null, so each one is an entry reading `— no closing count` /
  `— needs closing count`. That is the predicate working as specified, and it
  is the case the scroll container exists for. The page's existing
  `.staff-closing-advisory` already warns above the form, so the dialog adds no
  second warning about it.

---

## Responsive

The shipped breakpoints on this screen and this shell are **1000px** (where
`.staff-close-layout` collapses to one column, `styles.css:7622`) and **767px**
(where `.logout-dialog` becomes a bottom sheet and
`.staff-table-scroll-hint` appears, `styles.css:7660`). There is no 480px rule
for either; do not introduce one.

| Width | Treatment |
|---|---|
| ≥ 1000px | Panel centred at `min(100%, 520px)`. List scrolls within the `100svh − var(--space-8)` cap. |
| 1000–768px | No change. The dialog does not depend on the page grid, so the close layout collapsing behind it is invisible. |
| ≤ 767px | Inherit `.logout-dialog`'s shipped bottom-sheet treatment unchanged: backdrop `align-items: end; padding: 0`, panel `width: 100%`, padding `var(--space-5) var(--space-4)`, radius only on the top corners. The modifier's `max-height` cap and the list's own scroll both still apply, so the two actions stay pinned at the bottom of the sheet — which on a phone is where the thumb already is. |

Both actions keep `.logout-dialog-actions button`'s
`min-height: calc(var(--touch-min) + var(--space-1))` and `flex: 1` at every
width, so each is at least the `--touch-min` target. Nothing stacks, nothing
drops; only the list scrolls.

Reduced motion: add `.close-confirm-dialog` beside `.logout-dialog` in the
existing `@media (prefers-reduced-motion: reduce)` block
(`styles.css:7800`) — or rely on it, since the co-class means
`.logout-dialog { animation: none }` already matches this element. No new rule
is needed; stated so nobody adds one.

---

## Accessibility

Copy `StaffLogoutControl`'s implementation. It already does all of this and is
the pattern to cite rather than re-derive.

- `role="dialog"`, `aria-modal="true"`, `tabIndex={-1}` on the panel.
- `aria-labelledby` → the heading's id, `aria-describedby` → the
  admin-visibility paragraph's id. Suggested ids
  `close-confirm-title` / `close-confirm-description`, matching the
  `logout-dialog-title` / `logout-dialog-description` convention.
- **Initial focus: `Go back`.** Set via `queueMicrotask(() => …focus())` on
  open, as `cancelRef` is. The close is irreversible, so the safe action takes
  focus and a reflex Enter or Space cannot close the day. DOM order is
  `Go back` then `Close day anyway`, so the destructive action is never the
  first tab stop.
- **Focus trap** in the panel, cycling between the enabled buttons, via the
  `Tab` / `Shift+Tab` handling in `LogoutControls.tsx`. While submitting both
  buttons are disabled and focus moves to the panel itself — `LogoutControls`
  already does this (`useEffect` on `busy`), and it is what keeps focus off a
  disabled control.
- **Escape = `Go back`**, `event.preventDefault()`, inert while busy.
- **Backdrop** dismisses on `onMouseDown` when `event.target ===
  event.currentTarget`, so a drag that starts inside the panel and ends outside
  does not dismiss. Same guard as the shipped shells.
- **Modality.** `document.body.style.overflow = 'hidden'` while open, restored
  on unmount — this plus `aria-modal` is what makes the form behind unusable.
  Serve the portal from `document.body` so the panel is not inside the
  `#staff-main` subtree.
- **Focus return** to the `Close day` button on every exit — dismissal, success
  and failure. On success that button unmounts with the form; React then falls
  back to `document.body`, so move focus to the `.staff-close-success` heading
  region instead, or leave the existing closed-branch behaviour alone if it
  already announces. Worth checking during implementation; it is the one focus
  path the shipped precedent has no equivalent for.
- The list is a real `<ul>` of `<li>`, each with a `<dl>` of label / value
  pairs, so a screen reader reads "Expected 480, Actual — no closing count,
  Balance — needs closing count" per entry. The `▴` / `▾` glyphs sit inside the
  same text node as the words `Over` / `Short`, exactly as on the page today —
  direction is never conveyed by colour or glyph alone, which is the
  non-colour discrepancy treatment #123 pinned for this screen
  (`docs/ui-reconciliation.md:71`).
- No `aria-live` region inside the dialog. Its content does not change while it
  is open; the dialog's appearance is itself the announcement. The form's
  existing `.staff-discrepancy` live region is behind the dialog and its value
  does not change while the dialog is open.

---

## Copy

Exact user-facing strings.

**Heading** (`<h2 id="close-confirm-title">`):

> Close the day with these discrepancies?

**Admin-visibility line** (`<p id="close-confirm-description">`):

> These discrepancies will be recorded with the close and visible to
> administrators in the daily reconciliation and cup / lid reports.

One sentence, in the panel's `--ink-soft` body style via `.logout-dialog > p`.
A statement of fact, not a warning banner, and it demands no acknowledgement.

**Cash entry name:**

> Cash in drawer

**Figure labels** (`<dt>`): `Expected`, `Actual`, `Balance`.

Cup / lid entry names are `row.itemName` verbatim.

**Values** come from the helpers in the table above, unchanged — money as
`formatMoney()` renders it (`₱1,234.50`), quantities via `quantityText()`.

**Actions:**

| Button | Label | Busy label |
|---|---|---|
| secondary, first, focused | `Go back` | — (disabled) |
| primary (`.is-primary`) | `Close day anyway` | `Closing day…` |

`Closing day…` matches the form's own submit button exactly, so the in-flight
wording does not change depending on which control started the close. Render it
as `.logout-dialog`'s primary does: a `.button-loading` span wrapping the
`.spinner` and the text.

No empty state: the dialog does not open with zero entries. No loading state:
every figure is already in the browser.

---

## Findings

**1. `.variance-over` / `.variance-short` mean two different colours depending
on scope.** The globals at `styles.css:4018–4024` are `--focus` (green) and
`--danger` (red) — the admin report vocabulary. The staff close screen
overrides both to `--warn-ink` under `.staff-packaging-table`
(`styles.css:7494`), and `.staff-discrepancy strong.over` / `.short` likewise
(`styles.css:7607`). The close screen is deliberately not colour-coding
direction — that is the "non-colour discrepancy text" verdict recorded for
`/pos/close` at `docs/ui-reconciliation.md:71`. A dialog that applies the bare
class names therefore renders green and red and silently reverses a settled
decision. The dialog's rules must be scoped under `.close-confirm-list` and
declare `--warn-ink` for both directions. Flagging rather than fixing: whether
those four class names should be renamed so scope is not load-bearing is a
human call, not a design-lane one.

**2. `.unknown` and `.variance-balanced` are not global at all.** Both exist
only under `.staff-packaging-table` (`styles.css:7488`, `7500`). An
implementation reusing `.unknown` in the dialog gets no styling whatever —
colour and size both come from that scope. Hence the explicit requirement above
to restate the declarations under `.close-confirm-list`.

**3. The max-height unit is inconsistent across shipped dialogs, and the
spacing scales are out of sync.** `.inventory-modal` uses
`calc(100dvh - 40px)`, `.cashier-dialog` uses `calc(100svh - var(--space-8))`.
Recommending `svh` here for the reason given above; which way the two shipped
shells should reconcile is a human call. Separately, that `40px` is a raw
literal *because the step is missing from `styles.css`*: `tokens.json` carries
`space.10` (40px) and `space.12` (48px), and `styles.css` stops at
`--space-8`. So the 40px is exactly the absent token, and it cannot be bound
until `--space-10` is added. This dialog needs neither step — it is specified
entirely in `--space-1` … `--space-8` — so no value is invented here; the gap
is in the two sources.

**4. Modal z-index has no token in `tokens.json`.** `styles.css` carries
`--z-modal-backdrop: 30` and `--z-modal: 40` (`styles.css:46–47`) and both
shipped dialogs use them, but `tokens.json` has no `zIndex` group at all, so
the design-side source cannot express layering. `--touch-min` and `--field-h`
*are* now present as `control.minimumTouchTarget` / `control.fieldHeight`, so
this is a narrower gap than the design lane's standing note describes. No value
is invented here — the dialog uses the shipped variables; the gap is in the
token file.

**5. Backdrop tints are hard-coded and differ per dialog.**
`.logout-dialog-backdrop` is `oklch(18% 0.02 240 / 0.52)`,
`.inventory-modal-backdrop` is `oklch(15% 0.015 240 / 0.46)`, and there is no
scrim token in either source. The dialog inherits `.logout-dialog-backdrop`
unchanged, so this design introduces no new literal — but a `color.scrim` token
is the obvious fix and needs a human decision.

**6. `trapDialogFocus` is duplicated.** The same helper is defined privately in
`CompensationPage.tsx:55` and `AdjustmentsView.tsx:63`, and
`LogoutControls.tsx` has a third variant with its own `focusableButtons`.
Implementing this dialog is the fourth site. Extracting one shared helper is an
application-code call and outside this lane's write scope; noted so the Tech
Lead can decide on #429 rather than discovering it in review.

---

## Implementation handoff

### Binding — inherited from the story, ADRs and accessibility

These are not design recommendations. They come from #410's acceptance
criteria, the ADRs, or accessibility obligation, and hold regardless of how the
dialog looks:

- The dialog appears only when a discrepancy exists, and only after the
  existing field validation passes.
- A discrepancy is cash `!== 0`, any `varianceQty !== 0`, or any
  `varianceQty === null`. Only discrepancies are listed.
- Expected shows unknown when the opening count is missing; actual when the
  closing count is missing; both when both are; and the balance is unknown
  rather than over or short whenever either is missing.
- The dialog states that discrepancies will be visible to administrators.
- It is modal; Escape and backdrop behave as `Go back`; `Go back` loses nothing
  and does not close the day.
- A second `Close day` re-evaluates: dialog again if a discrepancy remains,
  direct close if none does.
- No reason field inside the dialog; the form's optional one stays optional.
- `Close day anyway` runs the existing close and cannot be submitted twice
  while in flight. On failure the day stays open, the existing error shows, all
  entered values are retained, and a retry must not create a duplicate
  day-close record — so `clientGeneratedId` must not be reset by dialog
  open / dismiss (ADR 0001 idempotent sale/close writes).
- `role="dialog"`, `aria-modal="true"`, labelled heading, trapped focus,
  focus returned on dismissal, and direction conveyed in text as well as
  colour.
- No new endpoint, no migration, no `packages/shared` change — the Tech Lead's
  frontend-only mapping stands; every figure is already client-side.

### Advisory — this design's recommendations

Dev may integrate these differently with a note; none is an acceptance
criterion:

- `.logout-dialog` as the base shell over `.inventory-modal`, co-classed with
  `.close-confirm-dialog`.
- 520px panel width; `100svh − var(--space-8)` cap; grid rows with the list as
  the only scrolling child.
- A `<ul>` + per-entry `<dl>` instead of a table, and cash first in the list.
- Initial focus on `Go back`; DOM order `Go back` then `Close day anyway`.
- The dialog dismissing on both success and failure, with the close error
  landing in the form's `<FormMessages>` rather than inside the panel.
- All copy in the *Copy* section, including the heading's "with these
  discrepancies?" phrasing and the exact admin-visibility sentence.
- Reusing `discrepancyText()` / `packagingExpected()` / `packagingActual()` /
  `packagingVariance()` rather than new formatters. Strongly advised: it is
  what keeps the dialog and the table behind it in one vocabulary.

### Proposed material changes to shared shells or components

Two, both additive, neither altering an existing shipped element's rendering:

1. **`.close-confirm-dialog` modifier on `.logout-dialog`** — adds width,
   `max-height`, a grid body, and the scroll container. *Why:* `.logout-dialog`
   is sized for a fixed two-line body and this dialog's body is unbounded. A
   modifier confines the change to this screen; editing `.logout-dialog`
   directly would resize the shipped sign-out dialog too.
2. **`.close-confirm-list` block with scoped figure classes** — a new list
   block restating the `.staff-packaging-table` declarations for `.unknown`,
   `.variance-short`, `.variance-over`. *Why:* those classes are scoped, not
   global, and the global fallbacks are the wrong colours (Finding 1). The
   alternative — widening `.staff-packaging-table`'s selectors to cover the
   dialog — couples a table rule to a dialog and is worse.

No shared component's props or markup change. `StaffLogoutControl` is cited as
a pattern, not modified; the dialog gets its own implementation in
`StaffTradingDayPages.tsx` beside the page that owns it.

A static layout fragment using only shipped classes and tokens is beside this
file as `dialog-fragment.html`. The spec is the deliverable; the fragment is
there because the per-entry figure rhythm is easier to see than to read.
