# UCM Coffee Studio — official logo across all screens (#250)

## Design read

Preserve mode. This is a branding substitution inside a shipped internal POS, not a
redesign. Layout, type, color, spacing, radii, copy, and responsive behavior on every
listed screen stay exactly as they are today. One thing changes: three independently
hand-built brand marks become one official logo image, plus a favicon declaration and
one genuinely new placement (the 390×844 administrator bottom navigation, which is the
product decision recorded during QA testability attempt 3).

Design dials are `DESIGN_VARIANCE: 2`, `MOTION_INTENSITY: 1`, `VISUAL_DENSITY: 5`. No
motion is introduced. The mockup sheet is developer documentation, not a promotional page.

Mockup: `docs/design/mockups/issue-250/index.html`
Source asset: `docs/design/mockups/issue-250/assets/ucm-coffee-logo.png`
Favicon derivative: `docs/design/mockups/issue-250/assets/favicon-512.png`

## The asset

The PO-supplied artwork is a **square 1080×1080** PNG on transparency — a circular green
badge reading "ÜCOFFEE + ME / COFFEE STUDIO" around a moka pot, with "ÜCM" and
"ESTD. 2024". Intrinsic aspect ratio is exactly 1:1.

This is the whole design problem. Every existing lockup in the product is horizontal, and
the mark being dropped into them is square. The mockup exists mainly to show that the
square is honored at every size rather than squashed into the horizontal slot it replaces.

Both files in `assets/` are committed here so CI and Dev can see the artwork — it
previously existed only on the PO's machine. `favicon-512.png` is the identical artwork
uniformly resized to 512×512, with no crop, recolor, redraw, or substitution.

## Bound visual system

The sheet uses the production tokens verbatim: the cool neutral surfaces, the existing
green accent and focus colors, the Apple/Inter/system sans stack, 6px and 10px radii, the
existing spacing scale, and the 44px minimum touch target. No new color, font, or radius
was introduced.

Six new dimension tokens were added to `docs/design/tokens.json` under `logo`, because
the logo now appears at five distinct sizes across the product and hard-coding those in
five components is how the three marks diverged in the first place:

| Token | Value | Used at |
|---|---|---|
| `logo.inline` | 32px | administrator sign-in header, staff workspace / POS header |
| `logo.sidebar` | 40px | administrator sidebar brand |
| `logo.staffSignIn` | 40px | staff sign-in card |
| `logo.hero` | 72px | administrator session-loading view |
| `logo.mobileNav` | 40px | administrator bottom navigation at 390×844 |
| `logo.mobileNavRail` | 56px | width of the fixed logo rail in that bar |

## Sizing rationale

The specimen strip at the top of the sheet shows the badge at 72 / 40 / 32 / 24px. The
arc text ("COFFEE STUDIO", "ESTD. 2024") stops being readable below roughly 28px; the
badge still reads as a recognizable mark, but not as type. **32px is therefore the inline
floor.** The old `.brand-mark` was 28px, so the header mark grows by 4px — that is the one
deliberate metric change on an existing screen, and it does not change the 72px header
height because `.brand` already reserves `min-height: var(--touch-min)` (44px).

The session-loading view is the only placement with room to breathe — a centered grid on
an otherwise empty white screen — so it takes the 72px hero size, where the full lockup is
legible.

## Placement by placement

**1. Administrator sign-in header** (`Brand()` in `App.tsx:112`). The CSS-drawn
`.brand-mark` circle is replaced by a 32px image in the same slot. `.brand` keeps its
`inline-flex`, `gap: var(--space-3)`, and `min-height: var(--touch-min)`. The visible
"UCM Coffee Studio" wordmark stays. "Administrator access" and the "Staff sign-in" link
keep the header's right slot untouched.

**2. Administrator session-loading view** (`App.tsx:124`, `auth.status === 'checking'`).
Same `Brand()` component, rendered at hero size. Spinner and "Checking administrator
access…" are unchanged and remain below the lockup.

**3. Administrator sidebar** (`.admin-sidebar > .brand`, `styles.css:551`). 40px logo plus
wordmark, keeping the existing `padding: var(--space-1) var(--space-2) var(--space-5)` and
the 1px bottom border above the nav groups.

