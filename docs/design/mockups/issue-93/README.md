# UCM Coffee Studio Admin Order History

Self-contained browser mockup for GitHub story #93. Open `index.html` directly in a modern browser. There are no network requests, external fonts, packages, build tools, or application-repository dependencies.

All people, orders, timestamps, items, and monetary figures in this bundle are sample data for design and QA review.

## Files

- `index.html`: semantic Admin shell and list/detail screen structure
- `styles.css`: local UCM Admin tokens, responsive layout, focus, and state styling
- `app.js`: sample data and all mockup interactions
- `PRODUCT.md`: users, purpose, personality, and product principles
- `DESIGN.md`: interaction and presentation decisions
- `brand-spec.md`: exact local token contract and small status additions

## List review paths

Use the dashed **Review states** utility below the table. It is explicitly outside the production controls.

- **Populated**: realistic orders across July 25–28, 2026
- **Filtered to empty**: exact empty title “No sales orders” plus guidance to clear filters
- **No orders**: exact empty title “No sales orders” without implying filters

The populated list includes:

- Walk-in: July 28, order 1037
- Parked: July 28, order 1041
- Void with retained positive values: July 28, order 1040
- Split (Cash + Online): July 28, order 1042
- Senior discount: July 28, order 1042
- Outstanding non-zero change: July 28, order 1039
- Settled non-zero change: July 28, order 1038
- Genuine zero tip and change: July 28, order 1037

## Detail review paths

Open any order number from the list. The dashed **Detail review states** utility exposes:

- **Split + Senior**: split portions exclude tip and sum to Total; discounted item identifies Senior
- **Parked**: positive Total with unavailable payment, cash/online portions, tip, cash received, change, settlement, and completion
- **Void**: original positive financials, a Void reason, and unavailable completion
- **Outstanding change**: non-zero Change owed with unavailable Change settled
- **Settled change**: non-zero Change owed with a recorded Change settled timestamp

The **Back to Order History** link retains current list search, filters, sorting, page size, page, and review state.

## Interaction checklist

- Sort Business day, Order no., Status, Order total, and Completed; select an active sort again to reverse it.
- Search customer names with leading/trailing spaces or mixed case. Displayed “Walk-in” is intentionally excluded from search.
- Combine Status and Payment filters with customer search.
- Change page size among 5, 10, 25, and 50 rows.
- Use Previous, numbered pages, and Next.
- Navigate list and detail by keyboard with visible focus.
- Resize below 800px for the mobile header, horizontal primary navigation, and table scroll hint.
- Enable reduced motion in the operating system to remove the brief screen transition.

## Scope guard

This is read-only history. It contains no create, edit, delete, void, reopen, selection, row-editing, or order-capture workflow. It does not modify any external repository or application code.

## Copy destination

The seven files in this directory can be copied verbatim into:

`docs/design/mockups/issue-93/`
