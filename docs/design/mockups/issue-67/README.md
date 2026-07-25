# UCM Coffee Studio POS Staff Roster Mockup

Browser-viewable prototype for GitHub story #67, focused on admin management of the cashier roster.

## Open

Open `index.html` directly in a modern browser. No build step or network connection is required.

## Files

- `index.html`: semantic application shell, toolbar, table, responsive states, and dialog.
- `styles.css`: supplied UCM tokens, responsive layouts, control states, and accessibility styling.
- `app.js`: seeded roster and all prototype interactions.
- `DESIGN.md`: concise visual and interaction rationale.
- `PRODUCT.md`: product context used by the mockup.
- `brand-spec.md`: exact core token binding and posture rules.

## Prototype states

Use the clearly labeled **Mockup states** select above the roster:

- Populated roster
- Empty roster
- No results

The same states can be opened with `?state=empty` or `?state=no-results`. Returning to populated state removes the query parameter.

## Demonstrated behavior

Search uses case-insensitive name matching. Status filtering and both sort directions compose with search. Add and edit dialogs trim names, allow duplicates, validate required names, preserve changes only after save, and support Escape. Each row can be activated or deactivated inline with visible text and live feedback.

The seeded roster contains eight entries, including active and inactive entries and duplicate names. On screens below 760px, the semantic table is presented as labeled records and the dialog becomes a near-full-screen sheet.
