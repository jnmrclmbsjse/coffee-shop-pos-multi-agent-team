import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the Take Order e2e suites (story #197, QA task #206).
 *
 * Three things shape this fixture:
 *
 *  1. **The catalog is global and shared with every other suite.** The order
 *     grid renders every active category, so "my products are the only ones on
 *     screen" is never true. Each run therefore seeds its own tagged categories
 *     and products, and the specs isolate them through the grid's search box or
 *     by asserting the *relative* order of this run's own rows. Nothing here
 *     deletes catalog rows another suite seeded.
 *  2. **Order numbers are per trading day and must be predictable.** "Adding the
 *     first item assigns the next order number for the day" and "parking an
 *     empty order consumes no number" are only assertable from a known starting
 *     point, so `resetOrderWorld()` clears the whole trading-day/sale world and
 *     each spec opens exactly the day it needs. That is the same contract
 *     `business-day.ts` already established; with `workers: 1` it is safe.
 *  3. **Money assertions have to be read from the database, not the screen.**
 *     The ₱96-vs-₱90 composition case, the half-up rounding case and "the order
 *     is recorded once" are all statements about stored integer cents. The specs
 *     assert the screen for the user-facing criteria and `readOrders()` for the
 *     arithmetic, so a UI that formats correctly over wrong data still fails.
 */

export interface SeededCatalogVariant {
  id: string;
  name: string;
  priceCents: number;
}

export interface SeededCatalogProduct {
  id: string;
  name: string;
  categoryName: string;
  variants: Record<string, SeededCatalogVariant>;
}

export interface SeededOrderCatalog {
  tag: string;
  eligibleCategoryId: string;
  eligibleCategoryName: string;
  ineligibleCategoryId: string;
  ineligibleCategoryName: string;
  products: Record<string, SeededCatalogProduct>;
}

export interface SeededOrderStaff {
  id: string;
  displayName: string;
}

export interface SeededOrderDay {
  id: string;
  businessDate: string;
}

export interface StoredOrderLine {
  quantity: number;
  unitPriceCents: number;
  lineGrossCents: number;
  discountKind: 'NONE' | 'PWD' | 'SENIOR';
  discountCents: number;
  preferences: string[];
  preferenceNote: string | null;
  freeUpsizeCount: number;
  freeUpsizeCents: number;
  freeUpsizeEligible: boolean;
  lineTotalCents: number;
  productNameSnapshot: string;
  variantNameSnapshot: string;
}

export interface StoredOrder {
  id: string;
  clientGeneratedId: string;
  kind: 'PURCHASE' | 'VOID';
  correctsSaleId: string | null;
  dayOrderNumber: number;
  status: 'PARKED' | 'COMPLETED';
  customerName: string | null;
  serviceType: 'DINE_IN' | 'TAKE_OUT';
  subtotalCents: number;
  discountCents: number;
  freeUpsizeCents: number;
  totalCents: number;
  cashTipCents: number;
  cashReceivedCents: number | null;
  changeOwedCents: number;
  changeSettled: boolean;
  voidReason: string | null;
  cashierNameSnapshot: string | null;
  payments: Array<{ method: 'CASH' | 'ONLINE'; amountCents: number }>;
  lines: StoredOrderLine[];
}

/**
 * Clear every trading day, sale, tender row and drawer movement.
 *
 * Cashier selections are deliberately left alone: they are keyed by a browser
 * device id, each Playwright context generates a fresh one, and deleting them
 * globally would disturb the active-cashier suite's own state.
 */
export function resetOrderWorld(): void {
  runPrisma(`
    await prisma.dayClosingLine.deleteMany({});
    await prisma.dayClosing.deleteMany({});
    await prisma.cashCount.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.salePayment.deleteMany({});
    await prisma.saleLine.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.tradingDay.deleteMany({});
  `);
}

/**
 * Drop the catalog rows earlier runs of this spec left behind.
 *
 * Every run tags its own categories and products, and nothing used to remove
 * them, so the shared catalog grew by two categories and six products per file
 * per run — several hundred rows within a few dozen runs. That is not just
 * untidy: the Take Order grid renders the whole catalog, so a bloated catalog
 * makes the screen slower and the layout assertions read a page nothing like
 * the one a real shop sees.
 *
 * Only `E2E-197-` rows are touched. Their sale lines go first because
 * `SaleLine.productVariant` is `onDelete: Restrict`; `resetOrderWorld()` clears
 * every sale moments later in `beforeEach`, so nothing survives that deletion
 * which would not have been cleared anyway.
 */
function clearPreviousOrderCatalogs(): void {
  runPrisma(`
    const stale = await prisma.product.findMany({
      where: { sku: { startsWith: 'E2E-197-' } },
      select: { id: true, categoryId: true },
    });
    if (stale.length > 0) {
      const productIds = stale.map((product) => product.id);
      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      await prisma.saleLine.deleteMany({
        where: { productVariantId: { in: variants.map((v) => v.id) } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      // Categories are shared by name, not sku, so only drop the ones this
      // spec created and that no other product still sits in.
      const categoryIds = [...new Set(stale.map((product) => product.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.product.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.category.deleteMany({
            where: {
              id: categoryId,
              OR: [
                { name: { startsWith: 'QA Coffee ' } },
                { name: { startsWith: 'QA Bakery ' } },
              ],
            },
          });
        }
      }
    }
  `);
}

/**
 * Seed one free-upsize-eligible category and one ineligible category, each with
 * the products the money criteria need.
 *
 * Prices are chosen for the assertions, not for realism:
 *  - `espresso` Regular is ₱150.00 — the ADR 0008 worked example (one free
 *    upsize + Senior must land on ₱96.00, never ₱90.00).
 *  - `roundUp` is ₱100.03 and `roundDown` ₱100.01. Twenty percent of an integer
 *    cent amount can never land exactly on a half cent (the fractional part is
 *    always a fifth), so these pin the two sides of the half-up rule instead:
 *    ₱100.03 → 2000.6 → 2001, ₱100.01 → 2000.2 → 2000.
 *  - `tiny` is ₱25.00, below the ₱30.00 free-upsize value, so a one-unit upsize
 *    on it must be refused rather than clamped.
 *  - `croissant` sits in the ineligible category.
 *
 * Sort weights are spaced so the two categories and their products keep a
 * deterministic relative order among whatever else the shared catalog holds.
 */
export function seedOrderCatalog(tag: string): SeededOrderCatalog {
  clearPreviousOrderCatalogs();
  const output = runPrisma(`
    const tag = ${JSON.stringify(tag)};
    const eligible = await prisma.category.create({
      data: {
        name: 'QA Coffee ' + tag,
        sortWeight: 991000,
        active: true,
        freeUpsizeEligible: true,
      },
    });
    const ineligible = await prisma.category.create({
      data: {
        name: 'QA Bakery ' + tag,
        sortWeight: 991100,
        active: true,
        freeUpsizeEligible: false,
      },
    });

    const specs = [
      {
        key: 'espresso',
        name: 'QA Espresso ' + tag,
        categoryId: eligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 15000, sortWeight: 100 },
          { key: 'large', name: 'Large', priceCents: 18000, sortWeight: 200 },
        ],
      },
      {
        key: 'latte',
        name: 'QA Latte ' + tag,
        categoryId: eligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 12000, sortWeight: 100 },
        ],
      },
      {
        key: 'roundUp',
        name: 'QA Round Up ' + tag,
        categoryId: eligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 10003, sortWeight: 100 },
        ],
      },
      {
        key: 'roundDown',
        name: 'QA Round Down ' + tag,
        categoryId: eligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 10001, sortWeight: 100 },
        ],
      },
      {
        key: 'tiny',
        name: 'QA Tiny ' + tag,
        categoryId: eligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 2500, sortWeight: 100 },
        ],
      },
      {
        key: 'croissant',
        name: 'QA Croissant ' + tag,
        categoryId: ineligible.id,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 9000, sortWeight: 100 },
        ],
      },
    ];

    const products = {};
    for (const spec of specs) {
      const product = await prisma.product.create({
        data: {
          sku: 'E2E-197-' + spec.key.toUpperCase() + '-' + tag,
          name: spec.name,
          categoryId: spec.categoryId,
          active: true,
          available: true,
        },
      });
      const variants = {};
      for (const variant of spec.variants) {
        const created = await prisma.productVariant.create({
          data: {
            productId: product.id,
            name: variant.name,
            priceCents: variant.priceCents,
            sortWeight: variant.sortWeight,
            active: true,
          },
        });
        variants[variant.key] = {
          id: created.id,
          name: created.name,
          priceCents: created.priceCents,
        };
      }
      products[spec.key] = {
        id: product.id,
        name: product.name,
        categoryName:
          spec.categoryId === eligible.id ? eligible.name : ineligible.name,
        variants,
      };
    }

    process.stdout.write(JSON.stringify({
      tag,
      eligibleCategoryId: eligible.id,
      eligibleCategoryName: eligible.name,
      ineligibleCategoryId: ineligible.id,
      ineligibleCategoryName: ineligible.name,
      products,
    }));
  `);
  return JSON.parse(output) as SeededOrderCatalog;
}

/** Create one roster member for the run, used to open the business day. */
export function seedOrderStaff(displayName: string): SeededOrderStaff {
  const output = runPrisma(`
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)}, isActive: true },
    });
    process.stdout.write(JSON.stringify({
      id: member.id,
      displayName: member.displayName,
    }));
  `);
  return JSON.parse(output) as SeededOrderStaff;
}

/** Open a business day directly — it is a precondition here, not the subject. */
export function openOrderDay(input: {
  businessDate: string;
  openedByStaffMemberId: string;
  openingFloatCents?: number;
}): SeededOrderDay {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        dayType: 'NORMAL',
        openedAt: new Date(),
        openingFloatCents: input.openingFloatCents ?? 100000,
        openedByStaffMemberId: input.openedByStaffMemberId,
      },
    });
    process.stdout.write(JSON.stringify({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as SeededOrderDay;
}

/** Close a business day without going through the closing screen. */
export function closeOrderDay(tradingDayId: string): void {
  runPrisma(`
    await prisma.tradingDay.update({
      where: { id: ${JSON.stringify(tradingDayId)} },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  `);
}

/**
 * Every sale in the database, oldest order number first, with its lines and
 * tender rows.
 *
 * The specs assert money and "recorded once" against this rather than against
 * the screen: a correct-looking total rendered over a wrong stored amount is
 * exactly the failure the ₱96/₱90 criterion is guarding.
 */
export function readOrders(): StoredOrder[] {
  const output = runPrisma(`
    const sales = await prisma.sale.findMany({
      orderBy: [{ dayOrderNumber: 'asc' }],
      include: {
        lines: { orderBy: [{ id: 'asc' }] },
        payments: { orderBy: [{ method: 'asc' }] },
      },
    });
    process.stdout.write(JSON.stringify(sales.map((sale) => ({
      id: sale.id,
      clientGeneratedId: sale.clientGeneratedId,
      kind: sale.kind,
      correctsSaleId: sale.correctsSaleId,
      dayOrderNumber: sale.dayOrderNumber,
      status: sale.status,
      customerName: sale.customerName,
      serviceType: sale.serviceType,
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      freeUpsizeCents: sale.freeUpsizeCents,
      totalCents: sale.totalCents,
      cashTipCents: sale.cashTipCents,
      cashReceivedCents: sale.cashReceivedCents,
      changeOwedCents: sale.changeOwedCents,
      changeSettled: sale.changeSettledAt !== null,
      voidReason: sale.voidReason,
      cashierNameSnapshot: sale.cashierNameSnapshot,
      payments: sale.payments.map((payment) => ({
        method: payment.method,
        amountCents: payment.amountCents,
      })),
      lines: sale.lines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        lineGrossCents: line.lineGrossCents,
        discountKind: line.discountKind,
        discountCents: line.discountCents,
        preferences: line.preferences,
        preferenceNote: line.preferenceNote,
        freeUpsizeCount: line.freeUpsizeCount,
        freeUpsizeCents: line.freeUpsizeCents,
        freeUpsizeEligible: line.freeUpsizeEligible,
        lineTotalCents: line.lineTotalCents,
        productNameSnapshot: line.productNameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
      })),
    }))));
  `);
  return JSON.parse(output) as StoredOrder[];
}

/** Read one product's availability flag straight from the catalog table. */
export function readProductAvailability(productId: string): boolean {
  return (
    runPrisma(`
      const product = await prisma.product.findUnique({
        where: { id: ${JSON.stringify(productId)} },
        select: { available: true },
      });
      process.stdout.write(String(product.available));
    `) === 'true'
  );
}

/** Rename a product and reprice one of its sizes — the snapshot criterion. */
export function editCatalogAfterSale(input: {
  productId: string;
  newName: string;
  variantId: string;
  newPriceCents: number;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    await prisma.product.update({
      where: { id: input.productId },
      data: { name: input.newName },
    });
    await prisma.productVariant.update({
      where: { id: input.variantId },
      data: { priceCents: input.newPriceCents },
    });
  `);
}

/** Flip a category's free-upsize flag after an order recorded against it. */
export function setCategoryFreeUpsizeEligible(
  categoryId: string,
  eligible: boolean,
): void {
  runPrisma(`
    await prisma.category.update({
      where: { id: ${JSON.stringify(categoryId)} },
      data: { freeUpsizeEligible: ${eligible ? 'true' : 'false'} },
    });
  `);
}

/** Mark a product sold out or available without using the order grid. */
export function setProductAvailability(
  productId: string,
  available: boolean,
): void {
  runPrisma(`
    await prisma.product.update({
      where: { id: ${JSON.stringify(productId)} },
      data: { available: ${available ? 'true' : 'false'} },
    });
  `);
}

/**
 * Record an active cashier for a device *after* an order was started.
 *
 * The attribution criterion is that a later selection never rewrites a fixed
 * attribution, so the selection has to happen out of band — the point is that
 * the already-recorded sale does not move. `selectedByUserId` is resolved to
 * whichever user account exists for `username`.
 */
export function seedCashierSelection(input: {
  deviceId: string;
  staffMemberId: string | null;
  username: string;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    const user = await prisma.user.findFirst({
      where: { username: input.username },
      select: { id: true },
    });
    if (!user) throw new Error('No user named ' + input.username);
    await prisma.cashierSelection.create({
      data: {
        deviceId: input.deviceId,
        locationId: null,
        staffMemberId: input.staffMemberId,
        selectedByUserId: user.id,
      },
    });
  `);
}

/**
 * Seed a completed order whose tender does not equal its total.
 *
 * ADR 0005 §5 records that at least one such historical order exists and that
 * today's stricter rule is not applied retroactively, so the order views must
 * still render it rather than erroring.
 */
export function seedHistoricalUnderTenderedOrder(input: {
  tradingDayId: string;
  dayOrderNumber: number;
  productVariantId: string;
  customerName: string;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    await prisma.sale.create({
      data: {
        clientGeneratedId: require('node:crypto').randomUUID(),
        locationId: null,
        tradingDayId: input.tradingDayId,
        kind: 'PURCHASE',
        dayOrderNumber: input.dayOrderNumber,
        status: 'COMPLETED',
        customerName: input.customerName,
        serviceType: 'TAKE_OUT',
        subtotalCents: 15000,
        discountCents: 0,
        freeUpsizeCents: 0,
        taxCents: 0,
        totalCents: 15000,
        cashTipCents: 0,
        cashReceivedCents: 10000,
        changeOwedCents: 0,
        completedAt: new Date(),
        payments: { create: [{ method: 'CASH', amountCents: 10000 }] },
        lines: {
          create: [{
            productVariantId: input.productVariantId,
            quantity: 1,
            unitPriceCents: 15000,
            lineGrossCents: 15000,
            discountKind: 'NONE',
            discountCents: 0,
            preferences: [],
            preferenceNote: null,
            freeUpsizeCount: 0,
            freeUpsizeCents: 0,
            freeUpsizeEligible: true,
            lineTotalCents: 15000,
            productNameSnapshot: 'Historical Latte',
            variantNameSnapshot: 'Regular',
          }],
        },
      },
    });
  `);
}
