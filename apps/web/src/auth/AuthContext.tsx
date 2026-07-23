import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedUser } from '@coffee-shop/shared';
import { readSession } from './api';

type AuthStatus = 'checking' | 'signedOut' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  completeLogin: (user: AuthenticatedUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    let active = true;

    void readSession().then((sessionUser) => {
      if (!active) {
        return;
      }
      setUser(sessionUser);
      setStatus(sessionUser ? 'authenticated' : 'signedOut');
    });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      completeLogin: (authenticatedUser) => {
        setUser(authenticatedUser);
        setStatus('authenticated');
      },
    }),
    [status, user],
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
