import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the admin daily inventory report suite (story #324,
 * QA task #328).
 *
 * The report is read-only, so everything it renders has to be put in place
 * beforehand. Three rules shape what this file does and — more importantly —
 * what it refuses to do.
 *
 *  1. **Sales are never seeded here.** `SaleLine.packagingServingsSnapshot` is
 *     written by `OrdersService` when a line is added (ADR 0010 §3). A fixture
 *     inserting sale lines directly would supply the column default of 1 and
 *     the multi-serving assertions would pass against an implementation that
 *     never reads the snapshot at all. The spec places every order through the
 *     real `/orders` API; this file only seeds what an order needs to exist.
 *  2. **Counts, corrections and movements are seeded directly.** They have
 *     capture screens of their own, proven by #123/#108's suites, and this
 *     story asserts what a *read model* does with them — including shapes the
 *     capture UI cannot produce, such as a correction recorded with an earlier
 *     timestamp than the row it corrects.
 *  3. **Every row this run creates is tagged and deleted again.** The
 *     reconciliation table reads every reconciled QUANTITY item globally, and a
 *     leaked cup has previously broken unrelated layout specs, so each run
 *     drops its predecessors' `E2E-324-` rows before seeding.
 */

export interface SeededItem {
  id: string;
  name: string;
}

export interface SeededVariant {
  id: string;
  name: string;
  priceCents: number;
}

export interface SeededProduct {
  id: string;
  name: string;
  variants: Record<string, SeededVariant>;
}

export interface ReportCatalog {
  tag: string;
  items: Record<string, SeededItem>;
  products: Record<string, SeededProduct>;
}

export interface SeededDay {
  id: string;
  businessDate: string;
}

export interface StoredCount {
  id: string;
  phase: 'OPEN' | 'CLOSE';
  recordedAt: string;
  correctsStockCountId: string | null;
  lines: Array<{
    inventoryItemId: string;
    quantity: number | null;
    level: string | null;
  }>;
}

/**
 * Clear every trading day, sale and stock record.
 *
 * The report resolves its day by date with no per-run scope, and the orders API
 * writes against "the current open day", so a leftover row from another suite
 * decides what this one sees. Catalog, inventory and roster rows are left alone
 * — they are what the deleted rows point at.
 */
export function resetInventoryReportWorld(): void {
  runPrisma(`
    await prisma.dayClosingLine.deleteMany({});
    await prisma.dayClosing.deleteMany({});
    await prisma.cashCount.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.salePayment.deleteMany({});
    await prisma.saleLine.deleteMany({});
    await prisma.sale.deleteMany({});
    await prisma.stockCountLine.deleteMany({});
    // Corrections point at the row they correct, so the leaves go first.
    await prisma.stockCount.deleteMany({ where: { correctsStockCountId: { not: null } } });
    await prisma.stockCount.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.tradingDay.deleteMany({});
  `);
}

/** Drop the catalog and inventory rows earlier runs of this spec left behind. */
function clearPreviousReportFixtures(): void {
  runPrisma(`
    const products = await prisma.product.findMany({
      where: { sku: { startsWith: 'E2E-324-' } },
      select: { id: true, categoryId: true },
    });
    if (products.length > 0) {
      const productIds = products.map((product) => product.id);
      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      await prisma.saleLine.deleteMany({
        where: { productVariantId: { in: variants.map((variant) => variant.id) } },
      });
      await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      const categoryIds = [...new Set(products.map((product) => product.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.product.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.category.deleteMany({
            where: { id: categoryId, name: { startsWith: 'QA Report ' } },
          });
        }
      }
    }

    const items = await prisma.inventoryItem.findMany({
      where: { sku: { startsWith: 'E2E-324-' } },
      select: { id: true, categoryId: true },
    });
    if (items.length > 0) {
      const itemIds = items.map((item) => item.id);
      await prisma.stockCountLine.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await prisma.stockMovement.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await prisma.dayClosingLine.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await prisma.parLevel.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      const categoryIds = [...new Set(items.map((item) => item.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.inventoryItem.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.stockCategory.deleteMany({
            where: { id: categoryId, name: { startsWith: 'QA Report ' } },
          });
        }
      }
    }
  `);
}

interface ItemSpec {
  key: string;
  name: string;
  countMethod?: 'QUANTITY' | 'LEVEL';
  reconciled?: boolean;
  critical?: boolean;
  /** Par row, NORMAL day type unless stated. Omit for "no target configured". */
  par?: {
    dayType?: 'NORMAL' | 'PEAK';
    parQty?: number | null;
    lowThreshold?: number | null;
    urgentThreshold?: number | null;
  };
}

/** The eight stock levels, in the order the domain enumerates them. */
export const STOCK_LEVELS = [
  'EMPTY',
  'LOW',
  'QUARTER',
  'ONE_THIRD',
  'HALF',
  'TWO_THIRDS',
  'THREE_QUARTERS',
  'FULL',
] as const;

export type StockLevelName = (typeof STOCK_LEVELS)[number];

/** The thresholds every banded restock item in this suite shares. */
export const BANDS = { parQty: 40, lowThreshold: 20, urgentThreshold: 10 };

/**
 * The inventory items and products this suite reports on.
 *
 * The set is chosen so the criteria that could pass by accident cannot:
 *
 *  - `cup` is mapped to **both** sizes of one product, so a report that reads
 *    only one variant of a sale under-counts it visibly.
 *  - `lidRegular` / `lidLarge` are size-specific, so a report that ignores the
 *    variant mapping and draws "the product's" packaging is caught.
 *  - `promoCup` / `promoLid` hang off a 3-serving product (ADR 0010): a
 *    single-serving-only fixture passes an implementation that ignores
 *    `packagingServingsSnapshot`.
 *  - `historicCup` exists to be deactivated *after* its day, so a report about
 *    the past cannot drop it.
 *  - The banded items carry the four urgency bands. `urgentCritical` is named
 *    *last* alphabetically on purpose: Critical-before-non-Critical ordering is
 *    only provable when it disagrees with the alphabet. `unmanaged` has no par
 *    row and `peakOnly` has one for the wrong day type — both are the "no
 *    applicable target" shape, which for a quantity item necessarily carries no
 *    thresholds either and so must read Enough and stay off the list.
 *  - `level<LEVEL>` covers all eight counted levels in one count.
 *    `inventory_items_reconciled_count_method_check` forbids a reconciled
 *    LEVEL item outright, so these are unreconciled by necessity; the spec
 *    still asserts they stay out of the cup/lid table, because the read model
 *    filtering on count method is the behaviour under test.
 */
const ITEM_SPECS: ItemSpec[] = [
  { key: 'cup', name: 'QA Report Shared Cup' },
  { key: 'lidRegular', name: 'QA Report Regular Lid' },
  { key: 'lidLarge', name: 'QA Report Large Lid' },
  { key: 'promoCup', name: 'QA Report Promo Cup' },
  { key: 'promoLid', name: 'QA Report Promo Lid' },
  { key: 'historicCup', name: 'QA Report Retired Cup' },
  {
    key: 'urgentCritical',
    name: 'QA Report Zulu Urgent Beans',
    reconciled: false,
    critical: true,
    par: BANDS,
  },
  {
    key: 'urgentPlain',
    name: 'QA Report Alpha Urgent Syrup',
    reconciled: false,
    par: BANDS,
  },
  { key: 'lowEarly', name: 'QA Report Bravo Low Milk', reconciled: false, par: BANDS },
  { key: 'lowLate', name: 'QA Report Yankee Low Cocoa', reconciled: false, par: BANDS },
  { key: 'belowPar', name: 'QA Report Delta Below Par Sugar', reconciled: false, par: BANDS },
  { key: 'enough', name: 'QA Report Echo Enough Straws', reconciled: false, par: BANDS },
  // No par row at all for either day type. `par_levels_value_exclusivity_check`
  // makes a quantity row without a par quantity impossible, so "no target
  // configured" for a quantity item can only mean "no row", which carries no
  // thresholds either — the item is Enough and must not be listed.
  { key: 'unmanaged', name: 'QA Report Hotel Unmanaged Cloths', reconciled: false },
  // Configured for PEAK only, so on a NORMAL day it has no applicable target.
  {
    key: 'peakOnly',
    name: 'QA Report India Peak Only Cups',
    reconciled: false,
    par: { ...BANDS, dayType: 'PEAK' },
  },
  ...STOCK_LEVELS.map((level, index) => ({
    key: `level${level}`,
    name: `QA Report Level ${index + 1} ${level}`,
    countMethod: 'LEVEL' as const,
    reconciled: false,
  })),
];

export function seedReportCatalog(tag: string): ReportCatalog {
  clearPreviousReportFixtures();
  const output = runPrisma(`
    const tag = ${JSON.stringify(tag)};
    const itemSpecs = ${JSON.stringify(ITEM_SPECS)};

    const stockCategory = await prisma.stockCategory.create({
      data: { name: 'QA Report Packaging ' + tag, sortWeight: 993000 },
    });

    const items = {};
    for (const spec of itemSpecs) {
      const item = await prisma.inventoryItem.create({
        data: {
          sku: 'E2E-324-' + spec.key.toUpperCase() + '-' + tag,
          name: spec.name + ' ' + tag,
          categoryId: stockCategory.id,
          unit: 'pcs',
          size: null,
          countMethod: spec.countMethod ?? 'QUANTITY',
          critical: spec.critical ?? false,
          reconciled: spec.reconciled ?? true,
          active: true,
        },
      });
      if (spec.par) {
        await prisma.parLevel.create({
          data: {
            inventoryItemId: item.id,
            dayType: spec.par.dayType ?? 'NORMAL',
            parQty: spec.par.parQty ?? null,
            parLevel: null,
            lowThreshold: spec.par.lowThreshold ?? null,
            urgentThreshold: spec.par.urgentThreshold ?? null,
          },
        });
      }
      items[spec.key] = { id: item.id, name: item.name };
    }

    const category = await prisma.category.create({
      data: {
        name: 'QA Report Drinks ' + tag,
        sortWeight: 993000,
        active: true,
        freeUpsizeEligible: false,
      },
    });

    const productSpecs = [
      {
        key: 'house',
        name: 'QA Report House Blend ' + tag,
        packagingServings: 1,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 12000, cup: 'cup', lid: 'lidRegular' },
          { key: 'large', name: 'Large', priceCents: 15000, cup: 'cup', lid: 'lidLarge' },
        ],
      },
      {
        key: 'promo',
        name: 'QA Report Triple Promo ' + tag,
        packagingServings: 3,
        variants: [
          { key: 'regular', name: 'Regular', priceCents: 21000, cup: 'promoCup', lid: 'promoLid' },
        ],
      },
    ];

    const products = {};
    for (const spec of productSpecs) {
      const product = await prisma.product.create({
        data: {
          sku: 'E2E-324-' + spec.key.toUpperCase() + '-' + tag,
          name: spec.name,
          categoryId: category.id,
          packagingServings: spec.packagingServings,
          active: true,
          available: true,
        },
      });
      const variants = {};
      let sortWeight = 100;
      for (const variant of spec.variants) {
        const created = await prisma.productVariant.create({
          data: {
            productId: product.id,
            name: variant.name,
            priceCents: variant.priceCents,
            sortWeight,
            active: true,
            cupInventoryItemId: items[variant.cup].id,
            lidInventoryItemId: items[variant.lid].id,
          },
        });
        variants[variant.key] = {
          id: created.id,
          name: created.name,
          priceCents: created.priceCents,
        };
        sortWeight += 100;
      }
      products[spec.key] = { id: product.id, name: product.name, variants };
    }

    process.stdout.write(JSON.stringify({ tag, items, products }));
  `);
  return JSON.parse(output) as ReportCatalog;
}

/**
 * One roster member per run — a day has to be opened by somebody.
 *
 * Earlier runs' openers are dropped first. They are only unreferenced once the
 * trading days and counts pointing at them are gone, so this must follow a
 * `resetInventoryReportWorld()`; a member another table still holds is left
 * alone rather than failing the run.
 */
export function seedReportStaff(displayName: string): SeededItem {
  const output = runPrisma(`
    const stale = await prisma.staffMember.findMany({
      where: { displayName: { startsWith: 'QA Report Opener ' } },
      select: { id: true },
    });
    for (const member of stale) {
      try {
        await prisma.staffMember.delete({ where: { id: member.id } });
      } catch {
        // Still referenced by a table this suite does not own — leave it.
      }
    }
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)}, isActive: true },
    });
    process.stdout.write(JSON.stringify({ id: member.id, name: member.displayName }));
  `);
  return JSON.parse(output) as SeededItem;
}

/** Open a business day directly — here it is a precondition, not the subject. */
export function openReportDay(input: {
  businessDate: string;
  openedByStaffMemberId: string;
  dayType?: 'NORMAL' | 'PEAK';
}): SeededDay {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        dayType: input.dayType ?? 'NORMAL',
        openedAt: new Date(),
        openingFloatCents: 100000,
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

/**
 * Close a day so the next one can be opened.
 *
 * At most one day may be OPEN at a time, and the orders API writes against
 * whichever that is, so a suite that seeds several days has to retire each one.
 */
export function closeReportDay(dayId: string, closedByStaffMemberId: string): void {
  runPrisma(`
    await prisma.tradingDay.update({
      where: { id: ${JSON.stringify(dayId)} },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedByStaffMemberId: ${JSON.stringify(closedByStaffMemberId)},
      },
    });
  `);
}

export interface CountLine {
  inventoryItemId: string;
  quantity?: number | null;
  level?: string | null;
}

/**
 * Record an opening or closing stock count, optionally as a correction of an
 * earlier one and optionally at a chosen timestamp.
 *
 * `recordedAtOffsetMs` exists for the "the chain wins, not the clock" case: a
 * correction stamped *before* the row it corrects must still be the figure the
 * report uses.
 */
export function seedReportCount(input: {
  businessDate: string;
  phase: 'OPEN' | 'CLOSE';
  submittedBy: SeededItem;
  lines: CountLine[];
  correctsStockCountId?: string;
  recordedAtOffsetMs?: number;
}): string {
  return runPrisma(`
    const input = ${JSON.stringify(input)};
    const count = await prisma.stockCount.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        phase: input.phase,
        recordedAt: new Date(Date.now() + (input.recordedAtOffsetMs ?? 0)),
        submittedByStaffMemberId: input.submittedBy.id,
        submittedByNameSnapshot: input.submittedBy.name,
        correctsStockCountId: input.correctsStockCountId ?? null,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity ?? null,
            level: line.level ?? null,
          })),
        },
      },
    });
    process.stdout.write(count.id);
  `);
}

export interface MovementSpec {
  inventoryItemId: string;
  type: 'DELIVERY' | 'WASTAGE';
  quantity: number;
}

/**
 * Record deliveries and wastage against a business date.
 *
 * Batched deliberately: each `runPrisma` call spawns a node process, and the
 * arithmetic day alone needs ten movements.
 */
export function seedReportMovements(
  businessDate: string,
  movements: MovementSpec[],
): void {
  runPrisma(`
    const businessDate = new Date(${JSON.stringify(businessDate)} + 'T00:00:00.000Z');
    const movements = ${JSON.stringify(movements)};
    await prisma.stockMovement.createMany({
      data: movements.map((movement) => ({
        locationId: null,
        businessDate,
        inventoryItemId: movement.inventoryItemId,
        type: movement.type,
        quantity: movement.quantity,
        recordedAt: new Date(),
      })),
    });
  `);
}

/** Record a single delivery or wastage movement. */
export function seedReportMovement(input: {
  businessDate: string;
  inventoryItemId: string;
  type: 'DELIVERY' | 'WASTAGE';
  quantity: number;
}): void {
  const { businessDate, ...movement } = input;
  seedReportMovements(businessDate, [movement]);
}

/** Retire an inventory item — used to prove a past day keeps its rows. */
export function setItemActive(itemId: string, active: boolean): void {
  runPrisma(`
    await prisma.inventoryItem.update({
      where: { id: ${JSON.stringify(itemId)} },
      data: { active: ${JSON.stringify(active)} },
    });
  `);
}

/** Every stock count recorded for one business date, oldest first. */
export function readStockCounts(businessDate: string): StoredCount[] {
  const output = runPrisma(`
    const counts = await prisma.stockCount.findMany({
      where: { businessDate: new Date(${JSON.stringify(businessDate)} + 'T00:00:00.000Z') },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      include: { lines: { orderBy: { inventoryItemId: 'asc' } } },
    });
    process.stdout.write(JSON.stringify(counts.map((count) => ({
      id: count.id,
      phase: count.phase,
      recordedAt: count.recordedAt.toISOString(),
      correctsStockCountId: count.correctsStockCountId,
      lines: count.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        level: line.level,
      })),
    }))));
  `);
  return JSON.parse(output) as StoredCount[];
}

/**
 * A deterministic dump of everything the read-only criterion names: counts and
 * their lines, movements, sales and their lines, par levels, and the cup/lid
 * mappings on product variants.
 *
 * Compared as one string before and after the report is used, so "viewing the
 * report changed nothing" is a statement about stored data rather than about
 * which buttons happen to be on the screen.
 */
export function snapshotInventoryWorld(): string {
  return runPrisma(`
    const order = (rows) => JSON.stringify(rows);
    const counts = await prisma.stockCount.findMany({
      orderBy: { id: 'asc' },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    const movements = await prisma.stockMovement.findMany({ orderBy: { id: 'asc' } });
    const sales = await prisma.sale.findMany({
      orderBy: { id: 'asc' },
      include: { lines: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } },
    });
    const pars = await prisma.parLevel.findMany({ orderBy: { id: 'asc' } });
    const variants = await prisma.productVariant.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, cupInventoryItemId: true, lidInventoryItemId: true },
    });
    const items = await prisma.inventoryItem.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, active: true, reconciled: true, critical: true, countMethod: true },
    });
    process.stdout.write(order({ counts, movements, sales, pars, variants, items }));
  `);
}
