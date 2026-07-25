# UCM Staff Roster Mockup

## Theme

Light, restrained back-office product UI for a bright operational environment. The supplied UCM tokens are the visual contract.

## Layout

- Desktop: fixed 72px navigation rail, main workspace capped at 1360px, 40px outer padding.
- Tablet: desktop rail remains at 768px, main padding reduces to 28px.
- Phone: 60px top bar, fixed bottom navigation, 16px content padding.
- Data: semantic table above 760px; labeled records below 760px.
- Modal: centered dialog on desktop and a near-full-screen sheet on phone.

## Typography

System sans only. Page title is 28px at 700 weight. Body and controls use 14px to 16px with compact line height.

## Components

- Buttons and selects use 6px radii.
- Data, modal, empty, and no-results surfaces use 10px radii.
- Inputs are 48px high; all interactive targets are at least 44px.
- Focus uses a visible 3px `--focus` ring.
- Status uses a quiet text badge plus a labeled switch.

## Interaction

Search, filter, and sort compose over one roster state. Add and edit changes are staged in the dialog and committed only on save. Status changes happen inline and announce feedback. Prototype states are selected through a clearly separated mockup control or the `state` query parameter.

## Responsive behavior

At phone width the rail becomes a top bar and bottom navigation. Toolbar controls stack. Table rows become labeled records. Dialog actions stack with the primary action first visually while preserving sensible keyboard order.
