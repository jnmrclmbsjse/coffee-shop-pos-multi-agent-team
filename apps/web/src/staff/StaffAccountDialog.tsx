import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type {
  CreateStaffAccountInput,
  CreateStaffAccountResponse,
  StaffMember,
} from '@coffee-shop/shared';
import { Notice } from '../catalog/components';
import { createStaffAccount, StaffApiError } from './api';

type AccountField = 'username' | 'displayName' | 'password' | 'pin';
type AccountErrors = Partial<Record<AccountField, string>>;

interface AccountDraft {
  username: string;
  displayName: string;
  password: string;
  pin: string;
}

interface AccountSuccess extends CreateStaffAccountResponse {
  linkedStaffName: string;
  pinSet: boolean;
}

const USERNAME_REQUIRED = 'Enter a username.';
const USERNAME_SPACES = 'Enter a username that is not only spaces.';
const USERNAME_TAKEN =
  'That username is already in use. Usernames ignore uppercase letters and spaces at the beginning or end.';
const PASSWORD_REQUIRED = 'Enter a password.';
const PIN_LENGTH = 'Enter exactly 4 digits, or leave the PIN blank.';
const PIN_DIGITS = 'Use digits only, or leave the PIN blank.';

function focusableControls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

function validateAccount(draft: AccountDraft): AccountErrors {
  const errors: AccountErrors = {};
  if (!draft.username) errors.username = USERNAME_REQUIRED;
  else if (!draft.username.trim()) errors.username = USERNAME_SPACES;
  if (!draft.password) errors.password = PASSWORD_REQUIRED;
  if (draft.pin && !/^\d+$/.test(draft.pin)) errors.pin = PIN_DIGITS;
  else if (draft.pin && draft.pin.length !== 4) errors.pin = PIN_LENGTH;
  return errors;
}

function serverValidationErrors(error: StaffApiError): AccountErrors {
  const errors: AccountErrors = {};
  for (const message of error.messages) {
    const lower = message.toLocaleLowerCase('en-US');
    if (lower.includes('username')) errors.username = USERNAME_REQUIRED;
    else if (lower.includes('password')) errors.password = PASSWORD_REQUIRED;
    else if (lower.includes('pin')) errors.pin = PIN_LENGTH;
    else if (lower.includes('displayname')) {
      errors.displayName = 'Enter a display name, or leave it blank.';
    }
  }
  return errors;
}

function fieldDescription(helpId: string, errorId: string, error?: string) {
  return error ? `${helpId} ${errorId}` : helpId;
}

