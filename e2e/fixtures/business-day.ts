import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the business-day open/close e2e suite (story #123, QA
 * task #132).
 *
 * Seeding is the hard part of this suite, for three reasons:
 *
 *  1. **This story *is* the open/close workflow.** Unlike #108, the tests here
 *     have to reach both "no day open" and "a day is open" deliberately, and a
 *     closed day cannot be reopened — so a suite-wide shared open day would make
 *     every spec order-dependent. `resetBusinessDayWorld()` therefore clears the
 *     whole trading-day world before each test and each test opens exactly the
 *     day it needs (through the UI where the UI is what is under test, through
 *     Prisma where it is only a precondition).
 *  2. **Nothing in the product writes the sale-side or drawer-movement rows.**
 *     Cash sales, online sales, tips, change owed, cash in/out and cash-affecting
 *     expenses all have MISSING FOUNDATION capture stories (ADR 0006 §7, story
 *     #123's scope notes). Without seeding them the "online sales are excluded"
 *     and "expected cash equals the ADR 0006 §2 formula" criteria would be
 *     vacuous, so they are seeded directly.
 *  3. **Packaging reconciliation reads every reconciled item globally.** The
 *     persistent dev database carries reconciled cup/lid items left behind by
 *     earlier runs, so packaging assertions are scoped to this run's own item
 *     names. The one criterion that genuinely needs an empty table — the
 *     packaging empty state — is served by `withNoReconciledItems()`, which
 *     un-reconciles every item for the duration of one test and restores the
 *     exact prior set afterwards.
 *
 * Everything this module creates carries a per-run tag so repeated runs against
 * the persistent dev database never collide.
 */

export interface SeededStaff {
  id: string;
  displayName: string;
}

export interface SeededPackagingItem {
  id: string;
  name: string;
}

export interface SeededVariant {
  id: string;
  productName: string;
  variantName: string;
}

export interface SeededOpenDay {
  id: string;
  businessDate: string;
}

export interface StoredDayClosing {
  id: string;
  tradingDayId: string;
  openingFloatCents: number;
  cashSalesCents: number;
  onlineSalesCents: number;
  cashTipsCents: number;
  cashInCents: number;
  cashOutCents: number;
  cashExpensesCents: number;
  outstandingChangeCents: number;
  expectedCashCents: number;
  actualCashCents: number;
  varianceCents: number;
  varianceReason: string | null;
  closedByNameSnapshot: string;
  lines: Array<{
    itemName: string;
    expectedQty: number | null;
    actualQty: number | null;
    varianceQty: number | null;
  }>;
}

export interface StoredTradingDay {
  id: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  dayType: 'NORMAL' | 'PEAK';
  openingFloatCents: number;
  closedByNameSnapshot: string | null;
}

/**
 * Clear every row the open/close workflow reads or writes.
 *
 * The closing summary and the open-day screen both read "the current open
 * business day" globally, with no per-run scope, so leftovers from an earlier
 * test — or an earlier suite — would decide what the next test sees. Deletion
 * order follows the foreign keys. Inventory items, catalog rows and the staff
 * roster are deliberately left alone: they are seeded once per run and are what
 * the deleted rows point at.
 */
export function resetBusinessDayWorld(): void {
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

/** Create staff roster members, keyed so the spec can name what each is for. */
export function seedStaffMembers(
  people: Record<string, { displayName: string; isActive: boolean }>,
): Record<string, SeededStaff> {
  const output = runPrisma(`
    const input = ${JSON.stringify(people)};
    const created = {};
    for (const [key, person] of Object.entries(input)) {
      const member = await prisma.staffMember.create({
        data: { displayName: person.displayName, isActive: person.isActive },
      });
      created[key] = { id: member.id, displayName: member.displayName };
    }
    process.stdout.write(JSON.stringify(created));
  `);
  return JSON.parse(output) as Record<string, SeededStaff>;
}

/**
 * Create the reconciled cup and lid items this suite reconciles, plus a drink
 * product whose variant maps to both — the mapping packaging reconciliation
 * deducts completed sales through.
 *
 * All three items are `reconciled: true`, `countMethod: QUANTITY` and active,
 * which is exactly the selection rule the read model applies.
 */
export function seedPackagingItems(
  tag: string,
  specs: Record<string, { name: string; unit: string }>,
): Record<string, SeededPackagingItem> {
  const output = runPrisma(`
    const input = ${JSON.stringify({ tag, specs })};
    const category = await prisma.stockCategory.create({
      data: { name: 'QA Day ' + input.tag, sortWeight: 990200 },
    });
    const created = {};
    for (const [key, spec] of Object.entries(input.specs)) {
      const item = await prisma.inventoryItem.create({
        data: {
          sku: 'E2E-123-' + key.toUpperCase() + '-' + input.tag,
          name: spec.name,
          categoryId: category.id,
          unit: spec.unit,
          size: null,
          countMethod: 'QUANTITY',
          critical: false,
          reconciled: true,
          active: true,
        },
      });
      created[key] = { id: item.id, name: item.name };
    }
    process.stdout.write(JSON.stringify(created));
  `);
  return JSON.parse(output) as Record<string, SeededPackagingItem>;
}

/** A drink variant mapped to one cup item and one lid item. */
export function seedDrinkVariant(
  tag: string,
  cupInventoryItemId: string,
  lidInventoryItemId: string,
): SeededVariant {
  const output = runPrisma(`
    const input = ${JSON.stringify({ tag, cupInventoryItemId, lidInventoryItemId })};
    const category = await prisma.category.create({
      data: { name: 'QA Day Drinks ' + input.tag, sortWeight: 990200 },
    });
    const product = await prisma.product.create({
      data: {
        sku: 'E2E-123-LATTE-' + input.tag,
        name: 'QA Latte ' + input.tag,
        categoryId: category.id,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: 'Regular',
        priceCents: 15000,
        sortWeight: 100,
        cupInventoryItemId: input.cupInventoryItemId,
        lidInventoryItemId: input.lidInventoryItemId,
      },
    });
    process.stdout.write(JSON.stringify({
      id: variant.id,
      productName: product.name,
      variantName: variant.name,
    }));
  `);
  return JSON.parse(output) as SeededVariant;
}

/**
 * Open a business day directly, for the tests whose subject is the *closing*
 * screen rather than the opening one.
 */
export function openBusinessDayDirect(input: {
  businessDate: string;
  dayType: 'NORMAL' | 'PEAK';
  openingFloatCents: number;
  openedByStaffMemberId: string;
}): SeededOpenDay {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        dayType: input.dayType,
        openedAt: new Date(),
        openingFloatCents: input.openingFloatCents,
        openedByStaffMemberId: input.openedByStaffMemberId,
      },
    });
    process.stdout.write(JSON.stringify({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as SeededOpenDay;
}

/** Record a stock count for one phase of a business date. */
export function seedStockCount(input: {
  businessDate: string;
  phase: 'OPEN' | 'CLOSE';
  submittedBy: SeededStaff;
  lines: Array<{ inventoryItemId: string; quantity: number }>;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    await prisma.stockCount.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        phase: input.phase,
        recordedAt: new Date(),
        submittedByStaffMemberId: input.submittedBy.id,
        submittedByNameSnapshot: input.submittedBy.displayName,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity,
            level: null,
          })),
        },
      },
    });
  `);
}

/** Record a delivery or wastage movement against a business date. */
export function seedStockMovement(input: {
  businessDate: string;
  inventoryItemId: string;
  type: 'DELIVERY' | 'WASTAGE';
  quantity: number;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    await prisma.stockMovement.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        inventoryItemId: input.inventoryItemId,
        type: input.type,
        quantity: input.quantity,
        recordedAt: new Date(),
      },
    });
  `);
}

