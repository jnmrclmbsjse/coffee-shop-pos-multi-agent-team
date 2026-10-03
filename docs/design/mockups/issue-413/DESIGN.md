# Compensation pay-cutoff stepper

## Design read

Preserve-mode extension of a shipped, utilitarian POS admin screen for operators and implementers. The existing plain-CSS system, information architecture, copy conventions, and form hierarchy remain intact. Design dials are variance 3, motion 2, and density 5. This is an admin product surface, so the active frontend taste skill contributes its audit and pre-flight discipline only; it does not introduce a marketing-page design system.

The new control is a segmented stepper placed after the two date inputs. It reads as one compact date-range field, keeps both actions adjacent to the live value they change, and reuses the shipped field borders, radius, focus treatment, and caption style.

## Existing-screen audit

### Visual system

- Shipped source of truth: `apps/web/src/styles.css`.
- Foundation tokens: `--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--border-strong`, `--surface-subtle`, `--ink-soft`, `--accent`, `--accent-hover`, `--accent-pressed`, `--focus`, and `--danger`.
- Geometry: `--radius-sm` for form controls, `--radius-md` for the containing surface, `--touch-min` for touch targets, `--field-h` for report controls, and `--space-1` through `--space-8` for spacing.
- Typography: the shipped system stack at 16px and 1.5 body leading. Filter captions remain 11px, bold, muted, and uppercase with tracked letters.
- Existing IA remains `Daily records`, `Adjustments`, and `Payslips` inside `.compensation-sections`.

### Existing patterns preserved

- Daily records and Adjustments keep the existing `.compensation-filters` form, field labels, date labels (`From` and `To`), clear action, focus treatment, and results metadata.
- Payslip keeps its separate `.report-filter.payslip-filter` shape, copy block, field labels (`Start date` and `End date`), field help, and explicit `Generate payslip` submit action.
- The date range remains freely editable. The stepper never turns arbitrary dates into a false cutoff label.
- No component library, Tailwind layer, new icon dependency, or visual re-theme is introduced.

## Control decision

Use a segmented stepper: `‹ | readout | ›`.

This treatment is preferable to two detached text buttons because the actions and the range they modify behave as one field. It is more compact in a dense filter bar, makes direction scannable, and preserves room for the existing dates and clear or submit action. The visible glyphs are decorative. The exact accessible names are:

- Previous button: `Previous cutoff`
- Next button: `Next cutoff`
- Group: `Pay cutoff navigation`

The stepper has its own labelled grid cell with the caption `Pay cutoff`, using the same 11px caption treatment as the other fields. It follows the two date inputs in DOM order. This makes keyboard traversal: Staff member, From or Start date, To or End date, Previous cutoff, Next cutoff, then Clear filters or Generate payslip.

## Readout model

The `<output>` is the only `aria-live="polite"` node, so a step announces once. The containing group is labelled but not live.

- Exact first-half cutoff: `Oct 1 – 15, 2026`
- Exact month-end cutoff: `Oct 16 – 31, 2026`
- Custom complete range: `Custom range: Oct 3 – 12, 2026`
- Start present, end blank: `Custom range: Oct 3, 2026 to choose an end date`
- Both dates blank: `No range selected`

If the dates do not equal one complete cutoff, the `Custom range:` prefix prevents a false claim. Stepping uses the cutoff containing the selected start date. If start is blank, it uses the cutoff containing the shop date.

## Interaction model

- On view opening, each view initializes independently to the cutoff containing the Asia/Manila shop date. In this fixture, Oct 3, 2026 initializes Oct 1 through Oct 15, 2026.
- Previous and Next move one semi-monthly cutoff in either direction without bounds. They never render disabled.
- Month lengths are calculated from the calendar year and month, including leap years.
- Typing in either date updates the readout immediately but never auto-corrects the typed range.
- Stepping changes only Start and End. The staff selection is preserved.
- In Payslip, stepping does not generate or recalculate a payslip. `Generate payslip` remains the explicit submit action required by the existing flow.
- Clear filters clears staff and both dates for the list views. The next step then anchors to the current shop cutoff.

### States

- Default: `--surface` with `--border-strong`, matching existing fields.
- Hover: adjacent segment surface uses existing neutral tokens and text shifts to `--focus`.
- Focus-visible: 3px `--focus` outline with a 2px offset, matching the shipped explicit button-ring option.
- Active: `--accent-pressed` fill with `--surface` text.
- Disabled: not applicable and must not be implemented.

Motion is limited to short color and press feedback. It is removed under `prefers-reduced-motion: reduce`.

## Responsive model

### Wide desktop

Recommended `.compensation-filters` columns:

```css
grid-template-columns:
  minmax(var(--filter-staff-min), 1fr)
  repeat(2, minmax(var(--filter-date-min), .55fr))
  minmax(var(--stepper-min), auto)
  auto;
```

Order is Staff, From, To, Pay cutoff, Clear filters. The payslip form uses the same field order, ending with Generate payslip.

### 1024 x 768

At widths up to 1100px, both forms move to two equal columns. Staff spans the row; the two date fields share the next row; the stepper and final action occupy the following row. This prevents either date input from shrinking to an unsafe width.

