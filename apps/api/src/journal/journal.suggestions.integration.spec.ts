import { randomUUID } from 'node:crypto';
import {
  OrderStatus,
  PaymentMethod,
  type Prisma,
  Role,
  SaleKind,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService, shopDate } from '../reporting/reporting.service';
import { JournalService } from './journal.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * The suggestion half of the Journal API against real SQL: the rate-in-force
 * lookup of ADR 0018 §4, the missing-days anti-join of §6, and the single
 * transaction that makes a bulk catch-up all-or-nothing.
 *
 * Business dates sit in 2019, long before the shop traded, so the fixtures
 * cannot collide with real rows. The ledger start date is in that same window,
 * but the missing-days range still ends at today, so every assertion filters to
 * the fixture month rather than assuming the database holds nothing else.
 */
describeWithDatabase('Journal suggestions and bulk catch-up against Postgres', () => {
  const userId = randomUUID();
  const staffMemberId = randomUUID();
  const ledgerId = randomUUID();
  const fixtureMonth = '2019-03';
  const closedDays = [
    { businessDate: '2019-03-03', grossCents: 780_000 },
    { businessDate: '2019-03-04', grossCents: 760_000 },
    { businessDate: '2019-03-06', grossCents: 300_000 },
  ];
  const openDay = { businessDate: '2019-03-07', grossCents: 999_999 };
  const allDays = [...closedDays, openDay];
  const tradingDayIds = new Map<string, string>(
    allDays.map((day) => [day.businessDate, randomUUID()]),
  );
  const saleIds = new Map<string, string>(
    allDays.map((day) => [day.businessDate, randomUUID()]),
  );
  const historicRateIds = [randomUUID(), randomUUID()];
  let prisma: PrismaService;
  let journal: JournalService;

  const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
  const inFixtureMonth = <T extends { businessDate: string }>(
    days: readonly T[],
  ): T[] => days.filter((day) => day.businessDate.startsWith(fixtureMonth));

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    journal = new JournalService(
      prisma,
      new ReportingService(
        prisma,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    );

    await prisma.user.create({
      data: {
        id: userId,
        username: `journal-suggestions-${userId}`,
        displayName: 'Journal suggestions admin',
        passwordHash: 'integration-test-only',
        role: Role.ADMIN,
      },
    });
    await prisma.staffMember.create({
      data: { id: staffMemberId, displayName: 'Journal suggestions staff' },
    });
    await prisma.tradingDay.createMany({
      data: allDays.map((day) => ({
        id: tradingDayIds.get(day.businessDate)!,
        businessDate: date(day.businessDate),
        status:
          day.businessDate === openDay.businessDate
            ? TradingDayStatus.OPEN
            : TradingDayStatus.CLOSED,
        openedAt: new Date(`${day.businessDate}T01:00:00.000Z`),
        closedAt:
          day.businessDate === openDay.businessDate
            ? null
            : new Date(`${day.businessDate}T12:00:00.000Z`),
        openingFloatCents: 10_000,
        openedByStaffMemberId: staffMemberId,
        closedByStaffMemberId:
          day.businessDate === openDay.businessDate ? null : staffMemberId,
      })),
    });
    await prisma.sale.createMany({
      data: allDays.map(
        (day): Prisma.SaleCreateManyInput => ({
          id: saleIds.get(day.businessDate)!,
          clientGeneratedId: randomUUID(),
          tradingDayId: tradingDayIds.get(day.businessDate)!,
          kind: SaleKind.PURCHASE,
          dayOrderNumber: 1,
          status: OrderStatus.COMPLETED,
          serviceType: ServiceType.TAKE_OUT,
          subtotalCents: day.grossCents,
          discountCents: 0,
          taxCents: 0,
          totalCents: day.grossCents,
          cashTipCents: 0,
        }),
      ),
    });
    await prisma.salePayment.createMany({
      data: allDays.map((day) => ({
        saleId: saleIds.get(day.businessDate)!,
        method: PaymentMethod.CASH,
        amountCents: day.grossCents,
      })),
    });
    await prisma.journalLedger.create({
      data: {
        id: ledgerId,
        name: `Rent ${ledgerId}`,
        startDate: date('2019-03-01'),
        startingBalanceCents: 0,
        suggestionKind: 'RENT_PERCENT_OF_ROUNDED_GROSS',
        isBuiltIn: false,
      },
    });
    // Two historic rate rows: 10% from the ledger's start, 15% from the 5th.
    await prisma.journalSuggestionRate.createMany({
      data: [
        {
          id: historicRateIds[0]!,
          ledgerId,
          effectiveFrom: date('2019-03-01'),
          rentPercentBasisPoints: 1_000,
        },
        {
          id: historicRateIds[1]!,
          ledgerId,
          effectiveFrom: date('2019-03-05'),
          rentPercentBasisPoints: 1_500,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.journalDeposit.deleteMany({ where: { ledgerId } });
    await prisma.journalSuggestionRate.deleteMany({ where: { ledgerId } });
    await prisma.journalLedger.deleteMany({ where: { id: ledgerId } });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: [...saleIds.values()] } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: [...saleIds.values()] } },
    });
    await prisma.tradingDay.deleteMany({
      where: { id: { in: [...tradingDayIds.values()] } },
    });
    await prisma.staffMember.deleteMany({ where: { id: staffMemberId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('suggests each missing day at the rate in force on its own business date', async () => {
    const days = inFixtureMonth(await journal.getMissingDays(ledgerId));

    expect(days).toEqual([
      {
        businessDate: '2019-03-03',
        grossSalesCents: 780_000,
        suggestedAmountCents: 80_000,
      },
      {
        businessDate: '2019-03-04',
        grossSalesCents: 760_000,
        suggestedAmountCents: 70_000,
      },
      {
        businessDate: '2019-03-06',
        grossSalesCents: 300_000,
        suggestedAmountCents: 45_000,
      },
    ]);
  });

  it('leaves an open business day out of the list entirely', async () => {
    const days = await journal.getMissingDays(ledgerId);

    expect(days.map((day) => day.businessDate)).not.toContain(
      openDay.businessDate,
    );
  });

  it('changes later business days only when the rate changes today', async () => {
    const before = inFixtureMonth(await journal.getMissingDays(ledgerId));

    await expect(
      journal.updateRate(ledgerId, { rentPercentBasisPoints: 2_000 }, userId),
    ).resolves.toMatchObject({
      effectiveFrom: shopDate(new Date()),
      rentPercentBasisPoints: 2_000,
    });
    // A second change on the same day upserts that one row, so no earlier
    // business day moves and no history is rewritten.
    await journal.updateRate(
      ledgerId,
      { rentPercentBasisPoints: 2_500 },
      userId,
    );

    expect(inFixtureMonth(await journal.getMissingDays(ledgerId))).toEqual(
      before,
    );
    await expect(journal.getRate(ledgerId)).resolves.toMatchObject({
      effectiveFrom: shopDate(new Date()),
      rentPercentBasisPoints: 2_500,
    });
    await expect(
      prisma.journalSuggestionRate.count({ where: { ledgerId } }),
    ).resolves.toBe(3);
  });

  it('drops a day from the list once a zero-peso deposit records it', async () => {
    await journal.createDeposit(
      ledgerId,
      { businessDate: '2019-03-04', amountCents: 0 } as never,
      userId,
    );

    const days = inFixtureMonth(await journal.getMissingDays(ledgerId));

    expect(days.map((day) => day.businessDate)).toEqual([
      '2019-03-03',
      '2019-03-06',
    ]);
  });

  it('rolls a whole bulk batch back and writes nothing when one day is taken', async () => {
    const before = await prisma.journalDeposit.count({ where: { ledgerId } });

    await expect(
      journal.createDepositsBulk(
        ledgerId,
        {
          deposits: [
            { businessDate: '2019-03-03', amountCents: 80_000 },
            { businessDate: '2019-03-04', amountCents: 70_000 },
          ],
        } as never,
        userId,
      ),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      prisma.journalDeposit.count({ where: { ledgerId } }),
    ).resolves.toBe(before);
    await expect(
      prisma.journalDeposit.findFirst({
        where: { ledgerId, businessDate: date('2019-03-03') },
      }),
    ).resolves.toBeNull();
  });

  it('writes every selected day together once the clash is gone', async () => {
    const deposits = await journal.createDepositsBulk(
      ledgerId,
      {
        deposits: [
          { businessDate: '2019-03-06', amountCents: 45_000 },
          { businessDate: '2019-03-03', amountCents: 80_000 },
        ],
      } as never,
      userId,
    );

    expect(deposits.map((deposit) => deposit.businessDate)).toEqual([
      '2019-03-03',
      '2019-03-06',
    ]);
    expect(inFixtureMonth(await journal.getMissingDays(ledgerId))).toEqual([]);
  });
});
