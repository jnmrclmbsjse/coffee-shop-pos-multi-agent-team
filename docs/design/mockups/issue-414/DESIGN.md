# Base salary and suggested daily amounts

Design reference for story **#414**, Design Task **#448**.
Mode: **`spec`** (Tech Lead verdict — both surfaces already ship).
Baseline read: `origin/master` at `975e366`. All line numbers below are that
revision.

Binding documents: the story's Acceptance Criteria, **ADR 0017**
(`docs/adr/0017-base-salary-and-suggested-daily-amounts.md`), ADR 0013, ADR 0014.
Everything in this file that is not inherited from those is **advisory** — see
*Implementation handoff*.

---

## Design read

Three new things appear, on two dialogs that already exist:

| # | Surface | New element |
|---|---|---|
| 1 | Staff add/edit dialog, `apps/web/src/staff/StaffPage.tsx:562-638` | One optional money field, **Base salary** |
| 2 | Add daily record dialog, `apps/web/src/compensation/CompensationPage.tsx:360-371` | **Gross sales for this date** read-only block, with the no-business-day note and the commission suggestion it feeds |
| 3 | Same dialog | **Include load allowance** checkbox, its conditional amount field, and the advisory duplicate warning |

Nothing here is net-new in kind. The two dialogs share one shell
(`.inventory-modal.staff-modal`, styles.css:1718), one field primitive
(`.catalog-field`, styles.css:993), one error vocabulary
(`.catalog-field-error` + `.staff-account-error-list`, styles.css:1029, 1902),
and the compensation dialog already contains the exact two shapes this story
needs again: a label-left / amount-right summary row (`.compensation-total`,
styles.css:2928) and a ₱-prefixed money input (`.adjustment-amount-input`,
styles.css:3123, used by `AdjustmentsView.tsx:412`).

The one genuinely new *idea* is "this value was suggested, not typed" — and even
that shipped three weeks ago for #409: `.staff-fill-indicator`
(styles.css:6991) is a dashed annotation chip meaning exactly "filled for you,
still yours to change". This spec reuses that rule rather than inventing a
second provisional-value language.

**The thing most likely to go wrong visually** is the two ₱0.00 gross states.
`₱0.00` with *no* note (a day that opened and sold nothing) and `₱0.00` with the
note (no business day at all) differ by one line of text, and ADR 0017 §4 makes
them a correctness requirement, not a nicety. The note is therefore given a
bordered, weighted treatment rather than a muted help line — see *Components*.

---

## Placement

### 1. Staff dialog — `StaffPage.tsx`

The form body is, in source order: `.catalog-field` **Name** (`:563-595`) →
`.catalog-field` **Is active** (`:597-616`) → `modalError` `Notice` (`:614-616`) →
`.staff-modal-actions` (`:617-637`).

**Base salary goes between Name and Is active**, as a third sibling
`.catalog-field`. Name identifies the person, base salary is the rate the
engagement runs at, Is active is the switch that ends with the Cancel/Save pair
— reading order follows that. It must not go after Is active, where a money
field would sit directly above the submit button and read as part of the action
row.

The dialog has no `.inventory-modal-grid` (unlike the compensation one), so the
field is full width and stacks naturally at every breakpoint. No markup change
outside the new field.

### 2 & 3. Add daily record dialog — `CompensationPage.tsx`

The add-mode form body is, in source order (`:363-369`):

```
error summary (.staff-account-error-list)
modalError Notice
conflict (.compensation-conflict)
.inventory-modal-grid   — Staff member | Work date
.inventory-modal-grid   — Salary amount | Commission amount
.compensation-total     — Daily total
.staff-modal-actions
```

Insert two blocks and two chips:

```
… conflict …
.inventory-modal-grid   — Staff member | Work date
.compensation-gross     ← NEW   (block 2)
.inventory-modal-grid   — Salary amount | Commission amount
                          each gains a .compensation-suggested chip  ← NEW
.compensation-total     — Daily total
.compensation-load-allowance  ← NEW   (block 3)
.staff-modal-actions
```

Why those two positions:

- **Gross sits above the amounts, below the two selectors.** It is the *basis*
  for the number that appears prefilled in Commission, and it is keyed to Work
  date. An administrator must be able to read the gross before reading the
  commission it produced; below the amounts, the prefill would have no visible
  cause.
