# UCM Coffee Studio logout extension

## Design read

Preserve-mode, surgical extension of an existing internal POS product for engineers implementing issue #226 and design task #258. The artifact is a static documentation reference, not a redesign. Design variance is 3, motion intensity is 2, and visual density is 6 to match the established utility-first, information-dense shells.

## Bound visual system

The supplied production tokens, font stack, spacing, radii, target sizes, and shell structures are binding. No token values have been added or altered. The documentation canvas uses the same tokens so the product frames remain visually truthful. Inline SVG is used only for the small logo and door-arrow glyph required by the self-contained delivery format; the logout glyph uses an 18px viewport and 1.8 stroke width to match the stated navigation icon posture.

The page-level shape rule is the existing product rule: small controls use `--radius-sm`; dialogs and larger containers use `--radius-md`. The product remains light themed, as supplied. No section-level theme inversion is introduced.

## Placement recommendation (admin)

Extend the existing `.admin-sidebar-user` block. Keep its current identity row and add a quiet, full-width `Sign out` control directly below it. This is a material correction to the earlier task premise: the account area already exists, already sits outside `<nav>`, and is already pinned by `margin-top: auto`. The extension preserves that architecture rather than inventing a new account surface.

The rejected alternative is a new topbar account menu. It would introduce a disclosure pattern the product does not otherwise use and hide a rarely used but urgently needed control behind an extra click. The footer placement is persistent, legible, and away from catalog actions.

At the narrow breakpoint, the existing sidebar becomes a horizontal top rail. Identity and `Sign out` move into a stable account cluster at the right edge of that rail, outside the horizontally scrolling navigation. The control does not join the nav item set.

## Placement recommendation (staff, incl. how it is separated from the ordering flow and from the cashier concept)

Place `Sign out` at the far right of `.staff-workspace-context-row`, opposite the brand, with generous separation from the business-day context. It stays outside the horizontally scrolling `.staff-inventory-nav`, so a user tapping through an order cannot encounter it as a nav destination.

It also stays out of row 2. The active cashier control retains its existing `Change` and `Clear` actions. That row describes till handover state; `Sign out` describes browser session state. Keeping the two concepts in distinct header rows, with distinct labels and silhouettes, prevents session termination from being mistaken for changing or clearing the active cashier.

The rejected alternatives are placing logout beside the cashier indicator or rendering it as a nav pill. Both create a misleading conceptual association, and the nav-pill option also moves the action into a high-frequency touch path.

## Confirmation decisions and why they differ by role

Administrator logout has no confirmation. The action is outside the primary work path in a pinned footer, accidental activation is unlikely, and recovery costs one sign-in. A modal would add friction to the normal case.

Staff logout requires confirmation. A shared touch till is more exposed to accidental taps during service, and interruption is more disruptive. The centered dialog defaults focus to `Cancel`. Its body says: "Signing out ends your session on this browser. The active cashier on this till stays as it is." The green `Sign out` action ends the session; it does not mutate cashier selection. This role-specific difference is deliberate risk calibration, not an inconsistency.

## Interaction and states

Both controls use the same neutral outlined rest state, subtle surface hover, standard focus ring, and fixed footprint. Logout is reversible, so neither control uses a destructive visual treatment.

During the request, the control stays in place, becomes disabled, sets `aria-busy="true"`, shows the existing `.spinner`, and changes the label to `Signing out…`. Width is reserved to prevent layout shift. Static strips show rest, hover, focus-visible, and in-flight. The administrator strip also proves that an ellipsised long username cannot deform the control.

Successful administrator logout routes to `/sign-in`; successful staff logout routes to `/staff/sign-in`. Each destination contains one polite `role="status"` line reading `You have been signed out.` The status uses a neutral subtle surface because the operation succeeded.

The staff destination keeps the remembered-staff picker fully populated. Maria Santos remains visually identical to Ben Alonzo, Chelsea Reyes, and Dan Villanueva. No recent-state styling is added because the product does not retain such a state.

