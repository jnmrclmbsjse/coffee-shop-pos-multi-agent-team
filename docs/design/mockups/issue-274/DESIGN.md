# Sign-out availability on cold entry into a deep-linked workspace screen

Issue #274 (story) · #280 (design task) · advisory implementation reference.

Artifact: [`index.html`](./index.html) — self-contained, no build step, no
external assets. Open Design project `ucm-coffee-pos-issue-274`
(local preview: `http://127.0.0.1:49991/api/projects/ucm-coffee-pos-issue-274/raw/index.html`,
served only while the Open Design daemon is running).

## Design read

Preserve-mode review of an existing internal POS, produced for the engineers
implementing #274. No new screen, no new component, no relocation of an existing
control. Design variance 3, motion intensity 2, visual density 6, matching the
established utility-first shells. All 13 supplied production colour tokens are
reproduced verbatim; none were added or altered.

## Why this design task is a review rather than a mockup

Tech Lead's feasibility finding is that application code is already correct:
both shells render their sign-out control on every protected route, and
`AuthContext` re-reads `GET /auth/session` on mount, so a refresh rehydrates the
session. The defect is at the CDN edge — the entry document shipped with no
`Cache-Control`, CloudFront cached a separate copy per URL path, and the deploy
pipeline invalidated only `/` and `/index.html`, so deep paths kept serving a
previous build's `index.html` (a pre-logout app). The fix lands in
`deploy/nginx.conf` and the deploy invalidation, not in UI.

So the deliverable is the two things #280 actually asked for: a placement
confirmation and one first-paint decision.

## Deliverable 1 — placement is unchanged (confirmed, no deviation)

Both shells wrap every protected route, so entry path affects route content only,
never the location of identity or sign-out chrome. The artifact shows this with
two truthful frames:

- **Administrator product catalog**, cold direct entry at 1440×900.
  `AdminLogoutControl` remains a quiet, full-width outlined button directly
  beneath the identity row in the pinned `.admin-sidebar-user` footer.
- **Staff point-of-sale order screen**, cold direct entry at 1280×800.
  `StaffLogoutControl` remains at the far right of header row 1, opposite the
  brand and outside the horizontally scrolling `.staff-inventory-nav`.

Route content inside each frame is deliberately stubbed — it is outside this
review. No deviation from today's placement was found, and none is proposed.

## Deliverable 2 — first-paint decision: keep the full-screen loading state

**Recommendation: do not reserve shell chrome during session validation.** No
skeleton sidebar, header, workspace grid, or sign-out-shaped placeholder.

Reasoning:

1. **Identity is unresolved at that moment.** A skeleton that outlines the real
   sidebar or header reads as an authenticated workspace before session *and*
   role are known. Deep entry with an expired session, or with the other role's
   session, must resolve to the role-correct sign-in screen with no workspace and
   no sign-out control shown at any point — the settled acceptance criteria say
   an otherwise usable workspace screen is not shown without its enabled sign-out
   control.
2. **A disabled sign-out placeholder is a false affordance** — it implies
   authenticated chrome while withholding the one control the story is about.
3. **"Layout shift" is the wrong frame here.** This is a full-viewport state
   replacement across an authentication boundary, not late content arriving
   inside stable persistent chrome. The resolved shell has different geometry,
   but that is a boundary transition, not cumulative layout shift. Preserving the
   boundary matters more than visually approximating the next state.

Minimal, token-only refinements (advisory): keep the existing hero logo, spinner,
and role-specific copy; expose the copy through `aria-live="polite"`; and if a
fast session response causes a perceptible flash, delay *visual presentation*
briefly while issuing the session request immediately.

**Design tokens needed: none.** Existing `--surface`, `--muted`, `--foreground`,
the spacing scale, and the 72px hero logo already express a neutral validation
state. `--danger` is not used for sign-out anywhere — logout is reversible.

## Implementation handoff

### Inherited requirements — from the story, ADRs, and accessibility

These are not this design's proposals; they already bind, and the artifact only
restates them so the frames are readable.

- Sign-out is visible **and enabled** once each representative screen
  (`/dashboard`, `/catalog/products`, `/pos/order`) has finished loading after
  direct entry or refresh, including with a query string or fragment, and after
  three consecutive refreshes.
- During session validation a loading state may be shown, but an otherwise
  usable workspace screen must never appear without its enabled sign-out control.
- Expired/invalid session on a deep address → role-appropriate sign-in screen, no
  workspace, no sign-out control at any point.
- Cross-role deep entry never yields the other role's workspace; existing
  authorization and redirection rules are unchanged by this story.
- Sign-out from a deep route lands on `/sign-in` (admin) or `/staff/sign-in`
  (staff), keeping the polite `role="status"` line "You have been signed out.";
  refreshing the original deep address afterwards does not restore the workspace.
- Existing control contract (from #226): 44px minimum touch target, visible focus
  ring, neutral outlined rest state, fixed footprint, disabled in place with
  `aria-busy="true"` and the "Signing out…" label while in flight. Admin has no
  confirmation; POS keeps its confirmation dialog with focus defaulting to
  Cancel and the affirmative action on `--accent`.
- The actual fix is deployment configuration: entry-document cache policy in
  `deploy/nginx.conf`, and deploy invalidation covering cached entry documents at
  deep paths, not only root aliases.

### Advisory recommendations — Dev may weigh these

- Keep the full-viewport loading swap as-is; do not add a shell skeleton
  (the Deliverable 2 decision above). This is the one thing #280 asked to decide.
- Add `aria-live="polite"` to the loading announcement so validation is
  communicated without interrupting other assistive-technology output.
- Optional flash avoidance on a fast session response: delay presentation only,
  never the request. Timing, no tokens.
- On resolve, preserve the app's existing route-entry focus target (the route's
  main heading if that is the established target). **Never** move focus to Sign
  out automatically.
- Ensure the loading tree can unmount without leaving focus on a removed element.

### Proposed changes to shared shells or components

**None.** No change is proposed to `AdminLayout`, `StaffWorkspaceLayout`,
`AdminLogoutControl`, `StaffLogoutControl`, `SessionLoading`,
`.staff-session-loading`, the shells' information architecture, route addresses,
confirmation rules, control dimensions, or any loading token. Deliverable 2 is
explicitly a recommendation *not* to change the loading state's structure.

Pixel matching is not the goal — the frames exist to make the placement
confirmation checkable, not to specify new UI.
