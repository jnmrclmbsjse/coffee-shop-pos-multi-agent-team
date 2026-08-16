import {
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@coffee-shop/shared';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import type { UsersService } from '../users/users.service';
import type { CashierSelectionService } from '../sales/cashier-selection.service';
import { AuthAttemptThrottleService } from './auth-attempt-throttle.service';
import {
  INVALID_CASHIER_PIN_MESSAGE,
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
  const appendSelection = jest.fn().mockResolvedValue(undefined);
  const cashierSelectionService = {
    appendSelection,
  } as unknown as CashierSelectionService;

  beforeEach(() => {
    signAsync.mockClear();
    appendSelection.mockReset().mockResolvedValue(undefined);
  });

  it('hashes staff passwords and optional PINs with argon2id', async () => {
    const service = new AuthService(
      {} as UsersService,
      jwtService,
      throttleMock() as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    const hashes = await service.hashStaffCredentials(
      ' Exact Password ',
      '4826',
    );

    expect(hashes.passwordHash).toMatch(/^\$argon2id\$/);
    expect(hashes.pinHash).toMatch(/^\$argon2id\$/);
    await expect(
      argon2.verify(hashes.passwordHash, ' Exact Password '),
    ).resolves.toBe(true);
    await expect(argon2.verify(hashes.pinHash!, '4826')).resolves.toBe(true);
    await expect(
      service.hashStaffCredentials('password'),
    ).resolves.toMatchObject({ pinHash: null });
  });

  it('authenticates an administrator and signs a cookie-safe token payload', async () => {
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(user(Role.ADMIN)),
    } as unknown as UsersService;
    const service = new AuthService(
      usersService,
      jwtService,
      throttleMock() as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    const result = await service.login('  ADMIN ', ' Exact Pass ');

    expect(usersService.findByUsername).toHaveBeenCalledWith('  ADMIN ');
    expect(signAsync).toHaveBeenCalledWith({
      sub: '09571f7f-3bc4-4211-b22f-1f165323f9de',
      username: 'admin',
      role: Role.ADMIN,
    });
    expect(result.response.user.role).toBe(Role.ADMIN);
    expect(appendSelection).not.toHaveBeenCalled();
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
        cashierSelectionService,
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
      findLinkedStaffMember: jest.fn().mockResolvedValue({
        id: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        isActive: true,
        locationId: '56fe72cc-5c03-466c-bd87-7c5d2d732bbe',
      }),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
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
          staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        },
      },
      token: 'signed-token',
    });
    expect(appendSelection).toHaveBeenCalledWith({
      deviceId: 'device-1',
      locationId: '56fe72cc-5c03-466c-bd87-7c5d2d732bbe',
      staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
      selectedByUserId: foundUser.id,
    });
  });

  it('appends an explicit clear when password sign-in has no roster link', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(foundUser),
      findLinkedStaffMember: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const service = new AuthService(
      usersService,
      jwtService,
      throttleMock() as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    await service.staffPasswordLogin('staff', ' Exact Pass ', 'device-1');

    expect(appendSelection).toHaveBeenCalledWith({
      deviceId: 'device-1',
      locationId: null,
      staffMemberId: null,
      selectedByUserId: foundUser.id,
    });
  });

  it('returns the staff session when the default selection write fails', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findByUsername: jest.fn().mockResolvedValue(foundUser),
      findLinkedStaffMember: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    appendSelection.mockRejectedValueOnce(new Error('database unavailable'));
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new AuthService(
      usersService,
      jwtService,
      throttleMock() as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    await expect(
      service.staffPasswordLogin('staff', ' Exact Pass ', 'device-1'),
    ).resolves.toMatchObject({
      response: { user: { id: foundUser.id } },
      token: 'signed-token',
    });
    expect(logError).toHaveBeenCalledWith(
      `Failed to record the default cashier for staff user ${foundUser.id}`,
      expect.stringContaining('database unavailable'),
    );
    logError.mockRestore();
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
        cashierSelectionService,
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
      findLinkedStaffMember: jest.fn().mockResolvedValue({
        id: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        isActive: false,
        locationId: '56fe72cc-5c03-466c-bd87-7c5d2d732bbe',
      }),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
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
      staffMemberId: null,
    });
    expect(appendSelection).toHaveBeenCalledWith({
      deviceId: 'device-1',
      locationId: null,
      staffMemberId: null,
      selectedByUserId: foundUser.id,
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
      cashierSelectionService,
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
      cashierSelectionService,
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
      cashierSelectionService,
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

  it('authorizes a cashier PIN without minting or rotating a session', async () => {
    const foundUser = user(Role.STAFF);
    const usersService = {
      findByStaffMemberId: jest.fn().mockResolvedValue(foundUser),
    } as unknown as UsersService;
    const throttle = throttleMock();
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    await expect(
      service.authorizeCashierPin(
        '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        '1234',
        'device-1',
      ),
    ).resolves.toBeUndefined();
    expect(throttle.reset).toHaveBeenCalledWith('user-key');
    expect(signAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong PIN', user(Role.STAFF), '9999'],
    ['short PIN', user(Role.STAFF), '123'],
    ['long PIN', user(Role.STAFF), '12345'],
    ['non-numeric PIN', user(Role.STAFF), '12ab'],
    ['non-string PIN', user(Role.STAFF), 1234],
    ['unlinked member', null, '1234'],
    ['account without PIN', user(Role.STAFF, { pinHash: null }), '1234'],
    ['deactivated account', user(Role.STAFF, { isActive: false }), '1234'],
  ])(
    'returns the identical cashier authorization failure for %s',
    async (_case, foundUser, pin) => {
      const usersService = {
        findByStaffMemberId: jest.fn().mockResolvedValue(foundUser),
      } as unknown as UsersService;
      const throttle = throttleMock();
      const service = new AuthService(
        usersService,
        jwtService,
        throttle as unknown as AuthAttemptThrottleService,
        cashierSelectionService,
      );

      await expect(
        service.authorizeCashierPin(
          '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
          pin,
          'device-1',
        ),
      ).rejects.toEqual(
        new UnauthorizedException(INVALID_CASHIER_PIN_MESSAGE),
      );
      expect(throttle.recordFailure).toHaveBeenCalledTimes(1);
      expect(signAsync).not.toHaveBeenCalled();
    },
  );

  it('refuses cashier authorization with the shared throttle policy', async () => {
    const usersService = {
      findByStaffMemberId: jest.fn().mockResolvedValue(user(Role.STAFF)),
    } as unknown as UsersService;
    const throttle = throttleMock(9);
    const service = new AuthService(
      usersService,
      jwtService,
      throttle as unknown as AuthAttemptThrottleService,
      cashierSelectionService,
    );

    await expect(
      service.authorizeCashierPin(
        '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        '1234',
        'device-1',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { retryAfterSeconds: 9 },
    });
    expect(throttle.recordFailure).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
  });
});
