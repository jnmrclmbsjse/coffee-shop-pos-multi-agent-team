import type {
  AuthenticatedUser,
  LoginRequest,
  LoginResponse,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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
    throw new Error('Authentication request failed');
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
