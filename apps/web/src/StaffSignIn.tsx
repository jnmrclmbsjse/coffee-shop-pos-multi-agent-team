import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StaffAuthenticatedUser } from '@coffee-shop/shared';
import { Role } from '@coffee-shop/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import {
  AuthenticationError,
  staffPasswordLogin,
  staffPinLogin,
} from './auth/api';
import {
  getDeviceId,
  readRememberedStaff,
  rememberStaff,
  type RememberedStaff,
} from './auth/device';

const GENERIC_FAILURE =
  'We could not sign you in. Check your details and try again.';

type StaffSignInView = 'picker' | 'password' | 'pin';

function initials(displayName: string): string {
  const value = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
  return value || 'ST';
}

function throttleMessage(seconds: number): string {
  return `Too many failed attempts. Try again in ${seconds} second${
    seconds === 1 ? '' : 's'
  }.`;
}

function StaffBrand() {
  return (
    <div className="staff-brand" aria-label="UCM Coffee Studio, staff sign-in">
      <span className="staff-brand-mark" aria-hidden="true">
        UCM
      </span>
      <span>
        <strong>UCM Coffee Studio</strong>
        <small>Staff sign-in</small>
      </span>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return (
    <div className="staff-status" role="alert">
      {message}
    </div>
  );
}

function LoadingLabel({ loading }: { loading: boolean }) {
  return loading ? (
    <span className="button-loading">
      <span className="spinner" aria-hidden="true" />
      Signing in…
    </span>
  ) : (
    'Sign in'
  );
}

function StaffSessionLoading() {
  return (
    <main className="staff-session-loading" aria-live="polite">
      <StaffBrand />
      <span className="spinner spinner-dark" aria-hidden="true" />
      <p>Checking staff access…</p>
    </main>
  );
}

export function StaffSignInPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [rememberedStaff, setRememberedStaff] = useState(readRememberedStaff);
  const [view, setView] = useState<StaffSignInView>('picker');
  const [selectedStaff, setSelectedStaff] =
    useState<RememberedStaff | null>(null);
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Staff sign-in · UCM Coffee Studio';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (
      auth.status === 'authenticated' &&
      auth.user?.role === Role.STAFF
    ) {
      navigate('/pos', { replace: true });
    }
  }, [auth.status, auth.user?.role, navigate]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds > 0]);

  useEffect(() => {
    if (retryAfterSeconds > 0) {
      setStatusMessage(throttleMessage(retryAfterSeconds));
      return;
    }

    setStatusMessage((message) =>
      message.startsWith('Too many') ? '' : message,
    );
  }, [retryAfterSeconds]);

  function showView(nextView: StaffSignInView) {
    setView(nextView);
    setStatusMessage('');
    setRetryAfterSeconds(0);
    if (nextView !== 'pin') {
      setSelectedStaff(null);
    }
    setPin('');
    if (nextView === 'password') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }

  function recordFailure(error: unknown) {
    if (
      error instanceof AuthenticationError &&
      error.retryAfterSeconds !== null
    ) {
      setRetryAfterSeconds(error.retryAfterSeconds);
      setStatusMessage(throttleMessage(error.retryAfterSeconds));
      return;
    }

    setStatusMessage(GENERIC_FAILURE);
  }

  function completeStaffLogin(user: StaffAuthenticatedUser) {
    auth.completeLogin(user);
    navigate('/pos', { replace: true });
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      isSubmitting ||
      retryAfterSeconds > 0 ||
      !username.trim() ||
      !password
    ) {
      if (!username.trim() || !password) {
        setStatusMessage(GENERIC_FAILURE);
      }
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('');
    try {
      const user = await staffPasswordLogin({
        username,
        password,
        deviceId: getDeviceId(),
      });
      setRememberedStaff(rememberStaff(user));
      completeStaffLogin(user);
    } catch (error) {
      recordFailure(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePinSubmit() {
    if (
      !selectedStaff ||
      pin.length !== 4 ||
      isSubmitting ||
      retryAfterSeconds > 0
    ) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('');
    try {
      const user = await staffPinLogin({
        staffId: selectedStaff.id,
        pin,
        deviceId: getDeviceId(),
      });
      completeStaffLogin(user);
    } catch (error) {
      setPin('');
      recordFailure(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const controlsLocked = isSubmitting || retryAfterSeconds > 0;

  if (auth.status === 'checking') {
    return <StaffSessionLoading />;
  }

  return (
    <div className="staff-auth-app">
      <header className="staff-topbar">
        <StaffBrand />
        <a className="admin-sign-in-link" href="/sign-in">
          Administrator sign-in
        </a>
      </header>

      <main className="staff-workspace">
        <section className="staff-auth-surface" aria-label="Staff sign-in">
          {view === 'picker' && (
            <>
              <header className="staff-view-header">
                <h1>Who’s signing in?</h1>
                <p>Choose your name to use your staff PIN.</p>
              </header>

              {rememberedStaff.length > 0 ? (
                <>
                  <div className="staff-picker-grid">
                    {rememberedStaff.map((staff) => (
                      <button
                        className="staff-picker-tile"
                        type="button"
                        key={staff.id}
                        onClick={() => {
                          setSelectedStaff(staff);
                          setPin('');
                          setStatusMessage('');
                          setView('pin');
                        }}
                      >
                        <span className="staff-avatar" aria-hidden="true">
                          {initials(staff.displayName)}
                        </span>
                        <span>
                          <strong>{staff.displayName}</strong>
                          <small>Remembered on this device</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="staff-alternate-path">
                    <p>
                      Not listed, or signing in on this device for the first
                      time?
                    </p>
                    <button
                      className="staff-text-button"
                      type="button"
                      onClick={() => showView('password')}
                    >
                      Use Username and Password
                    </button>
                  </div>
                </>
              ) : (
                <div className="staff-empty-state">
                  <span className="staff-empty-symbol" aria-hidden="true">
                    +
                  </span>
                  <h2>No staff remembered on this device</h2>
                  <p>
                    Sign in with your Username and Password. A successful
                    sign-in will add you to this device for faster PIN access
                    next time.
                  </p>
                  <button
                    className="staff-primary-button staff-empty-action"
                    type="button"
                    onClick={() => showView('password')}
                  >
                    Use Username and Password
                  </button>
                </div>
              )}
            </>
          )}

          {view === 'password' && (
            <form
              className="staff-password-form"
              noValidate
              onSubmit={handlePasswordSubmit}
            >
              <header className="staff-view-header">
                <h1>Sign in with your account</h1>
                <p>
                  Use your staff account. Administrator credentials are not
                  accepted here.
                </p>
              </header>
              <StatusMessage message={statusMessage} />
              <div className="staff-field">
                <label htmlFor="staff-username">Username</label>
                <input
                  ref={firstFieldRef}
                  id="staff-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={controlsLocked}
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setStatusMessage('');
                  }}
                />
              </div>
              <div className="staff-field">
                <label htmlFor="staff-password">Password</label>
                <input
                  id="staff-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={controlsLocked}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setStatusMessage('');
                  }}
                />
              </div>
              <div className="staff-form-actions">
                <button
                  className="staff-primary-button"
                  type="submit"
                  disabled={controlsLocked}
                  aria-busy={isSubmitting}
                >
                  <LoadingLabel loading={isSubmitting} />
                </button>
                <button
                  className="staff-text-button"
                  type="button"
                  disabled={controlsLocked}
                  onClick={() => showView('picker')}
                >
                  Back to remembered staff
                </button>
              </div>
            </form>
          )}

          {view === 'pin' && selectedStaff && (
            <div className="staff-pin-layout">
              <section
                className="staff-identity-panel"
                aria-labelledby="selected-staff-name"
              >
                <div className="staff-identity-row">
                  <span className="staff-avatar is-selected" aria-hidden="true">
                    {initials(selectedStaff.displayName)}
                  </span>
                  <span className="staff-identity-copy">
                    <strong id="selected-staff-name">
                      {selectedStaff.displayName}
                    </strong>
                    <small>Remembered on this device</small>
                  </span>
                </div>
                <p className="staff-identity-prompt">
                  Enter your 4-digit staff PIN.
                </p>
                <div className="staff-pin-progress" aria-hidden="true">
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      className={`staff-pin-cell${
                        index < pin.length ? ' is-filled' : ''
                      }`}
                      key={index}
                    />
                  ))}
                </div>
                <p className="screen-reader-only" aria-live="polite">
                  {pin.length} of 4 PIN digits entered.
                </p>
                <button
                  className="staff-text-button choose-staff-button"
                  type="button"
                  disabled={controlsLocked}
                  onClick={() => showView('picker')}
                >
                  Choose another staff member
                </button>
              </section>

              <section className="staff-keypad-panel" aria-label="PIN keypad">
                <StatusMessage message={statusMessage} />
                <div className="staff-keypad">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                    <button
                      className="staff-key"
                      type="button"
                      key={digit}
                      disabled={controlsLocked || pin.length === 4}
                      onClick={() => {
                        setPin((value) => `${value}${digit}`.slice(0, 4));
                        setStatusMessage('');
                      }}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    className="staff-key staff-key-secondary"
                    type="button"
                    disabled={controlsLocked || pin.length === 0}
                    onClick={() => {
                      setPin('');
                      setStatusMessage('');
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className="staff-key"
                    type="button"
                    disabled={controlsLocked || pin.length === 4}
                    onClick={() => {
                      setPin((value) => `${value}0`.slice(0, 4));
                      setStatusMessage('');
                    }}
                  >
                    0
                  </button>
                  <button
                    className="staff-key staff-key-secondary"
                    type="button"
                    aria-label="Correct last PIN digit"
                    disabled={controlsLocked || pin.length === 0}
                    onClick={() => {
                      setPin((value) => value.slice(0, -1));
                      setStatusMessage('');
                    }}
                  >
                    Correct
                  </button>
                </div>
                <button
                  className="staff-primary-button staff-pin-submit"
                  type="button"
                  disabled={
                    controlsLocked || pin.length !== 4 || !selectedStaff
                  }
                  aria-busy={isSubmitting}
                  onClick={() => void handlePinSubmit()}
                >
                  <LoadingLabel loading={isSubmitting} />
                </button>
              </section>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
