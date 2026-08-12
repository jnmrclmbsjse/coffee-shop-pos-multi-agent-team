import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CashierSelectionService } from './cashier-selection.service';
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
      },
      authService: { authorizeCashierPin: jest.fn() },
      cashierSelectionService: {
        activeCashier: jest.fn(),
        appendSelection: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('reads the latest selection and resolves only its roster identity', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    cashierSelectionService.activeCashier.mockResolvedValue({
      staffMember: { id: staffMemberId, displayName: 'Alex Rivera' },
    });
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
    );

    await service.activeCashier(deviceId);
    expect(cashierSelectionService.activeCashier).toHaveBeenCalledWith(
      deviceId,
      prisma,
    );
  });

  it('returns null when the selection service has no active cashier', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    cashierSelectionService.activeCashier.mockResolvedValue(null);
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
    );

    await expect(service.activeCashier(deviceId)).resolves.toBeNull();
  });

  it('selects an ungated member with an append-only insert', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(member());
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
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
    expect(cashierSelectionService.appendSelection).toHaveBeenCalledWith({
      deviceId,
      locationId,
      staffMemberId,
      selectedByUserId,
    });
  });

  it('re-derives the PIN requirement and authorizes before inserting', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(
      member({ user: { pinHash: 'configured-hash' } }),
    );
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
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
      cashierSelectionService.appendSelection.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ['unknown member', null],
    ['inactive member', member({ isActive: false })],
  ])('writes nothing for an %s', async (_case, foundMember) => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(foundMember);
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
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
    expect(cashierSelectionService.appendSelection).not.toHaveBeenCalled();
  });

  it('refuses a malformed member identifier without touching the database', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
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
    expect(cashierSelectionService.appendSelection).not.toHaveBeenCalled();
  });

  it('leaves the prior selection untouched when authorization fails', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(
      member({ user: { pinHash: 'configured-hash' } }),
    );
    authService.authorizeCashierPin.mockRejectedValue(
      new UnauthorizedException('generic failure'),
    );
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
    );

    await expect(
      service.selectCashier(
        deviceId,
        staffMemberId,
        'bad',
        selectedByUserId,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(cashierSelectionService.appendSelection).not.toHaveBeenCalled();
  });

  it('appends every change and clear without updating or deleting history', async () => {
    const { prisma, authService, cashierSelectionService } = createDependencies();
    prisma.staffMember.findUnique.mockResolvedValue(member());
    const service = new SalesService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      cashierSelectionService as unknown as CashierSelectionService,
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

    expect(cashierSelectionService.appendSelection).toHaveBeenCalledTimes(2);
    expect(cashierSelectionService.appendSelection).toHaveBeenLastCalledWith({
      deviceId,
      locationId: null,
      staffMemberId: null,
      selectedByUserId,
    });
  });
});
