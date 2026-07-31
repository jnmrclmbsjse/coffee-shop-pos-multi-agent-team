# PRODUCT — Open / Close business day

UCM Coffee Studio · staff POS workspace · issue-123

Two new screens in the existing staff POS workspace. They bracket the trading
day: `Open Day` creates the day that orders, cash and counts anchor on, and
`Close Day` reconciles it and ends it.

---

## Why these two screens exist

Everything else in the staff workspace records *against a business day*. Orders,
cash movements, opening and closing inventory counts, deliveries and wastage all
need a day to belong to. Until now the day was implicit. These screens make it
explicit and give it a beginning and an end that a staff member standing at the
counter can perform in under a minute.

The closing screen is also the only place where the two halves of the day get
reconciled side by side: **packaging** (cups and lids counted against what the
day's sales should have consumed) and **cash** (the drawer counted against what
the day's movements should have left in it).

---

## Screen 1 — Open business day (`/pos/open`)

### Purpose
Create the business day. One day at a time; there is no concept of two days open
at once.

### Two mutually exclusive states

**No day open — the opening form.**

| Field | Rules |
|---|---|
| Business date | Required. Past, current and future dates are all accepted. Rejected only when that date already belongs to an open or a closed business day. |
| Day type | Required. `Normal day` or `Peak day`. Same NORMAL/PEAK concept the inventory screens surface as a header chip; par levels key off it. |
| Opening cash float | Required, money, non-negative. Exactly zero is valid and renders `₱0.00`. |
| Opened by | Required. Active staff only; inactive staff are never offered. |

One action, **Open day**, unavailable while a submission is in flight.

Invalid or incomplete submission opens nothing and explains why, in the shipped
error order: what did not happen, what remained unchanged, what to do next.
Announced through a polite live region.

**A day is already open — read-only summary.**

A `DAY OPEN` badge plus business date (`Thursday, Jul 23 2026`), day type, cash
float, opened by, and opened at (time only). Then: *"Take orders and record cash
against this day; close it at end of shift."*

There is deliberately **no control** here to open another day, edit this one, or
close it. The screen says so in words rather than leaving an empty space where a
button would be, so the absence reads as finished rather than broken.

### Why the day type appears twice
The same NORMAL/PEAK value is chosen here and shown as a header chip on the
inventory screens. Both treatments use the same wording and the same chip
styling so a staff member reads them as one concept, not two.

---

## Screen 2 — Close business day (`/pos/close`)

### Purpose
Review both reconciliations, count the drawer, close the day.

### 2a. Advisory missing-closing-count warning
Shown above the reconciliation when no closing inventory count exists:

> No closing count submitted yet — cup/lid variances won't be snapshotted. Do
> the closing count.

The last sentence links to `/pos/closing`. It is **advisory**: it never blocks
closing. A staff member is permitted to close a day without a closing count, and
the design has to be loud enough not to be missed while being clearly not an
error, since proceeding past it is legitimate.

### 2b. Cup / lid balance
One row per inventory item marked for reconciliation. Columns: Item, Expected,
Actual, Var.

```
Expected = opening count
         + deliveries
         − wastage
         − packaging used by completed, non-voided drink sales
```

Any of the three figures can be **unknown**, and unknown is not zero:

| Figure | Unknown when |
|---|---|
| Expected | there is no opening count for the day |
| Actual | there is no closing count for the day |
| Var | either side is unknown |

Unknown must be visually distinct from a recorded zero. Never a quantity, never
a zero, never a negative. (The current build renders `-1` for unknown expected;
that is the defect this screen fixes.)

Empty state when no item is marked for reconciliation — a real empty state, not
placeholder rows.

### 2c. Cash summary (online sales excluded)
Exactly nine rows, in order:

1. Cash float
2. Cash sales
3. Online sales (excluded) — present, contributes nothing
4. Cash tips (+)
5. Cash in (+)
6. Cash out (−)
7. Expenses (cash) (−)
8. **Change owed (still in drawer)** (+)
9. Expected cash (the total)

```
Expected cash = float + cash sales + cash tips + cash in + change owed
              − cash out − cash expenses
```

**Change owed** is new to the product. Change a customer is owed but has not
been handed yet is physically still in the drawer, so it moves the number the
staff member reconciles against real notes and coins. It cannot be invisible.

Cash in, cash out, expenses, cash sales, online sales and cash tips have no
capture workflow in this build, so they render as genuine labelled zeros
(`₱0.00`). Genuine zero and unknown are different things on this screen.

### 2d. Count and close

| Field | Rules |
|---|---|
| Actual cash counted | Required, money, non-negative, empty by default. Zero is valid. |
| Discrepancy | Read-only. `counted − expected`, live as the count is typed, before any submission. Zero is a real `₱0.00`. |
| Discrepancy reason | **Optional** free text, and stays optional even when the discrepancy is non-zero. |
| Closed by | Required. Active staff only. |

**Close day** is unavailable while a submission is in flight.

A shortage and an overage must be told apart by direction, not by hunting for a
minus sign. Neither is good news: a shortage is missing money, an overage is
usually a mis-keyed sale. Neither is an error and neither is a success.

### 2e. No day open
The screen explains there is nothing to close and offers no submission control,
matching the "No business day is open." blocking panel the inventory screens
already use.

---

## Roles

Both screens are staff-facing. There is no manager-only field and no approval
step. Anything a manager would review afterwards happens in the back office,
which is out of scope here.

## Sample data

All in-memory, obviously fictional, resets on reload. Staff names, dates and
quantities are invented. The only non-zero cash figure is the float, because
every other cash figure would have to come from an order-capture workflow that
does not exist yet, and inventing one would be dishonest about what this build
can show.
