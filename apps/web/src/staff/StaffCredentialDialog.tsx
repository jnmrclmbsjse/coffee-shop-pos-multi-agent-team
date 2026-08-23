import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type {
  StaffMember,
  UpdateStaffCredentialsInput,
  UpdateStaffCredentialsResponse,
} from '@coffee-shop/shared';
import { Notice } from '../catalog/components';
import { StaffApiError, updateStaffCredentials } from './api';

type CredentialField = 'password' | 'pin';
type CredentialErrors = Partial<Record<CredentialField, string>>;

interface CredentialDraft {
  password: string;
  pin: string;
}

interface Refusal {
  title: string;
  message: string;
}

const EMPTY_DRAFT: CredentialDraft = { password: '', pin: '' };
const PASSWORD_REQUIRED = 'Enter a new password with at least 1 character.';
const PIN_INVALID = 'Enter exactly four digits using 0 to 9 only.';
const CREDENTIAL_REQUIRED = 'Enter a new password, a new PIN, or both.';

function focusableControls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

function fieldDescription(
  helpId: string,
  stateId: string,
  errorId: string,
  error?: string,
): string {
  return error ? `${helpId} ${stateId} ${errorId}` : `${helpId} ${stateId}`;
}

function serverValidationErrors(error: StaffApiError): CredentialErrors {
  const errors: CredentialErrors = {};
  if (error.field === 'password') errors.password = PASSWORD_REQUIRED;
  if (error.field === 'pin') errors.pin = PIN_INVALID;

  for (const message of error.messages) {
    const lower = message.toLocaleLowerCase('en-US');
    if (lower.includes('password')) errors.password = PASSWORD_REQUIRED;
    if (lower.includes('pin')) errors.pin = PIN_INVALID;
  }
  return errors;
}

function successCopy(
  result: UpdateStaffCredentialsResponse,
  member: StaffMember,
): { title: string; message: string } {
  const account = member.accountUsername ?? 'the linked login account';
  if (result.passwordChanged && result.pinChanged) {
    return {
      title: 'Password and PIN replaced',
      message: `${member.displayName}'s password and PIN were replaced for account ${account}. The new credentials are active for future use.`,
    };
  }
  if (result.passwordChanged) {
    return {
      title: 'Password replaced',
      message: `${member.displayName}'s password was replaced for account ${account}. The new password is active for future sign-ins.`,
    };
  }
  return {
    title: 'PIN replaced',
    message: `${member.displayName}'s PIN was replaced for account ${account}. The new PIN is active for future PIN sign-ins and cashier selection.`,
  };
}

