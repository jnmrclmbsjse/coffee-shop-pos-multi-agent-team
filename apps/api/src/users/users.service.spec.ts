import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const staffMemberId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';

  function accountInput() {
    return {
      staffMemberId,
      username: '  JaNe  ',
      passwordHash: 'password-hash',
      pinHash: 'pin-hash',
    };
  }

  function createAccountPrisma(options: {
    staffMember?: {
      displayName: string;
      isActive: boolean;
      userId: string | null;
    } | null;
    existingUser?: { id: string } | null;
    createError?: Error;
    linkedCount?: number;
  } = {}) {
    const transaction = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue(
          options.staffMember === undefined
            ? {
                displayName: 'Jane Santos',
                isActive: true,
                userId: null,
              }
            : options.staffMember,
        ),
        updateMany: jest.fn().mockResolvedValue({
          count: options.linkedCount ?? 1,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(
          options.existingUser ?? null,
        ),
        create: options.createError
          ? jest.fn().mockRejectedValue(options.createError)
          : jest.fn().mockResolvedValue({
              id: 'user-id',
              username: 'jane',
              displayName: 'Jane Santos',
            }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof transaction) => unknown) =>
            operation(transaction),
        ),
    };

    return { prisma, transaction };
  }

  function credentialPrisma(
    staffMember:
      | {
          id: string;
          displayName: string;
          isActive: boolean;
          locationId: string | null;
          createdAt: Date;
          updatedAt: Date;
          userId: string | null;
          user: { username: string; pinHash: string | null } | null;
        }
      | null = {
        id: staffMemberId,
        displayName: 'Jane Santos',
        isActive: true,
        locationId: null,
        createdAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
        userId: 'user-id',
        user: { username: 'jane', pinHash: 'old-pin-hash' },
      },
    updatedPinHash: string | null = 'old-pin-hash',
  ) {
    const transaction = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue(staffMember),
      },
      user: {
        update: jest.fn().mockResolvedValue({ pinHash: updatedPinHash }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };

    return { prisma, transaction };
  }

  it('looks up a trimmed username without regard to case', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      user: { findFirst },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.findByUsername('  AdMiN  ');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        username: {
          equals: 'AdMiN',
          mode: 'insensitive',
        },
      },
    });
  });

  it('looks up a staff account by its exact identifier', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      user: { findUnique },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.findById('staff-id');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'staff-id' },
    });
  });

  it('resolves the roster link and cashier-selection fields for a user', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      staffMember: { findUnique },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.findLinkedStaffMember('user-id');

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      select: { id: true, isActive: true, locationId: true },
    });
  });

  it('creates and links an active STAFF account in one transaction', async () => {
    const { prisma, transaction } = createAccountPrisma();
    const service = new UsersService(prisma as unknown as PrismaService);
    const hostileInput = {
      ...accountInput(),
      role: Role.ADMIN,
    };

    await expect(
      service.createStaffAccount(hostileInput),
    ).resolves.toEqual({
      username: 'jane',
      displayName: 'Jane Santos',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.user.findFirst).toHaveBeenCalledWith({
      where: {
        username: { equals: 'jane', mode: 'insensitive' },
      },
      select: { id: true },
    });
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        username: 'jane',
        displayName: 'Jane Santos',
        passwordHash: 'password-hash',
        pinHash: 'pin-hash',
        role: Role.STAFF,
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
      },
    });
    expect(transaction.staffMember.updateMany).toHaveBeenCalledWith({
      where: {
        id: staffMemberId,
        isActive: true,
        userId: null,
      },
      data: { userId: 'user-id' },
    });
  });

  it('uses an optional account display name and nullable PIN hash', async () => {
    const { prisma, transaction } = createAccountPrisma();
    transaction.user.create.mockResolvedValue({
      id: 'user-id',
      username: 'jane',
      displayName: 'J. Santos',
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await service.createStaffAccount({
      ...accountInput(),
      displayName: 'J. Santos',
      pinHash: null,
    });

    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: 'J. Santos',
          pinHash: null,
        }),
      }),
    );
  });

  it.each([
    ['missing member', null, NotFoundException],
    [
      'inactive member',
      { displayName: 'Jane Santos', isActive: false, userId: null },
      ConflictException,
    ],
    [
      'already-linked member',
      { displayName: 'Jane Santos', isActive: true, userId: 'existing-user' },
      ConflictException,
    ],
  ])('refuses a %s before creating a user', async (_case, member, errorType) => {
    const { prisma, transaction } = createAccountPrisma({
      staffMember: member,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.createStaffAccount(accountInput()),
    ).rejects.toBeInstanceOf(errorType);
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.staffMember.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a case-insensitive username collision without changing either record', async () => {
    const { prisma, transaction } = createAccountPrisma({
      existingUser: { id: 'existing-user' },
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.createStaffAccount(accountInput()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        field: 'username',
        reason: 'USERNAME_TAKEN',
      }),
    });
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.staffMember.updateMany).not.toHaveBeenCalled();
  });

  it('maps a concurrent P2002 username collision to the field conflict', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.0',
        meta: { target: ['username'] },
      },
    );
    const { prisma } = createAccountPrisma({ createError: error });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.createStaffAccount(accountInput()),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        field: 'username',
        reason: 'USERNAME_TAKEN',
      }),
    });
  });

  it('resolves a newly created normalized account with different casing', async () => {
    let createdUser: {
      id: string;
      username: string;
      displayName: string;
    } | null = null;
    const transaction = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue({
          displayName: 'Jane Santos',
          isActive: true,
          userId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          createdUser = {
            id: 'user-id',
            username: data.username,
            displayName: data.displayName,
          };
          return Promise.resolve(createdUser);
        }),
      },
    };
    const findFirst = jest.fn().mockImplementation(({ where }) => {
      if (
        createdUser &&
        createdUser.username.toLowerCase() ===
          where.username.equals.toLowerCase()
      ) {
        return Promise.resolve(createdUser);
      }
      return Promise.resolve(null);
    });
    const prisma = {
      $transaction: jest.fn().mockImplementation(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      user: { findFirst },
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    await service.createStaffAccount(accountInput());

    await expect(service.findByUsername('  JANE  ')).resolves.toMatchObject({
      id: 'user-id',
      username: 'jane',
    });
  });

  it('rolls back the user when linking the roster member fails', async () => {
    const durableUsers: Array<{ id: string }> = [];
    const stagedUsers: Array<{ id: string }> = [];
    const transaction = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue({
          displayName: 'Jane Santos',
          isActive: true,
          userId: null,
        }),
        updateMany: jest.fn().mockRejectedValue(new Error('link failed')),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(() => {
          const user = {
            id: 'user-id',
            username: 'jane',
            displayName: 'Jane Santos',
          };
          stagedUsers.push(user);
          return Promise.resolve(user);
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (
        operation: (client: typeof transaction) => Promise<unknown>,
      ) => {
        const result = await operation(transaction);
        durableUsers.push(...stagedUsers);
        return result;
      }),
    };
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.createStaffAccount(accountInput()),
    ).rejects.toThrow('link failed');
    expect(stagedUsers).toHaveLength(1);
    expect(durableUsers).toHaveLength(0);
  });

  it('updates both supplied hashes in one statement and returns no credential material', async () => {
    const { prisma, transaction } = credentialPrisma(
      undefined,
      'new-pin-hash',
    );
    const service = new UsersService(prisma as unknown as PrismaService);

    const result = await service.updateStaffCredentials({
      staffMemberId,
      passwordHash: 'new-password-hash',
      pinHash: 'new-pin-hash',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.staffMember.findUnique).toHaveBeenCalledWith({
      where: { id: staffMemberId },
      select: {
        id: true,
        displayName: true,
        isActive: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: { select: { username: true, pinHash: true } },
      },
    });
    expect(transaction.user.update).toHaveBeenCalledTimes(1);
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: {
        passwordHash: 'new-password-hash',
        pinHash: 'new-pin-hash',
      },
      select: { pinHash: true },
    });
    expect(result).toEqual({
      staffMember: {
        id: staffMemberId,
        displayName: 'Jane Santos',
        isActive: true,
        locationId: null,
        createdAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
        user: { username: 'jane' },
      },
      pinSet: true,
    });
    expect(JSON.stringify(result)).not.toContain('hash');
  });

  it.each([
    [
      'password',
      { passwordHash: 'new-password-hash' },
      { passwordHash: 'new-password-hash' },
    ],
    ['PIN', { pinHash: 'new-pin-hash' }, { pinHash: 'new-pin-hash' }],
  ])(
    'updates only the supplied %s hash',
    async (_credential, input, expectedData) => {
      const { prisma, transaction } = credentialPrisma(
        undefined,
        'pinHash' in input ? input.pinHash : 'old-pin-hash',
      );
      const service = new UsersService(prisma as unknown as PrismaService);

      await service.updateStaffCredentials({ staffMemberId, ...input });

      expect(transaction.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expectedData }),
      );
      expect(transaction.user.update.mock.calls[0][0].data).toEqual(
        expectedData,
      );
    },
  );

  it('sets the first PIN and reports that the account now has one', async () => {
    const memberWithoutPin = {
      id: staffMemberId,
      displayName: 'Jane Santos',
      isActive: true,
      locationId: null,
      createdAt: new Date('2026-08-23T00:00:00Z'),
      updatedAt: new Date('2026-08-23T00:00:00Z'),
      userId: 'user-id',
      user: { username: 'jane', pinHash: null },
    };
    const { prisma } = credentialPrisma(memberWithoutPin, 'new-pin-hash');
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.updateStaffCredentials({
        staffMemberId,
        pinHash: 'new-pin-hash',
      }),
    ).resolves.toMatchObject({ pinSet: true });
  });

  it.each([
    ['missing roster member', null, NotFoundException, undefined],
    [
      'roster member without an account',
      {
        id: staffMemberId,
        displayName: 'Jane Santos',
        isActive: true,
        locationId: null,
        createdAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
        userId: null,
        user: null,
      },
      ConflictException,
      'STAFF_MEMBER_HAS_NO_ACCOUNT',
    ],
  ])(
    'refuses a %s without updating a user',
    async (_case, member, errorType, reason) => {
      const { prisma, transaction } = credentialPrisma(member);
      const service = new UsersService(prisma as unknown as PrismaService);

      const result = service.updateStaffCredentials({
        staffMemberId,
        passwordHash: 'new-password-hash',
      });

      await expect(result).rejects.toBeInstanceOf(errorType);
      if (reason) {
        await expect(result).rejects.toMatchObject({
          status: 409,
          response: expect.objectContaining({ reason }),
        });
      }
      expect(transaction.user.update).not.toHaveBeenCalled();
    },
  );
});
