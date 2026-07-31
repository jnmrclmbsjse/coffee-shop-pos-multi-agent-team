# UCM Coffee Studio - Cash & expenses

Browser prototype for one new staff POS screen: **Cash & expenses** (`/pos/cash`).
This is a preserve-mode extension of the shipped UCM Coffee Studio mockups.

## Run it

Open `index.html` directly from disk. The prototype uses hash routing and resolves
to `index.html#/pos/cash`.

No build step, server, install, network request, package, external font or CDN is
required.

## Files

| File | Purpose |
|---|---|
| `index.html` | Staff shell, active navigation and review controls |
| `styles.css` | Binding UCM tokens and responsive screen styling |
| `app.js` | In-memory state, cents-safe validation, rendering and submission |
| `PRODUCT.md` | Product behavior and acceptance rules |
| `DESIGN.md` | Preserve-mode decisions and pinned renderings |
| `brand-spec.md` | Binding tokens and posture |

## Review states

The dashed **Review states / Mockup only** panel can show empty, selected-type,
filled, invalid, submitting, recorded, rejected, ledger, ledger-empty and no-day
states. These controls are outside the production UI.

The production form works. Valid entries append once to the top of the ledger.
Invalid amount and blank reason values receive specific inline errors. Data is
fictional, in-memory and resets on reload.

## Data and money

Money is stored and formatted as integer cents. Input is parsed by string shape;
invalid precision is rejected rather than rounded. Sample rows prove cash in,
cash out, expenses with and without categories, unattributed history, a renamed
staff snapshot and a deactivated staff snapshot in one ledger.

## SCOPE GUARD

This screen does not contain or implement:

- No edit, delete, undo, void, reversal or correction UI.
- No date picker or ability to write to another business day.
- No inactive staff in the attribution selector.
- No order capture, sales workflow or payment capture.
- No manager approval, back-office review, reporting or export.
- No reopening of a closed business day.
- No offline mode or cash-drawer hardware integration.
- No recipe or BOM depletion.
- No inventory, real-time stock ledger or inter-branch logistics.

The route to `/pos/open` is guidance only and is not implemented here.

## Accessibility notes

- Semantic header, nav, main, sections, fieldsets and table.
- Skip link and `aria-current="page"` on Cash & Expenses.
- Real radio inputs provide checked state beyond color; selected cards also show
  the word `Selected` and a radio mark.
- Amount and Reason use `required`, `aria-required`, associated error text,
  `aria-invalid` and focus-first-invalid behavior.
- The ledger is a focusable labelled scroll region with sticky table headers.
- Polite live regions announce validation, submission and recording results.
- The one 140ms state-entry fade collapses under reduced-motion preference.
- Navigation scrolls horizontally without page-level overflow.
