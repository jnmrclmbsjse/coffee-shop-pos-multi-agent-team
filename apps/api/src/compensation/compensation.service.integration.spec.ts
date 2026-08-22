import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CompensationAdjustmentKind } from '@coffee-shop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompensationService } from './compensation.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('CompensationService against Postgres', () => {
  const locationId = randomUUID();
  const staffMemberId = randomUUID();
  const otherStaffMemberId = randomUUID();
  const adminUserId = randomUUID();
  const secondAdminUserId = randomUUID();
  let prisma: PrismaService;
  let service: CompensationService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    service = new CompensationService(prisma);

    await prisma.location.create({
      data: { id: locationId, name: `Compensation test ${locationId}` },
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminUserId,
          username: `comp-admin-${adminUserId}`,
          displayName: 'Compensation Admin',
          passwordHash: 'not-used-in-integration-test',
          role: Role.ADMIN,
        },
        {
          id: secondAdminUserId,
          username: `comp-admin-${secondAdminUserId}`,
          displayName: 'Second Compensation Admin',
          passwordHash: 'not-used-in-integration-test',
          role: Role.ADMIN,
        },
      ],
    });
    await prisma.staffMember.createMany({
      data: [
        {
          id: staffMemberId,
          displayName: 'Compensation Integration Staff',
          locationId,
        },
        {
          id: otherStaffMemberId,
          displayName: 'Other Compensation Staff',
          locationId,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.staffCompensationAdjustment.deleteMany({
      where: { staffMemberId: { in: [staffMemberId, otherStaffMemberId] } },
    });
    await prisma.staffCompensationEntry.deleteMany({
      where: { staffMemberId: { in: [staffMemberId, otherStaffMemberId] } },
    });
    await prisma.staffMember.deleteMany({
      where: { id: { in: [staffMemberId, otherStaffMemberId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, secondAdminUserId] } },
    });
    await prisma.location.deleteMany({ where: { id: locationId } });
    await prisma.$disconnect();
  });

  it('persists CRUD, snapshots location and audit users, and keeps duplicate refusal non-destructive', async () => {
    const workDate = '2026-08-14';
    const created = await service.create(
      {
        staffMemberId,
        workDate,
        salaryCents: 12_000,
        commissionCents: 750,
      } as never,
      adminUserId,
    );

    expect(created).toEqual(
      expect.objectContaining({
        staffMemberId,
        workDate,
        salaryCents: 12_000,
        commissionCents: 750,
        dailyTotalCents: 12_750,
        locationId,
      }),
    );

    await expect(
      service.create(
        {
          staffMemberId,
          workDate,
          salaryCents: 99_999,
          commissionCents: 99_999,
        } as never,
        adminUserId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const afterDuplicate = await prisma.staffCompensationEntry.findUniqueOrThrow(
      { where: { id: created.id } },
    );
    expect(afterDuplicate).toMatchObject({
      salaryCents: 12_000,
      commissionCents: 750,
      locationId,
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
    });

    const updated = await service.update(
      created.id,
      { salaryCents: 13_000, commissionCents: 1_000 } as never,
      secondAdminUserId,
    );
    expect(updated.dailyTotalCents).toBe(14_000);

    const persistedUpdate =
      await prisma.staffCompensationEntry.findUniqueOrThrow({
        where: { id: created.id },
      });
    expect(persistedUpdate).toMatchObject({
      staffMemberId,
      workDate: new Date('2026-08-14T00:00:00.000Z'),
      salaryCents: 13_000,
      commissionCents: 1_000,
      createdByUserId: adminUserId,
      updatedByUserId: secondAdminUserId,
    });

    await expect(
      service.list({
        staffMemberId,
        from: workDate,
        to: workDate,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: created.id, dailyTotalCents: 14_000 }),
    ]);

    await service.remove(created.id);
    await expect(
      prisma.staffCompensationEntry.findUnique({
        where: { id: created.id },
      }),
    ).resolves.toBeNull();
  });

  it('computes a fresh payslip for only the requested staff and inclusive date range', async () => {
    const before = await service.create(
      {
        staffMemberId,
        workDate: '2026-09-09',
        salaryCents: 90_000,
        commissionCents: 9_000,
      } as never,
      adminUserId,
    );
    const fromBoundary = await service.create(
      {
        staffMemberId,
        workDate: '2026-09-10',
        salaryCents: 10_000,
        commissionCents: 100,
      } as never,
      adminUserId,
    );
    const toBoundary = await service.create(
      {
        staffMemberId,
        workDate: '2026-09-12',
        salaryCents: 12_000,
        commissionCents: 300,
      } as never,
      adminUserId,
    );
    const after = await service.create(
      {
        staffMemberId,
        workDate: '2026-09-13',
        salaryCents: 130_000,
        commissionCents: 13_000,
      } as never,
      adminUserId,
    );
    const otherStaffEntry = await service.create(
      {
        staffMemberId: otherStaffMemberId,
        workDate: '2026-09-11',
        salaryCents: 110_000,
        commissionCents: 11_000,
      } as never,
      adminUserId,
    );

    const initial = await service.getPayslip({
      staffMemberId,
      from: '2026-09-10',
      to: '2026-09-12',
    });
    expect(initial).toEqual({
      staffMember: {
        id: staffMemberId,
        displayName: 'Compensation Integration Staff',
      },
      from: '2026-09-10',
      to: '2026-09-12',
      entries: [
        expect.objectContaining({
          id: fromBoundary.id,
          workDate: '2026-09-10',
          dailyTotalCents: 10_100,
        }),
        expect.objectContaining({
          id: toBoundary.id,
          workDate: '2026-09-12',
          dailyTotalCents: 12_300,
        }),
      ],
      salaryTotalCents: 22_000,
      commissionTotalCents: 400,
      grandTotalCents: 22_400,
    });
    expect(initial.entries.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining([
        before.id,
        after.id,
        otherStaffEntry.id,
      ]),
    );

    await service.update(
      fromBoundary.id,
      { salaryCents: 20_000, commissionCents: 200 } as never,
      secondAdminUserId,
    );
    const afterUpdate = await service.getPayslip({
      staffMemberId,
      from: '2026-09-10',
      to: '2026-09-12',
    });
    expect(afterUpdate.salaryTotalCents).toBe(32_000);
    expect(afterUpdate.commissionTotalCents).toBe(500);
    expect(afterUpdate.grandTotalCents).toBe(32_500);

    await service.remove(toBoundary.id);
    const afterDelete = await service.getPayslip({
      staffMemberId,
      from: '2026-09-10',
      to: '2026-09-12',
    });
    expect(afterDelete.entries).toHaveLength(1);
    expect(afterDelete.grandTotalCents).toBe(20_200);

    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [],
        salaryTotalCents: 0,
        commissionTotalCents: 0,
        grandTotalCents: 0,
      }),
    );
    await expect(
      service.getPayslip({
        staffMemberId,
        from: '2026-09-12',
        to: '2026-09-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getPayslip({
        staffMemberId: randomUUID(),
        from: '2026-09-10',
        to: '2026-09-12',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists adjustment CRUD for all kinds, preserves duplicates and descriptions, and filters inclusively', async () => {
    const createdIds: string[] = [];
    const descriptions = {
      [CompensationAdjustmentKind.ADVANCE]: 'Salary advance',
      [CompensationAdjustmentKind.ALLOWANCE]: '  MiXeD  café allowance  ',
      [CompensationAdjustmentKind.BONUS]: 'Spot bonus',
    };

    for (const kind of Object.values(CompensationAdjustmentKind)) {
      const created = await service.createAdjustment(
        {
          staffMemberId,
          kind,
          effectiveDate: '2026-10-10',
          amountCents: 200,
          description: descriptions[kind],
        } as never,
        adminUserId,
      );
      createdIds.push(created.id);
    }

    const duplicate = await service.createAdjustment(
      {
        staffMemberId,
        kind: CompensationAdjustmentKind.ALLOWANCE,
        effectiveDate: '2026-10-10',
        amountCents: 200,
        description: 'MiXeD  café allowance',
      } as never,
      adminUserId,
    );
    createdIds.push(duplicate.id);

    const listed = await service.listAdjustments({
      staffMemberId,
      from: '2026-10-10',
      to: '2026-10-10',
    });
    expect(listed).toHaveLength(4);
    expect(listed.filter((item) => item.kind === 'ALLOWANCE')).toHaveLength(2);
    expect(
      listed.filter(
        (item) =>
          item.kind === 'ALLOWANCE' &&
          item.amountCents === 200 &&
          item.description === 'MiXeD  café allowance',
      ),
    ).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ADVANCE', locationId }),
        expect.objectContaining({ kind: 'BONUS', locationId }),
      ]),
    );

    const storedBeforeUpdate =
      await prisma.staffCompensationAdjustment.findUniqueOrThrow({
        where: { id: createdIds[0]! },
      });
    expect(storedBeforeUpdate).toMatchObject({
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
      locationId,
    });

    const updated = await service.updateAdjustment(
      createdIds[0]!,
      {
        effectiveDate: '2026-10-11',
        amountCents: 350,
        description: '  Emergency advance  ',
      } as never,
      secondAdminUserId,
    );
    expect(updated).toEqual(
      expect.objectContaining({
        kind: 'ADVANCE',
        effectiveDate: '2026-10-11',
        amountCents: 350,
        description: 'Emergency advance',
      }),
    );
    const storedAfterUpdate =
      await prisma.staffCompensationAdjustment.findUniqueOrThrow({
        where: { id: createdIds[0]! },
      });
    expect(storedAfterUpdate).toMatchObject({
      createdByUserId: adminUserId,
      updatedByUserId: secondAdminUserId,
    });

    await service.removeAdjustment(createdIds[0]!);
    createdIds.shift();
    await expect(
      prisma.staffCompensationAdjustment.findUnique({
        where: { id: storedAfterUpdate.id },
      }),
    ).resolves.toBeNull();

    await prisma.staffCompensationAdjustment.deleteMany({
      where: { id: { in: createdIds } },
    });
  });

  it('enforces a positive adjustment amount at the database boundary', async () => {
    await expect(
      prisma.staffCompensationAdjustment.create({
        data: {
          staffMemberId,
          kind: 'BONUS',
          effectiveDate: new Date('2026-10-20T00:00:00.000Z'),
          amountCents: 0,
          description: 'Spot bonus',
          locationId,
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
        },
      }),
    ).rejects.toBeDefined();
  });
});
