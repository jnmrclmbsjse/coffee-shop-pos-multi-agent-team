# ADR 0014: Compensation Adjustments (Advances, Allowances, Bonuses) & Payslip PNG Export

- **Status:** Proposed
- **Date:** 2026-08-22
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0013 (Compensation context, money rules,
  mutability exception, payslip-as-computation) and ADR 0001 (money in integer
  minor units, append-only convention, bounded contexts). Answers the
  ARCHITECTURE GAP the Product Owner flagged on story #346, and fires two of
  ADR 0013's own revisit triggers: *"deductions, tax, net pay, advances or
  overtime rules enter scope"* and *"a payslip becomes an artifact — persisted,
  numbered, printed, downloaded, emailed, or marked paid."*

---

## Context

Story #346 extends the compensation workflow delivered by #309 with three
things ADR 0013 deliberately deferred:

1. **Salary advances** — a monetary amount that is not an earning.
2. **Itemized allowances and bonuses** — many per staff member, each with an
   amount and a description. The description may be one of a set of starter
   choices (Load / Transportation / Calamity allowance; Performance / Spot
   bonus) or free text the administrator types. The PO states explicitly that
   the starter choices are **not a closed list**.
3. **A downloadable PNG payslip**, identifying the staff member and date range
   and carrying the same items and totals as the on-screen payslip.

Ground truth in the repo today:

- `StaffCompensationEntry` (`apps/api/prisma/schema.prisma`) is one **mutable**
  row per `(staffMemberId, workDate)` carrying `salaryCents` and
  `commissionCents`, both `>= 0` by DB CHECK, plus denormalized `locationId` and
  `createdByUserId` / `updatedByUserId`.
- `apps/api/src/compensation/` owns every compensation read and write, guarded
  at controller level by `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)`.
- `GET /compensation/payslip?staffMemberId=&from=&to=` computes `PayslipSummary`
  server-side: entries in the inclusive range plus `salaryTotalCents`,
  `commissionTotalCents`, `grandTotalCents`. No `Payslip` table exists.
- `apps/web/src/compensation/PayslipView.tsx` renders that response. The web app
  has no rasterization dependency today; the API container has no headless
  browser and, per ADR 0009, runs on a single EC2 instance.

Four questions must be decided rather than inferred. Three sit in the money
high-risk area; the fourth governs whether ADR 0013 §4's mutability exception
survives.

1. **Where advances, allowances and bonuses live** relative to the one-per-day
   entry.
2. **How a custom description is stored** given the list is open-ended.
3. **Whether an advance reduces the displayed payable amount** — the PO called
   this out by name as unresolvable by inference.
4. **Whether a downloaded PNG is an issued payroll artifact**, and therefore
   whether entries covered by one must become immutable.

---

## Decision

### 1. One new table: `StaffCompensationAdjustment`, sibling to the daily entry

Advances, allowances and bonuses are **standalone dated items owned by the
Compensation context**, not columns on `StaffCompensationEntry` and not child
rows of it.

They are not columns because allowances and bonuses are *itemized*: an
administrator may record several on the same date, each with its own
description. They are not children of the daily entry because that would force a
salary/commission row to exist before an advance could be recorded, and an
advance on a non-working date is legitimate.

`StaffCompensationAdjustment` (`staff_compensation_adjustments`):

- `id` — uuid, pk.
- `staffMemberId` — required FK to `StaffMember`, `onDelete: Restrict`,
  matching every other `StaffMember` relation in the schema.
- `kind` — Prisma enum `CompensationAdjustmentKind` = `ADVANCE | ALLOWANCE |
  BONUS`, backed by a Postgres enum type. Three kinds with different signs and
  different payslip placement are a closed domain set and belong in the type
  system, unlike descriptions (§2).
- `effectiveDate` — `DateTime @db.Date`. A plain calendar date with exactly the
  semantics ADR 0013 §2 gave `workDate`: an HR/administrative date, deliberately
  **not** the ADR 0004 trading day. This is the date that decides payslip range
  membership.
- `amountCents` — `Int`, **`>= 1`** by DB CHECK. Always stored as a positive
  magnitude regardless of kind; sign is a property of the *kind*, applied by the
  arithmetic in §3, never of the stored number. A zero-amount allowance is not a
  record worth keeping, and a negative one is refused by the story's criteria.
- `description` — `String`, required and non-empty for every kind (see §2).
- `locationId` — nullable, denormalized from the staff member at write time, per
  ADR 0001 branch-readiness and identically to ADR 0013 §2. It may intentionally
  disagree with `StaffMember.locationId` after a transfer.
- `createdByUserId` / `updatedByUserId` — FKs to `User`, as ADR 0013 §4 requires
  for the audit trail that substitutes for immutability.
- `createdAt` / `updatedAt`.
- `@@index([staffMemberId, effectiveDate])`.

**There is deliberately no unique constraint.** ADR 0013 §2 made
`(staffMemberId, workDate)` unique because a second salary figure for one day is
a duplicate. Here the opposite is true: two ₱200 transportation allowances on the
same date are two real items, and the story asks for "one or more". Duplicate
suppression must not be reintroduced in the service either.

