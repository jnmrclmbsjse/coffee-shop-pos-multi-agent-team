# UCM Coffee Studio staff inventory prototype

## Purpose

Provide counter staff with four inventory workflows that do not depend on a cashier session:

1. Record an opening count of active Critical items.
2. Record a closing count of every active item.
3. Review restock status from a selected submitted count.
4. Append delivery and wastage movements between counts.

All names, items, counts, thresholds, and timestamps in this prototype are fictional sample data.

## Operating rules

- Counts are append-only submissions. A submitted count cannot be edited or deleted.
- Recording another count creates a separate submission.
- Blank count items are omitted from the stored submission and remain uncounted. They are not zero.
- Deliveries and wastage are permanent append-only movements with no edit or delete controls.
- Movements do not alter restock status.
- Restock derives only from the selected opening or closing count.
- All workflows are blocked when no business day is open.

## Count ordering

- Opening: active Critical items, alphabetical by item name.
- Closing: active Critical items first, then non-Critical, alphabetical inside each group.
- Quantity counts accept whole numbers at or above zero.
- Level counts use eight named choices and may remain blank.

## Restock evaluation

Quantity items are evaluated in this order:

1. Urgent when count is at or below an available Urgent threshold.
2. Low when count is at or below an available Low threshold.
3. Below par when count is below the par for the selected day type.
4. Enough otherwise.

If an item has no par for the selected day type, Par is `—` and Status is Enough.

Level items map as follows:

- Empty or Low: Urgent
- Quarter or One-third: Low
- Half or Two-thirds: Below par
- Three-quarters or Full: Enough

## Out of scope

- Money arithmetic
- Live stock ledger or running balance
- Applying movements to restock
- Cup or lid variance
- Count history for owners or back-office review
- Cashier sessions
- Order capture
- Close-day expected values or variance