- **Load allowance sits below `.compensation-total`.** The story requires the
  allowance **not** to join the salary-plus-commission total. Placing it after
  the total makes that exclusion a layout fact — the total is closed before the
  allowance is mentioned. Above the total it would read as a third addend, which
  is precisely the misreading the criterion exists to prevent.

`.compensation-modal form` is `display: grid; gap: var(--space-5)`
(styles.css:2903 over :1748), so both blocks are grid children needing no margin
of their own.

**In edit mode none of this renders.** `openEdit` (`:171`) already swaps the two
selectors for the read-only `.compensation-fixed-context` `<dl>` (`:366`); the
same `draft.id` test gates `.compensation-gross`, `.compensation-load-allowance`
and both chips. ADR 0017 §5 has `PATCH` refuse a `loadAllowance` member, so this
is defence in depth, not the enforcement.

---

## Components

Every row cites something shipped. **Token names only** — no literal colour,
space or radius value is introduced anywhere in this document.

| Element | Reuse | Notes |
|---|---|---|
| Base salary field | `.catalog-field` (styles.css:993) + `.adjustment-amount-input` (styles.css:3123) | Exactly the `AdjustmentsView.tsx:412` markup: `<span class="adjustment-amount-input"><span aria-hidden="true">₱</span><input inputMode="decimal" type="text">`. The wrapper already carries focus-visible and `aria-invalid` styling, so the field error treatment comes free. |
| Base salary error / help | `.catalog-field-error`, `.catalog-field-help` (styles.css:1029-1041) | Same pair, same ids convention as `staff-name-hint` / `staff-name-error`. |
| Gross block | `.compensation-total` (styles.css:2928) + new `.compensation-gross` modifier | Co-class: `class="compensation-total compensation-gross"`. The base rule gives the flex label-left / figure-right layout, `--surface-subtle`, `--border`, `--radius-sm`, `--space-4` padding, and the `@media (max-width: 760px)` stack (styles.css:3215) — all of it already correct here. The modifier **only reduces emphasis**, so the dialog does not appear to have two totals: `> strong { font-size: 15px }` against the base's 18px. Nothing else. |
| Gross figure | `formatMoney` (`apps/web/src/reporting/format.ts:27`) + `className="num"` | `₱1,234.50`, as every other amount in the app. |
| No-business-day note | `.staff-permanence-warning` (styles.css:7277) + new `.compensation-gross-note` co-class | The shipped neutral note strip: `--border-strong` border, `--surface-subtle` background, `--ink-soft` ink, `--radius-sm`, weight 700. The co-class zeroes its `margin` (the base rule carries `0 0 var(--space-5)` for its `StaffInventoryPages.tsx:1271` context). Bordered and weighted, not a muted help line: it is the **only** visual difference between the two ₱0.00 states. |
| Gross load state | the `.results-meta` voice (styles.css:1248), rendered as the figure | Replace the amount text with `Checking…` inside the same live region. No spinner: the fetch is one indexed read and a spinner at this size is more motion than information. |
| Gross failure | `Notice tone="danger"` (`apps/web/src/catalog/components.tsx:129`) | Rendered inside `.compensation-gross`, *not* as the dialog-level `modalError` — the record is still saveable by hand, and `modalError` means "the save failed". |
| Suggested-value chip | `.staff-fill-indicator` (styles.css:6991) | Add the new name to that rule's selector list — `.staff-fill-indicator, .compensation-suggested { … }` — exactly as #409 did for `.staff-submitted-banner, .staff-fill-source-banner` (styles.css:7078). One rule, two names, no duplicated values to drift. The dashed edge is load-bearing: it reads *provisional*, where the solid-bordered chips in this app read as facts. |
| Chip row | `.staff-count-fill-row` (styles.css:6983) + new `.compensation-field-annotation` co-class | `display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0`. Sits as the last child of the `.catalog-field`, below the help line. Omitted entirely when there is no chip, so an untouched dialog keeps its current height. |
| Load allowance container | new `.compensation-load-allowance`, mirroring `.compensation-total`'s surface | `display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-subtle)`. Same four token roles as `.compensation-total`, different display because it stacks rather than opposing two items. Deliberately **not** `.change-owed-control` (styles.css:9005): that block is amber because recording owed change *is* a problem state, and an optional allowance is routine. |
| Checkbox | `.change-owed-choice` (styles.css:9014) | Add the new name to that rule's selector list and to its five companions (`input`, `small`, `> span::before`, `input:checked + span::before`, `input:focus-visible + span::before`). It already does the whole job: `--field-h` row, a `--touch-min` × `--touch-min` transparent real `<input>`, a drawn 18px box, `--accent` when checked, `--focus` outline. The label/sub-copy structure is the `OrderSettlementDialogs.tsx:383-392` `<strong>` + `<small>` pair. Do not add a new checkbox control. |
| Load allowance amount | `.catalog-field` + `.adjustment-amount-input` | Identical to the adjustment Amount field, including its help string — the rules *are* the same rules (ADR 0017 §5). |
| Duplicate warning | new `.compensation-duplicate-warning`, derived from `.staff-permanence-warning` | Same box as the no-business-day note — same padding, radius, size, weight, `margin: 0` — with the three colour roles swapped to the semantic warn family: `border: 1px solid var(--warn-border)`, `color: var(--warn-ink)`, `background: var(--warn-surface)`. Those are the tokens `docs/ui-reconciliation.md` C1 bound for exactly this purpose, and `.change-owed-control` already uses them. **Not** `.void-order-warning` (styles.css:9071): that is `--danger` on `--danger-surface` and would read as a refusal, which this is not (ADR 0017 §6). |
| Success / conflict notices | existing `Notice tone="success"` and `.compensation-conflict` (`:365`) | Copy extended, markup unchanged — see *Copy*. |

