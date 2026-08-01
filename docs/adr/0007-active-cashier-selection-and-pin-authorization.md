# ADR 0007: Active Cashier Selection & PIN Authorization

- **Status:** Proposed
- **Date:** 2026-08-01
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0002 (staff authentication & PIN access)
  and ADR 0003 (staff roster & cashier-attribution identity). ADR 0003 named an
  optional `User`↔`StaffMember` link as an explicit follow-up and deferred it.
  Story #165 is the story that needs it, so this ADR decides it — plus the
  adjacent question ADR 0002 did not answer: how a PIN authorizes something
  *inside* an existing session rather than starting one.

---

## Context

Story #165 ("Select the active cashier for order attribution") asks for a
touch-friendly picker in the POS that sets which roster member subsequent orders
are credited to. Its acceptance criteria require, among other things:

- the picker offers **active roster members** only;
- a member **without a PIN configured** becomes active immediately;
- a member **with a PIN configured** must enter that PIN first;
- a wrong, incomplete, or cancelled PIN entry leaves the **previous** active
  cashier unchanged and shows a **non-identifying** result;
- the selection can be **cleared**, and service continues with no cashier;
- attribution is fixed **when an order is started** and later selection changes
  never rewrite already-recorded attribution.

The story's own scope notes flag the blocking architecture gap: the roster
(`StaffMember`, ADR 0003) and the auth account that owns a PIN (`User`,
ADR 0002) are **deliberately unlinked** in v1, so today there is no way to
answer "does this roster member have a PIN configured?". ADR 0003 recorded that
the PO delegated ownership of this identity question to the Technical Lead.

Three further facts constrain the decision:

1. **The PIN in ADR 0002 is a sign-in credential.** It authenticates a *staff
   picker selection* and mints the httpOnly cookie JWT session. Story #165 needs
   a PIN check that happens **while a POS session is already open** and that
   must **not** change who is signed in — the device stays signed in as whoever
   opened it; only the attribution target changes.
2. **`Sale` already carries attribution columns.** `cashierStaffMemberId` and
   `cashierNameSnapshot` exist (ADR 0003's forward obligation, read today by
   reporting/order history) but **nothing writes them** — `apps/api/src/sales`
   is an empty module scaffold and there is no order-creation endpoint yet.
   The story acknowledges this missing foundation.
3. **`GET /staff` is `@Roles(ADMIN)`.** The POS runs on a `STAFF` session and
   currently has no staff-readable view of the roster at all.

## Decision

### 1. Link the roster to the auth account — optionally, on `StaffMember`

Add a nullable, unique `userId` to `StaffMember` referencing `User`:

```prisma
model StaffMember {
  // ...existing fields
  userId String? @unique @map("user_id") @db.Uuid
  user   User?   @relation(fields: [userId], references: [id], onDelete: Restrict)
}
```

This realises ADR 0003's anticipated follow-up (1). It is an **optional 0..1
link**, not a merge: a roster member may have no account (the common case for
someone who is only ever credited on a sale), and an account may exist without a
roster row. `User` is otherwise untouched; PINs continue to live on `User` and
nowhere else.

**Rejected alternative — `StaffMember.pinHash`.** Giving the roster its own PIN
would duplicate the argon2id hashing, throttle, and rotation surface ADR 0002
just established, and would put a credential on an entity that #67 scoped to
"name + active status only". One PIN store, one hashing policy.

Provisioning of the link is **seed/migration only** in v1, consistent with
ADR 0002's stopgap; the deferred account & PIN management story owns the UI.

### 2. "Has a PIN configured" is a derived, server-owned predicate

A roster member **requires a PIN** iff it is linked to a `User` that has a
non-null `pinHash`. Deriving it server-side keeps the client from ever deciding
whether a gate applies.

**Deactivated linked account:** if the linked `User` has `isActive = false`, the
member still **requires a PIN** and every attempt fails generically. Deactivating
an account must never *remove* a gate and silently downgrade a member to
one-tap selection. Ops resolves this by reactivating or unlinking.

### 3. PIN authorization is a distinct operation from sign-in

Add a PIN **authorization** path that verifies a PIN **without minting,
refreshing, or altering any session**. It requires an existing authenticated
`STAFF` session (`JwtAuthGuard` + `@Roles(Role.STAFF)`), takes the selected
`staffMemberId` plus the 4-digit PIN, resolves the linked `User`, and verifies
`pinHash` with the **existing** `AuthService` argon2id path.

It inherits ADR 0002's posture wholesale:

- **Non-enumeration** — one generic, non-identifying failure for wrong PIN,
  incomplete (<4 digit) PIN, unlinked member, or deactivated linked account;
  the same constant-time dummy-hash verify on the miss path.
- **Throttle** — reuse `AuthAttemptThrottleService`. Cashier-authorization
  failures throttle on the same threshold/cooldown policy. The throttled
  response stays non-identifying.
- Plaintext PINs are never stored or logged.

### 4. The active cashier is server-side state, not client state

