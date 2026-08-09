# ADR 0011: Session Termination & Logout

- **Status:** Proposed
- **Date:** 2026-08-09
- **Decision owner:** Technical Lead
- **Supersedes / extends:** Extends ADR 0002 (staff authentication & PIN access),
  which established the session model — an httpOnly cookie JWT minted by
  `AuthModule` — but only ever described how a session *starts*. It refers in
  passing to staff who "later signed out (manual or auto)" without deciding what
  signing out actually does. Story #226 is the story that needs that decision.
  Also touches ADR 0007 (active cashier selection), which introduced
  device-scoped state that outlives an individual session.

---

## Context

Story #226 ("Log out of administrator and staff workspaces") asks for a
user-initiated logout from both workspaces. Its acceptance criteria go past
"hide the UI":

- after logout the protected information is gone and the correct sign-in screen
  (admin vs. staff) is shown;
- browser **Back**, a **reload** of a previously open protected page, or opening
  a **protected link directly** must not restore access or reveal protected
  information;
- logging out in **one tab ends access for other open tabs** in the same
  browser — those tabs must not permit further protected activity;
- the **remembered-staff picker** keeps the staff member's name for later PIN
  sign-in, and no other remembered name is added or removed.

The codebase has no logout of any kind today: `grep -ri logout apps packages e2e`
returns nothing. `AuthController` exposes `GET /auth/session`, `POST /auth/login`,
`POST /auth/staff/login`, `POST /auth/staff/pin` and sets the session cookie in
`setSessionCookie`; the web `AuthContext` calls `readSession()` **once on mount**
and holds `status`/`user` in React state with no path back to `signedOut`.

Four properties of the existing design constrain the decision:

1. **The cookie is httpOnly.** Client JavaScript cannot delete it. Any logout is
   necessarily a **server** operation — a client-only "forget the user in React
   state" logout would leave a live credential attached to every subsequent
   request.
2. **The JWT is stateless.** `JwtAuthGuard` verifies the signature and payload
   and consults no store, so a token stays cryptographically valid for its full
   `AUTH_COOKIE_MAX_AGE_MS` (8 h) regardless of what the browser does with it.
   "Session ended" and "token invalid" are not the same statement.
3. **The cookie jar is shared across tabs.** Removing the cookie is inherently
   browser-wide, which is what makes the cross-tab criterion achievable at all —
   but an already-rendered tab keeps showing whatever is in its React state until
   something makes it re-check.
4. **Two sign-in surfaces, one session.** Admin (`/signin`) and staff
   (`StaffSignInPage`) mint the same cookie with different roles, so logout has
   to route the person back to the surface matching the role they held.

## Decision

### 1. Logout is a server endpoint that clears the session cookie

Add `POST /auth/logout` to the existing cross-cutting `AuthModule` — auth stays
out of Catalog/Inventory/Sales per ADR 0002.

- It clears `AUTH_COOKIE_NAME` by issuing a `Set-Cookie` that **exactly mirrors
  the attributes used when minting it** (`path: '/'`, the same `sameSite` from
  `cookieSameSite()`, the same `secure` from `cookieIsSecure()`, `httpOnly`).
  A clear whose attributes do not match the original does not remove the cookie
  — this is the single most common way a logout silently fails in production but
  passes locally, because `sameSite`/`secure` are environment-derived here.
- It is **idempotent and unauthenticated-safe**: calling it without a session, or
  twice, succeeds with the same result. It therefore carries **no** `JwtAuthGuard`.
  A logout that can fail with 401 is a logout that can strand someone in a
  half-signed-in state — the one place a guard actively harms the outcome.
- It returns no user data. `POST` (not `GET`) so that prefetchers, link crawlers
  and `<img>` tags cannot end a session.

### 2. v1 does not add server-side token revocation

The cleared cookie is the boundary. We do **not** add a denylist, a token
version column, or server-side session records in v1.

Rationale: the token is httpOnly and never exposed to page JavaScript, so
possessing a copy of it after logout requires having already compromised the
host or the transport — a position from which revocation buys little. Against
that, a denylist means a store on the hot path of every guarded request, which
is a real cost for an internal single-location POS.

**This is a deliberate, bounded trade-off, and it must be stated in the story's
technical notes rather than discovered later:** a token captured before logout
remains valid until it expires (≤ 8 h). See Revisit triggers.

### 3. Cross-tab and Back/reload enforcement is *revalidation*, not client memory

Two mechanisms, with clearly different jobs:

