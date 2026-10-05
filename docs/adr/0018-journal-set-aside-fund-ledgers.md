# ADR 0018: The Journal — Set-Aside Fund Ledgers, Suggestion Rules & Effective-Dated Rates

- **Status:** Proposed
- **Date:** 2026-10-04
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001 (bounded contexts, money in integer
  minor units, append-only convention, nullable `location_id`), ADR 0004/0006
  (the trading day and its close), ADR 0013 §1 (the precedent for adding a
  bounded context rather than widening `staff` or `reporting`) and ADR 0017 §2–§3
  (Compensation's read-only seam onto the Sales/Orders read model, and the
  suggestion-is-not-a-record principle). Answers the **ARCHITECTURE GAP** the
  Product Owner flagged on story #467, and **fires the revisit trigger ADR 0017
  states by name:** *"The commission rate becomes configurable, time-varying, or
  tiered → new ADR covering where the rate lives and how a stored record is tied
  to the rate in force when it was written."*

---

## Context

Story #467 (under epic #466) asks for an administrator-only **Journal**: separate
money ledgers for amounts set aside out of daily sales. It ships with two
ledgers, **Rent** and **Chair**, allows the administrator to add further ledgers,
records **deposits** (one per ledger per business day) and **withdrawals** (dated,
not tied to a business day), shows a running balance that may go negative, and
offers **suggested** deposit amounts derived from the day's gross sales for
closed business days only — including a bulk "catch up the missing days" flow.

The story's own scope notes state the gap plainly: ADR 0001 names Catalog,
Inventory and Sales/Orders and nothing else, and no existing decision covers an
administrator-maintained fund ledger.

### Ground truth in the repo today

- **There is no settings, configuration or key-value table anywhere in
  `apps/api/prisma/schema.prisma`.** Every tunable number in the system today is
  either a column on a row or a named constant in `packages/shared`
  (`COMMISSION_GROSS_BAND_CENTS`, `COMMISSION_PER_BAND_CENTS`). This story is the
  first to require an administrator-editable, **time-varying** rate, and it is
  why ADR 0017's revisit trigger fires here.
- **The day's gross already has exactly one definition**, and it is already
  exposed through a seam built for precisely this shape of consumer:
  `ReportingService.getDailyGrossSales(businessDate)` →
  `{ hasBusinessDay, grossSalesCents }`
  (`apps/api/src/reporting/reporting.service.ts:364`), implemented over
  `loadDailyReadModel(from, to)`.
- Per ADR 0017's verified-against-the-code Context, that figure **already means**
  "money taken by completed sales on that business date, net of voids, excluding
  cash tips": parked orders carry no payment rows, a void is a reversing sale with
  negated payment rows (`OrderStatus` is only `PARKED | COMPLETED`), and
  `tipsCents` is a separate term in the same read model. This is exactly the
  story's "completed cash and online sales, net of voids and excluding tips" —
  **the same number the reports show**, which is what the acceptance criterion
  requires.
- The per-day rows of that read model carry `status` (`TradingDayStatus`), so
  "closed business days only" is answerable from the existing read model.
  `getDailyGrossSales` as it stands does **not** surface `status`, so it is
  insufficient on its own (§3).
- `TradingDay` (`schema.prisma:378`) is keyed by nullable `locationId` +
  `businessDate` with `status OPEN | CLOSED`; `DayClosing` is the immutable
  close snapshot (ADR 0006).
- Administrator-only API surfaces are class-level
  `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)` on the controller —
  `compensation.controller.ts:37-39`, `reporting.controller.ts:31-33`. `Role` is
  `ADMIN | STAFF` (ADR 0002).
- The admin shell is `AdminLayout` in `apps/web/src/App.tsx:411`, with
  `ADMIN_NAV_GROUPS` (`App.tsx:53`) and a `destinationName` map (`App.tsx:104`);
  admin routes live under a single `ProtectedRoute role={Role.ADMIN}` block
  (`App.tsx:497-553`).
- **Hard delete of an administrator-owned money row already has precedent**:
  `DELETE /compensation/entries/:id` and `DELETE /compensation/adjustments/:id`
  (`compensation.controller.ts:83,112`). ADR 0001 §4's append-only rule is scoped
  by its own words to **stock counts and sales**.

