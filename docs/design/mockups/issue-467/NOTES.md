# Administrator Journal mockup notes

## Composition decision

The five jobs are composed as one ledger workspace with three stable levels:

1. The left ledger overview keeps balances, selection, and the cross-ledger recording-status examples visible.
2. The selected-ledger summary and Activity / Bulk add tabs keep routine review and catch-up work in one place without making the page vertically long.
3. Add, record, edit, delete, and settings tasks open in focused modals. This preserves the ledger context, gives destructive confirmation copy room, and supports focus containment and return.

The add-ledger and settings actions sit at page level because they affect the ledger collection or future suggestion rules. Deposit and withdrawal actions sit in the selected-ledger workspace because they affect that ledger only.

## Making the four recording conditions legible

- Saved zero: `Saved ₱0.00 deposit` appears in the status column, `₱0.00` appears in the Deposit column, and the row says `Recorded in ledger`.
- Zero suggestion: a dashed shipped `.compensation-suggested` chip says `₱0.00 suggested, not saved`, while the Deposit column says `Not recorded` and the row says `No deposit recorded yet`.
- No suggestion: the manually added Staff meals example says `No suggestion, not recorded`, never `₱0.00`.
- No deposit: outstanding rows say `Not recorded` and `Needs review`. This is separate from whether the suggestion is positive, zero, or absent.
- Open day: `Open business day, not eligible` appears in the cross-ledger recording status and the day is absent from Bulk add.

The left Recording status block keeps a saved ₱0 Rent deposit, a ₱0 Chair suggestion, a manual ledger with no suggestion, and an open day visible together. In Activity and Bulk add, amount, suggestion, and recording status occupy separate fields so no bare `₱0.00` carries two meanings.

## Exact user-facing copy

### Page and navigation

- `Journal`
- `Track set-aside funds across closed business days.`
- `Suggestion settings`
- `Add ledger`
- `Ledgers`
- `Selected ledger`
- `Current balance`
- `Activity`
- `Bulk add`

### Review harness states

- `Mockup state`
- `Review harness, not part of the product`
- `Populated ledger`
- `Empty ledger`
- `Negative balance`
- `Long ledger name + long note`
- `Duplicate-deposit conflict`
- `Bulk-add populated`
- `Bulk-add empty`
- `Bulk-add conflict`
- `Loading`
- `Error`

### Recording status and empty states

- `Saved deposit`
- `Saved ₱0.00 deposit`
- `Saved withdrawal`
- `Recorded in ledger`
- `Needs review`
- `No deposit recorded yet`
- `Suggested: ₱412.25, not saved`
- `₱0.00 suggested, not saved`
- `No suggestion available`
- `Open business day, not eligible`
- `No activity yet`
- `Record a deposit or withdrawal to begin this ledger.`
- `No deposits to add`
- `Every eligible closed business day has a recorded deposit.`

### Conflict, loading, and error

- `Deposit not saved.`
- `Rent already has a deposit for October 1, 2026. The existing deposit was not changed.`
- `Nothing was saved.`
- `Another deposit was recorded for October 7, 2026. Refresh the list and review your selections.`
- `Loading journal`
- `Getting ledgers and business-day records.`
- `Journal could not be loaded.`
- `Check the connection and try again.`
- `Try again`

### Forms and validation

- `Names must be unique, regardless of letter case.`
- `A ledger named “rent” already exists.`
- `Amount source`
- `Use suggested amount`
- `Enter another amount`
- `Deposit amount cannot be negative.`
- `Withdrawal amount must be greater than ₱0.00.`
- `Changes apply to business days on or after the calendar date of the change. Settings cannot be backdated.`
- `The Rent rounding rule is fixed.`
- `Save selected deposits`
- `Saving selected deposits...`

### Delete confirmation

- `Delete deposit?`
- `Deleting this deposit makes October 1, 2026 un-recorded again.`
- `Delete withdrawal?`
- `This withdrawal will be removed from the ledger balance.`

## Responsive treatment

- Above 1180px: fixed 228px sidebar, two-column ledger overview and selected-ledger workspace.
- At 1180px: the overview column narrows while the activity table remains in its focusable horizontal scroll region.
- At 1050px: the ledger overview moves above the workspace and its three ledgers become a compact row.
- At 900px: the sidebar becomes a Menu-triggered overlay and the content uses the full viewport width.
- At 760px: headers and summaries stack, ledger buttons become a vertical list, and each bulk row becomes a two-column layout with its amount field on a full row.
- At 600px: the review harness and modal fields become single-column.
- At 540px: topbar secondary text is removed, and page action buttons become full-width.
- At 480px: bulk rows become single-column and modal actions stack with the safe action last in DOM order but first visually.
- All narrow tables remain real tables inside `.report-table-region`, with a visible hint and a keyboard-focusable, labelled horizontal scroll region.

## Token gap

No new colour, radius, spacing, or touch-target token was needed. The requested 228px navigation width is a structural dimension, not a design token. The closest shipped spacing token is `--space-8`, but it should not be repurposed for a fixed application rail. If the rail becomes reusable across more screens, I would propose `--admin-sidebar-w: 228px` rather than introducing an ad-hoc value per screen.
