import { runPrisma } from './reporting-seed';

/**
 * Seeding support for the staff inventory operations e2e suite (story #108,
 * QA task #115).
 *
 * Two things force direct database seeding here rather than driving the UI:
 *
 *  1. **Nothing in the product opens a business day.** Every screen in #108 is
 *     scoped to "the current open business day", but the day-open capture story
 *     is still unwritten (ADR 0004 §6, and the Tech Lead's sequencing warning on
 *     #108). The open day therefore has to be seeded — and closed again, for the
 *     "No business day is open." state.
 *  2. **Counts and movements are append-only** (ADR 0001). There is no product
 *     surface that removes them, so a re-runnable suite has to clear them
 *     between tests itself. That is safe in v1: no other spec writes
 *     `stock_counts`, `stock_count_lines` or `stock_movements`.
 *
 * Stock items and par levels *do* have a UI (story #55), but creating eight
 * items with day-type par levels through it in every run would make the suite
 * about #55 rather than #108, so they are seeded too.
 *
 * All seeded rows carry a per-run tag so repeated runs against the persistent
 * dev database never collide.
 */

export type SeedCountMethod = 'QUANTITY' | 'LEVEL';

export interface SeedParLevel {
  parQty: number;
  lowThreshold: number | null;
  urgentThreshold: number | null;
}

export interface SeedItemSpec {
  name: string;
  unit: string;
  countMethod: SeedCountMethod;
  critical: boolean;
  /** NORMAL-day par level, or null for an item with no par settings at all. */
  par: SeedParLevel | null;
}

export interface SeededItem {
  id: string;
  name: string;
  unit: string;
}

export interface SeededStaff {
  id: string;
  displayName: string;
}

export interface SeededStockCountLine {
  itemName: string;
  quantity: number | null;
  level: string | null;
}

export interface SeededStockCount {
  id: string;
  phase: 'OPEN' | 'CLOSE';
  recordedAt: string;
  submittedByNameSnapshot: string;
  shiftLeadNameSnapshot: string | null;
  lines: SeededStockCountLine[];
}

/**
 * Clear every stock count, count line and stock movement.
 *
 * Restock status and both count sheets read "the current open business day"
 * globally, so leftovers from an earlier test would decide what the next test
 * sees. Nothing outside this suite writes these tables in v1.
 */
export function resetInventoryOperations(): void {
  runPrisma(`
    await prisma.stockCountLine.deleteMany({});
    await prisma.stockCount.deleteMany({});
    await prisma.stockMovement.deleteMany({});
  `);
}

/**
 * Close every open trading day. Used both to reach the "No business day is
 * open." state and to free the one-open-day-per-location slot before opening a
 * fresh day. Trading days are closed rather than deleted so seeded sales and
 * cash rows belonging to other suites keep their parent row.
 */
export function closeOpenBusinessDays(): void {
  runPrisma(`
    await prisma.tradingDay.updateMany({
      where: { status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  `);
}

/** Today's business date as `YYYY-MM-DD`, matching apps/api/prisma/seed.ts. */
export function businessDateToday(now = new Date()): string {
  const utcMidnight = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  return utcMidnight.toISOString().slice(0, 10);
}

/**
 * Close any open day and open a fresh one of the requested type, returning its
 * business date. `openedByStaffMemberId` is required by the schema, so any
 * staff member will do — the screens under test never display it.
 */
export function openBusinessDay(
  openedByStaffMemberId: string,
  dayType: 'NORMAL' | 'PEAK' = 'NORMAL',
): string {
  closeOpenBusinessDays();
  const businessDate = businessDateToday();
  runPrisma(`
    await prisma.tradingDay.create({
      data: {
        businessDate: new Date(${JSON.stringify(`${businessDate}T00:00:00.000Z`)}),
        status: 'OPEN',
        dayType: ${JSON.stringify(dayType)},
        openedAt: new Date(),
        openingFloatCents: 0,
        openedByStaffMemberId: ${JSON.stringify(openedByStaffMemberId)},
      },
    });
  `);
  return businessDate;
}