### What has to be decided rather than inferred

1. Where the Journal lives — a context of its own, or a corner of an existing one.
2. How "which closed days still need attention" is represented, so that a day is
   *recorded* exactly when a deposit row exists, and un-recorded the moment it is
   deleted.
3. The Rent rounding arithmetic, in integer cents, including its boundaries.
4. Where the three editable rates live and how "a change affects later business
   days only" is made true by construction rather than by discipline — the ADR
   0017 trigger.
5. Whether a suggestion is ever stored, and what stops a later change to a day's
   gross from disturbing a saved deposit.
6. That the Journal is inert with respect to cash reconciliation.

---

## Decision

### 1. The Journal is a new bounded context, `journal`

A new NestJS module `apps/api/src/journal/` owns every Journal read and write,
alongside Catalog, Inventory, Sales/Orders and Compensation. This follows
ADR 0013 §1's reasoning, and the same two rejections apply with the same force:

- **Not `reporting`.** That module is the Sales/Orders read model. The Journal
  *reads* it; sharing a shape with a report is not grounds for conflation.
- **Not `trading-day`.** A deposit references a business date but is not part of
  the day's lifecycle, is written days or weeks after the close, and must not
  acquire the open/close state machine of ADR 0004.

Direction of dependency, binding: **`journal` → `reporting`, read-only, and
nothing else.** Sales/Orders, Catalog, Inventory, Compensation and `trading-day`
must not depend on `journal`, and no Journal write may touch a `sales`,
`sale_payments`, `trading_days`, `cash_counts`, `cash_movements` or `day_closings`
row. §7 makes that an assertion rather than an aspiration.

The Journal is **money set aside out of sales, recorded by hand**. It is not a
sales ledger, not a cash ledger, and not a second general ledger.

### 2. Storage — three tables, plus an effective-dated rate table

All four carry nullable `locationId` per ADR 0001 §2. All money is `Int` cents.

**`JournalLedger` (`journal_ledgers`)**

- `id` uuid pk.
- `name` — `String`, `@@unique` (case-insensitively enforced in the service; a
  second "Rent" is a mistake, not a feature).
- `startDate` — `DateTime @db.Date`. The earliest business day the ledger is
  responsible for; the bulk-add filter of §6 is defined against it.
- `startingBalanceCents` — `Int`, default `0`. Signed (`Int`, no CHECK): the
  story calls it optional, and a ledger that starts in deficit is representable.
- `suggestionKind` — new enum `JournalSuggestionKind`
  (`NONE | RENT_PERCENT_OF_ROUNDED_GROSS | CHAIR_FLAT_ABOVE_THRESHOLD`).
- `isBuiltIn` — `Boolean`, default `false`.
- `createdAt`.

**`JournalDeposit` (`journal_deposits`)**

- `id` uuid pk, `ledgerId` FK → `JournalLedger` `onDelete: Restrict`.
- `businessDate` — `DateTime @db.Date`.
- **`@@unique([ledgerId, businessDate])`** — this constraint *is* the "that
  business day is completed for that ledger" fact. There is no `isRecorded`
  column, no `completedDays` table and no denormalized counter to fall out of
  step; recorded-ness is the existence of the row, so deleting the row
  un-records the day with no extra code path. A replay surfaces as Prisma
  `P2002` → `409 Conflict`, matching the existing compensation-entry behaviour.
- `amountCents` — `Int`, CHECK `>= 0`. **Zero is a valid, meaningful deposit**
  (the story requires a saved ₱0 to mark the day completed), so `0` and "no row"
  must stay distinguishable end to end — in the DTO, the API, the form state and
  the bulk-add payload. Collapsing a `0` deposit into "missing" breaks two
  acceptance criteria at once.
- `note` — `String?`, stored verbatim and trimmed-to-null when blank.
- `recordedByUserId`, `recordedAt`, `updatedByUserId`, `updatedAt`.

**`JournalWithdrawal` (`journal_withdrawals`)**

