import { useContext } from 'react';
import { AuthContext } from './AuthContext';

/**
 * Roster member linked to the signed-in login, or null when there is none
 * (admins, staff logins whose roster member was deactivated or unlinked, and
 * any component rendered outside the provider). Reading the context directly
 * keeps this a soft dependency: a missing session yields no default rather
 * than an error, which is exactly the fallback the pickers already handle.
 */
export function useSignedInStaffMemberId(): string | null {
  return useContext(AuthContext)?.user?.staffMemberId ?? null;
}

/**
 * Initial value for a "who did this" staff picker. The signed-in member is a
 * default, not a lock: it is only used to seed the control, and only when that
 * member is actually selectable. Anyone else falls back to no selection.
 */
export function defaultStaffSelection(
  options: ReadonlyArray<{ id: string }>,
  signedInStaffMemberId: string | null,
): string {
  if (signedInStaffMemberId === null) return '';
  return options.some((option) => option.id === signedInStaffMemberId)
    ? signedInStaffMemberId
    : '';
}
