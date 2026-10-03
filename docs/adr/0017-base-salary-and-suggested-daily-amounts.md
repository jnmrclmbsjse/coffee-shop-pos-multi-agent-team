# ADR 0017: Staff Base Salary & Sales-Derived Suggestions on the Daily Compensation Record

- **Status:** Proposed
- **Date:** 2026-10-03
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0013 (Compensation context, money rules,
  payslip-as-computation), ADR 0014 (adjustments: allowances, descriptions,
  amount rules), ADR 0003 (staff roster identity) and ADR 0001 (money in integer
  minor units, bounded contexts, append-only convention). Answers the
  ARCHITECTURE NOTE the Product Owner raised on story #414, and **fires the
  revisit trigger both ADR 0013 and ADR 0014 state by name:** *"Compensation
  derived from sales, targets or attendance → revisit the one-way dependency;
  Compensation reading Sales/Orders is a real coupling decision, not an
  implementation detail."*

---

## Context

Story #414 extends the compensation workflow delivered by #309 (daily records,
ADR 0013) and #346 (adjustments and payslip export, ADR 0014) with three things
those decisions deliberately left out:

1. **A base salary per staff member** — a daily rate, maintained on the staff
   member, optional, administrator-only.
2. **Suggested amounts on the Add daily record form** — the salary prefilled
   from the staff member's base salary, and a **commission derived from the
   shop's gross sales for the selected work date**: ₱50 for every full ₱1,000 of
   gross. Both suggestions are overridable before saving.
3. **An "Include load allowance" checkbox** on the add form that records a
   `Load allowance` adjustment alongside the daily record, all-or-nothing.

The story's own scope notes carry two human-confirmed facts that bind this
decision: the commission base is **whole-shop gross, not the staff member's own
sales** (so several staff on the same date get the same suggestion), and the
load allowance amount is **typed every time** — there is no per-staff or global
default amount.

### Ground truth in the repo today

- `StaffMember` (`apps/api/prisma/schema.prisma:132`) is the roster identity per
  ADR 0003: `displayName`, `isActive`, nullable `locationId`, optional `userId`.
  It carries no monetary column.
- `StaffCompensationEntry` is one mutable row per `(staffMemberId, workDate)`
  with administrator-typed `salaryCents` and `commissionCents`, both `>= 0`
  (ADR 0013 §2).
- `StaffCompensationAdjustment` carries `kind` (`ADVANCE | ALLOWANCE | BONUS`),
  `effectiveDate`, `amountCents >= 1`, and a free-text `description` stored
  verbatim, with **no unique constraint** by deliberate decision (ADR 0014 §1–§2).
  `ALLOWANCE_DESCRIPTION_PRESETS` in `packages/shared` already contains the exact
  string `'Load allowance'`.
- `apps/api/src/compensation/` owns every compensation read and write, guarded at
  class level with `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)`.
  `apps/api/src/staff/staff.controller.ts` is guarded identically.
