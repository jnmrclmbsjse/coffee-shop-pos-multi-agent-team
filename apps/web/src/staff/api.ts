import type {
  CreateStaffAccountInput,
  CreateStaffAccountResponse,
  CreateStaffMemberInput,
  StaffMember,
  StaffMemberListQuery,
  UpdateStaffMemberInput,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class StaffApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
    readonly field?: string,
    readonly reason?: string,
  ) {
    super(messages[0] ?? 'Staff request failed');
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
    let messages = ['The staff roster could not be updated. Try again.'];
    let field: string | undefined;
    let reason: string | undefined;
    try {
      const body = (await response.json()) as {
        message?: unknown;
        field?: unknown;
        reason?: unknown;
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
    } catch {
      // Keep the user-facing fallback when the response is not JSON.
    }
    throw new StaffApiError(response.status, messages, field, reason);
  }

  return (await response.json()) as T;
}

export function listStaffMembers(
  query: StaffMemberListQuery,
): Promise<StaffMember[]> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.active !== undefined) {
    params.set('active', String(query.active));
  }
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return request(`/staff${suffix}`);
}

export function createStaffMember(
  input: CreateStaffMemberInput,
): Promise<StaffMember> {
  return request('/staff', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createStaffAccount(
  staffMemberId: string,
  input: CreateStaffAccountInput,
): Promise<CreateStaffAccountResponse> {
  return request(`/staff/${staffMemberId}/account`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateStaffMember(
  id: string,
  input: UpdateStaffMemberInput,
): Promise<StaffMember> {
  return request(`/staff/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
