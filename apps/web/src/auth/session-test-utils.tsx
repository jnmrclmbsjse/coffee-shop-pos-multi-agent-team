import type { ReactNode } from 'react';
import { Role, type AuthenticatedUser } from '@coffee-shop/shared';
import { AuthContext } from './AuthContext';

/**
 * Wraps a page in a fixed session so tests can exercise behaviour that depends
 * on who is signed in without booting the real provider and its session fetch.
 */
export function SignedInAs({
  staffMemberId,
  children,
}: {
  staffMemberId: string | null;
  children: ReactNode;
}) {
  const user: AuthenticatedUser = {
    id: 'user-id',
    username: 'staff',
    displayName: 'Signed-in Staff',
    role: Role.STAFF,
    staffMemberId,
  };

  return (
    <AuthContext.Provider
      value={{
        status: 'authenticated',
        user,
        notice: null,
        signedOutPath: null,
        completeLogin: () => undefined,
        completeLogout: () => undefined,
        consumeNotice: () => undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
