import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the level-based par settings e2e suite (story #286,
 * QA task #292).
 *
 * Deliberately minimal. #286 is a *master-data entry* story, so every stock
 * item and every par level this suite asserts on is created through the real
 * admin editor → API → PostgreSQL path rather than written here: hand-seeded
 * `par_levels` rows supply their own column defaults and have hidden real
 * persistence bugs on this project before (the SaleLine snapshot case). What
 * this file provides is only what the product has no surface for:
 *
 *  1. a stock category to hang the run's items on (created directly so the
 *     suite is about par settings rather than about #55's category CRUD);
 *  2. a *read-back* of the saved `par_levels` rows, so "the other count
 *     method's par is NULL" and "nothing was persisted" are assertable as
 *     statements about the database and not only about what the editor
 *     happens to re-render; and
 *  3. cleanup of the rows this run created — the catalog fixtures leaking rows
 *     has bitten layout specs here before.
 */

export interface SeededParRow {
  dayType: 'NORMAL' | 'PEAK';
  parQty: number | null;
  parLevel: string | null;
  lowThreshold: number | null;
  urgentThreshold: number | null;
}

export interface SeededItemRecord {
  id: string;
  name: string;
  countMethod: 'QUANTITY' | 'LEVEL';
  parLevels: SeededParRow[];
}

/** Create the stock category this run's items are created into. */
export function createParCategory(tag: string): { id: string; name: string } {
  const name = `QA Par ${tag}`;
  const output = runPrisma(`
    const category = await prisma.stockCategory.create({
      data: { name: ${JSON.stringify(name)}, sortWeight: 990200, active: true },
    });
    process.stdout.write(JSON.stringify({ id: category.id, name: category.name }));
  `);
  return JSON.parse(output) as { id: string; name: string };
}

/**
 * The stock item with this exact name, with its par rows ordered NORMAL then
 * PEAK. Returns null when no such item exists, so a test can assert that an
 * unsaved editor state was genuinely never persisted.
 */
export function readItemByName(name: string): SeededItemRecord | null {
  const output = runPrisma(`
    const item = await prisma.inventoryItem.findFirst({
      where: { name: ${JSON.stringify(name)} },
      include: { parLevels: true },
    });
    process.stdout.write(JSON.stringify(item === null ? null : {
      id: item.id,
      name: item.name,
      countMethod: item.countMethod,
      parLevels: item.parLevels
        .map((par) => ({
          dayType: par.dayType,
          parQty: par.parQty,
          parLevel: par.parLevel,
          lowThreshold: par.lowThreshold,
          urgentThreshold: par.urgentThreshold,
        }))
        .sort((left, right) => left.dayType.localeCompare(right.dayType)),
    }));
  `);
  return JSON.parse(output) as SeededItemRecord | null;
}

/** The saved par row for one day type, or null when the item has none. */
export function readParRow(
  itemName: string,
  dayType: 'NORMAL' | 'PEAK',
): SeededParRow | null {
  const item = readItemByName(itemName);
  if (item === null) return null;
  return item.parLevels.find((par) => par.dayType === dayType) ?? null;
}

/**
 * Delete every stock item in this run's category, then the category itself.
 *
 * Par levels cascade with their item. Items counted during the Restock check
 * are referenced by `stock_count_lines`, so those lines are removed first —
 * safe here because the Restock test clears counts anyway, and nothing else in
 * v1 reads a count line belonging to a deleted item.
 */
export function removeParCategory(categoryId: string): void {
  runPrisma(`
    const items = await prisma.inventoryItem.findMany({
      where: { categoryId: ${JSON.stringify(categoryId)} },
      select: { id: true },
    });
    const ids = items.map((item) => item.id);
    if (ids.length > 0) {
      await prisma.stockCountLine.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.stockMovement.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.parLevel.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.stockCategory.deleteMany({
      where: { id: ${JSON.stringify(categoryId)} },
    });
  `);
}

/** Drop the categories and items earlier runs of this spec left behind. */
export function clearPreviousParRuns(): void {
  runPrisma(`
    const categories = await prisma.stockCategory.findMany({
      where: { name: { startsWith: 'QA Par ' } },
      select: { id: true },
    });
    const categoryIds = categories.map((category) => category.id);
    if (categoryIds.length === 0) {
      process.stdout.write('');
      return;
    }
    const items = await prisma.inventoryItem.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { id: true },
    });
    const ids = items.map((item) => item.id);
    if (ids.length > 0) {
      await prisma.stockCountLine.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.stockMovement.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.parLevel.deleteMany({ where: { inventoryItemId: { in: ids } } });
      await prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.stockCategory.deleteMany({ where: { id: { in: categoryIds } } });
  `);
}
