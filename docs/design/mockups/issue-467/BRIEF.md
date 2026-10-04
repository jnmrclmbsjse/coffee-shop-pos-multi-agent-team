# Brief — Administrator Journal, set-aside fund ledgers (issue #467)

Net-new admin screen at `/journal` for UCM Coffee Studio POS. React 19 + Vite +
plain CSS custom properties. **No component library, no Tailwind, no icon
dependency.** Output must be plain HTML + CSS (+ vanilla JS for state) that an
implementer can transliterate into React with the shipped class names.

The screen must read as part of the existing admin back office, NOT as a new
product. The nearest shipped neighbours are Compensation (`.compensation-*`,
tabbed sections + table + modal) and Reports (`.report-*`, filter bar + table).

## Ground truth — shipped design tokens (`apps/web/src/styles.css` `:root`)

Use these variable NAMES. Never write a literal colour, radius, or spacing value.

```css
:root {
  --bg: oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg: oklch(22% 0.02 240);
  --muted: oklch(50% 0.018 240);
  --border: oklch(90% 0.008 240);
  --accent: oklch(58% 0.16 145);
  --danger: oklch(48% 0.18 28);
  --danger-surface: oklch(97% 0.018 28);
  --warn-ink: oklch(41% 0.09 75);
  --warn-surface: oklch(97% 0.03 85);
  --warn-border: oklch(80% 0.08 80);
  --focus: oklch(43% 0.14 145);
  --accent-hover: oklch(52% 0.16 145);
  --accent-pressed: oklch(46% 0.14 145);
  --ink-soft: oklch(36% 0.018 240);
  --surface-subtle: oklch(96.5% 0.007 240);
  --border-strong: oklch(76% 0.012 240);
  --success-surface: oklch(96% 0.028 145);
  --promotion-ink: oklch(40% 0.09 250);
  --promotion-surface: oklch(96% 0.025 250);
  --promotion-border: oklch(78% 0.06 250);
  --radius-sm: 6px;
  --radius-md: 10px;
  --touch-min: 44px;
  --field-h: 48px;
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;
  --z-modal-backdrop: 30;
  --z-modal: 40;
}
```

Breakpoints already used by the app: `max-width: 1180px`, `1050px`, `900px`,
`760px`, `600px`, `540px`, `480px`. Plus a
`@media (prefers-reduced-motion: reduce)` block. `html { min-width: 320px }`.

## Shipped classes to reuse (do not reinvent)

- Page frame: `.catalog-page`, `.catalog-page-head`, `.catalog-panel`
- Tabs: `.compensation-sections` with `button[aria-current="page"]`
- Tables: `.catalog-table`, `.catalog-table-wrap`, `.report-table`,
  `.report-table-region`, `.report-scroll-hint`, `td.num` (mono, tabular,
  right-aligned money)
- Metrics / totals: `.report-metric`, `.report-totals`
- Buttons: `.catalog-button` + `.primary` / `.secondary` / `.danger`,
  `.table-action` for row actions
- Fields: `.catalog-field`, `.catalog-field-label`, `.catalog-field-help`,
  `.catalog-field-error`
- Notices: `.catalog-notice` + `.danger` / `.success`, `.report-empty`,
  `.results-meta`
- Modal: `.inventory-modal-backdrop` > `.inventory-modal` >
  `.inventory-modal-head` + `form` + `.inventory-modal-grid` +
  `.staff-modal-actions`
- **Suggestion chip that already exists and must be reused:**
  `.compensation-suggested` — a dashed `--border-strong` chip on
  `--surface-subtle` with `--ink-soft` ink, used today for a
  suggested-but-unsaved amount, inside `.compensation-field-annotation`.
- Variance/negative precedent: `.variance` with `.variance-short`
  (`--danger`) / `.variance-over` (`--focus`) / `.variance-even` (`--muted`),
  which pairs the colour with an uppercase word in a `<small>` so meaning never
  rests on colour alone.