export function StaffAccountDialog({
  member,
  onClose,
}: {
  member: StaffMember;
  onClose: (created: boolean) => void;
}) {
  const [draft, setDraft] = useState<AccountDraft>({
    username: '',
    displayName: member.displayName,
    password: '',
    pin: '',
  });
  const [errors, setErrors] = useState<AccountErrors>({});
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState<AccountSuccess | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => usernameRef.current?.focus());
  }, []);

  useEffect(() => {
    if (success) requestAnimationFrame(() => doneButtonRef.current?.focus());
  }, [success]);

  useEffect(() => {
    if (saving) requestAnimationFrame(() => dialogRef.current?.focus());
  }, [saving]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        onClose(Boolean(success));
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = focusableControls(dialogRef.current);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving, success]);

  function updateField(field: AccountField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDialogError('');
  }

  function focusFirstError(nextErrors: AccountErrors) {
    const firstField = (['username', 'displayName', 'password', 'pin'] as const)
      .find((field) => Boolean(nextErrors[field]));
    requestAnimationFrame(() => {
      if (firstField === 'username') usernameRef.current?.focus();
      else document.getElementById(`staff-account-${firstField}`)?.focus();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const clientErrors = validateAccount(draft);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      focusFirstError(clientErrors);
      return;
    }

    const input: CreateStaffAccountInput = {
      username: draft.username.trim().toLocaleLowerCase('en-US'),
      password: draft.password,
    };
    const displayName = draft.displayName.trim();
    if (displayName) input.displayName = displayName;
    if (draft.pin) input.pin = draft.pin;

    setSaving(true);
    setErrors({});
    setDialogError('');
    try {
      const created = await createStaffAccount(member.id, input);
      setSuccess({
        ...created,
        linkedStaffName: member.displayName,
        pinSet: Boolean(input.pin),
      });
      setDraft({ username: '', displayName: '', password: '', pin: '' });
      setShowPassword(false);
    } catch (error) {
      if (error instanceof StaffApiError && error.status === 400) {
        const nextErrors = serverValidationErrors(error);
        if (Object.keys(nextErrors).length > 0) {
          setErrors(nextErrors);
          focusFirstError(nextErrors);
        } else {
          setDialogError(error.messages.join(' '));
        }
      } else if (
        error instanceof StaffApiError &&
        error.status === 409 &&
        (error.field === 'username' || error.reason === 'USERNAME_TAKEN')
      ) {
        const nextErrors = { username: USERNAME_TAKEN };
        setErrors(nextErrors);
        focusFirstError(nextErrors);
      } else if (
        error instanceof StaffApiError &&
        error.reason === 'STAFF_MEMBER_ALREADY_HAS_ACCOUNT'
      ) {
        setDialogError(
          'This staff member already has a login account. Nothing was created or changed.',
        );
      } else if (
        error instanceof StaffApiError &&
        error.reason === 'STAFF_MEMBER_INACTIVE'
      ) {
        setDialogError(
          'This staff member is inactive. Activate the staff member before creating an account. Nothing was created or changed.',
        );
      } else {
        setDialogError(
          error instanceof StaffApiError
            ? error.messages.join(' ')
            : 'The login account could not be created. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const errorItems = (Object.entries(errors) as [AccountField, string][])
    .filter((entry): entry is [AccountField, string] => Boolean(entry[1]));

  return (
    <div
      className="inventory-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose(Boolean(success));
        }
      }}
    >
      <section
        ref={dialogRef}
        className="inventory-modal staff-modal staff-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-account-dialog-title"
        aria-describedby="staff-account-dialog-description"
        tabIndex={-1}
      >
        <div className="inventory-modal-head">
          <div>
            <h2 id="staff-account-dialog-title">Create login account</h2>
            <p id="staff-account-dialog-description">
              Create an account linked to <strong>{member.displayName}</strong>.
            </p>
          </div>
          <button
            className="catalog-button small"
            type="button"
            aria-label="Close login account dialog"
            disabled={saving}
            onClick={() => onClose(Boolean(success))}
          >
            Close
          </button>
        </div>

        {success ? (
          <div className="staff-account-success" role="status" aria-live="polite">
            <h3>Login account created</h3>
            <p>The account is ready to use.</p>
            <dl>
              <div>
                <dt>Username</dt>
                <dd>{success.username}</dd>
              </div>
              <div>
                <dt>Linked staff member</dt>
                <dd>{success.linkedStaffName}</dd>
              </div>
              <div>
                <dt>PIN set</dt>
                <dd>{success.pinSet ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <p className="staff-account-privacy">
              The password and PIN are not shown.
            </p>
            <div className="staff-modal-actions">
              <button
                ref={doneButtonRef}
                className="catalog-button primary"
                type="button"
                onClick={() => onClose(true)}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form noValidate onSubmit={submit}>
            {errorItems.length > 0 && (
              <Notice
                tone="danger"
                title={
                  errorItems.length === 1
                    ? 'There is a problem.'
                    : 'Review the fields below.'
                }
              >
                <ul className="staff-account-error-list">
                  {errorItems.map(([field, message]) => (
                    <li key={field}>
                      <a href={`#staff-account-${field}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {dialogError && (
              <Notice tone="danger" title="No account was created.">
                <p>{dialogError}</p>
              </Notice>
            )}

            <div className="catalog-field">
              <label htmlFor="staff-account-username">Username</label>
              <input
                ref={usernameRef}
                id="staff-account-username"
                autoComplete="username"
                value={draft.username}
                aria-invalid={Boolean(errors.username)}
                aria-describedby={fieldDescription(
                  'staff-account-username-help',
                  'staff-account-username-error',
                  errors.username,
                )}
                disabled={saving}
                onChange={(event) => updateField('username', event.target.value)}
              />
              <p className="catalog-field-help" id="staff-account-username-help">
                Required. Spaces at the beginning and end are removed, and uppercase letters do not make a username different.
              </p>
              {errors.username && (
                <p className="catalog-field-error" id="staff-account-username-error">
                  {errors.username}
                </p>
              )}
            </div>

            <div className="catalog-field">
              <label htmlFor="staff-account-displayName">Display name</label>
              <input
                id="staff-account-displayName"
                autoComplete="name"
                value={draft.displayName}
                aria-invalid={Boolean(errors.displayName)}
                aria-describedby={fieldDescription(
                  'staff-account-displayName-help',
                  'staff-account-displayName-error',
                  errors.displayName,
                )}
                disabled={saving}
                onChange={(event) => updateField('displayName', event.target.value)}
              />
              <p className="catalog-field-help" id="staff-account-displayName-help">
                Optional. Prefilled from the staff roster and can be changed.
              </p>
              {errors.displayName && (
                <p className="catalog-field-error" id="staff-account-displayName-error">
                  {errors.displayName}
                </p>
              )}
            </div>

            <div className="catalog-field">
              <label htmlFor="staff-account-password">Password</label>
              <div className="staff-account-input-row">
                <input
                  id="staff-account-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={draft.password}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={fieldDescription(
                    'staff-account-password-help',
                    'staff-account-password-error',
                    errors.password,
                  )}
                  disabled={saving}
                  onChange={(event) => updateField('password', event.target.value)}
                />
                <button
                  className="catalog-button small"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={saving}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="catalog-field-help" id="staff-account-password-help">
                Required. At least 1 character. Passwords are case-sensitive, and spaces are preserved exactly.
              </p>
              {errors.password && (
                <p className="catalog-field-error" id="staff-account-password-error">
                  {errors.password}
                </p>
              )}
            </div>

            <div className="catalog-field">
              <label htmlFor="staff-account-pin">PIN</label>
              <input
                id="staff-account-pin"
                inputMode="numeric"
                autoComplete="off"
                value={draft.pin}
                aria-invalid={Boolean(errors.pin)}
                aria-describedby={fieldDescription(
                  'staff-account-pin-help',
                  'staff-account-pin-error',
                  errors.pin,
                )}
                disabled={saving}
                onChange={(event) => updateField('pin', event.target.value)}
              />
              <p className="catalog-field-help" id="staff-account-pin-help">
                Optional. Use exactly 4 digits. Leave blank if PIN sign-in is not needed. PIN sign-in becomes available on this device after the first username and password sign-in.
              </p>
              {errors.pin && (
                <p className="catalog-field-error" id="staff-account-pin-error">
                  {errors.pin}
                </p>
              )}
            </div>

            <div className="staff-modal-actions">
              <button
                className="catalog-button"
                type="button"
                disabled={saving}
                onClick={() => onClose(false)}
              >
                Cancel
              </button>
              <button
                className="catalog-button primary"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Creating...' : 'Create account'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
