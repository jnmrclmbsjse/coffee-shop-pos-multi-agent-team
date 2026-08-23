# Credential replacement design reference

This document is an advisory implementation reference, not an extra set of acceptance criteria. The story, ADRs, and accessibility obligations remain authoritative.

## 1. What this covers

- Roster entry point: shows account and no-account row actions together, with the username next to the replacement action.
- Credential replacement dialog: replaces a password, a PIN, or both while clearly preserving blank credentials.
- First-PIN variant: explains the register behavior that begins when a PIN is first set.
- Validation: covers password intent with an empty value, invalid PIN, and neither field supplied.
- Saving: disables controls and labels the primary action as pending.
- Success: distinguishes password only, PIN only, both, and first PIN set.
- Refusals and failure: distinguishes no login account (409), missing staff member (404), and a generic save failure.
- Responsive roster and dialog: table on desktop, labelled cards and stacked actions at 640px and below.

## 2. Implementation handoff

### a. Requirements inherited

- Both new credential fields must be concealed during entry with `type="password"`.
- A blank password means the password remains unchanged. A blank PIN means the PIN remains unchanged, or remains unset when the account has no PIN.
- There is no read path for an existing password or PIN. Never render a value, masked value, placeholder, length hint, or reveal control for an existing credential.
- At least one new credential is required. Refuse a submission when both fields are blank.
- A new password must contain at least 1 character. Do not trim it. Preserve leading spaces, trailing spaces, and whitespace-only passwords exactly.
- A new PIN must contain exactly four ASCII digits from 0 to 9.
- A success response identifies only which credential changed. It never repeats the new value.
- Replacing credentials does not end active sessions. Do not claim devices or sessions were signed out. Existing sessions last until logout or the existing 8-hour expiry.
- The 409 no-account refusal, 404 staff-not-found refusal, and generic save failure must remain distinguishable.
- On every refusal or failure, state that nothing changed and the old credentials still work.
- Credential replacement changes only the selected login account credentials. Nothing else about the staff member changes.
- The staff member name and linked username must remain visible in the dialog so the administrator can verify the target.

The requested password-error mockup represents an explicit password replacement attempt that reached validation with no value. In normal optional-field submission, a blank password alongside a valid PIN means the password is unchanged and is not an error.

### b. Advisory recommendations

- Keep the roster account username directly above the replacement action. This makes the target identity available at the decision point without adding another screen.
- Use the action label "Replace password or PIN" instead of the broad "Manage login account" label for this recovery path.
- Keep a per-credential state line under each field. Update it as input changes so the administrator can review what will and will not change before saving.
- Keep the first-PIN warning next to the PIN field, not in a generic confirmation step.
- Keep the dialog to one step. A second confirmation adds friction without revealing any useful credential detail.
- Use a desktop table and a mobile card transform at 640px. Preserve explicit data labels in cards and stack full-width actions.
- Keep the mockup state picker out of production. It is prototype chrome only.
- Use no decorative motion. Immediate focus, validation, and status announcements provide the necessary state feedback.

### c. Proposed changes to shipped shared components

- Replace the current "Manage login account" dialog panel that says credential changes are "not available yet" with this credential replacement form. Reason: the feature now provides the missing recovery action, and retaining the placeholder panel would create a dead end.
- Change the roster row action wording from "Manage login account" to "Replace password or PIN" where this is the available action. Reason: the narrower label communicates the exact security-sensitive operation and reduces accidental entry.
- Mask the PIN field in the existing create-account dialog by changing it to `type="password"` and adding the same accessible Show/Hide pattern. Reason: PINs are credentials and can be shoulder-surfed. This is a deliberate recommended deviation from the currently shipped create-account field, not a story requirement for the existing dialog.
- Add an account-identity text slot to the shared row action area. Reason: showing the username beside the action reduces wrong-person changes without adding a new page.
- Add a reusable credential-state line to the shared form field component. Reason: "will not change," "will be replaced," and "will be set for the first time" are reviewable states that ordinary help text does not communicate dynamically.

## 3. Copy deck

### Dialog framing

- Title: "Replace password or PIN"
- Description pattern: "Replace credentials for {staff name}. Login account: {username}."
- Primary action: "Save credential changes"
- Saving action: "Saving changes..."
- Secondary action: "Cancel"
- Close action: "Close"

### Password field

