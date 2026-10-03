import { runPrisma } from './reporting-seed';

export interface ClosingLineSeed {
  inventoryItemId: string;
  quantity?: number;
  level?:
    | 'EMPTY'
    | 'LOW'
    | 'QUARTER'
    | 'ONE_THIRD'
    | 'HALF'
    | 'TWO_THIRDS'
    | 'THREE_QUARTERS'
    | 'FULL';
}

export interface ClosingCountSeed {
  businessDate: string;
  recordedAt: string;
  submittedByStaffMemberId: string;
  submittedByNameSnapshot: string;
  correctsStockCountId?: string;
  lines: ClosingLineSeed[];
}

/**
 * Seed a historical closing count, which the product has no UI for once its
 * business day is over. The opening screen itself is still exercised through
 * the real browser, API, and database.
 */
export function seedHistoricalClosingCount(input: ClosingCountSeed): string {
  return runPrisma(`
    const input = ${JSON.stringify(input)};
    const openDay = await prisma.tradingDay.findFirst({
      where: { status: 'OPEN' },
      select: { locationId: true },
    });
    if (!openDay) throw new Error('An open trading day is required');
    const count = await prisma.stockCount.create({
      data: {
        locationId: openDay.locationId,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        phase: 'CLOSE',
        recordedAt: new Date(input.recordedAt),
        submittedByStaffMemberId: input.submittedByStaffMemberId,
        submittedByNameSnapshot: input.submittedByNameSnapshot,
        correctsStockCountId: input.correctsStockCountId ?? null,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity ?? null,
            level: line.level ?? null,
          })),
        },
      },
      select: { id: true },
    });
    process.stdout.write(count.id);
  `);
}
