# ADR 0013: Staff Compensation Records & Payslip Generation

- **Status:** Proposed
- **Date:** 2026-08-15
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001 (bounded contexts, money and
  append-only conventions), ADR 0002 (role model) and ADR 0003 (staff roster
  identity). Answers the ARCHITECTURE GAP the Product Owner flagged on story
  #309: ADR 0001 names Catalog, Inventory and Sales/Orders but no compensation
  or payroll context.

---

## Context

Story #309 asks for an administrator-only capability to record, per staff member
per day, a **salary amount** and a **commission amount**, to maintain those
records (add / edit / delete), and to generate a **payslip** — a summary of the
records falling inside an inclusive start/end date range, with per-entry lines
and salary, commission and overall totals.

The story scopes itself tightly and the scoping matters to this decision:

- Amounts are **manually entered**. Nothing derives compensation from
  attendance, schedules, sales, or targets.
- The payslip is a **generated, administrator-viewable summary**. Printing,
  download, email, payment processing and employee self-service are explicitly
  not committed.
- Taxes, statutory deductions, benefits, advances, overtime and disbursement are
  outside the story.
- No ADR 0001 v1 non-goal is implicated.

Ground truth in the repo today:

- `StaffMember` (`apps/api/prisma/schema.prisma:120`) is the canonical roster
  identity per ADR 0003: `displayName`, `isActive`, nullable `locationId`,
  optional `userId` link to the auth `User`. It is *not* an auth account, and
  a roster member need not have a login.
- `Role` is `ADMIN | STAFF` (ADR 0002). Admin-only surfaces are expressed today
  as `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)` on a controller —
  see `reporting.controller.ts:27-30` and `staff.controller.ts`.
- Calendar-day columns are stored as `DateTime @db.Date` (`business_date` on
  `stock_counts`, `cash_movements`, `trading_days`).
- Range-report read models already exist in the `reporting` module
  (`GET /reporting/report?from=&to=`), scoped to **Sales**.
- Money is integer minor units everywhere, with helpers in
  `packages/shared/src/money.ts`.

Three questions have to be decided rather than inferred, and two of them sit in
high-risk areas (money, deletion):

1. **Ownership** — which context owns compensation records, and how they relate
   to the roster and to `location_id`.
2. **Mutability** — ADR 0001 §4 makes stock counts and sales append-only. This
   story requires edit-in-place *and* hard delete of monetary records. Whether
   that is an exception, and on what grounds, must be stated.
3. **What a payslip actually is** — a persisted artifact, or a computation.

---

## Decision

### 1. A new bounded context: Compensation

Compensation is its **own bounded context**, alongside Catalog, Inventory and
Sales/Orders — not a corner of the roster and not a `reporting` endpoint.

- A new NestJS module `apps/api/src/compensation/` owns every read and write.
- It is **not** added to `staff`: ADR 0003 gives `staff` a single job, the
  roster identity a sale is attributed to. Compensation *references* that
  identity; it does not extend it.
- It is **not** added to `reporting`: that module is a Sales/Orders read model.
  Payroll figures sharing a shape with sales reports is not a reason to conflate
  the two contexts.

Compensation depends on the roster (one-way, `StaffMember` FK). Sales/Orders,
Catalog and Inventory must not depend on Compensation.

### 2. Storage — one mutable daily entry per staff member per date

A single new Prisma model, `StaffCompensationEntry` (`staff_compensation_entries`):

- `id` — uuid, pk.
- `staffMemberId` — required FK to `StaffMember`, `onDelete: Restrict`
  (consistent with every other `StaffMember` relation in the schema; a roster
  member with compensation history is deactivated, never deleted out from under
  it).
- `workDate` — `DateTime @db.Date`. A plain **calendar date**, deliberately
  **not** the ADR 0004 trading day: compensation is an HR/administrative date
  and must not inherit the trading-day open/close lifecycle.
- `salaryCents` — `Int`, `>= 0`.
- `commissionCents` — `Int`, `>= 0`.
- `locationId` — nullable, denormalized from the staff member at write time, per
  the ADR 0001 branch-readiness convention. Second branch is imminent and
  backfilling payroll history later is exactly the retrofit that convention
  exists to avoid.
- `createdByUserId` / `updatedByUserId` — FKs to `User`, recording which
  administrator last touched the row (see §4).
- `createdAt` / `updatedAt`.
- `@@unique([staffMemberId, workDate])` and `@@index([staffMemberId, workDate])`.

**Uniqueness is enforced by the database, not by a read-then-write check.** The
service lets the unique constraint fire and maps Prisma `P2002` to `409
Conflict`, leaving the existing row untouched. A `SELECT`-then-`INSERT` guard is
not acceptable here: it is racy, and the story states the duplicate attempt must
not change the existing record.

### 3. Money — integer cents, derived totals, no float, no tax arithmetic

- `salaryCents` and `commissionCents` are integer minor units (ADR 0001 §1).
  Validation rejects negatives, non-integers and missing values with a field-level
  message; there is no silent coercion or rounding.
- **The daily total is derived, never stored**: `salaryCents + commissionCents`.
- **Payslip totals are computed server-side** by integer summation over the
  entries in range, and returned alongside the lines. The browser renders totals;
  it never computes them. This keeps one arithmetic implementation, which is what
  makes the story's "a newly generated payslip reflects the current records"
  criterion true by construction.