A stale protected tab redirects immediately to the correct sign-in route. It does not show an interstitial or a continuation dialog. Its status reads `Your session ended. Sign in to continue.` Unsaved form input is not preserved after a session ends. There is no draft restore, and the UI must not imply that work was saved.

## Responsive behaviour shown

The administrator narrow panel shows the collapsed top rail, horizontally scrolling nav, taller nav targets, and stable account cluster. The staff tablet panel keeps the three header rows, places identity and session action at opposite edges of the first row, permits day context to wrap, and retains a horizontally scrolling nav. Long staff display names use `overflow-wrap: anywhere`.

All multi-column documentation layouts collapse to one column below 768px. Product frames are clipped only by their explicitly labelled viewport boundary, not by their internal controls.

## Token answer (why no new token; why not `--danger`)

No new token is required. Existing surface, border, ink, focus, accent, radius, touch, field-height, spacing, and layer tokens cover every state.

Neither logout control uses `--danger`. Logout is reversible and does not destroy product data. Red would misclassify the action and collide with genuinely destructive treatments already in the product. The staff dialog uses `--accent` for the affirmative session action because it is the primary choice inside an explicit confirmation step, not because logout is destructive. Neutral `--surface-subtle` also covers both post-logout notices; warning and danger tokens would falsely imply failure.

## Accessibility obligations

- Every logout control has a minimum 44px target and an accessible name that matches its visible `Sign out` text.
- Focus-visible uses the product ring: `3px solid color-mix(in oklch, var(--focus) 55%, transparent)` with a 2px offset.
- Busy controls remain labelled, disabled, and expose `aria-busy="true"`; the spinner is decorative.
- The staff dialog has a labelled title, descriptive body, modal semantics in implementation, and default focus on `Cancel`.
- Successful and stale-session destination messages use `role="status"` and polite live announcement.
- Identity text truncates or wraps without obscuring controls. The admin username ellipsises; staff names wrap anywhere.
- Focus order follows the visual order. Session logout stays separate from nav and cashier controls.
- Reduced-motion mode removes the 160ms color transitions.

## Implementation handoff

This mockup is an ADVISORY implementation reference, not an additional set of acceptance criteria. Pixel matching is not the goal. Preserve the behaviours, semantic separation, and accessibility outcomes in the production component architecture.

### Requirements inherited from the story, ADRs, and accessibility obligations

- Provide a reachable, clearly named logout action in both protected workspaces.
- End the current browser session and land on the role-correct route: `/sign-in` for administrators and `/staff/sign-in` for staff.
- Keep the remembered-staff picker untouched after staff logout. Do not add or remove any remembered name, including the person who signed out.
- Keep active cashier selection untouched. Session logout must not call the cashier `Change` or `Clear` behaviour.
- Announce successful logout and stale-session redirect through a polite live region.
- Immediately redirect a stale protected tab. Do not display protected content behind an interstitial or imply that unsaved input was preserved.
- Provide targets at least 44px high, visible focus, keyboard reachability, and accessible names matching visible labels.
- During the request, prevent repeat activation, expose busy state, and avoid layout shift.

### Advisory interaction, layout, responsive, and visual recommendations

- Use the neutral outlined logout treatment and reserve accent for the staff dialog's confirmed primary action.
- Skip administrator confirmation; require staff confirmation with `Cancel` receiving initial focus.
- Keep session language rigidly separate from cashier language: `Sign out` for session, `Change` and `Clear` for till handover.
- At narrow widths, keep logout outside the horizontally scrolling nav in both shells.
- Keep success and stale-session notices neutral and dismissible by subsequent navigation.
- Preserve the 160ms ease-out color transition, with a reduced-motion override.

### Proposed material changes to existing shared shells/components

- Extend `.admin-sidebar-user` with a full-width logout button beneath the existing identity row. Reason: the account block is already pinned, outside navigation, and structurally appropriate for a session action.
- Add a right-hand session-action slot to `.staff-workspace-context-row`. Reason: this places logout away from ordering navigation and keeps it visibly separate from the cashier selection concept in row 2.
