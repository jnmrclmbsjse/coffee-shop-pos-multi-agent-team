import { BadRequestException, Injectable } from '@nestjs/common';
import {
  addMoney,
  calculateCashReconciliation,
  cents,
} from '@coffee-shop/shared';
import type {
  DailyReconciliation,
  MoneyCents,
  ProductSales,
  ReportingDashboard,
  SalesRangeReport,
} from '@coffee-shop/shared';
import { Prisma, TradingDayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DatabaseInteger = bigint | number;

interface DailyAggregateRow {
  id: string;
  businessDate: Date;
  status: TradingDayStatus;
  openingFloatCents: number;
  cashSalesCents: DatabaseInteger;
  onlineSalesCents: DatabaseInteger;
  tipsCents: DatabaseInteger;
  cashExpensesCents: DatabaseInteger;
  latestCountedCents: number | null;
  orderCount: DatabaseInteger;
}

interface ProductAggregateRow {
  productId: string;
  productName: string;
  quantitySold: DatabaseInteger;
  revenueCents: DatabaseInteger;
}

interface SummaryDayRow {
  id: string;
  businessDate: Date;
}

interface DailyReadModel extends DailyReconciliation {
  id: string;
  orderCount: number;
}

const ISO_DATE_LENGTH = 10;
const SHOP_TIME_ZONE = 'Asia/Manila';

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<ReportingDashboard> {
    const to = shopDate(new Date());
    const from = shiftIsoDate(to, -13);
    const [days, topProducts, summaryDay] = await Promise.all([
      this.loadDailyReadModel(from, to),
      this.loadProductSales(from, to, 5),
      this.loadSummaryDay(),
    ]);

    let summary: ReportingDashboard['summary'] = null;
    if (summaryDay) {
      const summaryRows = await this.loadDailyReadModel(
        toIsoDate(summaryDay.businessDate),
        toIsoDate(summaryDay.businessDate),
      );
      const day = summaryRows.find((row) => row.id === summaryDay.id);
      if (day) {
        summary = {
          date: day.date,
          status: day.status,
          orderCount: day.orderCount,
          grossSalesCents: day.grossSalesCents,
          cashSalesCents: day.cashSalesCents,
          onlineSalesCents: day.onlineSalesCents,
          averageOrderValueCents: averageCents(
            day.grossSalesCents,
            day.orderCount,
          ),
          cashTipsCents: day.tipsCents,
        };
      }
    }

    return {
      summary,
      salesTrend: days.map((day) => ({
        date: day.date,
        cashSalesCents: day.cashSalesCents,
        onlineSalesCents: day.onlineSalesCents,
      })),
      topProducts,
    };
  }

  async getReport(from: string, to: string): Promise<SalesRangeReport> {
    assertValidRange(from, to);
    const [days, topProducts] = await Promise.all([
      this.loadDailyReadModel(from, to),
      this.loadProductSales(from, to),
    ]);

    return {
      from,
      to,
      totals: {
        grossSalesCents: addMoney(
          ...days.map((day) => day.grossSalesCents),
        ),
        cashSalesCents: addMoney(
          ...days.map((day) => day.cashSalesCents),
        ),
        onlineSalesCents: addMoney(
          ...days.map((day) => day.onlineSalesCents),
        ),
        tipsCents: addMoney(...days.map((day) => day.tipsCents)),
      },
      dailyReconciliation: days.map((day) => ({
        date: day.date,
        status: day.status,
        cashSalesCents: day.cashSalesCents,
        onlineSalesCents: day.onlineSalesCents,
        grossSalesCents: day.grossSalesCents,
        tipsCents: day.tipsCents,
        cashExpensesCents: day.cashExpensesCents,
        expectedCashCents: day.expectedCashCents,
        actualCashCents: day.actualCashCents,
        varianceCents: day.varianceCents,
      })),
      topProducts,
    };
  }

  toCsv(report: SalesRangeReport): string {
    const header = [
      'Date',
      'Status',
      'Cash sales',
      'Online sales',
      'Gross',
      'Tips',
      'Cash expenses',
      'Expected cash',
      'Actual cash',
      'Variance',
    ].join(',');
    const rows = report.dailyReconciliation.map((day) =>
      [
        day.date,
        day.status,
        formatCsvMoney(day.cashSalesCents),
        formatCsvMoney(day.onlineSalesCents),
        formatCsvMoney(day.grossSalesCents),
        formatCsvMoney(day.tipsCents),
        formatCsvMoney(day.cashExpensesCents),
        formatCsvMoney(day.expectedCashCents),
        formatNullableCsvMoney(day.actualCashCents),
        formatNullableCsvMoney(day.varianceCents),
      ].join(','),
    );

    return [header, ...rows].join('\r\n') + '\r\n';
  }

  private async loadSummaryDay(): Promise<SummaryDayRow | null> {
    const rows = await this.prisma.$queryRaw<SummaryDayRow[]>(Prisma.sql`
      SELECT id, business_date AS "businessDate"
      FROM trading_days
      ORDER BY
        CASE WHEN status = 'OPEN' THEN 0 ELSE 1 END,
        business_date DESC,
        opened_at DESC,
        id ASC
      LIMIT 1
    `);

    return rows[0] ?? null;
  }

  private async loadDailyReadModel(
    from: string,
    to: string,
  ): Promise<DailyReadModel[]> {
    const rows = await this.prisma.$queryRaw<DailyAggregateRow[]>(Prisma.sql`
      WITH selected_days AS (
        SELECT *
        FROM trading_days
        WHERE business_date BETWEEN ${from}::date AND ${to}::date
      ),
      payment_totals AS (
        SELECT
          sale.trading_day_id,
          COALESCE(
            SUM(payment.amount_cents) FILTER (WHERE payment.method = 'CASH'),
            0
          ) AS cash_sales_cents,
          COALESCE(
            SUM(payment.amount_cents) FILTER (WHERE payment.method = 'ONLINE'),
            0
          ) AS online_sales_cents
        FROM sales AS sale
        INNER JOIN selected_days AS selected_day
          ON selected_day.id = sale.trading_day_id
        LEFT JOIN sale_payments AS payment ON payment.sale_id = sale.id
        GROUP BY sale.trading_day_id
      ),
      sale_totals AS (
        SELECT
          trading_day_id,
          COALESCE(SUM(cash_tip_cents), 0) AS tips_cents,
          COUNT(*) FILTER (WHERE kind = 'PURCHASE') AS order_count
        FROM sales AS sale
        INNER JOIN selected_days AS selected_day
          ON selected_day.id = sale.trading_day_id
        GROUP BY sale.trading_day_id
      ),
      expense_totals AS (
        SELECT
          trading_day_id,
          COALESCE(SUM(amount_cents), 0) AS cash_expenses_cents
        FROM cash_expenses AS expense
        INNER JOIN selected_days AS selected_day
          ON selected_day.id = expense.trading_day_id
        GROUP BY expense.trading_day_id
      )
      SELECT
        day.id,
        day.business_date AS "businessDate",
        day.status,
        day.opening_float_cents AS "openingFloatCents",
        COALESCE(payment.cash_sales_cents, 0) AS "cashSalesCents",
        COALESCE(payment.online_sales_cents, 0) AS "onlineSalesCents",
        COALESCE(sale.tips_cents, 0) AS "tipsCents",
        COALESCE(expense.cash_expenses_cents, 0) AS "cashExpensesCents",
        latest_count.counted_cents AS "latestCountedCents",
        COALESCE(sale.order_count, 0) AS "orderCount"
      FROM selected_days AS day
      LEFT JOIN payment_totals AS payment
        ON payment.trading_day_id = day.id
      LEFT JOIN sale_totals AS sale
        ON sale.trading_day_id = day.id
      LEFT JOIN expense_totals AS expense
        ON expense.trading_day_id = day.id
      LEFT JOIN LATERAL (
        SELECT counted_cents
        FROM cash_counts
        WHERE trading_day_id = day.id
        ORDER BY counted_at DESC, id DESC
        LIMIT 1
      ) AS latest_count ON TRUE
      ORDER BY day.business_date ASC, day.opened_at ASC, day.id ASC
    `);

    return rows.map((row) => {
      const reconciliation = calculateCashReconciliation({
        status: row.status,
        openingFloatCents: cents(row.openingFloatCents),
        payments: [
          {
            method: 'CASH',
            amountCents: databaseCents(row.cashSalesCents),
          },
          {
            method: 'ONLINE',
            amountCents: databaseCents(row.onlineSalesCents),
          },
        ],
        cashTipCents: [databaseCents(row.tipsCents)],
        cashExpenseCents: [databaseCents(row.cashExpensesCents)],
        latestCountedCents:
          row.latestCountedCents === null
            ? null
            : cents(row.latestCountedCents),
      });

      return {
        id: row.id,
        date: toIsoDate(row.businessDate),
        status: row.status.toLowerCase() as 'open' | 'closed',
        orderCount: databaseNumber(row.orderCount),
        ...reconciliation,
      };
    });
  }

  private async loadProductSales(
    from: string,
    to: string,
    limit?: number,
  ): Promise<ProductSales[]> {
    const limitSql =
      limit === undefined ? Prisma.empty : Prisma.sql`LIMIT ${limit}`;
    const rows = await this.prisma.$queryRaw<ProductAggregateRow[]>(Prisma.sql`
      SELECT
        product.id AS "productId",
        product.name AS "productName",
        SUM(line.quantity) AS "quantitySold",
        SUM(line.line_total_cents) AS "revenueCents"
      FROM sale_lines AS line
      INNER JOIN sales AS sale ON sale.id = line.sale_id
      INNER JOIN trading_days AS day ON day.id = sale.trading_day_id
      INNER JOIN product_variants AS variant
        ON variant.id = line.product_variant_id
      INNER JOIN products AS product ON product.id = variant.product_id
      WHERE day.business_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY product.id, product.name
      HAVING SUM(line.quantity) <> 0 OR SUM(line.line_total_cents) <> 0
      ORDER BY
        SUM(line.line_total_cents) DESC,
        product.name ASC,
        product.id ASC
      ${limitSql}
    `);

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      quantitySold: databaseNumber(row.quantitySold),
      revenueCents: databaseCents(row.revenueCents),
    }));
  }
}

