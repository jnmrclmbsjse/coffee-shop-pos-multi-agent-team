# UCM Coffee Studio story #351 mockup

Static, dependency-free HTML/CSS/JS reference for amending incorrect cash movements without deleting history.

## Open the mockup

Open `index.html` directly in a browser. It works from `file://` and uses no external assets, packages, fonts, or CDNs.

## Navigate the states

Use the dashed `Story #351 review states` controls below the page heading.

1. **Amend affordance** shows the ordinary open-day row action plus closed-day and already-superseded unavailable examples.
2. **Amendment flow** shows the original entry and editable corrected type, amount, description, and category. Change the type to see category availability update.
3. **Review before confirm** compares original and proposed values. Reach it through `Review correction` or the state control.
4. **Corrected ledger** shows a corrected pair, a chain with three corrections, and a cross-type Cash in to Cash out example.
5. **Effective totals** explains why only the effective correction counts and shows the amended summary.
6. **Failures and conflicts** provides interactive 409 day-closed, 409 already-superseded, and 400 validation outcomes.

The URL hash records the selected review state, so examples can be opened directly, such as `index.html#ledger`.

## Files

- `index.html`: preserved staff shell and state-review navigation.
- `styles.css`: binding tokens, shipped screen styling, and additive amendment state treatments.
- `app.js`: local state navigation, form behavior, review, ledger examples, totals, and failures.
- `DESIGN.md`: audit, design decisions, accessibility model, and implementation handoff.
- `PRODUCT.md`: product-state and copy decisions.
- `brand-spec.md`: binding token contract and additive-token decision.

## Prototype boundary

The dashed state selector is a review fixture, not production UI. Amounts and ids are labelled scenario data for explaining the story. The prototype does not call an API or persist corrections.
