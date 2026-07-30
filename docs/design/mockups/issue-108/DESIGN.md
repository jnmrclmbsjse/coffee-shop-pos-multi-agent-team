# Staff inventory workspace design

## Direction

A bright, tablet-first staff work surface with a compact top bar, full-width content, cool hairline structure, and deliberate 44px to 48px controls. It is a staff POS surface, not the 232px-sidebar admin back office.

## Design read

- Product UI for shop staff working standing at a counter.
- Preserve-mode extension of seven shipped UCM mockups.
- `DESIGN_VARIANCE: 4`: predictable placement, with enough hierarchy to distinguish work and review utilities.
- `MOTION_INTENSITY: 3`: no decorative motion; one short state-entry transition only.
- `VISUAL_DENSITY: 6`: compact but touch-safe.

## Shell

- Header shows the shop identity, `Staff`, signed-in staff, business date, and day/count context.
- The flat horizontal navigation is horizontally scrollable on small screens and can accept future items without changing the header structure.
- No cashier session is required. Count and movement forms identify staff locally.
- Main content is capped at 1440px but uses the available width.

## Counting

- Staff selectors appear before the sheet.
- Quantity rows use a large numeric field.
- Level rows use the eight-step radiogroup specified in `brand-spec.md`.
- Opening shows active Critical items only, alphabetically.
- Closing shows active Critical items first, then other active items, alphabetically within each group.
- Read-only submissions show all sheet rows, using `Not counted` where an item was omitted. The follow-up action is phrased as recording another count and starts a new blank sheet.

## Data presentation

- Restock uses a real table and a text-first four-value status scale.
- Level labels sit in the same Counted column as quantities but include a small `Level` qualifier so they are not read as unit quantities.
- Deliveries and wastage are an append-only table with no actions column.
- Narrow tables keep comparison structure in an overflow wrapper with a visible scroll hint.

## Blocking and errors

- A shared blocking panel replaces production controls when no business day is open.
- Errors begin with `No count was recorded.` or `No movement was recorded.`, state what remained unchanged, and tell staff what to do next.
- Review-state controls are visibly dashed, labeled `Mockup only`, and live outside production forms.

## Accessibility

- Semantic header, navigation, main, sections, forms, fieldsets, headings, status regions, and real tables.
- Skip link and 3px focus ring.
- Native radios expose selection for level and movement type controls.
- Status is always written as text.
- Movement updates and blocked submissions use polite live regions.

## Responsive behavior

- Landscape tablet is the primary layout.
- Content padding reduces from 32px to 16px below 768px.
- Count rows stack on phones. The eight-step selector changes from 8 columns to 4 and then 2.
- Header navigation scrolls horizontally without page-level overflow.
- Tables scroll inside their own region with sticky column headings.

## Future dark theme

The semantic tokens and component contracts can support a later dark theme for varying counter lighting. A dark palette must be designed and contrast-tested as a separate theme. It is noted here but not implemented.