export function assertValidRange(from: string, to: string): void {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new BadRequestException(
      'from and to must be valid dates in YYYY-MM-DD format',
    );
  }
  if (from > to) {
    throw new BadRequestException('from must be on or before to');
  }
}

export function averageCents(
  grossSalesCents: MoneyCents,
  orderCount: number,
): MoneyCents {
  if (!Number.isSafeInteger(orderCount) || orderCount < 0) {
    throw new TypeError('Order count must be a non-negative safe integer');
  }
  if (orderCount === 0) return cents(0);

  const quotient = Math.trunc(grossSalesCents / orderCount);
  const remainder = grossSalesCents % orderCount;
  const doubledRemainder = Math.abs(remainder) * 2;
  if (doubledRemainder < orderCount) return cents(quotient);
  if (doubledRemainder === orderCount && remainder < 0) {
    return cents(quotient);
  }

  return cents(quotient + Math.sign(remainder));
}

export function formatCsvMoney(value: MoneyCents): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const pesos = Math.trunc(absolute / 100);
  const centavos = absolute % 100;
  return `${sign}${pesos}.${centavos.toString().padStart(2, '0')}`;
}

function formatNullableCsvMoney(value: MoneyCents | null): string {
  return value === null ? '' : formatCsvMoney(value);
}

function databaseNumber(value: DatabaseInteger): number {
  const converted = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(converted)) {
    throw new RangeError('Reporting aggregate exceeds the safe integer range');
  }
  return converted;
}

function databaseCents(value: DatabaseInteger): MoneyCents {
  return cents(databaseNumber(value));
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, ISO_DATE_LENGTH) === value
  );
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, ISO_DATE_LENGTH);
}

function shopDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}
