# ADR 0012: Staff Account Provisioning & Default Cashier at Sign-In

- **Status:** Proposed
- **Date:** 2026-08-12
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0002 (staff authentication & PIN access),
  ADR 0003 (staff roster & cashier-attribution identity) and ADR 0007 (active
  cashier selection & PIN authorization). This is the **account & PIN management
  story** that ADR 0002 (Follow-ups 1) and ADR 0007 (Revisit triggers 1) named as
  an explicit follow-up: it retires the seed-only provisioning stopgap for newly
  created staff accounts and decides the one question none of those ADRs answered
  — what happens to the active cashier when a linked staff member signs in.

---

## Context

Story #287 asks for two things:

1. An administrator can create a **login account for an existing active staff
   roster member**, providing the credentials that member needs to use the
   existing staff sign-in methods, with a strict **1:1** relationship between a
   roster member and a login account, and clear refusals for missing/invalid
   credentials or a username already in use.
2. When that linked, active member signs in, they become the **active cashier by
   default on that device** — visibly — while the existing cashier picker
   (ADR 0007) remains fully usable to switch or clear the selection, and
   already-recorded attribution is never rewritten.

The relevant ground truth in the repo today:

- `User` (`apps/api/prisma/schema.prisma`) has `username @unique`, `displayName`,
  `passwordHash`, nullable `pinHash`, `isActive`, `role`.
- `StaffMember.userId` already exists as `String? @unique` with a `Restrict`
  relation to `User` — ADR 0007 §1 landed the link column. **No schema migration
  is required by this story.**
- `CashierSelection` exists exactly as ADR 0007 §4 specified (append-only,
  latest-row-wins per `deviceId`, `staffMemberId = null` means cleared).
- `POST /auth/staff/login` and `POST /auth/staff/pin` both already require a
  client-supplied `deviceId` (`auth.controller.ts:104,119`).
- `staff.controller.ts` is `@Roles(ADMIN)` and exposes roster list/create;
  `sales.controller.ts` is `@Roles(STAFF)` and owns the active-cashier
  endpoints. `SalesModule` imports `AuthModule` (for PIN verification).
- `UsersService` has read methods only; nothing in the app creates a `User`.
  Accounts come from seed.

Two things therefore have to be decided rather than inferred:

1. **Provisioning rules** — where account creation lives, what counts as a
   credential, how uniqueness and the 1:1 link are enforced without partial
   writes, and what role a created account gets.
2. **The default-cashier invariant** — ADR 0007 §3 requires a PIN before a
   PIN-configured member becomes the active cashier. Auto-selecting the
   signed-in member at sign-in would bypass that gate as literally written, so
   the gate's real scope must be stated, not silently narrowed by an
   implementation.

## Decision

### 1. Account creation is an admin operation on the roster member

Creation is exposed as `POST /staff/:staffMemberId/account`, in the existing
`staff` module, `@Roles(ADMIN)`. The roster member is the subject and the
account is the thing being attached to it; there is no "create a floating user
then link it" step and no admin-facing user list in this story.

Credential hashing stays **cross-cutting**: the staff service calls
`AuthService`'s existing argon2id path (the same one that hashes passwords and
PINs today) and a new `UsersService.createStaffAccount(...)`. `StaffModule`
imports `AuthModule` and `UsersModule`; nothing imports `StaffModule` from auth,
so no module cycle is introduced.

Request body: `{ username, displayName?, password, pin? }`.

- `username` — required. Trimmed; stored **lower-cased** (see §3).
- `displayName` — optional; defaults to the roster member's `displayName`, which
  is what the ADR 0002 device staff-picker tile renders.
- `password` — required. Validated against the same policy the existing admin
  password path uses; never logged, never echoed back.
- `pin` — **optional**, exactly 4 digits when present. Optional because ADR 0002
  makes `pinHash` nullable and makes the PIN unusable on a device until a first
  username+password sign-in there; the password is the credential that makes an
  account usable, the PIN is a convenience that may be set now or left for a
  later rotation story.

