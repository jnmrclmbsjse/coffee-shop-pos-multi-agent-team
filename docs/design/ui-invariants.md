# UI implementation invariants

These are regression guards for recurring implementation defects. They extend
the tokens in `docs/design/tokens.json`; they do not define a second visual
system.

## Compound form controls

When a prefix, suffix, or unit shares a box with an input, the outer wrapper
owns the border, radius, background, invalid state, and focus ring. The nested
input must have no border, radius, background, outline, or shadow in its
default, hover, and focus states. Use a selector strong enough to beat the
generic field rules that appear later in `apps/web/src/styles.css`.

Before shipping a compound control, check it inside every parent field class it
uses. A currency field that looks correct outside `.catalog-field` can regain a
second border inside it because of CSS specificity.

## In-panel view switches

Related views inside one workspace use the compact, contained tab treatment
defined by `.workspace-tabs`. Do not render them as bare labels on a full-width
divider. The active view needs a visible non-colour treatment, and every target
must remain at least 44 pixels tall unless the whole control is desktop-only.

## Wide tables on small screens

The page and panel must remain viewport-width. Only the labelled
`.report-table-region` may scroll horizontally. Every grid or flex ancestor on
that path needs `min-width: 0`; the scroll region needs a definite `width: 100%`
and inline overflow containment. Never disable browser zoom to hide overflow.

## Fixed navigation rails

A fixed-height sidebar keeps identity and sign-out controls in a non-shrinking
footer. The navigation list owns vertical overflow and must use `min-height: 0`.
On the mobile bottom rail, switch that same region to horizontal overflow and
hide vertical overflow so the sign-out target remains fully visible.
