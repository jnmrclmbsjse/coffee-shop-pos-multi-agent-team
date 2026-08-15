# Admin daily inventory reconciliation and restock report

## Design read

Preserve-mode admin reporting screen for operations administrators. Design variance is 3, motion intensity is 1, and visual density is 6. The reference keeps the existing cool neutral palette, system sans and mono number treatment, compact bordered report panels, conventional tables, and the existing admin navigation language. It deliberately avoids dashboard novelty, animation, and any staff closing-workflow affordance.

Current-state audit supplied by the brief:

- Brand tokens, typography, radii, and control depth are preserved exactly in the standalone `:root` block.
- The sidebar information architecture remains Workspace / Catalog / Operations, with Reports retained as the reporting destination.
- Existing reporting idioms are reused by class name: report shell, filter, panel, table region, table, notices, loading, applied scope, empty state, and scroll hint.
- Existing staff restock status badges are reused for the same four bands.
- The current sales report uses a date range. Daily inventory visibly uses one business date.
- The screen is admin-only and read-only. It never routes through `/pos/closing` or `/pos/restock`.

The `.prototype` wrapper, `.prototype-head`, `.prototype-nav`, `.mockup-section`, `.section-label`, `.assessment-note`, `.state-switcher`, and `.preview-frame` are reference-document scaffolding. State switchers, assessment notes, and simulated states do not ship in the product.

## Decision and rationale

Place Daily inventory inside Reports as a local page-context option next to Sales. This matches the switch idiom already established by Compensation, keeps the already-dense Operations group stable, and makes both reporting views available at one admin destination. A sixth Operations entry would overstate a difference in destination while adding navigation load.

The report identity is persistent: business date, location, and Read-only status remain in the page header. The single-date field is labelled Business date and is paired with the explicit applied scope `Showing August 15, 2026 · Escolta branch`. On initial load, the selected business date defaults to today for the selected location.

During day changes, the date field may show the requested date, but the page header and applied-scope line continue naming the loaded date. Existing content is dimmed under `aria-busy="true"`, pointer interaction is disabled, and a polite live region announces the requested date and location. The new report replaces the old one atomically after the GET succeeds. This prevents stale numbers from appearing under a new date label.

The packaging table explains the arithmetic instead of giving all numbers equal weight. Opening + deliveries - wastage - used form one Derivation group. A stronger vertical separator and subtle outcome tint distinguish expected closing, actual closing, and variance. Variance equals actual closing minus expected closing. Every result combines an explicit sign with Surplus, Short, or Even so color is never the only carrier.

Unavailable is a data state, not numeric zero. The literal word uses muted italic sans text inside numeric columns so it cannot be scanned as a count. A persistent footnote explains the distinction. Screen readers receive `Unavailable: [reason]. No count was taken; this is not a count of zero.` Derived expected closing and variance also become Unavailable when a required opening or closing count is absent.

Restock provenance is persistent copy. The list names whether it uses the opening or closing submission and gives its date and time. Only Urgent, Low, and Below par rows appear. Enough rows are intentionally omitted, and the screen says so. Rows sort by band, then Critical before non-Critical within the band, then item name A-Z within each Critical group. A compact Critical marker beside the item name is recommended because Critical is an inventory-item setting distinct from the Urgent band and already appears on the staff surface. Without it, administrators cannot explain why two items in the same status band are ordered differently.

No control mutates inventory data. The only escape hatch is the underlined `Inventory settings` navigation link, explicitly described as configuration navigation rather than a report action.

## Token statement

The standalone reference declares only the supplied tokens in `:root`. It proposes no new tokens. When this reference is lifted into the application stylesheet, drop the entire `:root` block and consume the tokens already shipped by the app. Component CSS should continue to use those semantic tokens rather than copying resolved color values.

## Copy deck

Prototype scaffolding:

