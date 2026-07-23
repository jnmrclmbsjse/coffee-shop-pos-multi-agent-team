import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@coffee-shop/shared';
import { AUTH_COOKIE_NAME } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('authenticates a valid cookie and attaches its user', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'user-id',
      username: 'admin',
      role: Role.ADMIN,
    });
    const guard = new JwtAuthGuard({
      verifyAsync,
    } as unknown as JwtService);
    const request: AuthenticatedRequest = {
      headers: {
        cookie: `another=value; ${AUTH_COOKIE_NAME}=signed%2Etoken`,
      },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('signed.token');
    expect(request.user).toEqual({
      id: 'user-id',
      username: 'admin',
      role: Role.ADMIN,
    });
  });

  it('preserves the staff display name from a valid session token', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'staff-id',
      username: 'staff',
      displayName: 'Casey Barista',
      role: Role.STAFF,
    });
    const guard = new JwtAuthGuard({
      verifyAsync,
    } as unknown as JwtService);
    const request: AuthenticatedRequest = {
      headers: { cookie: `${AUTH_COOKIE_NAME}=staff-token` },
    };

    await guard.canActivate(contextFor(request));

    expect(request.user).toEqual({
      id: 'staff-id',
      username: 'staff',
      displayName: 'Casey Barista',
      role: Role.STAFF,
    });
  });

  it.each([
    [{ headers: {} }, undefined],
    [
      { headers: { cookie: `${AUTH_COOKIE_NAME}=%E0%A4%A` } },
      undefined,
    ],
    [
      { headers: { cookie: `${AUTH_COOKIE_NAME}=invalid` } },
      new Error('invalid token'),
    ],
  ])('rejects a missing or invalid cookie', async (request, verificationError) => {
    const verifyAsync = verificationError
      ? jest.fn().mockRejectedValue(verificationError)
      : jest.fn();
    const guard = new JwtAuthGuard({
      verifyAsync,
    } as unknown as JwtService);

    await expect(
      guard.canActivate(contextFor(request as AuthenticatedRequest)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