- `id` uuid pk, `ledgerId` FK `onDelete: Restrict`.
- `withdrawnOn` — `DateTime @db.Date`. **Deliberately not named
  `businessDate` and deliberately not unique**: a withdrawal is not tied to a
  business day, several may share a date, and nothing about it is a trading day.
- `amountCents` — `Int`, CHECK `>= 1`. The story grants zero-amount saves to
  deposits only, because a ₱0 deposit carries the distinct meaning "this day is
  handled"; a ₱0 withdrawal carries no meaning. Same field-level refusal as any
  other amount.
- `note` — `String?`, as above.
- audit columns, as above.

**`JournalSuggestionRate` (`journal_suggestion_rates`)** — §4.

### 3. The suggestion seam — one new read-model method, closed days only

`reporting` gains **one** method, and `JournalModule` imports `ReportingModule`:

```
ReportingService.getClosedDailyGross(from: string, to: string)
  → ReadonlyArray<{ businessDate: string; grossSalesCents: MoneyCents }>
```

implemented over the existing `loadDailyReadModel(from, to)`, filtered to
`status === TradingDayStatus.CLOSED` and summed per business date.

- **`journal` must not query `sales`, `sale_payments`, `trading_days` or
  `day_closings` directly, and must not write its own aggregate SQL.** The point
  of the seam is that one definition of a day's gross survives, so the suggestion
  provably equals the reported figure.
- `getDailyGrossSales` (ADR 0017 §2) is **left exactly as it is**. Compensation's
  question is "what did this calendar date gross", answered for open days too;
  the Journal's question is "which *closed* days grossed what". Overloading one
  method with a status filter would change Compensation's answers, so a second
  method is the cheaper and safer shape.
- An **open** business day is not merely suggestion-free: it does not appear in
  the Journal's missing-days list at all (§6), and the Journal shows no
  suggestion for it. A day with no `TradingDay` row likewise does not exist for
  the Journal.
- **Location-unscoped**, consistent with ADR 0017 §2 and ADR 0001 §2's single
  location. See revisit triggers.

### 4. The three rates are effective-dated rows, keyed by business date

`JournalSuggestionRate` (`journal_suggestion_rates`) is **append-only**:

- `id` uuid pk, `ledgerId` FK `onDelete: Restrict`.
- `effectiveFrom` — `DateTime @db.Date`.
- `rentPercentBasisPoints` — `Int?`, CHECK `NULL OR BETWEEN 0 AND 10000`.
- `chairAmountCents` — `Int?`, CHECK `NULL OR >= 0`.
- `chairThresholdCents` — `Int?`, CHECK `NULL OR >= 0`.
- `createdByUserId`, `createdAt`.
- `@@unique([ledgerId, effectiveFrom])`.

**The rate in force for a business date is the row with the greatest
`effectiveFrom <= businessDate`.** A change is a **new row**, never an update of
an existing one.

- This is what makes *"a change affects suggestions for later business days
  only"* true **by construction**. A mutable rate column would make the
  behaviour depend on when the administrator happened to look at a day, which is
  exactly the class of bug the criterion is written to forbid.
- **A change writes `effectiveFrom` = the current server calendar date.** So the
  new rate applies to business dates on or after today, and every earlier closed
  day that still has no deposit keeps suggesting at the rate in force on *its
  own* business date. **This reading — that the boundary is the business date,
  not the moment of the edit — is the load-bearing interpretation of the
  criterion and is the thing a human reviewer should confirm.** Changing the
  rate twice in one day overwrites that day's row (an upsert on the unique key),
  which is correct: the latest intent for today wins, and no earlier day moves.
- **Backdating is not offered.** No endpoint accepts `effectiveFrom`. A rate
  that should have applied last month is a new story with its own ADR, because
  it would retroactively change the suggestion on days the administrator may
  already have reviewed.
- Basis points, not a percent float or a decimal: ADR 0001 §1 forbids float
  money, and §5 shows the basis-point form keeps the arithmetic exactly integral.
- **The Rent rounding rule is not configurable and has no row.** The story says
  so in as many words. It is the shared function of §5.