/**
 * Create the stock category, inventory items (with NORMAL-day par levels) and
 * staff members the suite needs. Keys are stable so the spec can name what each
 * row is for.
 */
export function seedInventoryItems(
  tag: string,
  specs: Record<string, SeedItemSpec>,
): Record<string, SeededItem> {
  const payload = JSON.stringify({ tag, specs });
  const output = runPrisma(`
    const input = ${payload};
    const category = await prisma.stockCategory.create({
      data: { name: 'QA Ops ' + input.tag, sortWeight: 990100 },
    });
    const created = {};
    for (const [key, spec] of Object.entries(input.specs)) {
      const item = await prisma.inventoryItem.create({
        data: {
          sku: 'E2E-108-' + key.toUpperCase() + '-' + input.tag,
          name: spec.name,
          categoryId: category.id,
          unit: spec.unit,
          size: null,
          countMethod: spec.countMethod,
          critical: spec.critical,
          reconciled: false,
          active: true,
        },
      });
      if (spec.par !== null) {
        await prisma.parLevel.create({
          data: {
            inventoryItemId: item.id,
            dayType: 'NORMAL',
            parQty: spec.par.parQty,
            lowThreshold: spec.par.lowThreshold,
            urgentThreshold: spec.par.urgentThreshold,
          },
        });
      }
      created[key] = { id: item.id, name: item.name, unit: item.unit };
    }
    process.stdout.write(JSON.stringify(created));
  `);
  return JSON.parse(output) as Record<string, SeededItem>;
}

/** Create staff roster members, keyed the same way as the item seeds. */
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
 * Rename and/or deactivate a staff member — the roster edits ADR 0003 says must
 * not rewrite what an already-submitted count shows.
 */
export function updateStaffMember(
  id: string,
  changes: { displayName?: string; isActive?: boolean },
): void {
  runPrisma(`
    await prisma.staffMember.update({
      where: { id: ${JSON.stringify(id)} },
      data: ${JSON.stringify(changes)},
    });
  `);
}

/** Every stock count in the database, oldest first, with its lines. */
export function readStockCounts(): SeededStockCount[] {
  const output = runPrisma(`
    const counts = await prisma.stockCount.findMany({
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      include: { lines: { include: { inventoryItem: { select: { name: true } } } } },
    });
    process.stdout.write(JSON.stringify(counts.map((count) => ({
      id: count.id,
      phase: count.phase,
      recordedAt: count.recordedAt.toISOString(),
      submittedByNameSnapshot: count.submittedByNameSnapshot,
      shiftLeadNameSnapshot: count.shiftLeadNameSnapshot,
      lines: count.lines
        .map((line) => ({
          itemName: line.inventoryItem.name,
          quantity: line.quantity,
          level: line.level,
        }))
        .sort((left, right) => left.itemName.localeCompare(right.itemName)),
    }))));
  `);
  return JSON.parse(output) as SeededStockCount[];
}

/** Every stock movement in the database, oldest first. */
export function readStockMovements(): Array<{
  id: string;
  itemName: string;
  type: string;
  quantity: number;
  reason: string | null;
  recordedByNameSnapshot: string | null;
}> {
  const output = runPrisma(`
    const movements = await prisma.stockMovement.findMany({
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      include: { inventoryItem: { select: { name: true } } },
    });
    process.stdout.write(JSON.stringify(movements.map((movement) => ({
      id: movement.id,
      itemName: movement.inventoryItem.name,
      type: movement.type,
      quantity: movement.quantity,
      reason: movement.reason,
      recordedByNameSnapshot: movement.recordedByNameSnapshot,
    }))));
  `);
  return JSON.parse(output) as ReturnType<typeof readStockMovements>;
}
