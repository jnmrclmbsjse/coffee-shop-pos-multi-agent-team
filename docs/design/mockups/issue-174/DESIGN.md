# DESIGN — Cross-screen consistency reference

UCM Coffee Studio POS + back office · GitHub issue **#174** · Design task **#176**

**This mockup is an advisory implementation reference. Pixel matching is not the
goal and is not an acceptance criterion.** Where this document and the shipped
build differ on a detail that is not listed under *Requirements* below, the
shipped build is not wrong. It is a judgement call that the implementer owns.

Files: `index.html`, `styles.css`, `app.js`, `RECONCILIATION.md`.

---

## 0. What this is, and what it is not

This is a **retrospective reconciliation artifact**, not a new feature. Eleven
advisory mockups were delivered across issues #3 through #154, each one designed
in isolation against its own screen. The product now has two workspace shells
that no single mockup ever owned, because no single mockup could see all nine
staff destinations at once.

So this document does two different jobs and keeps them clearly apart:

1. **Retrospective** — reconcile what shipped against what was advised.
   That lives in `RECONCILIATION.md`, one row per delivered screen.
2. **Prospective** — one deliberate, system-level design for the two shells and
   for the control and state-cue conventions they share. That lives here and in
   `index.html`.

Nothing here changes sales, money, inventory, attribution, authentication, or
any append-only rule. Money remains integer cents. No offline mode, hardware
integration, recipe or BOM depletion, inter-branch logistics, or real-time stock
ledger is proposed or implied.

Design task **#167** / issue **#165** (active-cashier picker) is **not
delivered**. It is treated here as forward-looking input only: the staff strip
is designed so a future cashier-context control can be added to the header
without changing the strip's structure or destination order. It is not counted
as a delivered screen anywhere in `RECONCILIATION.md`.

## 1. Design read

**Reading this as:** an internal operational reference for two shipped
workspace shells, for an audience of one developer picking up tasks #178 and
#179, in the shipped UCM restrained-light product language.

Dials: `DESIGN_VARIANCE 3` · `MOTION_INTENSITY 2` · `VISUAL_DENSITY 6`.

Low variance is correct here. This is a specification surface for an in-shop
tablet used standing at a counter; predictable placement *is* the deliverable.
Motion sits at 2 because AC7 requires that no state be communicated by
animation. Density sits at 6 because the strip carries nine destinations at
44&nbsp;px on a 390&nbsp;px-wide device.

No design system from the Section 2 catalogue applies. The product already
binds a complete native CSS system with an authoritative token file and
prohibits network and dependency use, so the honest implementation is native
CSS bound to `docs/design/tokens.json`.

**No photography or generated imagery is used.** This is a shell and control
specification; a hero photograph would be decoration on a document whose entire
job is showing exact interface states. The visual content is the interface
itself, rendered live at both target viewports.

**Icons are inline SVG** rather than an icon library, because the product's
own `Icon` component is inline SVG with no dependencies and the reference must
match the geometry it is proposing (24&nbsp;viewBox, 1.8 stroke,
`currentColor`).

---

## 2. Implementation handoff

Three tiers, deliberately separated. Tier (a) is binding. Tier (b) is
advice you may overrule with a reason. Tier (c) is a change to shared code that
needs a decision before it is made.

### (a) REQUIREMENTS — inherited from the story ACs, ADRs, and accessibility obligations

These are not this mockup's opinions. They are the acceptance criteria and the
standing accessibility obligations, restated in interface terms so they can be
built and tested. **They outrank every prior mockup, including any of the
eleven advisory references.**

