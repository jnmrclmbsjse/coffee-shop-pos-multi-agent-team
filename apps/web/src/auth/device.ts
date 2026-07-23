import type { StaffAuthenticatedUser } from '@coffee-shop/shared';

const DEVICE_ID_KEY = 'ucm.staff-auth.device-id.v1';
const REMEMBERED_STAFF_KEY = 'ucm.staff-auth.remembered-staff.v1';

export interface RememberedStaff {
  id: string;
  displayName: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function newDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId(): string {
  const localStorage = storage();
  const savedId = localStorage?.getItem(DEVICE_ID_KEY)?.trim();
  if (savedId) {
    return savedId;
  }

  const deviceId = newDeviceId();
  localStorage?.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export function readRememberedStaff(): RememberedStaff[] {
  const savedStaff = storage()?.getItem(REMEMBERED_STAFF_KEY);
  if (!savedStaff) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(savedStaff);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (staff): staff is RememberedStaff =>
        typeof staff === 'object' &&
        staff !== null &&
        typeof Reflect.get(staff, 'id') === 'string' &&
        typeof Reflect.get(staff, 'displayName') === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberStaff(
  user: StaffAuthenticatedUser,
): RememberedStaff[] {
  const remembered = readRememberedStaff().filter(
    (staff) => staff.id !== user.id,
  );
  const updated = [
    { id: user.id, displayName: user.displayName },
    ...remembered,
  ];
  storage()?.setItem(REMEMBERED_STAFF_KEY, JSON.stringify(updated));
  return updated;
}
