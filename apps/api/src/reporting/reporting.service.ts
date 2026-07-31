import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMoney,
  calculateCashReconciliation,
  cents,
  LineDiscountKind as SharedLineDiscountKind,
  ServiceType as SharedServiceType,
} from '@coffee-shop/shared';
import type {
  DailyReconciliation,
  MoneyCents,
  OrderHistoryDetail,
  OrderHistoryLine,
  OrderHistoryList,
  OrderHistoryListItem,
  OrderHistoryListQuery,
  OrderHistoryPaymentMethod,
  OrderHistoryStatus,
  ProductSales,
  ReportingDashboard,
  SalesRangeReport,
} from '@coffee-shop/shared';
import {
  OrderStatus as StoredOrderStatus,
  Prisma,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
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

interface OrderHistoryBaseRow {
  id: string;
  businessDay: Date;
  dayOrderNumber: number;
  storedStatus: StoredOrderStatus;
  customerName: string | null;
  serviceType: ServiceType;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  cashTipCents: number;
  cashReceivedCents: number | null;
  changeOwedCents: number;
  changeSettledAt: Date | null;
  completedAt: Date | null;
  hasCorrection: boolean;
  voidReason: string | null;
  hasCash: boolean;
  hasOnline: boolean;
}

interface OrderHistoryDetailRow extends OrderHistoryBaseRow {
  cashPortionCents: DatabaseInteger;
  onlinePortionCents: DatabaseInteger;
  lines: unknown;
}

type OrderHistoryListRow = OrderHistoryBaseRow;

interface CountRow {
  count: DatabaseInteger;
}

interface DatabaseOrderHistoryLine {
  id: string;
  productName: string;
  size: string;
  quantity: number;
  discountKind: 'NONE' | 'SENIOR';
  lineTotalCents: number;
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

  async getOrderHistory(
    query: OrderHistoryListQuery,
  ): Promise<OrderHistoryList> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const filters = orderHistoryFilters(query);
    const orderBy = orderHistoryOrderBy(
      query.sort ?? 'businessDay',
      query.direction ?? 'desc',
    );
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        ${orderHistoryCte()}
        SELECT COUNT(*) AS count
        FROM order_history
        ${filters}
      `),
      this.prisma.$queryRaw<OrderHistoryListRow[]>(Prisma.sql`
        ${orderHistoryCte()}
        SELECT
          id,
          business_day AS "businessDay",
          day_order_number AS "dayOrderNumber",
          stored_status AS "storedStatus",
          customer_name AS "customerName",
          service_type AS "serviceType",
          subtotal_cents AS "subtotalCents",
          discount_cents AS "discountCents",
          total_cents AS "totalCents",
          cash_tip_cents AS "cashTipCents",
          cash_received_cents AS "cashReceivedCents",
          change_owed_cents AS "changeOwedCents",
          change_settled_at AS "changeSettledAt",
          completed_at AS "completedAt",
          has_correction AS "hasCorrection",
          void_reason AS "voidReason",
          has_cash AS "hasCash",
          has_online AS "hasOnline"
        FROM order_history
        ${filters}
        ${orderBy}
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    ]);

    const totalItems = databaseNumber(countRows[0]?.count ?? 0);
    return {
      items: rows.map(toOrderHistoryListItem),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async getOrderHistoryDetail(id: string): Promise<OrderHistoryDetail> {
    const rows = await this.prisma.$queryRaw<OrderHistoryDetailRow[]>(
      Prisma.sql`
        ${orderHistoryCte()}
        SELECT
          history.id,
          history.business_day AS "businessDay",
          history.day_order_number AS "dayOrderNumber",
          history.stored_status AS "storedStatus",
          history.customer_name AS "customerName",
          history.service_type AS "serviceType",
          history.subtotal_cents AS "subtotalCents",
          history.discount_cents AS "discountCents",
          history.total_cents AS "totalCents",
          history.cash_tip_cents AS "cashTipCents",
          history.cash_received_cents AS "cashReceivedCents",
          history.change_owed_cents AS "changeOwedCents",
          history.change_settled_at AS "changeSettledAt",
          history.completed_at AS "completedAt",
          history.has_correction AS "hasCorrection",
          history.void_reason AS "voidReason",
          history.has_cash AS "hasCash",
          history.has_online AS "hasOnline",
          COALESCE(
            (
              SELECT payment.amount_cents
              FROM sale_payments AS payment
              WHERE payment.sale_id = history.id
                AND payment.method = 'CASH'
            ),
            0
          ) AS "cashPortionCents",
          COALESCE(
            (
              SELECT payment.amount_cents
              FROM sale_payments AS payment
              WHERE payment.sale_id = history.id
                AND payment.method = 'ONLINE'
            ),
            0
          ) AS "onlinePortionCents",
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', line.id,
                  'productName', line.product_name_snapshot,
                  'size', line.variant_name_snapshot,
                  'quantity', line.quantity,
                  'discountKind', line.discount_kind,
                  'lineTotalCents', line.line_total_cents
                )
                ORDER BY line.id ASC
              )
              FROM sale_lines AS line
              WHERE line.sale_id = history.id
            ),
            '[]'::jsonb
          ) AS lines
        FROM order_history AS history
        WHERE history.id = ${id}::uuid
        LIMIT 1
      `,
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Order not found');
    }

    return toOrderHistoryDetail(row);
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
        FROM cash_movements AS expense
        INNER JOIN selected_days AS selected_day
          ON selected_day.id = expense.trading_day_id
        WHERE expense.kind = 'EXPENSE'
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

function orderHistoryCte(): Prisma.Sql {
  return Prisma.sql`
    WITH order_history AS (
      SELECT
        sale.id,
        day.business_date AS business_day,
        sale.day_order_number,
        sale.status AS stored_status,
        sale.customer_name,
        sale.service_type,
        sale.subtotal_cents,
        sale.discount_cents,
        sale.total_cents,
        sale.cash_tip_cents,
        sale.cash_received_cents,
        sale.change_owed_cents,
        sale.change_settled_at,
        sale.completed_at,
        COALESCE(correction.has_correction, FALSE) AS has_correction,
        correction.void_reason,
        EXISTS (
          SELECT 1
          FROM sale_payments AS payment
          WHERE payment.sale_id = sale.id
            AND payment.method = 'CASH'
        ) AS has_cash,
        EXISTS (
          SELECT 1
          FROM sale_payments AS payment
          WHERE payment.sale_id = sale.id
            AND payment.method = 'ONLINE'
        ) AS has_online
      FROM sales AS sale
      INNER JOIN trading_days AS day ON day.id = sale.trading_day_id
      LEFT JOIN LATERAL (
        SELECT
          TRUE AS has_correction,
          correcting_sale.void_reason
        FROM sales AS correcting_sale
        WHERE correcting_sale.kind = 'VOID'
          AND correcting_sale.corrects_sale_id = sale.id
        ORDER BY correcting_sale.recorded_at DESC, correcting_sale.id DESC
        LIMIT 1
      ) AS correction ON TRUE
      WHERE sale.kind = 'PURCHASE'
    )
  `;
}

function orderHistoryFilters(
  query: OrderHistoryListQuery,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (query.status === 'Void') {
    conditions.push(Prisma.sql`has_correction`);
  } else if (query.status === 'Parked') {
    conditions.push(
      Prisma.sql`NOT has_correction AND stored_status = 'PARKED'`,
    );
  } else if (query.status === 'Completed') {
    conditions.push(
      Prisma.sql`NOT has_correction AND stored_status = 'COMPLETED'`,
    );
  }

  if (query.paymentMethod === 'Split') {
    conditions.push(Prisma.sql`has_cash AND has_online`);
  } else if (query.paymentMethod === 'Cash') {
    conditions.push(Prisma.sql`has_cash AND NOT has_online`);
  } else if (query.paymentMethod === 'Online') {
    conditions.push(Prisma.sql`has_online AND NOT has_cash`);
  }

  if (query.search) {
    conditions.push(
      Prisma.sql`customer_name ILIKE ${`%${query.search}%`}`,
    );
  }

  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

function orderHistoryOrderBy(
  sort: NonNullable<OrderHistoryListQuery['sort']>,
  direction: NonNullable<OrderHistoryListQuery['direction']>,
): Prisma.Sql {
  const sqlDirection =
    direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  let selectedSort: Prisma.Sql;

  switch (sort) {
    case 'orderNumber':
      selectedSort = Prisma.sql`
        business_day ${sqlDirection},
        day_order_number ${sqlDirection}
      `;
      break;
    case 'status':
      selectedSort = Prisma.sql`
        CASE
          WHEN has_correction THEN 3
          WHEN stored_status = 'PARKED' THEN 1
          ELSE 2
        END ${sqlDirection}
      `;
      break;
    case 'total':
      selectedSort = Prisma.sql`total_cents ${sqlDirection}`;
      break;
    case 'completedAt':
      selectedSort = Prisma.sql`
        CASE
          WHEN completed_at IS NULL THEN 1
          ELSE 0
        END ASC,
        completed_at ${sqlDirection}
      `;
      break;
    case 'businessDay':
    default:
      selectedSort = Prisma.sql`business_day ${sqlDirection}`;
      break;
  }

  return Prisma.sql`
    ORDER BY
      ${selectedSort},
      business_day DESC,
      day_order_number DESC,
      id ASC
  `;
}

export function deriveOrderHistoryStatus(
  storedStatus: StoredOrderStatus,
  hasCorrection: boolean,
): OrderHistoryStatus {
  if (hasCorrection) return 'Void';
  return storedStatus === StoredOrderStatus.PARKED
    ? 'Parked'
    : 'Completed';
}

export function deriveOrderHistoryPaymentMethod(
  hasCash: boolean,
  hasOnline: boolean,
): OrderHistoryPaymentMethod | null {
  if (hasCash && hasOnline) return 'Split';
  if (hasCash) return 'Cash';
  if (hasOnline) return 'Online';
  return null;
}

function toOrderHistoryListItem(
  row: OrderHistoryListRow,
): OrderHistoryListItem {
  const status = deriveOrderHistoryStatus(
    row.storedStatus,
    row.hasCorrection,
  );
  const isParked = status === 'Parked';

  return {
    id: row.id,
    businessDay: toIsoDate(row.businessDay),
    dayOrderNumber: row.dayOrderNumber,
    customerName: row.customerName,
    status,
    paymentMethod: deriveOrderHistoryPaymentMethod(
      row.hasCash,
      row.hasOnline,
    ),
    totalCents: cents(row.totalCents),
    tipCents: cents(row.cashTipCents),
    changeOwedCents: cents(row.changeOwedCents),
    changeSettled:
      isParked
        ? null
        : row.changeOwedCents === 0 || row.changeSettledAt !== null,
    completedAt: isParked ? null : toIsoTimestamp(row.completedAt),
  };
}

function toOrderHistoryDetail(
  row: OrderHistoryDetailRow,
): OrderHistoryDetail {
  const status = deriveOrderHistoryStatus(
    row.storedStatus,
    row.hasCorrection,
  );
  const isParked = status === 'Parked';

  return {
    id: row.id,
    businessDay: toIsoDate(row.businessDay),
    dayOrderNumber: row.dayOrderNumber,
    customerName: row.customerName,
    status,
    serviceType: SharedServiceType[row.serviceType],
    paymentMethod: deriveOrderHistoryPaymentMethod(
      row.hasCash,
      row.hasOnline,
    ),
    lines: parseOrderHistoryLines(row.lines),
    subtotalCents: cents(row.subtotalCents),
    totalDiscountCents: cents(row.discountCents),
    totalCents: cents(row.totalCents),
    cashPortionCents: isParked
      ? null
      : databaseCents(row.cashPortionCents),
    onlinePortionCents: isParked
      ? null
      : databaseCents(row.onlinePortionCents),
    tipCents: cents(row.cashTipCents),
    cashReceivedCents:
      isParked || row.cashReceivedCents === null
        ? null
        : cents(row.cashReceivedCents),
    changeOwedCents: cents(row.changeOwedCents),
    changeSettledAt: isParked
      ? null
      : toIsoTimestamp(row.changeSettledAt),
    completedAt: isParked ? null : toIsoTimestamp(row.completedAt),
    voidReason: status === 'Void' ? row.voidReason : null,
  };
}

function parseOrderHistoryLines(value: unknown): OrderHistoryLine[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Order history lines must be an array');
  }

  return value.map((item: unknown) => {
    if (!isDatabaseOrderHistoryLine(item)) {
      throw new TypeError('Order history line has an invalid shape');
    }
    return {
      id: item.id,
      productName: item.productName,
      size: item.size,
      quantity: item.quantity,
      discountKind: SharedLineDiscountKind[item.discountKind],
      lineTotalCents: cents(item.lineTotalCents),
    };
  });
}

function isDatabaseOrderHistoryLine(
  value: unknown,
): value is DatabaseOrderHistoryLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === 'string' &&
    typeof line.productName === 'string' &&
    typeof line.size === 'string' &&
    Number.isSafeInteger(line.quantity) &&
    (line.discountKind === 'NONE' ||
      line.discountKind === 'SENIOR') &&
    Number.isSafeInteger(line.lineTotalCents)
  );
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

function toIsoTimestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
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
