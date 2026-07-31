# Product definition

## Purpose

Order History is a read-only ledger for staff to review customer transactions within one selected business day. It includes completed, parked, and void activity without providing any way to change an order.

## Structural read-only rule

The ledger renders facts only. Order cards contain no buttons, links, menus, swipe targets, or hidden mutation actions. Parked orders do not have a Resume control. The only production interactions are day selection, three filters, customer search, and clearing filters.

Corrections happen elsewhere. Staff void the original completed order and enter the corrected order again from the order screen. The original void and the replacement order remain separate ledger cards.

## Business-day selection

- Selection is by `TradingDay` identity, not a date range.
- An open business day is the default when one exists.
- If no day is open, the most recently opened past day is selected.
- If no business day exists, the selector has no real selection and the ledger shows `No orders to show`.
- Option text includes `Open` or `Closed` so state does not depend on color.
- Order numbers restart within each day.
- Completion timestamps may fall after midnight without moving the order into a different business day.
- Switching days preserves status, payment, and search values.

## Filters

All filters combine with AND semantics.

### Status

- `All`
- `Completed`
- `Parked`
- `Void`

### Payment

- `Any payment` includes paid and unpaid orders.
- `Cash` includes orders paid entirely in cash.
- `Online` includes orders paid entirely online.
- `Split` includes only orders with both cash and online portions.
- An order with no recorded payment is excluded from Cash, Online, and Split.
- `Parked` plus `Any payment` can show unpaid parked orders.

The one-line helper beneath the controls makes the exclusive behavior visible.

### Customer search

- Matching is case-insensitive.
- Matching is partial.
- Leading and trailing whitespace is ignored.
- `Walk-in` is the searchable name for an order with no recorded customer.

## Ledger order and contents

Cards are sorted by descending per-day order number. Each recorded order produces exactly one card. A card includes:

- Per-day order number
- Customer name or `Walk-in`
- Completed, Parked, or Void status
- Cashier only when a cashier is attributed
- Cash, Online, Split, or `Not paid`
- Separate cash and online amounts for Split
- Completion time or `Not completed`
- Total
- Every line item with quantity, product, size, and optional discount label
- Void reason for void orders
- Change settlement state when present

A void order retains recorded payment and completion facts.

## Change settlement

`Change given` and `Change still owed` are settlement states, not amount calculations. The fixtures deliberately use the same amount for each state. Text plus solid or dashed treatment makes the distinction legible without relying on hue.

## Empty states

- A day with no orders states that there are no recorded orders for that day.
- A filter-induced empty state states that existing orders were excluded and offers Clear filters.
- With no business day at all, the screen states that no business day has been opened.
- Every empty case includes the exact heading `No orders to show`.

## Accessibility behavior

- The shell has a skip link, semantic landmarks, and `aria-current="page"`.
- Every filter is a labelled native control.
- Result counts use a polite, atomic live region.
- The ledger is an ordered list of articles with headings.
- Status uses words, border shape, weight, and color.
- Numeric values use tabular figures.
- Every control is at least 44px, and fields are 48px.
- Focus uses a 3px `--focus` ring at 2px offset.
- Reduced-motion preferences disable nonessential transition timing.
