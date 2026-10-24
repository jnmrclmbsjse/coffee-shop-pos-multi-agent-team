# ADR 0020: Personal Commission Rates, Employment Details & the Weekly Staff Schedule

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0017 (base salary, commission
  suggestion), ADR 0013 / 0014 (Compensation context, payslip arithmetic,
  mutability exception), ADR 0003 (staff roster identity) and ADR 0001 (money,
  `location_id`, append-only, bounded contexts). **Fires two ADR 0017 revisit
  triggers by name:** *"the commission rate becomes configurable, time-varying,
  or tiered"* and *"base salary needs history or effective dates"* — the second
  in spirit only: it is the commission rate, not the base salary, that gains
  history here, and §1 does **not** move base salary.

---

## Context

One story carries three human-requested capabilities, delivered in one PR:

1. **Personal commission.** One staff member got a raise. On top of the shop
   rate (₱50 per full ₱1,000 of whole-shop gross, ADR 0017 §3) she earns an
   extra **₱20 per full ₱1,000 of the same whole-shop gross**, for her only.
   The administrator must be able to set that rate per staff member, see a
   suggested amount on the daily record form, and override it, exactly as the
   shop commission works today.
2. **Employment details.** Start date, training / probation / review /
   regularization dates, employment type, separation, personal and
   government-ID fields, a history of employment-type changes, and
   **administrator-defined custom fields**.
3. **A weekly staff schedule.** Sunday-to-Saturday weeks, this week and next
   week editable, one shift per person per day with their own start and end
   time, a per-day event note, a warning on an unstaffed day, and a
   copy-to-Messenger message per day.

Human-confirmed facts that bind this decision (story Scope Notes):

- The shop commission is **shared by hand** today when several staff work one
  day. **Automatic splitting is out of scope** and deferred to a later story.
  The shop commission suggestion is therefore unchanged by this ADR.
- The personal rate is **not shared**; it applies to the whole-shop gross.
- A staff member with **no** personal rate earns **₱0** personal commission.
- The rate needs **history**: a back-entered daily record must use the rate in
  force on its work date.
- The daily record list shows totals only; the daily record **form** and the
  **payslip** show the personal commission and its rate.
- Employment type does **not** change pay. Employment details and the schedule
  are **administrator-only**. One location for now.

Four things must be decided rather than inferred. Two are in the **money**
high-risk area, one is **sensitive personal data**, and one is a **new bounded
context**.

---

## Decision

### 1. Personal commission rate — a dated, Compensation-owned table

New model `StaffCommissionRate` (`staff_commission_rates`):

- `id` uuid pk; `staffMemberId` FK → `StaffMember`, `onDelete: Restrict`.
- `effectiveFrom` — `DateTime @db.Date`, a plain calendar date (same semantic
  as `workDate`, ADR 0013 §2; **not** the ADR 0004 trading day).
- `ratePerBandCents` — `Int`, DB CHECK `>= 0`. The amount earned per full
  `COMMISSION_GROSS_BAND_CENTS` (₱1,000). `0` is a real value and is how an
  administrator **ends** a personal rate from a date.
- `locationId` nullable, denormalized from the staff member at write time
  (ADR 0001 / ADR 0013 §2).
- `createdByUserId` FK → `User`; `createdAt`.
- `@@unique([staffMemberId, effectiveFrom])`.

**The rate in force on date D** is the row with the greatest
`effectiveFrom <= D` for that staff member. No row → no personal rate → ₱0.

Ownership: **Compensation**, not the roster. ADR 0017 §1 put base salary on
`StaffMember` because it has no date; its own revisit trigger says a rate with
history belongs in a dated, Compensation-owned table. That is this table. The
staff **page** in the web app may call Compensation endpoints; the API
dependency direction (Compensation → roster, one-way) is unchanged.

Writes: `POST` creates a row; posting the same `(staffMemberId, effectiveFrom)`
**replaces** that row's rate (upsert on the unique key — same pattern as
`JournalSuggestionRate`). `DELETE` removes a row. Back-dated and future
`effectiveFrom` are both allowed. This is the same narrow mutability exception
as ADR 0013 §4, on the same grounds: nothing references a rate row, because
daily records store **amounts**, never a rate id (§2).

### 2. Personal commission on the daily record — a separate stored amount

`StaffCompensationEntry` gains `personalCommissionCents`
(`personal_commission_cents`), `Int NOT NULL DEFAULT 0`, DB CHECK `>= 0`.
The migration default makes every existing row `0`.