export interface SeedSaleInput {
  tradingDayId: string;
  dayOrderNumber: number;
  status: 'PARKED' | 'COMPLETED';
  kind?: 'PURCHASE' | 'VOID';
  /** Sale this one voids, when `kind` is VOID. */
  correctsSaleId?: string | null;
  totalCents: number;
  cashTipCents?: number;
  /** Change still owed to the customer and therefore still in the drawer. */
  changeOwedCents?: number;
  changeSettled?: boolean;
  payments: Array<{ method: 'CASH' | 'ONLINE'; amountCents: number }>;
  lines?: Array<{ productVariantId: string; quantity: number }>;
}

/** Seed one sale with its tender split and drink lines. Returns its id. */
export function seedSale(input: SeedSaleInput): string {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const sale = await prisma.sale.create({
      data: {
        clientGeneratedId: require('node:crypto').randomUUID(),
        locationId: null,
        tradingDayId: input.tradingDayId,
        kind: input.kind || 'PURCHASE',
        correctsSaleId: input.correctsSaleId || null,
        dayOrderNumber: input.dayOrderNumber,
        status: input.status,
        customerName: null,
        serviceType: 'TAKE_OUT',
        subtotalCents: input.totalCents,
        discountCents: 0,
        taxCents: 0,
        totalCents: input.totalCents,
        cashTipCents: input.cashTipCents || 0,
        cashReceivedCents: null,
        changeOwedCents: input.changeOwedCents || 0,
        changeSettledAt: input.changeSettled ? new Date() : null,
        completedAt: input.status === 'COMPLETED' ? new Date() : null,
        recordedAt: new Date(),
        payments: {
          create: input.payments.map((payment) => ({
            method: payment.method,
            amountCents: payment.amountCents,
          })),
        },
        lines: {
          create: (input.lines || []).map((line) => ({
            productVariantId: line.productVariantId,
            quantity: line.quantity,
            unitPriceCents: 15000,
            lineGrossCents: 15000 * line.quantity,
            discountKind: 'NONE',
            discountCents: 0,
            lineTotalCents: 15000 * line.quantity,
            productNameSnapshot: 'QA Latte',
            variantNameSnapshot: 'Regular',
          })),
        },
      },
    });
    process.stdout.write(JSON.stringify(sale.id));
  `);
  return JSON.parse(output) as string;
}

/** Seed a drawer movement: cash in, cash out, or a cash-affecting expense. */
export function seedCashMovement(input: {
  tradingDayId: string;
  kind: 'CASH_IN' | 'CASH_OUT' | 'EXPENSE';
  amountCents: number;
  description: string;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    await prisma.cashMovement.create({
      data: {
        tradingDayId: input.tradingDayId,
        kind: input.kind,
        amountCents: input.amountCents,
        description: input.description,
        recordedAt: new Date(),
      },
    });
  `);
}

