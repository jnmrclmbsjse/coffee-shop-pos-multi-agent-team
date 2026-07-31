# DESIGN - Cash & expenses

UCM Coffee Studio staff POS workspace, preserve-mode extension.

Dials: `DESIGN_VARIANCE 4`, `MOTION_INTENSITY 2`, `VISUAL_DENSITY 6`.

## Preserve-mode audit

Preserved from issue-123:

- Brand lockup, Staff role tag, compact context bar and final-position nav.
- Bright cool page background, white panels and subtle secondary surfaces.
- One system font family with hierarchy from size and weight.
- Hairline borders, 48px fields, 44px minimum targets and fixed focus rings.
- Tablet-first 1440px workspace, 32px padding and 16px mobile padding.
- Neutral blocking panel for no open business day.
- Dashed Review states / Mockup only panel outside production controls.
- One 140ms state-entry opacity fade and reduced-motion override.

Preserved from issue-142:

- Dense read-only ledger, sticky subtle table header and hairline row divisions.
- Focusable labelled horizontal table scroll region.
- Clear literal empty state instead of placeholder rows.

No third-party design system was added because the project already binds a
complete native CSS system and prohibits dependencies and network requests.

## Business-day context

The date and day type sit in a `This entry will be written to` container above
the form. They are spans, not disabled fields, and have no chevron or calendar
affordance. This keeps the destination legible without implying choice.

## Type selection and accessibility repair

The three touch targets contain real radio inputs. Checked state is carried by:

1. Native programmatic radio selection.
2. A filled radio mark.
3. A stronger border and inset ring.
4. The literal word `Selected`.

This deliberately fixes the v1 styling-only selection defect.

## Category space reservation

The category field occupies a fixed-height slot. For Cash in and Cash out it is
hidden with `visibility: hidden`, `aria-hidden="true"` and a disabled input. For
Expense it becomes visible in place. The fields below do not jump when Type
changes.

## Permanent-entry affordance

Permanence appears immediately above the submit action, at the final decision
point: `Permanent record. Check the amount and reason before recording. Entries
cannot be edited, deleted or undone.` The panel subtitle repeats only the short
fact that entries are permanent. This avoids burying the consequence while not
turning the whole form into a warning.

## Ledger direction

Every Type cell combines a static boxed glyph and a full label:

- `+ Cash in` means adds to the drawer.
- `− Cash out` means reduces the drawer.
- `− Expense` means reduces the drawer.

Hue is not part of the distinction. Expense adds a dashed border to remain easy
to scan beside Cash out, but the literal label is always present.

## Pinned detail rendering

Exact visible rendering when an expense has a category:

`Supplies / Oat milk delivery`

Exact visible rendering when an expense has no category:

`Emergency ice purchase`

The without-category case renders only the reason. There is no dash, empty
parenthesis, label, placeholder or separator suggesting a category exists. Both
cases appear simultaneously in the default ledger.

## Historical attribution

`By` is plain snapshot text, never a link. The default fixture proves:

- `Unattributed`, a deliberate literal value.
- `Rina Lopez` with `Now Rina Santos` as historical context.
- `Benjie Cruz` with `Inactive staff` as historical context.

The optional selector contains active staff only. Historical names remain
understandable even when the current roster changes.

## Submission, duplicate prevention and rejection

Submitting disables every control and changes the action to `Recording...`.
Adjacent text says one entry is being recorded and the form is locked to prevent
duplicates. The handler ignores any second submit while locked. Completion uses
one prepend operation, so a retry cannot create two rows from one in-flight
submission.

A successful write announces confirmation and says the entry became the first
row. If the displayed day closes before completion, the write is rejected, the
ledger remains unchanged and an error explains that no entry was recorded.

## Money and validation

Money is stored and formatted as integer cents. Parsing accepts only digits with
an optional one- or two-digit fractional part. Blank, zero, negative,
non-numeric, over-precision and over-maximum values are rejected. No value is
silently rounded.

Amount and Reason use native required semantics plus `aria-required`. Inline
errors are associated through `aria-describedby`, invalid fields receive
`aria-invalid`, and focus moves to the first invalid control.

## Responsive behavior

Landscape tablet and desktop use a form-plus-ledger split. At 1050px the blocks
stack. Below 768px shell padding becomes 16px, type radios stack, the primary
action fills the width and the ledger preserves column comparison through its
own horizontal scroll. The page itself never scrolls horizontally.

## Motion

`MOTION_INTENSITY 2`. The only animation is a 140ms opacity fade for a newly
entered message or blocking state. It communicates state entry, not decoration,
and collapses under `prefers-reduced-motion: reduce`.

## Product note

A future correction workflow may be useful operationally, but it is explicitly
outside v1. No edit, delete, void or reverse control appears in this mockup.