**Tokens used**, all shipped in `apps/web/src/styles.css`:
`--border`, `--border-strong`, `--surface`, `--surface-subtle`, `--ink-soft`,
`--muted`, `--accent`, `--focus`, `--danger`, `--warn-ink`, `--warn-surface`,
`--warn-border`, `--radius-sm`, `--touch-min`, `--field-h`,
`--space-2` … `--space-5`.

**No new token is required.** See *Token findings* for the two
`styles.css` ↔ `tokens.json` divergences this read turned up; neither blocks the
story.

---

## Interaction

### Form state

Three additions to `EntryDraft` / the dialog's state, none of them sent to the
API (ADR 0017 §10):

```ts
// add mode only
gross:   { status: 'loading' | 'ready' | 'error';
           hasBusinessDay: boolean;
           grossSalesCents: MoneyCents;
           suggestedCommissionCents: MoneyCents } | null
touched: { salary: boolean; commission: boolean }
loadAllowance: { include: boolean; amount: string; duplicate: boolean }
```

`touched` is **provenance, not value**. A chip shows iff that field is
`!touched[field]` *and* the current value came from a suggestion.

### Opening the dialog (`openAdd`, `:165`)

- Work date defaults to `shopDate()` — unchanged.
- Staff member is `''`, salary is `''`, commission is `''`.
- **The gross fetch fires immediately**, before any staff member is chosen
  (criterion: "Gross sales and the commission suggestion are shown immediately
  for the default work date even before a staff member is selected"). On
  arrival, commission is prefilled with `suggestedCommissionCents` and shows its
  chip; salary stays blank with no chip, because no staff member is selected
  yet.
- Focus goes to the Staff member select, unchanged (`:150`). The gross block
  arriving above the amounts must not move focus.

### Choosing a staff member

1. Reset `touched` to `{ salary: false, commission: false }`.
2. **Salary** ← `member.baseSalaryCents === null ? '' : amountForInput(member.baseSalaryCents)`.
   The test is `=== null`, never falsy. `baseSalaryCents === 0` yields `'0.00'`
   and a chip; `null` yields `''` and no chip. A `??` or a truthiness check here
   breaks an acceptance criterion silently and is the single most likely way to
   get this story wrong (ADR 0017 §1).
3. **Commission** ← the current `gross.suggestedCommissionCents`, re-applied.
   Changing the staff member is one of the two events the story permits to
   overwrite an edited value.
4. Returning the select to `Choose active staff` clears salary to `''` and drops
   its chip. Commission keeps the suggestion — it never depended on the person.
5. No fetch. The roster is already loaded with `baseSalaryCents` on it
   (`listStaffMembers`, `:121`), so there is **no new request on staff change**.
   The duplicate check in step 7 below is the only staff-keyed request.

### Changing the work date

1. `gross` ← `{ status: 'loading', … }`; the figure becomes `Checking…`; the
   no-business-day note and any gross error clear.
2. Reset `touched`.
3. On arrival: figure ← `formatMoney(grossSalesCents)`; the note renders iff
   `hasBusinessDay === false`; commission ← `suggestedCommissionCents` with its
   chip. Salary is untouched by a date change — it comes from the person.
4. **Last-write-wins guard required.** Use the `let current = true` cleanup the
   page already uses at `:130-146`; typing in a `type="date"` field emits
   several intermediate values and a stale response must not land.
5. An invalid or future date still fails the existing `validateDraft` rule
   (`:214`). Do not fetch for a value that fails `/^\d{4}-\d{2}-\d{2}$/`.

### Editing a suggested value

Any `onChange` on salary or commission sets `touched[field] = true` and removes
that field's chip — including a change that lands back on the suggested value,
and including one that clears the field. Once touched, later suggestions do not
overwrite it until a staff-member or work-date change resets the flag.

### Include load allowance

1. Unchecked by default on every `openAdd`.
2. Checking it reveals the amount field and moves focus to it.
3. Unchecking it hides the field, clears `amount`, clears the amount's field
   error, and clears the duplicate warning. The hidden field must not validate.
4. **While checked**, the duplicate check runs on `(staffMemberId, workDate)`:
   `GET /compensation/adjustments?staffMemberId=&from=<workDate>&to=<workDate>`,
   matching `kind: ALLOWANCE` and a trimmed case-insensitive comparison against
   the `Load allowance` preset (ADR 0017 §6). It re-runs when either key
   changes while the box stays checked. No loading state — a warning that
   flickers in and out is worse than one that appears a beat late.
5. The warning **does not block submit and does not clear the checkbox.**
   Saving through it creates a genuine second allowance.

### Submit

- Validation order for the error summary and for `focusFirstError`:
  `['staffMemberId', 'workDate', 'salary', 'commission', 'loadAllowanceAmount']`.
  The new field must be appended to the `(['staffMemberId', …] as const)` tuple
  at `:227`, or a bad amount shows in the summary with no focus target.
- Amount parse: `adjustmentAmountToCents` (`compensation/money.ts:26`) — minimum
  ₱0.01, at most two decimals. Unchanged rules, unchanged messages.
- One request: `POST /compensation/entries` with
  `loadAllowance: { amountCents }` when checked. One transaction server-side
  (ADR 0017 §5).
- A `409` duplicate record renders the existing `.compensation-conflict` block
  with one sentence appended (see *Copy*). Neither row was written.
- Any other failure renders `modalError`; the checkbox, the amount and every
  suggestion survive so the administrator can retry without re-entering.

### States summary

| Block | State | Trigger | What is shown |
|---|---|---|---|
| Gross | loading | open, work-date change | `Checking…` in place of the figure |
| Gross | day with sales | `hasBusinessDay`, gross > 0 | `₱2,750.00`, no note |
| Gross | day, no sales | `hasBusinessDay`, gross 0 | `₱0.00`, **no note** |
| Gross | no day | `!hasBusinessDay` | `₱0.00` **and** the note |
| Gross | error | fetch rejects | danger `Notice`, submit still enabled |
| Salary | suggested | staff member with a rate selected | value + `From base salary` chip |
| Salary | blank | no rate, or `Choose active staff` | empty, no chip |
| Salary | typed | any `onChange` | value, no chip |
| Commission | suggested | gross arrives, or staff change | value + `Suggested from gross sales` chip |
| Commission | typed | any `onChange` | value, no chip |
| Load allowance | off | default | checkbox only |
| Load allowance | on | checked | checkbox + amount field |
| Load allowance | duplicate | checked, match found | plus the warning |
| Load allowance | invalid | submit with bad amount | field error + summary entry |
| Whole form | submitting | submit | every control `disabled`, button `Saving…` |
| Whole form | edit mode | `draft.id` set | none of the above exists |

---

## Responsive

Both dialogs already behave. The shell is `width: min(100%, 560px)` with
`max-height: calc(100dvh - 40px)` and `overflow-y: auto` (styles.css:1718), so
the two new blocks lengthen a container that already scrolls.

At **`@media (max-width: 760px)`** (styles.css:3184 — the compensation
breakpoint; do not introduce another):

- `.compensation-modal .inventory-modal-grid` → `1fr` (styles.css:3206). Already
  covers both amount pairs; the chips stack under their own inputs.
- `.compensation-total` → `flex-direction: column; align-items: flex-start`
  (styles.css:3215). `.compensation-gross` inherits this, so the label and the
  figure stack. **No new rule needed.**
- `.compensation-load-allowance` is a single-column grid at every width, so it
  needs no breakpoint entry. The checkbox keeps its `--field-h` row and
  `--touch-min` hit area unconditionally.
- `.compensation-field-annotation` wraps (`flex-wrap: wrap`) and its chip keeps
  `white-space: nowrap` from `.staff-fill-indicator`, so a long chip label drops
  to its own line rather than compressing.

`.staff-modal-actions` already stacks at the same breakpoint
(styles.css:2554). Nothing new there.

Nothing drops at any width. Both new blocks are information the administrator
needs to enter the record correctly, and the dialog scrolls in its own
container.

---

## Accessibility

### Base salary (staff dialog)

- `<label for="staff-base-salary">Base salary</label>` — no `*`, it is optional,
  and `.catalog-field label span` is reserved for the required marker
  (styles.css:989).
- `aria-describedby="staff-base-salary-hint"`, extended to
  `"staff-base-salary-hint staff-base-salary-error"` when invalid, with
  `aria-invalid="true"` — the `staff-name-hint` / `staff-name-error` pattern at
  `:573-594`, unchanged.
- The `₱` prefix span stays `aria-hidden="true"` (as `AdjustmentsView.tsx:412`)
  so the currency is not read as part of the value.
- `inputMode="decimal"`, `type="text"`. Not `type="number"`: the app parses
  decimals itself and `number` would let the browser silently reformat the
  blank-versus-zero distinction this story depends on.
- **Focus-return caution.** `saveStaff` refocuses the name input via
  `requestAnimationFrame` on a refused submit (`:210`, `:244`). A base-salary
  error must focus the *base-salary* input, or the next keystroke lands in the
  name field and the administrator sees their correction vanish.

### Gross block

- One live region: `<div class="compensation-total compensation-gross" role="status" aria-live="polite">`
  wrapping the label, the figure, and the no-business-day note. One region, so a
  work-date change announces once — `Checking…`, then
  `Gross sales for this date ₱0.00 No business day on this date`.
- The note is **real text inside that region**, not a `title`, not an icon, not
  a colour. It is the only cue distinguishing the two ₱0.00 states, so it must
  reach a screen reader.
- The figure is not a form control and takes no focus. It carries
  `className="num"` for tabular alignment, consistent with the table and
  `.compensation-total`.
- The danger `Notice` has `role="alert"` from the component
  (`components.tsx:139`) — correct, it is a thing that just broke.

### Suggested chips

- The chip is referenced from its input:
  `aria-describedby="compensation-salary-help compensation-salary-suggested"`
  (appended, not replacing, and before any error id). So the field announces
  "Salary amount, PHP up to 2 decimal places, zero is allowed, from base
  salary".
- The chip is not a control, not focusable, and carries no `aria-live`. It
  appears as part of a value change the administrator just caused; announcing it
  separately would double up on the live region above.
- A chip disappearing on edit needs no announcement — the user typed.

### Load allowance

- The checkbox is a real `<input type="checkbox">` with a wrapping `<label>`,
  per `.change-owed-choice`. The visible box is drawn with `::before` while the
  input itself is a transparent `--touch-min` square — keyboard focus,
  `:checked`, and the native announcement all come free.
- `aria-controls` is **not** used; the revealed field follows the checkbox in DOM
  order, which is what assistive technology actually relies on here.
- Revealing the amount field moves focus into it on the same
  `requestAnimationFrame` the dialog already uses. Unchecking returns focus to
  the checkbox.
- Amount field: `aria-describedby="compensation-loadAllowance-help"`, extended
  with `…-error` when invalid, `aria-invalid` set — the adjustment pattern.
- The duplicate warning is `role="status" aria-live="polite"` and sits **after**
  the amount field. Not `role="alert"`: it is advisory, it does not block
  submit, and an assertive interruption while the administrator is typing an
  amount would read as a refusal.
- The error summary (`.staff-account-error-list`, `role="alert"`) gains an
  anchor `#compensation-loadAllowanceAmount`, matching the existing
  `#compensation-<field>` convention at `:363`.

### Keyboard path (add mode)

`Staff member → Work date → Salary → Commission → Include load allowance →
[Load allowance amount] → Cancel → Add record`

- `trapDialogFocus` (`:55`) queries
  `button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]`
  — the new `<input type="checkbox">` and the new money input are both matched,
  so the wrap continues to work with no change.
- `Escape` closes; focus returns to the trigger (`:187`). Unchanged.
- Edit mode's path is exactly today's path.

---

## Copy

Exact user-facing strings. Money is `formatMoney` output —
pesos, grouped, two decimals (`₱1,234.50`).

### Staff dialog

| Element | String |
|---|---|
| Label | `Base salary` |
| Help | `Daily rate in PHP, up to 2 decimal places. Leave blank for no base salary; ₱0.00 is a rate of zero.` |
| Error — negative | `Base salary cannot be negative.` |
| Error — non-numeric | `Base salary must be a number.` |
| Error — precision | `Base salary cannot have more than 2 decimal places.` |
| Error — too large | `Base salary is too large.` |

The four errors are `parseCurrency` (`compensation/money.ts:10`) called with the
label `Base salary`. They are the same sentences the compensation dialog already
produces for Salary and Commission, so no new error voice enters the app.

> **Parse note, and it is load-bearing.** `currencyToCents` rejects a blank
> value (`Enter a base salary amount. Zero is allowed.`) — correct for the
> required compensation fields, wrong here. Base salary needs a sibling that
> treats blank as **absent** (`NULL`), not as an error, and `'0'` / `'0.00'` as
> the value zero. Blank must not route through the "zero is allowed" message,
> because that sentence tells the administrator the opposite of what the field
> means.

### Add daily record — gross block

| Element | String |
|---|---|
| Label | `Gross sales for this date` |
| Caption | `All completed sales for this business date. Commission suggestion: ₱50 for every full ₱1,000.` |
| Figure, loading | `Checking…` |
| Figure, ready | e.g. `₱2,750.00` |
| No-business-day note | `No business day on this date` |
| Error title | `Gross sales unavailable` |
| Error body | `Sales for this date could not be loaded. The commission suggestion is unavailable — enter the commission by hand.` |

`No business day on this date` is the story's own string and is reproduced
verbatim, with no trailing period, as the criteria write it.

### Add daily record — suggestion chips

| Element | String |
|---|---|
| Salary chip | `From base salary` |
| Commission chip | `Suggested from gross sales` |

Both read as provenance rather than instruction, so neither needs to say
"editable" — the field is a plain text input and the help line under it already
states the rules.

### Add daily record — load allowance

| Element | String |
|---|---|
| Checkbox label | `Include load allowance` |
| Checkbox sub-copy | `Recorded as a separate allowance dated the work date. Not included in the daily total.` |
| Amount label | `Load allowance amount` |
| Amount help | `Positive pesos, up to two decimal places. Minimum ₱0.01.` |
| Error — blank | `Enter an amount.` |
| Error — zero | `Amount must be at least ₱0.01.` |
| Warning | `{Staff member} already has a Load allowance for {work date}. Saving adds a second one.` |

The amount help string and both errors are the shipped adjustment strings
(`AdjustmentsView.tsx:412`, `money.ts:26-31`) reused character for character —
"same amount rules as other allowances" means the same rules and the same
sentences.

Warning, rendered: `Jonas already has a Load allowance for 3 October 2026.
Saving adds a second one.` — `formatBusinessDate` for the date, the same
formatter the conflict block uses at `:250`.

### Add daily record — outcomes

| Case | String |
|---|---|
| Saved, no allowance | unchanged: `{Name}'s {date} record was added. Daily total: ₱{total}.` |
| Saved, with allowance | the above, plus ` A ₱{amount} load allowance was also recorded.` |
| Duplicate record (`409`) | unchanged: `Nothing was changed. {Name} already has a record for {date}.` plus, when the checkbox was selected, ` No load allowance was recorded either.` |
| Other save failure | `Nothing was recorded. The daily record and the load allowance are saved together, so neither was saved. Try again.` (when checked) / unchanged `The daily record could not be saved. Try again.` (when not) |

The "so neither was saved" clause is the story's "a message explains what
failed". It names the consequence the administrator cares about — that there is
no half-written record to clean up.

---

## Token findings

Reported, not acted on; `styles.css` is treated as the shipped truth.

1. **`--z-modal` and `--z-modal-backdrop` exist in `styles.css` (`:root`) and
   have no counterpart in `docs/design/tokens.json`.** `tokens.json` has no
   z-index group at all. This story does not add a layer, so it is not blocked —
   but the two files are meant to be two views of one palette, and a modal
   stacking order that only one of them records will be guessed next time
   someone adds an overlay. A human decides whether `tokens.json` gains a
   `zIndex` group or the variables are documented as implementation-only.
2. **`tokens.json` carries `space.10` (40px) and `space.12` (48px), which
   `styles.css` does not define**, along with the `levelSelector`, `staffShell`
   and `shadow.control` groups that exist only as literals in the stylesheet.
   The reverse direction of the same drift. Also a human call.

Naming skew between the two files (`--touch-min` ↔
`control.minimumTouchTarget`, `--radius-sm` ↔ `radius.small`, `--bg` ↔
`color.background`, `--field-h` ↔ `control.fieldHeight`) is consistent and
intentional-looking, so it is noted but not raised as a finding. Every token
this design names resolves in both files under those mappings.

**No value in this design lacks a token.** The one place that could have needed
one — a visual for "this value was suggested" — is answered by
`.staff-fill-indicator`, which is built entirely from existing tokens.

---

## Implementation handoff

### Binding — inherited from the story, the ADRs, and accessibility

These are not this document's recommendations. Deviating from them fails a
criterion or an ADR.

1. **`NULL` and `0` base salary stay distinguishable end to end** (story; ADR
   0017 §1). The prefill test is `baseSalaryCents === null`. `null` → blank
   field, no chip; `0` → `0.00`, chip. No `??`, no truthiness test, anywhere on
   the path.
2. **Blank base salary saves as absent, not as zero** (story; ADR 0017 §8). It
   must not reuse the "Enter an amount. Zero is allowed." refusal.
3. **The no-business-day message comes from `hasBusinessDay`, never from
   `gross === 0`** (story; ADR 0017 §4). `₱0.00` with no note and `₱0.00` with
   the note are two required, visually distinct states.
4. **Gross and the commission suggestion render for the default work date before
   any staff member is selected**, and track work-date changes (story).
5. **The commission prefill is the server's `suggestedCommissionCents`** (ADR
   0017 §3). The browser computes no money. Do not re-derive ₱50/₱1,000 in the
   web app, not even to display the rule — the caption states the rule as prose,
   which is not arithmetic.
