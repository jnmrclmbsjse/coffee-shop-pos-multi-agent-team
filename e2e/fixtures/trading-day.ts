import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

export interface TradingDayFixture {
  tradingDay: {
    id: string;
    locationId: string | null;
    businessDate: string;
    status: 'OPEN' | 'CLOSED';
    openedAt: string;
    closedAt: string | null;
    openingFloatCents: number;
    openedByStaffMemberId: string;
    closedByStaffMemberId: string | null;
  };
  sales: Array<{
    id: string;
    clientGeneratedId: string;
    locationId: string | null;
    kind: 'PURCHASE' | 'VOID';
    correctsSaleId: string | null;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    cashTipCents: number;
    recordedAt: string;
    payments: Array<{
      id: string;
      method: 'CASH' | 'ONLINE';
      amountCents: number;
    }>;
    lines: Array<{
      id: string;
      productVariantId: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
      productNameSnapshot: string;
      variantNameSnapshot: string;
    }>;
  }>;
  cashCounts: Array<{
    id: string;
    countedCents: number;
    countedAt: string;
    countedByStaffMemberId: string;
  }>;
  cashExpenses: Array<{
    id: string;
    amountCents: number;
    description: string;
    recordedAt: string;
  }>;
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
  const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env);
  if (!match) throw new Error('DATABASE_URL not found in environment or .env');

  return match[1];
}

/**
 * Seed reporting fixtures through the API package's generated Prisma client.
 *
 * Referenced location, staff-member, and product-variant rows must already
 * exist. Every database-required field is explicit so schema additions fail
 * here at compile/review time instead of producing incomplete QA fixtures.
 */
export function seedTradingDayFixture(fixture: TradingDayFixture): void {
  const serializedFixture = JSON.stringify(fixture);
  const script = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const fixture = ${serializedFixture};

    (async () => {
      await prisma.$transaction(async (tx) => {
        await tx.tradingDay.create({
          data: {
            id: fixture.tradingDay.id,
            locationId: fixture.tradingDay.locationId,
            businessDate: new Date(fixture.tradingDay.businessDate),
            status: fixture.tradingDay.status,
            openedAt: new Date(fixture.tradingDay.openedAt),
            closedAt: fixture.tradingDay.closedAt
              ? new Date(fixture.tradingDay.closedAt)
              : null,
            openingFloatCents: fixture.tradingDay.openingFloatCents,
            openedByStaffMemberId: fixture.tradingDay.openedByStaffMemberId,
            closedByStaffMemberId: fixture.tradingDay.closedByStaffMemberId,
          },
        });

        for (const sale of fixture.sales) {
          await tx.sale.create({
            data: {
              id: sale.id,
              clientGeneratedId: sale.clientGeneratedId,
              locationId: sale.locationId,
              tradingDayId: fixture.tradingDay.id,
              kind: sale.kind,
              correctsSaleId: sale.correctsSaleId,
              subtotalCents: sale.subtotalCents,
              taxCents: sale.taxCents,
              totalCents: sale.totalCents,
              cashTipCents: sale.cashTipCents,
              recordedAt: new Date(sale.recordedAt),
              payments: {
                create: sale.payments.map((payment) => ({
                  id: payment.id,
                  method: payment.method,
                  amountCents: payment.amountCents,
                })),
              },
              lines: {
                create: sale.lines.map((line) => ({
                  id: line.id,
                  productVariantId: line.productVariantId,
                  quantity: line.quantity,
                  unitPriceCents: line.unitPriceCents,
                  lineTotalCents: line.lineTotalCents,
                  productNameSnapshot: line.productNameSnapshot,
                  variantNameSnapshot: line.variantNameSnapshot,
                })),
              },
            },
          });
        }

        for (const count of fixture.cashCounts) {
          await tx.cashCount.create({
            data: {
              id: count.id,
              tradingDayId: fixture.tradingDay.id,
              countedCents: count.countedCents,
              countedAt: new Date(count.countedAt),
              countedByStaffMemberId: count.countedByStaffMemberId,
            },
          });
        }

        for (const expense of fixture.cashExpenses) {
          await tx.cashExpense.create({
            data: {
              id: expense.id,
              tradingDayId: fixture.tradingDay.id,
              amountCents: expense.amountCents,
              description: expense.description,
              recordedAt: new Date(expense.recordedAt),
            },
          });
        }
      });

      await prisma.$disconnect();
    })().catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
  `;

  execFileSync('node', ['-e', script], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdio: 'pipe',
  });
}
