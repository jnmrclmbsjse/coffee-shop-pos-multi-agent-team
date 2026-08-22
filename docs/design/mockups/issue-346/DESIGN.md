# Story #346 — Admin compensation adjustments & payslip PNG export

Advisory implementation reference for
[#346](https://github.com/jnmrclmbsjse/coffee-shop-pos-multi-agent-team/issues/346)
(Design Task #353). Open `index.html` in a browser; every section has a state
switcher so each acceptance criterion can be inspected as a discrete state.

**This mockup is an implementation reference, not a second set of acceptance
criteria.** The story, the ADRs, and the accessibility obligations below are
binding. Everything under "Advisory recommendations" is a considered default
that Dev may deviate from with reason; Tech Lead reviews the deviation, not the
pixels.

## Files

| File | Contents |
| --- | --- |
| `index.html` | Six annotated sections (A–F) with per-section state switchers |
| `styles.css` | Presentation, built on the existing `docs/design/tokens.json` custom properties |
| `app.js` | Static state fixtures and the switcher; no build step, no dependencies |

## Sections and states

| Section | States | Criteria exercised |
| --- | --- | --- |
| A. Placement | Recommended, Daily-records alternative | — (structural recommendation) |
| B. Adjustments list | Default, No adjustments yet, No filter matches, Deleted | 1, 7, 8 |
| C. Add / edit dialog | Add, Kind = Advance, Preset then edited, Description empty, Description over 120, Amount missing / negative / non-numeric / sub-centavo, Submitting, Edit pre-populated | 1–8 |
| D. Delete confirmation | Confirmation, Deleting, Deleted | 8 |
| E. Payslip | With adjustments, Negative net payable, Only advances, No records in range, Loading | 9–13, 16 |
| F. PNG download | Ready, Preparing, Downloaded, Failed, Empty range | 14, 15, 16 |

## Implementation handoff

### Requirements inherited from the story, ADRs, and accessibility

These are not design opinions. They restate obligations that already exist.

- **ADR 0014 arithmetic.** Amounts are stored positive; kind supplies direction.
  `netPayableCents = earningsTotalCents - advanceTotalCents`, may be negative,
  and is never clamped, hidden, carried forward, or treated as an outstanding
  balance (criterion 12). `grandTotalCents` keeps its shipped
  salary-plus-commission meaning (criterion 11).
- **Money in integer centavos** (ADR 0001). The peso strings in `app.js` are
  display fixtures only; never introduce a float in the write or total path.
- **Descriptions are verbatim free text.** Presets prefill the field and are
  shared UI constants from `packages/shared` — no stored code, no enum, no
  closed list. Trim leading/trailing whitespace only; preserve case and
  internal spacing (criterion 4).
- **Validation must identify the offending field** (criteria 5, 6): empty or
  whitespace-only, over 120 characters, zero, negative, sub-centavo, missing,
  and non-numeric amounts are all refused. No business maximum on otherwise
  valid amounts.
- **Duplicates are legal.** Identical kind, date, amount, and description rows
  each persist, display, and total separately (criterion 7). There is
  deliberately no "possible duplicate" warning state; adding one would
  contradict the model.
- **Date-range boundaries are inclusive** on both ends (criterion 9).
- **No PNG offered for an empty result** (criterion 16). Section F's Empty range
  state shows the button absent, not disabled — there is no artifact to export.
- **PNG filename** `payslip-<staff-name>-<from-date>-<to-date>.png` with a
  filename-safe staff slug (criterion 14).
- **PNG contents** must carry staff member, inclusive range, every displayed
  item, all displayed totals including net payable, and a visible generation
  timestamp, matching the on-screen payslip (criterion 15).
- **Admin-only.** The existing `JwtAuthGuard` + `RolesGuard` + `Role.ADMIN` on
  `CompensationController` governs this; the PNG is client-side and has no
  endpoint (criterion 17). Nothing in this mockup adds an authorization surface.
- **Accessibility (binding).** Errors are reachable as text, not colour alone:
  every invalid field carries `aria-invalid` plus an `aria-describedby` error
  message, and the dialog leads with an `role="alert"` summary linking to the
  field. Kind is conveyed by badge text and a signed amount as well as hue.
  Controls meet the 44px `control.minimumTouchTarget` token. Dialogs are
  `role="dialog" aria-modal="true"` with a labelled title; async regions use
  `aria-busy` / `role="status"`.

### Advisory recommendations

Interaction, layout, and visual choices Dev may adjust:

- **Placement (A):** add **Adjustments** as a third segment in the existing
  Compensation switch, beside Daily records and Payslips. The rejected
  alternative is previewed for comparison: folding dated money rows into daily
  work records blurs two different lifecycles.
- **List defaults (B):** current calendar month, newest effective date first,
  with a persistent "Showing N adjustments from … to …" line. When filters
  produce nothing, keep the filters visible and offer Clear filters rather than
  silently resetting them.
- **One form for all three kinds (C):** kind is a three-way control; description
  stays a required editable text field in every kind. Preset chips are
  `aria-pressed` buttons that only fill the field. A live `n / 120` counter
  turns over-limit before submit.
- **Delete (D):** repeat staff, date, kind, description, and amount in the
  confirmation and state plainly that the delete is permanent with no undo.
- **Payslip shape (E):** earnings above a rule, advances below it as the only
  deduction, net payable as the dominant total. Recommendation: keep
  `grandTotalCents` in the API response but do not render it beside the earnings
  total — two near-identical subtotals invite misreading. If the PO wants it
  visible, label it explicitly as salary plus commission.
- **Negative net payable (E):** render with an explicit minus and a distinct
  treatment; the "Only advances" state covers a range with no earnings at all.
- **PNG capture (F):** put Download PNG in the artifact header, appearing only
  after a successful non-empty generation, and capture the same node the admin
  sees (`#payslip-capture-node` in the mockup). A failed rasterization should
  leave the on-screen payslip untouched and offer a retry.
- **Rasterization safety (F):** DOM-to-image output can drift when web fonts are
  mid-load, when the renderer cannot resolve `oklch()`, or when shadows and
  gradients are approximated; scroll containers can clip. Recommendation:
  capture a self-contained node with no horizontal scroll region, rely on the
  system font stack already in the tokens, and flatten unsupported paint effects
  into an export-only stylesheet if testing shows a mismatch. **Criterion 15 is
  the requirement; this technique is only the suggested way to satisfy it.**
- **Responsive:** the adjustments table is wrapped in a labelled, focusable
  `role="region"` scroll container so it degrades on narrow admin windows. The
  payslip artifact deliberately does not scroll horizontally, because it is the
  capture target.

### Proposed changes to shared shells or components

- **None.** Everything reuses the shipped admin shell (`ProtectedRoute` /
  `AdminLayout`), the existing Compensation segmented switch, and existing
  modal, table, notice, form-field, and empty-state patterns. The new pieces —
  kind badge, preset chips, signed amount, payslip artifact zones — are local to
  `apps/web/src/compensation/`. No shared component named in the Tech Lead
  breakdown needs modification, and no new design token was introduced;
  `styles.css` consumes the existing `docs/design/tokens.json` values only.
