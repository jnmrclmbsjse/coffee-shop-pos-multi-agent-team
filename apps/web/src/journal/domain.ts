import { cents, type MoneyCents } from '@coffee-shop/shared';

export type CurrencyResult =
  | { cents: MoneyCents; error?: never }
  | { cents?: never; error: string };

export function currencyToCents(
  value: string,
  label: string,
  options: { allowZero: boolean; allowNegative?: boolean },
): CurrencyResult {
  const trimmed = value.trim();
  if (!trimmed) return { error: `Enter a ${label.toLowerCase()}.` };
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(trimmed)) {
    return { error: `${label} must be a valid amount with up to 2 decimal places.` };
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [pesos = '0', centavos = ''] = unsigned.split('.');
  const amount = Number(pesos) * 100 + Number(centavos.padEnd(2, '0'));
  const signedAmount = negative ? -amount : amount;

  if (!Number.isSafeInteger(signedAmount)) {
    return { error: `${label} is too large.` };
  }
  if (!options.allowNegative && signedAmount < 0) {
    return { error: `${label} cannot be negative.` };
  }
  if (!options.allowZero && signedAmount === 0) {
    return { error: `${label} must be greater than ₱0.00.` };
  }
  return { cents: cents(signedAmount) };
}

export function amountForInput(amountCents: number): string {
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
