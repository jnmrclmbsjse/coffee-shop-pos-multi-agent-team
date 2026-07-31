import type { LineDiscountKind } from './domain.js';

/** Integer minor units (cents). Monetary values must never use floating point. */
export type MoneyCents = number & { readonly __brand: 'MoneyCents' };

export interface TenderAmount {
  method: 'CASH' | 'ONLINE';
  amountCents: MoneyCents;
}

export interface CashReconciliationInput {
  status: 'OPEN' | 'CLOSED';
  openingFloatCents: MoneyCents;
  payments: readonly TenderAmount[];
  cashTipCents: readonly MoneyCents[];
  cashInCents: MoneyCents;
  cashOutCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  outstandingChangeCents: MoneyCents;
  latestCountedCents: MoneyCents | null;
}

export interface CashReconciliation {
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  grossSalesCents: MoneyCents;
  tipsCents: MoneyCents;
  cashInCents: MoneyCents;
  cashOutCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  outstandingChangeCents: MoneyCents;
  expectedCashCents: MoneyCents;
  actualCashCents: MoneyCents | null;
  varianceCents: MoneyCents | null;
}

export interface LineAmounts {
  lineGrossCents: MoneyCents;
  discountCents: MoneyCents;
  lineTotalCents: MoneyCents;
}

export function cents(value: number): MoneyCents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Money must be a safe integer number of cents');
  }

  return value as MoneyCents;
}

export function addMoney(...values: readonly MoneyCents[]): MoneyCents {
  return cents(values.reduce((total, value) => total + value, 0));
}

export function multiplyMoney(value: MoneyCents, quantity: number): MoneyCents {
  if (!Number.isSafeInteger(quantity)) {
    throw new TypeError('Quantity must be a safe integer');
  }

  return cents(value * quantity);
}

/**
 * Apply ADR 0005's binding per-line Senior discount arithmetic.
 *
 * Twenty percent reduces to division by five. The quotient/remainder form
 * keeps the calculation in safe integers and introduces no floating-point
 * money.
 */
export function calculateLineAmounts(
  unitPriceCents: MoneyCents,
  quantity: number,
  discountKind: LineDiscountKind,
): LineAmounts {
  const lineGrossCents = multiplyMoney(unitPriceCents, quantity);
  const absoluteGross = Math.abs(lineGrossCents);
  const roundedAbsoluteDiscount =
    Math.floor(absoluteGross / 5) + (absoluteGross % 5 >= 3 ? 1 : 0);
  const discountCents = cents(
    discountKind === 'SENIOR'
      ? Math.sign(lineGrossCents) * roundedAbsoluteDiscount
      : 0,
  );
  const lineTotalCents = addMoney(lineGrossCents, cents(-discountCents));

  return { lineGrossCents, discountCents, lineTotalCents };
}

/** Roll up a sale whose subtotal is the pre-discount line gross. */
export function calculateOrderTotal(
  subtotalCents: MoneyCents,
  discountCents: MoneyCents,
  taxCents: MoneyCents,
): MoneyCents {
  return addMoney(subtotalCents, cents(-discountCents), taxCents);
}

function sumMoney(values: readonly MoneyCents[]): MoneyCents {
  return addMoney(...values);
}

/**
 * Apply ADR 0006's binding trading-day cash arithmetic.
 *
 * Open days intentionally ignore any supplied count so actual cash and
 * variance remain null at the API boundary.
 */
export function calculateCashReconciliation(
  input: CashReconciliationInput,
): CashReconciliation {
  const cashSalesCents = sumMoney(
    input.payments
      .filter((payment) => payment.method === 'CASH')
      .map((payment) => payment.amountCents),
  );
  const onlineSalesCents = sumMoney(
    input.payments
      .filter((payment) => payment.method === 'ONLINE')
      .map((payment) => payment.amountCents),
  );
  const grossSalesCents = addMoney(cashSalesCents, onlineSalesCents);
  const tipsCents = sumMoney(input.cashTipCents);
  const expectedCashCents = addMoney(
    input.openingFloatCents,
    cashSalesCents,
    tipsCents,
    input.cashInCents,
    input.outstandingChangeCents,
    cents(-input.cashOutCents),
    cents(-input.cashExpensesCents),
  );
  const actualCashCents =
    input.status === 'OPEN' ? null : input.latestCountedCents;
  const varianceCents =
    actualCashCents === null
      ? null
      : addMoney(actualCashCents, cents(-expectedCashCents));

  return {
    cashSalesCents,
    onlineSalesCents,
    grossSalesCents,
    tipsCents,
    cashInCents: input.cashInCents,
    cashOutCents: input.cashOutCents,
    cashExpensesCents: input.cashExpensesCents,
    outstandingChangeCents: input.outstandingChangeCents,
    expectedCashCents,
    actualCashCents,
    varianceCents,
  };
}
