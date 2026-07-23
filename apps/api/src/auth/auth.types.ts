import type { AuthenticatedUser, Role } from '@coffee-shop/shared';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: Role;
}

export interface AuthenticatedRequest {
  headers: {
    cookie?: string;
  };
  user?: AuthenticatedUser;
}
