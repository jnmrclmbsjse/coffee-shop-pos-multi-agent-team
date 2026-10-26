import type {
  CreateStaffAccountInput,
  CreateStaffAccountResponse,
  CreateStaffMemberInput,
  StaffMember,
  StaffMemberListQuery,
  UpdateStaffCredentialsInput,
  UpdateStaffCredentialsResponse,
  UpdateStaffMemberInput,
  StaffEmploymentDetails,
  StaffGovernmentIds,
  UpdateStaffEmploymentDetailsInput,
  StaffCustomFieldDefinition,
  CreateStaffCustomFieldDefinitionInput,
  UpdateStaffCustomFieldDefinitionInput,
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

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function getStaffEmployment(id: string): Promise<StaffEmploymentDetails> { return request(`/staff/${id}/employment`); }
export function updateStaffEmployment(id: string, input: UpdateStaffEmploymentDetailsInput): Promise<StaffEmploymentDetails> { return request(`/staff/${id}/employment`, { method: 'PUT', body: JSON.stringify(input) }); }
export function revealStaffGovernmentIds(id: string): Promise<StaffGovernmentIds> { return request(`/staff/${id}/employment/government-ids`); }
export function saveStaffCustomFieldValues(id: string, values: Array<{ definitionId: string; value: string }>): Promise<void> { return request(`/staff/${id}/custom-fields`, { method: 'PUT', body: JSON.stringify({ values }) }); }
export function listStaffCustomFields(includeArchived = false): Promise<StaffCustomFieldDefinition[]> { return request(`/staff/custom-fields?includeArchived=${includeArchived}`); }
export function createStaffCustomField(input: CreateStaffCustomFieldDefinitionInput): Promise<StaffCustomFieldDefinition> { return request('/staff/custom-fields', { method: 'POST', body: JSON.stringify(input) }); }
export function updateStaffCustomField(id: string, input: UpdateStaffCustomFieldDefinitionInput): Promise<StaffCustomFieldDefinition> { return request(`/staff/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function reorderStaffCustomFields(ids: string[]): Promise<void> { return request('/staff/custom-fields/order', { method: 'PUT', body: JSON.stringify({ ids }) }); }

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

export function updateStaffCredentials(
  staffMemberId: string,
  input: UpdateStaffCredentialsInput,
): Promise<UpdateStaffCredentialsResponse> {
  return request(`/staff/${staffMemberId}/account/credentials`, {
    method: 'PATCH',
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
