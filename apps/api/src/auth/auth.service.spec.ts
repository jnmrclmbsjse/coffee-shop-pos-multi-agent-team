import {
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@coffee-shop/shared';
import type { User } from '@prisma/client';
import type { UsersService } from '../users/users.service';
import { AuthAttemptThrottleService } from './auth-attempt-throttle.service';
import {
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_STAFF_CREDENTIALS_MESSAGE,
} from './auth.constants';
import { AuthService } from './auth.service';

const TEST_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$WQAvow9WK1zaZ2KAjyd5Hg$qNiDlWcAQzybL0Ovv4oQdRQXsJGInrxk+AaC0MEkes4';
const TEST_PIN_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$qKnxKUMIjDdFTj1/ffHR/Q$37KDerka6++cV5PwQtNLPdAxZGv2dslrII2hoVe2OEs';

function user(
  role: Role,
  overrides: Partial<User> = {},
): User {
  return {
    id: '09571f7f-3bc4-4211-b22f-1f165323f9de',
    username: role === Role.ADMIN ? 'admin' : 'staff',
    displayName: role === Role.ADMIN ? 'Administrator' : 'Casey Barista',
    passwordHash: TEST_PASSWORD_HASH,
    pinHash: role === Role.STAFF ? TEST_PIN_HASH : null,
    isActive: true,
    role,
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
    ...overrides,
  };
}

function throttleMock(retryAfterSeconds: number | null = null) {
  return {
    keyForUser: jest.fn().mockReturnValue('user-key'),
    keyForUnknown: jest.fn().mockReturnValue('unknown-key'),
    retryAfterSeconds: jest.fn().mockReturnValue(retryAfterSeconds),
    recordFailure: jest.fn(),
    reset: jest.fn(),
  };
}

describe('AuthService', () => {
  const signAsync = jest.fn().mockResolvedValue('signed-token');
  const jwtService = { signAsync } as unknown as JwtService;

  beforeEach(() => {
    signAsync.mockClear();
  });

  it('authenticates an administrator and signs a cookie-safe token payload', async () => {
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(user(Role.ADMIN)),
    } as unknown as UsersService;
    const service = new AuthService(
      usersService,
      jwtService,
      throttleMock() as unknown as AuthAttemptThrottleService,
    );

    const result = await service.login('  ADMIN ', ' Exact Pass ');

    expect(usersService.findByUsername).toHaveBeenCalledWith('  ADMIN ');
    expect(signAsync).toHaveBeenCalledWith({
      sub: '09571f7f-3bc4-4211-b22f-1f165323f9de',
      username: 'admin',
      role: Role.ADMIN,
    });
    expect(result.response.user.role).toBe(Role.ADMIN);
  });

  it.each([
    ['an unknown username', null, ' Exact Pass '],
    ['a wrong password', user(Role.ADMIN), 'exact pass'],
    ['a staff account', user(Role.STAFF), ' Exact Pass '],
  ])(
    'returns the generic admin failure for %s',
    async (_case, foundUser, password) => {
      const usersService = {
        findByUsername: jest.fn().mockResolvedValue(foundUser),
      } as unknown as UsersService;
      const service = new AuthService(
        usersService,
        jwtService,
        throttleMock() as unknown as AuthAttemptThrottleService,
      );

      await expect(service.login('username', password)).rejects.toEqual(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(signAsync).not.toHaveBeenCalled();
    },
  );

  it('authenticates active staff with username and password', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(foundUser),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
    );

    const result = await service.staffPasswordLogin(
      'staff',
      ' Exact Pass ',
      'device-1',
    );

    expect(throttle.keyForUser).toHaveBeenCalledWith(
      'device-1',
      foundUser.id,
    );
    expect(throttle.reset).toHaveBeenCalledWith('user-key');
    expect(signAsync).toHaveBeenCalledWith({
      sub: foundUser.id,
      username: 'staff',
      displayName: 'Casey Barista',
      role: Role.STAFF,
    });
    expect(result).toEqual({
      response: {
        user: {
          id: foundUser.id,
          username: 'staff',
          displayName: 'Casey Barista',
          role: Role.STAFF,
        },
      },
      token: 'signed-token',
    });
  });

  it.each([
    ['unknown', null, ' Exact Pass '],
    ['wrong password', user(Role.STAFF), 'wrong'],
    ['administrator', user(Role.ADMIN), ' Exact Pass '],
    ['deactivated staff', user(Role.STAFF, { isActive: false }), ' Exact Pass '],
  ])(
    'returns one generic staff-password failure for %s',
    async (_case, foundUser, password) => {
      const usersService = {
        findByUsername: jest.fn().mockResolvedValue(foundUser),
      } as unknown as UsersService;
      const throttle = throttleMock();
      const service = new AuthService(
        usersService,
        jwtService,
        throttle as unknown as AuthAttemptThrottleService,
      );

      await expect(
        service.staffPasswordLogin('staff', password, 'device-1'),
      ).rejects.toEqual(
        new UnauthorizedException(INVALID_STAFF_CREDENTIALS_MESSAGE),
      );
      expect(throttle.recordFailure).toHaveBeenCalledTimes(1);
      expect(signAsync).not.toHaveBeenCalled();
    },
  );

  it('authenticates active staff with their identifier and four-digit PIN', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findById: jest.fn().mockResolvedValue(foundUser),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
    );

    const result = await service.staffPinLogin(
      foundUser.id,
      '1234',
      'device-1',
    );

    expect(throttle.reset).toHaveBeenCalledWith('user-key');
    expect(result.response.user).toEqual({
      id: foundUser.id,
      username: 'staff',
      displayName: 'Casey Barista',
      role: Role.STAFF,
    });
  });

  it.each([
    ['unknown staff', null, '1234'],
    ['incomplete PIN', user(Role.STAFF), '123'],
    ['incorrect PIN', user(Role.STAFF), '9999'],
    ['unassigned PIN', user(Role.STAFF, { pinHash: null }), '1234'],
    ['administrator', user(Role.ADMIN, { pinHash: TEST_PIN_HASH }), '1234'],
    ['deactivated staff', user(Role.STAFF, { isActive: false }), '1234'],
  ])('returns one generic PIN failure for %s', async (_case, foundUser, pin) => {
    const usersService = {
      findById: jest.fn().mockResolvedValue(foundUser),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
    );

    await expect(
      service.staffPinLogin('staff-id', pin, 'device-1'),
    ).rejects.toEqual(
      new UnauthorizedException(INVALID_STAFF_CREDENTIALS_MESSAGE),
    );
    expect(throttle.recordFailure).toHaveBeenCalledTimes(1);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('returns a generic retry time while the staff identity is throttled', async () => {
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(user(Role.STAFF)),
    } as unknown as UsersService;
    const throttle = throttleMock(12);
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
    );

    const attempt = service.staffPasswordLogin(
      'staff',
      ' Exact Pass ',
      'device-1',
    );

    await expect(attempt).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: {
        retryAfterSeconds: 12,
      },
    });
    expect(throttle.recordFailure).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('counts password and PIN failures in one staff-and-device bucket', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(foundUser),
      findById: jest.fn().mockResolvedValue(foundUser),
    } as unknown as UsersService;
    const config = {
      get: jest.fn((name: string) =>
        name === 'AUTH_THROTTLE_MAX_FAILURES' ? '2' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new AuthService(
      usersService,
      jwtService,
      new AuthAttemptThrottleService(config),
    );

    await expect(
      service.staffPasswordLogin('staff', 'wrong', 'device-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.staffPinLogin(foundUser.id, '9999', 'device-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.staffPasswordLogin('staff', ' Exact Pass ', 'device-1'),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