ADR 0002 treats device-remembering as "UX convenience, not a security boundary"
— which held there only because the server still fully authenticated every PIN
attempt. If the active cashier lived in `localStorage`, the PIN gate would be
client-enforced and any crafted request could claim any cashier. So:

Add an **append-only** selection log, owned by the Sales/Orders context:

```prisma
model CashierSelection {
  id            String       @id @default(uuid()) @db.Uuid
  deviceId      String       @map("device_id")
  locationId    String?      @map("location_id") @db.Uuid
  staffMemberId String?      @map("staff_member_id") @db.Uuid  // null = cleared
  selectedByUserId String    @map("selected_by_user_id") @db.Uuid
  selectedAt    DateTime     @default(now()) @map("selected_at")
  // relations, @@index([deviceId, selectedAt])
  @@map("cashier_selections")
}
```

The **current** active cashier for a device is the latest row for that
`deviceId`; a row with `staffMemberId = null` is a deliberate clear. Selections
are never updated or deleted — changing or clearing appends, consistent with
ADR 0001's append-only discipline, and gives an audit trail of who was on the
till when. `deviceId` is the same client-supplied identifier ADR 0002 already
requires on staff sign-in.

A failed or cancelled PIN attempt **writes nothing**, so the previous selection
survives unchanged by construction.

### 5. Endpoints and placement

Cashier attribution is a **Sales/Orders** concern (ADR 0003), so the selection
endpoints live in the existing `sales` module; PIN verification stays
**cross-cutting** in `AuthModule` and is called by the sales service. All are
`STAFF`-guarded:

- `GET /staff/selectable` (staff-readable roster projection) — active members
  only, returning `{ id, displayName, requiresPin }`. Exposing `requiresPin` to
  an already-authenticated staff session is not the enumeration risk ADR 0002
  guards against (that is about unauthenticated sign-in), and the picker needs
  it to render the gate. It is a **hint**: the server re-derives it on write and
  never trusts the client's view.
- `GET /sales/active-cashier?deviceId=…` → the current selection or `null`.
- `POST /sales/active-cashier` `{ deviceId, staffMemberId, pin? }` → validates
  the member is on the roster and `isActive`, re-derives `requiresPin`, verifies
  the PIN when required, then appends the selection. Refuses inactive members.
- `DELETE /sales/active-cashier` `{ deviceId }` → appends a cleared row. **No
  PIN required to clear** — clearing removes attribution rather than claiming
  it, and the ACs require staff to always be able to fall back to no cashier.

### 6. Forward obligation on order creation

Extending ADR 0003's snapshot obligation: when the order-taking story lands,
order creation must resolve the cashier **server-side from the device's current
`CashierSelection`** at the moment the order is started, and write both
`Sale.cashierStaffMemberId` and `Sale.cashierNameSnapshot`. It must **not**
accept a cashier identity from the request body — otherwise the PIN gate is
decorative. A device with no active cashier writes `null` to both columns; an
order is never blocked by the absence of a cashier.

Attribution is therefore fixed **at order start** and is immutable thereafter,
which is what #165's criteria describe. Later renames or deactivations do not
touch recorded sales because the name is snapshotted.

## Consequences

- **Positive:** one PIN store and one hashing/throttle policy; the roster keeps
  its "name + active status" shape with a single nullable link column; the PIN
  gate is genuinely server-enforced; selection history is auditable and
  append-only; ADR 0002's session model is untouched — authorizing a cashier
  never changes who is signed in.
- **Accepted trade-offs:** (1) `deviceId` is client-supplied, so a client that
  forges another device's id can read or overwrite that device's selection —
  acceptable for an internal, single-tenant POS, and no worse than the device
  trust ADR 0002 already assumes; revisit if the POS is ever exposed beyond the
  shop LAN. (2) The link is provisioned by seed until the management story
  lands, so a newly rostered person cannot be PIN-gated without an ops change;
  they are simply selectable without a PIN, which the ACs permit. (3) Reusing
  the sign-in PIN as the cashier-authorization secret couples the two: rotating
  a PIN changes both. Accepted — one secret per person is the simpler mental
  model for staff.
- **Blocked-on / sequencing:** the attribution criteria of #165 cannot be
  demonstrated end to end until the order-taking story exists (there is no
  order-creation endpoint today). The picker, PIN gate, active-cashier display,
  and clearing are all deliverable now; §6 is the contract the future story
  inherits. This is a PO sequencing matter, flagged on #165.

## Revisit triggers

- The staff account & PIN management story is authored → it owns linking a
  `StaffMember` to a `User` and PIN rotation through the UI, replacing seeding.
- A requirement emerges that every attributable person must have an auth account
  (1:1 mandatory) → revisit the optional link and ADR 0003's split identity.
- The active cashier must persist per *station* across devices, or two tills
  must share one device → revisit keying selection on `deviceId`.
- Abuse of cashier authorization is observed → revisit the shared threshold and
  cooldown with ADR 0002's sign-in throttle.
