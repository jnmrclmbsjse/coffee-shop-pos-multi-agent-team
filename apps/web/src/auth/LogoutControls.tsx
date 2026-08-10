import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext';
import { logout } from './api';

const LOGOUT_FAILURE = 'Sign out failed. Check the connection and try again.';

function SignOutIcon() {
  return (
    <svg className="sign-out-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M7 3H3.5v12H7M10.5 5.5 14 9l-3.5 3.5M6 9h8" />
    </svg>
  );
}

function SignOutButton({
  busy,
  onClick,
  triggerRef,
  opensDialog = false,
  dialogOpen = false,
}: {
  busy: boolean;
  onClick: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  opensDialog?: boolean;
  dialogOpen?: boolean;
}) {
  return (
    <button
      ref={triggerRef}
      className="sign-out-button"
      type="button"
      disabled={busy}
      aria-busy={busy}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      aria-expanded={opensDialog ? dialogOpen : undefined}
      onClick={onClick}
    >
      <span className="sign-out-button-content">
        {busy ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <SignOutIcon />
        )}
        <span>{busy ? 'Signing out…' : 'Sign out'}</span>
      </span>
    </button>
  );
}

export function AdminLogoutControl() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await logout();
      auth.completeLogout();
    } catch {
      setError(LOGOUT_FAILURE);
      setBusy(false);
    }
  };

  return (
    <div className="admin-sign-out">
      <SignOutButton busy={busy} onClick={() => void signOut()} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function focusableButtons(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
}

export function StaffLogoutControl() {
  const auth = useAuth();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() => cancelRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open && busy) {
      dialogRef.current?.focus();
    }
  }, [busy, open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await logout();
      auth.completeLogout();
    } catch {
      setError(LOGOUT_FAILURE);
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const buttons = focusableButtons(dialogRef.current);
    if (buttons.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = buttons[0]!;
    const last = buttons.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  return (
    <>
      <SignOutButton
        busy={busy}
        onClick={() => setOpen(true)}
        triggerRef={triggerRef}
        opensDialog
        dialogOpen={open}
      />
      {open &&
        createPortal(
          <div className="logout-dialog-backdrop" onMouseDown={handleBackdrop}>
            <div
              ref={dialogRef}
              className="logout-dialog"
              role="dialog"
              tabIndex={-1}
              aria-modal="true"
              aria-labelledby="logout-dialog-title"
              aria-describedby="logout-dialog-description"
              onKeyDown={handleKeyDown}
            >
              <h2 id="logout-dialog-title">Sign out of this session?</h2>
              <p id="logout-dialog-description">
                Signing out ends your session on this browser. The active
                cashier on this till stays as it is.
              </p>
              {error && (
                <p className="logout-dialog-error" role="alert">
                  {error}
                </p>
              )}
              <div className="logout-dialog-actions">
                <button
                  ref={cancelRef}
                  type="button"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  className="is-primary"
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => void signOut()}
                >
                  {busy ? (
                    <span className="button-loading">
                      <span className="spinner" aria-hidden="true" />
                      Signing out…
                    </span>
                  ) : (
                    'Sign out'
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
