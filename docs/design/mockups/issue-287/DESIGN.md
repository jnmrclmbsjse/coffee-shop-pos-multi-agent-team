# UCM Coffee Studio POS: staff login account design

## Design read

Preserve-mode internal admin/POS addition for staff administrators and register operators, using the shipped UCM catalog, staff dialog, and cashier-control language. Design variance 3, motion intensity 1, and visual density 6. This task is outside the active frontend skill's marketing-page focus, so the supplied product patterns and tokens are authoritative.

This mockup is an advisory implementation reference, not an additional set of acceptance criteria. Pixel matching is not the goal. Dev should preserve the app's existing component behavior and stylesheet conventions while using this document to resolve state, copy, and accessibility decisions.

## Decision and rationale

Place **Create login account** in the existing row-actions area beside **Edit**, only for active roster members who do not already have an account. This is the narrowest extension of the shipped page and keeps the action next to the member it affects.

For members who already have an account, omit the creation action and show a quiet, non-interactive **Login account** marker next to the roster name. The actions area also states **Account already exists**. This prevents a known 409 attempt while making the 1:1 relationship visible without requiring an admin user list.

For inactive members without an account, omit the creation action and show the persistent reason **Activate staff to create an account**. For inactive members with an account, retain the account marker and show **Inactive. Account already exists**. No explanation relies on hover, color, or a `title` attribute.

The dialog keeps server conflicts separate from client validation. A username collision is attached to Username and retains every field. Member-level conflicts use a dialog-level danger notice and state that nothing changed. Success confirms only the username, linked member, and whether a PIN was set.

The two shipped `CashierControl` states already satisfy the story. The linked active member is named under **Active cashier**. The unlinked or inactive case safely displays **No cashier selected**, omits Clear, and leaves Change available. Recommend no change.

## Token statement

The mockup uses only the tokens supplied from `docs/design/tokens.json`. No new token is proposed. `styles.css` declares those values in `:root` solely so this standalone mockup renders correctly. Dev must omit that `:root` block when lifting rules into `apps/web/src/styles.css` and use the app's existing token declarations.

For primary button fills, the standalone reference uses `--accent-hover` at rest and `--accent-pressed` on hover so white button text clears WCAG AA. The brighter `--accent` remains suitable for non-text controls such as the switch track.

## Copy deck

### Staff roster

- Page heading: `Staff`
- Page subtitle: `Manage names used to identify cashiers at the register.`
- Primary action: `Add staff`
- Search accessible label and placeholder: `Search staff`
- Filter labels: `Status`, `Sort by`
- Direction control accessible label: `Sort ascending`
- Results: `4 staff members shown`
- Reset action: `Clear search and filter`
- Table columns: `Name`, `Is active`, `Actions` (screen-reader only)
- Statuses: `Active`, `Inactive`
- Existing row action: `Edit`
- New eligible row action: `Create login account`
- Existing-account marker: `Login account`
- Existing-account reason: `Account already exists`
- Inactive-without-account reason: `Activate staff to create an account`
- Inactive-with-account reason: `Inactive. Account already exists`

### Dialog shell

- Heading: `Create login account`
- Description: `Create an account linked to Mara Santos.`
- Close action: `Close`
- Cancel action: `Cancel`
- Submit action: `Create account`
- Submitting action: `Creating...`

### Username

- Label: `Username`
- Help: `Required. Spaces at the beginning and end are removed, and uppercase letters do not make a username different.`
- Missing error: `Enter a username.`
- All-space error: `Enter a username that is not only spaces.`
- Server collision error: `That username is already in use. Usernames ignore uppercase letters and spaces at the beginning or end.`

### Display name

- Label: `Display name`
- Help: `Optional. Prefilled from the staff roster and can be changed.`
- Default value: `Mara Santos`

### Password

- Label: `Password`
- Help: `Required. At least 1 character. Passwords are case-sensitive, and spaces are preserved exactly.`
- Missing error: `Enter a password.`
- Reveal action accessible names: `Show password`, `Hide password`
- Reveal action visible labels: `Show`, `Hide`

### PIN

- Label: `PIN`
- Help: `Optional. Use exactly 4 digits. Leave blank if PIN sign-in is not needed. PIN sign-in becomes available on this device after the first username and password sign-in.`
- Three-digit error: `Enter exactly 4 digits, or leave the PIN blank.`
- Non-digit error: `Use digits only, or leave the PIN blank.`

