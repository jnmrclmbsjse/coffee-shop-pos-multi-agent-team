import type {
  ActiveCashier,
  ActiveCashierResponse,
  SelectableStaffMember,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class CashierApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = 'Cashier selection could not be completed. Try again.';
    let retryAfterSeconds: number | null = null;

    try {
      const body = (await response.json()) as {
        message?: unknown;
        retryAfterSeconds?: unknown;
      };
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (
        Array.isArray(body.message) &&
        typeof body.message[0] === 'string'
      ) {
        message = body.message[0];
      }
      if (
        typeof body.retryAfterSeconds === 'number' &&
        Number.isFinite(body.retryAfterSeconds)
      ) {
        retryAfterSeconds = Math.max(1, Math.ceil(body.retryAfterSeconds));
      }
    } catch {
      // Keep the generic fallback for non-JSON responses.
    }

    throw new CashierApiError(response.status, message, retryAfterSeconds);
  }

  return (await response.json()) as T;
}

export function listSelectableCashiers(): Promise<SelectableStaffMember[]> {
  return request('/staff/selectable');
}

export async function getActiveCashier(
  deviceId: string,
): Promise<ActiveCashier | null> {
  const response = await request<ActiveCashierResponse>(
    `/sales/active-cashier?${new URLSearchParams({ deviceId })}`,
  );
  return response.cashier;
}

export function selectActiveCashier(
  deviceId: string,
  staffMemberId: string,
  pin?: string,
): Promise<ActiveCashier> {
  return request('/sales/active-cashier', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      staffMemberId,
      ...(pin === undefined ? {} : { pin }),
    }),
  });
}

export async function clearActiveCashier(
  deviceId: string,
): Promise<ActiveCashier | null> {
  const response = await request<ActiveCashierResponse>(
    '/sales/active-cashier',
    {
      method: 'DELETE',
      body: JSON.stringify({ deviceId }),
    },
  );
  return response.cashier;
}
