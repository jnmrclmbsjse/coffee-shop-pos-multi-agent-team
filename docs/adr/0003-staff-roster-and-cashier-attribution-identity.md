# ADR 0003: Staff Roster & Cashier-Attribution Identity

- **Status:** Proposed
- **Date:** 2026-07-25
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0001 (domain contexts) and ADR 0002
  (staff authentication). ADR 0002 defined the staff **auth account** (`User`,
  role `STAFF`) and anticipated a follow-up *account & PIN management* story.
  This ADR decides a different, adjacent question raised by story #67: who owns
  the **roster of staff that a sale is attributed to**, and how it relates to
  the auth account.

---

## Context

Story #67 ("Manage the staff roster for cashier attribution") asks for a
back-office capability to manage a list of staff by **name** and **active
status** only. It explicitly **excludes** usernames, passwords, PINs,
permissions, schedules, and contact details, and it lets the owner **add a
staff member with only a name** (active by default). The story flags an
architecture gap: ADR 0001 names Catalog, Inventory, and Sales/Orders but no
staff-identity context, and ADR 0002's `User` is an auth account, not obviously
the same thing as "a person a sale is credited to." The PO delegated ownership
of this decision to the Technical Lead.

Two facts constrain the decision:

1. **The auth `User` cannot absorb the roster cleanly.** In the current schema
   `User.username` and `User.passwordHash` are **both required**. The roster's
   add-flow creates name-only records with no credentials. Forcing those into
   `User` means either making core auth columns nullable or minting placeholder
   credentials — both weaken the auth model ADR 0002 just established, and
   produce rows that cannot sign in yet sit in the authentication table.

2. **Cashier attribution is a Sales/Orders concern, not an auth concern.**
   Crediting a sale to a person does not require that person to have a login.
   ADR 0001's binding discipline is to keep bounded contexts distinct and not
   conflate identities. There is currently **no** attribution field on `Sale`,
   and #67 confirms the actual attribution-recording workflow is a separate,
   not-yet-authored Sales/Orders story. #67 delivers only the roster.

## Decision

### Ownership — a distinct Staff roster identity

Introduce the staff roster as its **own reference entity, distinct from the
auth `User`**. Add a Prisma model (`StaffMember`) and a new NestJS `staff`
module in `apps/api`:

- `id` (uuid, pk)
- `displayName` (the managed name; required)
- `isActive` (boolean, default `true`)
- `location_id` (nullable, per ADR 0001 branch-readiness convention)
- `createdAt` / `updatedAt`

This is the canonical answer to "who can a sale be attributed to." It is
**not** an authentication account and does **not** extend the `User` model.
`User` (role `STAFF`) remains exactly as ADR 0002 defined it and is untouched
by #67.

### Relationship to the auth account (ADR 0002)

The roster (`StaffMember`) and the auth account (`User`) are **decoupled** in
v1. A staff person may exist on the roster without ever having a login, and the
seed-provisioned staff accounts of ADR 0002 exist without (yet) being linked to
a roster row. A future story **may** add an *optional* link between a `User`
and a `StaffMember` so that a signed-in staff account resolves to a roster
person for attribution — that link is **explicitly out of scope for #67** and
must not gate it. We deliberately avoid force-merging the two notions now;
merging later (if it proves necessary) is cheaper than splitting a wrongly
merged identity.

### Access

Roster management is an owner/back-office capability. Reuse the existing
`RolesGuard` + `@Roles(ADMIN)` from ADR 0002 — **no new role or permission
rule** is introduced. The endpoints live behind the same admin session model as
the rest of the back office.

### Retention & historical integrity (append-only-friendly)

`StaffMember` records are **never hard-deleted**. "Deactivate" sets
`isActive = false`; the record remains queryable, filterable, and
reactivatable. "Rename" updates `displayName` in place.

To satisfy #67's requirement that deactivating or renaming a staff member does
**not** rewrite existing historical cashier attribution, this ADR establishes a
**forward obligation on the future Sales/Orders attribution story**: a sale
must reference the immutable `StaffMember.id` **and snapshot the attributed
display name onto the sale at write time** — mirroring the existing
`productNameSnapshot` / `variantNameSnapshot` pattern on `SaleLine`. Because #67
introduces no attribution records itself, this requirement is structurally
satisfied today (nothing references staff yet); recording it here ensures the
sales story inherits the constraint rather than rediscovering it.

### Scope guard

Fields are limited to name + active status (+ nullable `location_id`). No
credentials, permissions, schedules, or contact details — consistent with #67's
scope notes and ADR 0001 v1 non-goals. Any request to add those is a new story
for the PO.

## Consequences

- **Positive:** the auth model from ADR 0002 is untouched; no credential-less
  rows pollute the auth table; bounded contexts stay distinct per ADR 0001; the
  roster can be delivered now without waiting on the attribution workflow; the
  snapshot obligation keeps historical sales honest under the append-only ethos.
- **Accepted trade-offs:** two staff-adjacent entities (`User` for sign-in,
  `StaffMember` for attribution) exist without a link in v1. Until the linking
  story lands, "the staff who can sign in" and "the staff a sale can be credited
  to" are maintained independently. Accepted: the alternative (a premature
  merge) is the more expensive mistake to unwind.
- **Follow-ups:** (1) Sales/Orders attribution story — adds
  `cashierStaffMemberId` + display-name snapshot to `Sale`; (2) optional
  `User`↔`StaffMember` link story; (3) ADR 0002's separate account & PIN
  management story is unaffected by this decision.

## Revisit triggers

- The attribution workflow story is authored → add the `Sale` attribution field
  and its display-name snapshot per the forward obligation above.
- A hard requirement emerges that every attributable person is exactly one
  auth account (1:1) → revisit whether `User` and `StaffMember` should be linked
  or merged.
- Staff must be assigned per branch beyond nullable scoping → revisit
  `location_id` on `StaffMember` alongside ADR 0001's location revisit trigger.
