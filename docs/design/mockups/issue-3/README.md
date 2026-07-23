# Issue #3 — Administrator username sign-in

Production-oriented static mockup for UCM Coffee Studio’s administrator-only sign-in. Open `index.html` directly; it has no build step, network dependency, or external asset.

## Design intent

- Calm operational register: cool neutral surfaces, strong ink contrast, hairline structure, and one restrained botanical green accent.
- The sign-in form is the clear primary task. The left context area establishes trusted workspace and admin-only scope without revealing protected content.
- At tablet widths the context compresses into a short introduction; on mobile the form and mockup controls stack without horizontal scrolling.
- System/local fonts keep rendering fast and dependable on counter and back-office devices.

## Prototype interactions

- Submit an empty form to see exact required-field errors and focus move to the first invalid field.
- Submit any filled credentials to see a duplicate-safe loading state followed by the generic `Invalid username or password.` refusal. This same message represents unknown username, wrong password, account email entered as username, and active non-admin staff accounts.
- The password visibility button updates its accessible name between “Show password” and “Hide password.”
- The separate **Mockup preview** rail switches among Default, Required fields, Invalid credentials, and Signing in. **Protected link context** shows the optional destination message; off is direct sign-in with no destination message.
- This mockup simulates outcomes locally. It is not authentication and contains no valid credential pair.

## Authentication behavior requirements

- Normalize usernames for lookup by trimming surrounding spaces and comparing case-insensitively. Do not treat an account email as a username or reveal whether it maps to an account.
- Passwords are exact and case-sensitive; preserve all password spaces, including leading and trailing spaces.
- After successful direct sign-in, return to the administrator dashboard.
- After successful protected-route sign-in, return to the exact requested path with its query string preserved. Validate return destinations as safe same-origin paths before redirecting.
- Persist a successful session across reloads and a second tab in the same browser. Session storage, expiry, rotation, revocation, and cookie flags belong to the production authentication layer.
- Never render or preload protected page content before authorization succeeds.

## Accessibility handoff

- Labels are explicit and errors are associated with fields using `aria-describedby` and `aria-invalid`.
- Status changes are announced through a polite live region; the generic form error is focusable and receives focus after simulated failure.
- DOM order matches the visual task order. All controls are keyboard reachable, focus-visible, and at least 44px where they are part of the primary workflow.
- Color choices target WCAG AA contrast. Reduced-motion preferences collapse animations and transitions.

## Files

- `index.html` — semantic interface structure
- `styles.css` — responsive layout, visual states, focus and motion treatment
- `script.js` — validation, visibility control, loading lock, live announcements, preview states
- `../../tokens.json` — shared color, type, spacing, radius, and control tokens

