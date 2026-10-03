import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Role, type AuthenticatedUser } from '@coffee-shop/shared';
import { readSession } from './api';
import { setUnauthorizedHandler } from './session-fetch';

type AuthStatus = 'checking' | 'signedOut' | 'authenticated';
export type AuthNotice = 'signedOut' | 'sessionEnded';

export interface AuthNavigationState {
  authNotice?: AuthNotice;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  notice: AuthNotice | null;
  signedOutPath: string | null;
  completeLogin: (user: AuthenticatedUser) => void;
  completeLogout: (notice?: AuthNotice) => void;
  consumeNotice: () => void;
}

// Exported so features can read the session without hard-requiring the
// provider, and so tests can supply a session without booting the real one.
export const AuthContext = createContext<AuthContextValue | null>(null);
const LOGOUT_CHANNEL = 'ucm.auth.logout.v1';
const LOGOUT_STORAGE_KEY = 'ucm.auth.logout-event.v1';
const INITIAL_SESSION_RETRY_MS = 2_000;

function signInPathFor(user: AuthenticatedUser | null): string {
  return user?.role === Role.STAFF ? '/staff/sign-in' : '/sign-in';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [signedOutPath, setSignedOutPath] = useState<string | null>(null);
  const statusRef = useRef<AuthStatus>('checking');
  const userRef = useRef<AuthenticatedUser | null>(null);
  const publishLogoutRef = useRef<() => void>(() => undefined);

  const setAuthenticated = useCallback(
    (authenticatedUser: AuthenticatedUser) => {
      userRef.current = authenticatedUser;
      statusRef.current = 'authenticated';
      setUser(authenticatedUser);
      setStatus('authenticated');
      setNotice(null);
      setSignedOutPath(null);
    },
    [],
  );

  const transitionToSignedOut = useCallback(
    (notice: AuthNotice) => {
      const signedInUser = userRef.current;
      userRef.current = null;
      statusRef.current = 'signedOut';
      setUser(null);
      setStatus('signedOut');
      setNotice(notice);
      setSignedOutPath(signInPathFor(signedInUser));
    },
    [],
  );

  const revalidateSession = useCallback(async () => {
    if (statusRef.current !== 'authenticated') {
      return;
    }

    const revalidatedUser = userRef.current;
    let sessionUser: AuthenticatedUser | null;
    try {
      sessionUser = await readSession();
    } catch {
      // A transient network/server failure is not evidence that the session
      // ended. Protected requests and a later revalidation remain authoritative.
      return;
    }
    if (
      statusRef.current !== 'authenticated' ||
      userRef.current !== revalidatedUser
    ) {
      return;
    }
    if (sessionUser) {
      setAuthenticated(sessionUser);
      return;
    }
    transitionToSignedOut('sessionEnded');
  }, [setAuthenticated, transitionToSignedOut]);

  const consumeNotice = useCallback(() => {
    setNotice(null);
    setSignedOutPath(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current !== 'authenticated') {
        return;
      }
      publishLogoutRef.current();
      transitionToSignedOut('sessionEnded');
    });
    return () => setUnauthorizedHandler(null);
  }, [transitionToSignedOut]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;

    const checkInitialSession = async (): Promise<void> => {
      try {
        const sessionUser = await readSession();
        if (!active) {
          return;
        }
        if (sessionUser) {
          setAuthenticated(sessionUser);
        } else {
          userRef.current = null;
          statusRef.current = 'signedOut';
          setUser(null);
          setStatus('signedOut');
          setNotice(null);
          setSignedOutPath(null);
        }
      } catch {
        // Keep protected content gated while the initial session check is
        // unavailable. A failure must not be reinterpreted as a signed-out
        // response; retry so startup recovers when the API becomes available.
        if (active) {
          retryTimer = window.setTimeout(() => {
            void checkInitialSession();
          }, INITIAL_SESSION_RETRY_MS);
        }
      }
    };

    void checkInitialSession();

    return () => {
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [setAuthenticated]);

  useEffect(() => {
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(LOGOUT_CHANNEL);

    const revalidate = () => {
      void revalidateSession();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOGOUT_STORAGE_KEY && event.newValue !== null) {
        revalidate();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidate();
      }
    };

    if (channel) {
      channel.addEventListener('message', revalidate);
    } else {
      window.addEventListener('storage', handleStorage);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', revalidate);

    publishLogoutRef.current = () => {
      try {
        if (channel) {
          channel.postMessage({ type: 'logout' });
          return;
        }
        window.localStorage.setItem(LOGOUT_STORAGE_KEY, String(Date.now()));
        window.localStorage.removeItem(LOGOUT_STORAGE_KEY);
      } catch {
        // Cross-tab notification is best-effort; server 401s remain authoritative.
      }
    };

    return () => {
      publishLogoutRef.current = () => undefined;
      channel?.removeEventListener('message', revalidate);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', revalidate);
    };
  }, [revalidateSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      notice,
      signedOutPath,
      completeLogin: setAuthenticated,
      completeLogout: (notice = 'signedOut') => {
        publishLogoutRef.current();
        transitionToSignedOut(notice);
      },
      consumeNotice,
    }),
    [
      notice,
      consumeNotice,
      setAuthenticated,
      signedOutPath,
      status,
      transitionToSignedOut,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
