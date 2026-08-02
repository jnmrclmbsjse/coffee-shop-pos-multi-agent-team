# UCM Coffee Studio administrator sign-in

## Design read

This is a preserve-mode, surgical extension of an existing internal POS screen. The production layout, type, color, spacing, radii, content, and responsive behavior remain unchanged. The only new affordance is a persistent link to the staff authentication flow.

Design dials are `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, and `VISUAL_DENSITY: 5`. They reflect a stable, task-focused internal product with no decorative motion or visual re-composition.

## Bound visual system

The mockup uses the supplied production tokens verbatim: cool neutral surfaces, the existing green accent and focus colors, the existing Apple/Inter/system sans stack, 6px control radii, and the existing spacing scale. No new colors, fonts, radii, or tokens were introduced.

Observed posture rules:

- Preserve the split contextual shell at desktop and the stacked shell at 980px and below.
- Keep administrator context secondary to the sign-in task.
- Use green only for the established brand, primary action, and navigational focus treatment.
- Keep controls compact, rectilinear, and operational rather than promotional.
- Treat the caption bars as documentation outside the product frame, not part of the production UI.

## Placement recommendation

Place `Staff sign-in` in the header's right slot, after `Administrator access`, with `gap: var(--space-4)`. This is the clear recommendation.

The header placement matches the mirror-image administrator link on the staff sign-in screen and makes the route switch available on cold load before a person enters credentials. On desktop it sits in the same right-side visual zone as the form, without becoming part of the form or competing with the primary submit action. At 600px and below, the existing access label drops while the link remains in the header, which preserves navigation in the constrained layout.

The alternative placement beneath `.form-note` is not recommended. It would be closer to the user's form-reading path, but it would also visually associate route switching with form completion, place it near the primary submission sequence, and weaken symmetry with the staff screen. It is less discoverable before the user scans the full form.

The rendered text and accessible name are both exactly `Staff sign-in`. No helper copy accompanies it. The destination is self-explanatory and extra copy would add noise to the established shell.

At narrow widths, keep the staff screen's existing reduction to `padding: 0 var(--space-2)` and `font-size: 12px`. This maintains cross-screen symmetry and lets the brand and link share a 390px header without truncation. The `min-height: var(--touch-min)` rule remains unchanged, so the target stays at least 44px tall.

## Interaction and tab order

The link is a real anchor with `href="/staff/sign-in"` and sits outside the administrator `<form>`. Natural DOM order places it before the form controls: `Staff sign-in`, `Username`, `Password`, `Show password`, then `Sign in`. Enter activates the link as ordinary browser navigation. The link does not submit the form, mutate authentication state, or inherit an administrator return destination.

Hover uses `background: var(--surface-subtle)`. Keyboard focus uses the supplied 3px `color-mix()` ring with a 2px offset. The underlined `var(--focus)` text provides a non-color cue and retains the exact mirror-link treatment.

## Responsive behavior shown

- Default desktop keeps the 72px header and two-column `main-layout`.
- At 980px, the 64px header remains intact and the context panel stacks above the form; the access facts are hidden.
- At 390px, `Administrator access` is hidden, but `Staff sign-in` remains visible with its 44px minimum target. Context and form padding follow the existing 600px rules.

## Accessibility obligations

- Accessible name is exactly `Staff sign-in`, identical to the visible text.
- The affordance is an anchor to `/staff/sign-in`, not a scripted button.
- It is outside the form, cannot submit either sign-in form, and does not change authentication state.
- It is reachable by keyboard, activates with Enter, and has the specified visible focus ring.
- It remains visible without prior interaction at every supported width.
- It retains a minimum 44px touch height at every breakpoint.
- `var(--focus)` on `var(--surface)` is reinforced by an underline, so the link is not identified by color alone.
- Ordinary navigation preserves expected browser Back behavior and returns to the administrator sign-in screen with its form available.

## Implementation handoff

### Requirements inherited from the story, ADRs, and accessibility obligations

- Render visible text and the accessible name exactly as `Staff sign-in`.
- Use a real `<a href="/staff/sign-in">` with ordinary navigation semantics.
- Keep the anchor outside the administrator form so activation cannot submit the form or alter authentication state.
- Do not carry the administrator flow's pending `returnTo` destination into the staff flow. The staff link must remain the literal `/staff/sign-in` route.
- Keep the link keyboard reachable in natural order and provide the specified visible `:focus-visible` treatment.
- Keep it persistently visible on cold signed-out load without a menu, disclosure, hover, or prior interaction.
- Maintain a minimum 44px target height at every breakpoint.
- Preserve ordinary browser Back behavior so the administrator sign-in screen and its form remain available on return.

### Advisory interaction, layout, responsive, and visual recommendations

- Advisory: place the link in the header right slot after `Administrator access`, with `gap: var(--space-4)`. This best balances staff-screen symmetry, discoverability, and separation from the submit action.
- Advisory: retain the exact mirror-link visual treatment supplied in the story, including the subtle surface hover and focus ring.
- Advisory: at 600px and below, reduce horizontal padding to `var(--space-2)` and type to 12px while retaining `min-height: var(--touch-min)`. This matches the staff screen and avoids header crowding.
- Advisory: add no helper copy. The exact link label is sufficient.
- Advisory: keep natural header-first tab order, before username, password, password visibility, and submit controls.
- These recommendations are not acceptance criteria. Development may integrate differently when there is a documented product or code constraint, provided every inherited requirement above still holds.

### Proposed material changes to an existing shared shell or component

- Change the `.site-header` right slot from a single `.access-label` to a two-item `.header-access` group containing the existing label followed by the new anchor. Reason: preserve the existing header structure while adding a stable, symmetric route switch.
- Keep the existing `@media (max-width: 600px) { .access-label { display: none; } }` rule scoped only to `.access-label`. Explicitly exclude `.staff-sign-in-link` from that hiding behavior. Reason: the new route must remain visible at all widths, including the exact breakpoint where the contextual label disappears.
- Add the mirror-link styles as `.staff-sign-in-link`, or share the existing sign-in-switch link class if component boundaries permit without changing its rendered treatment. Reason: symmetric authentication screens should not drift visually.
- Blast radius: `.site-header` is shared by screens using `.app-shell`; in this codebase `.app-shell` is used by the sign-in screen, while the authenticated administrator area uses `.admin-shell`. The proposed group therefore affects the sign-in shell, not the authenticated administrator navigation. Verify any other unauthenticated `.app-shell` consumer before promoting the right-slot group into a shared component.