Created accounts are **always `role = STAFF` and `isActive = true`**. This
endpoint cannot mint an ADMIN account under any request shape — that is what
keeps AC "creating or using a staff login account does not grant access to
administrator-only areas" a server-side property rather than a UI one. Existing
`RolesGuard`/`@Roles(ADMIN)` on back-office routes needs no change.

**Out of scope of this ADR** (and of #287): password/PIN rotation, account
deactivation or deletion, unlinking, and admin self-service account management.
Those remain seed/ops operations until a story asks for them.

### 2. The 1:1 link, and refusals without partial writes

The link is the existing `StaffMember.userId`. Its `@unique` constraint already
gives "an account is linked to at most one roster member"; the column being
single-valued gives "a roster member has at most one account".

Creation runs in **one Prisma transaction**: insert the `User`, then set
`staffMember.userId`. Any failure rolls back both — an orphan `User` with no
roster link is not an acceptable outcome of a failed request, since it would
occupy a username while being invisible to the admin UI.

Refusals, all before or inside that transaction, all leaving both records
untouched:

| Condition | Status | Response |
| --- | --- | --- |
| Roster member does not exist | 404 | generic not-found |
| Roster member `isActive = false` | 409 | "inactive staff member" |
| Roster member already has `userId` | 409 | "already has a login account" |
| Username already taken (see §3) | 409 | field-attributed conflict |
| Missing/invalid username, password or PIN | 400 | per-field validation errors |

These are **admin-facing** responses on an ADMIN-guarded route, so they are
specific and field-attributed. ADR 0002's non-enumeration posture governs the
*unauthenticated sign-in* surface and is not weakened here: telling an
administrator that a username is taken is the acceptance criterion.

### 3. Username uniqueness is case-insensitive, enforced by normalisation

`User.username` is `@unique` in Postgres, which is **case-sensitive**, while
`UsersService.findByUsername` looks up with `mode: 'insensitive'`. Creating
`Jane` while `jane` exists would therefore satisfy the database and then make
sign-in resolution ambiguous — a real defect this story would otherwise
introduce.

Decision: **normalise usernames to trimmed, lower-cased on write.** The creation
path stores `username.trim().toLowerCase()`, so the existing unique index
enforces case-insensitive uniqueness by construction, and a race between two
concurrent creates fails on the constraint (`P2002`) rather than on a check —
the `P2002` is mapped to the same 409 as the pre-check. Sign-in lookups continue
to work unchanged (an insensitive match against a lower-cased column).

Existing seeded rows are not rewritten by this story; if any seeded username is
not already lower-case, ops normalises it. Dev must verify the current seed and
say so in the PR.

**Rejected alternative — a `citext` column or a functional unique index.** Both
mean a migration and a Prisma escape hatch for a property that one `toLowerCase`
on the single write path gives us.

### 4. Default cashier at sign-in is written **server-side**, by appending a `CashierSelection`

On a successful staff sign-in — **both** `POST /auth/staff/login` and
`POST /auth/staff/pin` — the server resolves the authenticated `User`'s linked
`StaffMember` and appends exactly one `CashierSelection` row for the request's
`deviceId`:

- linked member exists **and** `isActive` → append
  `{ deviceId, staffMemberId: <member>, selectedByUserId: <user> }`;
- **no link, or linked member inactive** → append a **cleared** row
  (`staffMemberId: null`).

The cleared-row branch is the important one. Without it, the device would
inherit whatever cashier the previous session left selected, and the next order
would be silently attributed to someone who is not at the till — precisely what
the story forbids. Appending a clear makes "no cashier was selected
automatically" a server fact that the existing `GET /sales/active-cashier`
already reports and that the existing POS cashier display already renders.

The write is unconditional (it appends even when the incoming selection already
matches): the log is append-only per ADR 0001 and ADR 0007 §4, and a sign-in is
a genuine till-handover event worth recording. It never updates or deletes a
row, so ADR 0007's audit trail semantics are preserved.

The append is **best-effort with respect to the session**: it happens after
authentication succeeds and inside the sign-in request, but a failure to write
it must not fail the sign-in or prevent the session cookie from being issued.
A staff member who cannot get a default cashier still lands in the POS and uses
the picker; the alternative — refusing a valid sign-in over an attribution
convenience — is worse for a shop mid-service.

Admin sign-in (`POST /auth/login`) is untouched: it takes no `deviceId` and
writes no selection.

### 5. Scope of ADR 0007's PIN gate (an explicit narrowing)

ADR 0007 §3 requires PIN authorization before a PIN-configured member becomes
the active cashier. This ADR states its scope precisely:

> The PIN gate applies to claiming a cashier identity **from inside an existing
> session** — that is, to `POST /sales/active-cashier`. It does **not** apply to
> the automatic selection of the signed-in user's own linked roster member at
> sign-in.

Rationale: the gate exists so that a device cannot claim an identity whose
credential it does not hold. At sign-in the user has just presented that exact
credential (password or the very PIN the gate would check) for that exact
account, and the server — not the client — derives the member from the
authenticated session. Requiring a second PIN immediately after sign-in would
authenticate the same fact twice.

Everything else in ADR 0007 stands unchanged: switching to **another** member
still re-derives `requiresPin` server-side and still demands the PIN; clearing
still requires no PIN; a failed or cancelled attempt still writes nothing, so
the default selection survives it; `POST /orders` still resolves the cashier
server-side from the device's current selection and never from the request body.

### 6. Placement — extracting the cashier-selection write

`SalesModule` already imports `AuthModule` for PIN verification. Having
`AuthModule` import `SalesModule` for the sign-in write would create a module
cycle resolvable only with `forwardRef`, which hides the dependency from the
type system and from readers.

Decision: extract the **selection persistence** (append a selection, read the
current selection for a device) into a `CashierSelectionService` with no auth
dependency, provided and exported by its own module under the Sales/Orders
context. `SalesModule` (controller, roster validation, `requiresPin`
re-derivation, PIN gate) and `AuthModule` (sign-in default) both depend on it;
neither depends on the other in the new direction. Cashier attribution stays a
Sales/Orders concern per ADR 0003 — only the plumbing moves.

## Consequences

- **Positive:** no schema migration — ADR 0007's link column and selection log
  carry the story. Account creation reuses one hashing policy and one session
  model. The `role = STAFF` constant makes privilege separation a server
  property. Case-normalised usernames close a latent ambiguity between the
  case-sensitive index and the case-insensitive lookup. The default cashier is
  server-derived from the session, so it inherits the property ADR 0007 cared
  about most: the client never asserts who the cashier is.
- **Accepted trade-offs:** (1) the sign-in default is keyed on the
  client-supplied `deviceId`, inheriting ADR 0007's accepted device-trust
  trade-off. (2) A best-effort append means a rare failure yields a signed-in
  staff member with no default cashier, which is indistinguishable from the
  unlinked case in the UI; it is recoverable in one tap via the picker.
  (3) Two staff members signing in on the same device in sequence each append a
  selection — last sign-in wins, which is the intended till-handover behaviour
  but does mean a sign-in silently overrides a deliberate manual selection made
  earlier in that session. (4) No rotation or deactivation UI: a mistyped
  username or a compromised password is still an ops/seed fix.
- **Follow-ups:** PO to author (a) credential rotation and account
  deactivation/unlink, and (b) admin visibility of which roster members already
  have accounts beyond the create-time refusal.

## Revisit triggers

- A story requires staff self-service password or PIN change → revisit §1's
  admin-only scope and the "no rotation" boundary.
- Roster members must be attributable across devices or two tills share one
  device → revisit §4 together with ADR 0007's `deviceId` keying.
- An account must be creatable without a roster member (e.g. a second admin
  through the UI) → revisit §1's "creation is an operation on the roster member"
  and the hard-coded `role = STAFF`.
- Usernames must preserve display casing → revisit §3 in favour of a `citext`
  column or a stored normalised shadow column.