6. **A value the administrator changed is not overwritten by a later
   suggestion**, except on a staff-member or work-date change (story; ADR 0017
   §10). Per-field dirty flags, form-local, never sent.
7. **Salary and commission remain editable**, and the persisted values are
   whatever the administrator submitted (story; ADR 0017 §3).
8. **The duplicate-allowance warning does not block submit and does not clear
   the checkbox** (story; ADR 0017 §6). Advisory, `role="status"`, never
   `role="alert"`.
9. **Gross, both suggestions, both chips and the whole load-allowance block are
   absent in edit mode**, and opening edit recomputes nothing (story; ADR 0017
   §5).
10. **One request, one transaction** for the entry plus the allowance; a refused
    duplicate leaves no orphan (story; ADR 0017 §5).
11. **The load allowance is excluded from the daily total** (story). The total
    stays `salary + commission`.
12. **Base salary is admin-only, and the boundary is the server-side
    projection** (ADR 0017 §7). Hiding the input is a courtesy; the explicit
    `select` lists in `StaffService.listSelectable()` and
    `StockCountsService.listActiveStaff()` are the control. Nothing in this
    design relies on the field being invisible.
13. **Accessibility obligations**: every new field labelled and error-associated
    via `aria-describedby` + `aria-invalid`; the new amount field present in the
    error summary and in the `focusFirstError` tuple; the gross figure and the
    no-business-day note inside one polite live region; the no-business-day
    state conveyed as text, not by colour or icon alone; the checkbox hit area
    at least `--touch-min`; focus moved to the revealed amount field and
    returned to the checkbox on uncheck; a refused submit focusing the field
    that is actually wrong.

