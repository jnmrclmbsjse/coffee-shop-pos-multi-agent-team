import type {
  BusinessDayList,
  StaffOrderLedger,
  StaffOrderLedgerQuery,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class StaffOrderLedgerApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'The order history request failed.');
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    let messages = ['Order history could not be loaded. Try again.'];
    try {
      const body = (await response.json()) as { message?: unknown };
      if (Array.isArray(body.message)) {
        messages = body.message.filter(
          (message): message is string => typeof message === 'string',
        );
      } else if (typeof body.message === 'string') {
        messages = [body.message];
      }
    } catch {
      // Keep the user-facing fallback for non-JSON responses.
    }
    throw new StaffOrderLedgerApiError(response.status, messages);
  }

  return (await response.json()) as T;
}

export function listBusinessDays(): Promise<BusinessDayList> {
  return request('/trading-day');
}

export function getStaffOrderLedger(
  businessDayId: string,
  query: StaffOrderLedgerQuery,
): Promise<StaffOrderLedger> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.paymentMethod) {
    params.set('paymentMethod', query.paymentMethod);
  }
  if (query.search) params.set('search', query.search);
  const queryString = params.toString();

  return request(
    `/reporting/staff-order-ledger/${encodeURIComponent(businessDayId)}${
      queryString ? `?${queryString}` : ''
    }`,
  );
}
