import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Seeding support for the owner-reporting e2e suite (story #80, QA task #87).
 *
 * The capture workflows that would normally create trading days, tender rows,
 * tips, cash counts and cash expenses are explicitly out of scope for #80
 * (ADR 0004 §6), so these tests seed the database directly through the API
 * package's generated Prisma client — the same mechanism `trading-day.ts`
 * already uses.
 *
 * Reporting reads the whole trading-day table with no tenant or run filter, so
 * "only my rows exist" is the only way to make the assertions deterministic.
 * `resetTradingDays()` therefore clears every trading day, sale, payment, line,
 * cash count and cash expense before each seeded scenario. That is safe in v1:
 * nothing outside this suite writes those tables yet (there is no capture UI),
 * and the catalog/inventory/staff rows other specs rely on are left untouched.
 */

const REPO_ROOT = resolve(__dirname, '../..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
  const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env);
  if (!match) throw new Error('DATABASE_URL not found in environment or .env');

  return match[1];
}

/**
 * Run a script against the API package's Prisma client. `apps/api` is the cwd
 * because `@prisma/client` is not hoisted to the repo root. Whatever the script
 * writes to stdout is returned verbatim.
 */
function runPrisma(body: string): string {
  const script = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      ${body}
      await prisma.$disconnect();
    })().catch(async (error) => {
      console.error(error);
      try { await prisma.$disconnect(); } catch {}
      process.exit(1);
    });
  `;

  return execFileSync('node', ['-e', script], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdio: 'pipe',
  })
    .toString()
    .trim();
}

// ---- shop-date helpers ------------------------------------------------------

/** The current shop date (Asia/Manila, per #80) as `YYYY-MM-DD`. */
export function shopToday(now = new Date()): string {
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

/** Shift an ISO date by whole calendar days. */
export function isoShift(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

/** Render an ISO date the way the reporting UI's short format does. */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** Render an ISO date the way the dashboard's long business-date label does. */
export function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

// ---- reset ------------------------------------------------------------------

/**
 * Remove every trading day and every record that hangs off one. Sales are
 * deleted newest-correction-first because `Sale.correctsSaleId` is
 * `onDelete: Restrict`.
 */
export function resetTradingDays(): void {
  runPrisma(`
    await prisma.$executeRawUnsafe('DELETE FROM sale_payments');
    await prisma.$executeRawUnsafe('DELETE FROM sale_lines');
    await prisma.$executeRawUnsafe('DELETE FROM sales WHERE corrects_sale_id IS NOT NULL');
    await prisma.$executeRawUnsafe('DELETE FROM sales');
    await prisma.$executeRawUnsafe('DELETE FROM cash_counts');
    await prisma.$executeRawUnsafe('DELETE FROM cash_expenses');
    await prisma.$executeRawUnsafe('DELETE FROM trading_days');
  `);
}

// ---- reference rows ---------------------------------------------------------

/**
 * A staff member id to attribute opens, closes and counts to. Reuses one if the
 * database already has staff (the dev database persists between runs);
 * otherwise creates one, so the suite also works against a freshly seeded DB.
 */
export function ensureStaffMemberId(): string {
  return runPrisma(`
    const existing = await prisma.staffMember.findFirst({ select: { id: true } });
    const id = existing
      ? existing.id
      : (await prisma.staffMember.create({
          data: { displayName: 'QA Reporting Staff ${Date.now()}' },
        })).id;
    process.stdout.write(id);
  `);
}

export interface SeededVariant {
  productName: string;
  variantId: string;
  variantName: string;
}

/**
 * Create the base products the reporting assertions rank and combine. `Alpha`
 * deliberately gets two variants so "all variants of a base product are
 * combined into one row" is actually exercised.
 */
export function seedReportingCatalog(tag: string): Record<string, SeededVariant> {
  const names = {
    alpha: `QA Alpha ${tag}`,
    beta: `QA Beta ${tag}`,
    gamma: `QA Gamma ${tag}`,
    delta: `QA Delta ${tag}`,
    epsilon: `QA Epsilon ${tag}`,
    zeta: `QA Zeta ${tag}`,
  };

  const raw = runPrisma(`
    const names = ${JSON.stringify(names)};
    const category = await prisma.category.create({
      data: { name: 'QA Reporting ${tag}', sortWeight: 990000, active: true },
    });
    const out = {};
    let sku = 0;
    for (const [key, name] of Object.entries(names)) {
      sku += 1;
      const product = await prisma.product.create({
        data: { sku: 'E2E-RPT-${tag}-' + sku, name, categoryId: category.id },
      });
      const variantNames = key === 'alpha' ? ['Small', 'Large'] : ['Regular'];
      let weight = 0;
      for (const variantName of variantNames) {
        weight += 10;
        const variant = await prisma.productVariant.create({
          data: {
            productId: product.id,
            name: variantName,
            priceCents: 10000,
            sortWeight: weight,
          },
        });
        out[key + (variantNames.length > 1 ? variantName : '')] = {
          productName: name,
          variantId: variant.id,
          variantName,
        };
      }
    }
    process.stdout.write(JSON.stringify(out));
  `);

  return JSON.parse(raw) as Record<string, SeededVariant>;
}

// ---- trading days -----------------------------------------------------------

export interface SeedLine {
  variant: SeededVariant;
  quantity: number;
  unitPriceCents: number;
  lineGrossCents?: number;
  discountKind?: 'NONE' | 'SENIOR';
  discountCents?: number;
  lineTotalCents: number;
}

export interface SeedSale {
  id?: string;
  kind?: 'PURCHASE' | 'VOID';
  correctsSaleId?: string | null;
  status?: 'PARKED' | 'COMPLETED';
  customerName?: string | null;
  serviceType?: 'DINE_IN' | 'TAKE_OUT';
  discountCents?: number;
  cashCents?: number;
  onlineCents?: number;
  cashTipCents?: number;
  cashReceivedCents?: number | null;
  changeOwedCents?: number;
  changeSettledAt?: string | null;
  completedAt?: string | null;
  voidReason?: string | null;
  lines?: SeedLine[];
}

export interface SeedTradingDay {
  id?: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  openingFloatCents: number;
  sales?: SeedSale[];
  /** Ordered oldest first; the reporting read model uses the latest. */
  cashCounts?: number[];
  cashExpenses?: number[];
}

/**
 * Insert one trading day with its sales, tender rows, lines, cash counts and
 * cash expenses. Returns the ids of the created sales, keyed by their index, so
 * a later day can record a correction against an earlier day's sale.
 */
export function seedTradingDay(
  day: SeedTradingDay,
  staffMemberId: string,
): { id: string; saleIds: string[] } {
  const id = day.id ?? randomUUID();
  const sales = (day.sales ?? []).map((sale) => ({
    id: sale.id ?? randomUUID(),
    clientGeneratedId: randomUUID(),
    kind: sale.kind ?? 'PURCHASE',
    correctsSaleId: sale.correctsSaleId ?? null,
    status: sale.status ?? 'COMPLETED',
    customerName: sale.customerName ?? null,
    serviceType: sale.serviceType ?? 'TAKE_OUT',
    discountCents: sale.discountCents ?? 0,
    cashCents: sale.cashCents ?? 0,
    onlineCents: sale.onlineCents ?? 0,
    cashTipCents: sale.cashTipCents ?? 0,
    cashReceivedCents: sale.cashReceivedCents ?? null,
    changeOwedCents: sale.changeOwedCents ?? 0,
    changeSettledAt: sale.changeSettledAt ?? null,
    completedAt: sale.completedAt ?? null,
    voidReason: sale.voidReason ?? null,
    lines: sale.lines ?? [],
  }));

  const payload = {
    tradingDay: {
      id,
      businessDate: day.businessDate,
      status: day.status,
      openingFloatCents: day.openingFloatCents,
      staffMemberId,
      closed: day.status === 'CLOSED',
    },
    sales,
    cashCounts: day.cashCounts ?? [],
    cashExpenses: day.cashExpenses ?? [],
  };

  runPrisma(`
    const fixture = ${JSON.stringify(payload)};
    const businessDate = new Date(fixture.tradingDay.businessDate + 'T00:00:00.000Z');
    await prisma.tradingDay.create({
      data: {
        id: fixture.tradingDay.id,
        locationId: null,
        businessDate,
        status: fixture.tradingDay.status,
        openedAt: new Date(businessDate.getTime() + 1 * 3600000),
        closedAt: fixture.tradingDay.closed
          ? new Date(businessDate.getTime() + 12 * 3600000)
          : null,
        openingFloatCents: fixture.tradingDay.openingFloatCents,
        openedByStaffMemberId: fixture.tradingDay.staffMemberId,
        closedByStaffMemberId: fixture.tradingDay.closed
          ? fixture.tradingDay.staffMemberId
          : null,
      },
    });

    let offset = 0;
    for (const sale of fixture.sales) {
      offset += 1;
      const total = sale.cashCents + sale.onlineCents;
      const payments = [];
      if (sale.cashCents !== 0) {
        payments.push({ method: 'CASH', amountCents: sale.cashCents });
      }
      if (sale.onlineCents !== 0) {
        payments.push({ method: 'ONLINE', amountCents: sale.onlineCents });
      }
      await prisma.sale.create({
        data: {
          id: sale.id,
          clientGeneratedId: sale.clientGeneratedId,
          locationId: null,
          tradingDayId: fixture.tradingDay.id,
          kind: sale.kind,
          correctsSaleId: sale.correctsSaleId,
          dayOrderNumber: offset,
          status: sale.status,
          customerName: sale.customerName,
          serviceType: sale.serviceType,
          subtotalCents: total + sale.discountCents,
          discountCents: sale.discountCents,
          taxCents: 0,
          totalCents: total,
          cashTipCents: sale.cashTipCents,
          cashReceivedCents: sale.cashReceivedCents,
          changeOwedCents: sale.changeOwedCents,
          changeSettledAt: sale.changeSettledAt
            ? new Date(sale.changeSettledAt)
            : null,
          completedAt: sale.completedAt
            ? new Date(sale.completedAt)
            : (sale.status === 'COMPLETED' && sale.kind === 'PURCHASE'
              ? new Date(businessDate.getTime() + (2 + offset) * 3600000)
              : null),
          voidReason: sale.voidReason,
          recordedAt: new Date(businessDate.getTime() + (2 + offset) * 3600000),
          payments: { create: payments },
          lines: {
            create: sale.lines.map((line) => ({
              productVariantId: line.variant.variantId,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              lineGrossCents: line.lineGrossCents ?? line.lineTotalCents,
              discountKind: line.discountKind ?? 'NONE',
              discountCents: line.discountCents ?? 0,
              lineTotalCents: line.lineTotalCents,
              productNameSnapshot: line.variant.productName,
              variantNameSnapshot: line.variant.variantName,
            })),
          },
        },
      });
    }

    let countOffset = 0;
    for (const countedCents of fixture.cashCounts) {
      countOffset += 1;
      await prisma.cashCount.create({
        data: {
          tradingDayId: fixture.tradingDay.id,
          countedCents,
          countedAt: new Date(businessDate.getTime() + (12 + countOffset) * 3600000),
          countedByStaffMemberId: fixture.tradingDay.staffMemberId,
        },
      });
    }

    for (const amountCents of fixture.cashExpenses) {
      await prisma.cashExpense.create({
        data: {
          tradingDayId: fixture.tradingDay.id,
          amountCents,
          description: 'QA seeded expense',
          recordedAt: new Date(businessDate.getTime() + 5 * 3600000),
        },
      });
    }
  `);

  return { id, saleIds: sales.map((sale) => sale.id) };
}