Arithmetic, one pure function in `packages/shared/src/money.ts` beside
`suggestCommissionCents`:

```ts
export function suggestPersonalCommissionCents(
  grossSalesCents: MoneyCents,
  ratePerBandCents: MoneyCents | null,
): MoneyCents {
  if (ratePerBandCents === null || grossSalesCents <= 0) return cents(0);
  return cents(Math.floor(grossSalesCents / COMMISSION_GROSS_BAND_CENTS) * ratePerBandCents);
}
```

Required unit-test table: gross ₱1,000 / rate ₱20 → ₱20; ₱2,750 / ₱20 → ₱40;
₱999.99 / ₱20 → ₱0; rate `null` → ₱0; rate `0` → ₱0; gross negative → ₱0.

Binding rules, all carried over from ADR 0017 §3:

- **Server-side.** `GET /compensation/daily-gross` gains an optional
  `staffMemberId`. With it, the response adds `personalCommissionRateCents`
  (`MoneyCents | null`, the rate in force on `workDate`) and
  `suggestedPersonalCommissionCents`. Without it, both are `null` / `0`.
  Existing fields keep their meaning.
- **Suggestion only.** `personalCommissionCents` is administrator-entered and
  stored verbatim. It is never recomputed on read, at payslip time, or when a
  rate row changes. Changing or deleting a rate never changes a saved record.
- **No snapshot of the rate on the entry.** The rate is a lookup (§3), the
  amount is the fact.
- The shop commission (`commissionCents`, `suggestCommissionCents`) is
  **unchanged**. No splitting by headcount. ₱50 stays a code constant.

Totals — personal commission is an earning from the daily record:

- `dailyTotalCents = salaryCents + commissionCents + personalCommissionCents`.
- `PayslipSummary` gains `personalCommissionTotalCents`.
- `grandTotalCents = salaryTotal + commissionTotal + personalCommissionTotal`.
- `earningsTotalCents = grandTotalCents + allowanceTotal + bonusTotal` (formula
  unchanged in shape); `netPayableCents` unchanged in shape.

This **widens** `dailyTotalCents` and `grandTotalCents`. ADR 0014 §3 forbids
silently redefining a total, and this is not silent: both fields keep their
documented meaning — "the total of the daily record amounts" — and that set of
amounts gained a member. Every existing row has `personalCommissionCents = 0`,
so no existing value changes. The web does not read `grandTotalCents`
(verified); `dailyTotalCents` is rendered as "Daily total", which the human
confirmed must include it.

Create / update contracts: `personalCommissionCents` is **optional** on
`POST /compensation/entries` (absent → `0`) and on
`PATCH /compensation/entries/:id` (absent → unchanged). Same validation as
`commissionCents`: integer, `>= 0`, field-level 400.

### 3. The rate on the payslip

`PayslipSummary` gains:

```ts
personalCommissionRates: Array<{ effectiveFrom: string; ratePerBandCents: MoneyCents }>;
```

— every rate **in force at any point** in `[from, to]`: the row in force on
`from` (if any) plus every row with `from < effectiveFrom <= to`, ascending.
The payslip shows a **Personal commission** earnings line with
`personalCommissionTotalCents` and the rate(s) as metadata, for example
"₱20 per ₱1,000" or "₱20 per ₱1,000 to 31 Oct · ₱25 per ₱1,000 from 1 Nov".
The line and its totals row are hidden when the total is `0` (the same rule the
payslip already applies to Commission). The PNG export carries the same line.

The rate shown is the **rate in force**, not a proof of the amount: an
administrator may have overridden the amount. Accepted (see Consequences).

### 4. Employment details — roster-owned HR data in new tables

Employment details are attributes of the **employment relationship**, the same
ground ADR 0017 §1 used for base salary. They live in the **`staff` module**,
not Compensation, and not in a new context. Nothing in Sales/Orders, Catalog,
Inventory or Compensation may read them. Employment type does not drive pay.

`StaffEmploymentProfile` (`staff_employment_profiles`), 1:1 with
`StaffMember` (`staffMemberId` unique FK, `onDelete: Restrict`), every field
nullable and administrator-typed (no date is calculated from another):

- Dates (`@db.Date`): `startDate`, `trainingEndDate`, `probationEndDate`,
  `thirdMonthReviewDate`, `regularizationDate`, `endDate`, `birthDate`.
- `employmentType` — Prisma enum `EmploymentType` =
  `REGULAR | PROBATIONARY | TRAINEE | PART_TIME`.
