/**
 * Local dev seed: one realistic business day for YESTERDAY, with an opening
 * stock count (carrying a session note) and a couple of stock movements, so the
 * daily inventory report has something to show and a closing count can be
 * recorded by hand.
 *
 * Not part of the app seed. Run it deliberately:
 *   cd apps/api && npx ts-node prisma/seed-yesterday-inventory.ts
 *
 * At most one trading day may be OPEN at a time (a partial unique index
 * enforces it), so this CLOSES whatever day is currently open first.
 */
import { PrismaClient, StockCountPhase, TradingDayStatus, MovementType } from '@prisma/client';

const prisma = new PrismaClient();

function isoDateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function main() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const businessDate = isoDateOnly(yesterday);
  const dateLabel = businessDate.toISOString().slice(0, 10);

  const staff = await prisma.staffMember.findFirst({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true },
  });
  if (!staff) throw new Error('No active staff member to attribute the day to.');

  // Items that appear on BOTH count sheets: active + critical + quantity-counted.
  const items = await prisma.inventoryItem.findMany({
    where: { active: true, critical: true, countMethod: 'QUANTITY' },
    orderBy: { name: 'asc' },
    take: 6,
    select: { id: true, name: true, unit: true },
  });
  if (items.length === 0) throw new Error('No active critical quantity items found.');

  await prisma.$transaction(async (tx) => {
    // One OPEN day at a time. Close any other open day before opening ours.
    const open = await tx.tradingDay.findMany({
      where: { status: TradingDayStatus.OPEN },
      select: { id: true, businessDate: true },
    });
    for (const day of open) {
      if (day.businessDate.getTime() === businessDate.getTime()) continue;
      await tx.tradingDay.update({
        where: { id: day.id },
        data: {
          status: TradingDayStatus.CLOSED,
          closedAt: new Date(),
          closedByStaffMemberId: staff.id,
        },
      });
      console.log(`closed previously-open day ${day.businessDate.toISOString().slice(0, 10)}`);
    }

    const existing = await tx.tradingDay.findFirst({
      where: { businessDate, locationId: null },
      select: { id: true },
    });

    const openedAt = new Date(`${dateLabel}T06:30:00.000Z`);
    const dayId = existing
      ? (await tx.tradingDay.update({
          where: { id: existing.id },
          data: { status: TradingDayStatus.OPEN, closedAt: null, closedByStaffMemberId: null },
          select: { id: true },
        })).id
      : (await tx.tradingDay.create({
          data: {
            businessDate,
            status: TradingDayStatus.OPEN,
            dayType: 'NORMAL',
            openedAt,
            openingFloatCents: 200_000, // ₱2,000.00 in integer cents
            openedByStaffMemberId: staff.id,
          },
          select: { id: true },
        })).id;
    console.log(`trading day ${dateLabel} OPEN (${dayId})`);

    // Opening count, with the new session note.
    const alreadyCounted = await tx.stockCount.findFirst({
      where: { businessDate, locationId: null, phase: StockCountPhase.OPEN },
      select: { id: true },
    });
    if (alreadyCounted) {
      console.log('opening count already present — left as is');
    } else {
      const count = await tx.stockCount.create({
        data: {
          businessDate,
          phase: StockCountPhase.OPEN,
          recordedAt: new Date(`${dateLabel}T06:45:00.000Z`),
          submittedByStaffMemberId: staff.id,
          submittedByNameSnapshot: staff.displayName,
          notes:
            'Chest freezer was reading 4C at open — flagged to maintenance. ' +
            'Bean hopper looked low but measured on par.',
          lines: {
            create: items.map((item, i) => ({
              inventoryItemId: item.id,
              quantity: 24 - i * 3,
              level: null,
            })),
          },
        },
        select: { id: true },
      });
      console.log(`opening count ${count.id} with ${items.length} lines + a note`);
    }

    const movementCount = await tx.stockMovement.count({ where: { businessDate, locationId: null } });
    if (movementCount > 0) {
      console.log(`${movementCount} stock movement(s) already present — left as is`);
    } else {
      await tx.stockMovement.createMany({
        data: [
          {
            businessDate,
            inventoryItemId: items[0]!.id,
            type: MovementType.DELIVERY,
            quantity: 12,
            recordedByStaffMemberId: staff.id,
            recordedByNameSnapshot: staff.displayName,
            reason: 'Morning delivery from supplier',
            recordedAt: new Date(`${dateLabel}T09:15:00.000Z`),
          },
          {
            businessDate,
            inventoryItemId: items[1]!.id,
            type: MovementType.WASTAGE,
            quantity: 2,
            recordedByStaffMemberId: staff.id,
            recordedByNameSnapshot: staff.displayName,
            reason: 'Dropped during service',
            recordedAt: new Date(`${dateLabel}T14:00:00.000Z`),
          },
        ],
      });
      console.log('2 stock movements (1 delivery, 1 wastage)');
    }
  });

  console.log('\nSeeded. Counted items (these are on the closing sheet too):');
  for (const item of items) console.log(`  - ${item.name} (${item.unit})`);
  console.log(`\nDaily inventory report date to select: ${dateLabel}`);
  console.log('Closing count: POS → Closing (the open day is now this date).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