export function StaffCredentialDialog({
  member,
  onClose,
  onUpdated,
}: {
  member: StaffMember;
  onClose: (changed: boolean) => void;
  onUpdated: (member: StaffMember) => void;
}) {
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [formError, setFormError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] =
    useState<UpdateStaffCredentialsResponse | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  useEffect(() => {
    if (success) doneButtonRef.current?.focus();
  }, [success]);

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
      } else if (event.shiftKey && document.activeElement === first) {
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

  function updateField(field: CredentialField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setRefusal(null);
  }

  function focusFirstError(nextErrors: CredentialErrors) {
    requestAnimationFrame(() => {
      if (nextErrors.password) passwordRef.current?.focus();
      else if (nextErrors.pin) {
        document.getElementById('staff-credential-pin')?.focus();
      } else passwordRef.current?.focus();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const nextErrors: CredentialErrors = {};
    if (draft.pin && !/^\d{4}$/.test(draft.pin)) nextErrors.pin = PIN_INVALID;

    const neitherEntered = !draft.password && !draft.pin;
    setFormError(neitherEntered ? CREDENTIAL_REQUIRED : '');
    if (Object.keys(nextErrors).length > 0 || neitherEntered) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    const input: UpdateStaffCredentialsInput = {};
    if (draft.password) input.password = draft.password;
    if (draft.pin) input.pin = draft.pin;

    setSaving(true);
    setErrors({});
    setFormError('');
    setRefusal(null);
    try {
      const updated = await updateStaffCredentials(member.id, input);
      setDraft(EMPTY_DRAFT);
      setSuccess(updated);
      onUpdated(updated.staffMember);
    } catch (error) {
      if (error instanceof StaffApiError && error.status === 400) {
        const validationErrors = serverValidationErrors(error);
        if (Object.keys(validationErrors).length > 0) {
          setErrors(validationErrors);
          focusFirstError(validationErrors);
        } else {
          setRefusal({
            title: 'Credential changes were refused',
            message: `Nothing changed. The previous password and PIN still work. ${error.messages.join(' ')}`,
          });
        }
      } else if (
        error instanceof StaffApiError &&
        error.status === 409 &&
        error.reason === 'STAFF_MEMBER_HAS_NO_ACCOUNT'
      ) {
        setRefusal({
          title: 'No login account',
          message: `No credentials were changed. ${member.displayName} does not have a login account, so there is no password or PIN to replace.`,
        });
      } else if (error instanceof StaffApiError && error.status === 404) {
        setRefusal({
          title: 'Staff member not found',
          message: 'No credentials were changed. This staff member no longer exists. Refresh the staff list before trying again.',
        });
      } else if (error instanceof StaffApiError && error.status === 403) {
        setRefusal({
          title: 'Access denied',
          message: 'No credentials were changed. Administrator access is required to replace a staff password or PIN.',
        });
      } else {
        setRefusal({
          title: 'Credential changes could not be saved',
          message: 'Nothing changed. The previous password and PIN still work. Try again. If the problem continues, contact the system administrator.',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const errorItems = (Object.entries(errors) as [CredentialField, string][])
    .filter((entry): entry is [CredentialField, string] => Boolean(entry[1]));
  const successMessage = success ? successCopy(success, member) : null;

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
        className="inventory-modal staff-modal staff-credential-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-credential-dialog-title"
        aria-describedby="staff-credential-dialog-description"
        tabIndex={-1}
      >
        <div className="inventory-modal-head">
          <div>
            <h2 id="staff-credential-dialog-title">Replace password or PIN</h2>
            <p id="staff-credential-dialog-description">
              Replace credentials for <strong>{member.displayName}</strong>.
              Login account: <strong>{member.accountUsername}</strong>.
            </p>
          </div>
          <button
            className="catalog-button small"
            type="button"
            aria-label="Close credential replacement dialog"
            disabled={saving}
            onClick={() => onClose(Boolean(success))}
          >
            Close
          </button>
        </div>

        {success && successMessage ? (
          <div
            className="staff-account-success staff-credential-success"
            role="status"
            aria-live="polite"
          >
            <h3>{successMessage.title}</h3>
            <p>{successMessage.message}</p>
            <p className="staff-account-privacy">
              Sessions already signed in were not ended. They continue until
              logout or the existing 8-hour session expiry.
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
            {(formError || errorItems.length > 0) && (
              <Notice tone="danger" title="Check the following before saving:">
                <ul className="staff-account-error-list">
                  {formError && (
                    <li>
                      <a href="#staff-credential-password">{formError}</a>
                    </li>
                  )}
                  {errorItems.map(([field, message]) => (
                    <li key={field}>
                      <a href={`#staff-credential-${field}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {refusal && (
              <Notice tone="danger" title={refusal.title}>
                <p>{refusal.message}</p>
              </Notice>
            )}

            <div className="catalog-field">
              <label htmlFor="staff-credential-password">New password</label>
              <input
                ref={passwordRef}
                id="staff-credential-password"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={fieldDescription(
                  'staff-credential-password-help',
                  'staff-credential-password-state',
                  'staff-credential-password-error',
                  errors.password,
                )}
                disabled={saving}
                onChange={(event) => updateField('password', event.target.value)}
              />
              <p
                className="catalog-field-help"
                id="staff-credential-password-help"
              >
                Leave blank to keep the password unchanged. A new password must
                contain at least 1 character. Spaces are preserved exactly and
                are not trimmed.
              </p>
              <p
                className="staff-credential-state"
                id="staff-credential-password-state"
              >
                Password: {draft.password ? 'will be replaced' : 'will not change'}
              </p>
              {errors.password && (
                <p
                  className="catalog-field-error"
                  id="staff-credential-password-error"
                >
                  {errors.password}
                </p>
              )}
            </div>

            <div className="catalog-field">
              <label htmlFor="staff-credential-pin">New PIN</label>
              <input
                id="staff-credential-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={draft.pin}
                aria-invalid={Boolean(errors.pin)}
                aria-describedby={fieldDescription(
                  'staff-credential-pin-help',
                  'staff-credential-pin-state',
                  'staff-credential-pin-error',
                  errors.pin,
                )}
                disabled={saving}
                onChange={(event) => updateField('pin', event.target.value)}
              />
              <p className="catalog-field-help" id="staff-credential-pin-help">
                Leave blank to keep the PIN unchanged. To replace or set it,
                enter exactly four digits from 0 to 9.
              </p>
              <p className="staff-credential-state" id="staff-credential-pin-state">
                PIN: {draft.pin ? 'will be replaced' : 'will not change'}
              </p>
              {errors.pin && (
                <p className="catalog-field-error" id="staff-credential-pin-error">
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
                {saving ? 'Saving changes...' : 'Save credential changes'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
