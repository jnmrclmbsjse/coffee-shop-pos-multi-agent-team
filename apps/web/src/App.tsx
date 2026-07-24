import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { Role } from '@coffee-shop/shared';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { login } from './auth/api';
import { StaffSignInPage } from './StaffSignIn';
import { CategoriesPage } from './catalog/CategoriesPage';
import { ProductEditorPage } from './catalog/ProductEditorPage';
import { ProductsPage } from './catalog/ProductsPage';
import { Icon } from './catalog/components';

const DEFAULT_ADMIN_PATH = '/dashboard';
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';

function requestedPath(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export function safeReturnPath(candidate: string | null): string {
  if (!candidate || !candidate.startsWith('/')) {
    return DEFAULT_ADMIN_PATH;
  }

  try {
    const destination = new URL(candidate, window.location.origin);
    if (
      destination.origin !== window.location.origin ||
      destination.pathname === '/sign-in' ||
      destination.pathname.startsWith('/sign-in/')
    ) {
      return DEFAULT_ADMIN_PATH;
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
}

function destinationName(path: string): string {
  const [pathname = ''] = path.split('?');
  const names: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/catalog/categories': 'Categories',
    '/catalog/products': 'Products',
    '/inventory': 'Inventory',
    '/reports': 'Reports',
  };

  return names[pathname] ?? 'the requested admin page';
}

function Brand() {
  return (
    <div className="brand" aria-label="UCM Coffee Studio">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span className="brand-name">UCM Coffee Studio</span>
    </div>
  );
}

function SessionLoading() {
  return (
    <main className="session-loading" aria-live="polite">
      <Brand />
      <span className="spinner spinner-dark" aria-hidden="true" />
      <p>Checking administrator access…</p>
    </main>
  );
}

function ProtectedRoute({
  role,
  signInPath,
}: {
  role: Role;
  signInPath: string;
}) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'checking') {
    return <SessionLoading />;
  }

  if (auth.status === 'authenticated' && auth.user?.role !== role) {
    return (
      <Navigate
        replace
        to={auth.user?.role === Role.STAFF ? '/pos' : DEFAULT_ADMIN_PATH}
      />
    );
  }

  if (auth.status === 'signedOut') {
    const returnTo = requestedPath(location.pathname, location.search);
    return (
      <Navigate
        replace
        to={`${signInPath}?returnTo=${encodeURIComponent(returnTo)}`}
      />
    );
  }

  return <Outlet />;
}

function SignInPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnToParam = searchParams.get('returnTo');
  const returnTo = safeReturnPath(returnToParam);
  const cameFromProtectedRoute = returnToParam !== null;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formAlertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      auth.status === 'authenticated' &&
      auth.user?.role === Role.ADMIN
    ) {
      navigate(returnTo, { replace: true });
    }
  }, [auth.status, auth.user?.role, navigate, returnTo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const nextUsernameError =
      username.trim().length === 0 ? 'Username is required' : '';
    const nextPasswordError =
      password.length === 0 ? 'Password is required' : '';
    setUsernameError(nextUsernameError);
    setPasswordError(nextPasswordError);
    setFormError('');

    if (nextUsernameError || nextPasswordError) {
      const firstInvalidField = nextUsernameError
        ? event.currentTarget.elements.namedItem('username')
        : event.currentTarget.elements.namedItem('password');
      if (firstInvalidField instanceof HTMLElement) {
        firstInvalidField.focus();
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await login({ username, password });
      auth.completeLogin(user);
      navigate(returnTo, { replace: true });
    } catch {
      setFormError(INVALID_CREDENTIALS_MESSAGE);
      requestAnimationFrame(() => formAlertRef.current?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  if (auth.status === 'checking') {
    return <SessionLoading />;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <span className="access-label">Administrator access</span>
      </header>

      <main className="main-layout">
        <section className="context-panel" aria-labelledby="context-title">
          <div className="context-copy">
            <p className="eyebrow">UCM operations</p>
            <h1 id="context-title">A clear start to the shift.</h1>
            <p>
              Secure access for administrators managing the studio&apos;s point
              of sale and daily operations.
            </p>
          </div>
          <dl className="access-facts" aria-label="Access details">
            <div>
              <dt>Workspace</dt>
              <dd>UCM Coffee Studio</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>Administrators only</dd>
            </div>
          </dl>
        </section>

        <section className="sign-in-region" aria-labelledby="sign-in-title">
          <div className="sign-in-panel">
            <div className="panel-heading">
              <p className="eyebrow">Administrator</p>
              <h2 id="sign-in-title">Sign in</h2>
              <p>Use your administrator username and password.</p>
            </div>

            {cameFromProtectedRoute && (
              <div className="destination-context">
                <LockIcon />
                <p>
                  Sign in to continue to{' '}
                  <strong>{destinationName(returnTo)}</strong>.
                </p>
              </div>
            )}

            {formError && (
              <div
                className="form-alert"
                ref={formAlertRef}
                role="alert"
                tabIndex={-1}
              >
                <AlertIcon />
                <span>{formError}</span>
              </div>
            )}

            <form noValidate onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby={
                    usernameError ? 'username-error' : undefined
                  }
                  aria-invalid={Boolean(usernameError)}
                  disabled={isSubmitting}
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameError('');
                    setFormError('');
                  }}
                />
                {usernameError && (
                  <p className="field-error" id="username-error">
                    {usernameError}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="password-control">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    aria-describedby={
                      passwordError ? 'password-error' : undefined
                    }
                    aria-invalid={Boolean(passwordError)}
                    disabled={isSubmitting}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setPasswordError('');
                      setFormError('');
                    }}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    disabled={isSubmitting}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
                {passwordError && (
                  <p className="field-error" id="password-error">
                    {passwordError}
                  </p>
                )}
              </div>

              <button
                className={`submit-button${isSubmitting ? ' is-loading' : ''}`}
                type="submit"
                aria-busy={isSubmitting}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="button-loading">
                    <span className="spinner" aria-hidden="true" />
                    Signing in…
                  </span>
                ) : (
                  'Sign in'
                )}
              </button>
              <p className="form-note">
                Access is limited to active administrator accounts.
              </p>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}

