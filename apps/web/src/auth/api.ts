import type {
  AuthenticatedUser,
  LoginRequest,
  LoginResponse,
  StaffAuthenticatedUser,
  StaffLoginResponse,
  StaffPasswordLoginRequest,
  StaffPinLoginRequest,
} from '@coffee-shop/shared';
import { sessionFetch } from './session-fetch';

export class AuthenticationError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super('Authentication request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  }, { handleUnauthorized: false });

  if (!response.ok) {
    let retryAfterSeconds: number | null = null;
    try {
      const body = (await response.json()) as {
        retryAfterSeconds?: unknown;
      };
      if (
        typeof body.retryAfterSeconds === 'number' &&
        Number.isFinite(body.retryAfterSeconds)
      ) {
        retryAfterSeconds = Math.max(1, Math.ceil(body.retryAfterSeconds));
      }
    } catch {
      // A response body is optional. The UI owns its generic failure copy.
    }
    throw new AuthenticationError(response.status, retryAfterSeconds);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function logout(): Promise<void> {
  return request('/auth/logout', { method: 'POST' });
}

export async function login(
  credentials: LoginRequest,
): Promise<AuthenticatedUser> {
  const response = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  return response.user;
}

export async function readSession(): Promise<AuthenticatedUser | null> {
  try {
    const response = await request<LoginResponse>('/auth/session');
    return response.user;
  } catch {
    return null;
  }
}

export async function staffPasswordLogin(
  credentials: StaffPasswordLoginRequest,
): Promise<StaffAuthenticatedUser> {
  const response = await request<StaffLoginResponse>('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  return response.user;
}

export async function staffPinLogin(
  credentials: StaffPinLoginRequest,
): Promise<StaffAuthenticatedUser> {
  const response = await request<StaffLoginResponse>('/auth/staff/pin', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  return response.user;
}
