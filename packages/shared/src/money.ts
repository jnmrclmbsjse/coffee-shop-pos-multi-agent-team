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
  cashExpenseCents: readonly MoneyCents[];
  latestCountedCents: MoneyCents | null;
}

export interface CashReconciliation {
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  grossSalesCents: MoneyCents;
  tipsCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  expectedCashCents: MoneyCents;
  actualCashCents: MoneyCents | null;
  varianceCents: MoneyCents | null;
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

function sumMoney(values: readonly MoneyCents[]): MoneyCents {
  return addMoney(...values);
}

/**
 * Apply ADR 0004's binding trading-day cash arithmetic.
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
  const cashExpensesCents = sumMoney(input.cashExpenseCents);
  const expectedCashCents = addMoney(
    input.openingFloatCents,
    cashSalesCents,
    tipsCents,
    cents(-cashExpensesCents),
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
    cashExpensesCents,
    expectedCashCents,
    actualCashCents,
    varianceCents,
  };
}