/** Every trading day in the database, oldest first. */
export function readTradingDays(): StoredTradingDay[] {
  const output = runPrisma(`
    const days = await prisma.tradingDay.findMany({
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      include: { closedByStaffMember: { select: { displayName: true } } },
    });
    process.stdout.write(JSON.stringify(days.map((day) => ({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
      status: day.status,
      dayType: day.dayType,
      openingFloatCents: day.openingFloatCents,
      closedByNameSnapshot: day.closedByStaffMember
        ? day.closedByStaffMember.displayName
        : null,
    }))));
  `);
  return JSON.parse(output) as StoredTradingDay[];
}

/** Every closing record in the database, oldest first, with its packaging lines. */
export function readDayClosings(): StoredDayClosing[] {
  const output = runPrisma(`
    const closings = await prisma.dayClosing.findMany({
      orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
      include: { lines: { include: { inventoryItem: { select: { name: true } } } } },
    });
    process.stdout.write(JSON.stringify(closings.map((closing) => ({
      id: closing.id,
      tradingDayId: closing.tradingDayId,
      openingFloatCents: closing.openingFloatCents,
      cashSalesCents: closing.cashSalesCents,
      onlineSalesCents: closing.onlineSalesCents,
      cashTipsCents: closing.cashTipsCents,
      cashInCents: closing.cashInCents,
      cashOutCents: closing.cashOutCents,
      cashExpensesCents: closing.cashExpensesCents,
      outstandingChangeCents: closing.outstandingChangeCents,
      expectedCashCents: closing.expectedCashCents,
      actualCashCents: closing.actualCashCents,
      varianceCents: closing.varianceCents,
      varianceReason: closing.varianceReason,
      closedByNameSnapshot: closing.closedByNameSnapshot,
      lines: closing.lines
        .map((line) => ({
          itemName: line.inventoryItem.name,
          expectedQty: line.expectedQty,
          actualQty: line.actualQty,
          varianceQty: line.varianceQty,
        }))
        .sort((left, right) => left.itemName.localeCompare(right.itemName)),
    }))));
  `);
  return JSON.parse(output) as StoredDayClosing[];
}

/** How many cash counts exist — the close transaction writes exactly one. */
export function countCashCounts(): number {
  return Number(
    runPrisma(`
      const total = await prisma.cashCount.count({});
      process.stdout.write(String(total));
    `),
  );
}

/**
 * Run `body` with no reconciled inventory items anywhere, then restore exactly
 * the set that was reconciled before.
 *
 * The packaging empty state is the one criterion that cannot be asserted while
 * this run's own items — or the reconciled leftovers other suites have accrued
 * in the persistent dev database — are visible.
 */
export async function withNoReconciledItems(
  body: () => Promise<void>,
): Promise<void> {
  const ids = JSON.parse(
    runPrisma(`
      const items = await prisma.inventoryItem.findMany({
        where: { reconciled: true },
        select: { id: true },
      });
      await prisma.inventoryItem.updateMany({
        where: { reconciled: true },
        data: { reconciled: false },
      });
      process.stdout.write(JSON.stringify(items.map((item) => item.id)));
    `),
  ) as string[];

  try {
    await body();
  } finally {
    runPrisma(`
      await prisma.inventoryItem.updateMany({
        where: { id: { in: ${JSON.stringify(ids)} } },
        data: { reconciled: true },
      });
    `);
  }
}
