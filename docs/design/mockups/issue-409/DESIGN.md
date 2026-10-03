# Opening count — fill from the last closing count

Story #409 · Design Task #422 · mode: **spec** (`spec + token check`, Tech Lead
verdict — no Open Design run)

Screen: `apps/web/src/inventory/StaffInventoryPages.tsx` →
`CountSheetPage` rendered as `OpeningCountPage` (`phase="open"`), route
`/pos/opening`.

## Design read

This is an incremental addition to a screen that already exists and already
works. Nothing here replaces the count form, its grouping, its selectors, its
level scale or its submit path. Four things are added:

1. a **source banner** carrying the fill-all action,
2. a **per-item fill action** inside each eligible row,
3. a **"From last closing" field indicator**, and
4. a **no-source state** that replaces the banner when there is no closing
   count to fill from.

Only the indicator has no equivalent in the shipped app, and it is specified
below against an existing visual precedent (`.staff-page-heading-badge`) rather
than as a new visual idea.

The closing count screen (`phase="close"`) is untouched. Every selector below
is scoped so that it cannot reach it.

---

## Placement

The form body in `CountSheetPage` is, in source order:
`.staff-count-selectors` → `.staff-count-groups` → the lines error →
the Notes field → `.staff-inventory-actions`.

**The banner goes first, before `.staff-count-selectors`**, inside the
`form.staff-inventory-panel`. It is the sheet-level statement of where the
suggestions come from, so it must be read before the staff member starts
entering anything, and it must sit above the first count group so the fill-all
action is on screen at the top of the sheet.

It renders in the draft form only. The read-only `ReadOnlyCount` branch keeps
its existing `.staff-submitted-banner` and gains nothing — a submitted count has
nothing to fill.

**The per-item action and the indicator live inside `.staff-count-row`**, in the
control column, immediately below the control itself. See *Row structure*.

### Row structure (the one material markup change)

`.staff-count-row` (styles.css:6783) is a two-column grid —
`minmax(180px, 240px) minmax(0, 1fr)` — with exactly three children today:
the identity block, the count control (quantity `Field` or
`.staff-level-fieldset`), and the per-item note `Field`. With three children in
two columns the note auto-places into row 2 / column 1, under the identity.

Wrap the count control in a new block element so the row keeps exactly three
grid children:

```html
<div class="staff-count-row">
  <!-- CountItemIdentity, unchanged -->
  <div class="staff-count-control">
    <!-- the existing quantity Field, or the existing .staff-level-fieldset -->
    <p class="staff-count-fill-row">
      <span class="staff-fill-indicator" id="open-{itemId}-filled">…</span>
      <button type="button" class="staff-inventory-button secondary staff-count-fill">…</button>
    </p>
  </div>
  <!-- the existing note Field, unchanged -->
</div>
```

Adding the annotation as a fourth grid child instead would auto-place it into
row 2 / column 2 at the default width and into a separate stacked row at
≥1024px and ≤767px — three different positions for one element. The wrapper
gives it one position in all three layouts and leaves the existing
auto-placement of the note untouched.

`.staff-count-control` is `display: grid; gap: var(--space-2);` with no column
template, so it stacks. It needs no width rule: the existing
`.staff-count-row .staff-inventory-field { width: min(100%, 180px) }`
(styles.css:6822) still reaches the quantity `Field` through the wrapper, and
the level fieldset still fills the column.

`.staff-count-fill-row` is `display: flex; flex-wrap: wrap; align-items:
center; gap: var(--space-2); margin: 0;`. It is omitted entirely when the row
has neither an indicator nor an available fill action, so untouched rows keep
their current height.

---

## Components

Everything below cites something already shipped. Token **names** only — no
literal colours, spacings or radii are introduced.

