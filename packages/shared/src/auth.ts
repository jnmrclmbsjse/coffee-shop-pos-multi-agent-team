export enum Role {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
}

export interface LoginResponse {
  user: AuthenticatedUser;
}
