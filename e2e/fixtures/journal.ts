import { runPrisma } from './reporting-seed';

/**
 * Seeding and raw-column reads for story #467 — the administrator Journal's
 * set-aside fund ledgers (QA task #483). ADR 0018 is binding throughout.
 *
 * Four things force direct table access here, beyond the two reasons
 * `compensation.ts` and `compensation-suggestions.ts` already document.
 *
 * 1. **`0` is not absent, and `null` is not `0`.** ADR 0018 §2/§6 make a saved
 *    ₱0 deposit, a ₱0 suggestion and "no suggestion at all" three distinct
 *    states. Recorded-ness *is* the existence of a `journal_deposits` row, so
 *    the only way to prove a ₱0 deposit was really written — rather than
 *    swallowed by a falsy check somewhere — is to read the row.
 * 2. **There is no ledger update endpoint and no rate delete endpoint**
 *    (ADR 0018 §4, §10). The built-in Rent and Chair ledgers carry a
 *    migration-seeded `start_date` derived from whatever trading days existed
 *    when the migration ran, and `journal_suggestion_rates` is append-only
 *    through the API. A suite that builds its own trading-day world therefore
 *    cannot put the ledgers into a known state through the product, which is
 *    what `resetJournal` is for. It is setup, never an assertion.
 * 3. **Inertness is asserted, not assumed** (ADR 0018 §7). "No
 *    `cash_movements` row was created" is a statement about a table the
 *    Journal must never touch, so it is counted directly.
 * 4. **A variance needs a cash count.** Criterion 16 is about `expectedCash`
 *    and `variance` surviving Journal writes untouched; the count that makes a
 *    variance non-null is not itself under test, so it is seeded rather than
 *    driven through the close flow.
 */

// ---- reset ------------------------------------------------------------------

export interface JournalBuiltInLedgers {
  rentId: string;
  chairId: string;
}

/**
 * Put the Journal into the state the migration describes, against a start date
 * this suite chooses: no deposits, no withdrawals, no administrator-added
 * ledgers, and exactly one rate row per built-in ledger carrying the story's
 * initial settings (Rent 10%, Chair ₱100 above ₱3,000) effective from
 * `startDate`.
 *
 * `startDate` must be on or before every business date the suite asserts
 * against, for two reasons that are both acceptance criteria: a deposit is
 * refused before the ledger start date (criterion 14), and the rate in force
 * for a business date is the greatest `effective_from <= business_date`
 * (criterion 12). A rate row left behind by an earlier run — which the API
 * cannot delete — would silently re-rate every past day.
 */
export function resetJournal(startDate: string): JournalBuiltInLedgers {
  const output = runPrisma(`
    const startDate = new Date(${JSON.stringify(startDate)} + 'T00:00:00.000Z');
    await prisma.journalDeposit.deleteMany({});
    await prisma.journalWithdrawal.deleteMany({});
    await prisma.journalSuggestionRate.deleteMany({});
    await prisma.journalLedger.deleteMany({ where: { isBuiltIn: false } });

    const wanted = [
      {
        name: 'Rent',
        suggestionKind: 'RENT_PERCENT_OF_ROUNDED_GROSS',
        rate: {
          rentPercentBasisPoints: 1000,
          chairAmountCents: null,
          chairThresholdCents: null,
        },
      },
      {
        name: 'Chair',
        suggestionKind: 'CHAIR_FLAT_ABOVE_THRESHOLD',
        rate: {
          rentPercentBasisPoints: null,
          chairAmountCents: 10000,
          chairThresholdCents: 300000,
        },
      },
    ];

    const out = {};
    for (const entry of wanted) {
      const existing = await prisma.journalLedger.findFirst({
        where: { name: entry.name },
        select: { id: true },
      });
      const ledger = existing
        ? await prisma.journalLedger.update({
            where: { id: existing.id },
            data: {
              startDate,
              startingBalanceCents: 0,
              suggestionKind: entry.suggestionKind,
              isBuiltIn: true,
            },
          })
        : await prisma.journalLedger.create({
            data: {
              name: entry.name,
              startDate,
              startingBalanceCents: 0,
              suggestionKind: entry.suggestionKind,
              isBuiltIn: true,
              locationId: null,
            },
          });
      await prisma.journalSuggestionRate.create({
        data: {
          ledgerId: ledger.id,
          effectiveFrom: startDate,
          ...entry.rate,
          locationId: null,
        },
      });
      out[entry.name] = ledger.id;
    }
    process.stdout.write(JSON.stringify({ rentId: out.Rent, chairId: out.Chair }));
  `);
  return JSON.parse(output) as JournalBuiltInLedgers;
}

/**
 * Drop the rate rows a test's own rate change appended, so the built-in
 * ledgers go back to the story's initial settings for every later test.
 *
 * `PUT /journal/ledgers/:id/rate` only ever appends or upserts today's row
 * (ADR 0018 §4 refuses backdating and offers no delete), so a rate-change test
 * cannot undo itself through the product.
 */
export function deleteRateRowsOnOrAfter(isoDate: string): void {
  runPrisma(`
    await prisma.journalSuggestionRate.deleteMany({
      where: {
        effectiveFrom: {
          gte: new Date(${JSON.stringify(isoDate)} + 'T00:00:00.000Z'),
        },
      },
    });
  `);
}

