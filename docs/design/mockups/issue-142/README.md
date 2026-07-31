# UCM Coffee Studio Order History

A self-contained, preserve-mode browser prototype for the staff POS workspace route `#/pos/orders`.

## Run it

No build step, package install, network connection, or local server is required.

1. Open `index.html` in a modern browser.
2. The prototype sets the hash route to `#/pos/orders` when no hash is present.
3. Reload the page to reset all in-memory data and filters.

For a local static server, any simple file server is sufficient, but none is required.

## Files

- `index.html`: semantic staff shell and Order History screen
- `styles.css`: fixed UCM tokens, responsive layout, focus states, and card styling
- `app.js`: fictional in-memory business days, orders, filtering, and review-state fixtures
- `PRODUCT.md`: screen behavior and domain rules
- `DESIGN.md`: preserve-mode design decisions
- `brand-spec.md`: fixed token contract, typography, and contrast notes

## Production controls

The production surface has five controls:

- Business day selector
- Status filter
- Payment filter
- Customer-name search
- Clear filters

The ledger has no order actions. There is no order capture, edit, resume, complete, void, delete, row menu, or export control.

## Review states

The dashed panel at the bottom is a mockup-only harness. It can jump to:

- Open day selected
- Closed day with parked and void orders
- Past day selected
- No day open, defaulting to the most recently opened day
- No business day exists at all
- Filters excluded everything
- Three active filters retained after a day switch
- Void and re-entry pair
- Split payment
- Change given and change still owed
- Unattributed cashier
- Discounted order line

These controls change only the displayed fixture state. They do not mutate an order.

## Data notes

- All people, orders, branches, and values are fictional.
- Data is kept in memory and resets on reload.
- Money starts as integer cents and is formatted as Philippine pesos.
- Business-day order numbers restart per day. Order number `3` exists on all three sample days.
- The open 31 July business day contains an order completed at 12:18 AM on 1 August.
- Open and closed days are identified by explicit option text, not by color.
- The two change fixtures both use the same `₱50.00` amount. Their labels and border treatments carry settlement state.

## SCOPE GUARD

This prototype does not contain:

- Order capture, including a cart, menu, drink builder, or payment entry
- Any mutation of an order
- Offline mode
- Hardware integration
- Recipe or BOM depletion
- Inter-branch logistics
- A real-time stock ledger
- Back-office or owner reporting
- Export

The owner-facing cross-day order history is a separate screen. It is not reused or modified here.
