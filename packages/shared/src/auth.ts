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
  displayName?: string;
  // Roster member linked to this login, when there is one. Staff-facing forms
  // use it to default their "who did this" selection to the signed-in user.
  staffMemberId?: string | null;
}

export interface LoginResponse {
  user: AuthenticatedUser;
}

export interface StaffPasswordLoginRequest {
  username: string;
  password: string;
  deviceId: string;
}

export interface StaffPinLoginRequest {
  staffId: string;
  pin: string;
  deviceId: string;
}

export interface StaffAuthenticatedUser extends AuthenticatedUser {
  role: Role.STAFF;
  displayName: string;
}

export interface StaffLoginResponse {
  user: StaffAuthenticatedUser;
}
