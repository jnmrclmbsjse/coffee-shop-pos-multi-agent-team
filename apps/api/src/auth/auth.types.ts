import type { AuthenticatedUser, Role } from '@coffee-shop/shared';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: Role;
  displayName?: string;
}

export interface AuthenticatedRequest {
  headers: {
    cookie?: string;
  };
  user?: AuthenticatedUser;
}