| Element | Reuse | Notes |
|---|---|---|
| Source banner | `.staff-submitted-banner` (styles.css:6911) | Same accent-tinted strip, same flex/space-between layout, same "text left, secondary button right" pairing it already uses in `ReadOnlyCount`. Add the new class to that existing rule's selector list — `.staff-submitted-banner, .staff-fill-source-banner { … }` — plus its `@media (max-width: 480px)` companion (styles.css:9738). One rule, two names: no duplicated values to drift. |
| Fill-all button | `.staff-inventory-button secondary` (styles.css:6981) | `type="button"`. The form has `noValidate` and a real submit button; an untyped `<button>` inside a `<form>` defaults to `type="submit"` and would post the sheet. |
| Per-item fill button | `.staff-inventory-button secondary` + new `.staff-count-fill` modifier | The modifier only reduces the control: `min-height: var(--touch-min)` instead of the base `var(--field-h)`, `padding: 0 var(--space-3)`, `font-size: 13px`. It must not go below `--touch-min`. |
| Field indicator | new `.staff-fill-indicator`, modelled on `.staff-page-heading-badge` (styles.css:6625) | Same dashed-border annotation chip: `border: 1px dashed var(--border-strong)`, `border-radius: var(--radius-sm)`, `color: var(--ink-soft)`, `background: var(--surface-subtle)`, `padding: 4px 9px`, `min-height: 28px`, `font-size: 12px`, `font-weight: 750`, `white-space: nowrap`. The dashed edge is doing real work: it reads as provisional, where the solid-bordered `Critical` chip in `.staff-count-item-name span` (styles.css:6802) reads as a fact about the item. Do **not** reuse the Critical chip's rule — two chips with the same border in one row would be read as the same kind of thing. |
| Fill status line | `.staff-inventory-message success` (styles.css:7013) | Already the accent-tinted "something happened" strip. Rendered inside the banner block so the announcement sits where the action is. |
| No-source state | `.staff-inventory-message` base + the existing `.staff-count-notes-hint` voice | Neutral, not an error — there being no closing count yet is normal on day one. Do **not** use `.staff-inventory-blocking`: that is a full-screen takeover and the sheet is still perfectly usable by hand. |

No new token is required. Tokens used: `--accent`, `--border`,
`--border-strong`, `--surface`, `--surface-subtle`, `--ink-soft`, `--muted`,
`--radius-sm`, `--touch-min`, `--field-h`, `--space-1` … `--space-6`.

---

## Interaction

### State model

Two pieces of draft state beyond the existing `values`, both draft-scoped and
both discarded by `resetDraft()`:

- **`fillState: Record<itemId, 'filled' | 'touched'>`** — provenance, not value.
  A fill sets `'filled'`. Any `onChange` on that item's control (quantity input
  or level radio) sets `'touched'`, including a change that clears the field and
  including a change that lands on the same value.

Derived rules, all three criteria falling out of one predicate:

- **Indicator is shown** for item *i* iff `fillState[i] === 'filled'`.
- **A field is fillable** iff it has a source value **and**
  `values[i]` is `undefined` or `''` **and** `fillState[i] !== 'touched'`.
- **A quantity of `0` and a level of `EMPTY` are values**, because both are
  non-empty strings in the existing `Record<itemId, string>` draft (`'0'` and
  `'EMPTY'`). This needs no special case; it needs the emptiness test to be
  `=== ''`, never falsiness. This is the single most likely way to get the story
  wrong.

### Fill all from last closing count

| Trigger | Result |
|---|---|
| Press, with at least one fillable field | Every fillable field takes its source value; each gets `fillState = 'filled'` and its indicator. Fields holding a value, and fields marked `'touched'`, are left exactly as they are. Status line: `Filled 7 items from the closing count of Oct 2, 2026.` (`1 item` when one). |
| Press, with nothing fillable | Nothing changes. Status line: `No empty fields to fill.` |
| No closing count exists | The button is not rendered at all (see *No-source state*). |