| # | Requirement | Source |
|---|---|---|
| R1 | Exactly one staff navigation strip renders on `/pos`, `/pos/open`, `/pos/opening`, `/pos/restock`, `/pos/movements`, `/pos/orders`, `/pos/cash`, `/pos/closing`, `/pos/close`. | AC1 |
| R2 | Visible destination order is exactly: Sell, Open Day, Opening, Restock, Deliveries & Wastage, Order History, Cash & Expenses, Closing, Close Day. Visual grouping must not change this order. | AC1 |
| R3 | Every currently available destination is reachable from every staff route through that strip. | AC2 |
| R4 | A destination whose business prerequisite is unmet stays **visible**, is exposed to assistive technology as unavailable or disabled, is omitted from the keyboard tab order, carries a **non-colour** unavailable cue, and cannot navigate on activation. It becomes actionable when the prerequisite is met. | AC2 |
| R5 | The unavailable state must not read as tappable. | AC2 |
| R6 | The active destination carries `aria-current="page"` **and** a visible non-colour indicator. | AC3 |
| R7 | Keyboard focus order follows the visible order. | AC3 |
| R8 | Every actionable destination has a visible focus state and a touch target of at least 44 × 44 CSS px. | AC3 |
| R9 | Signed-in staff context occupies the same shell position on every staff route. | AC4 |
| R10 | Business-day context occupies one consistent shell position and **never disappears**. It shows either the open business date plus day type, or the explicit state "No business day open". | AC4 |
| R11 | Admin routes render the admin sidebar and never the staff strip. Staff routes never render the admin sidebar. | AC5 |
| R12 | The sidebar keeps the groups Workspace, Catalog, Operations. | AC5 |
| R13 | The active sidebar destination carries `aria-current="page"` plus a non-colour indicator. | AC5 |
| R14 | The sidebar uses either distinct meaningful destination icons **or** no icons at all. Repeated decorative icons are not acceptable. | AC5 |
| R15 | Each workspace has shared conventions for primary, secondary, and destructive actions and for loading, empty, error, and success states. | AC6 |
| R16 | Loading, error, success, active, unavailable, and destructive states are never conveyed by colour alone. | AC6 |
| R17 | Existing skip-link and nav-landmark behaviour, route-change focus management, live-region announcements, visible keyboard focus, and reduced-motion behaviour are preserved. | AC7 |
| R18 | Under `prefers-reduced-motion`, navigation and state cues must not rely on animation to communicate state. | AC7 |
| R19 | No page-level horizontal overflow at 1024 × 768 or 390 × 844. The staff strip may scroll horizontally **within its own bounds** without widening the page. | AC8 |
| R20 | Money remains integer cents. Nothing may change sales, money, inventory, attribution, authentication, or append-only business rules. | Hard constraint |

**How the mockup satisfies each of R4, R6, R13, R16 without colour**

- **Current destination** — a 3&nbsp;px solid inset bar on the leading edge of
  the item plus a weight step from 650 to 750. Both survive full desaturation.
  The green tint is reinforcement only. Same vocabulary in both shells, rotated
  to the vertical axis in the sidebar.
- **Unavailable destination** — a padlock glyph, a dashed border, a flat
  background with no fill and no shadow, and a `default` cursor. Three
  independent non-colour signals.
- **Loading** — the words "Loading …" inside a polite live region, plus
  `aria-busy="true"` on the region. The spinner and shimmer are decoration and
  are stopped entirely under reduced motion.
- **Error** — `role="alert"`, a focusable container, a triangle glyph, and a
  3&nbsp;px solid leading rule.
- **Success** — `role="status"`, a check glyph, a 3&nbsp;px solid leading rule,
  and a sentence naming the recorded fact.
- **Destructive** — an outlined treatment that is never the page primary, a
  triangle glyph, and a label that names its object ("Void this order", not
  "Delete").
- **Restock scale** — the existing four-value word scale plus a bordered glyph
  per value. The four `restock*` token colours reinforce; they never carry it.

### (b) ADVISORY — interaction, layout, responsive and visual recommendations

Overrule any of these with a stated reason. None of them is an acceptance
criterion.

**Grouping inside the fixed order.** Hairline separators after *Sell*, after
*Open Day*, and before *Close Day*. This reads the strip as: the sell surface,
the day-opening act, the shift work, the day-closing act. It communicates the
shape of a shift without moving a single destination, which is what R2 allows
and R2 alone constrains.

**Prerequisite model shown in the mockup.** *Order History* stays available at
all times because it reads closed days and is the one destination with genuine
value when no day is open. *Open Day* is the inverse of everything else: it is
unavailable precisely when a day is already open. Everything else, including
*Sell*, requires an open day. This is a demonstration of the contract, not a
specification of the prerequisites — the trading-day domain owns those and this
document does not change them.

