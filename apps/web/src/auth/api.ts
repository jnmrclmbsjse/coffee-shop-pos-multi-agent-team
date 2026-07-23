import type {
  AuthenticatedUser,
  LoginRequest,
  LoginResponse,
  StaffAuthenticatedUser,
  StaffLoginResponse,
  StaffPasswordLoginRequest,
  StaffPinLoginRequest,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class AuthenticationError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super('Authentication request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

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

  return (await response.json()) as T;
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
