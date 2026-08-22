# ADR 0016: Staff Credential Rotation (Admin Password & PIN Replacement)

- **Status:** Proposed
- **Date:** 2026-08-22
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0002 (staff authentication & PIN access),
  ADR 0011 (session termination & logout) and ADR 0012 (staff account
  provisioning & default cashier). This is the **rotation** half of the
  "account & PIN management" follow-up that ADR 0002 (Follow-ups 1 and 3) named
  and that ADR 0012 §1 explicitly left out of #287. It also answers the one
  question ADR 0011 §2 deliberately left open for a future story: what a
  credential change does to sessions that are already live.

---

## Context

Story #347 asks for an administrator to replace a staff login account's
**password**, its **PIN**, or either one alone, so that a forgotten credential
has a recovery path and a compromised credential has a replacement path — both
without an ops seed change.

The ground truth in the repo today:

- `User` (`apps/api/prisma/schema.prisma`) has `passwordHash` and nullable
  `pinHash`, plus `username @unique`, `displayName`, `isActive`, `role`. There is
  **no** column recording when a credential last changed.
- `POST /staff/:id/account` (`staff.controller.ts`, `@Roles(ADMIN)`) creates an
  account: `StaffService.createAccount` hashes via
  `AuthService.hashStaffCredentials(password, pin?)` and
  `UsersService.createStaffAccount` writes the `User` and the roster link in one
  `prisma.$transaction`. **Nothing in the app ever updates a credential.**
- `StaffService.list` already exposes `hasAccount` / `accountUsername` per roster
  member; hashes never leave the API (`staffMemberAccountInclude`).
- `StaffService.listSelectable` derives `requiresPin` from `user.pinHash != null`
  — the ADR 0007 cashier PIN gate is keyed on the *presence* of a PIN.