**4. Staff sign-in** (`StaffBrand()` in `StaffSignIn.tsx:39`). The 38px circular box
containing the literal text "UCM" is replaced by the 40px logo image. The adjacent stacked
`<strong>UCM Coffee Studio</strong>` / `<small>Staff sign-in</small>` block is unchanged.

**5. Staff workspace / POS header** (`.staff-workspace-brand`, `StaffWorkspace.tsx:237`).
A 32px logo is added at the start of the existing brand row, before the wordmark and the
bordered "Staff" pill. The "Signed in as …" line beneath is unchanged.

**6. Administrator bottom navigation at 390×844.** Below 760px, `.admin-sidebar` becomes
`position: fixed; inset: auto 0 0; height: 80px; padding: 6px 8px` with a horizontally
scrolling nav, and `styles.css:2040` currently sets `.admin-sidebar > .brand { display: none }`.
AC #6 reverses that. The recommended solution, shown in the sheet, is to make the bar a
flex row of two parts:

- a **fixed, non-scrolling 56px logo rail** on the left (`flex: 0 0 auto`) holding the
  40px logo, vertically centered;
- the **existing horizontal nav scroller** taking the remaining width.

The bar stays exactly 80px tall, the logo never scrolls out of view, and the seven
destinations remain reachable by the scroller's existing horizontal scroll. Verified in the
rendered mockup: bar height 80px, logo fully inside the bar, zero bounding-box overlap
between the logo and any of the seven nav links, scroller still overflowing (580px of
content in 316px of width) and therefore still scrollable.

Note that the mobile brand rail shows the **logo only**, no wordmark. At 390px, adding the
wordmark would consume roughly a third of the bar and push nav links further into the
scroll, which works against AC #6's reachability requirement.

## Non-distortion rules

The square-into-horizontal risk is handled by making every logo box a 1:1 square:

- explicit and **equal** `width` and `height` (also as HTML attributes, so intrinsic size
  is known before the image loads and the layout does not shift);
- `object-fit: contain`;
- `flex: 0 0 auto`, so a flex parent cannot compress the box along the main axis.

The three things that break this, shown as the Don't panel in the sheet:

- `object-fit: cover` — crops the badge's outer ring;
- a horizontal box with `object-fit: fill` — the classic squash;
- setting one axis and leaving the other `auto` inside a flex row — flex shrinks the set
  axis and the ratio silently drifts.

Measured in the rendered mockup: all 19 images load with non-zero intrinsic dimensions,
and the worst rendered-versus-intrinsic aspect-ratio deviation across all twelve logo
placements is **0.0000%**, against the ±1% tolerance in AC #4.

## Accessibility obligations

The accessible name is exactly `UCM Coffee logo`, applied as `alt` **on the image itself**.

`.brand` in `App.tsx:114` currently carries `aria-label="UCM Coffee Studio"` while wrapping
a visible `.brand-name` span reading "UCM Coffee Studio". `.staff-brand` in
`StaffSignIn.tsx:41` carries `aria-label="UCM Coffee Studio, staff sign-in"` over similarly
duplicated visible text. Once the image has a real accessible name, those wrapper labels
are redundant — and a wrapper label over adjacent visible shop-name text is precisely what
AC #7 excludes. **Recommendation: remove both wrapper `aria-label` attributes.** That
leaves each logo announced exactly once, and restores the plain visible-text relationship
for the wordmark.

No decorative duplicate logo images are introduced. If one ever were, it would need
`aria-hidden="true"`.

## Favicon

```html
<link rel="icon" type="image/png" href="/favicon.png" />
```

in `apps/web/index.html`, served from `apps/web/public/favicon.png` — the same artwork
uniformly resized to 512×512, nothing else changed. The `<title>` is explicitly out of
scope for this story and stays as it is, including the fact that it reads "Administrator
sign-in" on staff routes.

## Implementation handoff

### Requirements inherited from the story, ADRs, and accessibility obligations

- Display the supplied official logo at all six listed placements: administrator sign-in,
  administrator session-loading, administrator sidebar, staff sign-in, staff
  point-of-sale/workspace header, and the 390×844 administrator bottom navigation.
- Commit the artwork into the repo so CI can build with it. No placement may render the
  CSS-drawn abstract mark, the boxed "UCM" text, an inline substitute lockup, placeholder
  artwork, or unrelated artwork.