### Advisory — this document's recommendations

Dev may integrate these differently with a one-line reason; Tech Lead reviews
the deviation rather than the pixels.

1. **Block order** — gross above the amount pair, load allowance below the daily
   total. The reasoning (cause before effect; the total closed before the
   excluded item) is in *Placement*, and it is the part worth preserving if the
   layout changes.
2. **Base salary between Name and Is active** in the staff dialog.
3. **Reusing `.compensation-total` for the gross block** with an emphasis-only
   modifier, rather than a new block or the `.compensation-fixed-context` `<dl>`.
   This is what makes the 760px stack free.
4. **Reusing `.staff-fill-indicator` for the suggested chips** by adding a name
   to its selector list. A second provisional-value treatment in the same app
   would be the expensive outcome.
5. **The warn token family for the duplicate warning**, derived from
   `.staff-permanence-warning`'s box rather than from `.void-order-warning`'s
   red. Rationale in *Components*; the requirement behind it is only that it not
   read as a validation error.
6. **Neutral surface for the load-allowance container**, not
   `.change-owed-control`'s amber.
7. **`Checking…` instead of a spinner** for the gross fetch.
8. **No loading state for the duplicate check** — avoid a flickering warning.
9. **Chip labels** `From base salary` and `Suggested from gross sales`, and the
   decision not to say "editable" in them.