### 390 x 844

At widths up to 700px, both forms become a single column. The stepper fills the available width, Clear filters aligns left, and Generate payslip fills the column. Every interactive target remains at least `--touch-min`. The payslip stepper uses `--field-h` so it aligns with the taller report fields; the list-view stepper uses `--touch-min`.

## Accessibility model

- Native buttons, inputs, selects, labels, and output are retained.
- Arrow glyphs are hidden from assistive technology; the buttons expose the exact action names in `aria-label`.
- The readout is the single polite live region. No parent live region duplicates its announcement.
- DOM order matches visual and keyboard order.
- All stepper buttons meet `--touch-min`; Payslip controls meet `--field-h`.
- Focus is never moved after stepping. The pressed button keeps focus while the readout announces the new range.
- Color is not the only state signal: hover, focus outline, pressed surface, text, and border all reinforce state.
- The fixture switcher is explicitly labelled as non-production UI and is outside the app surface.

## Token findings

`apps/web/src/styles.css` is the shipped truth. It carries variables absent from `docs/design/tokens.json`, including `--field-h`, `--touch-min`, `--cashier-key-size`, the `--logo-*` family, and `--z-modal*`. Implementation should not remove or replace those variables based on the JSON file.

The stepper does not require a new color, radius, spacing, touch target, or focus token. It uses the existing `--surface`, `--surface-subtle`, `--fg`, `--ink-soft`, `--border`, `--border-strong`, `--accent-pressed`, `--focus`, `--radius-sm`, `--touch-min`, `--field-h`, and space tokens.

The mockup defines named component sizing aliases such as `--stepper-min`, `--filter-staff-min`, and typography aliases because every stylesheet value is required to resolve through a variable. These are mockup-local aliases, not proposed global design tokens. The nearest shipped tokens cover their visual purpose, but no shipped token names the responsive minimum widths or caption/body sizes. A human should decide whether implementation keeps these values local to the component or promotes them into the shipped token set.

## Implementation handoff

### 1. REQUIREMENTS

Inherited from the story acceptance criteria:

- Cutoffs are day 1 through 15 and day 16 through the final calendar day of the month.
- A view defaults on opening to the cutoff containing the Asia/Manila shop date.
- Previous and Next step one cutoff without bounds across months and years.
- Previous and Next never have a disabled state.
- Hand-entered dates remain editable. Non-cutoff and incomplete ranges must not be labelled as an exact cutoff.
- Stepping from a custom range is relative to the cutoff containing Start date.
- Stepping with a blank Start date is relative to the cutoff containing the current shop date.
- Staff selection is preserved while stepping.
- Payslip stepping changes only its range. Generation remains explicit.
- Calendar arithmetic must not parse `YYYY-MM-DD` through `new Date(string)`. Parse numeric components and construct calendar strings directly.
- Month length must be calculated and must cover leap years.

Inherited architectural constraints:

- ADR 0013 remains unchanged: payslip is a computation over an arbitrary inclusive range. The stepper is a range-selection convenience, not a restriction to cutoffs.
- ADR 0014 remains unchanged by this story. No behavior in this mockup supersedes it.
- Preserve React 19, Vite, plain CSS custom properties, existing class names, section names, date labels, and submit semantics.

Accessibility obligations:

- Accessible action names are exactly `Previous cutoff` and `Next cutoff`.
- The changing readout uses one polite live region and must not be announced twice.
- Touch targets are never smaller than `--touch-min`.
- Focus-visible treatment must remain clearly visible and token-based.
- DOM, visual, and keyboard order must agree.
- Reduced-motion preferences must be respected.

### 2. ADVISORY

- Prefer the segmented treatment to detached text actions because it binds actions to the value they modify.
- Place the stepper after the dates and before the final action.
- Give it a `Pay cutoff` caption so it participates in the existing form-field rhythm.
- Use the two-column intermediate layout before the existing single-column narrow layout.
- Keep `--touch-min` height in list filters and adapt to `--field-h` in the payslip form.
- Use `Custom range:` and `No range selected` for honest degraded readout states.
- Keep visible arrows compact while using full accessible names.

### 3. PROPOSED MATERIAL CHANGE

#### `.compensation-filters` grid

Change the shipped four-column definition to five columns by inserting `minmax(var(--stepper-min), auto)` before the final `auto` column. Reason: the stepper is a peer filter field and must not compete inside either date field or become visually confused with Clear filters. Add a two-column intermediate reflow at 1100px before the existing single-column narrow treatment so the stepper cannot crush date inputs at 1024px.

`--stepper-min`, `--filter-staff-min`, and `--filter-date-min` are local mockup aliases. Dev may keep the corresponding concrete values component-scoped if the production token strategy does not accept layout minimums.

#### `.report-filter` form

Add the same stepper cell after End date and before Generate payslip. Use the same wide and responsive column logic, but set the stepper's internal height to `--field-h`. Reason: the component and behavior should remain shared while aligning to the shipped payslip form's taller controls. This change does not alter the submit button or ADR 0013's arbitrary inclusive range model.
