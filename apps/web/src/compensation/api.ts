import type {
  CreateStaffCompensationEntryInput,
  StaffCompensationEntry,
  StaffCompensationEntryListQuery,
  UpdateStaffCompensationEntryInput,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class CompensationApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
    readonly field?: string,
    readonly reason?: string,
  ) {
    super(messages[0] ?? 'Compensation request failed');
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
    let messages = ['The compensation request could not be completed. Try again.'];
    let field: string | undefined;
    let reason: string | undefined;
    try {
      const body = (await response.json()) as { message?: unknown; field?: unknown; reason?: unknown };
      if (Array.isArray(body.message)) {
        messages = body.message.filter((message): message is string => typeof message === 'string');
      } else if (typeof body.message === 'string') messages = [body.message];
      field = typeof body.field === 'string' ? body.field : undefined;
      reason = typeof body.reason === 'string' ? body.reason : undefined;
    } catch {
      // Keep the fallback for non-JSON responses.
    }
    throw new CompensationApiError(response.status, messages, field, reason);
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function listCompensationEntries(query: StaffCompensationEntryListQuery): Promise<StaffCompensationEntry[]> {
  const params = new URLSearchParams();
  if (query.staffMemberId) params.set('staffMemberId', query.staffMemberId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const suffix = params.size ? `?${params.toString()}` : '';
  return request(`/compensation/entries${suffix}`);
}

export function createCompensationEntry(input: CreateStaffCompensationEntryInput): Promise<StaffCompensationEntry> {
  return request('/compensation/entries', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCompensationEntry(id: string, input: UpdateStaffCompensationEntryInput): Promise<StaffCompensationEntry> {
  return request(`/compensation/entries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteCompensationEntry(id: string): Promise<void> {
  return request(`/compensation/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
