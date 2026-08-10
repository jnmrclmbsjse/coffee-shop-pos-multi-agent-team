import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth, type AuthNavigationState } from './AuthContext';

export function SessionNotice() {
  const auth = useAuth();
  const location = useLocation();
  const notice = (location.state as AuthNavigationState | null)?.authNotice;

  useEffect(() => {
    if (notice) {
      auth.consumeNotice();
    }
  }, [auth.consumeNotice, notice]);

  if (!notice) return null;

  return (
    <div className="session-notice" role="status" aria-live="polite">
      {notice === 'signedOut'
        ? 'You have been signed out.'
        : 'Your session ended. Sign in to continue.'}
    </div>
  );
}