### Validation summary

- One error heading: `There is a problem.`
- Multiple errors heading: `Review the fields below.`
- Summary links repeat the exact field error messages.

### Non-field server conflicts

- Existing-account heading: `No account was created.`
- Existing-account message: `This staff member already has a login account. Nothing was created or changed.`
- Inactive-member heading: `No account was created.`
- Inactive-member message: `This staff member is inactive. Activate the staff member before creating an account. Nothing was created or changed.`

### Success

- Heading: `Login account created`
- Message: `The account is ready to use.`
- Fact labels: `Username`, `Linked staff member`, `PIN set`
- Example safe facts: `mara.santos`, `Mara Santos`, `Yes`
- Privacy reminder: `The password and PIN are not shown.`
- Completion action: `Done`

### POS cashier control

- Label: `Active cashier`
- Linked active member example: `Mara Santos`
- Safe fallback: `No cashier selected`
- Picker action: `Change`
- Clear action: `Clear`

## Implementation handoff

### 1. Requirements

These are inherited from GitHub #287, ADR 0012, and accessibility obligations. They are not optional mockup preferences.

- Enforce a strict 1:1 relationship between a roster member and a login account on the server. The row affordance reduces invalid attempts but does not replace server enforcement.
- Only an active roster member without an account may receive a new account.
- Trim Username for comparison, compare it case-insensitively, and reject an all-space value.
- Require Password with a minimum of 1 character. Preserve spaces exactly and apply no additional complexity rule.
- Treat PIN as optional. When supplied, require exactly 4 digits.
- Keep the populated form after a username 409. Move focus to Username and associate the server message with that field.
- Present member-already-linked and member-inactive 409s as dialog-level danger notices. Announce them through `role="alert"` or an assertive live region and state that nothing was created or changed.
- Disable all form controls while submitting and label the primary action `Creating...`.
- Never render the password or PIN after submit. Success may state only whether a PIN was set.
- When an account linked to an active member signs in on a device, set that member as the active cashier on that device.
- For an unlinked account or an account linked to an inactive member, show `No cashier selected`, omit Clear, and keep Change available.
- Keep every interactive target at least `--touch-min` (44px), provide a visible `--focus` ring, use real labels, and connect errors through `aria-describedby` and `aria-invalid`.
- On open, move focus into the dialog. Trap focus while the modal is active, close on Escape, and return focus to the invoking row action on close.
- Do not use disabled controls as the only explanation for unavailable row actions. Reasons must remain persistent and available to assistive technology.

### 2. Advisory

- Keep the new action in the existing row-actions area and allow the table to scroll horizontally at narrow tablet widths rather than compressing labels into unreadable fragments.
- Omit invalid creation actions instead of rendering disabled buttons. This avoids non-focusable controls while the adjacent reason text explains the state.
- Put the account marker beside the member name, where it remains discoverable even when action columns are visually scanned last.
- Keep the dialog width aligned with the shipped staff modal. On small tablet widths, stack the show/hide control and action buttons only when the existing shell already supports that collapse.
- A show/hide password button is useful for administrators entering passwords on touch devices. It should be a real button, update its accessible name, and never affect success output.
- Keep motion to direct control feedback only. No animated transitions are needed for this operational flow.
- The state switcher and assessment notes exist only in this mockup. They are not production UI.

### 3. Proposed material changes to existing shared shells/components

**Roster row-actions area:** Add one conditional `Create login account` button beside `Edit` for active members without an account. Add a quiet account marker derived from the roster row's linked-account state and persistent reason text when creation is unavailable. Reason: this exposes the 1:1 relationship and prevents predictable 409 attempts without introducing an admin user list.

**Shipped staff dialog shell:** No structural change recommended. Reuse `.inventory-modal-backdrop`, `section.inventory-modal.staff-modal`, `.inventory-modal-head`, `.catalog-field`, danger Notice, and `.staff-modal-actions`. The feature adds field content, error-summary links, focus management, and submitting/success states within that shell.

**CashierControl:** No change recommended. The shipped linked-active and safe-fallback presentations already communicate the active cashier state clearly and preserve access to Change.