**Business-day context placement.** Top right of the header block, paired with
the signed-in staff line at top left, so the two pieces of shell context sit on
one row and neither is inside the page content. At container widths under
800&nbsp;px the pair stacks; both stay in the header, above the strip.

**Closed-day wording.** Primary line `No business day open`, secondary line
`Open a day to record sales`. Dashed container border rather than the filled
subtle surface used when a day is open, so the closed state is legible at a
glance across a counter. Note this is a *state* difference, not a *presence*
difference — R10 is about presence.

**Responsive behaviour is driven by container width, not viewport width.** The
shells are laid out with container queries so a shell embedded at 390&nbsp;px
inside a wide reviewer window behaves exactly as it would on a 390&nbsp;px
device. This is also the honest way to demonstrate both breakpoints
side by side in one document.

**Overflow technique.** `overflow-x: auto` with `overscroll-behavior-x: contain`
on the nav element itself; nothing in the ancestor chain exceeds 100% width.
This is what makes R19 hold rather than merely appear to hold.

**Staff strip at 390&nbsp;px.** Nine destinations at 44&nbsp;px with real labels
will not fit. The strip scrolls. Abbreviating labels, icon-only items, and a
"More" overflow menu were all considered and rejected: abbreviation costs
legibility for staff who are not reading carefully, icon-only costs the
accessible name, and an overflow menu breaks R3 by making some destinations
cost two interactions instead of one. Horizontal scroll is the only option that
keeps all nine reachable, labelled, and one tap away.

**Scroll-into-view on route change.** The current item should be scrolled into
view within the strip after navigation. Prefer scrolling the nav's
`scrollLeft` directly over `Element.scrollIntoView()`, which can scroll
ancestor containers and cause visible page jumps.

**Admin sidebar collapse.** Below 800&nbsp;px of shell width the sidebar becomes
a compact horizontal header carrying the same seven destinations in the same
order. Group labels are kept as inline separators rather than dropped, so the
Workspace / Catalog / Operations grouping required by R12 survives the collapse
instead of being a desktop-only affordance.

**Control sizing.** Staff controls at 48&nbsp;px body height (the token
`control.fieldHeight`), admin controls at the same value for consistency, and a
44&nbsp;px floor on every interactive target in both. The staff workspace is
operated standing; the admin workspace is not, but a single control height is
cheaper to maintain than two and no requirement asks for two.

**Token consolidation, proposed only.** The audit found six semantic roles where
the shipped stylesheet either diverges from `docs/design/tokens.json` or
duplicates a token value as a literal. These are listed in the token ledger at
the end of `index.html` and again in `RECONCILIATION.md`. **They are proposals
for #179. Nothing in the product has been restyled and no new token is
proposed** — every consolidation lands an entry that already exists in the
token file but that the stylesheet has not yet bound.

### (c) PROPOSED MATERIAL CHANGES to shared shell code

Each of these changes a file that many screens depend on. Each is listed with
its reason and its blast radius so it can be accepted or rejected on its own.

