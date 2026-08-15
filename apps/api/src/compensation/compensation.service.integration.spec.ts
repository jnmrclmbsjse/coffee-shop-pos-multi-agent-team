import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompensationService } from './compensation.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('CompensationService against Postgres', () => {
  const locationId = randomUUID();
  const staffMemberId = randomUUID();
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
    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        displayName: 'Compensation Integration Staff',
        locationId,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.staffCompensationEntry.deleteMany({
      where: { staffMemberId },
    });
    await prisma.staffMember.deleteMany({ where: { id: staffMemberId } });
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
});
