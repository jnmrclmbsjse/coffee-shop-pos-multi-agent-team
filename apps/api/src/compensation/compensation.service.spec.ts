import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompensationAdjustmentKind } from '@coffee-shop/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { CompensationService } from './compensation.service';

describe('CompensationService', () => {
  const staffMemberId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const locationId = '0dd85c48-9de0-405e-a899-803108c161d4';
  const entryId = '190d7f48-9389-4a6d-9348-fe056148bb97';
  const adjustmentId = '378de65f-e46d-45eb-a5c2-9d35cfe95d94';
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
    findManyResult?: typeof record[];
  } = {}) {
    const prisma = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue(
          options.staffMember === undefined
              ? {
                id: staffMemberId,
                displayName: 'Jane Santos',
                isActive: true,
                locationId,
              }
            : options.staffMember,
        ),
      },
      staffCompensationEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue(options.findManyResult ?? [record]),
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

  function setupAdjustments(options: {
    staffMember?: { displayName: string; locationId: string | null } | null;
    updateError?: Error;
    deleteError?: Error;
  } = {}) {
    const adjustmentRecord = {
      id: adjustmentId,
      staffMemberId,
      kind: 'ALLOWANCE' as const,
      effectiveDate: new Date('2026-08-15T00:00:00.000Z'),
      amountCents: 200,
      description: 'MiXeD  café allowance',
      locationId,
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
      createdAt: now,
      updatedAt: now,
      staffMember: { displayName: 'Jane Santos' },
    };
    const prisma = {
      staffMember: {
        findUnique: jest.fn().mockResolvedValue(
          options.staffMember === undefined
            ? { displayName: 'Jane Santos', locationId }
            : options.staffMember,
        ),
      },
      staffCompensationAdjustment: {
        findMany: jest.fn().mockResolvedValue([adjustmentRecord]),
        create: jest.fn().mockResolvedValue(adjustmentRecord),
        update: options.updateError
          ? jest.fn().mockRejectedValue(options.updateError)
          : jest.fn().mockResolvedValue({
              ...adjustmentRecord,
              effectiveDate: new Date('2026-08-16T00:00:00.000Z'),
              amountCents: 300,
              description: 'Spot bonus',
              updatedByUserId: updatedAdminUserId,
            }),
        delete: options.deleteError
          ? jest.fn().mockRejectedValue(options.deleteError)
          : jest.fn().mockResolvedValue(adjustmentRecord),
      },
    };

    return {
      adjustmentRecord,
      prisma,
      service: new CompensationService(prisma as unknown as PrismaService),
    };
  }

  it('generates a payslip with inclusive bounds and integer totals', async () => {
    const boundaryRecords = [
      {
        ...record,
        id: 'a2cffea6-a6a7-481a-b809-fcad1d4b89d8',
        workDate: new Date('2026-08-01T00:00:00.000Z'),
        salaryCents: 8_000,
        commissionCents: 250,
      },
      {
        ...record,
        workDate: new Date('2026-08-15T00:00:00.000Z'),
        salaryCents: 10_000,
        commissionCents: 500,
      },
    ];
    const { prisma, service } = setup({ findManyResult: boundaryRecords });

    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-08-01',
        to: '2026-08-15',
      }),
    ).resolves.toEqual({
      staffMember: { id: staffMemberId, displayName: 'Jane Santos' },
      from: '2026-08-01',
      to: '2026-08-15',
      entries: [
        expect.objectContaining({
          workDate: '2026-08-01',
          salaryCents: 8_000,
          commissionCents: 250,
          dailyTotalCents: 8_250,
        }),
        expect.objectContaining({
          workDate: '2026-08-15',
          salaryCents: 10_000,
          commissionCents: 500,
          dailyTotalCents: 10_500,
        }),
      ],
      salaryTotalCents: 18_000,
      commissionTotalCents: 750,
      grandTotalCents: 18_750,
    });
    expect(prisma.staffCompensationEntry.findMany).toHaveBeenCalledWith({
      where: {
        staffMemberId,
        workDate: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lt: new Date('2026-08-16T00:00:00.000Z'),
        },
      },
      orderBy: { workDate: 'asc' },
    });
  });

  it('changes payslip arithmetic when a seeded amount changes', async () => {
    const { service } = setup({
      findManyResult: [{ ...record, salaryCents: 10_001 }],
    });

    const result = await service.getPayslip({
      staffMemberId,
      from: '2026-08-15',
      to: '2026-08-15',
    });

    expect(result.salaryTotalCents).toBe(10_001);
    expect(result.grandTotalCents).toBe(10_501);
  });

  it('returns an empty payslip with zero totals for a valid range', async () => {
    const { service } = setup({ findManyResult: [] });

    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).resolves.toEqual({
      staffMember: { id: staffMemberId, displayName: 'Jane Santos' },
      from: '2026-07-01',
      to: '2026-07-31',
      entries: [],
      salaryTotalCents: 0,
      commissionTotalCents: 0,
      grandTotalCents: 0,
    });
  });

  it('returns a field-level 400 without querying for a reversed range', async () => {
    const { prisma, service } = setup();

    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-08-15',
        to: '2026-08-14',
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'to must be on or after from',
        field: 'to',
        reason: 'INVALID_DATE_RANGE',
      },
    });
    expect(prisma.staffMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.staffCompensationEntry.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown payslip staff member', async () => {
    const { prisma, service } = setup({ staffMember: null });

    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-08-01',
        to: '2026-08-15',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staffCompensationEntry.findMany).not.toHaveBeenCalled();
  });

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

  it('lists adjustments with inclusive filters in deterministic order', async () => {
    const { prisma, service } = setupAdjustments();

    await expect(
      service.listAdjustments({
        staffMemberId,
        from: '2026-08-01',
        to: '2026-08-15',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: CompensationAdjustmentKind.ALLOWANCE,
        effectiveDate: '2026-08-15',
        amountCents: 200,
        description: 'MiXeD  café allowance',
      }),
    ]);
    expect(prisma.staffCompensationAdjustment.findMany).toHaveBeenCalledWith({
      where: {
        staffMemberId,
        effectiveDate: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-15T00:00:00.000Z'),
        },
      },
      include: expect.any(Object),
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'asc' }],
    });
  });

  it('refuses a reversed adjustment range before querying records', async () => {
    const { prisma, service } = setupAdjustments();

    await expect(
      service.listAdjustments({ from: '2026-08-16', to: '2026-08-15' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.staffCompensationAdjustment.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when an adjustment list filters by an unknown staff member', async () => {
    const { prisma, service } = setupAdjustments({ staffMember: null });

    await expect(
      service.listAdjustments({ staffMemberId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.staffCompensationAdjustment.findMany).not.toHaveBeenCalled();
  });

  it.each(Object.values(CompensationAdjustmentKind))(
    'creates a %s adjustment with a location snapshot and both audit users',
    async (kind) => {
      const { prisma, service } = setupAdjustments();

      await expect(
        service.createAdjustment(
          {
            staffMemberId,
            kind,
            effectiveDate: '2026-08-15',
            amountCents: 200,
            description: '  MiXeD  café allowance  ',
          } as never,
          adminUserId,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          locationId,
          description: 'MiXeD  café allowance',
        }),
      );
      expect(prisma.staffCompensationAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            staffMemberId,
            kind,
            effectiveDate: new Date('2026-08-15T00:00:00.000Z'),
            amountCents: 200,
            description: 'MiXeD  café allowance',
            locationId,
            createdByUserId: adminUserId,
            updatedByUserId: adminUserId,
          },
        }),
      );
    },
  );

  it('does not suppress identical adjustment creates', async () => {
    const { prisma, service } = setupAdjustments();
    const input = {
      staffMemberId,
      kind: CompensationAdjustmentKind.ALLOWANCE,
      effectiveDate: '2026-08-15',
      amountCents: 200,
      description: 'Transportation allowance',
    } as never;

    await service.createAdjustment(input, adminUserId);
    await service.createAdjustment(input, adminUserId);

    expect(prisma.staffCompensationAdjustment.create).toHaveBeenCalledTimes(2);
  });

  it('updates date, amount, verbatim description, and the authenticated updater', async () => {
    const { prisma, service } = setupAdjustments();

    await expect(
      service.updateAdjustment(
        adjustmentId,
        {
          effectiveDate: '2026-08-16',
          amountCents: 300,
          description: '  Spot bonus  ',
        } as never,
        updatedAdminUserId,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        effectiveDate: '2026-08-16',
        amountCents: 300,
        description: 'Spot bonus',
      }),
    );
    expect(prisma.staffCompensationAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: adjustmentId },
        data: {
          effectiveDate: new Date('2026-08-16T00:00:00.000Z'),
          amountCents: 300,
          description: 'Spot bonus',
          updatedByUserId: updatedAdminUserId,
        },
      }),
    );
  });

  it.each(['update', 'delete'] as const)(
    'maps an unknown adjustment on %s to 404',
    async (operation) => {
      const { service } = setupAdjustments({
        ...(operation === 'update'
          ? { updateError: prismaError('P2025') }
          : { deleteError: prismaError('P2025') }),
      });
      const result =
        operation === 'update'
          ? service.updateAdjustment(
              adjustmentId,
              {
                effectiveDate: '2026-08-16',
                amountCents: 300,
                description: 'Spot bonus',
              } as never,
              updatedAdminUserId,
            )
          : service.removeAdjustment(adjustmentId);

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('hard-deletes an adjustment', async () => {
    const { prisma, service } = setupAdjustments();

    await expect(
      service.removeAdjustment(adjustmentId),
    ).resolves.toBeUndefined();
    expect(prisma.staffCompensationAdjustment.delete).toHaveBeenCalledWith({
      where: { id: adjustmentId },
    });
  });
});
