# ADR 0019: Void Authority — Voids From Order History, Scoped by Role

- **Status:** Proposed
- **Date:** 2026-10-07
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0005 §2 (void is a correcting `Sale`,
  not a status) and ADR 0004 §2 (a correction belongs to the trading day it is
  recorded on). Narrows the read-only framing of ADR 0005 §8 and of stories #93
  and #142 for the history **screens** only; §8's structural rule for the
  `reporting` module is unchanged. Records the decisions shipped in #499 and
  #500, which went out as a hotfix ahead of this record.

---

## Context

Until #499, the only way to void an order was the completion dialog on Take
Order, and only while that order was still on screen. Once a cashier started
the next order, a completed order could no longer be voided anywhere in the
product, although `POST /orders/:clientGeneratedId/void` has always accepted
any completed, not-yet-voided order while a business day is open.

Stories #93 (administrator Order History) and #142 (staff business-day ledger)
were written as read-only views. Their criteria say the screens contain "no
… void … action", and ADR 0005 §8 made the API half of that structural by
placing the history endpoints in `reporting`, which owns no write routes.

The owner asked for two things, in this order:

1. Staff and administrators can void a completed order from Order History, with
   a required reason (#499).
2. Staff may only void orders from the business day that is open now, and only
   while it is open; administrators are not limited (#500).

Three facts constrain the answer:

- **ADR 0004 §4 forbids reopening a closed day**, and a closed day carries a
  `DayClosing` snapshot that must not be silently restated. ADR 0015 §4 drew the
  same line for cash-movement amendments: only entries on the open day may be
  amended.
- **ADR 0004 §2 already places a void on the trading day it is recorded on**,
  not the original's day. Voiding an earlier day's order therefore never
  touches that day's figures. It lowers the *open* day's sales, cash and
  reconciliation instead. That is arithmetically sound, but it moves money
  between days, which is a judgement call, not a cashier's routine correction.
- **Sessions already carry a role** (`ADMIN` / `STAFF`, ADR 0002), and the
  orders controller admits both.

## Decision

### 1. Order History may void; the `reporting` module still may not write

Both history screens offer "Void order" on a completed, not-yet-voided order:
the staff ledger on the card, the administrator's Order History on the detail
page. The list stays read-only. The action calls the existing
`POST /orders/:clientGeneratedId/void` in the `orders` module. `reporting` gains
no route and keeps ADR 0005 §8's property that it has no POST/PATCH/DELETE at
all. The only read-model change is that the administrator detail now exposes
`clientGeneratedId`, the key the capture path is addressed by.

Stories #93 and #142's "no void action" criteria are superseded for these
screens by this record. Every other mutating action (create, edit, resume,
complete, delete, reopen) remains absent, and the ledger e2e pins the two
permitted card controls by name: "Confirm change handed over" (#197) and
"Void order".

The void itself is unchanged from ADR 0005 §2: a required, trimmed reason; a
correcting `Sale` with negated cents, lines and payments; idempotent by the
client-generated void ID; refused when no day is open, when the order is not
completed, or when it is already voided.

### 2. Who may void what

| Caller | May void | Refusal |
|---|---|---|
| `STAFF` (and any non-`ADMIN` role) | A completed order whose `tradingDayId` is the trading day that is `OPEN` now | `403` "Staff can only void orders from the business day that is open now. Ask an administrator to void an order from an earlier day." |
| `ADMIN` | Any completed, not-yet-voided order, from any day | — |

In every case a business day must be open, because that is where the
correction is recorded (ADR 0004 §2).

- **Enforced in the API, inside the void transaction**, after the open trading
  day row is locked, so the comparison is made against the day that will
  actually receive the correction. The UI gate (the staff ledger shows the
  button only when the selected day is the open day) is a convenience; the API
  rule is the authority.
- **Deny by default.** The exemption is written as "caller is `ADMIN`", not
  "caller is not `STAFF`", so a future role starts restricted.
- **A replay is honoured before the rule.** A void that was accepted keeps
  returning its correction on retry, even after the day rolls over.
- **The role comes from the session**, never from the request body.

### 3. Replays are scoped to the order being voided

A void request ID counts as a replay only when the existing record is a `VOID`
whose `correctsSaleId` is the order named in the URL. Any other record holding
that ID (the original order's own ID, or a void of a different order) is
refused with `409` instead of being returned as if the void had happened. This
narrows ADR 0001's "replayable" to "replayable for the same intent". It
matters more now that two screens, not one, issue voids.

## Consequences

**Positive**
- A mistaken order can be corrected after the cashier has moved on, without
  re-entering it on Take Order or waiting for an administrator for same-day
  mistakes.
- Cross-day voids, which shift money from a closed day's sale into the open
  day's figures, sit with administrators.
- No closed day is ever restated: ADR 0004 §4 and the `DayClosing` snapshot are
  untouched by either role.
- The void mechanism, the reporting read model and every report's arithmetic
  are unchanged; only who may trigger it, and from where, changed.

**Negative / accepted trade-offs**
- An administrator's cross-day void makes the open day's sales and expected
  cash lower than that day's own trade. The dialog states that the void is
  recorded on the open day, but nothing in the reports yet labels such a void as
  belonging to an earlier sale's day.
- A void issued from the administrator back office usually carries no cashier
  attribution: the cashier snapshot comes from the device's active cashier
  (ADR 0007), and back-office browsers rarely have one selected.
- The rule is role-based, not person-based. Any staff member may void any of
  the open day's orders, not only their own, with no supervisor PIN.

## Revisit triggers

- **Voids need a supervisor PIN, or staff may only void their own orders** →
  decide alongside ADR 0007's PIN authorization; §2's role table becomes a
  policy over role *and* person.
- **Reports must attribute a cross-day void to the original sale's day** →
  revisit ADR 0004 §2 together with ADR 0004 §4's no-reopen rule; this is the
  same gap ADR 0015 §4 names for cash movements, and the two should be closed by
  one adjustment-record decision against `DayClosing`.
- **A third role appears** → §2's deny-by-default keeps it restricted; decide
  explicitly whether it gets the administrator's exemption.
- **A second branch goes live** → "the trading day that is open now" must
  become "the open trading day of the order's location"; the current lookup is
  location-agnostic.