- `apps/api/src/reporting/` is the Sales/Orders read model.
  `ReportingService.loadDailyReadModel(from, to)` produces, per trading day,
  `grossSalesCents` = Σ `sale_payments.amount_cents` for every sale on that
  `business_date`, split `CASH`/`ONLINE`, via `calculateCashReconciliation` in
  `packages/shared/src/money.ts` (ADR 0006's binding arithmetic).
- Two facts about that number were verified against the order code rather than
  assumed, and they are what make it reusable here:
  - **Parked orders carry no payment rows.** `OrdersService.park` creates the
    sale with `status: PARKED` and no `payments`; payment rows are written at
    completion. An unfinished order therefore contributes ₱0 to gross.
  - **A void is a reversing sale, not a status.** `OrderStatus` is only
    `PARKED | COMPLETED`; voiding appends a second sale with `kind: VOID`,
    `status: COMPLETED` and **negated** payment rows
    (`orders.service.ts:556-593`). Summing payments is therefore already net of
    voids.
  So `grossSalesCents` for a business date **already means** "the money taken by
  completed sales on that date, net of voids" — which is exactly what the story's
  "all completed sales for that business date" asks for. Cash tips are tracked
  separately (`cash_tip_cents` → `tipsCents`) and are not part of it.
- `apps/web/src/compensation/CompensationPage.tsx` owns the add/edit entry form
  and already parses peso text to integer cents via `currencyToCents`
  (`apps/web/src/compensation/money.ts`), rejecting negatives, non-numerics and
  more than two decimal places.

### What has to be decided rather than inferred

Four questions, three of them in the **money** high-risk area and one in
**authorization**:

1. **Where a base salary lives** — on the roster row, or in a Compensation-owned
   table. ADR 0013 §1 says Compensation *references* the roster identity and does
   not extend it; this story asks for a money column on the staff form.
2. **Whether Compensation may read Sales/Orders**, and through what seam. Both
   prior ADRs made this an explicit revisit trigger.
3. **The commission arithmetic** — the rule, where it executes, and whether the
   derived figure is ever stored or recomputed.
4. **Whether the base salary becomes visible to a `STAFF` token**, given the
   roster is read by non-admin surfaces.

---

## Decision

### 1. Base salary is a column on the roster row, owned by the `staff` module

`StaffMember` gains `baseSalaryCents` (`base_salary_cents`), a **nullable** `Int`
with a DB CHECK `base_salary_cents IS NULL OR base_salary_cents >= 0`. It is
read and written only by `apps/api/src/staff/`.

This is a narrow, deliberate qualification of ADR 0013 §1, and the grounds are
that **a base salary is not a compensation record**. ADR 0013 §1 keeps *dated
compensation facts* out of the roster; the rate a person is currently engaged at
is an attribute of the employment relationship, has no date, no audit columns and
no payslip membership. The story also places it on the staff add/edit form by
name.

The alternative — a Compensation-owned 1:1 `staff_compensation_defaults` table —
was rejected because it **inverts the dependency the prior ADRs protect**. The
staff form is the writer, so `staff` would have to write into a Compensation
table or call a Compensation service, giving Sales-adjacent roster code a
dependency on Compensation that ADR 0013 §1 forbids outright. A nullable integer
on the row it describes is the smaller cost.

Binding constraints on this column:

- **`NULL` and `0` are different values and must stay distinguishable end to
  end.** `NULL` means "no base salary" and leaves the salary field untouched;
  `0` is a real rate that prefills ₱0.00. Any DTO, mapper or form state that
  collapses one into the other breaks an acceptance criterion.
- **No rate history, and no effective-dated rate.** One current value, overwritten
  in place. Changing it cannot alter an existing daily record, which is true by
  construction under §3: nothing is derived at read time. A story asking for
  "what was this person's rate in June" needs a new ADR and a dated,
  Compensation-owned table.
- Compensation **never writes** this column and never joins to it for arithmetic.
  It is consumed only as a prefill value (§3).

### 2. Compensation may read Sales/Orders — read-only, through `ReportingService`, for one date

The one-way dependency of ADR 0013 §1 is **amended**: Compensation may depend on
the Sales/Orders read model, read-only. Sales/Orders, Catalog and Inventory still
must not depend on Compensation, and that direction is not negotiable.

The seam is a method on `ReportingService`, injected into `CompensationService`
(`CompensationModule` imports `ReportingModule`):

```
ReportingService.getDailyGrossSales(businessDate: string)
  → { hasBusinessDay: boolean; grossSalesCents: MoneyCents }
```

implemented over the existing `loadDailyReadModel(businessDate, businessDate)`.

- **Compensation must not query `sales`, `sale_payments` or `trading_days`
  directly**, and must not write its own aggregate SQL. The whole point of the
  seam is that there stays exactly one definition of a day's gross.
- **The existing definition is reused, not redefined.** Per the Context section
  it already excludes parked orders and already nets out voids. A
  compensation-specific "completed sales only" aggregate would be a second
  implementation that drifts, and would double-count voided money.
- **Cash tips are excluded** from the commission base. Gross is cash + online
  sale payments; `tipsCents` is a separate figure in the same read model and is
  not added.
- **The query is unscoped by location.** With one location and nullable
  `location_id` (ADR 0001), "the shop's gross" is every trading day on that
  date. Second branch makes this wrong — see revisit triggers.
- The read happens at **form time only**. No compensation row stores, caches or
  references a sales figure, so no invalidation exists and nothing dangles.

### 3. The commission rule — ₱50 per full ₱1,000, integer-floored, computed server-side, suggestion only

The rule is one pure function in `packages/shared/src/money.ts`:

```ts
// ₱50 (5_000 cents) per complete ₱1,000 (100_000 cents) of gross.
export function suggestCommissionCents(grossSalesCents: MoneyCents): MoneyCents {
  if (grossSalesCents <= 0) return cents(0);
  return cents(Math.floor(grossSalesCents / 100_000) * 5_000);
}
```

- Integer floor division on integer minor units. **No float money, no rounding
  rule, no proration of a partial ₱1,000** — a partial band earns nothing, which
  is what "every full ₱1,000" means and what the story's own examples assert:
  ₱2,750 → ₱100, ₱999.99 → ₱0, ₱3,000 → ₱150. Those three cases plus the band
  boundaries (₱0, ₱99,999 cents, ₱100,000 cents) are a required unit-test table.
- A negative gross is not reachable through the UI but is representable (voids
  exceeding sales on an otherwise empty day), so it is defined: clamp to ₱0.
  The suggestion is never negative, because `commissionCents >= 0` (ADR 0013 §3).
- **The function executes on the server**, and the API returns the suggestion
  (§4). The browser computes no money — ADR 0013 §3 and ADR 0014 §3 say the
  browser renders figures and never derives them, and a prefill is not an
  exception worth carving. The function lives in `packages/shared` so the
  contract and the rule are versioned together, not so the web can call it.
- **The suggestion is an input default and nothing more.** `commissionCents`
  remains an administrator-entered value persisted verbatim. It is **never**
  recomputed on read, never recomputed at payslip time, and never reconciled
  against sales afterwards. ADR 0013 §3 and ADR 0014 §3's payslip arithmetic are
  untouched by this ADR. This is what keeps the derivation a UI affordance
  rather than a second source of truth for payroll, and it is why §2's new
  dependency is acceptable at all.
- The rate (₱50 / ₱1,000) is a **named constant in `packages/shared`**, not a
  literal scattered across layers, and not configuration. It is
  human-confirmed policy; making it an admin-editable setting is a separate
  story with its own effective-dating problem.

### 4. One new admin-only read endpoint on the existing controller

```
GET /compensation/daily-gross?workDate=YYYY-MM-DD
→ 200 {
    workDate: string;
    hasBusinessDay: boolean;
    grossSalesCents: MoneyCents;
    suggestedCommissionCents: MoneyCents;
  }
```

- Added to the existing `CompensationController`, so it inherits
  `@Roles(Role.ADMIN)` and **introduces no new authorization surface**.
- **A missing business day is a `200`, not a `404`.** The story requires the form
  to render gross ₱0.00 with the message "No business day on this date" and a ₱0
  suggestion; an absent day is a valid answer about a real date, not an error.
  The response carries `hasBusinessDay: false` with both amounts `0`, and the UI
  renders the message from that flag — **not** by inferring it from a ₱0 gross,
  which is also a legitimate figure for a day that opened and sold nothing. The
  two states must stay distinguishable in the UI.
- A malformed `workDate` is a `400` with a field-level message. A future date is
  accepted and simply has no business day; the form's existing "today or earlier"
  rule on `workDate` is unchanged and remains the gate.

### 5. The load allowance is written in the same transaction as the entry, on create only

`POST /compensation/entries` accepts an optional member:

```ts
loadAllowance?: { amountCents: MoneyCents }
```

When present, the service writes **both rows inside one `prisma.$transaction`**:
the `StaffCompensationEntry`, and a `StaffCompensationAdjustment` with
`kind: ALLOWANCE`, `description` = the shared `'Load allowance'` preset constant,
`amountCents` as entered, `effectiveDate` = the entry's `workDate`, and
`locationId` denormalized from the staff member exactly as ADR 0014 §1 requires.

- **All-or-nothing is the transaction, not application ordering.** The story
  requires that neither row is recorded if either fails; two sequential writes
  with compensating cleanup is not acceptable, because the cleanup path is the
  one that will not run.
- ADR 0013 §2's duplicate rule is preserved: the `(staffMemberId, workDate)`
  unique constraint still fires on a replay, Prisma `P2002` still maps to `409
  Conflict`, and the rollback takes the allowance with it, so a refused duplicate
  entry leaves **no** orphan allowance.
- `amountCents` obeys ADR 0014 §1 unchanged: `>= 1`. Zero is refused by the same
  field-level message as any other allowance — "same amount rules as other
  allowances" in the story means literally the existing rule, not a new one.
- **`PATCH /compensation/entries/:id` does not accept `loadAllowance`** and
  rejects the member with a `400` if it is sent. The story restricts the
  checkbox to adding; the API enforces that rather than trusting the form to hide
  it. Editing an allowance after the fact is already possible through the
  adjustment routes, which is the correct path.
- **No new endpoint and no new entity.** A compound `POST
  /compensation/entries-with-allowance` would duplicate validation and add an
  authorization surface for a convenience.

### 6. The duplicate-load-allowance warning is advisory, and adds no constraint

Before saving, the form warns when a `Load allowance` already exists for that
staff member on that work date. It is sourced from the existing
`GET /compensation/adjustments?staffMemberId=&from=<workDate>&to=<workDate>`,
matching `kind: ALLOWANCE` and a trimmed, case-insensitive comparison against the
preset string.

- **Nothing changes server-side.** ADR 0014 §1's "deliberately no unique
  constraint, and no duplicate suppression in the service either" stands. Saving
  anyway creates a genuine second row, as the story requires, and the generous
  case-insensitive match is acceptable precisely because the consequence is a
  warning rather than a refusal.
- The warning is **not** a validation error: it does not block submit and does
  not clear the checkbox on the administrator's behalf.
- No new endpoint for it.

### 7. Authorization — base salary is admin-only by projection, and that is load-bearing

No new role, permission rule, session behaviour or credential handling is
introduced, and none may be introduced by the implementation. `Role` stays
`ADMIN | STAFF` (ADR 0002).

`baseSalaryCents` is exposed on exactly one read model — the `StaffMember` shape
returned by the class-level `@Roles(Role.ADMIN)` `/staff` controller. The
roster is, however, read by **non-admin** surfaces, and those reads are safe today
only because they project explicitly:

- `StaffService.listSelectable()` — `select: { id, displayName, user: { pinHash } }`
- `StockCountsService.listActiveStaff()` — `select: { id, displayName }`

**Binding requirement:** those projections must remain explicit `select` lists.
Converting either to a bare `findMany()` (or adding `include` without `select`)
would hand every staff member's salary to a `STAFF` token through a surface
nobody would think to re-review. Any new roster read reachable by a `STAFF`
token must likewise project explicitly, and a test must assert that the
staff-selectable payload has no salary field. Hiding the input in the web app is
a courtesy; the projection is the boundary.

### 8. Validation of base salary

- API contract is **integer minor units**, consistent with every other amount in
  the system. Non-integers, negatives and non-numeric values are refused with a
  field-level message naming the field; there is no coercion and no rounding.
- The "at most two decimal places" rule in the story is a **presentation-layer
  parse**, satisfied by the existing `currencyToCents` helper the compensation
  form already uses. It is not a second server rule: a value with three decimal
  places is not representable in integer cents and never reaches the API.
- Absent/cleared means `NULL`, per §1.

### 9. Contracts

In `packages/shared` (ADR 0001 §3):

- `StaffMember.baseSalaryCents: MoneyCents | null`, and the optional
  `baseSalaryCents` member on the staff create/update inputs.
- `DailyGrossSalesSuggestion` — the §4 response shape.
- `CreateStaffCompensationEntryInput.loadAllowance?: { amountCents: MoneyCents }`.
- `suggestCommissionCents()` and the commission-rate constants, in `money.ts`
  beside the existing money helpers.

Extension is additive throughout. `StaffCompensationEntry`, `PayslipSummary`,
`PayslipEntry`, every existing total field and
`GET /compensation/payslip` keep their current names, shapes and meanings — this
story adds no payslip arithmetic.

API surface after this story, all admin-only:

- `GET /compensation/daily-gross?workDate=` — new (§4).
- `POST /compensation/entries` — input extended with optional `loadAllowance` (§5).
- `PATCH /compensation/entries/:id` — unchanged, and refuses `loadAllowance`.
- `GET /staff`, `POST /staff`, `PATCH /staff/:id` — carry `baseSalaryCents` (§1).
- Everything else on `/compensation` — unchanged.

### 10. Suggestion/override behaviour is form state, not a contract

"A value the administrator has changed is not overwritten by later suggestions
unless the administrator selects a different staff member or work date" is
implemented as **per-field dirty flags in the add form**, reset when
`staffMemberId` or `workDate` changes. It is not persisted, not sent to the API,
and not represented in any shared type. This is stated here so it is not
mistaken for a missing endpoint.

---

## Consequences

**Positive**

- One definition of a day's gross, in the module that owns sales arithmetic. The
  commission suggestion cannot drift from the sales report, and voids already
  reduce it.
- Nothing derived is stored, so "changing a base salary does not change an
  existing daily record" and "a payslip reflects current records" stay true by
  construction rather than by discipline.
- No new authorization surface: both new behaviours live behind controllers that
  are already class-level `ADMIN`.
- The all-or-nothing load allowance is a database transaction, so the partial-write
  state the story forbids is not representable.
- ADR 0014's itemization stays intact — a second load allowance on a date is
  still a legal, deliberate record.

**Negative / accepted trade-offs**

- **Compensation now depends on Sales/Orders.** A context boundary that was
  one-way-by-prohibition is one-way-by-convention plus a read-only seam. Narrowed
  to a single injected read method and documented here, but it is a real
  loosening and the next request to derive pay from sales will arrive citing it.
- **A money column sits on the roster table.** `staff_members` is no longer
  purely identity. Accepted as the lesser evil against inverting the dependency,
  but it means a reviewer must know that ADR 0013 §1 has a stated exception.
- **The commission rate is a constant, not configuration.** Changing ₱50/₱1,000
  is a code change and a deploy. Correct for a human-confirmed policy with two
  admin users; it will not survive the first "can we run a different rate in
  December."
- **The suggestion is unauditable.** Nothing records whether a stored
  `commissionCents` was the suggested figure or a typed override, so a later
  question about why a day's commission differs from the rule has no answer in
  the data. Accepted: the rule is advisory, and `updatedByUserId`/`updatedAt`
  still say who last touched the row.
- **Whole-shop gross means identical suggestions for everyone on a date**, and a
  high-sales day suggests the same commission to a person who worked one hour.
  Human-confirmed and therefore not a defect, but it is the behaviour most likely
  to be questioned once it is in use.
- **`NULL` versus `0` base salary is a subtle distinction** that is easy to flatten
  in a form, a DTO default, or a JSON round-trip, and flattening it is silent.
  Called out in §1 as a hard requirement and a required test.

**Revisit triggers**

- **A second branch opens, or commission becomes branch-scoped** → §2's
  location-unscoped gross is wrong; the query must take a `locationId` and the
  nullable-`location_id` convention of ADR 0001 is in play alongside its own
  global trigger.
- **Commission must be based on a staff member's own sales, their attendance, or
  a target** → new ADR. §2's seam returns a whole-shop figure and §3 is a single
  banded rule; per-person attribution is a different arithmetic and a much
  deeper coupling to Sales/Orders.
- **The commission rate becomes configurable, time-varying, or tiered** → new ADR
  covering where the rate lives and how a stored record is tied to the rate in
  force when it was written. §3's named constant is the thing being changed.
- **Compensation must store the derived figure, reconcile it against sales, or
  flag overrides** → new ADR. §3's "suggestion only, never recomputed" is the
  invariant that makes the rest of this decision safe.
- **Base salary needs history or effective dates** (a raise that must not
  retro-change anything, or a report of past rates) → §1 is withdrawn; the rate
  moves to a dated, Compensation-owned table and the roster column is dropped.
- **Staff self-service, or any non-admin surface that must show pay** → §7's
  projection rule is no longer sufficient; the controller-level `ADMIN` rule
  becomes an ownership rule, as ADR 0013 §6 and ADR 0014 §6 already flagged.
- **The load allowance gains a default amount, a per-staff amount, or a second
  auto-created adjustment kind** → revisit §5; the optional-member-on-create
  shape stops scaling at the second one and becomes a rule table.
