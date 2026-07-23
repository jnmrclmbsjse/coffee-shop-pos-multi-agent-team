import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@coffee-shop/shared';
import type { User } from '@prisma/client';
import type { UsersService } from '../users/users.service';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants';
import { AuthService } from './auth.service';

const TEST_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$WQAvow9WK1zaZ2KAjyd5Hg$qNiDlWcAQzybL0Ovv4oQdRQXsJGInrxk+AaC0MEkes4';

function user(role: Role): User {
  return {
    id: '09571f7f-3bc4-4211-b22f-1f165323f9de',
    username: role === Role.ADMIN ? 'admin' : 'staff',
    passwordHash: TEST_PASSWORD_HASH,
    role,
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
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
    const service = new AuthService(usersService, jwtService);

    const result = await service.login('  ADMIN ', ' Exact Pass ');

    expect(usersService.findByUsername).toHaveBeenCalledWith('  ADMIN ');
    expect(signAsync).toHaveBeenCalledWith({
      sub: '09571f7f-3bc4-4211-b22f-1f165323f9de',
      username: 'admin',
      role: Role.ADMIN,
    });
    expect(result).toEqual({
      response: {
        user: {
          id: '09571f7f-3bc4-4211-b22f-1f165323f9de',
          username: 'admin',
          role: Role.ADMIN,
        },
      },
      token: 'signed-token',
    });
  });

  it.each([
    ['an unknown username', null, ' Exact Pass '],
    ['a wrong password', user(Role.ADMIN), 'exact pass'],
    ['a staff account', user(Role.STAFF), ' Exact Pass '],
  ])(
    'returns the generic failure for %s',
    async (_case, foundUser, password) => {
      const usersService = {
        findByUsername: jest.fn().mockResolvedValue(foundUser),
      } as unknown as UsersService;
      const service = new AuthService(usersService, jwtService);

      const attempt = service.login('username', password);

      await expect(attempt).rejects.toEqual(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(signAsync).not.toHaveBeenCalled();
    },
  );
});