- `Advisory implementation reference`
- `Admin daily inventory reconciliation and restock report`
- `Preserve-mode reference for GitHub story #324 and design task #325. The controls above each preview simulate states; they are not proposed product controls.`
- Section jumpers: `Navigation`, `Report shell`, `Reconciliation`, `Unavailable`, `Restock`, `Empty states`
- Section labels: `Navigation placement`, `Report shell and day selection`, `Cup-and-lid reconciliation table`, `Unavailable count states`, `Restock needs list`, `Distinct empty states and read-only boundary`
- State labels: `Daily inventory selected`, `Sales selected`, `Loaded`, `Changing day (re-fetch)`, `Load error`, `Mixed variances`, `All even`, `All counted`, `Missing opening`, `Missing closing`, `Missing both`, `Needs restock`, `Nothing needs restocking`, `No count submitted for this day`, `Opened day, no activity`, `Business day not opened`, `No restock count`
- Assessment decisions: `Decision: Keep Reports as one Operations destination. Add a local Sales / Daily inventory switch inside the Reports page, matching the page-context switch already used by Compensation.`, `Decision: Use one business-date field. Keep the loaded scope visible during a day change, then replace the whole report atomically so a new label never appears above stale numbers.`, `Decision: Present opening + deliveries - wastage - used as a derivation group, then separate expected and actual as outcomes. Variance always includes a sign and a word.`, `Decision: Use the literal sans-serif word “Unavailable” in every missing or invalidly derived cell. Keep a persistent explanation below the table and announce the full meaning to screen readers.`, `Decision: State the count source and submission time in persistent copy. List only actionable bands, retain staff badge language, and show a Critical marker beside affected item names.`, `Decision: Name the business date and location in every empty state. Distinguish an opened day with no reportable activity from a day that never opened, and never offer mutation controls here.` These are mockup-only.
- Scaffolding accessibility labels: `Reference sections`, `Navigation reference states`, `Report shell states`, `Reconciliation examples`, `Count availability states`, `Restock states`, `Empty report states`.

Shared admin shell and report identity:

- `Coffee POS Admin`
- `Workspace`, `Dashboard`
- `Catalog`, `Categories`, `Products`
- `Operations`, `Inventory`, `Staff`, `Reports`, `Compensation`, `Order History`
- `Sales`, `Daily inventory`
- `Sales report`
- `Review completed sales across a date range.`
- `Daily inventory report`
- `Reconcile packaging counts and review restock needs for one business day.`
- `Business date: August 15, 2026`
- `Business date: August 14, 2026`
- `Location: Escolta branch`
- `Read-only`
- `Business date`
- `Show report`
- `Showing August 15, 2026 · Escolta branch`
- `Showing August 14, 2026 · Escolta branch`
- `Loading August 15, 2026 for Escolta branch…`
- `Report could not be loaded`
- `Daily inventory data for August 15, 2026 at Escolta branch is unavailable. Try the request again.`
- `One reporting destination`
- `The sidebar remains stable. Report type changes in local page context, without entering staff closing or restock workflows.`
- `Inventory settings`
- `Inventory settings is labelled navigation for configuration. This report does not offer editing actions.`
- `Admin navigation`
- `Report type`
- `Loaded report for August 14, 2026 is dimmed while the new day loads`

Reconciliation table:

- `Cup and lid reconciliation`
- `Physical item counts for the selected business day. Variance equals actual closing minus expected closing.`
- `Cup and lid counts for August 15, 2026 at Escolta branch. All values are physical item counts.`
- `Cup and lid counts for August 14, 2026 at Escolta branch. All values are physical item counts.`
- `Swipe or scroll horizontally to review all columns.`
- `Cup and lid reconciliation table. Scroll horizontally for more columns.`
- Table headers: `Item`, `Derivation: opening + deliveries - wastage - used`, `Outcome`, `Opening`, `Deliveries`, `Wastage`, `Used by completed sales`, `Expected closing`, `Actual closing`, `Variance`
- Items: `8 oz hot cup`, `8 oz hot lid`, `16 oz cold cup`, `16 oz cold lid`
- Variance labels: `Surplus`, `Short`, `Even`
- Visible sample count strings: `120`, `48`, `3`, `101`, `64`, `62`, `118`, `50`, `2`, `65`, `67`, `80`, `24`, `1`, `41`, `79`, `0`, `40`, `+2`, `-2`, `-1`

Unavailable states:

