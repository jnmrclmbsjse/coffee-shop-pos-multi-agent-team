# Administrator Journal — set-aside fund ledgers

Design reference for story #467, Design Task #477. Mode: **open-design**
(Tech Lead verdict `design:net-new` — the admin shell has no fund-ledger screen
and nothing resembling one, so there was no existing screen to write a
change-spec against).

| File | What it is |
|---|---|
| `index.html` | the mockup. Open it directly in a browser; no build step. |
| `styles.css` | mockup CSS. Re-declares the shipped `:root` token block verbatim and styles only through `var(--token)` references. |
| `app.js` | vanilla JS driving tabs, modals, bulk selection and the review harness. No framework. |
| `NOTES.md` | the design agent's own record: composition rationale, the full copy inventory, the responsive table, and the token-gap finding. |
| `BRIEF.md` | the brief the mockup was generated against, carrying the shipped tokens and class vocabulary. |
| `brand-spec.md` | the design agent's restatement of the shipped visual system. Descriptive only — `apps/web/src/styles.css` remains the truth. |

The mockup carries a **review harness** — a labelled "Mockup state" panel at the
top of the workspace reading *"Review harness, not part of the product"*. It
switches between populated ledger, empty ledger, negative balance, long name +
long note, duplicate-deposit conflict, bulk-add populated, bulk-add empty,
bulk-add conflict, loading and error. **It is not part of the design** and must
not be implemented.

## Design read

A dense, utilitarian internal back-office screen. Dials: variance 3, motion 2,
density 5. The Journal must read as one more room in the existing admin back
office, not as a new product — so the mockup extends the shipped plain-CSS
system and reuses the Compensation and Reports vocabulary rather than proposing
a visual language of its own.

## Placement

- Route `/journal`, inside the existing `ProtectedRoute role={Role.ADMIN}` /
  `AdminLayout` block in `apps/web/src/App.tsx`. No new shell.
- One new `ADMIN_NAV_GROUPS` destination under **Operations**
  (`App.tsx:53`), after `/compensation` and before `/order-history`, labelled
  **Journal**. Add the matching `destinationName` entry (`App.tsx:~104`) —
  `'/journal': 'Journal'` — or the post-sign-in return copy falls back to
  "the requested admin page".
- Icon: of the glyphs `apps/web/src/catalog/components.tsx` already exports,
  `document` and `wallet` are taken by Reports and Compensation. **No shipped
  glyph means "set-aside fund."** See the findings section — this needs a
  decision, not an invention.
- New feature directory `apps/web/src/journal/`, matching
  `compensation/` and `reporting/`.

## Composition

The five jobs in #477 compose as three stable levels. This is the design
decision the Design Task left open:

1. **Ledger overview** — a persistent left panel (`.journal-ledger-panel`)
   listing every ledger with its balance, acting as the selector. It keeps
   balances and the cross-ledger recording-status examples visible while the
   administrator works inside one ledger.
2. **Selected-ledger workspace** — a summary strip (balance as a
   `.report-metric`, start date, suggestion rule) above **Activity / Bulk add**
   tabs in `.compensation-sections`. Tabs, not two stacked tables, keep a
   first-use bulk list of the shop's entire history from pushing routine review
   off the page.
3. **Focused modals** for add-ledger, record/edit deposit, record/edit
   withdrawal, delete confirmation and suggestion settings — the shipped
   `.inventory-modal-backdrop` > `.inventory-modal` pattern. This preserves
   ledger context, gives destructive copy room, and gives focus containment one
   mechanism.

Page-level actions (**Add ledger**, **Suggestion settings**) sit in
`.catalog-page-head` because they affect the ledger collection or future
suggestion rules. Deposit and withdrawal actions sit in the selected-ledger
workspace because they affect that ledger only.

## Components and classes to reuse

Everything below already ships. Cite it, don't rebuild it.