- **The security boundary is the server.** The web API client gains a single
  central handler: any `401` from a protected endpoint transitions `AuthContext`
  to `signedOut` and routes to the role-appropriate sign-in screen. After the
  cookie is gone every protected request 401s, in every tab, so no tab can
  perform protected activity. This is the property the acceptance criteria
  actually depend on.
- **Promptness is a UX affordance.** So a stale tab does not sit there displaying
  protected data until someone clicks something, `AuthContext` **re-validates via
  `GET /auth/session`** on: a same-origin cross-tab logout broadcast
  (`BroadcastChannel`, or a `storage` event as the fallback), tab
  `visibilitychange` → visible, and `pageshow` (which fires with
  `event.persisted === true` on a bfcache Back restore — the reason Back appears
  to "restore access"). A failed re-validation flips to `signedOut`.

The broadcast is explicitly **not** trusted as the boundary: a tab that misses it
is still stopped by the 401 path. Never invert these — the arrangement where the
client-side flag is authoritative is how a page ends up rendering protected data
against a dead session.

`AuthContext` must therefore expose a way back to `signedOut`
(e.g. `completeLogout`), which it does not have today.

### 4. Protected API responses are not cached

Guarded endpoints send `Cache-Control: no-store`. Otherwise a Back navigation
can repaint protected data from the HTTP cache without any request reaching the
server, which reads to a user as "logout didn't work". The SPA's own static
assets are unaffected.

### 5. Logout does not touch device-remembered state

Logout clears the **session**, and nothing else on the device:

- `ucm.staff-auth.remembered-staff.v1` is **left intact** — the staff member's
  name stays in the picker for a later PIN sign-in, and no other remembered name
  is added or removed. This is exactly the lifecycle ADR 0002 described
  ("previously signed in on that device … and later signed out"), now made
  explicit: sign-out is what *populates the PIN path*, so clearing it here would
  break the feature it enables.
- `ucm.staff-auth.device-id.v1` is **left intact** — the device identity is not a
  credential and is depended on by ADR 0007's selection log.
- The device's active `CashierSelection` (ADR 0007) is **not** cleared. It is
  device-scoped, append-only, and orthogonal to who is signed in — ADR 0007
  already decided that authorizing a cashier never changes the session, and the
  converse holds too. A shift change that should reset attribution goes through
  the existing explicit *clear* action, not as a side effect of logout. Note
  that the next person signing in on that device inherits the standing selection;
  that is the existing behaviour of the append-only log, not a regression
  introduced here, and #226 does not ask to change it.

### 6. Role-correct landing

After logout, an `ADMIN` session lands on the administrator sign-in screen and a
`STAFF` session lands on the staff sign-in screen. The role is known client-side
from the session that is being ended (`AuthContext.user.role`), so the routing
decision is made **before** the state is cleared. Landing a cashier on the admin
sign-in form on a shared till is a usability failure, not a cosmetic one.

## Consequences

- **Positive:** reuses ADR 0002's machinery with one endpoint and no new
  persistence; the guarantee stays server-enforced, so it holds for tabs,
  bfcache restores, and directly-opened protected links alike; the remembered
  picker and the cashier-selection log keep the semantics their own ADRs gave
  them; no hot-path cost added to `JwtAuthGuard`.
- **Accepted trade-offs:** (1) no revocation — a token captured before logout
  survives until expiry (§2); (2) the cross-tab experience depends on a
  best-effort browser broadcast, so a background tab may not visibly change
  until it is focused or acts (it still cannot *do* anything); (3) `no-store`
  forgoes some client caching on guarded endpoints, which is negligible at this
  scale.
- **Follow-ups / not decided here:** automatic or inactivity logout is explicitly
  out of #226's scope and out of this ADR; if it is authored later it should
  extend this ADR rather than introduce a second termination path.

## Revisit triggers

- The POS is exposed beyond the shop LAN, or the app is ever used on a device
  outside the shop's control → revisit §2 (revocation) and the 8 h cookie
  lifetime together.
- A "sign out everywhere / end all my sessions" requirement appears → §2 must
  change; that requirement is unimplementable without server-side session state.
- An inactivity/auto-logout story is authored → revisit §3 (the re-validation
  points become the natural place to detect expiry) and §5.
- The token lifetime is shortened enough that a refresh mechanism is introduced
  → refresh tokens are server-side state, at which point §2's cost argument no
  longer holds.
- Multi-location rollout puts admin and POS sessions on the same device
  concurrently → §6 and the single-cookie model need rework.
