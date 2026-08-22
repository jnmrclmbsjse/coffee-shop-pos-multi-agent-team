import { cents, type MoneyCents } from '@coffee-shop/shared';

interface AmountResult {
  cents?: MoneyCents;
  error?: string;
}

const MAX_AMOUNT_CENTS = 2_147_483_647;

function parseCurrency(value: string, label: string): AmountResult {
  const trimmed = value.trim();
  if (trimmed.startsWith('-')) return { error: `${label} cannot be negative.` };
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { error: `${label} must be a number.` };
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > 2) return { error: `${label} cannot have more than 2 decimal places.` };
  const centavos = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (centavos > BigInt(MAX_AMOUNT_CENTS)) return { error: `${label} is too large.` };
  return { cents: cents(Number(centavos)) };
}

export function currencyToCents(value: string, label = 'Amount'): AmountResult {
  if (!value.trim()) return { error: `Enter a ${label.toLowerCase()} amount. Zero is allowed.` };
  return parseCurrency(value, label);
}

export function adjustmentAmountToCents(value: string): AmountResult {
  if (!value.trim()) return { error: 'Enter an amount.' };
  const result = parseCurrency(value, 'Amount');
  if (result.cents === cents(0)) return { error: 'Amount must be at least ₱0.01.' };
  return result;
}

export function amountForInput(value: MoneyCents): string {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
