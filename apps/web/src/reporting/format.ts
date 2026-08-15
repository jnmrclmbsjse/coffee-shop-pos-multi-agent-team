import type { RestockStatus, StockLevel } from '@coffee-shop/shared';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
});

const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  EMPTY: 'Empty',
  LOW: 'Low',
  QUARTER: 'Quarter',
  ONE_THIRD: 'One-third',
  HALF: 'Half',
  TWO_THIRDS: 'Two-thirds',
  THREE_QUARTERS: 'Three-quarters',
  FULL: 'Full',
};

const RESTOCK_STATUS_LABELS: Record<RestockStatus, string> = {
  URGENT: 'Urgent',
  LOW: 'Low',
  BELOW_PAR: 'Below par',
  ENOUGH: 'Enough',
};

export function formatMoney(cents: number): string {
  const absoluteCents = Math.abs(cents);
  const pesos = Math.trunc(absoluteCents / 100);
  const centavos = String(absoluteCents % 100).padStart(2, '0');
  const groupedPesos = new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 0,
  }).format(pesos);
  return `₱${cents < 0 ? '-' : ''}${groupedPesos}.${centavos}`;
}

export function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 2,
  }).format(quantity);
}

export function formatCount(quantity: number): string {
  return COUNT_FORMATTER.format(quantity);
}

export function formatOptionalCount(quantity: number | null): string {
  return quantity === null ? 'Unavailable' : formatCount(quantity);
}

export function formatSignedCount(quantity: number): string {
  return `${quantity > 0 ? '+' : ''}${formatCount(quantity)}`;
}

export function formatStockLevel(level: StockLevel | null): string {
  return level === null ? 'Unavailable' : STOCK_LEVEL_LABELS[level];
}

export function formatRestockStatus(status: RestockStatus): string {
  return RESTOCK_STATUS_LABELS[status];
}

export function formatLocation(locationId: string | null): string {
  return locationId === null ? 'UCM Coffee Studio' : `Location ${locationId}`;
}

export function formatSubmissionTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(date);
}

export function formatBusinessDate(
  isoDate: string,
  style: 'long' | 'short' = 'long',
): string {
  if (!ISO_DATE_PATTERN.test(isoDate)) {
    return isoDate;
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
}

export function shopDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function reportingDefaultRange(now = new Date()): {
  from: string;
  to: string;
} {
  const to = shopDate(now);
  const [year, month, day] = to.split('-').map(Number);
  const fromDate = new Date(Date.UTC(year!, month! - 1, day! - 13));
  return {
    from: [
      fromDate.getUTCFullYear(),
      String(fromDate.getUTCMonth() + 1).padStart(2, '0'),
      String(fromDate.getUTCDate()).padStart(2, '0'),
    ].join('-'),
    to,
  };
}

export function rangeError(from: string, to: string): string {
  if (!from || !to) {
    return 'Choose both a From date and a To date.';
  }
  if (from > to) {
    return 'From date must be on or before To date.';
  }
  return '';
}
