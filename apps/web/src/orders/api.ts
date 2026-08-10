import type {
  BusinessDayList,
  CompleteOrderInput,
  CreateOrderInput,
  Order,
  OrderLineInput,
  StaffOrderLedger,
  StaffOrderLedgerQuery,
  UpdateOrderInput,
  UpdateOrderLineInput,
  VoidOrderInput,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class StaffOrderLedgerApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'The order history request failed.');
  }
}

export class OrderCaptureApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'The order change could not be saved.');
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await sessionFetch(path, {
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

async function captureRequest<T>(
  path: string,
  init?: RequestInit,
  emptyResponse?: T,
): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let messages = ['The order change could not be saved. Try again.'];
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
      // Keep the actionable fallback when a response has no JSON body.
    }
    throw new OrderCaptureApiError(response.status, messages);
  }

  const body = await response.text();
  if (body.trim() === '') return emptyResponse as T;
  return JSON.parse(body) as T;
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

export function createOrder(input: CreateOrderInput): Promise<Order> {
  return captureRequest('/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listParkedOrders(): Promise<Order[]> {
  return captureRequest('/orders/parked');
}

export function updateOrder(
  clientGeneratedId: string,
  input: UpdateOrderInput,
): Promise<Order> {
  return captureRequest(`/orders/${encodeURIComponent(clientGeneratedId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function addOrderLine(
  clientGeneratedId: string,
  input: OrderLineInput,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/lines`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function updateOrderLine(
  clientGeneratedId: string,
  lineId: string,
  input: UpdateOrderLineInput,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/lines/${encodeURIComponent(lineId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function incrementOrderLine(
  clientGeneratedId: string,
  lineId: string,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/lines/${encodeURIComponent(lineId)}/increment`,
    { method: 'POST' },
  );
}

export function decrementOrderLine(
  clientGeneratedId: string,
  lineId: string,
): Promise<Order | null> {
  return captureRequest<Order | null>(
    `/orders/${encodeURIComponent(clientGeneratedId)}/lines/${encodeURIComponent(lineId)}/decrement`,
    { method: 'POST' },
    null,
  );
}

export function removeOrderLine(
  clientGeneratedId: string,
  lineId: string,
): Promise<Order | null> {
  return captureRequest<Order | null>(
    `/orders/${encodeURIComponent(clientGeneratedId)}/lines/${encodeURIComponent(lineId)}`,
    { method: 'DELETE' },
    null,
  );
}

export function completeOrder(
  clientGeneratedId: string,
  input: CompleteOrderInput,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/complete`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function voidOrder(
  clientGeneratedId: string,
  input: VoidOrderInput,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/void`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function settleOrderChange(
  clientGeneratedId: string,
): Promise<Order> {
  return captureRequest(
    `/orders/${encodeURIComponent(clientGeneratedId)}/change-settlement`,
    { method: 'POST' },
  );
}
