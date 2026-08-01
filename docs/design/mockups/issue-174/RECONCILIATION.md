# RECONCILIATION — delivered screens vs advisory mockups

UCM Coffee Studio POS + back office · issue **#174** · design task **#176**
Primary input to **Dev Task #177**.

Owning follow-up tasks referenced below:

- **#178** — staff POS shell reconciliation
- **#179** — admin shell + shared control and state-cue conventions

---

## 1. Method

Eleven advisory mockups were delivered (issues #3, #18, #40, #55, #67, #80,
#93, #108, #123, #142, #154). They cover twenty delivered screens. One further
delivered screen — the sell surface at `/pos` — has no advisory reference and is
included because AC1 places it in the staff strip.

Design task **#167** / issue **#165** (active-cashier picker) is **not
delivered** and is not counted as a delivered screen. It appears here only as
forward-looking input: the staff header is designed with room for it.

Every screen was read against the shipped source, not against memory:
`apps/web/src/App.tsx`, `StaffSignIn.tsx`,
`inventory/StaffInventoryPages.tsx`, `trading-day/`, `orders/`, `catalog/`,
`reporting/`, `staff/`, `pages/`, and `styles.css`.

## 2. Materiality test

A difference is **material** only if it affects one of:

1. destination presence, order, or grouping
2. current-destination indication
3. signed-in or business-day context
4. shared action hierarchy
5. loading / empty / error / success cues
6. keyboard or assistive-technology behaviour
7. touch target size
8. reduced motion
9. page-level overflow at 1024 × 768 or 390 × 844

Everything else — spacing, wording, table-versus-card, column choice, copy tone,
exact tint — is **not material** and is not recorded as a difference, however
far it sits from the mockup.

**Verdict rules, applied strictly:**

- Exactly one verdict per material difference.
- **RETAIN** requires a recorded user, accessibility, or within-workspace
  consistency benefit.
- **CORRECT** requires a named owning task.
- *"It doesn't match the mockup"* is **not** a valid reason to correct anything.
  Two differences below are RETAINed for exactly that reason: the build diverged
  from its mockup and the divergence is better.

## 3. Difference register

Each material difference is recorded once, with one verdict. The screen table in
§4 references these IDs. Shell-level differences apply to many screens; recording
them once is what keeps "one verdict per difference" true.

| ID | Material difference | Materiality | Verdict | Verdict reason | Owning task |
|---|---|---|---|---|---|
| **M1** | The staff strip renders 8 links. **Sell is absent** — `/pos` has no nav entry, so the sell surface is reachable only by browser navigation or by being the landing route. | 1 | **CORRECT** | AC1 lists Sell as destination 1 of 9. Staff who navigate to Opening cannot return to selling from the strip. This is a reachability failure, not a styling gap. | #178 |
| **M2** | Strip order is Open Day, Opening, **Closing**, Restock, Deliveries & Wastage, Order History, Cash & Expenses, Close Day. Closing sits at position 3, adjacent to Opening. | 1 | **CORRECT** | AC1 fixes the visible order with Closing at position 8. The shipped order pairs the two counts, which is a reasonable read, but AC1 outranks it. Grouping may still be expressed visually — separators, not reordering. | #178 |
| **M3** | **No prerequisite model exists.** Every destination is unconditionally actionable. Staff can navigate to a count or cash screen with no open day and meet a blocking panel only after arriving. | 1, 6 | **CORRECT** | AC2 requires unmet destinations to stay visible but be non-actionable, AT-exposed as unavailable, out of tab order, and non-navigating. Today the cost of the unmet prerequisite is paid after the navigation instead of before it. | #178 |
| **M4** | Staff strip current destination is indicated by tinted border and tinted background only (`.staff-inventory-nav a[aria-current='page']`). `aria-current` is correctly applied by NavLink. | 2, 6 | **CORRECT** | AC3 requires `aria-current="page"` **plus a visible non-colour indicator**. The `aria-current` half is already right; only the non-colour visual is missing. Desaturate the strip today and the current item is indistinguishable. | #178 |
| **M5** | **Business-day context is rendered inside `PageHeading` and gated on `businessDay?.isOpen`**, so it disappears entirely when no day is open — and is absent by construction from any screen that does not pass a `businessDay`. | 3 | **CORRECT** | AC4 requires one consistent shell position that **never disappears**, showing either the open date plus day type or the explicit "No business day open". This is the clearest outright AC failure in the shared shell: the context is most needed exactly when it is missing. | #178 |
| **M6** | The page-heading region is implemented **four times**: `PageHeading` in `inventory/StaffInventoryPages.tsx:150`, a second `PageHeading` in `trading-day/StaffTradingDayPages.tsx:128`, and hand-rolled headers in `orders/StaffOrderHistoryPage.tsx:353` and `trading-day/CashAndExpensesPage.tsx:365`. | 3, 4 | **CORRECT** | Not a cosmetic duplication. It is the reason M5 has to be fixed in four places instead of one, and it is how business-day context came to be present on some staff screens and absent on others. Consolidate first, then apply M5. | #178 |
| **M7** | Signed-in staff context sits in the staff header brand block, identically on all eight strip routes. | 3 | **RETAIN** | Already satisfies AC4's first clause. It is a stable, learnable landmark in the shell rather than in page content, and it survives every route change without remount. Moving it would cost that stability for no requirement. Preserve when applying M5 and M6. | #178 (preserve) |
| **M8** | Admin sidebar reuses `Icon name="grid"` for **5 of 7 destinations** (Dashboard, Categories, Staff, Reports, Order History). Only Products and Inventory carry `box`, and those two share it. | 1 | **CORRECT** | AC5 requires distinct meaningful icons or no icons. The icon column currently carries zero information and suggests five equivalent things. This gets worse, not better, at narrow width — see M11, where the icon becomes the dominant element. | #179 |
| **M9** | Admin sidebar current destination is indicated by tinted text and tinted background only (`.admin-sidebar nav a.active`), driven by NavLink's `.active` class. | 2, 6 | **CORRECT** | AC5 requires `aria-current="page"` plus a non-colour indicator. Unlike the staff strip, the sidebar has **neither**: the styling hook is the `.active` class, so no `aria-current` is asserted and no non-colour cue exists. | #179 |
| **M10** | `AdminLayout` calls `scrollIntoView()` on the active nav link after every route change (`App.tsx:368`). | 9 | **CORRECT** | `scrollIntoView` scrolls ancestor scroll containers, so a route change can shift the page rather than only the nav. Replace with a direct `scrollLeft` adjustment scoped to the nav element. Low risk, removes an overflow hazard at both target viewports. | #179 |
| **M11** | Below 800 px the admin sidebar becomes a fixed 68 px bottom bar and **hides the group labels** (`.admin-nav-label { display: none }`), reducing each destination to a 19 px icon over an 11 px label. | 1 | **CORRECT** | AC5 requires the Workspace / Catalog / Operations grouping to be kept. At narrow width it is dropped, so grouping becomes a desktop-only affordance. It also compounds M8: at 11 px labels the repeated grid icon becomes the primary distinguishing element, and it does not distinguish. | #179 |
| **M12** | `styles.css` `:root` carries three **warn** values that differ from `docs/design/tokens.json`, and four restock colours, the 10 px panel radius, the 44 px touch minimum, and the 48 px field height exist as literals rather than bound tokens. | 4, 5 | **CORRECT** | The token file is authoritative and three shipped values silently disagree with it. Detail in §5. This is a **proposal to consolidate onto existing tokens** — no restyle of the product is proposed and no new token is introduced. | #179 |
| **M13** | Both sign-in routes render neither shell: `/sign-in` uses `app-shell` and `/staff/sign-in` its own layout. Neither carries the staff strip or the admin sidebar. | 1 | **RETAIN** | Satisfies AC5's separation requirement exactly. Pre-authentication routes must not render navigation to destinations the visitor cannot reach, and doing so would leak the destination list to an unauthenticated viewer. | — |
| **M14** | The staff strip is right-aligned at wide widths (`justify-content: flex-end`) and left-aligned below 1000 px, rather than left-aligned throughout as the staff mockups show. | — | **not material** | Alignment affects no criterion in §2. Recorded so #178 does not treat it as a defect. | — |
| **M15** | `/pos/orders` ships as a card ledger with its own header, where mockup #142 specified a dense table. | — | **not material** (header portion is **M6**) | Table-versus-card is a layout judgement outside §2. The header duplication is the material part and is already recorded as M6. Do not "fix" the card layout: it is more usable on the 390 px device and reads better standing at a counter. | — |
| **M16** | Restock status uses the four-value word scale (Urgent / Low / Below par / Enough) with colour as reinforcement, exactly as mockup #108 advised. | 5 | **RETAIN** | Already satisfies AC6's no-colour-alone rule for this scale — the word carries the meaning and the colour supports it. Adopt this pattern as the shared model for the other state cues rather than changing it. | #179 (as model) |

## 4. Screen table

One row per delivered screen. `M-` references point at §3, where each difference
carries its single verdict.

### Staff POS workspace

| Workspace | Screen / destination | Advisory reference | Recommendations already reflected | Material difference | Verdict | Verdict reason | Owning task |
|---|---|---|---|---|---|---|---|
| Staff POS | **Sell** — `/pos` | *none* (no mockup delivered; placeholder screen) | Skip link and `#staff-main` landmark target present | M1 | CORRECT | Absent from the strip entirely; AC1 places it first | #178 |
| Staff POS | **Open Day** — `/pos/open` | #123 · `docs/design/mockups/issue-123` | Day-type choice, business-day context copy, blocking panel for no open day, 48 px fields, 44 px targets, reduced-motion override | M2, M3, M4, M5, M6, M7 | CORRECT (M2–M6) · RETAIN (M7) | Shell-level; see §3 | #178 |
| Staff POS | **Opening** — `/pos/opening` | #108 · `docs/design/mockups/issue-108` | Critical-items-only sheet, eight-step level radiogroup, staff selectors before the sheet, read-only submitted view, blocking panel | M1, M2, M3, M4, M5, M6, M7 | CORRECT (M1–M6) · RETAIN (M7) | Shell-level; see §3 | #178 |
| Staff POS | **Restock** — `/pos/restock` | #108 · `docs/design/mockups/issue-108` | Real table, text-first four-value status scale, `Level` qualifier in the Counted column, scroll hint on narrow tables | M1, M2, M3, M4, M5, M6, M7, M16 | CORRECT (M1–M6) · RETAIN (M7, M16) | Status scale already meets AC6 and becomes the shared model | #178 · #179 (M16) |
| Staff POS | **Deliveries & Wastage** — `/pos/movements` | #108 · `docs/design/mockups/issue-108` | Append-only table with no actions column, delivery/wastage type choice, overflow wrapper with visible scroll hint | M1, M2, M3, M4, M5, M6, M7 | CORRECT (M1–M6) · RETAIN (M7) | Shell-level; see §3 | #178 |
| Staff POS | **Order History** — `/pos/orders` | #142 · `docs/design/mockups/issue-142` | Structural read-only rule (no mutation affordance anywhere), full-word status, void as neutral and struck rather than danger, literal empty state, day selection plus filters | M1, M2, M3, M4, M5, M6, M7, M15 | CORRECT (M1–M6) · RETAIN (M7) · M15 not material | Card layout diverges from the mockup and is better on the 390 px device; not a defect | #178 |
| Staff POS | **Cash & Expenses** — `/pos/cash` | #154 · `docs/design/mockups/issue-154` | Read-only day context as spans not disabled fields, real radio inputs for type, integer-cent amount handling, permanent-ledger wording, no-open-day panel | M1, M2, M3, M4, M5, M6, M7 | CORRECT (M1–M6) · RETAIN (M7) | Header is hand-rolled here rather than shared — the M6 case | #178 |
| Staff POS | **Closing** — `/pos/closing` | #108 · `docs/design/mockups/issue-108` | All active items with Critical first, `Not counted` for omitted rows, read-only submission view | M1, M2, M3, M4, M5, M6, M7 | CORRECT (M1–M6) · RETAIN (M7) | Position 3 in the shipped strip; AC1 places it at 8 | #178 |
| Staff POS | **Close Day** — `/pos/close` | #123 · `docs/design/mockups/issue-123` | Nine-row reconciliation, `Change owed (still in drawer)` exact copy and sub-line, highlighted row treatment, expected-cash ordering | M1, M2, M3, M4, M5, M6, M7 | CORRECT (M1–M6) · RETAIN (M7) | Shell-level; see §3 | #178 |

### Admin back office

| Workspace | Screen / destination | Advisory reference | Recommendations already reflected | Material difference | Verdict | Verdict reason | Owning task |
|---|---|---|---|---|---|---|---|
| Admin | **Dashboard** — `/dashboard` | #80 · `docs/design/mockups/issue-80` | 232 px fixed sidebar, compact metrics, mono numerics, inline non-modal empty and error states, DOM-based charts with value tables | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Reports** — `/reports` | #80 · `docs/design/mockups/issue-80` | Sticky table headers in horizontally scrollable regions, explicit mobile scroll hint, defined export, read-only guarantee | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Categories** — `/catalog/categories` | #40 · `docs/design/mockups/issue-40` | Table above breakpoint / labelled records below, category ordering, availability separated from catalog configuration | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Products** — `/catalog/products` | #40 · `docs/design/mockups/issue-40` | Size and price structure, availability versus configuration split, 48 px fields, 44 px targets | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Product editor** — `/catalog/products/:id/edit` | #40 · `docs/design/mockups/issue-40` | Labels above inputs, errors below and associated, in-context editor rather than a centred modal | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Inventory items** — `/inventory` | #55 · `docs/design/mockups/issue-55` | Count methods, independent normal-day and peak-day par levels, explicit blocked-action explanations | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Inventory item editor** — `/inventory/items/:id/edit` | #55 · `docs/design/mockups/issue-55` | In-context editor, recovery without losing saved values, visible labels with placeholders as supplement only | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |
| Admin | **Staff roster** — `/staff` | #67 · `docs/design/mockups/issue-67` | Search / filter / sort composing over one roster state, staged dialog edits committed on save, inline status change with announcement, quiet text badge plus labelled switch | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3. The status badge plus switch already satisfies AC6 and needs no change | #179 |
| Admin | **Order History** — `/order-history` | #93 · `docs/design/mockups/issue-93` | Paired business-day and order-number identity, `aria-sort` on sort headers, filters as ordinary labelled 48 px fields, page reset on control change, Completed / Parked / Void always written out, `—` for unavailable data | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3. The three-status treatment already meets AC6 | #179 |
| Admin | **Order detail** — `/order-history/:id` | #93 · `docs/design/mockups/issue-93` | Read-only with no production controls, order number and business day kept together, tabular items, senior-discount line with original and discounted amounts | M8, M9, M10, M11, M12 | CORRECT | Shell-level; see §3 | #179 |

### Authentication entry points

| Workspace | Screen / destination | Advisory reference | Recommendations already reflected | Material difference | Verdict | Verdict reason | Owning task |
|---|---|---|---|---|---|---|---|
| Entry | **Admin sign-in** — `/sign-in` | #3 · `docs/design/mockups/issue-3` | Generic non-identifying refusal, focusable `role="alert"` receiving focus on failure, `aria-describedby` / `aria-invalid` on fields, password visibility button with changing accessible name, duplicate-safe loading lock, validated same-origin return path | M13 | RETAIN | Renders neither shell, which is what AC5 requires and what keeps the destination list from leaking pre-authentication | — |
| Entry | **Staff sign-in** — `/staff/sign-in` | #18 · `docs/design/mockups/issue-18` | Staff-only surface separate from admin authentication, PIN path for remembered staff, generic failure messaging, clear move into Point of Sale | M13 | RETAIN | Same reason as above | — |

## 5. Token consolidation — proposed, not applied

The audit found divergent ad-hoc values for the same semantic role. **These are
proposals for #179. No product styling has been changed, and no new token is
proposed** — every item below binds a role that already exists in
`docs/design/tokens.json` but that `apps/web/src/styles.css` has not bound.

| Semantic role | `tokens.json` | `styles.css` today | Proposal |
|---|---|---|---|
| Warning ink | `oklch(41% 0.09 75)` | `--warn-ink: oklch(39% 0.08 72)` | Adopt the token value |
| Warning surface | `oklch(97% 0.03 85)` | `--warn-surface: oklch(97% 0.025 82)` | Adopt the token value |
| Warning border | `oklch(80% 0.08 80)` | `--warn-border: oklch(73% 0.09 78)` | Adopt the token value |
| Restock scale (4 roles) | `restockUrgent` `restockLow` `restockBelowPar` `restockEnough` | Four literal `oklch(...)` values inside `.staff-restock-status.*` rules | Declare `--restock-*` variables. Values already agree; this is binding, not recolouring |
| Panel radius | `radius.medium = 10px` | Literal `border-radius: 10px` in 29 rules | Declare `--radius-md: 10px` and substitute |
| Minimum touch target | `control.minimumTouchTarget = 44px` | Literal `min-height: 44px` throughout | Declare `--touch-min: 44px` |
| Field height | `control.fieldHeight = 48px` | Literal `min-height: 48px` throughout | Declare `--field-h: 48px` |
| Control shadow | `shadow.control` (two-layer) | Ad-hoc `box-shadow` per component | Declare `--shadow-control` from the token's two layers |

The three **warn** rows are the only ones where a shipped pixel changes. They
are a genuine divergence from the authoritative file, and the divergence is
small enough that it was almost certainly unintentional. The remaining rows are
value-identical and are purely about making the token file the single source.

## 6. Not in scope of this reconciliation

- **#167 / #165 active-cashier picker** — not delivered. Forward-looking input
  only; the staff header is designed with room for it.
- **Business prerequisites per destination** — owned by the trading-day domain.
  This document specifies how an unmet prerequisite must *render*, never which
  destinations have which prerequisite.
- **The `/pos` sell screen's own design** — it is a placeholder with no advisory
  reference. Only its presence in the strip is reconciled here.
- **Anything touching sales, money, inventory, attribution, authentication, or
  append-only rules.** Nothing above proposes a change to any of these. Money
  remains integer cents.
