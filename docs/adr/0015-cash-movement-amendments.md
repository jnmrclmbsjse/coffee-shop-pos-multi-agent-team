# ADR 0015: Amending Cash Movements — Supersession, Not Signed Deltas

- **Status:** Proposed
- **Date:** 2026-08-22
- **Decision owner:** Technical Lead
- **Supersedes / extends:** **Amends ADR 0006 §1** (replaces the signed-row
  correction pattern for `CashMovement`) and, for cash movements only, narrows
  ADR 0004 §4's "corrections are recorded as new signed rows". Extends ADR 0001
  (money in integer minor units, append-only corrections, idempotent writes) and
  ADR 0006 §2 (the single expected-cash formula). Answers the ARCHITECTURE GAP
  the Product Owner flagged on story #351.

---

## Context

Story #351 asks that a staff member be able to amend a cash-in, cash-out or
expense entry that was recorded incorrectly, with the original preserved, the
correction linked and visible, and the day's effective cash affected exactly
once.

ADR 0006 §1 appears to have already decided this. It did not, and what it did
decide is contradicted by what was merged.

**What ADR 0006 §1 said.** `CashMovement.amountCents` "stays **signed** …
`kind` gives the direction, the sign gives correction. A `CASH_OUT` of ₱500 is
`kind = CASH_OUT, amountCents = 50000`; reversing it is a second `CASH_OUT` row
of `-50000`, never an edit."

**What the repository actually contains** (verified 2026-08-22 at `0c5e015`):

- `CreateCashMovementDto` (`apps/api/src/trading-day/trading-day.dto.ts:113`)
  carries `@IsInt` + `@Min(1, { message: 'amountCents must be a positive
  integer' })`. **The only write path in the system refuses to store a negative
  amount.** ADR 0006 §1's correction mechanism is unreachable through the API
  and always has been. No negative row exists in `cash_movements`.
- `CashMovement` has no correction link of any kind — no
  `correctsCashMovementId`, no supersession column, nothing. Original and
  correction would be two unrelated rows distinguishable only by reading their
  free-text descriptions.
- The staff ledger (`apps/web/src/trading-day/CashAndExpensesPage.tsx:180-187`)
  derives the displayed sign **from `kind`, not from the stored number**:
  `CASH_IN` renders `+`, everything else `−`, and the amount is rendered through
  `formatMoney(movement.amountCents)`. A stored `-2000` on a `CASH_IN` row
  renders as a `+` badge next to a negative peso figure.
- Both aggregation paths are plain per-kind sums: `movementTotal(kind)` in
  `trading-day.service.ts:541-543` (which also feeds the `DayClosing` snapshot
  at `:451-453`) and the raw SQL `SUM(amount_cents) FILTER (WHERE kind = …)` in
  `reporting.service.ts:475-492`.

So three things are true at once: the merged validation forbids the merged
ADR's mechanism, the merged UI would misrender it, and no linkage exists to
satisfy the story's "clearly distinguishable and linked" criterion. The
correction semantics for cash movements have to be decided properly rather than
inferred, and because they decide money arithmetic they are a required decision
under the high-risk-area rule.

Two further constraints shape the choice.

**Signed deltas cannot express every correction the story implies.** The story
says staff "provide the corrected values" and that the amendment must identify
the original. Not every mis-entry is an amount: a cash-out typed as a cash-in,
or an expense filed under the wrong description or category, is the same class
of mistake. A delta row has nothing to say about a description-only correction —
its amount would be zero, which is not a cash movement — and cannot change a
row's `kind` at all, since it is by construction a row of the same kind.

**The audience is a barista at close, not an accountant.** This ledger is read
by whoever counts the drawer. `Cash in −₱20.00` as the representation of "the
₱100 should have been ₱80" is a figure nobody at the counter can explain, and
the story requires staff to "understand what was entered originally and how it
was corrected."

---

## Decision

### 1. An amendment is one appended, self-contained `CashMovement` that supersedes the original

Amending appends a new `CashMovement` row carrying the **corrected values in
full** — kind, amount, description, category — and a link to the row it
corrects. Nothing is edited, hidden or deleted. The original keeps every value
it was recorded with.

```prisma
model CashMovement {
  // ... existing columns unchanged ...
  amendsCashMovementId String? @unique @map("amends_cash_movement_id") @db.Uuid
  amends     CashMovement?  @relation("CashMovementAmendment", fields: [amendsCashMovementId], references: [id], onDelete: Restrict)
  amendedBy  CashMovement?  @relation("CashMovementAmendment")
}
```

- `amendsCashMovementId` is nullable (an ordinary entry amends nothing) and
  **`@unique`**. Uniqueness is the database-level guarantee that one entry is
  corrected at most once, so "the effective outcome changes exactly once" is
  structurally true and not merely enforced by service code.
- A row is **superseded** iff another row names it in `amendsCashMovementId`.
  A row is **effective** iff it is not superseded. Amendment chains are allowed:
  an amendment may itself be amended, and the effective row is the tail of the
  chain. The `@unique` constraint makes a chain a chain and never a tree.
