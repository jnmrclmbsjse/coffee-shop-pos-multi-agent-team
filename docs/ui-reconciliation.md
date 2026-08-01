# Delivered UI reconciliation

Issue #174, Dev Task #177. Baseline reviewed: `bbc06e5`, with the consolidated
advisory reference from Design Task #176 at
`docs/design/mockups/issue-174/`.

This record covers the 21 delivered screens represented by Design Tasks #4,
#19, #41, #57, #70, #83, #96, #111, #126, #144, and #156, plus the delivered
Sell placeholder required by the story. Design Task #167 is forward-looking
input only because its active-cashier picker has not shipped.

The review compared the route inventory in `apps/web/src/App.tsx`, the shipped
screen and shell source, the prior advisory references listed in the screen
table, and the consolidated `DESIGN.md`, interactive mockup, and
`RECONCILIATION.md` from #176. The consolidated reference was inspected in its
1024 x 768 and 390 x 844 modes with both an open day and no day open.

## Verdict rules

A difference is material only when it affects destination presence, order, or
grouping; current-destination indication; signed-in or business-day context;
shared action hierarchy; loading, empty, error, or success cues; keyboard or
assistive-technology behavior; touch target size; reduced motion; or page-level
overflow at 1024 x 768 or 390 x 844.

Each material difference below has exactly one verdict. `RETAIN` identifies a
user, accessibility, or within-workspace consistency benefit. `CORRECT` names
the task that owns the correction. Matching a mockup is not, by itself, a
reason to correct the product.

## Material difference register

| ID | Material difference in the delivered UI | Verdict | Reason | Owning task |
| --- | --- | --- | --- | --- |
| S1 | The shared staff strip has eight destinations and omits Sell. Staff cannot return to `/pos` through the strip. | **CORRECT** | Sell is the first required destination, and omitting it breaks reachability from the other staff routes. | #178 |
| S2 | The delivered order is Open Day, Opening, Closing, Restock, Deliveries & Wastage, Order History, Cash & Expenses, Close Day. | **CORRECT** | The story fixes the nine-destination order and places Closing eighth. | #178 |
| S3 | The strip is flat, while the advisory reference separates Sell, day-opening, shift-work, and day-closing destinations without reordering them. | **CORRECT** | Subtle separators make the beginning, middle, and end of a shift easier to scan while preserving the binding order and direct access to every destination. | #178 |
| S4 | Every staff destination is always actionable. An unmet prerequisite is explained only after navigation by the destination screen. | **CORRECT** | The story requires unmet destinations to remain visible but non-actionable, announced as unavailable, omitted from the Tab order, marked without relying on colour, and unable to navigate. The existing domain prerequisite for each destination must be preserved rather than inferred from the mockup. | #178 |
| S5 | Active staff links already receive `aria-current="page"` from React Router, but their visible cue is a colour-tinted border and background only. | **CORRECT** | The semantic cue is already reflected. A non-colour visible indicator is still required for the active destination. | #178 |
| S6 | Business-day context is page-owned and inconsistent. It is conditional in two `PageHeading` implementations, absent from the Sell and Order History headings, and rendered separately below the Cash & Expenses heading. It disappears when no day is open. | **CORRECT** | The context must occupy one stable shell position and show either the open date and day type or `No business day open`. Consolidation also prevents the four current heading variants from drifting again. | #178 |
| A1 | Five of seven administrator destinations use the same `grid` icon; Products and Inventory share `box`. | **CORRECT** | The repeated decorative shapes do not identify destinations, especially when icons dominate the compact layout. Use distinct meaningful glyphs or no destination glyphs. | #179 |
| A2 | Active administrator links already receive `aria-current="page"` from React Router, but `.active` styling uses colour and tint without a non-colour indicator. | **CORRECT** | The semantic current state is already reflected. The visible state must remain distinguishable without colour. | #179 |
| A3 | At 390 x 844 the administrator sidebar becomes a fixed, horizontally scrolling bottom bar and hides the Workspace, Catalog, and Operations labels. | **CORRECT** | The responsive bar keeps destinations reachable, but dropping the labels removes the grouping that the story requires at every supported width. | #179 |
| A4 | The narrow administrator navigation is a fixed bottom bar rather than the advisory reference's compact top header. | **RETAIN** | The established bottom position is consistent across all delivered administrator routes, keeps 56 px targets within thumb reach, and does not mix in the staff strip. Correct A3 within this shared component without moving the navigation. | None |
| C1 | The shipped warning ink, surface, and border values differ from the authoritative semantic warning tokens. Equivalent restock, radius, touch-target, field-height, and control-shadow values are also repeated as literals. | **CORRECT** | Binding the existing token roles gives state cues one maintained convention. Only the three warning roles change rendered values; the remaining substitutions preserve the current rendering. No new token is needed. | #179 |

