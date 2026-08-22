# UCM Coffee Studio POS issue 349

## Design read

This is a layout-geometry reference for an internal staff POS. It preserves the existing compact product chrome, system font, green accent, 4px spacing scale, and 6px/10px radii. It is not a visual restyle and is not intended for pixel matching.

The working dials are `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, and `VISUAL_DENSITY: 7`. The low variance and motion keep the reference legible to Engineering. The higher density reflects counter staff use on desktop and tablet.

## Geometry decision

The reclaimed band falls out of normal layout:

```css
.staff-inventory-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.staff-header {
  flex: none;
  position: sticky;
  top: 0;
}

.staff-content-track {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

#staff-main {
  flex: 1 1 auto;
  min-height: 0;
}

.take-order-page {
  height: 100%;
  min-height: 540px;
}

.take-order-state {
  min-height: 100%;
}
```

The header participates in the flex column at its real rendered height. The content track receives the exact remainder. Hiding `#staff-workspace-chrome` therefore gives its occupied height directly to the track without a measurement, token, or subtraction.

At widths up to 767px, Take Order switches to a stacked document-flow layout. The page and panes use natural height and normal document scrolling, so every product, order line, and action remains reachable without horizontal clipping.

## Transition recommendation

Make the geometry change instant. A POS operator asking for more room should receive it immediately. Animating height would repeatedly reflow two internal scroll panes and can make geometry assertions flaky mid-transition. The mockup uses no height animation and the chrome is genuinely `hidden`. Only short press and color feedback remain, and `prefers-reduced-motion: reduce` removes those transitions.

## Token recommendation

Delete `staffShell.headerHeight: 116px` from `docs/design/tokens.json`. It is a stale, unused literal that appears in no stylesheet and encodes the assumption this change removes.

Do not replace it with shown and hidden header-height tokens. A pair of literals can drift independently and cannot model wrapping at intermediate widths. Do not introduce a JS-measured `--header-height` custom property either. It adds timing, resize, hydration, and stale-value failure modes to a relationship CSS layout already knows. A layout-derived height has no stale-height failure mode by construction.

If a shell size token is retained, keep only the honest fitted-screen floor, such as `staffShell.fittedMinHeight: 540px`. Do not add color or spacing tokens for this work.

## Implementation handoff

This mockup is an advisory implementation reference, not an additional acceptance-criteria layer. Pixel matching is not the goal. The geometry and interaction relationships are the useful parts.

### Requirements

- Keep the persistent top bar and menu toggle visible in both states.
- Keep `aria-expanded` and `aria-controls="staff-workspace-chrome"` on the toggle. Apply the `hidden` attribute to the collapsed chrome so its controls leave the accessibility tree and tab order. Do not move focus when toggling.
- Preserve the skip link targeting `#staff-main`, 44px minimum touch targets, 3px focus rings using `--focus`, and keyboard access without traps.
- On widths above 767px, Take Order and its blocked/error states fill the post-header track. Their bottom edge must be within 2 CSS px of the viewport bottom in both menu states.
- Hiding the menu must increase the fitted operational height by the same amount the header shrinks, within 2 CSS px. Showing it must restore the first shown geometry within 2 CSS px, including after three cycles.
- Flow-height routes must move upward by the header delta without stretching short content to the viewport bottom.
- Preserve access to Take Order item selection, current order, and charge action; Order History filters and final row; Stock Counts count and completion; Cash & Expenses entry and submission; and Trading Day open/close action in both menu states.
- Use `scroll-margin-top` on page-scroll targets that can be brought into view beneath the sticky header. Do not reserve space with compensating page padding.
- Read `ucm.pos.nav-visible.v1` before initial rendering. The string `'false'` means collapsed. The initial frame must use that state without a second toggle or a wrong-height flash.
- Remove every `calc(100svh - N)` dependency from the fitted page and its states.

### Advisory

- Keep the reclaim instant. Limit any optional chrome exit treatment to a very short opacity/transform fade that does not animate occupied height, and remove it for reduced motion.
- Retain independent scrolling for the catalog and current-order list on desktop/tablet. Keep the order footer sticky within its pane.
- At 767px and below, use a stacked, naturally scrolling document. Do not squeeze the two-pane desktop model into a narrow viewport.
- Keep flow routes intrinsic-height. Honest background below short content is preferable to stretching a table or form.
- Treat the inspector as mockup-only. Production e2e tests can use the same DOMRect relationships without shipping the panel.

### Proposed material changes to shared shell/components

1. Change `.staff-inventory-shell` to a `min-height: 100dvh` flex column. Keep the sticky header as `flex: none`, then make the post-header content track `flex: 1 1 auto; min-height: 0` and a flex column whose `#staff-main` child can stretch. Reason: the browser allocates the exact remaining height for every real header wrap and menu state, then passes that definite track height to the route main.
2. Change `.take-order-page` from `height: calc(100svh - 128px)` to `height: 100%`, retaining `min-height: 540px`. Reason: Take Order should consume its parent track, not approximate viewport minus header geometry.
3. Change `.take-order-state` from `min-height: calc(100svh - 164px)` to `min-height: 100%`. Reason: closed-day, loading, and error states must use the same reclaimed track as the operational screen.
4. Remove the stale `staffShell.headerHeight: 116px` documentation token. Reason: a fixed header value conflicts with real wrapping and encourages new arithmetic dependencies.

## How to verify

The mockup inspector reads DOMRects after each render, toggle, and resize:

- `Track begins after header` compares the content-track top with the sticky header bottom. Target: difference no more than 2px.
- `Fitted bottom within 2px` compares the fitted operational-area bottom with `window.innerHeight`. Run it on Take Order, no-business-day, and load-failure screens in both menu states.
- `Area growth equals header delta` compares hidden fitted height minus shown fitted height with shown header height minus hidden header height.
- `Flow shift equals header delta` compares the operational content top in both states on Order History or its short-content variant.
- `Current state drift within 2px` compares header height, operational top, and operational height with the first captured geometry for that same state. Toggle through at least three full hide/show cycles.
- `Completed cycles` makes the three-cycle check explicit. `Reset references` starts a fresh measurement run.

In Playwright, reuse these same values from `getBoundingClientRect()` and `page.evaluate(() => window.innerHeight)`. Load once with `localStorage['ucm.pos.nav-visible.v1'] = 'false'` before navigation to verify the no-flash saved-preference path.