function AdminLayout() {
  const auth = useAuth();

  return (
    <div className="admin-shell catalog-admin-shell">
      <aside className="admin-sidebar">
        <Brand />
        <nav aria-label="Administrator navigation">
          <span className="admin-nav-label">Workspace</span>
          <NavLink to="/dashboard">
            <Icon name="grid" />
            Dashboard
          </NavLink>
          <span className="admin-nav-label">Catalog</span>
          <NavLink to="/catalog/categories">
            <Icon name="grid" />
            Categories
          </NavLink>
          <NavLink to="/catalog/products">
            <Icon name="box" />
            Products
          </NavLink>
          <span className="admin-nav-label">Operations</span>
          <NavLink to="/inventory">
            <Icon name="box" />
            Inventory
          </NavLink>
          <NavLink to="/reports">
            <Icon name="grid" />
            Reports
          </NavLink>
        </nav>
        <div className="admin-sidebar-user">
          <span aria-hidden="true">
            {(auth.user?.username ?? 'A').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{auth.user?.username}</strong>
            <small>Administrator</small>
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <strong>UCM Coffee Studio</strong>
            <span>Back office</span>
          </div>
          <span className="access-label">
            Signed in as {auth.user?.username}
          </span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

function AdminPage({ title }: { title: string }) {
  return (
    <main className="admin-page">
      <p className="eyebrow">Administrator</p>
      <h1>{title}</h1>
      <p>This administrator area is ready for its upcoming workflow.</p>
    </main>
  );
}

function PointOfSalePage() {
  const auth = useAuth();

  useEffect(() => {
    document.title = 'Point of Sale · UCM Coffee Studio';
  }, []);

  return (
    <div className="pos-shell">
      <header className="staff-topbar">
        <div className="staff-brand">
          <span className="staff-brand-mark" aria-hidden="true">
            UCM
          </span>
          <span>
            <strong>UCM Coffee Studio</strong>
            <small>Point of Sale</small>
          </span>
        </div>
        <span className="pos-staff-name">
          Signed in as {auth.user?.displayName ?? auth.user?.username}
        </span>
      </header>
      <main className="pos-landing">
        <p className="eyebrow">Point of Sale</p>
        <h1>Ready for the next order.</h1>
        <p>The sales workspace is ready for its upcoming workflow.</p>
      </main>
    </div>
  );
}

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/staff/sign-in" element={<StaffSignInPage />} />
        <Route
          element={
            <ProtectedRoute role={Role.ADMIN} signInPath="/sign-in" />
          }
        >
          <Route element={<AdminLayout />}>
            <Route
              path="/dashboard"
              element={<AdminPage title="Dashboard" />}
            />
            <Route
              path="/inventory"
              element={<AdminPage title="Inventory" />}
            />
            <Route
              path="/catalog/categories"
              element={<CategoriesPage />}
            />
            <Route path="/catalog/products" element={<ProductsPage />} />
            <Route
              path="/catalog/products/new"
              element={<ProductEditorPage />}
            />
            <Route
              path="/catalog/products/:id/edit"
              element={<ProductEditorPage />}
            />
            <Route path="/reports" element={<AdminPage title="Reports" />} />
            <Route
              path="*"
              element={<AdminPage title="Administrator workspace" />}
            />
          </Route>
        </Route>
        <Route
          element={
            <ProtectedRoute
              role={Role.STAFF}
              signInPath="/staff/sign-in"
            />
          }
        >
          <Route path="/pos" element={<PointOfSalePage />} />
        </Route>
        <Route path="/" element={<Navigate replace to={DEFAULT_ADMIN_PATH} />} />
      </Routes>
    </AuthProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M7 10h10a1 1 0 0 1 1 1v8H6v-8a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8v5m0 3.25v.01M10.3 4.9 3.5 17a2 2 0 0 0 1.74 3h13.52a2 2 0 0 0 1.74-3L13.7 4.9a1.95 1.95 0 0 0-3.4 0Z" />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 4 16 16M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.6 15.6 0 0 1-2.2 2.8M6.1 7.3A15.8 15.8 0 0 0 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.5M9.9 9.8a3 3 0 0 0 4.3 4.3" />
    </svg>
  );
}
