import { randomUUID } from 'node:crypto';
import { Role, TradingDayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from '../reporting/reporting.service';
import { JournalService } from './journal.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Journal cash inertness against Postgres', () => {
  const userId = randomUUID();
  const staffMemberId = randomUUID();
  const tradingDayId = randomUUID();
  const cashCountId = randomUUID();
  const ledgerId = randomUUID();
  const businessDate = '2096-11-17';
  let prisma: PrismaService;
  let journal: JournalService;
  let reporting: ReportingService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    reporting = new ReportingService(
      prisma,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    journal = new JournalService(prisma, reporting);

    await prisma.user.create({
      data: {
        id: userId,
        username: `journal-inert-${userId}`,
        displayName: 'Journal inertness admin',
        passwordHash: 'integration-test-only',
        role: Role.ADMIN,
      },
    });
    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        displayName: 'Journal inertness staff',
      },
    });
    await prisma.tradingDay.create({
      data: {
        id: tradingDayId,
        businessDate: new Date(`${businessDate}T00:00:00.000Z`),
        status: TradingDayStatus.CLOSED,
        openedAt: new Date(`${businessDate}T01:00:00.000Z`),
        closedAt: new Date(`${businessDate}T12:00:00.000Z`),
        openingFloatCents: 10_000,
        openedByStaffMemberId: staffMemberId,
        closedByStaffMemberId: staffMemberId,
      },
    });
    await prisma.cashCount.create({
      data: {
        id: cashCountId,
        tradingDayId,
        countedCents: 10_000,
        countedAt: new Date(`${businessDate}T12:00:00.000Z`),
        countedByStaffMemberId: staffMemberId,
      },
    });
    await prisma.journalLedger.create({
      data: {
        id: ledgerId,
        name: `Inertness ${ledgerId}`,
        startDate: new Date(`${businessDate}T00:00:00.000Z`),
        startingBalanceCents: 0,
        suggestionKind: 'NONE',
        isBuiltIn: false,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.journalDeposit.deleteMany({ where: { ledgerId } });
    await prisma.journalWithdrawal.deleteMany({ where: { ledgerId } });
    await prisma.journalLedger.deleteMany({ where: { id: ledgerId } });
    await prisma.cashCount.deleteMany({ where: { id: cashCountId } });
    await prisma.tradingDay.deleteMany({ where: { id: tradingDayId } });
    await prisma.staffMember.deleteMany({ where: { id: staffMemberId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('keeps expected cash, variance, and the complete report byte-identical through Journal CRUD', async () => {
    const before = await reporting.getReport(businessDate, businessDate);
    const expectedCashAndVariance = before.dailyReconciliation.map((day) => ({
      expectedCashCents: day.expectedCashCents,
      varianceCents: day.varianceCents,
    }));
    const reportBytes = JSON.stringify(before);
    const assertCashIsUnchanged = async () => {
      const after = await reporting.getReport(businessDate, businessDate);
      expect(after.dailyReconciliation.map((day) => ({
        expectedCashCents: day.expectedCashCents,
        varianceCents: day.varianceCents,
      }))).toEqual(expectedCashAndVariance);
      expect(JSON.stringify(after)).toBe(reportBytes);
    };

    const deposit = await journal.createDeposit(
      ledgerId,
      { businessDate, amountCents: 0, note: 'Recorded zero' } as never,
      userId,
    );
    await assertCashIsUnchanged();

    await journal.updateDeposit(
      deposit.id,
      { businessDate, amountCents: 12_500, note: 'Updated' } as never,
      userId,
    );
    await assertCashIsUnchanged();

    const withdrawal = await journal.createWithdrawal(
      ledgerId,
      { withdrawnOn: businessDate, amountCents: 99_999 } as never,
      userId,
    );
    await assertCashIsUnchanged();

    await journal.updateWithdrawal(
      withdrawal.id,
      { withdrawnOn: businessDate, amountCents: 100_000 } as never,
      userId,
    );
    await assertCashIsUnchanged();

    await journal.removeDeposit(deposit.id);
    await assertCashIsUnchanged();

    await journal.removeWithdrawal(withdrawal.id);
    await assertCashIsUnchanged();
  });
});
