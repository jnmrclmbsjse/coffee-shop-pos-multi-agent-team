import { runPrisma, shopToday } from './reporting-seed';

/**
 * Seeding support for the POS workspace hidden-menu geometry suite
 * (story #349, QA task #362).
 *
 * The story is about layout, not about data, so everything here exists only to
 * put *known* content on the five in-scope screens:
 *
 *  - Take Order and Order History need an open business day, a catalog and
 *    orders, or they render a state screen instead of the workspace under test.
 *  - The scroll-reachability criterion (AC7) needs content that genuinely
 *    overflows the viewport, which the ambient dev database cannot be relied on
 *    to supply. Every "tall" seed below is therefore sized deliberately.
 *  - Take Order's height must not be a function of how much the shared catalog
 *    has accumulated. `clearPreviousWorkspaceFixtures()` runs before every seed
 *    so this suite adds a fixed catalog rather than a growing one — earlier QA
 *    suites leaked hundreds of products and made the page unrecognisable.
 *
 * Nothing here asserts anything. Money amounts are arbitrary integer cents.
 */

const SKU_PREFIX = 'E2E-349-';
const ITEM_SKU_PREFIX = 'E2E-349-ITEM-';
const CATEGORY_PREFIX = 'QA 349 ';

export interface SeededWorkspaceStaff {
  id: string;
  displayName: string;
}

export interface SeededWorkspaceDay {
  id: string;
  businessDate: string;
}

export interface SeededWorkspaceCatalog {
  categoryName: string;
  /** Every seeded variant id, in catalog order. */
  variantIds: string[];
  /** The first product's name, for a locator that does not depend on order. */
  firstProductName: string;
  lastProductName: string;
}

export interface SeededWorkspaceStockItems {
  categoryName: string;
  itemNames: string[];
}

/** Today's shop date — re-exported so the spec needs one import less. */
export { shopToday };

/**
 * Clear the trading-day/sales/counts world, exactly as the other staff suites
 * do. Safe with `workers: 1`; nothing outside these suites writes these tables.
 */
