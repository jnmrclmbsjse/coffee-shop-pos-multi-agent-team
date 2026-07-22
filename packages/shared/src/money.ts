/** Integer minor units (cents). Monetary values must never use floating point. */
export type MoneyCents = number & { readonly __brand: 'MoneyCents' };

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