Filling a quantity item also **enables its note field**, which is disabled while
the item is uncounted (`StaffInventoryPages.tsx`, the note `disabled` test). No
extra work — it is derived from `values` — but it is a visible consequence of a
fill and the e2e should see it.

Filling does **not** touch `submittedBy`, `shiftLead`, the sheet notes, or any
item note, and it records nothing. Nothing reaches the API until submit.

### Fill this item

| Trigger | Result |
|---|---|
| Press | That item's field takes its source value, `fillState = 'filled'`, indicator appears. Status line: `Filled Oat milk 1L from the closing count of Oct 2, 2026.` No other row changes. |

The per-item button **is rendered only when that item is fillable** — source
value present, field empty, not `'touched'`. It therefore disappears the moment
it has done its job, or the moment the staff member types in that field.

This extends the criteria's own "is not shown" idiom to every case where the
action would do nothing, so the screen never carries a control that looks
actionable and is inert. It is listed as an advisory decision in the handoff,
because the criteria mandate absence only for the no-source item.

Fill-all is deliberately **not** governed by the same rule: it stays on screen
whenever a closing count exists, because its availability is a fact about the
source, not about a draft state that changes with every keystroke. A top-level
button that appeared and vanished as the sheet filled would be worse than one
that occasionally says `No empty fields to fill.`

### Changing a filled value

Any change to the control removes the indicator for that field and marks it
`'touched'`, permanently for that draft:

- typing a different quantity → indicator gone;
- typing the same quantity over itself → indicator gone (provenance, not value);
- clearing the quantity → indicator gone, field empty, and **no later fill
  refills it**, which is the criterion's "intentionally blank";
- choosing a different level → indicator gone. (A level radio cannot be cleared
  by the UI, so the clear case is quantity-only in practice.)

**Pinned corner** (QA attempt 2 flagged this as deliberately unsettled by the
criteria): a field that was filled, then cleared, then retyped by hand to the
identical closing value does **not** get its indicator back. The indicator
states where the value came from, and that value came from the keyboard. This
also keeps one rule instead of two — once `'touched'`, always `'touched'` for
the life of the draft.

### Record another opening count

`onRecordAnother` runs `resetDraft()` then `setRecordingAnother(true)`, so the
new draft is blank and `fillState` is empty. The banner, both fill actions and
all the rules above apply unchanged, and the source is still the last submitted
**closing** count — never the opening count being replaced. The banner carries
one extra sentence in this state so the staff member is not misled about what
they are about to copy in; see *Copy*.

### Submit

Unchanged. `toCountLines` reads `values` and knows nothing about `fillState`.
No fill marker is sent, stored or shown anywhere, by the story's explicit
decision.

### States summary

| State | What the staff member sees |
|---|---|
| Loading | Existing `LoadingState`. The banner is part of the loaded sheet; nothing new renders early. |
| Load error | Existing `LoadError`. Unchanged. |
| No business day open | Existing `NoOpenDay`. Unchanged — no banner. |
| No active Critical items | Existing empty message. Unchanged — no banner. |
| Draft, source present | Banner + fill-all + rule text; per-item actions on fillable rows. |
| Draft, no source | No-source message. No fill-all, no per-item action anywhere. |
| After a fill | Indicators on filled fields; status line in the banner block. |
| Submitting | Every fill control takes the same `disabled={isSubmitting}` as the rest of the form. Indicators stay visible — they are not controls. |
| Submitted (read-only) | Existing `ReadOnlyCount`. No banner, no indicators, no fill actions. |

---

## Responsive

Use the breakpoints `styles.css` already uses on this screen: **1024px**
(two category columns, `.staff-count-row` collapses to one column),
**1000px** (level scale to 4 columns), **767px** (`.staff-count-row` to one
column, panel padding down), **480px** (level scale to 2 columns, buttons go
full width).

