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

export const MAX_RENT_PERCENT_BASIS_POINTS = 10_000;

export type BasisPointsResult =
  | { basisPoints: number; error?: never }
  | { basisPoints?: never; error: string };

/**
 * Convert a typed percentage to the basis points the API takes. The conversion
 * happens at the edge on purpose: a float percent is never held in state and
 * never sent (ADR 0001 §1, ADR 0018 §4).
 */
export function percentToBasisPoints(value: string): BasisPointsResult {
  const trimmed = value.trim();
  if (!trimmed) return { error: 'Enter a rent percentage.' };
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) {
    return {
      error:
        'Rent percentage must be a number with up to 2 decimal places, and cannot be negative.',
    };
  }

  const [whole = '0', fraction = ''] = trimmed.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(basisPoints)) {
    return { error: 'Rent percentage is too large.' };
  }
  if (basisPoints > MAX_RENT_PERCENT_BASIS_POINTS) {
    return { error: 'Rent percentage cannot be more than 100%.' };
  }
  return { basisPoints };
}

/** Render basis points back into a percentage for the settings field. */
export function basisPointsForInput(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(Math.abs(basisPoints) % 100).padStart(2, '0');
  return fraction === '00'
    ? String(whole)
    : `${whole}.${fraction.replace(/0$/, '')}`;
}

export function formatPercent(basisPoints: number): string {
  return `${basisPointsForInput(basisPoints)}%`;
}