`NavLink` behavior was verified against the installed React Router 7.18.1
implementation, which applies `aria-current="page"` to active links. The
consolidated advisory record incorrectly described the administrator links as
missing that attribute. A2 therefore owns only the missing non-colour visual
indicator.

## Screen record

Shared-shell IDs in the `Differs` column refer to the register above. A screen
with several IDs inherits each ID's single verdict rather than creating a new
verdict for the same shell difference.

| Screen | Route | Source file | Design ref | Reflected | Differs | Verdict (RETAIN / CORRECT) | Reason | Owning task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin sign-in | `/sign-in` | `apps/web/src/App.tsx` (`SignInPage`) | #3, `docs/design/mockups/issue-3` | Generic refusal; associated field errors; focusable alert; password visibility control; duplicate-safe loading; validated return path | None material | **RETAIN** | Keeping both authenticated shells absent before sign-in avoids presenting inaccessible destinations and preserves workspace separation. | None |
| Staff sign-in | `/staff/sign-in` | `apps/web/src/StaffSignIn.tsx` | #18, `docs/design/mockups/issue-18` | Staff-only entry; remembered-staff and password paths; touch PIN pad; literal empty/error cues; clear transition to POS | None material | **RETAIN** | The dedicated entry surface supports counter use and correctly renders neither authenticated shell. | None |
| Sell | `/pos` | `apps/web/src/App.tsx` (`PointOfSalePage`) | No delivered screen reference; shell reference #176 | Staff shell, skip link, `#staff-main`, signed-in context | S1-S6 | **CORRECT** | The placeholder content remains out of scope, but Sell must participate in the same reachable, state-aware shell as every other staff route. | #178 |
| Open Day | `/pos/open` | `apps/web/src/trading-day/StaffTradingDayPages.tsx` (`OpenBusinessDayPage`) | #123, `docs/design/mockups/issue-123` | Day-type choice; explicit open/no-open states; touch-safe controls; reduced-motion treatment | S1-S6 | **CORRECT** | Shared staff-shell findings apply. Existing open-day prerequisites remain authoritative. | #178 |
| Opening | `/pos/opening` | `apps/web/src/inventory/StaffInventoryPages.tsx` (`OpeningCountPage`) | #108, `docs/design/mockups/issue-108` | Critical-items sheet; accessible level choices; staff selectors; read-only submitted state; blocking state | S1-S6 | **CORRECT** | Shared staff-shell findings apply; the screen workflow itself is retained. | #178 |
| Restock | `/pos/restock` | `apps/web/src/inventory/StaffInventoryPages.tsx` (`RestockStatusPage`) | #108, `docs/design/mockups/issue-108` | Real table; text-first Urgent / Low / Below par / Enough scale; narrow table scroll hint | S1-S6, C1 | **CORRECT** | Shared shell corrections apply. Preserve the status words as the non-colour meaning while binding their existing values to tokens. | #178, #179 |
| Deliveries & Wastage | `/pos/movements` | `apps/web/src/inventory/StaffInventoryPages.tsx` (`StockMovementsPage`) | #108, `docs/design/mockups/issue-108` | Append-only table without edit actions; explicit movement type; focusable overflow region and hint | S1-S6, C1 | **CORRECT** | Shared shell corrections apply; append-only behavior and the delivered screen structure are retained. | #178, #179 |
| Order History | `/pos/orders` | `apps/web/src/orders/StaffOrderHistoryPage.tsx` | #142, `docs/design/mockups/issue-142` | Read-only ledger; full-word status; neutral struck-through Void; explicit empty state; filters and day selection | S1-S6 | **CORRECT** | Shared shell corrections apply. Retain the delivered card ledger because it preserves readable grouping at 390 px better than the advisory dense table. | #178 |
| Cash & Expenses | `/pos/cash` | `apps/web/src/trading-day/CashAndExpensesPage.tsx` | #154, `docs/design/mockups/issue-154` | Real radio inputs; integer-cent amount handling; permanent-ledger wording; explicit loading, error, no-day, success, and empty states | S1-S6, C1 | **CORRECT** | Shared shell and warning-token corrections apply; cash and expense behavior is unchanged. | #178, #179 |
| Closing | `/pos/closing` | `apps/web/src/inventory/StaffInventoryPages.tsx` (`ClosingCountPage`) | #108, `docs/design/mockups/issue-108` | All active items; Critical-first ordering; `Not counted` for omitted rows; read-only submission | S1-S6 | **CORRECT** | Shared staff-shell findings apply; S2 moves this destination from third to eighth. | #178 |
| Close Day | `/pos/close` | `apps/web/src/trading-day/StaffTradingDayPages.tsx` (`CloseBusinessDayPage`) | #123, `docs/design/mockups/issue-123` | Reconciliation table; pinned change-owed wording; non-colour discrepancy text; expected-cash ordering | S1-S6, C1 | **CORRECT** | Shared shell and warning-token corrections apply; close-day business behavior is unchanged. | #178, #179 |
| Dashboard | `/dashboard` | `apps/web/src/reporting/DashboardPage.tsx` | #80, `docs/design/mockups/issue-80` | Grouped admin shell; compact metrics; mono numerics; literal empty/error states; accessible chart value tables | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Correct current cues, grouping, icons, and shared tokens without replacing the established responsive navigation position. | #179 |
| Categories | `/catalog/categories` | `apps/web/src/catalog/CategoriesPage.tsx` | #40, `docs/design/mockups/issue-40` | Responsive semantic table/records; ordering; separate availability and configuration; established action hierarchy | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Shared administrator-shell and convention findings apply. | #179 |
| Products | `/catalog/products` | `apps/web/src/catalog/ProductsPage.tsx` | #40, `docs/design/mockups/issue-40` | Size/price structure; configuration/availability split; 44 px targets and 48 px fields; explicit loading/empty cues | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Shared administrator-shell and convention findings apply. | #179 |
| Product editor | `/catalog/products/new`, `/catalog/products/:id/edit` | `apps/web/src/catalog/ProductEditorPage.tsx` | #40, `docs/design/mockups/issue-40` | In-context editor; visible labels; associated errors; primary/secondary/destructive action distinction | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | One delivered editor screen serves create and edit routes; shared shell findings apply to both. | #179 |
| Inventory items | `/inventory` | `apps/web/src/inventory/InventoryPage.tsx` | #55, `docs/design/mockups/issue-55` | Count methods; normal/peak par levels; labelled blocked actions; responsive tables; explicit loading/empty cues | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Shared administrator-shell and convention findings apply. | #179 |
| Inventory item editor | `/inventory/items/new`, `/inventory/items/:id/edit` | `apps/web/src/inventory/InventoryItemEditorPage.tsx` | #55, `docs/design/mockups/issue-55` | In-context editor; preserved saved values on recovery; visible labels; primary/secondary/destructive hierarchy | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | One delivered editor screen serves create and edit routes; shared shell findings apply to both. | #179 |
| Staff roster | `/staff` | `apps/web/src/staff/StaffPage.tsx` | #67, `docs/design/mockups/issue-67` | Composed search/filter/sort; staged dialog changes; announced status changes; text badge plus labelled switch | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Status is already communicated without colour alone; shared shell and token findings still apply. | #179 |
| Reports | `/reports` | `apps/web/src/reporting/ReportsPage.tsx` | #80, `docs/design/mockups/issue-80` | Defined export; read-only results; sticky table headers; labelled horizontal overflow; explicit loading/error/empty states | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Shared administrator-shell and convention findings apply. | #179 |
| Order History | `/order-history` | `apps/web/src/pages/OrderHistoryPage.tsx` | #93, `docs/design/mockups/issue-93` | Paired day/order identity; `aria-sort`; labelled filters; full-word statuses; explicit loading/empty/error cues; scroll hint | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Status and table behavior already avoid colour-only meaning; shared shell and token findings apply. | #179 |
| Order detail | `/order-history/:id` | `apps/web/src/pages/OrderHistoryDetailPage.tsx` | #93, `docs/design/mockups/issue-93` | Read-only detail; paired order/day identity; semantic item table; explicit unavailable-value and discount rendering | A1-A4, C1 | **CORRECT** A1-A3, C1; **RETAIN** A4 | Shared administrator-shell and convention findings apply; production controls remain absent. | #179 |