- `All opening and closing counts submitted.`
- `Opening count unavailable for 8 oz hot cup.`
- `Closing count unavailable for 8 oz hot cup.`
- `Opening and closing counts unavailable for 8 oz hot cup.`
- `Count availability example for August 15, 2026 at Escolta branch.`
- `Unavailable`
- `Unavailable means no count was taken. It is not the same as a count of zero. Expected closing and variance are also Unavailable when a required count is missing.`
- Screen-reader reasons: `opening count not submitted`, `closing count not submitted`, `expected closing cannot be calculated without an opening count`, `variance cannot be calculated without both opening and closing counts`
- Screen-reader suffix: `No count was taken; this is not a count of zero.`

Restock:

- `Restock needs`
- `Read-only priorities for the selected business day.`
- `This list uses the closing count submitted on August 15, 2026 at 9:42 PM.`
- `Only Urgent, Low, and Below par items are shown. Items with Enough stock do not appear.`
- Restock table caption: `Items below their restock threshold, ordered by status, Critical setting, then item name.`
- `Restock needs table. Scroll horizontally for more columns.`
- Restock table headers: `Item`, `Counted amount`, `Target (par)`, `Status`
- Items: `Oat milk`, `8 oz hot cups`, `Vanilla syrup`, `16 oz cold lids`, `Chocolate powder`, `Paper bags`
- Status and setting labels: `Urgent`, `Low`, `Below par`, `Enough`, `Critical`
- Level words represented by the component contract: `Empty`, `Low`, `Quarter`, `One-third`, `Half`, `Two-thirds`, `Three-quarters`, `Full`
- Visible sample count and target strings: `2`, `12`, `18`, `80`, `34`, `60`, `42`, `55`
- `Nothing needs restocking`
- `The closing count submitted on August 15, 2026 at 9:42 PM for Escolta branch has no Urgent, Low, or Below par items.`
- `No count submitted for this day`
- `No opening or closing count was submitted for August 15, 2026 at Escolta branch, so a restock list cannot be prepared.`

Empty and read-only states:

- `Nothing reportable for this opened day`
- `The business day for August 15, 2026 at Escolta branch was opened, but it has no counts, movements, or completed-sale packaging usage.`
- `Business day not opened`
- `No business day was opened for August 15, 2026 at Escolta branch. There is no daily inventory report for this date.`
- `No restock count submitted`
- `No opening or closing count was submitted for August 15, 2026 at Escolta branch, so no restock list is presented.`
- `This report is read-only. To manage item configuration, use Inventory settings.`

## Implementation handoff

### 1. Requirements

1. The surface is admin-only and read-only. Every data request is a GET. Do not expose it to staff or require entry through `/pos/closing` or `/pos/restock`.
2. Default the single business-date control to today's business date for the selected location. The report identity and applied scope must always name both business date and location.
3. A requested date must never label stale data. During a re-fetch, keep the loaded date visible with dimmed `aria-busy` content or replace the report with geometry-matched skeletons. Announce loading and completion in a polite live region.
4. Render physical item counts only. No currency formatting appears anywhere on this screen.
5. Compute packaging reconciliation at read time in Inventory ownership per ADR 0006 §5: `expected closing = opening + deliveries - wastage - used by completed sales`; `variance = actual closing - expected closing`.
6. Per ADR 0010, sold packaging usage must respect multi-serving packaging draw and come from the sale-time servings snapshot. Later catalog edits must not rewrite a past business day's usage.
7. Per ADR 0004, scope every query and label to the selected location's business day rather than a naive calendar interval.
8. Per ADR 0001, counts and corrections are append-only. Follow correction chains to full depth. Both the reconciliation and restock sections must resolve to the same final corrected count.
9. `Unavailable` never collapses to `0`. A `?? 0` anywhere in the render path is a defect. Missing opening or closing input also makes every dependent expected-closing or variance value `Unavailable`.
10. Item scope is what participated on the selected day. A cup or lid deactivated since that date still appears and must not be filtered by the current `active` flag.
11. Include one reconciliation row per participating cup or lid item. Preserve the seven figures in arithmetic order and visually group derivation inputs apart from outcomes.
12. Variance must expose an explicit numeric sign and the words `Surplus`, `Short`, or `Even`. Positive means actual stock exceeded expected stock.
13. Restock provenance must name whether the list uses the selected day's opening or closing count and give the resolved submission's date and time.
14. Restock rows include only Urgent, Low, and Below par. Sort by that band order, then Critical items before non-Critical items within each band, then item name A-Z within each subgroup. Enough items never appear.
15. Level-counted items show one of the eight level words and target `Unavailable`. Quantity-counted items without par for the selected day type also show target `Unavailable`.
16. Keep the three empty states distinct: opened day with nothing reportable, business day never opened, and no opening or closing count for restock. Each names the selected date and location.
17. Use a caption, scoped column and group headers, and `scope="row"` on item names. The existing `.report-table-region` is focusable, labelled, and horizontally scrollable at all widths.
18. All targets are at least 44px. Keyboard focus uses a visible 3px `--focus` ring. No meaning depends on color, no information exists only in a `title` attribute, and Unavailable cells receive the specified reason plus zero distinction in their accessible name.
19. Do not imply a live stock ledger, running balances, ingredient or recipe depletion, inter-branch comparison, or current stock. Everything is scoped to the selected business day.
20. Do not expose count editing, movement recording, target changes, or variance correction controls. Any route to configuration is labelled navigation, not an action button.

