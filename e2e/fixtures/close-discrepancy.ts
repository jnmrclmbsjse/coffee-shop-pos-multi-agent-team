import { runPrisma } from './reporting-seed';

/**
 * Seeding support for story #410 — "Confirm cup / lid and cash discrepancies
 * before closing the day" (QA task #431).
 *
 * The subject is a client-side gate in front of the existing close, so what the
 * fixture has to control is not arithmetic but *which discrepancies exist at
 * all*. Two properties of the screen make that harder than it looks and shape
 * everything here:
 *
 *  1. **Packaging reconciliation reads every reconciled QUANTITY item in the
 *     database**, with no per-run scope (`PackagingReconciliationService`
 *     selects on `reconciled: true, countMethod: QUANTITY`). An item nobody
 *     counted has `varianceQty === null`, which this story defines as a
 *     discrepancy — so the cup/lid rows earlier suites left behind would make
 *     "no discrepancy at all" (AC 12) unreachable and would pollute the "only
 *     discrepancies are listed" assertion (AC 6). `seedBalancedCounts` therefore
 *     counts **every** reconciled item in the database, equal at open and close,
 *     and each test perturbs only the items it names. Nothing is un-reconciled
 *     or deactivated: the shared catalog is left exactly as it was found.
 *  2. **Expected cash is the opening float** when a day has no sales, cash
 *     movements or expenses (ADR 0006 §2 with every other term zero). Days are
 *     opened with a fixed float so the spec can name an exact balanced,
 *     over and short amount; the spec still asserts the rendered Expected cash
 *     figure before relying on it, so a formula change surfaces as a clear
 *     failure rather than as a mystery dialog.
 *
 * Closing a day is not undoable and there is at most one open day, so every
 * scenario resets the trading-day world and opens its own day. Days are seeded
 * directly — opening a day is a precondition here, not the subject — but
 * **closing always goes through the real screen**, because AC 8 and AC 10 are
 * claims about what a close *records*, and a hand-seeded `DayClosing` would
 * supply column defaults that hide exactly that.
 */

/** Opening float every day in this suite starts from: expected cash = ₱1,000.00. */
export const OPENING_FLOAT_CENTS = 100_000;

/** Quantity every reconciled item is counted at, unless a test says otherwise. */
export const BALANCED_QTY = 50;

export interface SeededRow {
  id: string;
  name: string;
}

export interface SeededDay {
  id: string;
  businessDate: string;
}

export interface StoredClosing {
  tradingDayId: string;
  businessDate: string;
  actualCashCents: number;
  varianceCents: number;
  varianceReason: string | null;
  closedByNameSnapshot: string;
}

/**
 * Clear every trading day, sale, cash and stock record.
 *
 * The close screen reads "the current open business day" globally, so a day
 * left behind by another suite — or by the previous test — would decide what
 * this one sees. Catalog, inventory and roster rows are deliberately kept: they
 * are what the deleted rows point at, and other suites depend on them.
 */
export function resetCloseWorld(): void {
  runPrisma(`
    await prisma.dayClosingLine.deleteMany({});
    await prisma.dayClosing.deleteMany({});
    await prisma.cashCount.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.salePayment.deleteMany({});
    await prisma.saleLine.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.stockCountLine.deleteMany({});
    await prisma.stockCount.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.tradingDay.deleteMany({});
  `);
}

/**
 * Drop the inventory rows earlier runs of this spec left behind.
 *
 * Only `E2E-410-` rows are touched. A leaked reconciled item would keep
 * appearing on every future close screen — and, being uncounted, would be a
 * standing discrepancy for every other suite that closes a day.
 */
export function clearCloseFixtures(): void {
  runPrisma(`
    const items = await prisma.inventoryItem.findMany({
      where: { sku: { startsWith: 'E2E-410-' } },
      select: { id: true, categoryId: true },
    });
    if (items.length === 0) return;
    const itemIds = items.map((item) => item.id);
    await prisma.stockCountLine.deleteMany({
      where: { inventoryItemId: { in: itemIds } },
    });
    await prisma.stockMovement.deleteMany({
      where: { inventoryItemId: { in: itemIds } },
    });
    await prisma.dayClosingLine.deleteMany({
      where: { inventoryItemId: { in: itemIds } },
    });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    const categoryIds = [...new Set(items.map((item) => item.categoryId))];
    for (const categoryId of categoryIds) {
      const remaining = await prisma.inventoryItem.count({ where: { categoryId } });
      if (remaining === 0) {
        await prisma.stockCategory.deleteMany({
          where: { id: categoryId, name: { startsWith: 'QA Close ' } },
        });
      }
    }
  `);
}

/**
 * Seed this run's reconciled cup / lid items.
 *
 * `countMethod: 'QUANTITY'` is required — both by the schema and by the
 * reconciliation query, which skips LEVEL items entirely — and omitting it is
 * the known cause of a red `catalog-management.spec`.
 *
 * Six items is not padding. One pair carries the ordinary over / short case, a
 * second item is the *balanced* control whose absence from the dialog is the
 * AC 6 assertion, and the remaining three make the "many entries" scenario
 * long enough for the dialog's list to scroll past its own action buttons.
 */
