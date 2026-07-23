# ADR 0002: Staff Authentication & PIN Access

- **Status:** Accepted
- **Date:** 2026-07-24
- **Decision owner:** Technical Lead
- **Supersedes / extends:** ADR 0001 (which defined the domain contexts but not
  authentication). This ADR records the auth model, extending the pattern first
  built for admin sign-in in #5/#6.

---

## Context

ADR 0001 defines three domain contexts (Catalog, Inventory, Sales/Orders) but
is silent on authentication and identity. Admin username+password sign-in was
implemented in #5/#6 as a cross-cutting `AuthModule` in `apps/api` — cookie
(httpOnly) JWT session, argon2id password hashing, a `RolesGuard` +
`@Roles(...)` decorator, and a `User` model (`username`, `passwordHash`,
`role`). Story #18 now adds **staff** sign-in to the POS, with two methods:
username+password, and a fast 4-digit **PIN** for touchscreen use.

Three product/scope questions blocked breakdown initially and have now been
settled by the PO (recorded on #18):

1. **Provisioning.** There is no account-management UI and no story for one.
   Decision: **seed-only stopgap for v1** — staff accounts, usernames,
   passwords, and PINs are provisioned by ops via seed/migration, no UI.
   A staff account/PIN **management** story is an explicit follow-up (PO to
   author; out of #18 scope).
2. **PIN identification model.** Decision: a **device-remembered staff picker**.
   The PIN does **not** identify a staff member on its own — the staff member is
   identified by selecting their name/tile, and the PIN authenticates that
   selection. Consequently **PINs need not be globally unique.** The picker only
   lists staff who have **previously signed in on that device/browser** (via
   username+password) and later signed out (manual or auto). A staff member on a
   fresh device — whose name is not yet remembered there — must use
   username+password; PIN becomes available on that device only after a first
   full sign-in.
3. **Repeated-failure safeguard.** Decision: a **threshold/throttle** is
   sufficient for v1 (no elaborate lockout policy required). See below.

## Decision

### Placement
Authentication remains a **cross-cutting concern**, not a domain context. Extend
the existing `apps/api` `AuthModule` / `UsersModule` — do not fold auth into
Catalog/Inventory/Sales.

### Data model (`User`)
Extend the Prisma `User` model (append-only conventions do not apply to identity):
- `pinHash` (nullable) — argon2id hash of the 4-digit PIN. **Never** store or log
  the plaintext PIN. Nullable because not every account has a PIN assigned.
- `status` / `isActive` — an active/deactivated flag. Every #18 acceptance
  criterion presupposes an "active staff account"; deactivated accounts must be
  refused by both sign-in methods.
- `displayName` — the name shown on the staff picker tile (do not expose
  `username` as the picker label if they differ; Dev's call, but a human-facing
  name is expected).
- `location_id` remains **not** location-scoped for users in v1 (per ADR 0001,
  Tech Lead's call in #5).

### Sign-in methods
- **Staff username+password:** same mechanism as admin, but the endpoint accepts
  and issues a session for `role = STAFF`. Admin credentials **must not** grant
  access through the staff path, and vice-versa — role is enforced server-side
  (the current admin `login` hard-rejects non-ADMIN; the staff path is the
  mirror of that).
- **Staff PIN:** the request carries a **staff identifier** (from the picker
  selection) **plus** the 4-digit PIN. The server verifies the PIN hash for that
  specific active staff account. Because identity comes from the selection, PIN
  collisions across staff are irrelevant and are **not** prevented at assignment.
- On success either method establishes the **same** httpOnly cookie JWT session
  as admin (role `STAFF`) and lands the user in the POS.

### Non-enumeration
Preserve the existing anti-enumeration posture: a single generic failure for
bad username/password/PIN, no "unknown user" vs "wrong secret" distinction, and
the constant-time dummy-hash verify already used in `AuthService` (mirror it for
the PIN path). An incomplete (<4 digit), incorrect, or unassigned PIN yields the
same generic, non-identifying error.

### Device remembering
Which staff appear on a device's picker is **client-side state** (e.g.
`localStorage`) written after a successful username+password sign-in on that
device and consulted to build the picker. It is a UX convenience, **not** a
security boundary — the server still fully authenticates every PIN attempt. Do
not treat "remembered on device" as any form of trust.

### Repeated-failure safeguard
A **threshold + throttle** on failed attempts (v1): after a small number of
consecutive failures for an account (and/or device), further attempts are
slowed/temporarily refused. A 4-digit PIN is only 10,000 combinations, so this
is the primary brute-force mitigation. Keep the policy simple and configurable
(threshold + cooldown); no long-lived hard lockout is required for v1. The
throttle response must remain non-identifying.

## Consequences

- **Positive:** reuses the admin auth machinery (cookie JWT, argon2id, guards);
  PIN-not-unique keeps provisioning simple and avoids a conflict-resolution
  subsystem; the touchscreen-fast path is delivered without a real security
  downgrade because identity is explicit and every attempt is server-verified.
- **Accepted trade-offs:** seed-only provisioning means ops manage accounts by
  hand until the follow-up management story lands; device-remembering in
  `localStorage` is per-browser and cleared with site data (acceptable — the
  fallback is simply username+password).
- **Follow-ups:** (1) PO to author the staff account & PIN **management** story;
  (2) revisit throttle policy if abuse is observed; (3) PIN rotation belongs to
  the management story, not #18.