- No tax, deduction, benefit, advance or net-pay arithmetic is introduced. A
  payslip in v1 is a sum of entered gross amounts and nothing else. Any story
  introducing a deduction or a net/gross distinction requires a new ADR.

### 4. Mutability — a scoped, deliberate exception to ADR 0001 §4

Compensation entries are **mutable in place and hard-deletable**. This is an
explicit, narrow exception to ADR 0001 §4 (append-only), and it is confined to
this table.

Rationale — the append-only rule protects records of *events that happened*: a
sale rung at the till, a stock count taken at a point in time. A compensation
entry is not an event record; it is an administrator-maintained figure typed by
hand, whose only consumer is a computation performed on demand. Nothing
references an entry, so nothing dangles when one is removed, and correcting a
typo by appending a compensating negative row would make the ledger *less*
honest, not more — negative amounts are refused by §3.

The audit need is met instead by `createdByUserId`, `updatedByUserId` and
`updatedAt` on the row. Delete is a real `DELETE`; the confirmation step the
story requires is a UI affordance, not a soft-delete flag.

**This exception ends the moment a payslip becomes an artifact.** See revisit
triggers.

### 5. A payslip is a computed read model, not an entity

No `Payslip` table, no persisted payslip document, no payslip number, no
"issued" state in v1. The story asks for a generated, viewable summary and
explicitly defers printing, download, email and payment.

`GET /compensation/payslip?staffMemberId=&from=&to=` computes and returns:

- the staff member (id + display name at time of generation),
- the requested `from`/`to`,
- the entries whose `workDate` falls in `[from, to]` **inclusive of both
  endpoints**, ordered by `workDate`,
- `salaryTotalCents`, `commissionTotalCents`, `grandTotalCents`.

Two response rules the implementation must honour:

- `to < from` is a **400** with a field-level explanation. It is never silently
  swapped or normalized.
- A valid range with no entries is a **200** carrying an empty `entries` array
  and zero totals. The UI must render an explicit "no records in this range"
  state from the empty array rather than displaying a ₱0.00 payslip that reads
  like a real one. The contract makes the empty case representable; presenting
  it unambiguously is a design/dev obligation.

Because the payslip is computed at request time, it reflects current records
automatically after any add, edit or delete — no cache, no invalidation.

### 6. Authorization — uses the existing role rule, introduces no new mechanism

The compensation controller is guarded exactly like the existing admin surfaces:
`@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(Role.ADMIN)` at controller
level, so every route (list, create, update, delete, payslip) is admin-only by
default rather than per-route opt-in. A `STAFF` token receives `403` on all of
them. No new role, permission model, session behaviour or credential handling is
introduced by this story, and none may be introduced by its implementation.

The web app must not merely hide the navigation entry: the API is the boundary,
the hidden route is a courtesy.

### 7. Shared types

Request/response contracts (`StaffCompensationEntry`, `PayslipSummary` and their
DTO inputs) live in `packages/shared`, per ADR 0001 §3, and are consumed by both
apps. `apps/web` gets an admin-shell route for the compensation list/form and the
payslip view.

---

## Consequences

**Positive**

- The new context is isolated: one module, one table, one FK into the roster.
  Catalog, Inventory and Sales/Orders are untouched.
- Duplicate prevention is a database invariant, so it holds under concurrent
  admins and under any future import path.
- Payslip-reflects-current-records is true by construction rather than by cache
  discipline.
- Deferring the `Payslip` entity keeps the door open for the printing / issuing /
  disbursement scope the PO explicitly did not commit, without paying for it now.

**Negative / accepted trade-offs**

- Compensation history is destructible. An administrator can delete a month of
  entries and the only trace is their absence. Accepted for an internal tool with
  two trusted admin users and no issued payslips; called out as a revisit trigger.
- `locationId` is denormalized from the staff member at write time, so a member
  who transfers branches leaves history attributed to the branch recorded at
  entry. That is the correct payroll semantic, but it means the column can
  disagree with `StaffMember.locationId` — intentionally.
- A fifth bounded context is more structure than a two-table feature strictly
  needs. Accepted: payroll is the context most likely to grow deductions,
  periods and disbursement, and retrofitting a boundary later is expensive.

**Revisit triggers**

- **A payslip becomes an artifact** — persisted, numbered, printed, downloaded,
  emailed, or marked paid. At that point §4's mutability exception must be
  withdrawn for any period covered by an issued payslip: entries become
  immutable and corrections become append-only adjustment rows, per ADR 0001 §4.
- **Deductions, tax, net pay, advances or overtime rules** enter scope → new ADR
  covering the arithmetic; §3's "gross sum only" rule is the thing being changed.
- **Compensation derived from sales, targets or attendance** → revisit the
  one-way dependency in §1; Compensation reading Sales/Orders is a real coupling
  decision, not an implementation detail.
- **Employee self-service** (staff viewing their own payslip) → revisit §6; the
  blanket controller-level `ADMIN` rule becomes an ownership rule and that is a
  change to an authorization invariant.
- **More than two branches, or branch-scoped payroll administration** → revisit
  `locationId` nullability here alongside ADR 0001's global trigger.