- The PIN is consumed by three paths: `POST /auth/staff/pin` (sign-in),
  `verifyCashierPin` (ADR 0007's claim-another-cashier gate) and the
  `requiresPin` derivation above.
- `JwtAuthGuard` verifies the cookie JWT's signature and payload and **consults
  no store** (ADR 0011 §2). A token stays valid for its full 8 h regardless of
  anything that happens in the database.
- `AuthAttemptThrottleService` is an **in-memory** map keyed by
  `device:<deviceId>|user:<userId>` (or by device+identifier for unknown users),
  default 5 failures → 30 s cooldown.
- The web admin surface is `apps/web/src/staff/StaffPage.tsx` +
  `StaffAccountDialog.tsx`, talking to `apps/web/src/staff/api.ts`.

Four things must be decided rather than inferred:

1. **Where rotation lives and what "replace one, not the other" means on the
   wire** — a partial credential update has an obvious footgun (an absent field
   meaning "clear it").
2. **Whether setting a *first* PIN counts as rotation**, given ADR 0012 made the
   PIN optional at creation.
3. **What rotation does to live sessions** — PO flagged this explicitly as the
   scoping question for In Preparation. ADR 0011 §2 decided there is no
   revocation mechanism at all, so this cannot be answered by an implementation
   choice; it is an ADR-level decision either way.
4. **What rotation must provably *not* touch** — the story's AC turns identity,
   roster status, cashier attribution and privilege into explicit invariants.

## Decision

### 1. Rotation is a separate admin operation on the roster member's account

Expose `PATCH /staff/:id/account/credentials`, in the existing `staff` module,
under the module-level `@Roles(ADMIN)` guard, alongside
`POST /staff/:id/account`.

- The **roster member** stays the subject, exactly as in ADR 0012 §1 — the admin
  UI addresses people, not user rows, and there is still no admin-facing user
  list.
- It is a **separate route from `PATCH /staff/:id`**, which updates roster
  fields (`displayName`, `isActive`). Folding credentials into that DTO would
  make a single request able to change both a person's roster status and their
  password, which is precisely the coupling the story's AC forbids. Two routes
  make "updating credentials does not change name, roster status, or access
  level" a **structural** property, not a code-review promise.
- Hashing stays cross-cutting and reuses the existing argon2id path:
  `StaffService` calls `AuthService`, then a new
  `UsersService.updateStaffCredentials(...)`. No new module edge —
  `StaffModule` already imports `AuthModule` and `UsersModule`.
- `AuthService.hashStaffCredentials` currently takes `(password, pin?)` and
  always returns a `passwordHash`. Rotation needs to hash **either** field
  independently, so Dev adds the narrow hashing helper(s) it needs rather than
  bending the creation-shaped signature. Same argon2id parameters — one hashing
  policy across the app.

### 2. Absent means "leave unchanged"; at least one field is required

Request body: `{ password?: string, pin?: string }`.

- An **absent** field means *leave that credential exactly as it is*. It never
  means "clear it". PIN removal is out of scope for #347 and has no
  representation on this route at all: `null` is rejected by validation rather
  than silently interpreted. An admin who wants no PIN has no path here, and
  that is deliberate — see §7.
- A body with **neither** field is a `400` with a form-level explanation. An
  empty-object PATCH that returns 200 would read to an administrator as "the
  credentials were updated", which is the worst possible outcome for a security
  operation.
- Validation mirrors creation exactly (`staff.dto.ts`): `password` is a
  non-empty string, **not trimmed** and preserved verbatim including spaces
  (ADR 0012 §1 and #287's AC); `pin` matches `/^\d{4}$/`. Errors are
  **field-attributed** 400s, per-field, on this ADMIN-guarded route.
- No current-password confirmation is required. This is an administrator acting
  on **someone else's** account — they do not hold the current credential, which
  is the whole point of a recovery path. The authorization is the ADMIN session
  plus `RolesGuard`. (Admin **self**-service credential change is out of scope
  and would reasonably require re-authentication; see Revisit triggers.)

### 3. Rotation sets a first PIN as well as replacing one

If the account has `pinHash = null`, supplying `pin` **sets** it. This is not an
extension of the story: ADR 0012 §1 created the hole on purpose, saying the PIN
"may be set now or left for a later rotation story", and ADR 0002 Follow-up 3
assigned PIN rotation to exactly this story. Refusing the first set would leave
every account created without a PIN permanently unable to acquire one.

Two consequences Dev must handle rather than discover:

- Setting a first PIN flips `requiresPin` to `true` in
  `StaffService.listSelectable`, which **arms ADR 0007's cashier PIN gate** for
  that member. That is correct and intended, but it changes POS behaviour for a
  member who previously needed no PIN to be claimed as cashier.
- ADR 0002's device rule is untouched: PIN **sign-in** still becomes available on
  a device only after a first username+password sign-in on that device.
  Rotation does not grant PIN sign-in on a device that has never seen this
  account.

### 4. The write is one statement; a refused or failed update changes nothing

The AC "if an update is refused or fails, the existing password and PIN continue
to work unchanged" is met structurally, not by compensating logic:

1. Validate the body. 2. Hash the supplied field(s) — **before** any write, so a
hashing failure cannot leave a half-rotated account. 3. Inside one
`prisma.$transaction`, re-read the staff member and update
`user.{passwordHash?, pinHash?}` with a single `update`, writing only the keys
that were supplied.

Refusals, all leaving both credentials untouched:

| Condition | Status | Response |
| --- | --- | --- |
| Roster member does not exist | 404 | generic not-found |
| Roster member exists but has **no** linked account (`userId = null`) | 409 | "no login account", `reason: STAFF_MEMBER_HAS_NO_ACCOUNT` |
| Neither `password` nor `pin` supplied | 400 | form-level |
| Empty password, or PIN not exactly 4 digits | 400 | per-field |

The "no account" case is a **409, not a 404**, and is distinct from "member does
not exist": the story requires the administrator to be told which of the two
happened, and both are legitimate states of a real roster row.

Because both credentials live on one `User` row and are written by one
statement, "update the password without changing the PIN" is not a race — there
is no read-modify-write of the other field.

### 5. Nothing is echoed, and nothing is readable

- The response body carries **no credential material** — not the new password,
  not the new PIN, not a hash, not a masked form of either. It returns the
  updated `StaffMember` projection the admin page already renders
  (`hasAccount`, `accountUsername`, roster fields) plus a `pinSet` boolean so the
  UI can state *which* credential changed without restating its value.
- There is and will be **no read path for existing credentials**. Hashes never
  leave the API (`staffMemberAccountInclude` already enforces this on the list
  route, and this route must keep the same discipline). "Existing passwords and
  PINs are never displayed" is therefore a property of the data model, not of
  the form.
- Plaintext credentials are never logged. The web dialog holds the draft in
  component state and clears it on success/close, exactly as
  `StaffAccountDialog` already does for creation.

### 6. Rotation writes **only** `passwordHash` and/or `pinHash`

The update statement touches no other column. Specifically, rotation does not
change `username`, `displayName`, `role`, `isActive`, the `StaffMember.userId`
link, the roster member's `displayName`/`isActive`, or any `CashierSelection`
row. It cannot mint or confer ADMIN — this route never writes `role`, so the
ADR 0012 §1 privilege-separation property is preserved by construction rather
than re-argued. Previously recorded cashier attribution is historical fact and
is not revisited (ADR 0003).

### 7. Rotation does **not** terminate sessions that are already signed in

This is the scoping question PO raised, and the answer is a deliberate **no** for
v1.

> Replacing a password or PIN changes what can **start** a new session. It does
> not end sessions already established with the old credential. Those remain
> valid until logout or until the 8 h cookie/JWT lifetime expires.

Rationale: ADR 0011 §2 decided against server-side revocation — no denylist, no
token-version column, no session records — because `JwtAuthGuard` consults no
store and adding one puts a database read on the hot path of every guarded
request. Making rotation terminate sessions **requires** exactly that mechanism
(a `credentialsChangedAt`/token-version on `User`, compared against the token's
`iat` in the guard). Story #347's acceptance criteria do not ask for it: they
require that the old credential can no longer **sign in**, which the hash
replacement gives directly.

Deciding this in an ADR rather than in code matters because the gap is real and
must be visible: after rotating a **compromised** password, an attacker holding
a live session cookie keeps it for up to 8 h. The bounded mitigations available
today are (a) the ≤8 h expiry, (b) asking the staff member's device to sign out,
and (c) the fact that the cookie is httpOnly and never exposed to page
JavaScript, so holding one implies a prior host/transport compromise (ADR 0011
§2's original reasoning). Dev must state this limitation in the PR and the UI
must not claim more than it does — success copy says the new credential is
active for sign-in, not that other devices were signed out.

If "revoke on rotation" or "sign out everywhere" is wanted, it is a **separate
story that amends ADR 0011 §2**, not a silent addition here.

### 8. Rotation does not reset throttle or device state

- **Throttle:** `AuthAttemptThrottleService` buckets are in-memory and keyed by
  device+user, so a lockout in progress survives a rotation. A staff member who
  locked themselves out and is then given a new password must wait out the
  cooldown (default 30 s). At that duration this is not a recovery blocker, and
  clearing buckets across unknown devices would mean iterating the whole map on
  an admin action. Accepted as-is.
- **Device state:** `ucm.staff-auth.remembered-staff.v1` and
  `ucm.staff-auth.device-id.v1` are untouched (ADR 0011 §5). A device already
  remembering the member simply starts accepting the new PIN.
- **Cashier selection:** the device's standing `CashierSelection` is untouched.
  Rotation is not a sign-in and not a till handover.

## Consequences

- **Positive:** no schema migration — `passwordHash`/`pinHash` already exist and
  are already nullable where they need to be. One hashing policy and one
  admin-guarded surface. The separate route makes the story's "does not change
  name/status/access level" criteria structural. Single-statement write makes
  "a failure leaves both credentials working" true without rollback logic. The
  first-PIN case closes the hole ADR 0012 knowingly left open.
- **Accepted trade-offs:** (1) **No session revocation** (§7) — a live session
  established with a compromised credential survives rotation for up to 8 h;
  this is ADR 0011 §2's standing trade-off, now explicitly load-bearing for a
  security-motivated story. (2) No PIN removal and no admin self-service path,
  so an account whose PIN should be revoked entirely is still an ops fix. (3) An
  in-progress throttle lockout is not cleared by rotation (§8). (4) Setting a
  first PIN silently arms ADR 0007's cashier gate for that member (§3).
- **Follow-ups:** PO to author (a) session revocation / "sign out everywhere",
  (b) PIN removal and account deactivation/unlink (the other half of ADR 0012's
  follow-up list), and (c) staff self-service credential change.

## Revisit triggers

- Any story requires a rotation, logout or compromise response to **end other
  sessions** → ADR 0011 §2 must change first; §7 here follows it, and the guard
  gains a store lookup.
- A story requires **staff self-service** password/PIN change → revisit §2's "no
  current-password confirmation", which is only safe because the actor is an
  administrator acting on another account.
- A story requires **admin self-service** credential change → §1's
  "operation on the roster member" framing does not fit an admin without a
  roster row; revisit together with ADR 0012 §1's `role = STAFF` constant.
- A story requires **PIN removal** → §2's "absent means unchanged" needs an
  explicit clear representation, and `requiresPin`/ADR 0007's gate must be
  re-examined for the disarming direction.
- Password policy gains length/complexity rules → §2's validation must move to a
  shared policy used by both creation and rotation rather than being mirrored.
- Credential changes must be **auditable** (who rotated whose credentials, when)
  → this ADR writes no audit record; that needs a new append-only table
  consistent with ADR 0001's append-only posture.
