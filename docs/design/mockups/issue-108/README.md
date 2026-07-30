# UCM Coffee Studio staff inventory mockup

A self-contained, no-build browser prototype for the staff POS inventory workspace. Open `index.html` directly in a modern browser. It makes no network requests and uses no packages or external fonts.

## Files

- `index.html`: browser entry point
- `styles.css`: shipped UCM tokens, additive inventory tokens, and responsive layout
- `app.js`: in-memory sample data, rendering, validation, and interactions
- `PRODUCT.md`: workflow and data rules
- `DESIGN.md`: interface decisions and responsive behavior
- `brand-spec.md`: binding core tokens and additive inventory contract

## Review paths

Use the dashed `Review states` panel at the bottom of each screen. It is mockup-only and intentionally outside production controls.

### Opening

- Blank opening sheet
- Submitted read-only sheet with a `Not counted` row
- No active Critical items
- Level item unset or set
- No open business day
- Peak or normal day
- Each blocked count explanation: missing submitter, every item blank, inactive submitter, invalid quantity

### Closing

- Critical and non-Critical items together
- Blank or submitted read-only sheet
- Level item unset or set
- No open business day
- Each blocked count explanation

### Restock

- No count submitted for the day
- Populated data containing Urgent, Low, Below par, and Enough
- A level-counted row
- A quantity row with no par
- Opening or closing count selected
- No open business day

### Deliveries & wastage

- Empty movement list
- Several newest-first entries
- An entry with no reason and no recorder
- Negative and decimal validation
- No open business day

## Interaction checklist

- Switch among all four screens with the horizontal staff navigation.
- Confirm the active entry exposes `aria-current="page"`.
- Select count staff independently of any cashier session.
- Use quantity fields with zero as a valid value.
- Use all eight level choices by touch and keyboard.
- Submit opening and closing counts and observe the pending state.
- Confirm submitted sheets are read-only with no edit or delete controls.
- Start a separate blank sheet with `Record another opening count` or `Record another closing count`.
- Switch the Restock count in use and confirm the table recomputes.
- Record a movement and confirm the list updates without a page reload.
- Confirm the movement form resets to Delivery.
- Test keyboard focus, the skip link, live error announcements, and reduced motion.
- Test phone, portrait tablet, and landscape tablet widths.

## Scope guard

This prototype is inventory only. It contains no money, order capture, cashier session, live ledger, running stock balance, cup or lid variance, close-day variance, or back-office count review. Deliveries and wastage remain an append-only log and never affect restock status. All data is clearly fictional and resets on reload.
