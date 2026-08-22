import { runPrisma } from './reporting-seed';

/**
 * Seeding support for story #340 (QA task #344) — cash received and expected
 * change on the staff order card.
 *
 * Almost every scenario this story needs is reachable through the real capture
 * path, and the spec builds those through `POST /orders` + `/complete` rather
 * than inserting rows: `expectedChangeCents` is derived from the settlement
 * snapshot, and a hand-written row supplies its own column values, which can
 * hide a mapping bug between what capture stores and what the ledger reads.
 *
 * Two acceptance criteria are *not* reachable that way, because
 * `validateTender()` rejects both on the way in:
 *
 *  - cash received below the cash portion (the negative, "shown as recorded"
 *    case ADR 0005 §5 requires the read model to display without validating);
 *  - cash received recorded against an order with no CASH payment row (the
 *    independent-gating case: Cash received shows, Expected change does not).
 *
 * Both exist in v1 only as legacy/imported rows, so they are seeded here — that
 * is the point of the criteria, not a shortcut around the capture path.
 */

export interface LegacySaleInput {
  tradingDayId: string;
  dayOrderNumber: number;
  customerName: string;
  productVariantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  /** Order total, and the amount of the single tender row. */
  totalCents: number;
  /** `CASH` produces the negative case; `ONLINE` the independent-gating case. */
  paymentMethod: 'CASH' | 'ONLINE';
  cashReceivedCents: number;
}

/**
 * Insert one completed historical sale that the capture path would refuse.
 *
 * Written with the Prisma client rather than raw SQL so a future required
 * column fails loudly here instead of silently defaulting.
 */
export function seedLegacyCashSale(input: LegacySaleInput): void {
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
        subtotalCents: input.totalCents,
        discountCents: 0,
        taxCents: 0,
        totalCents: input.totalCents,
        cashTipCents: 0,
        cashReceivedCents: input.cashReceivedCents,
        changeOwedCents: 0,
        completedAt: new Date(),
        payments: {
          create: [
            { method: input.paymentMethod, amountCents: input.totalCents },
          ],
        },
        lines: {
          create: [{
            productVariantId: input.productVariantId,
            quantity: 1,
            unitPriceCents: input.totalCents,
            lineGrossCents: input.totalCents,
            discountKind: 'NONE',
            discountCents: 0,
            freeUpsizeEligible: false,
            lineTotalCents: input.totalCents,
            productNameSnapshot: input.productNameSnapshot,
            variantNameSnapshot: input.variantNameSnapshot,
          }],
        },
      },
    });
  `);
}

/**
 * A stable JSON snapshot of every sale, its tender rows and its settlement
 * columns — the evidence for "reviewing these values does not change the order
 * or its settlement record". Ordered deterministically so a re-read of an
 * unchanged database is byte-identical.
 */
export function readSettlementSnapshot(): string {
  return runPrisma(`
    const sales = await prisma.sale.findMany({
      orderBy: [{ tradingDayId: 'asc' }, { dayOrderNumber: 'asc' }, { kind: 'asc' }],
      select: {
        dayOrderNumber: true,
        kind: true,
        status: true,
        customerName: true,
        totalCents: true,
        cashTipCents: true,
        cashReceivedCents: true,
        changeOwedCents: true,
        changeSettledAt: true,
        voidReason: true,
        payments: {
          orderBy: [{ method: 'asc' }],
          select: { method: true, amountCents: true },
        },
      },
    });
    process.stdout.write(JSON.stringify(sales));
  `);
}
