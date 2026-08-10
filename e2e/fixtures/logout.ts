import { randomUUID } from 'node:crypto';
import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the logout e2e suite (story #226, QA task #261).
 *
 * The logout criteria are almost entirely about *absence* — after signing out,
 * protected information must no longer be on screen. Asserting only the URL is
 * not enough: a redirect that fires after protected content has already painted
 * still leaked it. So the suite needs one piece of genuinely administrator-only
 * data with a name nothing else in the shared catalog could produce, and it
 * asserts that name is visible before sign-out and gone after.
 *
 * Two deliberate constraints:
 *
 *  1. **Nothing here is destructive.** Unlike the order and business-day
 *     fixtures, this one never clears trading days, sales or the roster. Logout
 *     is orthogonal to all of that, and wiping shared worlds only to prove a
 *     sign-out button works would make this spec a hazard to every other file
 *     in the suite.
 *  2. **Each run cleans up only its own rows.** Products are tagged
 *     `E2E-226-…`; `clearPreviousLogoutCatalogs()` drops leftovers from earlier
 *     runs so the shared catalog does not grow a row per run (the same leak
 *     that once made the Take Order page 147,000px tall).
 */

export interface SeededLogoutProduct {
  tag: string;
  categoryId: string;
  categoryName: string;
  productId: string;
  productName: string;
}

/**
 * Drop the catalog rows earlier runs of this spec left behind.
 *
 * Only `E2E-226-` products and the `QA Logout …` categories they sit in are
 * touched. This spec never sells anything, so no sale line can reference these
 * variants; the delete is still ordered variant-before-product because
 * `ProductVariant.product` is a required relation.
 */
function clearPreviousLogoutCatalogs(): void {
  runPrisma(`
    const stale = await prisma.product.findMany({
      where: { sku: { startsWith: 'E2E-226-' } },
      select: { id: true, categoryId: true },
    });
    if (stale.length > 0) {
      const productIds = stale.map((product) => product.id);
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      const categoryIds = [...new Set(stale.map((p) => p.categoryId))];
      for (const categoryId of categoryIds) {
        const remaining = await prisma.product.count({ where: { categoryId } });
        if (remaining === 0) {
          await prisma.category.deleteMany({
            where: { id: categoryId, name: { startsWith: 'QA Logout ' } },
          });
        }
      }
    }
  `);
}

/**
 * Seed one uniquely named product for this run.
 *
 * The name carries a random tag so the administrator product list can be
 * filtered down to exactly this row, and so "this string is not on screen"
 * after sign-out is a statement about real seeded data rather than about a
 * word that happens not to appear.
 */
export function seedLogoutProduct(): SeededLogoutProduct {
  clearPreviousLogoutCatalogs();
  const tag = randomUUID().slice(0, 8);
  const output = runPrisma(`
    const tag = ${JSON.stringify(tag)};
    const category = await prisma.category.create({
      data: {
        name: 'QA Logout ' + tag,
        sortWeight: 996000,
        active: true,
        freeUpsizeEligible: false,
      },
    });
    const product = await prisma.product.create({
      data: {
        sku: 'E2E-226-SECRET-' + tag,
        name: 'QA Restricted Blend ' + tag,
        categoryId: category.id,
        active: true,
        available: true,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: 'Regular',
        priceCents: 12300,
        sortWeight: 100,
        active: true,
      },
    });
    process.stdout.write(JSON.stringify({
      tag,
      categoryId: category.id,
      categoryName: category.name,
      productId: product.id,
      productName: product.name,
    }));
  `);
  return JSON.parse(output) as SeededLogoutProduct;
}

/** Remove this run's seeded rows. Safe to call more than once. */
export function removeLogoutProduct(seeded: SeededLogoutProduct): void {
  runPrisma(`
    await prisma.productVariant.deleteMany({
      where: { productId: ${JSON.stringify(seeded.productId)} },
    });
    await prisma.product.deleteMany({
      where: { id: ${JSON.stringify(seeded.productId)} },
    });
    const remaining = await prisma.product.count({
      where: { categoryId: ${JSON.stringify(seeded.categoryId)} },
    });
    if (remaining === 0) {
      await prisma.category.deleteMany({
        where: { id: ${JSON.stringify(seeded.categoryId)} },
      });
    }
  `);
}