export function resetWorkspaceWorld(): void {
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
 * Remove the catalog and inventory rows earlier runs of this suite created.
 *
 * Take Order renders the whole active catalog, so a suite that seeds products
 * and never removes them changes the very geometry it later measures. Only
 * `E2E-349-` rows are touched.
 */
export function clearPreviousWorkspaceFixtures(): void {
  runPrisma(`
    const stale = await prisma.product.findMany({
      where: { sku: { startsWith: ${JSON.stringify(SKU_PREFIX)} } },
      select: { id: true, categoryId: true },
    });
    if (stale.length > 0) {
      const productIds = stale.map((product) => product.id);
      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const variantIds = variants.map((variant) => variant.id);
      await prisma.saleLine.deleteMany({
        where: { productVariantId: { in: variantIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      const categoryIds = [...new Set(stale.map((product) => product.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.product.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.category.deleteMany({
            where: {
              id: categoryId,
              name: { startsWith: ${JSON.stringify(CATEGORY_PREFIX)} },
            },
          });
        }
      }
    }

    const staleItems = await prisma.inventoryItem.findMany({
      where: { sku: { startsWith: ${JSON.stringify(ITEM_SKU_PREFIX)} } },
      select: { id: true, categoryId: true },
    });
    if (staleItems.length > 0) {
      const itemIds = staleItems.map((item) => item.id);
      await prisma.stockCountLine.deleteMany({
        where: { inventoryItemId: { in: itemIds } },
      });
      await prisma.stockMovement.deleteMany({
        where: { inventoryItemId: { in: itemIds } },
      });
      await prisma.parLevel.deleteMany({
        where: { inventoryItemId: { in: itemIds } },
      });
      await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      const categoryIds = [...new Set(staleItems.map((item) => item.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.inventoryItem.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.stockCategory.deleteMany({
            where: {
              id: categoryId,
              name: { startsWith: ${JSON.stringify(CATEGORY_PREFIX)} },
            },
          });
        }
      }
    }
  `);
}

/** One roster member, used to open the day and to answer "Submitted by". */
export function seedWorkspaceStaff(displayName: string): SeededWorkspaceStaff {
  const output = runPrisma(`
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)}, isActive: true },
    });
    process.stdout.write(JSON.stringify({
      id: member.id,
      displayName: member.displayName,
    }));
  `);
  return JSON.parse(output) as SeededWorkspaceStaff;
}

/** Open a business day directly — a precondition here, never the subject. */
export function openWorkspaceDay(input: {
  businessDate: string;
  openedByStaffMemberId: string;
}): SeededWorkspaceDay {
  const output = runPrisma(`
    const input = ${JSON.stringify(input)};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        dayType: 'NORMAL',
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
  return JSON.parse(output) as SeededWorkspaceDay;
}

/** Close a day without going through the closing screen (AC9's blocked state). */
export function closeWorkspaceDay(tradingDayId: string): void {
  runPrisma(`
    await prisma.tradingDay.update({
      where: { id: ${JSON.stringify(tradingDayId)} },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  `);
}

/**
 * A catalog tall enough that Take Order's product pane must scroll internally
 * at every tested width — which is the point: a fitted page that grows with its
 * content instead of scrolling internally fails AC3 rather than passing it.
 */
export function seedWorkspaceCatalog(
  tag: string,
  productCount = 36,
): SeededWorkspaceCatalog {
  clearPreviousWorkspaceFixtures();
  const output = runPrisma(`
    const input = ${JSON.stringify({ tag, productCount, skuPrefix: SKU_PREFIX, categoryPrefix: CATEGORY_PREFIX })};
    const category = await prisma.category.create({
      data: {
        name: input.categoryPrefix + 'Drinks ' + input.tag,
        sortWeight: 992000,
        active: true,
        freeUpsizeEligible: true,
      },
    });
    const variantIds = [];
    const names = [];
    for (let index = 0; index < input.productCount; index += 1) {
      const label = String(index + 1).padStart(2, '0');
      const product = await prisma.product.create({
        data: {
          sku: input.skuPrefix + 'P' + label + '-' + input.tag,
          name: 'QA 349 Drink ' + label + ' ' + input.tag,
          categoryId: category.id,
          active: true,
          available: true,
        },
      });
      names.push(product.name);
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: 'Regular',
          priceCents: 15000,
          sortWeight: 100,
          active: true,
        },
      });
      variantIds.push(variant.id);
    }
    process.stdout.write(JSON.stringify({
      categoryName: category.name,
      variantIds,
      firstProductName: names[0],
      lastProductName: names[names.length - 1],
    }));
  `);
  return JSON.parse(output) as SeededWorkspaceCatalog;
}

/**
 * Completed orders for the day, enough that the Order History ledger overflows
 * the viewport at every tested width (AC7's "final displayed order").
 */
export function seedWorkspaceOrders(input: {
  tradingDayId: string;
  variantIds: string[];
  cashierName: string;
  count?: number;
}): void {
  runPrisma(`
    const input = ${JSON.stringify(input)};
    const count = input.count || 14;
    for (let index = 0; index < count; index += 1) {
      const variantId = input.variantIds[index % input.variantIds.length];
      await prisma.sale.create({
        data: {
          clientGeneratedId: require('node:crypto').randomUUID(),
          locationId: null,
          tradingDayId: input.tradingDayId,
          cashierNameSnapshot: input.cashierName,
          kind: 'PURCHASE',
          dayOrderNumber: index + 1,
          status: 'COMPLETED',
          customerName: 'QA 349 Guest ' + String(index + 1).padStart(2, '0'),
          serviceType: 'TAKE_OUT',
          subtotalCents: 15000,
          discountCents: 0,
          freeUpsizeCents: 0,
          taxCents: 0,
          totalCents: 15000,
          cashTipCents: 0,
          cashReceivedCents: 15000,
          changeOwedCents: 0,
          completedAt: new Date(),
          recordedAt: new Date(),
          payments: { create: [{ method: 'CASH', amountCents: 15000 }] },
          lines: {
            create: [{
              productVariantId: variantId,
              quantity: 1,
              unitPriceCents: 15000,
              lineGrossCents: 15000,
              discountKind: 'NONE',
              discountCents: 0,
              preferences: [],
              preferenceNote: null,
              freeUpsizeCount: 0,
              freeUpsizeCents: 0,
              freeUpsizeEligible: false,
              lineTotalCents: 15000,
              productNameSnapshot: 'QA 349 Drink',
              variantNameSnapshot: 'Regular',
            }],
          },
        },
      });
    }
  `);
}

/**
 * Stock items for the count sheet. Sized so the sheet overflows every tested
 * viewport even if the ambient database happens to be empty.
 */
export function seedWorkspaceStockItems(
  tag: string,
  itemCount = 24,
): SeededWorkspaceStockItems {
  const output = runPrisma(`
    const input = ${JSON.stringify({ tag, itemCount, skuPrefix: ITEM_SKU_PREFIX, categoryPrefix: CATEGORY_PREFIX })};
    const category = await prisma.stockCategory.create({
      data: { name: input.categoryPrefix + 'Supplies ' + input.tag, sortWeight: 992100 },
    });
    const itemNames = [];
    for (let index = 0; index < input.itemCount; index += 1) {
      const label = String(index + 1).padStart(2, '0');
      const item = await prisma.inventoryItem.create({
        data: {
          sku: input.skuPrefix + label + '-' + input.tag,
          name: 'QA 349 Supply ' + label + ' ' + input.tag,
          categoryId: category.id,
          unit: 'kg',
          size: null,
          countMethod: 'QUANTITY',
          critical: false,
          reconciled: false,
          active: true,
        },
      });
      itemNames.push(item.name);
    }
    process.stdout.write(JSON.stringify({
      categoryName: category.name,
      itemNames,
    }));
  `);
  return JSON.parse(output) as SeededWorkspaceStockItems;
}

/** Re-open a day the blocked-state test closed, so the suite can continue. */
export function reopenWorkspaceDay(tradingDayId: string): void {
  runPrisma(`
    await prisma.tradingDay.update({
      where: { id: ${JSON.stringify(tradingDayId)} },
      data: { status: 'OPEN', closedAt: null },
    });
  `);
}