| Width | Behaviour |
|---|---|
| ≥1024px | `.staff-count-groups` is two columns and `.staff-count-row` is already single-column there (styles.css:6772). `.staff-count-control` stacks control → annotation. Nothing new to add. |
| 768–1023px | Row is identity | control. The annotation strip sits under the control inside column 2, so it never widens the identity column and never shifts the control. |
| ≤767px | Row is one column (styles.css:7769). Identity, then control, then annotation, then note. Natural reading order. |
| ≤480px | **Needs one override.** `@media (max-width: 480px)` sets `.staff-inventory-button { width: 100% }` (styles.css:9760). That is right for the fill-all button in the banner and wrong for the per-item button, which would become a full-width bar under every eligible field. Add `.staff-count-fill { width: auto; }` inside that same media block. |

Nothing scrolls in its own container; nothing is dropped at any width. The
banner already wraps (`flex-wrap: wrap`) and already switches to
`align-items: flex-start` at 480px through the rule it shares.

The per-item button must keep `min-height: var(--touch-min)` at every width,
and the annotation strip sits **below** `.staff-level-options`, never beside
it — so it cannot overlap the level labels, which are the real click targets
(`.staff-radio-option label`, with the input visually hidden).

---

## Accessibility

- **The indicator is associated, not adjacent.** Give it a stable id —
  `open-{itemId}-filled` — and put that id in the control's
  `aria-describedby`: on the `<input type="number">` for a quantity item, and on
  the `<fieldset class="staff-level-fieldset">` for a level item, so it is
  announced once for the group rather than eight times. Remove the id from
  `aria-describedby` when the indicator is removed.
- **The indicator's own text is terse on screen and complete to a screen
  reader**: visible `From last closing`, with an `.sr-only` continuation naming
  the business date (see *Copy*). The visible chip cannot carry the date in
  every row without turning the sheet into noise.
- **Fill-all changes many fields at once.** Announce it: the status line is a
  `role="status"` region (polite) that lives in the banner block and is present
  in the DOM from first render, empty, so the first announcement is an update
  rather than an insertion. Both actions write to the same region. It is
  visible text, not `.sr-only` — a sighted staff member also benefits from
  being told how many fields moved.
- **Both buttons are `type="button"`.** The form submits on Enter; a fill action
  must never be what Enter does.
- **Accessible names carry the item.** The visible per-item label is short, so
  give the button an `aria-label` of
  `Fill {item name} from last closing count` — a list of identical
  `Fill from last closing` buttons is unusable in a button-list rotor.
- **Focus does not move** on either fill. The staff member stays where they
  are; the status region tells them what happened. Moving focus into the first
  filled field would be worse — it fights the top-to-bottom pass they are in.
- **Focus order** follows the DOM: banner text → fill-all → the selectors →
  each row's control → that row's fill button → that row's note. The fill button
  after the control it refills is the right order, since the control is what the
  staff member reaches for first.
- **No colour-only meaning.** The indicator is a word, the status is a sentence,
  the no-source state is a sentence. Removing all colour loses nothing.
- **Disabled parity.** Both fill buttons take `disabled={isSubmitting}` with the
  rest of the form; without it they stay pressable during a submit and can
  mutate the draft the submit is reading.

---

## Copy

Exact user-facing strings. No money appears on this screen, so the peso
convention does not arise. Dates are rendered by the existing
`formatBusinessDate` (en-PH, `dateStyle: 'medium'`, `Asia/Manila`) and are
always the real business date of the source count — never "yesterday", which
would be wrong whenever the shop was closed.

### Banner, source present

- Heading: `Fill from the last closing count`
- Detail: `Closing count for {date}, submitted by {name}.`
  — e.g. `Closing count for Oct 2, 2026, submitted by Rina Dela Cruz.`
  `{name}` is `submittedByNameSnapshot`, which the submitted count already
  carries.
- Button: `Fill all from last closing count`
- Rule text, verbatim from the acceptance criteria:
  `Fills only untouched empty fields. Values you entered are kept.`