10. **The last-write-wins guard** on the gross fetch, mirroring `:130-146`.
    Strictly this is a correctness matter, but the mechanism is a
    recommendation.

### Proposed material changes to existing shared shells or components

Four, all additive. No existing selector loses a declaration, and no shipped
screen changes appearance.

| Change | Why |
|---|---|
| `.staff-fill-indicator` (styles.css:6991) — add `.compensation-suggested` to the selector list | One rule, two names. The alternative is a second dashed-chip rule whose values drift from the first. Precedent: `.staff-submitted-banner, .staff-fill-source-banner` (styles.css:7078), added by #409 for the same reason. Affects no shipped rendering. |
| `.change-owed-choice` (styles.css:9014) and its five companion rules — add `.compensation-load-allowance-choice` to each selector list | The design task's instruction to cite an existing checkbox rather than invent one. Six selector lists is the cost of not having a `.checkbox-choice` primitive; see below. |
| `.staff-permanence-warning` (styles.css:7277) — add `.compensation-gross-note` to the selector list, plus a co-class zeroing its bottom margin | Reuses the shipped neutral note box in a `gap`-managed grid, where its `margin-bottom` would double the spacing. |
| `.compensation-total` (styles.css:2928) — add `.compensation-gross` as a modifier | Inherits the layout, the surface and the 760px stack; overrides only the figure's font size so the dialog does not appear to show two totals. |

**One observation for the Tech Lead, not a request.** This app now has three
independent hand-rolled checkbox treatments — `.change-owed-choice`,
`.restock-scope-toggle label` (`reporting/components.tsx:345`) and
`.order-check-grid label` (`orders/TakeOrderPage.tsx:180`) — and this story adds
a fourth name to one of them. Extracting a single `.checkbox-choice` primitive
is the correct fix and is **explicitly out of scope here**: it would touch three
shipped screens on a Should-priority story. Recorded so the next story that adds
a checkbox has a reason to raise it rather than adding a fifth.

`dialog-fragment.html` beside this file shows the add-mode dialog body with the
three new blocks in place, using only the classes named above.