- Label: "New password"
- Help: "Leave blank to keep the password unchanged. A new password must contain at least 1 character. Spaces, including leading, trailing, or whitespace-only characters, are preserved exactly and are not trimmed."
- Blank state: "Password: will not change"
- Entered state: "Password: new value entered - will be replaced"
- Error: "Enter a new password with at least 1 character."
- Neither-entered error: "Enter a new password here or enter a new PIN below."
- Reveal labels: "Show new password" and "Hide new password"

### PIN field, existing PIN

- Label: "New PIN"
- Help: "Leave blank to keep the PIN unchanged. To replace it, enter exactly four digits from 0 to 9."
- Blank state: "PIN: currently set - will not change"
- Entered state: "PIN: new value entered - will be replaced"
- Error: "Enter exactly four digits using 0 to 9 only."
- Neither-entered error: "Enter a new PIN here or enter a new password above."
- Reveal labels: "Show new PIN" and "Hide new PIN"

### PIN field, no PIN yet

- Help: "No PIN is set. Leave blank to keep this account without a PIN, or enter exactly four digits from 0 to 9 to set one."
- Blank state: "PIN: not set - will remain not set"
- Entered state: "PIN: new value entered - will be set for the first time"
- Warning title: "Setting a PIN for the first time"
- Warning: "After a PIN is set, {staff first name} will be asked for it whenever they are selected as the active cashier at the register."

### Error summary

- Title: "Notice"
- Introduction: "Check the following before saving:"
- Password link: "Enter a new password."
- PIN link: "Enter a PIN using exactly four digits."
- Neither-entered link: "Enter a new password, a new PIN, or both."

### Success

- Password only title: "Password replaced"
- Password only: "{staff name}'s password was replaced for account {username}. The new password is active for future sign-ins."
- PIN only title: "PIN replaced"
- PIN only: "{staff name}'s PIN was replaced for account {username}. The new PIN is active for future cashier selection."
- Both title: "Password and PIN replaced"
- Both: "{staff name}'s password and PIN were replaced for account {username}. The new credentials are active for future use."
- First PIN title: "PIN set for the first time"
- First PIN: "{staff name} now has a PIN for account {username}. They will be asked for it when selected as the active cashier."
- Session note: "Sessions already signed in are not ended. They continue until logout or the existing 8-hour session expiry."
- Completion action: "Done"

### Refusals and failure

- 409 title: "No login account"
- 409: "No credentials were changed. {staff name} does not have a login account, so there is no password or PIN to replace. Any existing staff record is unchanged."
- 404 title: "Staff member not found"
- 404: "No credentials were changed. This staff member no longer exists. If an old login account is still shown elsewhere, refresh the staff list before trying again."
- Generic title: "Credential changes could not be saved"
- Generic: "Nothing changed. The previous password and PIN still work. Try again. If the problem continues, contact the system administrator."
- Shared assurance: "The old credentials still work."
- Retry action: "Try again"
- Exit action: "Back to staff"

## 4. Accessibility notes

- The modal uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and `aria-describedby`.
- Focus lands on the first credential field when the form opens.
- Tab and Shift+Tab cycle within the dialog. Escape closes the dialog only while it is not saving.
- Closing returns focus to the invoking row action or state-picker button.
- Invalid fields use `aria-invalid="true"` and reference both persistent help and the field error through `aria-describedby`.
- The Notice block uses `role="alert"`; each summary link targets the relevant field.
- Success uses `role="status"` and `aria-live="polite"`. Refusal and save failure panels use `role="alert"` for immediate announcement.
- Show/Hide controls update their accessible names and never expose an existing credential.
- All controls meet the 44px target minimum. Fields remain 48px high.
- The mobile card layout keeps visible data labels, source order, and full-width actions.
- Focus rings use `--focus` and remain visible against all light surfaces.

## 5. Token usage

No new design tokens are required. The supplied UCM Coffee Studio POS tokens carry the complete feature: `--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--border-strong`, `--surface-subtle`, and `--ink-soft` provide the neutral admin hierarchy; `--accent`, `--accent-hover`, `--accent-pressed`, and `--focus` handle primary controls and focus; `--danger` and `--danger-surface` handle errors and refusals; `--warn-ink`, `--warn-surface`, and `--warn-border` handle the first-PIN warning; `--success-surface` supports success; the supplied spacing, radius, touch, field-height, font, and control-shadow values provide layout and control geometry.