### Banner, correction pass only (`recordingAnother`)

Appended as a second detail line:

- `This replaces the opening count you already submitted. Filling still uses the last closing count, not that opening count.`

### Status region

- Many: `Filled {n} items from the closing count of {date}.`
- One: `Filled 1 item from the closing count of {date}.`
- Per item: `Filled {item name} from the closing count of {date}.`
- Nothing to do: `No empty fields to fill.`

### Per-item action

- Visible label: `Fill from last closing`
- Accessible name: `Fill {item name} from last closing count`

### Field indicator

- Visible: `From last closing`
- `.sr-only` continuation, inside the same element:
  ` — from the closing count of {date}`

### No-source state

- `No previous closing count. There is nothing to fill from yet, so enter this opening count by hand.`

---

## Token findings

The Design Task asked for a token check. Reporting what the two views actually
hold today; a human decides which way each reconciles. None of these blocks
#424 — the spec above names only tokens that exist in `styles.css`.

**In `styles.css`, absent from `docs/design/tokens.json`:**

- `--z-modal-backdrop` (`30`), `--z-modal` (`40`). The only two shipped custom
  properties with no token-file counterpart.

**In `tokens.json`, with no custom property in `styles.css`:**

- `space.10` (40px), `space.12` (48px) — the `--space-*` ladder stops at
  `--space-8`.
- `font.mono` — no `--font-mono`. `styles.css` repeats a literal mono stack in
  five places, and it is a *different* stack (`ui-monospace, 'SFMono-Regular',
  Consolas, monospace`) from the token's (`JetBrains Mono`, `IBM Plex Mono`, …).
  The token file is describing a family the app does not load.
- `levelSelector.gap` / `minHeight` / `radius` — duplicates of `--space-1`,
  `--field-h`, `--radius-sm`, which is what `.staff-level-options` and
  `.staff-radio-option` actually use.
- `staffShell.headerHeight` (116px) — no custom property.
- `shadow.control` — no `--shadow-control`; `.staff-inventory-button.primary`
  writes its own `box-shadow` inline in CSS.

**No type-scale tokens exist in either view.** Every `font-size` in
`styles.css` is a literal, including the 11/12/13px meta sizes this screen
already uses. The new indicator therefore specifies `font-size: 12px` as a
literal, matching `.staff-page-heading-badge`, because there is no token to
name. This is a finding, not an invention: it is the shipped convention, and
adding a type scale is a system-wide change no single story should make.

**Correction to the Design Task's premise:** `--touch-min` and `--field-h` *are*
present in `tokens.json` (`control.minimumTouchTarget`,
`control.fieldHeight`), as are the whole `--logo-*` family (`logo.*`) and
`--cashier-key-size` / `--cashier-card-min-h` (`cashierPicker.*`). The
divergence list in the charter and in #422 is stale on those; the real gaps are
the two above.

---

## Implementation handoff

### Requirements inherited from the story, ADRs, and accessibility

These are binding. They restate #409's criteria and the project's standing
rules — they are not this document's additions.

1. One sheet-level action fills every eligible item from the last submitted
   closing count; each eligible item also has its own single-item action.
2. Fill actions fill only untouched fields that have no value. A quantity of
   `0` is a value. A level of `EMPTY` is a value.
3. The screen states the rule next to the fill-all action, verbatim:
   `Fills only untouched empty fields. Values you entered are kept.`
4. Quantity items take the closing quantity; level items take the closing level.
5. The source is the most recently submitted correction for that business date,
   never a superseded count.
6. A banner names the business date of the source closing count and the staff
   member who submitted it.
7. Each filled field shows a `From last closing` indicator, removed when the
   staff member changes the value, including when they clear it.
8. A field changed and then cleared is not refilled by any later fill action in
   that draft.
9. An item with no value in the last closing count stays empty, shows no
   per-item action, and is not touched by fill-all.
10. With no closing count at all, neither action is shown and the screen
    explains why.