- `separationReason` — Prisma enum `SeparationReason` = `RESIGNED | TERMINATED`;
  required when `endDate` is set, refused (400) when it is not.
- Text: `contactNumber`, `emergencyContactName`, `emergencyContactNumber`
  (each ≤ 80 chars, trimmed).
- Government IDs (§5): `sssNumber`, `philhealthNumber`, `pagibigNumber`,
  `tinNumber`.
- `locationId` nullable (denormalized), `updatedByUserId`, `createdAt`,
  `updatedAt`.

The profile row is created on first save (`PUT`-style upsert). It is mutable in
place: it is administrator-maintained reference data, not an event record.

**Employment-type history is append-only.** `StaffEmploymentTypeChange`
(`staff_employment_type_changes`): `id`, `staffMemberId`, `employmentType`,
`effectiveDate @db.Date`, `changedByUserId`, `createdAt`. When a save changes
`employmentType` (including the first time it is set), the service writes one
row **in the same transaction** as the profile update, with the effective date
the administrator entered (default today, Asia/Manila). A save that does not
change the type writes no row. Rows are never edited or deleted; a mistake is
corrected by a new change, per ADR 0001 §4. Clearing the type is not allowed
once set (the history would have no value to record).

### 5. Government ID numbers — sensitive, masked by default, never listed

SSS, PhilHealth, Pag-IBIG and TIN numbers are sensitive personal data. They are
not credentials or secrets, so no new secret-handling mechanism is introduced,
but these rules bind:

- **Normalized and validated.** Input may contain spaces and dashes; the server
  stores digits only and refuses a wrong length with a field-level 400:
  SSS 10, PhilHealth 12, Pag-IBIG 12, TIN 9 to 13 digits.
- **Masked by default.** `GET /staff/:id/employment` returns each ID as
  `{ isSet: boolean; last4: string | null }`, never the full number.
- **Full value only on an explicit request.** `GET /staff/:id/employment/government-ids`
  returns the full numbers. The web calls it only when the administrator
  presses **Show** and does not cache the result after the dialog closes.
- **Never in a list.** `GET /staff`, `GET /staff/selectable`, every roster
  read reachable by a `STAFF` token, and every log line exclude them. ADR 0017
  §7's explicit-`select` rule applies, and a test asserts the staff list
  payload has no employment field.
- No application-level encryption in v1 (see revisit triggers).

### 6. Custom employment fields — administrator-defined, typed, archivable

`StaffCustomFieldDefinition` (`staff_custom_field_definitions`): `id`, `label`
(trimmed, 1–60 chars, unique case-insensitive among non-archived definitions),
`fieldType` enum `TEXT | DATE | NUMBER | CHOICE`, `choices String[]` (CHOICE
only, 1–30 non-empty unique options), `sortOrder Int`, `isArchived Boolean`,
`createdAt`, `updatedAt`.

`StaffCustomFieldValue` (`staff_custom_field_values`): `id`, `staffMemberId`,
`definitionId`, `value String` (canonical text), `updatedByUserId`, `updatedAt`;
`@@unique([staffMemberId, definitionId])`.

- One `value` column, validated by `fieldType` on write: TEXT ≤ 500 chars;
  DATE `YYYY-MM-DD`; NUMBER a decimal string (`^-?\d+(\.\d+)?$`, never used
  for money); CHOICE one of the current `choices`. An empty value deletes the
  value row.
- **`fieldType` cannot change** once any value exists (409).
- **Definitions are archived, never deleted.** Archiving hides the field from
  the form; existing values are kept and come back if it is restored.
- Removing a CHOICE option is allowed; a stored value no longer in `choices` is
  still returned and displayed, marked as a removed option, until changed.
- Custom fields apply to **all** staff. No per-type or per-person field sets.

### 7. Scheduling — a new, small bounded context

A new NestJS module `apps/api/src/scheduling/`, admin-only at controller level
(`@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)`). It depends on the
roster only. **Compensation must not read it** — staff-on-duty as a commission
input is the deferred split story and needs its own decision.

Storage, all with nullable `locationId`:

- `ScheduleWeek` (`schedule_weeks`): `id`, `weekStartDate @db.Date` (must be a
  Sunday, CHECK `EXTRACT(DOW FROM week_start_date) = 0`), `locationId`,
  `updatedByUserId`, `createdAt`, `updatedAt`. Uniqueness on
  `(location_id, week_start_date)` is a raw-SQL index with
  **`NULLS NOT DISTINCT`** (the `trading_days` precedent): a plain Prisma
  `@@unique` would let two null-location rows for one week coexist.