| Need | Reuse |
|---|---|
| Page frame, heading, page actions | `.catalog-page`, `.catalog-page-head` |
| Panels | `.catalog-panel` |
| Activity / Bulk add tabs | `.compensation-sections` with `button[aria-current="page"]` (`CompensationPage.tsx:546`) |
| Balance readout | `.report-metric` (`reporting/components.tsx:63`) |
| Tables | `.catalog-table` inside `.catalog-table-wrap`, or `.report-table` inside `.report-table-region` with `.report-scroll-hint` for the wide activity table |
| Money cells | `td.num` — mono, `tabular-nums`, right-aligned (`styles.css:3993`) |
| Money strings | `formatMoney()` from `apps/web/src/reporting/format.ts`. Do not re-implement; do not do money arithmetic in the browser. |
| Buttons | `.catalog-button` + `.primary` / `.secondary` / `.danger`; `.table-action` for row actions |
| Fields | `.catalog-field`, `.catalog-field-label`, `.catalog-field-help`, `.catalog-field-error` |
| Notices | `.catalog-notice` + `.danger` / `.success`; `.report-empty`; `.results-meta` for counts |
| Modal | `.inventory-modal-backdrop`, `.inventory-modal`, `.inventory-modal-head`, `.inventory-modal-grid`, `.staff-modal-actions` |
| Delete confirmation | the `.compensation-delete-modal` / `.compensation-delete-body` pattern in `CompensationPage.tsx` |
| **Suggested-but-unsaved amount** | **`.compensation-suggested`** inside `.compensation-field-annotation` (`styles.css:7105`) — the shipped dashed `--border-strong` chip on `--surface-subtle` already means exactly this. Reuse it; do not introduce a second suggestion treatment. |
| **Negative balance** | the shipped `.variance` + `.variance-short` pattern (`styles.css:4144`): `--danger` ink paired with a literal word, so meaning never rests on colour. |
| Visually hidden text | **`.sr-only`** (`styles.css:55`) |

New classes the mockup introduces, all `.journal-*`: `journal-layout`,
`journal-workspace`, `journal-ledger-panel`, `journal-ledger-list`,
`journal-ledger-row`, `journal-summary`, `journal-summary-copy`,
`journal-panel-head`, `journal-toolbar`, `journal-page-actions`,
`journal-status`, `journal-status-guide`, `journal-no-suggestion`,
`journal-note`, `journal-kicker`, `journal-field-wide`,
`journal-radio-group`, `journal-confirm-modal`, and the bulk-add family
(`journal-bulk-fieldset`, `journal-bulk-rows`, `journal-bulk-header`,
`journal-bulk-row`, `journal-bulk-day`, `journal-bulk-amount`,
`journal-bulk-check`). Each is layout or a Journal-specific state label; none
duplicates a shipped component. `.journal-review-harness` and
`.journal-state-panel` belong to the harness and must not ship.

## The four recording conditions — the load-bearing part of this design

#477 names this as the single most likely silent defect. The design keeps
**amount**, **suggestion** and **recording status** in three separate fields so
no bare `₱0.00` ever carries two meanings.

| Condition | Deposit column | Suggestion column | Status |
|---|---|---|---|
| **Saved ₱0 deposit** (a real deposit; the day is handled) | `₱0.00` | — | `Recorded in ledger` / `Saved ₱0.00 deposit` |
| **₱0 suggestion** (Chair below its gross threshold; not saved) | `Not recorded` | `.compensation-suggested` chip: `₱0.00 suggested, not saved` | `No deposit recorded yet` |
| **No suggestion at all** (`null` — always the case on a manual ledger) | `Not recorded` | `No suggestion available` in `.journal-no-suggestion` — **never `₱0.00`** | `No deposit recorded yet` |
| **No deposit yet** (outstanding, suggestion may be positive, zero or absent) | `Not recorded` | whichever of the above applies | `Needs review` |
| **Open business day** | — | none | `Open business day, not eligible`; absent from Bulk add entirely |

The overview's **Recording status** block (`.journal-status-guide`) deliberately
shows a saved ₱0 Rent deposit, a ₱0 Chair suggestion, a manual ledger with no
suggestion, and an open day **together in one view**, so the distinction is
reviewable side by side rather than only discoverable by navigating.

## Interaction

- **Ledger selection** — clicking a `.journal-ledger-row` swaps the workspace.
  The selected row carries `aria-current="true"`; selection does not navigate.
- **Tabs** — Activity / Bulk add. Switching tabs does not refetch the ledger or
  lose a part-filled bulk list. Follow the shipped `.compensation-sections`
  pattern — plain `<button>`s with `aria-current="page"`
  (`CompensationPage.tsx:546`). The mockup additionally puts
  `role="tablist"` / `role="tab"` / `aria-selected` on them, which makes
  `aria-current` redundant and commits the implementation to full tab-widget
  keyboard semantics (arrow keys, one tab stop). Pick one; the shipped pattern
  is the cheaper and more consistent choice.