11. Filled values are suggestions. Nothing is recorded until submit, and the
    submitted record is identical to a typed one — no filled-vs-typed marker in
    the payload, the schema, or any administrator view (story Scope Notes).
12. The `Record another opening count` draft offers the same actions under the
    same rules, sourced from the last closing count.
13. ADR 0001: counts stay append-only and the submit path is untouched. No
    delivery or wastage arithmetic is applied to the source values.
14. Accessibility: the indicator is associated with its control via
    `aria-describedby`; fill-all is announced through a polite live region;
    both buttons are `type="button"`; the per-item control keeps
    `min-height: var(--touch-min)` and never overlaps the level labels.

### Advisory — this document's recommendations

Dev may deviate with a reason; Tech Lead reviews the deviation, not the pixels.

- **Provenance state, not value comparison.** `fillState` as `'filled' |
  'touched'` satisfies every criterion above with one predicate and settles the
  corner the criteria left open (cleared, then retyped to the identical value →
  no indicator). A value-comparison implementation would satisfy the written
  criteria too and answer that corner the other way.
- **The per-item action is rendered only when it would fill something** — i.e.
  hidden once its field has a value or is `'touched'`, as well as when the item
  has no source value. The criteria mandate absence only for the no-source
  item. **This is the one advisory choice worth an explicit Tech Lead nod**,
  because it changes what QA's e2e asserts on a row that has already been
  filled.
- Fill-all stays rendered whenever a source exists, and reports
  `No empty fields to fill.` rather than disappearing.
- Status line as a visible `role="status"` region inside the banner block,
  present-but-empty from first render, shared by both actions.
- Focus stays put after a fill.
- Banner placement above `.staff-count-selectors`; no-source message in the
  same position.
- The extra correction-pass sentence in the banner.
- All copy in the *Copy* section.
- Responsive treatment, including the required
  `.staff-count-fill { width: auto }` override at ≤480px.

### Proposed material changes to existing shared shells or components

Three, all additive, all scoped to the opening count screen. Each is recommended
rather than assumed.

1. **`.staff-count-row` gains a wrapper around the count control**
   (`.staff-count-control`), taking the row's second grid child slot.
   *Reason:* the row is a two-column auto-placed grid with three children in
   three different arrangements across the 1024 / 767 breakpoints. Without the
   wrapper, the annotation lands in a different place in each. With it, the
   annotation has one position everywhere and the note's existing placement is
   unchanged. `.staff-count-row` itself is shared with the closing count screen
   and with `ReadOnlyCount` — the wrapper is added **only** in the draft branch
   of the opening phase, so neither is affected.

2. **`.staff-submitted-banner`'s rule gains `.staff-fill-source-banner`** in its
   selector list, in both the base rule (styles.css:6911) and the 480px rule
   (styles.css:9738).
   *Reason:* the two banners are the same object — accent-tinted strip, text
   left, secondary action right. Copying the declarations into a second rule
   would duplicate seven values across two breakpoints and is exactly the drift
   `docs/ui-reconciliation.md` exists to clean up after. Sharing the rule means
   a later change to one changes both, which is the intent.

3. **A new `.staff-fill-indicator` chip**, derived from
   `.staff-page-heading-badge`'s dashed-annotation treatment.
   *Reason:* this is the element Tech Lead flagged as having no equivalent.
   `.state-badge` is an order-state pill and `.staff-count-item-name span` is a
   solid-bordered fact about the item; a provisional, removable, field-scoped
   annotation is a third thing. Deriving it from the existing dashed badge keeps
   it inside the shipped visual language instead of starting a fourth chip
   style. It reads only from shipped tokens, plus the 12px literal explained
   under *Token findings*.

Not proposed, and deliberately: no change to `submitStockCount`, to
`toCountLines`, to `resetDraft`'s contract, to the level scale, to the note
field's disabled rule, or to the closing count screen.
