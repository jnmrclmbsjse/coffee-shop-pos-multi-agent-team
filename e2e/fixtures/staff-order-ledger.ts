import { randomUUID } from 'node:crypto';
import {
  ensureStaffMemberId,
  isoShift,
  runPrisma,
  seedReportingCatalog,
  seedTradingDay,
  shopToday,
  type SeedSale,
  type SeededVariant,
} from './reporting-seed';

export interface StaffOrderLedgerFixture {
  openDay: { id: string; businessDate: string };
  closedDay: { id: string; businessDate: string };
  cashierName: string;
  productNames: {
    latte: string;
    pastry: string;
  };
}

function resetLedgerWorld(): void {
  runPrisma(`
    await prisma.$executeRawUnsafe('DELETE FROM day_closing_lines');
    await prisma.$executeRawUnsafe('DELETE FROM day_closings');
    await prisma.$executeRawUnsafe('DELETE FROM sale_payments');
    await prisma.$executeRawUnsafe('DELETE FROM sale_lines');
    await prisma.$executeRawUnsafe('DELETE FROM sales WHERE corrects_sale_id IS NOT NULL');
    await prisma.$executeRawUnsafe('DELETE FROM sales');
    await prisma.$executeRawUnsafe('DELETE FROM cash_counts');
    await prisma.$executeRawUnsafe('DELETE FROM cash_movements');
    await prisma.$executeRawUnsafe('DELETE FROM stock_count_lines');
    await prisma.$executeRawUnsafe('DELETE FROM stock_counts');
    await prisma.$executeRawUnsafe('DELETE FROM stock_movements');
    await prisma.$executeRawUnsafe('DELETE FROM trading_days');
  `);
}

function line(
  variant: SeededVariant,
  input: {
    quantity?: number;
    unitPriceCents: number;
    discountKind?: 'NONE' | 'SENIOR';
    discountCents?: number;
    lineTotalCents?: number;
  },
) {
  const quantity = input.quantity ?? 1;
  const gross = input.unitPriceCents * quantity;
  return {
    variant,
    quantity,
    unitPriceCents: input.unitPriceCents,
    lineGrossCents: gross,
    discountKind: input.discountKind,
    discountCents: input.discountCents,
    lineTotalCents: input.lineTotalCents ?? gross,
  };
}

/**
 * Seed the complete #148 matrix directly because no order-capture workflow
 * exists yet. The API ledger deliberately excludes the VOID correction record;
 * its presence derives the original purchase's visible Void status.
 */
export function seedStaffOrderLedgerFixture(
  runTag: string,
): StaffOrderLedgerFixture {
  resetLedgerWorld();

  const staffMemberId = ensureStaffMemberId();
  const cashierName = `Mika Ledger ${runTag}`;
  const variants = seedReportingCatalog(`LEDGER-${runTag}`);
  const latte = variants.alphaSmall!;
  const pastry = variants.beta!;
  const today = shopToday();
  const closedDate = isoShift(today, -1);

  const attributedCashier = {
    staffMemberId,
    nameSnapshot: cashierName,
  };

  const openVoidTargetId = randomUUID();
  const openSales: SeedSale[] = [
    {
      customerName: 'Open Day First',
      cashier: null,
      cashCents: 15_000,
      cashReceivedCents: 17_000,
      changeOwedCents: 2_000,
      lines: [line(latte, { unitPriceCents: 15_000 })],
    },
    {
      customerName: null,
      cashier: attributedCashier,
      cashCents: 8_000,
      cashReceivedCents: 10_000,
      changeOwedCents: 2_000,
      changeSettledAt: `${today}T04:00:00.000Z`,
      lines: [line(pastry, { unitPriceCents: 8_000 })],
    },
    {
      customerName: 'Open Parked Guest',
      cashier: attributedCashier,
      status: 'PARKED',
      lines: [line(latte, { unitPriceCents: 12_000 })],
    },
    {
      customerName: 'Open Split Guest',
      cashier: attributedCashier,
      cashCents: 8_000,
      onlineCents: 12_000,
      lines: [line(latte, { unitPriceCents: 20_000 })],
    },
    {
      customerName: 'Senior Online Guest',
      cashier: attributedCashier,
      onlineCents: 24_000,
      discountCents: 3_000,
      lines: [
        line(latte, {
          quantity: 2,
          unitPriceCents: 12_000,
          discountKind: 'SENIOR',
          discountCents: 3_000,
          lineTotalCents: 21_000,
        }),
        line(pastry, { unitPriceCents: 3_000 }),
      ],
    },
    {
      id: openVoidTargetId,
      customerName: 'Open Voided Guest',
      cashier: attributedCashier,
      cashCents: 11_000,
      lines: [line(pastry, { unitPriceCents: 11_000 })],
    },
    {
      kind: 'VOID',
      correctsSaleId: openVoidTargetId,
      customerName: 'Open Voided Guest',
      cashier: attributedCashier,
      cashCents: -11_000,
      voidReason: 'Wrong milk selected',
      lines: [line(pastry, { unitPriceCents: -11_000 })],
    },
    {
      customerName: 'Senior Cash Guest',
      cashier: attributedCashier,
      cashCents: 9_000,
      lines: [line(pastry, { unitPriceCents: 9_000 })],
    },
  ];

  const openDay = seedTradingDay(
    {
      businessDate: today,
      status: 'OPEN',
      openingFloatCents: 20_000,
      sales: openSales,
    },
    staffMemberId,
  );

  const closedVoidTargetId = randomUUID();
  const closedSales: SeedSale[] = [
    {
      customerName: 'Closed Day First',
      cashier: attributedCashier,
      cashCents: 7_000,
      lines: [line(latte, { unitPriceCents: 7_000 })],
    },
    {
      customerName: 'Closed Parked Guest',
      cashier: null,
      status: 'PARKED',
      lines: [line(pastry, { unitPriceCents: 6_000 })],
    },
    {
      id: closedVoidTargetId,
      customerName: 'Closed Voided Guest',
      cashier: attributedCashier,
      onlineCents: 13_000,
      lines: [line(latte, { unitPriceCents: 13_000 })],
    },
    {
      kind: 'VOID',
      correctsSaleId: closedVoidTargetId,
      customerName: 'Closed Voided Guest',
      cashier: attributedCashier,
      onlineCents: -13_000,
      voidReason: 'Duplicate closed-day order',
      lines: [line(latte, { unitPriceCents: -13_000 })],
    },
    {
      customerName: 'Closed Split Guest',
      cashier: attributedCashier,
      cashCents: 5_000,
      onlineCents: 4_000,
      lines: [line(pastry, { unitPriceCents: 9_000 })],
    },
  ];

  const closedDay = seedTradingDay(
    {
      businessDate: closedDate,
      status: 'CLOSED',
      openingFloatCents: 18_000,
      sales: closedSales,
    },
    staffMemberId,
  );

  return {
    openDay: { id: openDay.id, businessDate: today },
    closedDay: { id: closedDay.id, businessDate: closedDate },
    cashierName,
    productNames: {
      latte: latte.productName,
      pastry: pastry.productName,
    },
  };
}

/** Stable JSON snapshot of every seeded order and all nested ledger data. */
export function readStaffOrderLedgerSnapshot(): string {
  return runPrisma(`
    const sales = await prisma.sale.findMany({
      orderBy: [{ tradingDayId: 'asc' }, { dayOrderNumber: 'asc' }],
      include: {
        payments: { orderBy: [{ method: 'asc' }, { id: 'asc' }] },
        lines: { orderBy: { id: 'asc' } },
      },
    });
    process.stdout.write(JSON.stringify(sales));
  `);
}