- The correction row must reference the **same `tradingDayId`** as the row it
  amends. Cross-day correction is refused. A correction is not a cash movement
  in its own right on a later day; it is a restatement of what happened on that
  day.
- `onDelete: Restrict`, matching every other relation in this schema. Nothing
  deletes cash movements; the story's final criterion — "no amendment provides
  a hard-delete path" — is enforced by the absence of a delete route, and this
  ADR forbids adding one.

**`amountCents` is a positive magnitude on every row, corrections included.**
The `@Min(1)` rule already in force is upheld rather than removed, and the
missing DB backstop is added: `CHECK (amount_cents > 0)` on `cash_movements`.
Direction remains a property of `kind`, exactly as the ledger UI already
assumes. This is the specific point on which ADR 0006 §1 is amended: the sign
carries no meaning and no negative row may ever be written.

### 2. Kind, amount, description and category may all be corrected

The correction row is a complete replacement statement, so a `CASH_OUT`
recorded as a `CASH_IN` is corrected by an amendment whose `kind` is
`CASH_OUT`. Supersession handles the cross-kind case with no special
arithmetic: the original leaves the `CASH_IN` effective set and the correction
joins the `CASH_OUT` effective set in the same append.

Every field-level validation that governs a new entry governs an amendment
identically — positive integer amount, non-blank description, and the existing
`@IsExpenseOnlyCategory` rule that permits `category` only on `EXPENSE`. An
amendment is not a privileged write and gets no relaxed validation.

The story requires no separate "reason for amendment" field and none is added.
`description` is already required on every movement (ADR 0006 §1) and the
correction carries its own; the original's description remains readable beside
it, which is what makes the pair self-explanatory.

### 3. Money — the effective set, defined once

Expected cash (ADR 0006 §2) is **unchanged as a formula**. What changes is the
population each term sums over:

```
cash_in       = Σ amountCents where kind = CASH_IN  AND effective
cash_out      = Σ amountCents where kind = CASH_OUT AND effective
cash_expenses = Σ amountCents where kind = EXPENSE  AND effective

effective(m)  ⇔ NOT EXISTS (m2 : m2.amendsCashMovementId = m.id)
```

- Amending a ₱100.00 cash-in to ₱80.00 yields `cash_in = 8000`: the ₱100 row is
  superseded and contributes nothing, the ₱80 row contributes once. Not ₱180,
  and not ₱20.
- **Both aggregation paths must apply the predicate**, and this is the one real
  cost of this decision: `movementTotal` in `trading-day.service.ts` and the
  `SUM(...) FILTER (...)` CTE in `reporting.service.ts` are two implementations
  of one rule, in two languages, and ADR 0006 §2 exists precisely because those
  two figures once drifted. The mitigation is a required integration test that
  seeds one trading day containing an original, its amendment, and an amended
  amendment, then asserts the close screen's summary and the reporting read
  model return **byte-identical** cash-in / cash-out / expense totals. A
  correction feature that makes the two figures disagree is worse than no
  correction feature.
- `DayClosing` is untouched in shape and meaning. It snapshots effective totals
  at close (ADR 0006 §4), and its columns already carry the numbers that will
  now come from the filtered sums.
- No rounding, no division, no new currency handling. Integer minor units
  throughout, per ADR 0001.

### 4. Only entries on the current OPEN trading day may be amended

Amendment is refused with `409 Conflict` when the target movement's trading day
is not `OPEN`. This follows ADR 0004 §4's no-reopen rule directly: a closed day
carries a `DayClosing` snapshot that must not be silently restated, and there is
no path in this system that re-derives it.

This leaves a real gap, stated plainly rather than papered over: **an error
discovered after close cannot be corrected in v1.** ADR 0006 already carries the
revisit trigger for it ("a closed day must be corrected in place"), and closing
it properly means deciding an explicit adjustment record against `DayClosing`,
not loosening this guard. The story's own criteria ask for exactly this
behaviour, so v1 ships with the gap and the trigger.

### 5. Write path — one dedicated, idempotent route

```
POST /trading-day/cash-movements/:id/amendments
body: { clientGeneratedId, kind, amountCents, description, category?,
        recordedByStaffMemberId? }
→ 201 with the created correction row
```

- **Idempotent on `clientGeneratedId`, which is the correction row's primary
  key**, replaying the exact pattern already proven in `recordCashMovement`
  (`trading-day.service.ts:260-342`): pre-flight replay lookup, row lock on the
  trading day, in-transaction replay re-check, and a `P2002` catch that returns
  the existing row. A double-clicked confirm and a retried request both produce
  one correction. This is ADR 0001's replayable-write convention and the
  story's double-submit criterion, satisfied by the same mechanism.
- The `@unique` constraint on `amendsCashMovementId` supplies the second
  backstop: two *different* client IDs racing to amend the same entry cannot
  both win. The loser gets `409`, never a second correction.
- A separate route rather than an optional field on `POST
  /trading-day/cash-movements`: the preconditions genuinely differ (the target
  must exist, be on an open day, and not already be superseded), and folding
  them into the create path would make one endpoint's validation depend on
  whether an optional field was present.
