import { randomUUID } from 'node:crypto';
import type { TradingDayFixture } from './trading-day';

export interface OrderHistoryFixtureInput {
  businessDate: string;
  openedByStaffMemberId: string;
  productVariantId: string;
  locationId?: string | null;
}

/**
 * Build realistic records for Order History API, web and e2e work.
 *
 * The fixture covers parked, completed, void, cash, online, split tender,
 * Senior discount, walk-in, outstanding change and settled change states.
 * Call `seedTradingDayFixture` with the returned value after creating the
 * referenced staff member and product variant.
 */
export function buildOrderHistoryFixture(
  input: OrderHistoryFixtureInput,
): TradingDayFixture {
  const dayStart = new Date(`${input.businessDate}T00:00:00.000Z`);
  const atHour = (hour: number) =>
    new Date(dayStart.getTime() + hour * 3_600_000).toISOString();
  const id = () => randomUUID();
  const originalVoidId = id();

  const line = (
    unitPriceCents: number,
    discountKind: 'NONE' | 'SENIOR' = 'NONE',
  ) => {
    // ADR 0005 §4 is authoritative; packages/shared/src/money.ts is canonical.
    const absoluteGross = Math.abs(unitPriceCents);
    const discountCents =
      discountKind === 'SENIOR'
        ? (Math.floor(absoluteGross / 5) +
            (absoluteGross % 5 >= 3 ? 1 : 0)) *
          Math.sign(unitPriceCents)
        : 0;

    return {
      id: id(),
      productVariantId: input.productVariantId,
      quantity: 1,
      unitPriceCents,
      lineGrossCents: unitPriceCents,
      discountKind,
      discountCents,
      lineTotalCents: unitPriceCents - discountCents,
      productNameSnapshot: 'Fixture Latte',
      variantNameSnapshot: 'Regular',
    };
  };

  const payment = (
    method: 'CASH' | 'ONLINE',
    amountCents: number,
  ) => ({ id: id(), method, amountCents });

  return {
    tradingDay: {
      id: id(),
      locationId: input.locationId ?? null,
      businessDate: input.businessDate,
      status: 'CLOSED',
      openedAt: atHour(1),
      closedAt: atHour(14),
      openingFloatCents: 10_000,
      openedByStaffMemberId: input.openedByStaffMemberId,
      closedByStaffMemberId: input.openedByStaffMemberId,
    },
    sales: [
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: null,
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 1,
        status: 'COMPLETED',
        customerName: null,
        serviceType: 'TAKE_OUT',
        subtotalCents: 15_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 15_000,
        cashTipCents: 0,
        cashReceivedCents: 20_000,
        changeOwedCents: 5_000,
        changeSettledAt: null,
        completedAt: atHour(2),
        voidReason: null,
        recordedAt: atHour(2),
        payments: [payment('CASH', 15_000)],
        lines: [line(15_000)],
      },
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 2,
        status: 'COMPLETED',
        customerName: 'Mina Santos',
        serviceType: 'DINE_IN',
        subtotalCents: 8_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 8_000,
        cashTipCents: 500,
        cashReceivedCents: 10_000,
        changeOwedCents: 2_000,
        changeSettledAt: atHour(4),
        completedAt: atHour(3),
        voidReason: null,
        recordedAt: atHour(3),
        payments: [payment('CASH', 8_000)],
        lines: [line(8_000)],
      },
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 3,
        status: 'PARKED',
        customerName: 'Parked Guest',
        serviceType: 'DINE_IN',
        subtotalCents: 12_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 12_000,
        cashTipCents: 0,
        cashReceivedCents: null,
        changeOwedCents: 0,
        changeSettledAt: null,
        completedAt: null,
        voidReason: null,
        recordedAt: atHour(5),
        payments: [],
        lines: [line(12_000)],
      },
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 4,
        status: 'COMPLETED',
        customerName: 'Split Tender',
        serviceType: 'TAKE_OUT',
        subtotalCents: 20_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 20_000,
        cashTipCents: 1_000,
        cashReceivedCents: 8_000,
        changeOwedCents: 0,
        changeSettledAt: null,
        completedAt: atHour(6),
        voidReason: null,
        recordedAt: atHour(6),
        payments: [payment('CASH', 8_000), payment('ONLINE', 12_000)],
        lines: [line(20_000)],
      },
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 5,
        status: 'COMPLETED',
        customerName: 'Senior Guest',
        serviceType: 'DINE_IN',
        subtotalCents: 15_000,
        discountCents: 3_000,
        taxCents: 0,
        totalCents: 12_000,
        cashTipCents: 0,
        cashReceivedCents: null,
        changeOwedCents: 0,
        changeSettledAt: null,
        completedAt: atHour(7),
        voidReason: null,
        recordedAt: atHour(7),
        payments: [payment('ONLINE', 12_000)],
        lines: [line(15_000, 'SENIOR')],
      },
      {
        id: originalVoidId,
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'PURCHASE',
        correctsSaleId: null,
        dayOrderNumber: 6,
        status: 'COMPLETED',
        customerName: 'Voided Guest',
        serviceType: 'TAKE_OUT',
        subtotalCents: 25_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 25_000,
        cashTipCents: 0,
        cashReceivedCents: 25_000,
        changeOwedCents: 0,
        changeSettledAt: null,
        completedAt: atHour(8),
        voidReason: null,
        recordedAt: atHour(8),
        payments: [payment('CASH', 25_000)],
        lines: [line(25_000)],
      },
      {
        id: id(),
        clientGeneratedId: id(),
        locationId: input.locationId ?? null,
        cashier: {
          staffMemberId: input.openedByStaffMemberId,
          nameSnapshot: 'Fixture Cashier',
        },
        kind: 'VOID',
        correctsSaleId: originalVoidId,
        dayOrderNumber: 7,
        status: 'COMPLETED',
        customerName: 'Voided Guest',
        serviceType: 'TAKE_OUT',
        subtotalCents: -25_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: -25_000,
        cashTipCents: 0,
        cashReceivedCents: null,
        changeOwedCents: 0,
        changeSettledAt: null,
        completedAt: null,
        voidReason: 'Customer changed their mind',
        recordedAt: atHour(9),
        payments: [payment('CASH', -25_000)],
        lines: [line(-25_000)],
      },
    ],
    cashCounts: [],
    cashExpenses: [],
  };
}