- Declare a favicon whose URL resolves successfully to a decodable image with non-zero
  intrinsic dimensions. The favicon may differ from the source only by uniform resize
  and/or format conversion — no crop, recolor, redraw, or substitution.
- At 1024×768 and 390×844, every visible logo must load successfully with non-zero
  intrinsic dimensions, hold its displayed ratio within ±1% of the asset's intrinsic 1:1,
  and show the complete artwork without clipping or cropping.
- At both viewports, no logo may have bounding-box overlap with navigation controls,
  actionable controls, status messages, or form fields, or prevent any of them from being
  seen or operated. The existing fixed 80px administrator bottom-navigation overlay is
  carved out for page content only: the logo must stay entirely within that region, must
  not increase its height or overlay area, and underlying page content must remain
  scrollable and viewable above it.
- At 390×844 the bottom navigation must show the official logo, complete and proportionate,
  with no substitute mark or text-only placeholder, without overlapping or clipping a nav
  control, and with every nav control still reachable through the existing horizontal scroll.
- Each identity-conveying logo image has the accessible name `UCM Coffee logo`, on the image
  and not on a wrapper containing adjacent visible shop-name text. Any decorative duplicate
  is hidden from assistive technology. No logo is announced more than once.
- A missing or failed logo asset, a missing favicon declaration, or a favicon URL that fails
  to load and decode is a failure — never a fallback to a placeholder or unrelated mark.
- Scope stays inside `apps/web`. No `apps/api`, no `packages/shared`. No ADR is required.

### Advisory interaction, layout, responsive, and visual recommendations

- Advisory: the sizes in the `logo` token group — 32px inline, 40px sidebar and staff
  sign-in, 72px session-loading hero, 40px in a 56px mobile nav rail. 32px is the
  recommended inline floor because the badge's arc text stops resolving below ~28px.
- Advisory: enforce non-distortion with equal explicit `width`/`height` (as both CSS and
  HTML attributes), `object-fit: contain`, and `flex: 0 0 auto`. Avoid `cover`, avoid
  `fill`, and avoid an `auto` axis inside a flex row.
- Advisory: in the 390×844 bottom bar, show the logo alone in a fixed non-scrolling left
  rail, without the wordmark, so the nav scroller keeps as much width as possible.
- Advisory: keep the wordmark alongside the logo at all other placements — the story
  changes the mark, not the lockup's text.
- Advisory: give the image a `width`/`height` attribute pair everywhere so the reserved box
  exists before load and the headers do not shift.
- These recommendations are not acceptance criteria. Dev may integrate differently given a
  documented product or code constraint, provided every inherited requirement still holds.

### Proposed material changes to an existing shared shell or component

- **Collapse `Brand()`, `StaffBrand()`, and the inline `.staff-workspace-brand` lockup onto
  one shared logo component** (e.g. `<UcmLogo size=… />`) that owns the `img`, the square
  box, the `alt`, and nothing else, with each call site keeping its own surrounding text.
  Reason: three independently hand-built marks are exactly how the identity diverged; a
  single image component is what makes AC #3 stay true after this story ships.
- **Remove `aria-label="UCM Coffee Studio"` from `.brand` (`App.tsx:114`) and
  `aria-label="UCM Coffee Studio, staff sign-in"` from `.staff-brand`
  (`StaffSignIn.tsx:41`).** Reason: with a named image inside, those wrapper labels create
  the doubled announcement and the wrapper-over-visible-text pattern AC #7 rules out.
- **Change `.admin-sidebar` below 760px from `display: block` to a two-part flex row**, and
  replace `.admin-sidebar > .brand { display: none }` (`styles.css:2040`) with a
  logo-only rail. Reason: this is the AC #6 product decision; it cannot be met by styling
  alone while the brand is `display: none`.
- **Delete the now-dead `.brand-mark` rules (`styles.css:117–158`) and `.staff-brand-mark`
  (`styles.css:3644`)** once no call site references them. Reason: leaving them invites the
  old marks back.
- **Preserve the `.brand`, `.staff-brand`, and `.staff-workspace-brand` class names.**
  `e2e/ui-consistency.spec.ts` depends on the current `.staff-workspace-brand` selectors;
  renaming them surfaces as a false regression rather than a real one.