- `ScheduleShift` (`schedule_shifts`): `id`, `weekId` FK (cascade with the
  week), `shiftDate @db.Date`, `staffMemberId` FK (`Restrict`),
  `startMinute Int`, `endMinute Int` (minutes after midnight, Asia/Manila
  wall clock), CHECK `0 <= start_minute < end_minute <= 1440`,
  `@@unique([weekId, shiftDate, staffMemberId])` — **one shift per person per
  day is a database invariant**.
- `ScheduleDayNote` (`schedule_day_notes`): `weekId`, `noteDate`,
  `eventNote` (trimmed, 1–200 chars), `@@unique([weekId, noteDate])`.

No overnight shifts: `end > start` on the same day.

**The repeating pattern is derived, not copied by a job.** The schedule in
force for week W is: the saved `ScheduleWeek` for W if one exists, otherwise
the most recent saved week **before** W, mapped onto W's dates by weekday.
Event notes are **not** carried forward (an event is about a date). Derived
shifts for a staff member who is now inactive are dropped. `GET` returns
`source: 'SAVED' | 'COPIED' | 'EMPTY'` and, for `COPIED`, the source
`weekStartDate`. Nothing is written by a `GET`.

**Edit window.** Only the current week (the Sunday on or before today,
Asia/Manila) and the next week can be saved. `PUT /scheduling/weeks/:weekStart`
replaces the whole week (shifts + notes) in one transaction. Any other week is
read-only (403 `SCHEDULE_WEEK_READ_ONLY`). Past weeks are therefore kept as
history without any copy step: a saved past week is immutable, and an unsaved
past week resolves to the saved week that was in force.

**Messenger text is a pure function** in `packages/shared/src/schedule.ts`
(`formatScheduleDayMessage`), so the web renders and copies it and a unit test
pins the format:

```
📅 Sunday, 26 Oct 2026
🎉 Event: Birthday booking 3–6 PM
On duty:
• Anna: 7:00 AM – 3:00 PM
• Ben: 12:00 PM – 9:00 PM
Day off: Carla, Dan
```

Rules: the event line only when a note exists; on-duty sorted by start time
then name; "On duty: none" when empty; "Day off" lists **active** staff with no
shift, by name, and the line reads "Day off: none" when everyone works.

### 8. Contracts and authorization

All new shapes in `packages/shared` (ADR 0001 §3). No new role, permission
rule, session behaviour or credential handling. Every new route sits behind a
controller that is class-level `@Roles(Role.ADMIN)`; a `STAFF` token gets 403
on each, and tests assert it per verb.

---

## Consequences

**Positive**

- A raise is a dated row: back-entered records get the right suggestion, and no
  saved record changes when a rate changes.
- The shop commission and its arithmetic are untouched; every existing daily
  record and payslip value is unchanged by the migration.
- One shift per person per day and the Sunday week start are DB invariants.
- The repeating schedule needs no cron and no copy step, and history falls out
  of the edit window.

**Negative / accepted trade-offs**

- `dailyTotalCents` and `grandTotalCents` widen (§2). Correct by meaning, and
  zero-impact on existing data, but a consumer reading the old definition must
  learn it.
- The payslip rate is the rate **in force**, not the rate used: an overridden
  amount will not match `rate × bands`. Accepted; the amount is the fact.
- Government IDs are stored in plain text in the database. Masking and the
  reveal endpoint limit exposure in the UI and API only.
- A generic one-column custom-field value is weakly typed in the database;
  validation lives in the service.
- One PR across three areas is a large review. Accepted by the human.

**Revisit triggers**

- **The shop commission is split by staff on duty** → new ADR; decide the
  headcount source (schedule versus daily records), rounding, and whether
  Compensation may read Scheduling.
- **The shop rate becomes configurable** → move ₱50 into a dated table like §1.
- **Staff can view their own schedule or details** → the class-level `ADMIN`
  rule becomes an ownership rule (ADR 0013 §6 / ADR 0017 §7).
- **Government IDs must be encrypted, audited on reveal, or exported** → new
  ADR for key handling (credentials/secrets area).
- **Overnight shifts, multiple shifts per day, or date-level full scheduling**
  → revisit §7's invariants.
- **A second branch opens** → schedule, rates and profiles are already
  `location_id`-ready; the week uniqueness key already includes it, and the
  current-week / next-week window and the "Day off" roster must become
  location-scoped.
