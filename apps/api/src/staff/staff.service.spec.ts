import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  const staffId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const locationId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';
  const now = new Date('2026-07-25T00:00:00Z');

  function staffRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: staffId,
      displayName: 'Alex Rivera',
      isActive: true,
      locationId: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function createPrisma() {
    return {
      staffMember: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      location: {
        findUnique: jest.fn(),
      },
    };
  }

  function createService(
    prisma: ReturnType<typeof createPrisma>,
    authService: Partial<AuthService> = {},
    usersService: Partial<UsersService> = {},
  ): StaffService {
    return new StaffService(
      prisma as unknown as PrismaService,
      authService as AuthService,
      usersService as UsersService,
    );
  }

  it('combines case-insensitive name search and active filtering', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findMany.mockResolvedValue([]);
    const service = createService(prisma);

    await service.list({
      search: 'aLeX',
      active: false,
      sort: 'name',
      direction: 'desc',
    });

    expect(prisma.staffMember.findMany).toHaveBeenCalledWith({
      where: {
        displayName: { contains: 'aLeX', mode: 'insensitive' },
        isActive: false,
      },
      orderBy: [{ displayName: 'desc' }],
      include: { user: { select: { username: true } } },
    });
  });

  it('returns only the exact active selectable projection', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: staffId,
        displayName: 'Alex Rivera',
        user: { pinHash: 'argon-hash' },
        userId: 'must-not-leak',
        isActive: true,
      },
      {
        id: '1b4f35af-a2c2-491d-88be-373c5efa4df4',
        displayName: 'Bailey Cruz',
        user: null,
      },
    ]);
    const service = createService(prisma);

    await expect(service.listSelectable()).resolves.toEqual([
      {
        id: staffId,
        displayName: 'Alex Rivera',
        requiresPin: true,
      },
      {
        id: '1b4f35af-a2c2-491d-88be-373c5efa4df4',
        displayName: 'Bailey Cruz',
        requiresPin: false,
      },
    ]);
    expect(prisma.staffMember.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        user: { select: { pinHash: true } },
      },
      orderBy: { displayName: 'asc' },
    });
  });

  it('keeps requiring a PIN when the linked account is deactivated', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: staffId,
        displayName: 'Alex Rivera',
        user: { pinHash: 'argon-hash', isActive: false },
      },
    ]);
    const service = createService(prisma);

    await expect(service.listSelectable()).resolves.toEqual([
      {
        id: staffId,
        displayName: 'Alex Rivera',
        requiresPin: true,
      },
    ]);
  });

  it('sorts inactive before active in ascending active order', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findMany.mockResolvedValue([]);
    const service = createService(prisma);

    await service.list({
      sort: 'active',
      direction: 'asc',
    });

    expect(prisma.staffMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { isActive: 'asc' },
          { displayName: 'asc' },
        ],
      }),
    );
  });

  it('creates duplicate names without a uniqueness check', async () => {
    const prisma = createPrisma();
    prisma.staffMember.create.mockResolvedValue(staffRecord());
    const service = createService(prisma);

    await service.create({
      displayName: 'Alex Rivera',
      isActive: true,
    });

    expect(prisma.staffMember.create).toHaveBeenCalledWith({
      data: {
        displayName: 'Alex Rivera',
        isActive: true,
        locationId: null,
      },
      include: { user: { select: { username: true } } },
    });
  });

  it('rejects a nonexistent location before creating staff', async () => {
    const prisma = createPrisma();
    prisma.location.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.create({
        displayName: 'Alex Rivera',
        isActive: true,
        locationId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.staffMember.create).not.toHaveBeenCalled();
  });

  it('updates the existing record for rename or status changes', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findUnique.mockResolvedValue({ id: staffId });
    prisma.staffMember.update.mockResolvedValue(
      staffRecord({ displayName: 'Alex Santos', isActive: false }),
    );
    const service = createService(prisma);

    const result = await service.update(staffId, {
      displayName: 'Alex Santos',
      isActive: false,
    });

    expect(prisma.staffMember.update).toHaveBeenCalledWith({
      where: { id: staffId },
      data: {
        displayName: 'Alex Santos',
        isActive: false,
      },
      include: { user: { select: { username: true } } },
    });
    expect(result).toMatchObject({
      id: staffId,
      displayName: 'Alex Santos',
      isActive: false,
      hasAccount: false,
      accountUsername: null,
    });
  });

  it('reports the linked login account on a staff member', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findMany.mockResolvedValue([
      staffRecord({ user: { username: 'alex' } }),
      staffRecord({ id: 'other-id', user: null }),
    ]);
    const service = createService(prisma);

    await expect(
      service.list({ sort: 'name', direction: 'asc' }),
    ).resolves.toMatchObject([
      { id: staffId, hasAccount: true, accountUsername: 'alex' },
      { id: 'other-id', hasAccount: false, accountUsername: null },
    ]);
  });

  it('returns not found instead of replacing a missing record', async () => {
    const prisma = createPrisma();
    prisma.staffMember.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.update(staffId, { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staffMember.update).not.toHaveBeenCalled();
  });

  it('hashes credentials through AuthService and creates the linked account', async () => {
    const prisma = createPrisma();
    const hashStaffCredentials = jest.fn().mockResolvedValue({
      passwordHash: 'password-hash',
      pinHash: 'pin-hash',
    });
    const createStaffAccount = jest.fn().mockResolvedValue({
      username: 'jane',
      displayName: 'Jane Santos',
    });
    const service = createService(
      prisma,
      { hashStaffCredentials },
      { createStaffAccount },
    );

    await expect(
      service.createAccount(staffId, {
        username: ' Jane ',
        displayName: 'Jane Santos',
        password: ' Exact Password ',
        pin: '4826',
      }),
    ).resolves.toEqual({
      username: 'jane',
      displayName: 'Jane Santos',
    });
    expect(hashStaffCredentials).toHaveBeenCalledWith(
      ' Exact Password ',
      '4826',
    );
    expect(createStaffAccount).toHaveBeenCalledWith({
      staffMemberId: staffId,
      username: ' Jane ',
      displayName: 'Jane Santos',
      passwordHash: 'password-hash',
      pinHash: 'pin-hash',
    });
  });
});