| # | File / component | Proposed change | Reason | Blast radius |
|---|---|---|---|---|
| C1 | `StaffWorkspaceLayout` (`inventory/StaffInventoryPages.tsx`) | Add a **Sell** destination at position 1 pointing at `/pos`. | R2 requires it and the sell screen currently has no nav entry at all, so staff on `/pos` can only reach it by browser navigation. | All nine staff routes. |
| C2 | `StaffWorkspaceLayout` | Add **Closing** between Cash & Expenses and Close Day, matching R2's order. Today Closing renders in position 3. | R2 fixes the order; the shipped order groups the two counts together, which is defensible but is not the ordered list the story specifies. | All nine staff routes. |
| C3 | `StaffWorkspaceLayout` | Introduce an **availability model** for nav items: each destination declares its prerequisite, and unmet destinations render with `href` removed plus `role="link"` and `aria-disabled="true"`. | R4 and R5. Today every destination is unconditionally actionable, so staff can navigate to a count screen with no open day and meet a blocking panel after the fact. | All nine staff routes; requires the layout to read trading-day state, which it does not today. |
| C4 | `StaffWorkspaceLayout` | Lift **business-day context** out of `PageHeading` and into the shell header, rendering the closed state explicitly. | R10. Today the context lives in `PageHeading` and is gated on `businessDay?.isOpen`, so it vanishes entirely when no day is open — the single clearest AC4 failure in the build. | All nine staff routes, plus every screen that currently passes `businessDay` to `PageHeading`. |
| C5 | `PageHeading` | **Consolidate the four implementations into one shared component.** `PageHeading` is currently defined twice — `inventory/StaffInventoryPages.tsx:150` and `trading-day/StaffTradingDayPages.tsx:128` — and two more screens hand-roll the same header markup inline (`orders/StaffOrderHistoryPage.tsx:353`, `trading-day/CashAndExpensesPage.tsx:365`). | Four copies of one shell region is why C4 has to be applied four times. Consolidating first makes C4 a one-line change. | Four staff screens. This is a refactor with no intended visual change. |
| C6 | `AdminLayout` (`App.tsx:374`) | Replace the five repeated `Icon name="grid"` uses with **seven distinct destination glyphs**, or remove sidebar icons entirely. | R14. Today Dashboard, Categories, Staff, Reports, and Order History all render the same decorative grid mark, so the icon column carries no information and actively suggests five identical things. | Admin sidebar only. |
| C7 | `Icon` (`catalog/components.tsx`) | Extend the union with the glyphs C6 needs (`bars`, `folder`, `clipboard`, `users`, `document`, `receipt`). | The current union has no meaningful glyph for five of the seven admin destinations, which is *why* `grid` was reused. If C6 is answered with "no icons", C7 is not needed. | Any consumer of `Icon`; additive only. |
| C8 | `AdminLayout` and `StaffWorkspaceLayout` | Add the **non-colour current-destination indicator** (3&nbsp;px inset bar plus weight step) to both. | R6 and R13. Today `.staff-inventory-nav a[aria-current='page']` and `.admin-sidebar nav a.active` both carry colour and tint only. `aria-current` is already correct on the staff strip; the admin sidebar uses NavLink's `.active` class and should also expose `aria-current="page"`. | Both shells. |
| C9 | `AdminLayout` | Replace `scrollIntoView()` (`App.tsx:368`) with a direct `scrollLeft` adjustment on the nav element. | `scrollIntoView` scrolls ancestor scroll containers, which is a page-jump risk under R19 and is explicitly avoided in this project's preview environment. | Admin sidebar only. |
| C10 | `styles.css` `:root` | Bind the six unbound / divergent token roles listed in the token ledger. | Token file is authoritative; the stylesheet currently carries three warn values that differ from it and four restock values, one radius, and two control dimensions as literals. | Global, but every substitution is value-identical except the three warn roles, which move **to** the authoritative value. |

**C4 and C5 are the two that matter most.** C4 is the only outright AC failure
in the shared shell that cannot be fixed inside one screen. C5 is the reason C4
looks like four changes instead of one.

---

## 3. Reading the mockup

Two switches at the top of `index.html`:

- **Viewport** — resizes both shell frames between 1024 × 768 and 390 × 844.
  Both frames are container-query hosts, so the shells respond to the frame,
  not to your browser window.
- **Business day** — flips the prerequisite so the staff strip can be inspected
  in both states. With a day open, *Open Day* is the unavailable one. With no
  day open, everything except *Open Day* and *Order History* is unavailable,
  the business-day context reads `No business day open` in the same position,
  and the content region shows the blocking panel.

The specimen panel below the shells carries the shared control hierarchy and
the four state cues at full size, plus a side-by-side of the three navigation
item states so they can be compared with colour mentally removed.

---

## 4. What this document does not settle

- **Which destinations have which prerequisites.** Owned by the trading-day
  domain. The mockup shows *a* model to demonstrate the contract.
- **Route-change focus target.** R17 says preserve existing behaviour; the
  existing behaviour is the requirement and this document does not restate it
  as a design.
- **The `/pos` sell screen itself.** It is a placeholder in the build and has
  no advisory reference. Only its presence in the strip is in scope here.
- **The active-cashier picker (#167 / #165).** Not delivered, not designed here.
  The header is left with room for it.