- **Record deposit** — modal. The business-day control offers only **closed**
  business days on or after the ledger start date; a day that already has a
  deposit is marked `(already recorded)` rather than silently dropped, so the
  administrator can see why it is unavailable. Amount source is a real radio
  pair: `Use suggested amount` / `Enter another amount`, with a `Use suggestion`
  action beside the `.compensation-suggested` chip. The suggestion is **never
  written into the saved record until submit**.
- **Record withdrawal** — modal. Free date (not a business-day picker), amount,
  optional note. Several withdrawals on one date are normal.
- **Edit** — same modal, prefilled. Editing a deposit's business day offers only
  another eligible unrecorded closed day. A refused edit leaves the original
  visibly unchanged and shows the conflict in the modal, not as a page-level
  banner.
- **Delete** — `.journal-confirm-modal`. The deposit variant **states the
  consequence**: `Deleting this deposit makes October 1, 2026 un-recorded
  again.` Destructive actions are `.catalog-button danger`, named, and never
  the page primary.
- **Bulk add** — `Select all` plus a per-row tick and a per-row editable
  amount. The count (`4 of 4 selected`) is `aria-live="polite"`. One
  `Save selected deposits` submit; submitting reads
  `Saving selected deposits…` with the button `aria-busy`. On conflict,
  **nothing saves**, a `role="alert"` notice names the offending day, and the
  list offers a refresh — the ticks and typed amounts are preserved so the
  administrator does not retype the batch.
- **Suggestion settings** — modal with Rent percentage, Chair amount, Chair
  gross threshold. The copy states the effective-date rule. The **Rent rounding
  rule appears as fixed, read-only text** (`The Rent rounding rule is fixed.`)
  and must not be rendered as a disabled input, which would read as temporarily
  unavailable rather than not configurable.
- **Loading / error** — `.journal-state-panel` with `aria-live="polite"` for
  loading; a `role="alert"` `.catalog-notice danger` plus a `Try again` action
  for error. Literal text carries the state; motion only reinforces it.
- **Motion** — colour and press feedback only, removed under
  `@media (prefers-reduced-motion: reduce)`.

## Responsive

Uses the breakpoints `styles.css` already uses. Full table in `NOTES.md`.

| Width | Treatment |
|---|---|
| > 1180px | 228px sidebar; overview panel and workspace side by side. |
| 1180px | Overview narrows; the activity table stays in its focusable scroll region. |
| 1050px | Overview moves **above** the workspace; ledgers become a compact row. |
| 900px | Content takes the full viewport width. |
| 760px | Headings and summaries stack; ledger rows become a vertical list; each bulk row becomes two columns with its amount field on a full row. |
| 600px | Review harness and modal fields go single-column. |
| 540px | Topbar secondary text drops; page actions go full-width. |
| 480px | Bulk rows go single-column; modal actions stack with the safe action last in DOM order. |

Narrow tables stay **real tables** inside `.report-table-region` with a visible
`.report-scroll-hint` and a keyboard-focusable, labelled scroll region. Nothing
drops to a card list; nothing produces page-level horizontal overflow.
`html { min-width: 320px }` still holds.

## Accessibility

- Every control has a visible `<label>`; the bulk-add ticks are real
  `<input type="checkbox">` and the amount-source choice is a real radio group.
- Tabs and the selected ledger expose current state via `aria-current`. The
  active-destination cue must not rest on colour alone (ui-reconciliation A2).
- Activity table: `<th scope="col">` throughout and `aria-sort` on the sorted
  business-date column.
- Modals: `role="dialog" aria-modal="true"` with `aria-labelledby`, focus moved
  in on open, focus **trapped**, and focus **returned to the invoking control**
  on close. Note the shipped hazard recorded for the compensation and staff
  modals: autofocusing a field on `requestAnimationFrame` steals the next
  programmatic fill. Focus the dialog or its heading, not a field, unless there
  is a reason to focus a field.
- Live regions: `aria-live="polite"` on the balance, the ledger count, the
  activity count and the bulk selection count. `role="alert"` on conflicts and
  load errors only — one announcement per event, no nesting a live region
  inside another.
- All interactive targets at least `--touch-min`; fields at `--field-h`.
  Focus ring 3px `var(--focus)` at 2px offset, matching the shipped treatment.
- Bulk-add tick state is conveyed by the checkbox itself, not by row tint.
- Negative balance is announced by its literal label (`Negative balance`), not
  by colour.

## Copy

The complete string inventory is in `NOTES.md` and is the authority. Money is
pesos with two decimals (`₱1,234.50`); negatives render as `₱-1,275.50`, which
is what the shipped `formatMoney()` produces. Highlights:

- Page: `Journal` / `Track set-aside funds across closed business days.`
- Actions: `Add ledger`, `Suggestion settings`, `Save deposit`,
  `Save selected deposits`, `Try again`
- Empty ledger: `No activity yet` /
  `Record a deposit or withdrawal to begin this ledger.`
- Empty bulk add: `No deposits to add` /
  `Every eligible closed business day has a recorded deposit.`
- Duplicate deposit: `Deposit not saved.` +
  `Rent already has a deposit for October 1, 2026. The existing deposit was not changed.`
- Bulk conflict: `Nothing was saved.` +
  `Another deposit was recorded for October 7, 2026. Refresh the list and review your selections.`
- Name clash: `Names must be unique, regardless of letter case.` /
  `A ledger named "rent" already exists.`
- Validation: `Deposit amount cannot be negative.` /
  `Withdrawal amount must be greater than ₱0.00.`
- Settings: `Changes apply to business days on or after the calendar date of the change. Settings cannot be backdated.` / `The Rent rounding rule is fixed.`
- Delete: `Delete deposit?` +
  `Deleting this deposit makes October 1, 2026 un-recorded again.`

**One copy correction to make on implementation:** the mockup writes
`Saving selected deposits...` with three full stops. The shipped app uses the
ellipsis character throughout (`Signing in…`, `Checking administrator access…`).
Use `…`.

---

# Implementation handoff

This design is an **advisory implementation reference**, not a second layer of
acceptance criteria. The acceptance criteria on #467 and ADR 0018 remain
binding. Dev should list material deviations and the reason for each in the PR,
per #481 and #482.

## A. Inherited requirements — binding, not design choices

From the story's acceptance criteria and ADR 0018. The design renders these; it
does not create them, and it cannot relax them.

- Admin-only, enforced **per verb** by a class-level
  `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)` controller. Hiding
  the nav item is a courtesy; 403 is the boundary (ADR 0018 §8).
- `balance = startingBalance + Σ deposits − Σ withdrawals`, money as integer
  cents end to end. **The browser renders money and never derives it** — the
  suggestion arithmetic (`suggestRentDepositCents`,
  `suggestChairDepositCents`) is server-side in `packages/shared/src/money.ts`.
  The mockup's fixture totals are illustrative only.
- A deposit is eligible only for a **closed** business day on or after the
  ledger start date. Open days, pre-start dates, future dates and dates with no
  business day are not offered **and** are refused on a direct request with a
  clear message.
- One deposit per ledger per business day — the `@@unique([ledgerId,
  businessDate])` constraint. Recorded-ness *is* the row's existence: a saved ₱0
  marks the day, a delete un-records it.
- A ₱0 deposit is a real deposit. A `null` suggestion is not a ₱0 suggestion.
  **Do not flatten these.**
- Negative deposits refused; withdrawals must be `> 0`.
- A negative **balance** is allowed and must be shown.
- Bulk add is **all-or-nothing**; on conflict nothing is saved.
- Rate changes apply to business days on or after the **calendar date of the
  change**, via append-only effective-dated rows; the last save on a date wins
  for that date. Not backdatable. The Rent rounding rule is **not**
  configurable.
- A recorded deposit is immune to later changes in that day's gross or in
  Journal settings.
- A Journal entry is **not** a `CashMovement` and must not touch expected cash,
  cash movements or any sales record (ADR 0018 §7, asserted by integration
  test).
- Ledger names are unique **case-insensitively**.
- Accessibility obligations in the Accessibility section above are obligations,
  not recommendations: labels, `aria-current`, `aria-sort`, focus containment
  and return, live regions, `--touch-min` targets, non-colour state meaning,
  and `prefers-reduced-motion`.

## B. Advisory recommendations — Dev's call, with a reason

- **The three-level composition** (persistent overview / tabbed workspace /
  modals). The tabs in particular are a recommendation: they exist so a
  first-use bulk list covering the shop's whole trading history cannot push
  routine review off the page. If Dev finds a better answer to that problem,
  the problem is the requirement, not the tabs.
- Rendering an already-recorded day as `(already recorded)` rather than omitting
  it from the deposit day picker — it answers "why can't I pick that day?"
  without a trip to the activity table.
- Preserving ticks and typed amounts across a bulk-save conflict. The criteria
  require the save to fail atomically; they do not require the administrator to
  retype the batch.
- Presenting the Rent rounding rule as fixed read-only text rather than a
  disabled input.
- Showing the four recording conditions together in a `.journal-status-guide`
  block on the overview.
