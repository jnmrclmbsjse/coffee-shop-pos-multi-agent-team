import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CompensationService } from './compensation.service';

describe('CompensationService', () => {
  const staffMemberId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const locationId = '0dd85c48-9de0-405e-a899-803108c161d4';
  const entryId = '190d7f48-9389-4a6d-9348-fe056148bb97';
  const adminUserId = '44fc441b-a59f-45c3-b7ae-7ea93d1b06d3';
  const updatedAdminUserId = '3e428f7e-d295-45a4-9fe7-c9c8e39f2b46';
  const now = new Date('2026-08-15T04:00:00.000Z');
  const record = {
    id: entryId,
    staffMemberId,
    workDate: new Date('2026-08-15T00:00:00.000Z'),
    salaryCents: 10_000,
    commissionCents: 500,
    locationId,
    createdByUserId: adminUserId,
    updatedByUserId: adminUserId,
    createdAt: now,
    updatedAt: now,
    staffMember: { displayName: 'Jane Santos' },
  };
  const createInput = {
    staffMemberId,
    workDate: '2026-08-15',
    salaryCents: 10_000,
    commissionCents: 500,
  };

  function setup(options: {
    staffMember?: {
      displayName: string;
      isActive: boolean;
      locationId: string | null;
    } | null;
    createError?: Error;
    updateError?: Error;
    deleteError?: Error;
  } = {}) {
    const prisma = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue(
          options.staffMember === undefined
            ? {
                displayName: 'Jane Santos',
                isActive: true,
                locationId,
              }
            : options.staffMember,
        ),
      },
      staffCompensationEntry: {
        findMany: jest.fn().mockResolvedValue([record]),
        create: options.createError
          ? jest.fn().mockRejectedValue(options.createError)
          : jest.fn().mockResolvedValue(record),
        update: options.updateError
          ? jest.fn().mockRejectedValue(options.updateError)
          : jest.fn().mockResolvedValue({
              ...record,
              salaryCents: 20_000,
              commissionCents: 1_000,
              updatedByUserId: updatedAdminUserId,
            }),
        delete: options.deleteError
          ? jest.fn().mockRejectedValue(options.deleteError)
          : jest.fn().mockResolvedValue(record),
      },
    };
    return {
      prisma,
      service: new CompensationService(
        prisma as unknown as PrismaService,
      ),
    };
  }

  function prismaError(code: string): Error {
    return new Prisma.PrismaClientKnownRequestError('Database error', {
      code,
      clientVersion: '6.19.0',
    });
  }

  it('lists optional filters in deterministic order and derives the total', async () => {
    const { prisma, service } = setup();

    await expect(
      service.list({
        staffMemberId,
        from: '2026-08-01',
        to: '2026-08-15',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        staffMemberDisplayName: 'Jane Santos',
        workDate: '2026-08-15',
        salaryCents: 10_000,
        commissionCents: 500,
        dailyTotalCents: 10_500,
      }),
    ]);
    expect(prisma.staffCompensationEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          staffMemberId,
          workDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lte: new Date('2026-08-15T00:00:00.000Z'),
          },
        },
        orderBy: [
          { workDate: 'desc' },
          { staffMember: { displayName: 'asc' } },
        ],
      }),
    );
  });

  it('creates from integer amounts, snapshots location, and sets both audit users', async () => {
    const { prisma, service } = setup();

    await expect(
      service.create(createInput as never, adminUserId),
    ).resolves.toEqual(
      expect.objectContaining({
        dailyTotalCents: 10_500,
        locationId,
      }),
    );
    expect(prisma.staffCompensationEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          staffMemberId,
          workDate: new Date('2026-08-15T00:00:00.000Z'),
          salaryCents: 10_000,
          commissionCents: 500,
          locationId,
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
        },
      }),
    );
  });

  it('refuses an unknown staff member', async () => {
    const { prisma, service } = setup({ staffMember: null });

    await expect(
      service.create(createInput as never, adminUserId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staffCompensationEntry.create).not.toHaveBeenCalled();
  });

  it('accepts a future calendar work date without applying trading-day rules', async () => {
    const { prisma, service } = setup();

    await expect(
      service.create(
        { ...createInput, workDate: '2026-08-17' } as never,
        adminUserId,
      ),
    ).resolves.toEqual(expect.objectContaining({ dailyTotalCents: 10_500 }));
    expect(prisma.staffCompensationEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workDate: new Date('2026-08-17T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('maps P2002 to a named 409 without attempting to modify the existing row', async () => {
    const { prisma, service } = setup({ createError: prismaError('P2002') });

    await expect(
      service.create(createInput as never, adminUserId),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        message: expect.stringContaining('Jane Santos'),
        reason: 'DUPLICATE_COMPENSATION_ENTRY',
      }),
    });
    expect(prisma.staffCompensationEntry.update).not.toHaveBeenCalled();
    expect(prisma.staffCompensationEntry.delete).not.toHaveBeenCalled();
  });

  it('updates only amounts and the authenticated updater, then derives the new total', async () => {
    const { prisma, service } = setup();

    await expect(
      service.update(
        entryId,
        { salaryCents: 20_000, commissionCents: 1_000 } as never,
        updatedAdminUserId,
      ),
    ).resolves.toEqual(expect.objectContaining({ dailyTotalCents: 21_000 }));
    expect(prisma.staffCompensationEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: entryId },
        data: {
          salaryCents: 20_000,
          commissionCents: 1_000,
          updatedByUserId: updatedAdminUserId,
        },
      }),
    );
  });

  it.each(['update', 'delete'] as const)(
    'maps an unknown entry on %s to 404',
    async (operation) => {
      const { service } = setup({
        ...(operation === 'update'
          ? { updateError: prismaError('P2025') }
          : { deleteError: prismaError('P2025') }),
      });

      const result =
        operation === 'update'
          ? service.update(
              entryId,
              { salaryCents: 1, commissionCents: 2 } as never,
              adminUserId,
            )
          : service.remove(entryId);

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('hard-deletes an existing entry', async () => {
    const { prisma, service } = setup();

    await expect(service.remove(entryId)).resolves.toBeUndefined();
    expect(prisma.staffCompensationEntry.delete).toHaveBeenCalledWith({
      where: { id: entryId },
    });
  });

  it('does not hide entries belonging to deactivated staff on list or update', async () => {
    const { prisma, service } = setup({
      staffMember: {
        displayName: 'Jane Santos',
        isActive: false,
        locationId,
      },
    });

    await service.list({ staffMemberId });
    await service.update(
      entryId,
      { salaryCents: 20_000, commissionCents: 1_000 } as never,
      updatedAdminUserId,
    );

    expect(prisma.staffMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.staffCompensationEntry.update).toHaveBeenCalled();
  });

  it('allows creating an entry for a deactivated staff member', async () => {
    const { prisma, service } = setup({
      staffMember: {
        displayName: 'Jane Santos',
        isActive: false,
        locationId,
      },
    });

    await expect(
      service.create(createInput as never, adminUserId),
    ).resolves.toEqual(expect.objectContaining({ dailyTotalCents: 10_500 }));
    expect(prisma.staffCompensationEntry.create).toHaveBeenCalled();
  });

  it('does not disguise unrelated database errors as conflicts', async () => {
    const error = prismaError('P2003');
    const { service } = setup({ createError: error });

    await expect(service.create(createInput as never, adminUserId)).rejects.toBe(
      error,
    );
  });
});