- Error contract: `404` unknown movement; `409` when the day is not open;
  `409` when the movement is already superseded (with the superseding row's id,
  so the client can refresh rather than guess); `400` on any field violation.
- **Authorization is unchanged.** The route joins the existing
  `TradingDayController` under the guards it already carries — a STAFF-accessible
  POS operation, exactly like recording the entry it corrects. **No new role, no
  new permission rule, no new session behaviour, no new secret handling** is
  introduced by this story, and none may be introduced by its implementation.

### 6. Contracts and the read model

In `packages/shared` (ADR 0001 §3), `CashMovement` gains two fields:

- `amendsCashMovementId: string | null` — stored; the row this one corrects.
- `supersededByCashMovementId: string | null` — **server-derived**; the row that
  corrects this one. Effective ⇔ `null`.

`AmendCashMovementInput` is added with the body shape from §5. `CashMovementList`
keeps its shape and continues to return **every** row for the day, superseded
rows included — the story requires both halves of the pair to stay visible, so
the list is not filtered. The client renders linkage and effectiveness from the
two id fields and never recomputes a total.

Deriving `supersededByCashMovementId` server-side rather than letting the client
infer it from the list is deliberate: the day-scoped list happens to contain
both rows today, but a client that infers effectiveness is a client that owns
part of the money rule, and ADR 0006 §2's whole point is that it does not.

### 7. What this does not decide

Screen copy, the placement of the Amend action, how the original is presented
during review, and the visual treatment of a superseded row are story #351's
acceptance criteria and the Design Task's output. This ADR requires only that a
superseded row remain visible and legibly linked to its correction; how that
reads is not mine to decide.

---

## Consequences

**Positive**

- The staff-facing ledger shows what a person can act on: the original entry as
  recorded, and the corrected entry in full, linked. No arithmetic to do in your
  head at the counter.
- Corrections cover the whole error surface — wrong amount, wrong kind, wrong
  description, wrong category — under one mechanism, where signed deltas covered
  only amounts.
- "Changes the outcome exactly once" is enforced by a unique index, not by
  service code that a future caller can bypass.
- The absurdity of a negative amount under a `+` badge is designed out: sign
  lives in `kind`, one place, and a DB CHECK now says so.
- Idempotency reuses a merged, proven pattern rather than inventing a second
  one.
- ADR 0006 §1's dead-letter mechanism is retired explicitly instead of being
  left in the record for a future reader to implement against.

**Negative / accepted trade-offs**

- **The effective-set predicate is implemented twice** — once in Prisma, once in
  raw SQL — and a term of the expected-cash formula now has a WHERE clause that
  is easy to forget when a fourth read path is added. This is the sharpest edge
  of the decision. The cross-path equality test is the mitigation, and it is a
  requirement of this ADR, not a suggestion.
- **Sums are no longer a bare `SUM` over a kind.** Every future query against
  `cash_movements` that totals money must filter, and one that forgets will
  overstate a corrected day. A signed-delta design would not have had this
  property; it was rejected for the reasons in §Context, with this cost known.
- **A closed day cannot be corrected at all** (§4). A genuine limitation, not a
  simplification — it will be felt the first time an error surfaces the next
  morning.
- **Amending a chain reads as a chain.** Three corrections of one entry produce
  four visible rows, and the ledger grows in exactly the situation where someone
  is already confused. Accepted: hiding the middle of the chain would break the
  audit criterion.
- **`CHECK (amount_cents > 0)` is a constraint added to a merged table.** It is
  satisfied by all existing data — nothing could ever have written a
  non-positive amount through `@Min(1)`, and the `cash_expenses` backfill
  carried positive amounts — but the migration must verify rather than assume.
- Correcting a mis-entered *day* is not representable: the correction is bound
  to the original's trading day. Recording something on the wrong business day
  remains an uncorrectable error in v1.

## Revisit triggers

- **A closed day must be corrected** → §4 is withdrawn; decide an explicit
  adjustment record against `DayClosing` together with ADR 0004 §4's no-reopen
  rule and ADR 0006 §4's snapshot semantics. This is the trigger most likely to
  fire.
- **A third read path over `cash_movements` appears** (an export, a shift
  report, an owner dashboard) → the twice-implemented predicate in §3 stops
  being tolerable; promote effectiveness to a maintained column or a database
  view before adding the caller.
- **Amendment must be restricted to a role, a supervisor PIN, or the staff
  member who recorded the entry** → §5's "authorization unchanged" is withdrawn
  and a new ADR decides the rule, alongside ADR 0007's PIN authorization.
- **A correction must carry a stated reason distinct from the description** →
  §2 gains a field and the capture path validates it.
- **An entry must be amendable more than once concurrently, or corrections must
  branch** → the `@unique` on `amendsCashMovementId` is the thing being changed;
  revisit §1 before relaxing it.
- **Cash movements must be voidable outright** (an entry that should never have
  existed, with no corrected value to state) → this ADR has no representation
  for it; decide whether that is a `VOID` supersession or a separate kind.
- **A second branch goes live** → `location_id` on `CashMovement` per ADR 0006's
  own trigger; the amendment link is location-agnostic and needs no change, but
  the day-scoped queries do.