Money is rendered by a shared `formatMoney()`: `₱1,234.50`, and negatives as
`₱-1,234.50`. Money is integer cents end to end; the browser never does money
arithmetic.

## What the screen has to do

Five jobs; composing them is the design decision (one page, tabs,
master/detail, page + modals — choose and justify):

1. **Ledger overview** — the ledgers (seeded **Rent** and **Chair**, plus
   administrator-added ones), each with `balance = startingBalance
   + Σ deposits − Σ withdrawals`. The balance **may be negative, and negative
   is an expected state, not an error** — it must read clearly as negative
   without relying on colour. Also: add-a-ledger (unique name compared
   case-insensitively, start date, optional starting balance).
2. **One ledger's detail** — its deposits (each tied to exactly one closed
   business day) and its withdrawals (free date, several possible per date),
   with edit and delete on every row of both.
3. **Record a deposit** (business day + amount + optional note) and **record a
   withdrawal** (date + amount + optional note). One deposit per ledger per
   business day; a second attempt is a real reachable **conflict** state with a
   message, and the existing deposit stays unchanged.
4. **Suggestions** — for a closed business day with no deposit, the form offers
   a suggested amount the administrator may accept or overwrite. A suggestion
   is **advisory until saved** and that must be legible: the administrator must
   be able to tell "a suggestion I have not accepted" from "the amount I
   saved".
5. **Bulk add / catch-up**, per ledger — every closed business day on or after
   the ledger start date with no deposit, each row with its own suggested
   amount, each amount editable, each day tickable, all saved in **one
   all-or-nothing action**. The list can be **very long** (first use may list
   the shop's entire trading history) and can also be **empty**. Both need a
   treatment. On conflict, nothing saves and the list must be refreshable.

Plus a **settings affordance** for the Rent percentage, the Chair amount and
the Chair gross threshold. Copy must make clear a change applies to **business
days on or after the calendar date of the change** and cannot be backdated.
The **Rent rounding rule is not configurable** and must not be presented as if
it were.

## The three-way distinction that is the whole story

These must be visually distinguishable **everywhere they can both appear** — in
the ledger rows, in the bulk-add list, and in the form:

- **a saved ₱0 deposit** — a real deposit; the business day is handled.
- **a ₱0 suggestion** — real suggestion (Chair below its gross threshold); not
  yet saved.
- **no suggestion at all** (`null`) — what a manually-added ledger always gets.
- **no deposit recorded yet** — the day is still outstanding.

Collapsing any of these is the single most likely silent defect in this story.
Do not use a bare "₱0.00" to mean more than one of them.

## Every state that needs a design

Empty ledger (no deposits, no withdrawals); empty bulk-add list; negative
balance; a long note; a very long ledger name; an **open** business day (no
suggestion, absent from bulk add); duplicate-deposit conflict; bulk-save
conflict; delete confirmation for a deposit **stating that deleting it makes
its business day un-recorded again**; delete confirmation for a withdrawal;
loading; error; submitting; refused amounts (negative deposit; zero or negative
withdrawal); a refused ledger name that differs only in letter case.

## Accessibility obligations

Labels on every control; `aria-current="page"` on the active tab; focus moved
into a modal on open and returned to the invoking control on close; a visible
3px `--focus` focus ring with 2px offset; `aria-live="polite"` for balance and
results-count changes and `role="alert"` for conflicts; `aria-sort` on sortable
table headers; minimum `--touch-min` targets; the bulk-add list must be
keyboard-traversable and must not rely on colour for tick state; a labelled,
focusable horizontal scroll region for narrow tables
(`.report-table-region` + `.report-scroll-hint`).

## Copy rules

Exact user-facing strings matter. Money is pesos with two decimals
(`₱1,234.50`). Literal text plus semantics carry loading, empty, error and
success state; colour and motion may only reinforce. Destructive actions are
named and are never the page primary.