Compensation's one-way dependency on the roster (ADR 0013 §1) is unchanged. No
other context may read this table.

### 2. Descriptions are stored verbatim as free text; presets are UI constants

`description` is a plain string, stored **exactly as the administrator committed
it** apart from trimming leading and trailing whitespace. It is never mapped to
an enum, normalized in case, title-cased, or replaced by a code.

The five starter choices (Load allowance, Transportation allowance, Calamity
allowance, Performance bonus, Spot bonus) are **presentation constants exported
from `packages/shared`**, so both apps agree on the wording, and are applied by
prefilling the description field. Choosing a preset and typing the same words by
hand must produce byte-identical rows — the server cannot and must not tell them
apart.

Validation: after trimming, `description` must be non-empty and at most 120
characters; empty or whitespace-only is a field-level 400. Storing a code with a
free-text escape hatch column was rejected: the list is explicitly open, so the
"other" path is the general case and a code column would only add a second way
to represent the same string.

### 3. Money — advances are the one deduction, and they reduce the payable total

This is the rule the PO flagged as requiring a decision.

**A salary advance reduces the displayed payable amount, on the payslip whose
date range contains the advance's `effectiveDate`, and nowhere else.**

Payslip arithmetic becomes, all in integer minor units, all summed server-side:

```
allowanceTotalCents = Σ amountCents where kind = ALLOWANCE
bonusTotalCents     = Σ amountCents where kind = BONUS
advanceTotalCents   = Σ amountCents where kind = ADVANCE

earningsTotalCents  = salaryTotalCents + commissionTotalCents
                    + allowanceTotalCents + bonusTotalCents

netPayableCents     = earningsTotalCents - advanceTotalCents
```

Binding rules:

- `grandTotalCents` **keeps its current meaning** — salary + commission only —
  and is retained in `PayslipSummary` so the existing contract is not silently
  redefined under existing consumers. `earningsTotalCents` is the new all-inclusive
  gross. Reusing the old field name for a new number would be the worst
  available option.
- Allowances and bonuses are **earnings**; they sit with salary and commission
  above the line. Advances are **not** earnings and are never folded into
  `earningsTotalCents`.
- `netPayableCents` **may be negative** when advances in range exceed earnings in
  range. It is returned and displayed as a negative amount and is **never clamped
  to zero**, never carried into another range, and never triggers an automatic
  balance. Clamping would silently destroy the information the administrator
  needs.
- No installment schedule, repayment tracking, outstanding-balance ledger,
  approval or disbursement state is introduced. An advance row is a dated amount
  and nothing else; the PO left the lifecycle undefined and this ADR does not
  invent one. There is no "repaid" flag — recording a repayment is not
  representable in v1 and any story asking for it needs a new ADR.
- **Advances remain the only deduction.** No tax, statutory contribution,
  benefit or overtime arithmetic enters the system. ADR 0013 §3's prohibition
  otherwise stands; this ADR narrows it by exactly one kind.
- All arithmetic stays server-side integer summation. The browser renders the
  numbers the API returned and computes none of them — this is what keeps
  "a newly generated payslip reflects current records" true by construction,
  and it extends unchanged to the PNG (§4).
- Every amount input is validated as an integer count of minor units: negatives,
  non-integers (fractions below the smallest unit), missing and non-numeric
  values are refused with a field-level message and no coercion or rounding.

### 4. A downloaded PNG is an **export**, not an issued artifact — the ADR 0013 §4 exception survives

ADR 0013 §4 said its mutability exception "ends the moment a payslip becomes an
artifact," listing *downloaded* among the triggers. Having examined what #346
actually asks for, the decision is that **this download does not make the
payslip an issued artifact, and compensation records stay mutable and
deletable.**

The trigger's purpose was to protect a payslip that a business has *committed
to*: numbered, retained, and relied upon as the record of what was paid. The PNG
here is none of those things. It is not persisted server-side, has no payslip
number, no issued/paid state, is not delivered to the employee through the
system, and — by the story's own criteria — must be **regenerable at any time
and must reflect the records as they stand at that moment**. It is a screenshot
of a computed read model in a shareable container, produced so an administrator
can send a summary over chat. Locking a month of payroll because someone
downloaded a preview would be a real cost paid for no gain.

Consequently:

- **No `Payslip` table, still.** ADR 0013 §5 stands: a payslip is a computation.
- **No period locking, no immutability window, no append-only adjustment rows.**
  Entries and adjustments are edited in place and hard-deleted, with
  `createdByUserId` / `updatedByUserId` / `updatedAt` as the audit trail.
- **No server-side artifact storage.** Nothing is written to disk or S3, no
  download is recorded.

The accepted risk is that a circulating PNG can disagree with current records.
It is mitigated in the artifact itself rather than by locking data: **every
generated PNG must embed the staff member's display name, the inclusive
`from`–`to` range, every item with its description and amount, all totals
including `netPayableCents`, and a "Generated <timestamp>" line.** A stale file
is then self-evidently a snapshot of a moment, not an authority. The timestamp
line is a hard requirement of this decision, not a design flourish.

