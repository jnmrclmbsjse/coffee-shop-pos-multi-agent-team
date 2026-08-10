import type {
  CashMovement,
  CashMovementList,
  CloseBusinessDayInput,
  CreateCashMovementInput,
  CurrentOpenBusinessDay,
  DayClosing,
  InventoryStaffOption,
  OpenBusinessDayInput,
  TradingDayClosingSummary,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class TradingDayApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'The business day request failed.');
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
    let messages = ['The business day request could not be completed. Try again.'];
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
      // Keep the user-facing fallback when the response is not JSON.
    }
    throw new TradingDayApiError(response.status, messages);
  }

  return (await response.json()) as T;
}

export function getCurrentBusinessDay(): Promise<CurrentOpenBusinessDay> {
  return request('/trading-day/current');
}

export function getClosingSummary(): Promise<TradingDayClosingSummary> {
  return request('/trading-day/current/closing-summary');
}

export function getCurrentCashMovements(): Promise<CashMovementList> {
  return request('/trading-day/current/cash-movements');
}

export function listActiveTradingDayStaff(): Promise<InventoryStaffOption[]> {
  return request('/inventory/counts/staff');
}

export function openBusinessDay(
  input: OpenBusinessDayInput,
): Promise<CurrentOpenBusinessDay> {
  return request('/trading-day/open', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function closeBusinessDay(
  input: CloseBusinessDayInput,
): Promise<DayClosing> {
  return request('/trading-day/close', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function recordCashMovement(
  input: CreateCashMovementInput,
): Promise<CashMovement> {
  return request('/trading-day/cash-movements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
