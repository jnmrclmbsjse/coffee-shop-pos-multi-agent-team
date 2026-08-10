import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the multi-serving packaging-draw e2e suite (story #247,
 * QA task #271).
 *
 * What this story adds is arithmetic, not a screen: `Product.packagingServings`
 * is snapshotted onto each `SaleLine` when the line is added, and the close
 * screen's `sold` term becomes `Σ (quantity × packagingServingsSnapshot)`
 * (ADR 0010 §3, amending ADR 0006 §5). Three consequences shape this fixture.
 *
 *  1. **Orders must be created by the product, never seeded.** The snapshot is
 *     written by `OrdersService.lineCreateData`, so a fixture that inserted
 *     `SaleLine` rows directly would silently supply the column default of 1
 *     and every assertion below would pass against an implementation that never
 *     reads the catalog at all. Sales are therefore driven through the real
 *     `/orders` API from the spec; this module only seeds what an order needs to
 *     exist — catalog, inventory items, staff, the open day and the counts.
 *  2. **Packaging reconciliation reads every reconciled item globally**, and the
 *     dev database keeps the cup/lid rows earlier suites left behind. Items are
 *     tagged per run and the spec asserts only its own rows by name.
 *  3. **The catalog is shared and nothing used to clean it up.** Every run drops
 *     its predecessors' `E2E-247-` products, variants and inventory items before
 *     seeding, so repeated runs cannot grow the Take Order grid without bound.
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

export interface PackagingCatalog {
  tag: string;
  categoryId: string;
  items: Record<string, SeededItem>;
  products: Record<string, SeededProduct>;
}

export interface SeededDay {
  id: string;
  businessDate: string;
}

export interface StoredLine {
  productNameSnapshot: string;
  variantNameSnapshot: string;
  quantity: number;
  packagingServingsSnapshot: number;
  unitPriceCents: number;
  lineGrossCents: number;
  lineTotalCents: number;
}

export interface StoredSale {
  dayOrderNumber: number;
  kind: 'PURCHASE' | 'VOID';
  status: 'PARKED' | 'COMPLETED';
  subtotalCents: number;
  totalCents: number;
  lines: StoredLine[];
}

/**
 * Clear every trading day, sale and stock record.
 *
 * The close screen reads "the current open business day" globally with no
 * per-run scope, so a leftover day from another suite — or from the previous
 * test — would decide what this one sees. Catalog, inventory and roster rows are
 * deliberately left alone: they are what the deleted rows point at.
 */
export function resetPackagingWorld(): void {
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
 * Drop the catalog and inventory rows earlier runs of this spec left behind.
 *
 * Only `E2E-247-` rows are touched. Sale lines pointing at the doomed variants
 * go first because `SaleLine.productVariant` is `onDelete: Restrict`; every sale
 * is cleared moments later by `resetPackagingWorld()` anyway.
 */
function clearPreviousPackagingFixtures(): void {
  runPrisma(`
    const products = await prisma.product.findMany({
      where: { sku: { startsWith: 'E2E-247-' } },
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
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      const categoryIds = [...new Set(products.map((p) => p.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.product.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.category.deleteMany({
            where: { id: categoryId, name: { startsWith: 'QA Servings ' } },
          });
        }
      }
    }

    // Inventory items outlive their variants, and a reconciled leftover would
    // keep appearing on every future close screen. Stock lines and movements
    // reference them, so those go first.
    const items = await prisma.inventoryItem.findMany({
      where: { sku: { startsWith: 'E2E-247-' } },
      select: { id: true, categoryId: true },
    });
    if (items.length > 0) {
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
      const stockCategoryIds = [...new Set(items.map((item) => item.categoryId))];
      for (const categoryId of stockCategoryIds) {
        const remaining = await prisma.inventoryItem.count({
          where: { categoryId },
        });
        if (remaining === 0) {
          await prisma.stockCategory.deleteMany({
            where: { id: categoryId, name: { startsWith: 'QA Servings ' } },
          });
        }
      }
    }
  `);
}

/**
 * Seed every reconciled packaging item and every product this suite sells.
 *
 * The item set is chosen so the criteria that can pass by accident cannot:
 *
 *  - `cup` / `lid` carry the core arithmetic and the ordinary-product control.
 *  - `largeCup` / `largeLid` are mapped to the Large size ONLY. An
 *    implementation that ignores the variant mapping and draws from "the
 *    product's" packaging still produces a plausible total, so the untouched
 *    size is asserted explicitly.
 *  - `dual` is one item filling both the cup and the lid role on a single
 *    variant. ADR 0006 §5's per-role rule means it must be drawn twice, and the
 *    new multiplier has to compose with that rather than replace it.
 *  - `bareCup` / `bareLid` are deliberately left out of every opening count, so
 *    a larger `sold` term meets the `NULL`-on-missing-opening-count rule that
 *    replaced the negative-expected defect.
 *
 * Products span the multiplier's whole range: 1 (the control), 2 (the story's
 * buy-one-take-one case) and 3 (so an implementation that hard-codes a doubling
 * rather than reading the field is caught).
 */
export function seedPackagingCatalog(tag: string): PackagingCatalog {
  clearPreviousPackagingFixtures();
  const output = runPrisma(`
    const tag = ${JSON.stringify(tag)};

    const stockCategory = await prisma.stockCategory.create({
      data: { name: 'QA Servings Packaging ' + tag, sortWeight: 992000 },
    });
    const itemSpecs = [
      { key: 'cup', name: 'QA Servings Cup ' + tag },
      { key: 'lid', name: 'QA Servings Lid ' + tag },
      { key: 'largeCup', name: 'QA Servings Large Cup ' + tag },
      { key: 'largeLid', name: 'QA Servings Large Lid ' + tag },
      { key: 'dual', name: 'QA Servings Combo Cup-Lid ' + tag },
      { key: 'bareCup', name: 'QA Servings Uncounted Cup ' + tag },
      { key: 'bareLid', name: 'QA Servings Uncounted Lid ' + tag },
    ];
    const items = {};
    for (const spec of itemSpecs) {
      const item = await prisma.inventoryItem.create({
        data: {
          sku: 'E2E-247-' + spec.key.toUpperCase() + '-' + tag,
          name: spec.name,
          categoryId: stockCategory.id,
          unit: 'pcs',
          size: null,
          countMethod: 'QUANTITY',
          critical: false,
          reconciled: true,
          active: true,
        },
      });
      items[spec.key] = { id: item.id, name: item.name };
    }

    const category = await prisma.category.create({
      data: {
        name: 'QA Servings Drinks ' + tag,
        sortWeight: 992000,
        active: true,
        freeUpsizeEligible: false,
      },
    });

    const productSpecs = [
      {
        key: 'promo',
        name: 'QA Buy One Take One ' + tag,
        packagingServings: 2,
        variants: [
          {
            key: 'regular',
            name: 'Regular',
            priceCents: 15000,
            cup: 'cup',
            lid: 'lid',
          },
        ],
      },
      {
        key: 'ordinary',
        name: 'QA Single Serve ' + tag,
        packagingServings: 1,
        variants: [
          {
            key: 'regular',
            name: 'Regular',
            priceCents: 12000,
            cup: 'cup',
            lid: 'lid',
          },
        ],
      },
      {
        key: 'sized',
        name: 'QA Sized Promo ' + tag,
        packagingServings: 2,
        variants: [
          {
            key: 'regular',
            name: 'Regular',
            priceCents: 16000,
            cup: 'cup',
            lid: 'lid',
          },
          {
            key: 'large',
            name: 'Large',
            priceCents: 19000,
            cup: 'largeCup',
            lid: 'largeLid',
          },
        ],
      },
      {
        key: 'combo',
        name: 'QA Combo Vessel Promo ' + tag,
        packagingServings: 2,
        variants: [
          {
            key: 'regular',
            name: 'Regular',
            priceCents: 14000,
            cup: 'dual',
            lid: 'dual',
          },
        ],
      },
      {
        key: 'triple',
        name: 'QA Triple Serve ' + tag,
        packagingServings: 3,
        variants: [
          {
            key: 'regular',
            name: 'Regular',
            priceCents: 21000,
            cup: 'bareCup',
            lid: 'bareLid',
          },
        ],
      },
    ];

    const products = {};
    for (const spec of productSpecs) {
      const product = await prisma.product.create({
        data: {
          sku: 'E2E-247-' + spec.key.toUpperCase() + '-' + tag,
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
      products[spec.key] = {
        id: product.id,
        name: product.name,
        variants,
      };
    }

    process.stdout.write(JSON.stringify({
      tag,
      categoryId: category.id,
      items,
      products,
    }));
  `);
  return JSON.parse(output) as PackagingCatalog;
}

/** One roster member per run — the day has to be opened by somebody. */
export function seedPackagingStaff(displayName: string): SeededItem {
  const output = runPrisma(`
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)}, isActive: true },
    });
    process.stdout.write(JSON.stringify({
      id: member.id,
      name: member.displayName,
    }));
  `);
  return JSON.parse(output) as SeededItem;
}

/** Open the day directly — here it is a precondition, not the subject. */
export function openPackagingDay(input: {
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

/** Record an opening or closing stock count for a business date. */
export function seedStockCount(input: {
  businessDate: string;
  phase: 'OPEN' | 'CLOSE';
  submittedBy: SeededItem;
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
        submittedByNameSnapshot: input.submittedBy.name,
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

/**
 * Change a product's servings count behind the running app's back.
 *
 * This is the catalog edit that criterion 7 says must not reach an order whose
 * line already exists. Going through Prisma rather than the editor UI is
 * deliberate: the point under test is what the *reconciliation* reads, and the
 * editor round-trip is proven separately.
 */
export function setProductServings(productId: string, servings: number): void {
  runPrisma(`
    await prisma.product.update({
      where: { id: ${JSON.stringify(productId)} },
      data: { packagingServings: ${JSON.stringify(servings)} },
    });
  `);
}

/** A product's stored servings count, read straight from the database. */
export function readProductServings(productId: string): number {
  return Number(
    runPrisma(`
      const product = await prisma.product.findUnique({
        where: { id: ${JSON.stringify(productId)} },
        select: { packagingServings: true },
      });
      process.stdout.write(String(product === null ? -1 : product.packagingServings));
    `),
  );
}

/**
 * Every sale in the database, order number first, with its stored line
 * arithmetic.
 *
 * The money criterion ("a 2-serving product still costs one unit price") and the
 * snapshot criterion are both statements about stored integer cents and stored
 * integers, so they are asserted here rather than against rendered text.
 */
export function readSales(): StoredSale[] {
  const output = runPrisma(`
    const sales = await prisma.sale.findMany({
      orderBy: [{ dayOrderNumber: 'asc' }, { kind: 'asc' }],
      include: { lines: { orderBy: [{ id: 'asc' }] } },
    });
    process.stdout.write(JSON.stringify(sales.map((sale) => ({
      dayOrderNumber: sale.dayOrderNumber,
      kind: sale.kind,
      status: sale.status,
      subtotalCents: sale.subtotalCents,
      totalCents: sale.totalCents,
      lines: sale.lines.map((line) => ({
        productNameSnapshot: line.productNameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
        quantity: line.quantity,
        packagingServingsSnapshot: line.packagingServingsSnapshot,
        unitPriceCents: line.unitPriceCents,
        lineGrossCents: line.lineGrossCents,
        lineTotalCents: line.lineTotalCents,
      })),
    }))));
  `);
  return JSON.parse(output) as StoredSale[];
}