### 5. Rendering — client-side rasterization in `apps/web`, no new endpoint

The PNG is produced in the browser by rasterizing the already-rendered payslip
DOM node (a DOM-to-image library added to `apps/web` only), then triggering a
download.

- **No headless browser in the API.** Adding Chromium to the API image for one
  download would materially grow the deployment footprint of a single-EC2
  deployment (ADR 0009) and introduce a process-management and font-availability
  problem, for a feature two admins use occasionally.
- **No new API route**, therefore no new authorization surface. The PNG is
  generated inside the existing admin-only route from the existing admin-only
  `GET /compensation/payslip` response.
- **One arithmetic implementation.** The rasterized DOM shows exactly the
  server-computed totals; the export path cannot drift from the screen because it
  *is* the screen.
- Filename is deterministic:
  `payslip-<staff-display-name-slug>-<from>-<to>.png`.
- Download is offered only after a successful generation. The empty-range case
  (ADR 0013 §5: 200 with zero entries) must not offer a download of an empty
  payslip.

### 6. Authorization — unchanged, and no new mechanism

All adjustment routes are added to the existing `CompensationController`, which
is guarded at class level with `@Roles(Role.ADMIN)`. A `STAFF` token receives
`403` on every compensation route — list, create, update, delete, payslip — and
the PNG, having no endpoint of its own, is unreachable without first getting a
`200` from an admin-only API. Hiding the navigation entry is a courtesy; the API
is the boundary. No new role, permission rule, session behaviour or credential
handling is introduced by this story, and none may be introduced by its
implementation.

### 7. Contracts

New and extended types live in `packages/shared` (ADR 0001 §3):
`CompensationAdjustmentKind`, `StaffCompensationAdjustment`, its create/update
inputs, the preset description constants (§2), and `PayslipSummary` extended with
`adjustments`, `allowanceTotalCents`, `bonusTotalCents`, `advanceTotalCents`,
`earningsTotalCents` and `netPayableCents`. Extension is additive; `entries`,
`salaryTotalCents`, `commissionTotalCents` and `grandTotalCents` keep their
current names and meanings.

API surface, all on `/compensation` and all admin-only:

- `GET /compensation/adjustments?staffMemberId=&from=&to=`
- `POST /compensation/adjustments`
- `PATCH /compensation/adjustments/:id`
- `DELETE /compensation/adjustments/:id`
- `GET /compensation/payslip` — signature unchanged, response extended.

---

## Consequences

**Positive**

- Itemization is native: many adjustments per staff member per date, each with
  its own description, with no unique constraint to fight.
- The advance rule is stated once, server-side, and the PNG inherits it for free
  because the export rasterizes the rendered server figures.
- Descriptions round-trip byte-exactly, which is what the story's "kept exactly
  and shown again" criterion actually demands.
- Keeping the payslip a computation preserves ADR 0013's option to introduce a
  real issued-payslip entity later without unwinding a half-built one.
- The API container's deployment footprint is unchanged.

**Negative / accepted trade-offs**

- **A downloaded PNG can be stale.** Accepted deliberately, mitigated by the
  mandatory embedded timestamp and range. If this file ever becomes the record
  of what was paid, this decision must be revisited — see triggers.
- **Net pay can be negative** and the system offers no way to say an advance was
  repaid. This is honest about what was recorded, but it means an advance keeps
  depressing the net figure for its own date range forever. Repayment is out of
  scope by the PO's own note.
- **Client-side rasterization is fidelity-sensitive**: web fonts, colour
  functions and CSS the library does not implement can render differently from
  the screen. The PNG's correctness must be asserted on content (name, range,
  items, totals) rather than on pixel equality, and QA should compare at native
  size — downscaled canvas comparison measures the resampler, not the artwork.
- **Compensation history remains destructible**, now including advances. Same
  posture and same rationale as ADR 0013's accepted trade-off: two trusted admin
  users, an internal tool, and no issued artifact.
- `grandTotalCents` and `earningsTotalCents` coexisting is a mild contract wart.
  Accepted as strictly better than redefining a shipped field's meaning in place.

**Revisit triggers**

- **A payslip is numbered, persisted server-side, emailed, marked paid, or
  otherwise treated as the record of a payment** → §4 is withdrawn: entries and
  adjustments covered by an issued payslip become immutable and corrections
  become append-only adjustment rows per ADR 0001 §4.
- **Advance repayment, installments, outstanding balances or carry-over between
  periods enter scope** → new ADR; §3's "a dated amount and nothing else" is the
  thing being changed.
- **Tax, statutory contributions, benefits or overtime enter scope** → new ADR
  covering that arithmetic. §3 permits exactly one deduction kind.
- **Staff self-service access to their own payslip** → revisit §6, as ADR 0013
  already flagged; the controller-level ADMIN rule becomes an ownership rule.
- **A PNG or PDF must be produced without a browser** (scheduled email, bulk
  export) → revisit §5; server-side rendering becomes a deployment decision.
- **Compensation derived from sales, attendance or targets** → revisit the
  one-way context dependency in ADR 0013 §1.
