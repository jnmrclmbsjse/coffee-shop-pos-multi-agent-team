# UCM Coffee Studio — Open / Close business day

Browser prototype for two new screens in the staff POS workspace:
**Open business day** (`/pos/open`) and **Close business day** (`/pos/close`).

Preserve-mode extension of eight already-shipped UCM Coffee Studio mockups.

---

## Run it

Open `index.html` directly from disk. Double-click it, or:

```
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

No build step, no server, no install. Zero network requests, no packages, no
external fonts, no CDN. Everything is `index.html` + `styles.css` + `app.js`.

## Files

| File | What it is |
|---|---|
| `index.html` | Shell (header, nav, skip link) and both screen containers |
| `styles.css` | Brand tokens and all styling |
| `app.js` | State, rendering, validation, money formatting |
| `PRODUCT.md` | What the screens do and the rules they enforce |
| `DESIGN.md` | Design decisions, including the three pinned renderings |
| `brand-spec.md` | Token contract and the additive set |

## Navigate

| Screen | URL |
|---|---|
| Open business day | `index.html#/pos/open` (default) |
| Close business day | `index.html#/pos/close` |

Hash routing, because the prototype is opened from the filesystem. `Take Order`,
`Order History`, `Cash & Expenses`, `Opening`, `Closing`, `Restock` and
`Deliveries & wastage` are rendered in the nav in their final positions but are
inert — they are not part of this prototype.

## Review states

Each screen has a dashed **Review states / Mockup only** panel at the bottom,
outside the production controls. It is not a production feature. Use it to jump
between states:

**Open business day**

- Empty form · Filled form · Invalid submission · Date already used · Submitting
- Day open (Normal) · Day open (Peak)

**Close business day**

- No day open · Open day with no closing count · Open day with a closing count ·
  No items marked reconciled
- Not counted yet · Discrepancy balanced · Discrepancy short · Discrepancy over
- Idle · Submitting · Invalid submission

The cup/lid table deliberately shows an unknown-expected row, an unknown-actual
row, both-known rows and a **genuine zero row all at once**, so unknown-vs-zero
is provable on screen rather than asserted in a doc. See `DESIGN.md` §0.3.

The production forms also work for real: type a drawer count and the discrepancy
updates live before any submission; submit an incomplete form and it fails with
a specific explanation.

## Data

All sample data is in-memory, obviously fictional, and **resets on reload**.
Nothing persists. Staff names, dates and quantities are invented.

The only non-zero cash figure is the opening float. Cash sales, online sales,
tips, cash in, cash out and expenses have no capture workflow in this build, so
they render as genuine labelled zeros (`₱0.00`) rather than as unknowns, hidden
rows or placeholder copy. Genuine zero and unknown are different things on the
close screen, and the design holds that line.

Money is peso-formatted from **integer cents** everywhere. There are no floats.

---

## SCOPE GUARD

These two screens **do not** contain, and this prototype does not implement:

- **No order capture.** No cart, no menu, no drink builder, no payment.
- **No live stock ledger.** No movement history, no audit trail.
- **No running stock balance.** Quantities shown are per-day reconciliation
  figures only.
- **No recipe / BOM depletion.** Packaging reconciliation is **direct cup/lid
  mapping only** — one drink maps to one cup and one lid. No ingredient
  explosion, no yield maths, no partial units.
- **No reopening of a closed day.** A closed day is closed. There is no unclose,
  no edit-after-close, no correction flow.
- **No back-office review.** No manager approval, no variance sign-off, no
  reporting, no export.
- **No editing an open day.** Once a day is open its date, type, float and opener
  are fixed for the shift.

The advisory missing-closing-count warning links to `/pos/closing`, which is an
existing inventory screen and is **not** part of this prototype.

---

## Accessibility notes

- Semantic landmarks, skip link, `aria-current="page"` on the active nav entry.
- Real `<table>` markup with sticky column headers inside a focusable,
  labelled scroll region.
- Polite live regions for validation results, state changes and the live
  discrepancy readout.
- Focus moves to the first invalid control on a failed submission.
- `prefers-reduced-motion: reduce` is respected; the only motion is one 140ms
  state-entry fade.
- Nav scrolls horizontally without causing page-level overflow. Below 768px the
  tables keep their comparison structure and scroll sideways inside their
  wrapper, with a visible scroll hint.

## Browser support

Uses `oklch()`, `color-mix()` and `:has()`. Current Chrome, Edge, Safari and
Firefox. No polyfills, no fallbacks — this is a prototype for review, not a
production deployment.