## Responsive behavior observed in the delivered shell

| Viewport | Staff workspace | Administrator workspace | Verdict |
| --- | --- | --- | --- |
| 1024 x 768 | The header uses brand plus a `minmax(0, 1fr)` navigation column. The strip is right-aligned and has `overflow-x: auto`; links are fixed-width, at least 44 px high, and remain in visible/keyboard order. | The 228 px sticky sidebar remains visible with all three group labels. Content occupies the remaining `minmax(0, 1fr)` column. | **RETAIN** these responsive structures. Apply S1-S6 and A1-A2 without widening the page. |
| 390 x 844 | The header switches to one column, left-aligns the strip, and keeps horizontal overflow on the navigation element. Content padding reduces to 16 px and comparison tables retain their own overflow wrappers. | The sidebar component becomes a fixed 68 px bottom bar. Its navigation scrolls horizontally and each link is at least 68 x 56 px, but group labels are hidden. | **RETAIN** the staff scroll behavior and administrator bottom position. **CORRECT** A3 within the scrolling navigation and verify no page-level horizontal overflow after adding labels and distinct cues. |

The source establishes the intended overflow containment, target sizes, focus
styles, and reduced-motion overrides. Final no-page-overflow verification for
every route belongs with the implemented corrections and the viewport coverage
in #178, #179, and #180; this record does not claim that unrendered future
changes already pass.

