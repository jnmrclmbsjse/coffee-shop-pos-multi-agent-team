import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from './auth.types';
import { RolesGuard } from './roles.guard';

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const getAllAndOverride = jest.fn().mockReturnValue([Role.ADMIN]);
  const guard = new RolesGuard({
    getAllAndOverride,
  } as unknown as Reflector);

  it('allows an administrator', () => {
    expect(
      guard.canActivate(
        contextFor({
          headers: {},
          user: { id: 'admin-id', username: 'admin', role: Role.ADMIN },
        }),
      ),
    ).toBe(true);
  });

  it('rejects an unauthenticated request', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-administrator', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          headers: {},
          user: { id: 'staff-id', username: 'staff', role: Role.STAFF },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
