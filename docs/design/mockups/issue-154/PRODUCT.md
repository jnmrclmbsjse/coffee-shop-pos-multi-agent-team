# Product - Cash & expenses

## Purpose

Let staff append cash movements and expenses to the currently open business day,
then read that day's permanent ledger.

## Core behavior

- Route: `#/pos/cash`.
- Current business date and day type are read-only context, never inputs.
- Type is one required radio choice: Cash in, Cash out or Expense.
- Amount is required, positive and limited to ₱0.01 through ₱21,474,836.47.
- Amount precision beyond two decimal places is invalid and never rounded.
- Category is optional and available only for Expense.
- Reason is required and whitespace-only values are rejected.
- Recorded by is optional and lists active staff only.
- A valid submit writes exactly one entry and prepends exactly one ledger row.
- Entries are permanent and provide no row actions.
- A closed day rejects an in-flight write and records nothing.

## Ledger semantics

The ledger is newest first. Type includes a plus or minus glyph and a full word,
so drawer direction is not carried by hue. Amounts are formatted from integer
cents. Historical attribution is snapshot text, not a roster link.

## Required states

- Empty and filled forms
- All three selected types
- Invalid amount and reason
- Submitting lock
- Recorded confirmation
- Day-closed rejection
- Populated and empty ledgers
- No open business day

## Non-goals

No order workflow, inventory workflow, approval, export, offline mode, drawer
hardware, edit, delete, undo, reopening or correction flow belongs to this screen.