export function seedCloseItems(tag: string, keys: string[]): Record<string, SeededRow> {
  clearCloseFixtures();
  const output = runPrisma(`
    const tag = ${JSON.stringify(tag)};
    const keys = ${JSON.stringify(keys)};
    const category = await prisma.stockCategory.create({
      data: { name: 'QA Close Packaging ' + tag, sortWeight: 993000 },
    });
    const items = {};
    for (const key of keys) {
      const item = await prisma.inventoryItem.create({
        data: {
          sku: 'E2E-410-' + key.toUpperCase() + '-' + tag,
          name: 'QA Close ' + key + ' ' + tag,
          categoryId: category.id,
          unit: 'pcs',
          size: null,
          countMethod: 'QUANTITY',
          critical: false,
          reconciled: true,
          active: true,
        },
      });
      items[key] = { id: item.id, name: item.name };
    }
    process.stdout.write(JSON.stringify(items));
  `);
  return JSON.parse(output) as Record<string, SeededRow>;
}

/** One roster member per run — a day has to be opened and closed by somebody. */
export function seedCloseStaff(displayName: string): SeededRow {
  const output = runPrisma(`
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)}, isActive: true },
    });
    process.stdout.write(JSON.stringify({
      id: member.id,
      name: member.displayName,
    }));
  `);
  return JSON.parse(output) as SeededRow;
}

/** Open the day directly — here it is a precondition, not the subject. */
export function openCloseDay(input: {
  businessDate: string;
  openedByStaffMemberId: string;
}): SeededDay {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        dayType: 'NORMAL',
        openedAt: new Date(),
        openingFloatCents: ${OPENING_FLOAT_CENTS},
        openedByStaffMemberId: input.openedByStaffMemberId,
      },
    });
    process.stdout.write(JSON.stringify({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as SeededDay;
}

export interface CountShape {
  /**
   * Items to leave OUT of the opening count, so their expected quantity is
   * unknown (`expectedQty === null`).
   */
  omitFromOpening?: string[];
  /**
   * Items to leave OUT of the closing count while a closing count still
   * exists. The screen renders these as "— not in count", which the story
   * distinguishes from "no closing count at all".
   */
  omitFromClosing?: string[];
  /** Items whose closing quantity differs from `BALANCED_QTY`, by item id. */
  closingOverrides?: Record<string, number>;
  /**
   * Skip the closing count entirely. Every item's actual quantity is then
   * unknown and the screen renders "— no closing count" instead of
   * "— not in count" — the story's "no closing count submitted" case.
   */
  noClosingCount?: boolean;
}

/**
 * Count EVERY reconciled QUANTITY item in the database at `BALANCED_QTY`, at
 * both open and close, then apply the scenario's perturbations.
 *
 * This is what makes "no discrepancy at all" and "the balanced item is absent
 * from the dialog" assertable in a shared database. With no sales and no stock
 * movements, expected = opening and actual = closing, so equal counts give
 * `varianceQty === 0` for every item the test did not single out.
 */
export function seedBalancedCounts(
  input: {
    businessDate: string;
    submittedBy: SeededRow;
  } & CountShape,
): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    const balanced = ${BALANCED_QTY};
    const items = await prisma.inventoryItem.findMany({
      where: { reconciled: true, countMethod: 'QUANTITY' },
      select: { id: true },
    });
    const ids = items.map((item) => item.id);
    const businessDate = new Date(input.businessDate + 'T00:00:00.000Z');
    const omitOpening = new Set(input.omitFromOpening ?? []);
    const omitClosing = new Set(input.omitFromClosing ?? []);
    const overrides = input.closingOverrides ?? {};

    const create = async (phase, lines) => {
      await prisma.stockCount.create({
        data: {
          locationId: null,
          businessDate,
          phase,
          recordedAt: new Date(),
          submittedByStaffMemberId: input.submittedBy.id,
          submittedByNameSnapshot: input.submittedBy.name,
          lines: { create: lines },
        },
      });
    };

    await create(
      'OPEN',
      ids
        .filter((id) => !omitOpening.has(id))
        .map((id) => ({ inventoryItemId: id, quantity: balanced, level: null })),
    );

    if (!input.noClosingCount) {
      await create(
        'CLOSE',
        ids
          .filter((id) => !omitClosing.has(id))
          .map((id) => ({
            inventoryItemId: id,
            quantity: Object.prototype.hasOwnProperty.call(overrides, id)
              ? overrides[id]
              : balanced,
            level: null,
          })),
      );
    }
  `);
}

/**
 * Every stored day-closing record.
 *
 * The idempotency criterion ("retrying must not create duplicate day-close
 * records") is a statement about stored rows, not about the success banner, so
 * it is asserted here. `varianceReason` is read back the same way for AC 10 —
 * what the close recorded, not what the form still shows.
 */
export function readDayClosings(): StoredClosing[] {
  const output = runPrisma(`
    const closings = await prisma.dayClosing.findMany({
      orderBy: [{ closedAt: 'asc' }],
      include: { tradingDay: { select: { businessDate: true } } },
    });
    process.stdout.write(JSON.stringify(closings.map((closing) => ({
      tradingDayId: closing.tradingDayId,
      businessDate: closing.tradingDay.businessDate.toISOString().slice(0, 10),
      actualCashCents: closing.actualCashCents,
      varianceCents: closing.varianceCents,
      varianceReason: closing.varianceReason,
      closedByNameSnapshot: closing.closedByNameSnapshot,
    }))));
  `);
  return JSON.parse(output) as StoredClosing[];
}

/** The status of every trading day, newest business date first. */
export function readTradingDayStatuses(): Array<{
  businessDate: string;
  status: string;
}> {
  const output = runPrisma(`
    const days = await prisma.tradingDay.findMany({
      orderBy: [{ businessDate: 'desc' }],
      select: { businessDate: true, status: true },
    });
    process.stdout.write(JSON.stringify(days.map((day) => ({
      businessDate: day.businessDate.toISOString().slice(0, 10),
      status: day.status,
    }))));
  `);
  return JSON.parse(output) as Array<{ businessDate: string; status: string }>;
}