- Migration seeds, in one migration: the `Rent` ledger
  (`RENT_PERCENT_OF_ROUNDED_GROSS`, `isBuiltIn`), the `Chair` ledger
  (`CHAIR_FLAT_ABOVE_THRESHOLD`, `isBuiltIn`), and one rate row each —
  Rent `rentPercentBasisPoints = 1000` (the story's initial 10%), Chair
  `chairAmountCents = 10_000` and `chairThresholdCents = 300_000` (₱100 above
  ₱3,000).
- **Seeded `startDate` is the earliest `trading_days.business_date` present at
  migration time, falling back to the migration date when there is none.** This
  is a decision and not an inference: it is what makes bulk add surface the
  shop's whole history on first use, which is the point of the feature. A
  later-opening ledger is the administrator's to create.
- **A ledger with `suggestionKind = NONE` has no rate row and never gets one.**
  Administrator-added ledgers are fully manual, per the story; the create
  endpoint does not accept rate fields, and the rate endpoint refuses a `NONE`
  ledger with a `400`.

### 5. The arithmetic — two pure functions in `packages/shared/src/money.ts`

Integer cents throughout, beside `suggestCommissionCents` (ADR 0017 §3):

```ts
export const RENT_ROUNDING_UNIT_CENTS = cents(100_000);   // ₱1,000
export const RENT_ROUND_UP_HUNDREDS_DIGIT = 8;

// Round gross by its hundreds digit — 0..7 down to the whole thousand,
// 8..9 up — then apply the rent rate in basis points.
export function suggestRentDepositCents(
  grossSalesCents: MoneyCents,
  rentPercentBasisPoints: number,
): MoneyCents {
  if (grossSalesCents <= 0) return cents(0);
  const wholeThousands = Math.floor(grossSalesCents / 100_000);
  const hundredsDigit = Math.floor((grossSalesCents % 100_000) / 10_000);
  const rounded =
    (hundredsDigit >= RENT_ROUND_UP_HUNDREDS_DIGIT
      ? wholeThousands + 1
      : wholeThousands) * 100_000;
  return cents((rounded / 10_000) * rentPercentBasisPoints);
}

export function suggestChairDepositCents(
  grossSalesCents: MoneyCents,
  chairAmountCents: MoneyCents,
  chairThresholdCents: MoneyCents,
): MoneyCents {
  if (grossSalesCents < chairThresholdCents) return cents(0);
  return chairAmountCents;
}
```

- **The rounding is on the gross, and the percentage is applied after** — never
  the reverse. Applying 10% first and then rounding gives ₱780 for a ₱7,800 gross
  instead of ₱800.
- **The result is exactly integral with no rounding mode at all.** `rounded` is
  always a multiple of 100,000 cents, so `rounded / 10_000` is an integer and the
  product with an integer basis-point value is an integer. There is **no
  half-up, no floor, no `Math.round` on money** anywhere in this ADR, and none
  may be introduced: if a future rate needs one, that is a new decision.
- **Comparison is `>=` for Chair** ("at least ₱3,000") and `< threshold → ₱0`.
  A ₱0 Chair suggestion is a real, displayable suggestion (§6), not an absence.
- Negative gross — reachable when a day's voids exceed its sales — clamps to ₱0
  for Rent, and for Chair falls below any non-negative threshold and yields ₱0.
  A suggestion is never negative.
- The story's worked examples are a **required unit-test table**, verified
  against the function above: `760_000 → 70_000`; `779_999 → 70_000`;
  `780_000 → 80_000`; `700_000 → 70_000`; `79_900 → 0`; `80_000 → 10_000`; plus
  the boundaries `0 → 0`, `-1 → 0`, `769_999 → 70_000`/`770_000 → 70_000` (the
  7↔8 digit edge) and `99_999 → 10_000` — note that last one: ₱999.99 has
  hundreds digit 9, so it rounds **up** to ₱1,000 and suggests ₱100. It is the
  rule working, not a bug, and it is the case most likely to be "fixed" by
  someone who mistook this rule for the ₱50/₱1,000 band of ADR 0017 §3, which
  floors instead. Chair: `299_999 → 0`, `300_000 → 10_000`,
  `3_000_000 → 10_000`.
- **These functions execute on the server.** The browser renders money and never
  derives it (ADR 0013 §3, ADR 0014 §3, ADR 0017 §3). They live in
  `packages/shared` so the rule is versioned with the contract, not so the web
  may call them.

### 6. A suggestion is never stored, and a saved deposit is never re-derived

This is the same principle as ADR 0017 §3, and here it is what satisfies two
acceptance criteria at once.

- `JournalDeposit.amountCents` is **administrator-entered and persisted
  verbatim**. It is never recomputed on read, never reconciled against sales,
  and no deposit row references a gross figure, a rate row or a suggestion. So
  *"a later change to that day's gross does not alter the saved deposit"* holds
  **by construction** — there is nothing to invalidate.
- *"...and does not create another suggestion for that day"* holds for the same
  reason the day is marked recorded: the missing-days query is an anti-join
  against `journal_deposits`, so a day with a row — including a ₱0 row — is not a
  missing day and has no suggestion computed for it at all.
- **Balance is computed, not stored:**
  `startingBalanceCents + Σ deposits − Σ withdrawals`, server-side, over the
  ledger's full history. No running-balance column, no per-day snapshot. It may
  be negative and is rendered as such; there is no CHECK, no guard and no warning
  gate on a withdrawal that overdraws — the story requires the overdraw to
  succeed.
- **Missing days, for one ledger** (`GET /journal/ledgers/:id/missing-days`):
  every `CLOSED` business date `>= ledger.startDate` with no `journal_deposits`
  row for that ledger, each with the suggestion for its own business date under
  the §4 rate in force **for that date**. A `NONE` ledger returns the same day
  list with `suggestedAmountCents: null` — `null`, not `0`, because "no
  suggestion" and "a ₱0 suggestion" are different states and the Chair ledger
  genuinely suggests ₱0 below its threshold.
- **Bulk save is one transaction.** `POST /journal/ledgers/:id/deposits/bulk`
  takes the administrator's selected `{ businessDate, amountCents, note? }`
  rows and writes them inside a single `prisma.$transaction`. All-or-nothing is
  the transaction, not application ordering: a `P2002` from a day that was
  recorded between the page load and the save rolls the whole batch back and
  returns `409`, rather than leaving a half-caught-up ledger. Unticked days are
  simply absent from the payload — the server has no concept of a skipped day.

### 7. The Journal is inert with respect to cash, and that is tested, not assumed

No Journal write touches `trading_days`, `cash_counts`, `cash_movements`,
`day_closings`, `sales`, `sale_payments` or `sale_lines`. **ADR 0006 §5's
expected-cash formula and `calculateCashReconciliation` are untouched by this
ADR**, and a set-aside is deliberately *not* a `CashMovement`:

- A `CashMovement` is money physically leaving or entering the drawer on a
  trading day and it changes expected cash (ADR 0006 §1). A Journal deposit is
  an administrative earmark recorded after the fact, often in bulk, for days
  already closed and reconciled.
- Writing one as a cash movement would alter the expected cash of an already
  closed day and manufacture a variance — the precise outcome the acceptance
  criterion forbids.

**Binding requirement:** an integration test must assert that recording,
editing and deleting Journal deposits and withdrawals leaves the day's
`expectedCashCents`, `varianceCents` and the `GET /reporting/report` figures
byte-identical. "We didn't write that code" is not a guard; the assertion is.

### 8. Authorization — one more admin-only controller, no new mechanism

- `JournalController` is class-level
  `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)` — identical to
  `compensation` and `reporting`. **No new role, no new permission rule, no new
  session behaviour, no new credential handling**, and none may be introduced.
  `Role` stays `ADMIN | STAFF` (ADR 0002).
- The story's "staff cannot access Journal information or actions, including
  through a direct request" is satisfied by that guard, which answers **403 to a
  `STAFF` token on every verb**. Hiding the nav item is a courtesy; the guard is
  the boundary. A test must assert the 403 **per verb**, not merely that the web
  route redirects.
- Web: `/journal` is added inside the existing
  `ProtectedRoute role={Role.ADMIN}` / `AdminLayout` block in `App.tsx`, as one
  more `ADMIN_NAV_GROUPS` entry under **Operations** and one more
  `destinationName` entry. No new shell, no new layout, no second protected
  block.

### 9. Contracts

In `packages/shared` (ADR 0001 §3): `JournalLedger`, `JournalLedgerBalance`,
`JournalDeposit`, `JournalWithdrawal`, `JournalSuggestionRate`,
`JournalMissingDay`, `JournalSuggestionKind`, the create/update inputs, the bulk
input, and the §5 functions and constants in `money.ts`.

API surface after this story, all admin-only:

- `GET /journal/ledgers` — ledgers with computed balances.
- `POST /journal/ledgers` — name, startDate, optional startingBalanceCents;
  always `suggestionKind: NONE`.
- `GET /journal/ledgers/:id` — ledger, balance, deposits, withdrawals.
- `GET /journal/ledgers/:id/missing-days` — §6.
- `POST /journal/ledgers/:id/deposits`, `PATCH /journal/deposits/:id`,
  `DELETE /journal/deposits/:id`.
- `POST /journal/ledgers/:id/deposits/bulk` — §6.
- `POST /journal/ledgers/:id/withdrawals`, `PATCH /journal/withdrawals/:id`,
  `DELETE /journal/withdrawals/:id`.
- `GET /journal/ledgers/:id/rate`, `PUT /journal/ledgers/:id/rate` — §4;
  `PUT` writes/upserts today's row and refuses a `NONE` ledger.

Additive elsewhere. `ReportingService.getDailyGrossSales`, every `/reporting`
and `/compensation` response, `DayClosing` and `calculateCashReconciliation`
keep their current names, shapes and meanings.

### 10. Mutability and deletion, stated deliberately

Deposits and withdrawals are **mutable and hard-deletable** by an administrator.
This is a narrow, explicit qualification of ADR 0001 §4, which scopes
append-only to **stock counts and sales**; it follows the existing precedent of
`DELETE /compensation/entries/:id` and `DELETE /compensation/adjustments/:id`
(ADR 0013 §2's mutability exception).

- A delete is a real row delete. There is no tombstone, no `deletedAt` and no
  reversing row — a deleted deposit must stop marking its business day as
  recorded, and a soft-deleted row would have to be excluded from the §2 unique
  constraint, which would defeat the one mechanism that makes recorded-ness
  trustworthy.
- `updatedByUserId` / `updatedAt` are the audit trail for an edit. A **delete
  leaves no trace**, which is accepted below.
- `JournalLedger` itself has **no update and no delete endpoint in this story** —
  the acceptance criteria grant creation only. See revisit triggers.

---

## Consequences

**Positive**

- One definition of a day's gross, still owned by `reporting`. The Rent and
  Chair suggestions cannot drift from the sales report, and voids already reduce
  them.
- "A day is recorded" is a unique constraint, not a flag. Deleting a deposit
  un-records the day with no second code path, and no counter can disagree with
  the rows.
- "A rate change affects later business days only" is a row with an
  `effectiveFrom`, not a convention someone has to remember — and the history of
  what was in force when is queryable, which the ₱50/₱1,000 commission constant
  of ADR 0017 is not.
- Nothing derived is stored, so "a later change to the day's gross does not
  disturb a saved deposit" needs no invalidation logic and cannot rot.
- The rent arithmetic is exactly integral with no rounding mode, so there is no
  half-up convention to get wrong.
- No new authorization surface: one more class-level `ADMIN` controller inside
  the existing protected shell.
- Bulk catch-up is a database transaction, so the half-caught-up ledger is not
  representable.

**Negative / accepted trade-offs**

- **A fifth bounded context.** `journal` is small, and a reviewer may reasonably
  ask why it is not a corner of `reporting`. The answer is §1, and it is the same
  answer ADR 0013 gave for Compensation.
- **The first effective-dated configuration in the system.** Every suggestion
  read now needs a point-in-time rate lookup, which is a shape nothing else here
  has. It is the honest cost of "later business days only"; a mutable column
  would be smaller and wrong.
- **`journal_suggestion_rates` grows one row per rate change per ledger, and
  appending to it is irreversible through the API** — a mistaken rate change can
  be superseded for today but not unsaid, and the backdating a correction would
  need is deliberately not offered (§4).
- **A deleted deposit or withdrawal leaves no trace.** Consistent with the
  compensation precedent, but it means "why did this balance change" has no
  answer in the data once a row is gone. Accepted for a two-administrator
  internal tool.
- **`0` versus absent is a subtle distinction carried end to end** — a ₱0
  deposit marks a day complete, a ₱0 Chair suggestion is a real suggestion, and
  `null` means "no suggestion at all". Every one of those is easy to flatten in a
  form default or a JSON round-trip, and flattening it is silent. Called out as
  a hard requirement in §2 and §6 and as required tests.
- **The seeded `startDate` is data-dependent.** Two environments migrating at
  different times get different Rent/Chair start dates, and with no ledger-update
  endpoint (§10) it cannot be corrected through the API. Accepted because the
  alternative — a fixed date — is wrong everywhere instead of only occasionally.
- **No ledger rename, no ledger delete, no archive.** A typo'd ledger name is
  permanent until a follow-up story. This is scope held to the acceptance
  criteria rather than an oversight.
- **A second `reporting` gross method.** Two closely related methods invite a
  future "unify these"; §3 records why they are separate so that refactor is
  argued rather than performed.
- **The Journal is unscoped by location**, like ADR 0017 §2. One shop's rent
  share is computed from every trading day on the date.

**Revisit triggers**

- **A second branch opens, or a ledger becomes branch-scoped** → §3's
  location-unscoped gross is wrong, the §2 nullable `location_id` columns come
  into play, and "which days are missing" becomes a per-location question.
- **A rate change must be backdated, or a rate must be corrected rather than
  superseded** → §4 deliberately refuses both; reopening it means deciding what
  happens to days already reviewed under the old rate.
- **A suggestion must be auditable** — "was this deposit the suggested figure or
  an override" → nothing records it today, and answering it means storing the
  derivation alongside the deposit, which §6 forbids on purpose.
- **A Journal balance must feed expected cash, a close, or a report total** →
  §7's inertness is the whole safety argument for recording set-asides against
  already-closed days; coupling them is a new decision, not an extension.
- **The Rent rounding rule itself becomes configurable or per-ledger** → §5's
  shared function and §4's "the rounding rule does not change" are the things
  being changed.
- **Ledgers need renaming, deletion, archival, or a corrected start date** →
  §10's create-only surface, and `onDelete: Restrict` on both child tables.
- **A third suggestion shape appears** → `JournalSuggestionKind` plus three
  nullable rate columns is a sparse table that tolerates two kinds well and four
  badly; a third is the point to decide on a typed rate payload.

---

## Amendment — 2026-10-06: a ledger's start date and starting balance are editable

**Trigger fired:** *"Ledgers need … a corrected start date."* The seeded
`startDate` (§4) is the earliest trading day, so the shop's entire pre-Journal
history surfaced as outstanding days that will never be recorded. With no
update endpoint (§10) there was no way to stop listing them.

- `PATCH /journal/ledgers/:id` takes `{ startDate, startingBalanceCents }`, both
  required, admin-only under the existing class-level guard. Name, kind and
  `isBuiltIn` stay immutable — rename/delete/archive remain out of scope.
- **Moving `startDate` later is the "skip history" mechanism.** The missing-days
  list is already defined as closed days `>= startDate` (§6), so nothing else
  changes: no skip rows, no dismissed-day table, no flag. Moving it earlier
  re-surfaces those days, which is the undo.
- `startingBalanceCents` is the money set aside before `startDate`, so the
  balance stays right without back-filling deposits.
- **Refused (`400 START_DATE_AFTER_RECORDED_DEPOSIT`) when the new start date is
  after the ledger's earliest deposit.** A deposit before `startDate` would fail
  §6's own eligibility check on edit, leaving an uneditable row. The
  administrator picks that date or earlier, or deletes the deposit first.
- Rates are unaffected: they are keyed by business date, not by `startDate`.

