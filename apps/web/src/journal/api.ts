import type {
  BulkCreateJournalDepositsInput,
  CreateJournalDepositInput,
  CreateJournalLedgerInput,
  CreateJournalWithdrawalInput,
  JournalDeposit,
  JournalLedgerBalance,
  JournalMissingDay,
  JournalSuggestionRate,
  JournalWithdrawal,
  UpdateJournalDepositInput,
  UpdateJournalLedgerInput,
  UpdateJournalSuggestionRateInput,
  UpdateJournalWithdrawalInput,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export type JournalLedgerDetail = JournalLedgerBalance & {
  deposits: JournalDeposit[];
  withdrawals: JournalWithdrawal[];
};

export class JournalApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
    readonly field?: string,
    readonly reason?: string,
    readonly businessDate?: string,
  ) {
    super(messages[0] ?? 'Journal request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let messages = ['The Journal request could not be completed. Try again.'];
    let field: string | undefined;
    let reason: string | undefined;
    let businessDate: string | undefined;
    try {
      const body = (await response.json()) as {
        message?: unknown;
        field?: unknown;
        reason?: unknown;
        businessDate?: unknown;
      };
      if (Array.isArray(body.message)) {
        messages = body.message.filter(
          (message): message is string => typeof message === 'string',
        );
      } else if (typeof body.message === 'string') {
        messages = [body.message];
      }
      field = typeof body.field === 'string' ? body.field : undefined;
      reason = typeof body.reason === 'string' ? body.reason : undefined;
      businessDate =
        typeof body.businessDate === 'string' ? body.businessDate : undefined;
    } catch {
      // Keep the fallback for non-JSON responses.
    }
    throw new JournalApiError(
      response.status,
      messages,
      field,
      reason,
      businessDate,
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function listJournalLedgers(): Promise<JournalLedgerBalance[]> {
  return request('/journal/ledgers');
}

export function createJournalLedger(
  input: CreateJournalLedgerInput,
): Promise<JournalLedgerBalance> {
  return request('/journal/ledgers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateJournalLedger(
  id: string,
  input: UpdateJournalLedgerInput,
): Promise<JournalLedgerBalance> {
  return request(`/journal/ledgers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getJournalLedger(id: string): Promise<JournalLedgerDetail> {
  return request(`/journal/ledgers/${encodeURIComponent(id)}`);
}

export function createJournalDeposit(
  ledgerId: string,
  input: CreateJournalDepositInput,
): Promise<JournalDeposit> {
  return request(`/journal/ledgers/${encodeURIComponent(ledgerId)}/deposits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateJournalDeposit(
  id: string,
  input: UpdateJournalDepositInput,
): Promise<JournalDeposit> {
  return request(`/journal/deposits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteJournalDeposit(id: string): Promise<void> {
  return request(`/journal/deposits/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listJournalMissingDays(
  ledgerId: string,
): Promise<JournalMissingDay[]> {
  return request(
    `/journal/ledgers/${encodeURIComponent(ledgerId)}/missing-days`,
  );
}

export function createJournalDepositsBulk(
  ledgerId: string,
  input: BulkCreateJournalDepositsInput,
): Promise<JournalDeposit[]> {
  return request(
    `/journal/ledgers/${encodeURIComponent(ledgerId)}/deposits/bulk`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function getJournalSuggestionRate(
  ledgerId: string,
): Promise<JournalSuggestionRate | null> {
  // Nest replies to a `null` rate with an empty body, so the two forms of
  // "this ledger has no rate row" arrive as `null` and `undefined`.
  const rate = await request<JournalSuggestionRate | null | undefined>(
    `/journal/ledgers/${encodeURIComponent(ledgerId)}/rate`,
  );
  return rate ?? null;
}

export function updateJournalSuggestionRate(
  ledgerId: string,
  input: UpdateJournalSuggestionRateInput,
): Promise<JournalSuggestionRate> {
  return request(`/journal/ledgers/${encodeURIComponent(ledgerId)}/rate`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function createJournalWithdrawal(
  ledgerId: string,
  input: CreateJournalWithdrawalInput,
): Promise<JournalWithdrawal> {
  return request(
    `/journal/ledgers/${encodeURIComponent(ledgerId)}/withdrawals`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function updateJournalWithdrawal(
  id: string,
  input: UpdateJournalWithdrawalInput,
): Promise<JournalWithdrawal> {
  return request(`/journal/withdrawals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteJournalWithdrawal(id: string): Promise<void> {
  return request(`/journal/withdrawals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