// ---- raw reads --------------------------------------------------------------

export interface StoredDeposit {
  id: string;
  businessDate: string;
  amountCents: number;
  note: string | null;
}

export interface StoredWithdrawal {
  id: string;
  withdrawnOn: string;
  amountCents: number;
  note: string | null;
}

/**
 * Every deposit row for one ledger, oldest business date first, exactly as
 * stored. `amountCents` comes back as the integer it is — `0` stays `0` — and
 * `note` stays `null` rather than becoming `''`.
 */
export function readStoredDeposits(ledgerId: string): StoredDeposit[] {
  const output = runPrisma(`
    const rows = await prisma.journalDeposit.findMany({
      where: { ledgerId: ${JSON.stringify(ledgerId)} },
      orderBy: { businessDate: 'asc' },
      select: { id: true, businessDate: true, amountCents: true, note: true },
    });
    process.stdout.write(JSON.stringify(rows.map((row) => ({
      id: row.id,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      amountCents: row.amountCents,
      note: row.note,
    }))));
  `);
  return JSON.parse(output) as StoredDeposit[];
}

export function readStoredWithdrawals(ledgerId: string): StoredWithdrawal[] {
  const output = runPrisma(`
    const rows = await prisma.journalWithdrawal.findMany({
      where: { ledgerId: ${JSON.stringify(ledgerId)} },
      orderBy: [{ withdrawnOn: 'asc' }, { recordedAt: 'asc' }],
      select: { id: true, withdrawnOn: true, amountCents: true, note: true },
    });
    process.stdout.write(JSON.stringify(rows.map((row) => ({
      id: row.id,
      withdrawnOn: row.withdrawnOn.toISOString().slice(0, 10),
      amountCents: row.amountCents,
      note: row.note,
    }))));
  `);
  return JSON.parse(output) as StoredWithdrawal[];
}

/** Deposit rows for one ledger, or across every ledger when none is named. */
export function countStoredDeposits(ledgerId?: string): number {
  return Number(
    runPrisma(`
      const where = ${JSON.stringify(ledgerId ?? null)};
      const total = await prisma.journalDeposit.count(
        where === null ? {} : { where: { ledgerId: where } },
      );
      process.stdout.write(String(total));
    `),
  );
}

export function countStoredWithdrawals(ledgerId?: string): number {
  return Number(
    runPrisma(`
      const where = ${JSON.stringify(ledgerId ?? null)};
      const total = await prisma.journalWithdrawal.count(
        where === null ? {} : { where: { ledgerId: where } },
      );
      process.stdout.write(String(total));
    `),
  );
}

export function countStoredLedgers(): number {
  return Number(
    runPrisma(`
      process.stdout.write(String(await prisma.journalLedger.count()));
    `),
  );
}

export interface StoredRate {
  effectiveFrom: string;
  rentPercentBasisPoints: number | null;
  chairAmountCents: number | null;
  chairThresholdCents: number | null;
}

/**
 * The append-only rate history for one ledger, oldest first. Used to prove a
 * change is a NEW row with today's `effective_from` rather than an edit of the
 * row already in force — the difference between "later business days only"
 * being true by construction and being true by luck (ADR 0018 §4).
 */
export function readStoredRates(ledgerId: string): StoredRate[] {
  const output = runPrisma(`
    const rows = await prisma.journalSuggestionRate.findMany({
      where: { ledgerId: ${JSON.stringify(ledgerId)} },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        effectiveFrom: true,
        rentPercentBasisPoints: true,
        chairAmountCents: true,
        chairThresholdCents: true,
      },
    });
    process.stdout.write(JSON.stringify(rows.map((row) => ({
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      rentPercentBasisPoints: row.rentPercentBasisPoints,
      chairAmountCents: row.chairAmountCents,
      chairThresholdCents: row.chairThresholdCents,
    }))));
  `);
  return JSON.parse(output) as StoredRate[];
}

/**
 * Every `cash_movements` row in the database. ADR 0018 §7 makes "a set-aside is
 * not a cash movement" a binding assertion rather than an assumption, and a
 * count is the only statement that catches a Journal write that decided to
 * create one.
 */
export function countCashMovements(): number {
  return Number(
    runPrisma(`
      process.stdout.write(String(await prisma.cashMovement.count()));
    `),
  );
}

/**
 * A counted-cash row on an existing trading day, so the day's `varianceCents`
 * is a real number instead of `null`. The close flow is not under test here;
 * what is under test is that the figure does not move when a Journal deposit or
 * withdrawal is written.
 */
export function seedCashCount(
  businessDate: string,
  countedCents: number,
  countedByStaffMemberId: string,
): void {
  runPrisma(`
    const input = ${JSON.stringify({ businessDate, countedCents, countedByStaffMemberId })};
    const day = await prisma.tradingDay.findFirst({
      where: {
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
      },
      select: { id: true },
    });
    if (!day) throw new Error('no trading day on ' + input.businessDate);
    await prisma.cashCount.create({
      data: {
        tradingDayId: day.id,
        countedCents: input.countedCents,
        countedAt: new Date(),
        countedByStaffMemberId: input.countedByStaffMemberId,
      },
    });
  `);
}
