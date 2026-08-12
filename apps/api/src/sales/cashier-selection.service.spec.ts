import type { PrismaService } from '../prisma/prisma.service';
import { CashierSelectionService } from './cashier-selection.service';

describe('CashierSelectionService', () => {
  const deviceId = 'till-1';
  const staffMemberId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const selectedByUserId = '09571f7f-3bc4-4211-b22f-1f165323f9de';
  const locationId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';

  function createService() {
    const prisma = {
      cashierSelection: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'selection-id' }),
      },
      sale: { update: jest.fn() },
      saleLine: { update: jest.fn() },
    };

    return {
      prisma,
      service: new CashierSelectionService(
        prisma as unknown as PrismaService,
      ),
    };
  }

  it('reads the latest selection and resolves its roster identity', async () => {
    const { prisma, service } = createService();
    prisma.cashierSelection.findFirst.mockResolvedValue({
      staffMember: { id: staffMemberId, displayName: 'Alex Rivera' },
    });

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
    const { prisma, service } = createService();
    prisma.cashierSelection.findFirst.mockResolvedValue(latest);

    await expect(service.activeCashier(deviceId)).resolves.toBeNull();
  });

  it('appends selections without rewriting selection or sale history', async () => {
    const { prisma, service } = createService();

    await service.appendSelection({
      deviceId,
      locationId,
      staffMemberId,
      selectedByUserId,
    });
    await service.appendSelection({
      deviceId,
      locationId,
      staffMemberId,
      selectedByUserId,
    });

    expect(prisma.cashierSelection.create).toHaveBeenCalledWith({
      data: { deviceId, locationId, staffMemberId, selectedByUserId },
    });
    expect(prisma.cashierSelection.create).toHaveBeenCalledTimes(2);
    expect(prisma.sale.update).not.toHaveBeenCalled();
    expect(prisma.saleLine.update).not.toHaveBeenCalled();
  });
});
