import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CASHIER_UNAVAILABLE_MESSAGE,
  SalesService,
} from './sales.service';

describe('SalesService active cashier selection', () => {
  const deviceId = 'till-1';
  const staffMemberId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const selectedByUserId = '09571f7f-3bc4-4211-b22f-1f165323f9de';
  const locationId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';

  function member(overrides: Record<string, unknown> = {}) {
    return {
      id: staffMemberId,
      displayName: 'Alex Rivera',
      isActive: true,
      locationId,
      user: null,
      ...overrides,
    };
  }

  function createDependencies() {
    return {
      prisma: {
        staffMember: { findUnique: jest.fn() },
        cashierSelection: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'selection-id' }),
        },
      },
      authService: { authorizeCashierPin: jest.fn() },
    };
  }

  it('reads the latest selection and resolves only its roster identity', async () => {
    const { prisma, authService } = createDependencies();
    prisma.cashierSelection.findFirst.mockResolvedValue({
      staffMember: { id: staffMemberId, displayName: 'Alex Rivera' },
    });
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await expect(service.activeCashier(deviceId)).resolves.toEqual({
      id: staffMemberId,
      displayName: 'Alex Rivera',
    });
    expect(prisma.cashierSelection.findFirst).toHaveBeenCalledWith({
      where: { deviceId },
      select: {
        staffMember: { select: { id: true, displayName: true } },
      },
      orderBy: { selectedAt: 'desc' },
    });
  });

  it.each([
    ['no history', null],
    ['latest row is cleared', { staffMember: null }],
  ])('returns null when %s', async (_case, latest) => {
    const { prisma, authService } = createDependencies();
    prisma.cashierSelection.findFirst.mockResolvedValue(latest);
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await expect(service.activeCashier(deviceId)).resolves.toBeNull();
  });

  it('selects an ungated member with an append-only insert', async () => {
    const { prisma, authService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(member());
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await expect(
      service.selectCashier(
        deviceId,
        staffMemberId,
        undefined,
        selectedByUserId,
      ),
    ).resolves.toEqual({ id: staffMemberId, displayName: 'Alex Rivera' });
    expect(authService.authorizeCashierPin).not.toHaveBeenCalled();
    expect(prisma.cashierSelection.create).toHaveBeenCalledWith({
      data: {
        deviceId,
        locationId,
        staffMemberId,
        selectedByUserId,
      },
    });
  });

  it('re-derives the PIN requirement and authorizes before inserting', async () => {
    const { prisma, authService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(
      member({ user: { pinHash: 'configured-hash' } }),
    );
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await service.selectCashier(
      deviceId,
      staffMemberId,
      '1234',
      selectedByUserId,
    );

    expect(authService.authorizeCashierPin).toHaveBeenCalledWith(
      staffMemberId,
      '1234',
      deviceId,
    );
    expect(authService.authorizeCashierPin.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.cashierSelection.create.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ['unknown member', null],
    ['inactive member', member({ isActive: false })],
  ])('writes nothing for an %s', async (_case, foundMember) => {
    const { prisma, authService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(foundMember);
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await expect(
      service.selectCashier(
        deviceId,
        staffMemberId,
        '1234',
        selectedByUserId,
      ),
    ).rejects.toEqual(new BadRequestException(CASHIER_UNAVAILABLE_MESSAGE));
    expect(authService.authorizeCashierPin).not.toHaveBeenCalled();
    expect(prisma.cashierSelection.create).not.toHaveBeenCalled();
  });

  it('refuses a malformed member identifier without touching the database', async () => {
    const { prisma, authService } = createDependencies();
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await expect(
      service.selectCashier(
        deviceId,
        'not-a-uuid',
        '1234',
        selectedByUserId,
      ),
    ).rejects.toEqual(new BadRequestException(CASHIER_UNAVAILABLE_MESSAGE));
    expect(prisma.staffMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.cashierSelection.create).not.toHaveBeenCalled();
  });

  it.each(['wrong PIN', 'missing PIN', 'incomplete PIN', 'throttled']) (
    'leaves the prior selection untouched when authorization is %s',
    async () => {
      const { prisma, authService } = createDependencies();
      prisma.staffMember.findUnique.mockResolvedValue(
        member({ user: { pinHash: 'configured-hash' } }),
      );
      authService.authorizeCashierPin.mockRejectedValue(
        new UnauthorizedException('generic failure'),
      );
      const service = new SalesService(
        prisma as unknown as PrismaService,
        authService as unknown as AuthService,
      );

      await expect(
        service.selectCashier(
          deviceId,
          staffMemberId,
          'bad',
          selectedByUserId,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.cashierSelection.create).not.toHaveBeenCalled();
    },
  );

  it('appends every change and clear without updating or deleting history', async () => {
    const { prisma, authService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(member());
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    await service.selectCashier(
      deviceId,
      staffMemberId,
      undefined,
      selectedByUserId,
    );
    await expect(
      service.clearCashier(deviceId, selectedByUserId),
    ).resolves.toBeNull();

    expect(prisma.cashierSelection.create).toHaveBeenCalledTimes(2);
    expect(prisma.cashierSelection.create).toHaveBeenLastCalledWith({
      data: {
        deviceId,
        locationId: null,
        staffMemberId: null,
        selectedByUserId,
      },
    });
    expect(prisma.cashierSelection).not.toHaveProperty('update');
    expect(prisma.cashierSelection).not.toHaveProperty('delete');
  });
});
