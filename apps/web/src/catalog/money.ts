export function parsePesosToCents(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) {
    return null;
  }

  const pesos = Number(match[1]);
  const decimal = (match[2] ?? '').padEnd(2, '0');
  const centavos = decimal.length === 0 ? 0 : Number(decimal);
  const result = pesos * 100 + centavos;
  return Number.isSafeInteger(result) ? result : null;
}

export function formatCentsAsPesosInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const decimal = String(cents % 100).padStart(2, '0');
  return `${whole}.${decimal}`;
}

export function formatPeso(cents: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(cents / 100);
}