- The responsive table above, including keeping real tables in a focusable
  scroll region at every width rather than switching to cards.
- Placing the nav entry after Compensation and before Order History.

## C. Proposed material change to a shared shell or component — **one, and it is a rejection**

**The mockup's narrow-width admin navigation is wrong. Do not adopt it.**

`index.html:40` introduces an `.admin-menu-button` ("Menu") that turns the
admin sidebar into a triggered overlay below 900px. The shipped shell instead
turns `.admin-sidebar` into a **fixed bottom bar** at `max-width: 760px`
(`styles.css:2371`, `:2387`), and `docs/ui-reconciliation.md` records that
position as a deliberate **RETAIN** (finding A4): it is consistent across every
admin route, keeps 56px targets in thumb reach, and does not mix in the staff
strip.

The Journal must not change the shared admin shell. Implement the Journal
**inside** the existing `AdminLayout` and let the sidebar behave exactly as it
does on every other admin route. Treat the mockup's shell markup as scaffolding
that exists only so the page can be viewed standalone.

No other material change to a shared shell or component is proposed. Everything
else is additive: one nav entry, one `destinationName` entry, one route, one
feature directory, and `.journal-*` classes.

Also note: the mockup uses `.visually-hidden`; the shipped class is `.sr-only`.
And the mockup's modal backdrop uses `color-mix(in oklch, var(--fg) 48%,
var(--surface))` where the shipped rule is a literal
`oklch(15% 0.015 240 / 0.46)` (`styles.css:1738`). Keep the shipped rule — this
is not the story in which to change the backdrop.

## D. Findings — things a human should decide

These are named rather than invented, per the charter.

1. **No nav glyph means "set-aside fund."** `Icon` in
   `apps/web/src/catalog/components.tsx` exports `alert, bars, box, check,
   chevron, clipboard, document, edit, folder, grid, grip, plus, receipt,
   search, trash, users, wallet`. `wallet` is Compensation's and `document` is
   Reports'. Reusing either re-creates finding **A1** in
   `docs/ui-reconciliation.md` (five of seven admin destinations sharing one
   meaningless glyph), which is an open `CORRECT`. Options, for a human:
   add one glyph to `Icon` as part of #481, or give Journal no glyph. The
   design does not pick one.

2. **No token expresses the 228px admin rail.** The sidebar width is a literal
   in `styles.css` today. The nearest spacing token is `--space-8` (32px),
   which must not be repurposed. If it becomes reusable, propose
   `--admin-sidebar-w: 228px` — note `docs/ui-reconciliation.md` records the
   shipped width as 228px against 232px in some earlier references. Not changed
   here.

3. **No new colour, radius, spacing or touch token was needed.** Negative
   balance reuses `.variance-short` (`--danger` + a literal word) and the
   unsaved suggestion reuses `.compensation-suggested`. Both treatments #477
   asked about are already expressible in shipped tokens.

4. **`styles.css` and `docs/design/tokens.json` are out of sync, both ways.**
   Per the charter, `styles.css` is the shipped truth and a token present in
   only one of the two is a finding for a human:

   | Only in `styles.css` | Only in `tokens.json` |
   |---|---|
   | `--field-h`, `--touch-min` (as variables; `tokens.json` has them under `control.*` with different names) | `space.10` (40px), `space.12` (48px) |
   | `--cashier-card-min-h`, `--cashier-key-size` (`tokens.json`: `cashierPicker.*`) | `font.mono`, `font.display`, `font.body` |
   | `--logo-*` family (`tokens.json`: `logo.*`) | `levelSelector.*`, `staffShell.headerHeight`, `shadow.control` |
   | `--z-modal-backdrop`, `--z-modal` | |

   The sharpest one for this story: **`.num` hard-codes
   `ui-monospace, 'SFMono-Regular', Consolas, monospace`
   (`styles.css:3993`) while `tokens.json` declares `font.mono` as
   `JetBrains Mono, IBM Plex Mono, ui-monospace, Menlo, monospace`.** Every
   money column in the Journal lands on `.num`, so the Journal inherits the
   divergence. This story should **use `.num` as shipped** and not reconcile it
   — but somebody should decide which stack is correct.

5. **Negative money reads `₱-1,275.50`**, because `formatMoney()` puts the sign
   after the symbol. That is the shipped behaviour across every screen and the
   design keeps it, pairing it with the literal words `Negative balance` so the
   state never depends on reading a hyphen. If the sign placement is wrong, it
   is wrong app-wide and belongs in its own story, not here.