## Shared conventions to preserve and complete

- Preserve the existing skip links, navigation landmarks, route guards,
  route-change focus behavior, live regions, visible focus rings, and
  `prefers-reduced-motion` overrides.
- Preserve each workspace's existing primary, secondary, and destructive action
  hierarchy. Destructive actions remain named, visually distinct, and never the
  page primary.
- Use literal text plus semantics for loading, empty, error, and success states.
  Animation and colour may reinforce state but may not carry the meaning.
- Preserve the Restock word scale and the full-word order statuses as models for
  non-colour state communication.
- Consolidate only onto roles already present in `docs/design/tokens.json`; do
  not add tokens or alter business behavior under this story.

## Deliberate non-material deviations

- The staff strip is right-aligned at wide widths and left-aligned below
  1000 px. Alignment does not change destination access, order, state, or
  overflow behavior.
- Staff Order History uses cards rather than the advisory table. The cards keep
  related order facts readable at 390 px without changing the read-only task or
  status meaning.
- Administrator sidebar width is 228 px rather than the 232 px used in some
  advisory references. This does not change navigation or task completion.
- `AdminLayout` currently calls `scrollIntoView({ block: 'nearest', inline:
  'nearest' })` for the active link. The reference recommends direct
  `scrollLeft` adjustment, but the implementation technique is not itself a
  material rendered difference. #179 may preserve it if viewport tests show no
  page jump or page-level overflow.

## Deferred: needs a separate story

- A visual and interaction design for the Sell surface itself. `/pos` is a
  delivered placeholder with no prior advisory screen reference. This story
  owns its navigation presence only.

The active-cashier picker from #167 is also excluded from this record, but it
already has its own story (#165) and therefore does not require another one.