### 2. Advisory

1. Use the existing Reports page shell and put Sales / Daily inventory before the page title. Keep the sidebar unchanged.
2. Extend `.report-filter` with a single-date composition rather than a new filter family. Keep the Business date label above the native date field and make the difference from Sales' two-date range visibly deliberate.
3. Keep business date and location in the page header even when the report body is empty or failed. This preserves identity during support and audit work.
4. Prefer dimmed loaded content during re-fetch because it retains table geometry and gives the administrator context. Keep its applied scope naming the loaded date until the replacement succeeds.
5. Use mono only for numeric values. Keep Unavailable, variance words, level words, and labels in the sans face.
6. Use one stronger separator and a subtle shared tint for the Outcome group. Do not introduce cards or a second table language.
7. Keep the persistent Unavailable legend immediately below the table so it remains visible to mouse, touch, keyboard, and assistive-technology users.
8. Reuse the table's existing horizontal-scroll wrapper at 390px. Do not transform rows into mobile cards. Show the existing scroll hint on narrow screens.
9. Show the Critical marker next to the item name. It explains sorting and preserves the distinction between an item-level setting and a computed restock band.
10. The positive restock empty state may use `--success-surface`; the no-count state remains neutral because it is missing input, not success or failure.
11. Motion intensity remains 1: no automatic animation. Use only immediate pressed, hover, focus, loading, and selected-state feedback.
12. Treat dates, times, counts, and item names in this reference as labelled mock content. Production values come only from the selected business day GET response.

### 3. Proposed material changes to existing shared shells/components

1. Introduce a sibling `PackagingReconciliationTable`; do not extend the existing `ReconciliationTable`. The existing component represents cash daily reconciliation, while packaging has a different item scope, arithmetic, unavailable propagation, grouped headers, and correction provenance. Sharing a name or branching one component would blur two accounting domains. Reuse lower-level report table styles and the focusable region, not cash-specific semantics.
2. Add the local Sales / Daily inventory switch to the Reports route, reusing Compensation's page-context switch behavior. This keeps `/reports` as one admin reporting destination and avoids a sixth Operations sidebar entry.
3. Add a supported single-date composition to `.report-filter`. Keep the same container, field, action, responsive, and focus idioms while accepting one `businessDate` field instead of Sales' start and end fields. This is a variant of the shipped filter, not a new filter component language.
4. Reuse `.staff-restock-status` and its `.urgent`, `.low`, `.below-par`, and `.enough` modifiers on the admin surface. The bands mean the same thing in staff and admin contexts, so a second badge vocabulary would create translation risk and visual drift.
5. Add the local Critical marker beside item names through the same shared inventory-item presentation used by staff. Do not encode Critical into `.staff-restock-status`; Critical is a stored item setting, while the four bands are computed state.
6. Ensure the existing report fetch shell can preserve the loaded scope while a new GET is pending and can atomically replace all dependent panels. Reconciliation and restock must consume the same corrected count resolution result.
