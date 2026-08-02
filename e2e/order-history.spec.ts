import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ensureStaffMemberId,
  isoShift,
  longDate,
  resetTradingDays,
  runPrisma,
  seedReportingCatalog,
  shopToday,
  shortDate,
  type SeededVariant,
} from './fixtures/reporting-seed';
import {
  seedTradingDayFixture,
  type TradingDayFixture,
} from './fixtures/trading-day';

/**
 * End-to-end coverage for story #93 — "Find and review past and parked orders
 * in a read-only back-office history" (QA task #100).
 *
 * Everything runs through the real browser → web app → NestJS API →
 * PostgreSQL path, signed in as the seeded `admin` (ADMIN) user. Order capture
 * is deliberately not part of #93 (ADR 0004 §6, ADR 0005), so the order records
 * are seeded directly through the schema foundation #97 landed
 * (`fixtures/trading-day.ts`).
 *
 * Order History reads the whole sales table with no run filter, so the only way
 * to make row-for-row assertions deterministic is "only my rows exist": the
 * suite resets the trading-day tables and seeds exactly the 23 orders it
 * asserts on. That makes this file order-dependent — it runs serially, and the
 * scenario that empties the tables comes last.
 *
 * The Senior discount arithmetic and the derived status/payment rules are
 * re-implemented here from ADR 0005 rather than imported from
 * `packages/shared`, so the expectations are independent of the code under
 * test.
 *
 * All dates are derived from the current Asia/Manila shop date at run time, so
 * the suite is not pinned to the day it was written.
 */

test.describe.configure({ mode: 'serial' });

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';

const REPO_ROOT = resolve(__dirname, '..');

const TODAY = shopToday();
/** Oldest seeded day. Mirrors v1's Jul 20: #1, #2, #3 parked, #4 void. */
const DAY_A = isoShift(TODAY, -6);
/** The money/edge day: change owed, split tender, Senior, stray timestamps. */
const DAY_B = isoShift(TODAY, -4);
/** Twelve plain orders, so paging and page sizes have something to page. */
const DAY_C = isoShift(TODAY, -2);

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Every seeded order, visible in the list. Voids are counted once. */
const TOTAL_ORDERS = 23;

let variant: SeededVariant;
let staffMemberId: string;

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface LineSeed {
  unitPriceCents: number;
  quantity?: number;
  discountKind?: 'NONE' | 'SENIOR';
  productName?: string;
  size?: string;
}

interface OrderSeed {
  id?: string;
  dayOrderNumber: number;
  cashier?: {
    staffMemberId: string;
    nameSnapshot: string;
  } | null;
  kind?: 'PURCHASE' | 'VOID';
  correctsSaleId?: string | null;
  status?: 'PARKED' | 'COMPLETED';
  customerName?: string | null;
  serviceType?: 'DINE_IN' | 'TAKE_OUT';
  cashCents?: number;
  onlineCents?: number;
  tipCents?: number;
  cashReceivedCents?: number | null;
  changeOwedCents?: number;
  changeSettledAt?: string | null;
  completedAt?: string | null;
  voidReason?: string | null;
  lines: LineSeed[];
}

/** An instant on `isoDate`, expressed as whole hours from 00:00 UTC. */
function atHour(isoDate: string, hour: number): string {
  return new Date(
    new Date(`${isoDate}T00:00:00.000Z`).getTime() + hour * 3_600_000,
  ).toISOString();
}

/**
 * ADR 0005 §4's per-line Senior discount: 20 percent, rounded half-up, in
 * integer cents. Written out here (not imported) so the assertions do not
 * inherit a mistake from the implementation.
 */
function seniorDiscountCents(lineGrossCents: number): number {
  const gross = Math.abs(lineGrossCents);
  const fifth = gross / 5;
  const rounded = Math.floor(fifth + 0.5);
  return Math.sign(lineGrossCents) * rounded;
}

function buildDay(
  businessDate: string,
  orders: OrderSeed[],
): TradingDayFixture {
  return {
    tradingDay: {
      id: randomUUID(),
      locationId: null,
      businessDate,
      status: 'CLOSED',
      openedAt: atHour(businessDate, 1),
      closedAt: atHour(businessDate, 14),
      openingFloatCents: 100_000,
      openedByStaffMemberId: staffMemberId,
      closedByStaffMemberId: staffMemberId,
    },
    sales: orders.map((order) => {
      const lines = order.lines.map((line) => {
        const quantity = line.quantity ?? 1;
        const lineGrossCents = line.unitPriceCents * quantity;
        const discountCents =
          line.discountKind === 'SENIOR'
            ? seniorDiscountCents(lineGrossCents)
            : 0;
        return {
          id: randomUUID(),
          productVariantId: variant.variantId,
          quantity,
          unitPriceCents: line.unitPriceCents,
          lineGrossCents,
          discountKind: line.discountKind ?? ('NONE' as const),
          discountCents,
          lineTotalCents: lineGrossCents - discountCents,
          productNameSnapshot: line.productName ?? variant.productName,
          variantNameSnapshot: line.size ?? variant.variantName,
        };
      });

      const subtotalCents = lines.reduce(
        (total, line) => total + line.lineGrossCents,
        0,
      );
      const discountCents = lines.reduce(
        (total, line) => total + line.discountCents,
        0,
      );
      const totalCents = subtotalCents - discountCents;
      const cashCents = order.cashCents ?? 0;
      const onlineCents = order.onlineCents ?? 0;
      const status = order.status ?? 'COMPLETED';

      // A parked order has no payment rows at all (ADR 0005). Every other
      // order's tender must add up to its total, or the fixture is lying.
      if (status !== 'PARKED') {
        expect(
          cashCents + onlineCents,
          `tender for order ${order.dayOrderNumber} on ${businessDate}`,
        ).toBe(totalCents);
      }

      const payments: Array<{
        id: string;
        method: 'CASH' | 'ONLINE';
        amountCents: number;
      }> = [];
      if (cashCents !== 0) {
        payments.push({ id: randomUUID(), method: 'CASH', amountCents: cashCents });
      }
      if (onlineCents !== 0) {
        payments.push({
          id: randomUUID(),
          method: 'ONLINE',
          amountCents: onlineCents,
        });
      }

      return {
        id: order.id ?? randomUUID(),
        clientGeneratedId: randomUUID(),
        locationId: null,
        cashier: order.cashier ?? null,
        kind: order.kind ?? ('PURCHASE' as const),
        correctsSaleId: order.correctsSaleId ?? null,
        dayOrderNumber: order.dayOrderNumber,
        status,
        customerName: order.customerName ?? null,
        serviceType: order.serviceType ?? ('TAKE_OUT' as const),
        subtotalCents,
        discountCents,
        taxCents: 0,
        totalCents,
        cashTipCents: order.tipCents ?? 0,
        cashReceivedCents: order.cashReceivedCents ?? null,
        changeOwedCents: order.changeOwedCents ?? 0,
        changeSettledAt: order.changeSettledAt ?? null,
        completedAt: order.completedAt ?? null,
        voidReason: order.voidReason ?? null,
        recordedAt: atHour(businessDate, 2 + order.dayOrderNumber),
        payments,
        lines,
      };
    }),
    cashCounts: [],
    cashExpenses: [],
  };
}

/** Ids the assertions need to name directly. */
const ids = {
  voidedOriginal: randomUUID(),
  split: randomUUID(),
  senior: randomUUID(),
  parked: randomUUID(),
  walkIn: randomUUID(),
};

/**
 * Day A reproduces v1's Jul 20 exactly: one shared per-day sequence across
 * statuses, with #4 voided by a *correcting* record (ADR 0005 §2) rather than
 * a status value. The correcting row consumes #5 and is never itself a row in
 * the history, which is where the sequence's gap comes from.
 */
function dayA(): TradingDayFixture {
  return buildDay(DAY_A, [
    {
      id: ids.walkIn,
      dayOrderNumber: 1,
      // No customer name at all — the list renders NULL as "Walk-in".
      customerName: null,
      cashCents: 20_000,
      // v1 Jul 17 #7: ₱300.00 taken against a ₱200.00 order, and the recorded
      // change owed is ₱0.00 — not `received − total`.
      cashReceivedCents: 30_000,
      changeOwedCents: 0,
      completedAt: atHour(DAY_A, 3),
      lines: [{ unitPriceCents: 20_000 }],
    },
    {
      dayOrderNumber: 2,
      customerName: 'Mina Santos',
      serviceType: 'DINE_IN',
      onlineCents: 5_000,
      completedAt: atHour(DAY_A, 4),
      lines: [{ unitPriceCents: 5_000 }],
    },
    {
      id: ids.parked,
      dayOrderNumber: 3,
      status: 'PARKED',
      customerName: 'Parked Guest',
      serviceType: 'DINE_IN',
      // No payments, no completion, no change: a parked order's items and
      // totals are populated and nothing else is.
      lines: [{ unitPriceCents: 12_000 }],
    },
    {
      id: ids.voidedOriginal,
      dayOrderNumber: 4,
      customerName: 'Void Guest',
      cashCents: 25_000,
      tipCents: 500,
      cashReceivedCents: 25_000,
      completedAt: atHour(DAY_A, 8),
      lines: [{ unitPriceCents: 25_000 }],
    },
    {
      dayOrderNumber: 5,
      kind: 'VOID',
      correctsSaleId: ids.voidedOriginal,
      customerName: 'Void Guest',
      cashCents: -25_000,
      tipCents: -500,
      voidReason: 'Wrong item rung up',
      lines: [{ unitPriceCents: -25_000 }],
    },
  ]);
}

function dayB(): TradingDayFixture {
  return buildDay(DAY_B, [
    {
      dayOrderNumber: 1,
      // v1 Jul 23 #1: ₱100.00 taken against ₱50.00 and ₱50.00 withheld, never
      // handed back. Same amount as #2 below, different state.
      customerName: 'Owed Buyer',
      cashCents: 5_000,
      cashReceivedCents: 10_000,
      changeOwedCents: 5_000,
      changeSettledAt: null,
      completedAt: atHour(DAY_B, 3),
      lines: [{ unitPriceCents: 5_000 }],
    },
    {
      dayOrderNumber: 2,
      customerName: 'Settled Buyer',
      cashCents: 5_000,
      cashReceivedCents: 10_000,
      changeOwedCents: 5_000,
      changeSettledAt: atHour(DAY_B, 10),
      completedAt: atHour(DAY_B, 4),
      lines: [{ unitPriceCents: 5_000 }],
    },
    {
      dayOrderNumber: 3,
      // v1 Jul 17 #1: cash received (₱90.00) is LESS than the cash tender
      // (₱100.00). Historical data the read model must not reject.
      customerName: 'Under Buyer',
      cashCents: 10_000,
      cashReceivedCents: 9_000,
      completedAt: atHour(DAY_B, 5),
      lines: [{ unitPriceCents: 10_000 }],
    },
    {
      id: ids.split,
      dayOrderNumber: 4,
      customerName: 'Split Guest',
      serviceType: 'DINE_IN',
      cashCents: 8_000,
      onlineCents: 12_000,
      tipCents: 1_000,
      cashReceivedCents: 8_000,
      completedAt: atHour(DAY_B, 6),
      lines: [{ unitPriceCents: 20_000 }],
    },
    {
      id: ids.senior,
      dayOrderNumber: 5,
      customerName: 'Senior Guest',
      // 4497 × 20% = 899.4 → 899; 4498 × 20% = 899.6 → 900. Twenty percent of
      // an integer number of cents can never land exactly on a half cent, so
      // these are the two nearest cases either side of the half-up boundary.
      // Gross 13,995 − discount 1,799 = total 12,196.
      onlineCents: 12_196,
      completedAt: atHour(DAY_B, 7),
      lines: [
        { unitPriceCents: 4_497, discountKind: 'SENIOR', size: 'Small' },
        { unitPriceCents: 4_498, discountKind: 'SENIOR', size: 'Large' },
        { unitPriceCents: 5_000, size: 'Regular' },
      ],
    },
    {
      dayOrderNumber: 6,
      // v1 Jul 17 → Jul 21: completed AFTER its trading day.
      customerName: 'Late Guest',
      onlineCents: 30_000,
      completedAt: atHour(DAY_B, 48 + 3),
      lines: [{ unitPriceCents: 30_000 }],
    },
    {
      dayOrderNumber: 7,
      // v1 Jul 20 → Jul 19: completed BEFORE its trading day.
      customerName: 'Early Guest',
      onlineCents: 35_000,
      completedAt: atHour(DAY_B, -21),
      lines: [{ unitPriceCents: 35_000 }],
    },
  ]);
}

function dayC(): TradingDayFixture {
  return buildDay(
    DAY_C,
    Array.from({ length: 12 }, (_, index) => {
      const number = index + 1;
      return {
        dayOrderNumber: number,
        customerName: `Page Buyer ${String(number).padStart(2, '0')}`,
        onlineCents: number * 100,
        completedAt: atHour(DAY_C, 2 + number),
        lines: [{ unitPriceCents: number * 100 }],
      } satisfies OrderSeed;
    }),
  );
}

function seedAllDays(): void {
  resetTradingDays();
  seedTradingDayFixture(dayA());
  seedTradingDayFixture(dayB());
  seedTradingDayFixture(dayC());
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function gotoOrderHistory(page: Page): Promise<void> {
  await page.goto('/order-history');
  await expect(page.getByRole('heading', { name: 'Order History', level: 1 })).toBeVisible();
  await expect(page.locator('.reporting-loading')).toHaveCount(0);
}

/** `Jul 24#3` — the business day and order number a row actually displays. */
function key(businessDate: string, dayOrderNumber: number): string {
  return `${shortDate(businessDate)}#${dayOrderNumber}`;
}

function table(page: Page): Locator {
  return page.locator('.order-history-table');
}

/** Read the table body as an array of per-row cell-text arrays. */
async function tableRows(page: Page): Promise<string[][]> {
  return table(page)
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) =>
          (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    );
}

async function rowKeys(page: Page): Promise<string[]> {
  const rows = await tableRows(page);
  return rows.map((row) => `${row[0]}#${row[1]}`);
}

/** Order ids in display order, taken from each row's detail link. */
async function rowOrderIds(page: Page): Promise<string[]> {
  return table(page)
    .locator('tbody a.order-number-link')
    .evaluateAll((links) =>
      links.map(
        (link) =>
          (link as HTMLAnchorElement)
            .getAttribute('href')!
            .split('?')[0]!
            .split('/')
            .pop()!,
      ),
    );
}

/** Wait for the list to settle on an exact set of rows, in order. */
async function expectRows(page: Page, expected: string[]): Promise<void> {
  await expect
    .poll(() => rowKeys(page), { timeout: 15_000 })
    .toEqual(expected);
}

/** Wait for the list to settle on an exact row count. */
async function expectCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await tableRows(page)).length, { timeout: 15_000 })
    .toBe(count);
}

function orderRow(page: Page, businessDate: string, dayOrderNumber: number): Locator {
  return table(page)
    .locator('tbody tr')
    .filter({
      has: page.locator(
        `td:nth-child(1):text-is("${shortDate(businessDate)}")`,
      ),
    })
    .filter({
      has: page.locator(`td:nth-child(2) a:text-is("${dayOrderNumber}")`),
    });
}

function resultsSummary(page: Page): Locator {
  return page.locator('.order-results-toolbar p');
}

function searchField(page: Page): Locator {
  return page.locator('.order-history-filters input[type="search"]');
}

function filterSelect(page: Page, label: string): Locator {
  return page
    .locator('.order-history-filters label')
    .filter({ hasText: label })
    .locator('select');
}

function sortHeader(page: Page, label: string): Locator {
  return table(page).locator('thead button').filter({ hasText: label });
}

async function setStatusFilter(page: Page, value: string): Promise<void> {
  await filterSelect(page, 'Status').selectOption(value);
}

async function setPaymentFilter(page: Page, value: string): Promise<void> {
  await filterSelect(page, 'Payment').selectOption(value);
}

async function setPageSize(page: Page, size: number): Promise<void> {
  await filterSelect(page, 'Rows per page').selectOption(String(size));
}

function pagination(page: Page): Locator {
  return page.locator('.order-pagination');
}

async function gotoPage(page: Page, number: number): Promise<void> {
  await pagination(page).getByRole('button', { name: `Page ${number}` }).click();
  await expect(
    pagination(page).getByRole('button', { name: `Page ${number}` }),
  ).toHaveAttribute('aria-current', 'page');
}

// ---------------------------------------------------------------------------
// Detail helpers
// ---------------------------------------------------------------------------

async function openDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/order-history/${id}`);
  await expect(page.locator('.order-detail-head')).toBeVisible();
}

function summaryValue(page: Page, label: string): Locator {
  return page
    .locator('.order-detail-meta div')
    .filter({ has: page.locator(`dt:text-is("${label}")`) })
    .locator('dd');
}

function paymentValue(page: Page, label: string): Locator {
  return page
    .locator('.order-payment-summary div')
    .filter({ has: page.locator(`dt:text-is("${label}")`) })
    .locator('dd');
}

async function itemRows(page: Page): Promise<string[][]> {
  return page
    .locator('.order-items-table tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) =>
          (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    );
}

/** Parse "₱1,234.56" back to integer cents so arithmetic can be asserted. */
function toCents(money: string): number {
  const match = /^₱(-?)([\d,]+)\.(\d{2})$/.exec(money.trim());
  if (!match) throw new Error(`Not a money value: ${JSON.stringify(money)}`);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]!.replace(/,/g, '')) * 100 + Number(match[3]));
}

/** The date part of a timestamp as the shop reads it (Asia/Manila). */
function manilaDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(isoTimestamp));
}

// ---------------------------------------------------------------------------

test.beforeAll(() => {
  const catalog = seedReportingCatalog(RUN);
  variant = catalog.alphaSmall!;
  staffMemberId = ensureStaffMemberId();
  seedAllDays();
});

// ===========================================================================
// The list
// ===========================================================================

test.describe('Order History list (story #93)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoOrderHistory(page);
  });

  test('AC: one row per order across ALL business days, newest day and highest number first, 10 per page', async ({
    page,
  }) => {
    // Default view: business day newest → oldest, then order number highest →
    // lowest, ten rows.
    await expectRows(page, [
      key(DAY_C, 12),
      key(DAY_C, 11),
      key(DAY_C, 10),
      key(DAY_C, 9),
      key(DAY_C, 8),
      key(DAY_C, 7),
      key(DAY_C, 6),
      key(DAY_C, 5),
      key(DAY_C, 4),
      key(DAY_C, 3),
    ]);
    await expect(resultsSummary(page)).toHaveText(
      `Showing 1-10 of ${TOTAL_ORDERS} orders`,
    );

    // Every business day is reachable, not just the latest.
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);
    const days = new Set((await tableRows(page)).map((row) => row[0]));
    expect([...days].sort()).toEqual(
      [shortDate(DAY_A), shortDate(DAY_B), shortDate(DAY_C)].sort(),
    );

    // The correcting VOID record is not itself an order in the history: 23
    // orders, not 24 (ADR 0005 §2).
    expect(TOTAL_ORDERS).toBe(4 + 7 + 12);
  });

  test('AC: a row carries all nine order fields, with Walk-in for a nameless order', async ({
    page,
  }) => {
    // The active sort column carries a direction arrow, which is not part of
    // the field name.
    await expect
      .poll(() =>
        table(page)
          .locator('thead th')
          .evaluateAll((cells) =>
            cells.map((cell) =>
              (cell.textContent ?? '').replace(/[↑↓]/g, '').trim(),
            ),
          ),
      )
      .toEqual([
        'Business day',
        'Order no.',
        'Customer',
        'Status',
        'Payment method',
        'Order total',
        'Tip',
        'Change owed',
        'Completed',
      ]);

    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);

    const walkIn = orderRow(page, DAY_A, 1);
    await expect(walkIn.locator('td').nth(2)).toHaveText('Walk-in');
    await expect(walkIn.locator('td').nth(3)).toHaveText('Completed');
    await expect(walkIn.locator('td').nth(4)).toHaveText('Cash');
    await expect(walkIn.locator('td').nth(5)).toHaveText('₱200.00');
    await expect(walkIn.locator('td').nth(6)).toHaveText('₱0.00');
    // Change owed is the WITHHELD amount, never `received − total`. ₱300.00 was
    // taken against a ₱200.00 order and nothing was withheld.
    await expect(walkIn.locator('td').nth(7)).toHaveText('₱0.00');
    await expect(walkIn.locator('td').nth(7)).not.toHaveText('₱100.00');
    await expect(walkIn.locator('td').nth(8)).not.toHaveText('—');

    // "Walk-in" is a rendering of NULL, never a stored value (ADR 0005 §6).
    expect(
      runPrisma(`
        const count = await prisma.sale.count({
          where: { customerName: { contains: 'Walk', mode: 'insensitive' } },
        });
        process.stdout.write(String(count));
      `),
    ).toBe('0');
  });

  test('AC: status renders Completed / Parked / Void, and a void keeps the ORIGINAL positive figures', async ({
    page,
  }) => {
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);

    await expect(orderRow(page, DAY_A, 2).locator('td').nth(3)).toHaveText('Completed');
    await expect(orderRow(page, DAY_A, 3).locator('td').nth(3)).toHaveText('Parked');
    // Void is derived from the existence of a correcting Sale (ADR 0005 §2),
    // not from a status column — the stored status of this row is COMPLETED.
    await expect(orderRow(page, DAY_A, 4).locator('td').nth(3)).toHaveText('Void');

    const voided = orderRow(page, DAY_A, 4).locator('td');
    await expect(voided.nth(4)).toHaveText('Cash');
    await expect(voided.nth(5)).toHaveText('₱250.00');
    await expect(voided.nth(6)).toHaveText('₱5.00');
    // Not the correcting record's negatives.
    await expect(voided.nth(5)).not.toHaveText('₱-250.00');
    await expect(voided.nth(6)).not.toHaveText('₱-5.00');
    // A void shows no completed timestamp even though the original has one.
    await expect(voided.nth(8)).toHaveText('—');
  });

  test('AC: payment method renders Cash / Online / "Split (Cash + Online)", and a parked order renders "—"', async ({
    page,
  }) => {
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);

    await expect(orderRow(page, DAY_A, 1).locator('td').nth(4)).toHaveText('Cash');
    await expect(orderRow(page, DAY_A, 2).locator('td').nth(4)).toHaveText('Online');
    await expect(orderRow(page, DAY_B, 4).locator('td').nth(4)).toHaveText(
      'Split (Cash + Online)',
    );

    // A parked order has no payment rows, so method, completed time, tip and
    // change owed are all genuinely absent — "—", never ₱0.00 and never "Cash".
    const parked = orderRow(page, DAY_A, 3).locator('td');
    await expect(parked.nth(4)).toHaveText('—');
    await expect(parked.nth(6)).toHaveText('—');
    await expect(parked.nth(7)).toHaveText('—');
    await expect(parked.nth(8)).toHaveText('—');
    // Its actual order total stays visible.
    await expect(parked.nth(5)).toHaveText('₱120.00');
  });

  test('AC: order numbers restart at 1 per business day, are shared across statuses, and are never renumbered', async ({
    page,
  }) => {
    await sortHeader(page, 'Order no.').click(); // ascending
    await expectRows(page, [
      key(DAY_A, 1),
      key(DAY_A, 2),
      key(DAY_A, 3),
      key(DAY_A, 4),
      key(DAY_B, 1),
      key(DAY_B, 2),
      key(DAY_B, 3),
      key(DAY_B, 4),
      key(DAY_B, 5),
      key(DAY_B, 6),
    ]);

    // Day A is v1's Jul 20 exactly: #1 completed, #2 completed, #3 parked,
    // #4 void — one sequence shared across all three statuses, with the
    // correcting record consuming #5 and never appearing as a row.
    await setStatusFilter(page, '');
    await searchField(page).fill('');
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);

    const dayARows = (await tableRows(page)).filter(
      (row) => row[0] === shortDate(DAY_A),
    );
    expect(dayARows.map((row) => [row[1], row[3]])).toEqual([
      ['1', 'Completed'],
      ['2', 'Completed'],
      ['3', 'Parked'],
      ['4', 'Void'],
    ]);
    // #5 was consumed by the void's correcting record and is not a row. The
    // gap is intact and nothing was pulled up to fill it.
    expect(dayARows.map((row) => row[1])).not.toContain('5');
    // Each day starts again at 1.
    for (const day of [DAY_A, DAY_B, DAY_C]) {
      const numbers = (await tableRows(page))
        .filter((row) => row[0] === shortDate(day))
        .map((row) => Number(row[1]));
      expect(Math.min(...numbers)).toBe(1);
    }
  });

  test('AC: duplicate visible order numbers across days — opening one opens the right order', async ({
    page,
  }) => {
    await sortHeader(page, 'Order no.').click();
    await expectRows(page, [
      key(DAY_A, 1),
      key(DAY_A, 2),
      key(DAY_A, 3),
      key(DAY_A, 4),
      key(DAY_B, 1),
      key(DAY_B, 2),
      key(DAY_B, 3),
      key(DAY_B, 4),
      key(DAY_B, 5),
      key(DAY_B, 6),
    ]);

    // Two rows on this page both read "1".
    await expect(table(page).locator('tbody td:nth-child(2) a:text-is("1")')).toHaveCount(2);

    await orderRow(page, DAY_A, 1).locator('a.order-number-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order 1');
    await expect(page.locator('.order-detail-head')).toContainText(longDate(DAY_A));
    await expect(summaryValue(page, 'Customer')).toHaveText('Walk-in');

    await page.getByRole('link', { name: 'Back to Order History' }).click();
    await orderRow(page, DAY_B, 1).locator('a.order-number-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order 1');
    await expect(page.locator('.order-detail-head')).toContainText(longDate(DAY_B));
    await expect(summaryValue(page, 'Customer')).toHaveText('Owed Buyer');
  });

  test('AC: settled and outstanding change are distinguished, at the same amount', async ({
    page,
  }) => {
    await searchField(page).fill('Buyer');
    await setPageSize(page, 50);
    await expectRows(page, [
      key(DAY_C, 12),
      key(DAY_C, 11),
      key(DAY_C, 10),
      key(DAY_C, 9),
      key(DAY_C, 8),
      key(DAY_C, 7),
      key(DAY_C, 6),
      key(DAY_C, 5),
      key(DAY_C, 4),
      key(DAY_C, 3),
      key(DAY_C, 2),
      key(DAY_C, 1),
      key(DAY_B, 3),
      key(DAY_B, 2),
      key(DAY_B, 1),
    ]);

    // Same ₱50.00 amount, two different states.
    await expect(orderRow(page, DAY_B, 1).locator('td').nth(7)).toHaveText(
      '₱50.00Outstanding',
    );
    await expect(orderRow(page, DAY_B, 2).locator('td').nth(7)).toHaveText(
      '₱50.00Settled',
    );
  });

  test('edge: a completed timestamp outside its business day still lists under the trading day', async ({
    page,
  }) => {
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);

    // Completed two days AFTER its trading day (v1 Jul 17 → Jul 21) …
    const late = orderRow(page, DAY_B, 6).locator('td');
    await expect(late.nth(0)).toHaveText(shortDate(DAY_B));
    await expect(late.nth(8)).toContainText(manilaDate(atHour(DAY_B, 48 + 3)));
    expect(manilaDate(atHour(DAY_B, 48 + 3))).not.toBe(shortDate(DAY_B));

    // … and one completed the day BEFORE it (v1 Jul 20 → Jul 19).
    const early = orderRow(page, DAY_B, 7).locator('td');
    await expect(early.nth(0)).toHaveText(shortDate(DAY_B));
    await expect(early.nth(8)).toContainText(manilaDate(atHour(DAY_B, -21)));
    expect(manilaDate(atHour(DAY_B, -21))).not.toBe(shortDate(DAY_B));
  });

  test('edge: cash received below the cash tender displays without error', async ({
    page,
  }) => {
    // v1 Jul 17 #1: a ₱100.00 order recorded as ₱90.00 received. The read model
    // must not reject or "fix" historical data (ADR 0005 §5).
    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);
    await expect(orderRow(page, DAY_B, 3).locator('td').nth(5)).toHaveText('₱100.00');
    await expect(page.locator('.reporting-notice')).toHaveCount(0);

    await orderRow(page, DAY_B, 3).locator('a.order-number-link').click();
    await expect(paymentValue(page, 'Total')).toHaveText('₱100.00');
    await expect(paymentValue(page, 'Cash received')).toHaveText('₱90.00');
    await expect(paymentValue(page, 'Change owed')).toHaveText('₱0.00');
    await expect(page.locator('.reporting-notice')).toHaveCount(0);
  });
});

// ===========================================================================
// Filter, search, sort, page
// ===========================================================================

test.describe('Order History filtering, search, sorting and paging (story #93)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoOrderHistory(page);
  });

  test('AC: filter by each status', async ({ page }) => {
    await setPageSize(page, 50);

    await setStatusFilter(page, 'Parked');
    await expectRows(page, [key(DAY_A, 3)]);

    await setStatusFilter(page, 'Void');
    await expectRows(page, [key(DAY_A, 4)]);

    await setStatusFilter(page, 'Completed');
    await expectCount(page, TOTAL_ORDERS - 2);
    // The voided order is NOT completed, even though its stored status is.
    expect(await rowKeys(page)).not.toContain(key(DAY_A, 4));
    expect(await rowKeys(page)).not.toContain(key(DAY_A, 3));

    // "All" removes the restriction.
    await setStatusFilter(page, '');
    await expectCount(page, TOTAL_ORDERS);
  });

  test('AC: filter by each payment method; a split order matches Split only', async ({
    page,
  }) => {
    await setPageSize(page, 50);

    await setPaymentFilter(page, 'Cash');
    await expectRows(page, [
      key(DAY_B, 3),
      key(DAY_B, 2),
      key(DAY_B, 1),
      key(DAY_A, 4),
      key(DAY_A, 1),
    ]);
    // The split order is not cash-only …
    expect(await rowKeys(page)).not.toContain(key(DAY_B, 4));

    await setPaymentFilter(page, 'Online');
    expect(await rowKeys(page)).not.toContain(key(DAY_B, 4));
    await expectCount(page, 16);

    // … it matches Split, and only Split.
    await setPaymentFilter(page, 'Split');
    await expectRows(page, [key(DAY_B, 4)]);

    await setPaymentFilter(page, '');
    await expectCount(page, TOTAL_ORDERS);
  });

  test('AC: status, payment and search filters combine', async ({ page }) => {
    await setPageSize(page, 50);

    // Completed + Cash: excludes the voided cash order.
    await setStatusFilter(page, 'Completed');
    await setPaymentFilter(page, 'Cash');
    await expectRows(page, [
      key(DAY_B, 3),
      key(DAY_B, 2),
      key(DAY_B, 1),
      key(DAY_A, 1),
    ]);

    // Void + Cash: the void keeps the original's payment method.
    await setStatusFilter(page, 'Void');
    await expectRows(page, [key(DAY_A, 4)]);

    // Three controls at once.
    await setStatusFilter(page, 'Completed');
    await setPaymentFilter(page, 'Online');
    await searchField(page).fill('guest');
    await expectRows(page, [key(DAY_B, 7), key(DAY_B, 6), key(DAY_B, 5)]);

    // Clearing every control removes every restriction.
    await setStatusFilter(page, '');
    await setPaymentFilter(page, '');
    await searchField(page).fill('');
    await expectCount(page, TOTAL_ORDERS);
  });

  test('AC: customer search is a trimmed, case-insensitive substring and never matches "Walk-in"', async ({
    page,
  }) => {
    await setPageSize(page, 50);

    await searchField(page).fill('sant');
    await expectRows(page, [key(DAY_A, 2)]);

    await searchField(page).fill('SANT');
    await expectRows(page, [key(DAY_A, 2)]);

    await searchField(page).fill('   Mina Santos   ');
    await expectRows(page, [key(DAY_A, 2)]);

    // The displayed "Walk-in" label is not searchable — it is a rendering of
    // NULL, and matching it would be matching the UI, not the record
    // (ADR 0005 §6).
    await searchField(page).fill('walk');
    await expect(page.getByRole('heading', { name: 'No sales orders' })).toBeVisible();

    // A search matching nothing at all.
    await searchField(page).fill('zzzznotacustomer');
    await expect(page.getByRole('heading', { name: 'No sales orders' })).toBeVisible();
  });

  test('AC: sort by business day, both directions', async ({ page }) => {
    await sortHeader(page, 'Business day').click(); // desc → asc
    await expectRows(page, [
      key(DAY_A, 4),
      key(DAY_A, 3),
      key(DAY_A, 2),
      key(DAY_A, 1),
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_B, 3),
      key(DAY_B, 2),
    ]);

    await sortHeader(page, 'Business day').click(); // asc → desc
    await expectRows(page, [
      key(DAY_C, 12),
      key(DAY_C, 11),
      key(DAY_C, 10),
      key(DAY_C, 9),
      key(DAY_C, 8),
      key(DAY_C, 7),
      key(DAY_C, 6),
      key(DAY_C, 5),
      key(DAY_C, 4),
      key(DAY_C, 3),
    ]);
  });

  test('AC: order-number sort is day-then-number across days, both directions', async ({
    page,
  }) => {
    // Six orders spanning two days, so the ordering is visibly day-then-number
    // and not a flat number sort.
    await searchField(page).fill('guest');
    await setPageSize(page, 50);
    await expectRows(page, [
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 4),
      key(DAY_A, 3),
    ]);

    await sortHeader(page, 'Order no.').click();
    const ascending = [
      key(DAY_A, 3),
      key(DAY_A, 4),
      key(DAY_B, 4),
      key(DAY_B, 5),
      key(DAY_B, 6),
      key(DAY_B, 7),
    ];
    await expectRows(page, ascending);

    // Choosing the active sort again reverses its direction.
    await sortHeader(page, 'Order no.').click();
    await expectRows(page, [...ascending].reverse());
  });

  test('AC: status sort is Parked, Completed, Void ascending, reversed descending', async ({
    page,
  }) => {
    await searchField(page).fill('guest');
    await setPageSize(page, 50);
    await expectRows(page, [
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 4),
      key(DAY_A, 3),
    ]);

    await sortHeader(page, 'Status').click();
    await expectRows(page, [
      key(DAY_A, 3), // Parked
      key(DAY_B, 7), // Completed, then newest day / highest number first
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 4), // Void
    ]);
    expect(
      (await tableRows(page)).map((row) => row[3]),
    ).toEqual(['Parked', 'Completed', 'Completed', 'Completed', 'Completed', 'Void']);

    // Descending reverses the status groups; inside a group the tie-break is
    // still newest business day, then highest order number.
    await sortHeader(page, 'Status').click();
    await expectRows(page, [
      key(DAY_A, 4),
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 3),
    ]);
    expect(
      (await tableRows(page)).map((row) => row[3]),
    ).toEqual(['Void', 'Completed', 'Completed', 'Completed', 'Completed', 'Parked']);
  });

  test('AC: sort by total, both directions', async ({ page }) => {
    await searchField(page).fill('guest');
    await setPageSize(page, 50);
    await expectRows(page, [
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 4),
      key(DAY_A, 3),
    ]);

    await sortHeader(page, 'Order total').click();
    const ascending = [
      key(DAY_A, 3), // ₱120.00
      key(DAY_B, 5), // ₱121.96
      key(DAY_B, 4), // ₱200.00
      key(DAY_A, 4), // ₱250.00 (void keeps the positive total)
      key(DAY_B, 6), // ₱300.00
      key(DAY_B, 7), // ₱350.00
    ];
    await expectRows(page, ascending);
    const totals = (await tableRows(page)).map((row) => toCents(row[5]!));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));

    await sortHeader(page, 'Order total').click();
    await expectRows(page, [...ascending].reverse());
  });

  test('AC: sort by completed timestamp keeps orders without one last in both directions', async ({
    page,
  }) => {
    await searchField(page).fill('guest');
    await setPageSize(page, 50);
    await expectRows(page, [
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_A, 4),
      key(DAY_A, 3),
    ]);

    await sortHeader(page, 'Completed').click(); // ascending
    await expectRows(page, [
      key(DAY_A, 4), // DAY_A + 8h
      key(DAY_B, 7), // DAY_B − 21h  (before its own business day)
      key(DAY_B, 4), // DAY_B + 6h
      key(DAY_B, 5), // DAY_B + 7h
      key(DAY_B, 6), // DAY_B + 51h (after its own business day)
      key(DAY_A, 3), // parked — no timestamp, last
    ]);

    await sortHeader(page, 'Completed').click(); // descending
    await expectRows(page, [
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
      key(DAY_B, 7),
      key(DAY_A, 4),
      key(DAY_A, 3), // still last: absent is not "smallest"
    ]);

    // Sorting by business day and by completed timestamp genuinely differ —
    // DAY_B #6 and #7 were completed outside their trading day.
    await sortHeader(page, 'Business day').click();
    await expectRows(page, [
      key(DAY_A, 4),
      key(DAY_A, 3),
      key(DAY_B, 7),
      key(DAY_B, 6),
      key(DAY_B, 5),
      key(DAY_B, 4),
    ]);
  });

  test('AC: page sizes 5 / 10 / 25 / 50 and paging that neither drops nor duplicates an order', async ({
    page,
  }) => {
    // 25 rows per page holds the whole set — the reference list.
    await setPageSize(page, 25);
    await expectCount(page, TOTAL_ORDERS);
    const reference = await rowOrderIds(page);
    expect(new Set(reference).size).toBe(TOTAL_ORDERS);
    await expect(pagination(page).getByRole('button', { name: 'Page 2' })).toHaveCount(0);

    await setPageSize(page, 50);
    await expectCount(page, TOTAL_ORDERS);
    expect(await rowOrderIds(page)).toEqual(reference);

    // Ten per page: 10 + 10 + 3.
    await setPageSize(page, 10);
    const tenPerPage: string[] = [];
    for (const [index, expected] of [10, 10, 3].entries()) {
      if (index > 0) await gotoPage(page, index + 1);
      await expectCount(page, expected);
      tenPerPage.push(...(await rowOrderIds(page)));
    }
    expect(tenPerPage).toEqual(reference);
    expect(new Set(tenPerPage).size).toBe(TOTAL_ORDERS);
    await expect(pagination(page).getByRole('button', { name: 'Next' })).toBeDisabled();

    // Five per page: 5 + 5 + 5 + 5 + 3, via Next.
    await setPageSize(page, 5);
    const fivePerPage: string[] = [];
    for (const [index, expected] of [5, 5, 5, 5, 3].entries()) {
      if (index > 0) {
        await pagination(page).getByRole('button', { name: 'Next' }).click();
        await expect(
          pagination(page).getByRole('button', { name: `Page ${index + 1}` }),
        ).toHaveAttribute('aria-current', 'page');
      }
      await expectCount(page, expected);
      fivePerPage.push(...(await rowOrderIds(page)));
    }
    expect(fivePerPage).toEqual(reference);
    expect(new Set(fivePerPage).size).toBe(TOTAL_ORDERS);

    // And back the other way.
    await pagination(page).getByRole('button', { name: 'Previous' }).click();
    await expect(pagination(page).getByRole('button', { name: 'Page 4' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectCount(page, 5);
  });

  test('AC: changing search, filter, sort or page size returns to the first page', async ({
    page,
  }) => {
    await setPageSize(page, 5);
    await gotoPage(page, 4);

    async function expectFirstPage(): Promise<void> {
      await expect(resultsSummary(page)).toContainText('Showing 1-');
      const first = pagination(page).getByRole('button', { name: 'Page 1' });
      await expect(first).toHaveAttribute('aria-current', 'page');
    }

    await searchField(page).fill('Buyer');
    await expectFirstPage();

    await gotoPage(page, 3);
    await setStatusFilter(page, 'Completed');
    await expectFirstPage();

    await gotoPage(page, 3);
    await setPaymentFilter(page, 'Online');
    await expectFirstPage();

    await gotoPage(page, 2);
    await sortHeader(page, 'Order total').click();
    await expectFirstPage();

    // Edge: page size changed while on a later page — a sane page 1, no crash.
    await gotoPage(page, 2);
    await setPageSize(page, 25);
    await expectFirstPage();
    await expect(page.getByRole('heading', { name: 'No sales orders' })).toHaveCount(0);
    await expect(page.locator('.reporting-notice')).toHaveCount(0);
  });

  test('AC: a filter that matches nothing shows "No sales orders"', async ({ page }) => {
    // A parked order has no payment rows, so it can never be a cash order.
    await setStatusFilter(page, 'Parked');
    await setPaymentFilter(page, 'Cash');

    await expect(page.getByRole('heading', { name: 'No sales orders' })).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    await expect(resultsSummary(page)).toHaveText('0 orders');
  });
});

// ===========================================================================
// The detail screen
// ===========================================================================

test.describe('Order detail (story #93)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('AC: detail shows order number, business day, customer, status, service and payment method', async ({
    page,
  }) => {
    await openDetail(page, ids.split);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order 4');
    await expect(page.locator('.order-detail-head')).toContainText(longDate(DAY_B));
    await expect(page.locator('.order-detail-head .order-status')).toHaveText('Completed');
    await expect(summaryValue(page, 'Customer')).toHaveText('Split Guest');
    await expect(summaryValue(page, 'Service')).toHaveText('Dine-in');
    await expect(summaryValue(page, 'Payment method')).toHaveText(
      'Split (Cash + Online)',
    );

    // Take-out reads as take-out.
    await openDetail(page, ids.walkIn);
    await expect(summaryValue(page, 'Service')).toHaveText('Take-out');
    await expect(summaryValue(page, 'Customer')).toHaveText('Walk-in');
  });

  test('AC: split payment — cash and online portions exclude tip and together equal the total', async ({
    page,
  }) => {
    await openDetail(page, ids.split);

    const cash = toCents(await paymentValue(page, 'Cash portion').innerText());
    const online = toCents(await paymentValue(page, 'Online portion').innerText());
    const total = toCents(await paymentValue(page, 'Total').innerText());
    const tip = toCents(await paymentValue(page, 'Tip').innerText());

    expect(cash).toBe(8_000);
    expect(online).toBe(12_000);
    expect(tip).toBe(1_000);
    // The arithmetic, not just the presence of the figures.
    expect(cash + online).toBe(total);
    expect(cash + online).not.toBe(total + tip);
  });

  test('AC: Senior is 20% off the line, labelled per line, and summed into the order discount', async ({
    page,
  }) => {
    await openDetail(page, ids.senior);

    // Each line shows product, size, quantity, discount and line total. No
    // acceptance criterion fixes the order of the lines, so compare them as a
    // set (the API orders them by line id, which is a UUID).
    const lines = await itemRows(page);
    expect([...lines].sort((a, b) => a[1]!.localeCompare(b[1]!))).toEqual([
      [
        variant.productName,
        'Large',
        '1',
        'SeniorIncluded in Total discount',
        '₱35.98',
      ],
      [variant.productName, 'Regular', '1', 'None', '₱50.00'],
      [
        variant.productName,
        'Small',
        '1',
        'SeniorIncluded in Total discount',
        '₱35.98',
      ],
    ]);

    // ADR 0005 §4: 20% per line, rounded half-up, in integer cents.
    // 4497 → 899.4 → 899 (down); 4498 → 899.6 → 900 (up). Twenty percent of an
    // integer cent amount can never land exactly on a half cent, so these are
    // the closest cases either side of the boundary.
    expect(seniorDiscountCents(4_497)).toBe(899);
    expect(seniorDiscountCents(4_498)).toBe(900);

    const subtotal = toCents(await paymentValue(page, 'Subtotal').innerText());
    const discount = toCents(await paymentValue(page, 'Total discount').innerText());
    const total = toCents(await paymentValue(page, 'Total').innerText());

    expect(subtotal).toBe(13_995);
    // The order's total discount is exactly the sum of its lines' discounts.
    expect(discount).toBe(899 + 900);
    expect(total).toBe(subtotal - discount);

    // The displayed line totals sum exactly to the total — no residual cent.
    const lineTotals = lines.map((row) => toCents(row[4]!));
    expect(lineTotals.reduce((sum, value) => sum + value, 0)).toBe(total);
  });

  test('AC: payment detail shows every figure, with change owed as the stored withheld amount', async ({
    page,
  }) => {
    await openDetail(page, ids.walkIn);

    await expect(page.locator('.order-payment-summary dt')).toHaveText([
      'Subtotal',
      'Total discount',
      'Total',
      'Cash portion',
      'Online portion',
      'Tip',
      'Cash received',
      'Change owed',
      'Change settled',
      'Completed',
    ]);

    await expect(paymentValue(page, 'Subtotal')).toHaveText('₱200.00');
    await expect(paymentValue(page, 'Total discount')).toHaveText('₱0.00');
    await expect(paymentValue(page, 'Total')).toHaveText('₱200.00');
    await expect(paymentValue(page, 'Cash portion')).toHaveText('₱200.00');
    await expect(paymentValue(page, 'Online portion')).toHaveText('₱0.00');
    await expect(paymentValue(page, 'Cash received')).toHaveText('₱300.00');
    // Withheld change, not `received − total`. A recorded monetary zero shows
    // as zero, not "—".
    await expect(paymentValue(page, 'Change owed')).toHaveText('₱0.00');
    await expect(paymentValue(page, 'Change owed')).not.toHaveText('₱100.00');
    await expect(paymentValue(page, 'Change settled')).toHaveText('—');
    await expect(paymentValue(page, 'Completed')).not.toHaveText('—');
  });

  test('AC: outstanding change shows no settlement time; settled change shows one', async ({
    page,
  }) => {
    await gotoOrderHistory(page);
    await searchField(page).fill('Owed Buyer');
    await expectRows(page, [key(DAY_B, 1)]);
    await orderRow(page, DAY_B, 1).locator('a.order-number-link').click();
    await expect(paymentValue(page, 'Change owed')).toHaveText('₱50.00');
    await expect(paymentValue(page, 'Change settled')).toHaveText('—');

    await gotoOrderHistory(page);
    await searchField(page).fill('Settled Buyer');
    await expectRows(page, [key(DAY_B, 2)]);
    await orderRow(page, DAY_B, 2).locator('a.order-number-link').click();
    await expect(paymentValue(page, 'Change owed')).toHaveText('₱50.00');
    await expect(paymentValue(page, 'Change settled')).toContainText(
      manilaDate(atHour(DAY_B, 10)),
    );
  });

  test('AC: a parked order shows "—" for every unavailable value, not zero and not a hidden label', async ({
    page,
  }) => {
    await openDetail(page, ids.parked);

    await expect(page.locator('.order-detail-head .order-status')).toHaveText('Parked');
    await expect(summaryValue(page, 'Payment method')).toHaveText('—');

    // Its items and totals ARE populated.
    expect(await itemRows(page)).toEqual([
      [variant.productName, variant.variantName, '1', 'None', '₱120.00'],
    ]);
    await expect(paymentValue(page, 'Subtotal')).toHaveText('₱120.00');
    await expect(paymentValue(page, 'Total')).toHaveText('₱120.00');

    // Everything payment-shaped is genuinely absent — every label is still
    // present, showing "—", never ₱0.00.
    for (const label of [
      'Cash portion',
      'Online portion',
      'Tip',
      'Cash received',
      'Change owed',
      'Change settled',
      'Completed',
    ]) {
      await expect(paymentValue(page, label), label).toHaveText('—');
      await expect(paymentValue(page, label), label).not.toHaveText('₱0.00');
    }
    await expect(page.locator('.order-payment-summary dt')).toHaveCount(10);
  });

  test('AC: a void order shows the correcting record\'s void reason and keeps its own positive figures', async ({
    page,
  }) => {
    await openDetail(page, ids.voidedOriginal);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order 4');
    await expect(page.locator('.order-detail-head .order-status')).toHaveText('Void');
    await expect(page.locator('.order-detail-head')).toContainText(longDate(DAY_A));

    // The void reason lives on the CORRECTING row (ADR 0005 §2), not here.
    await expect(page.locator('.order-void-reason')).toContainText('Wrong item rung up');

    // The voided original still occupies #4 and shows its own positive money.
    await expect(paymentValue(page, 'Total')).toHaveText('₱250.00');
    await expect(paymentValue(page, 'Cash portion')).toHaveText('₱250.00');
    await expect(paymentValue(page, 'Tip')).toHaveText('₱5.00');
    await expect(paymentValue(page, 'Completed')).toHaveText('—');
    expect(await itemRows(page)).toEqual([
      [variant.productName, variant.variantName, '1', 'None', '₱250.00'],
    ]);

    // A non-void order carries no void-reason block at all.
    await openDetail(page, ids.split);
    await expect(page.locator('.order-void-reason')).toHaveCount(0);
  });
});

// ===========================================================================
// Read-only — the story's central criterion
// ===========================================================================

test.describe('Order History is read-only (story #93)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.title.includes('non-admin staff user')) return;
    await signInAsAdmin(page);
  });

  test('AC: neither screen exposes a create, edit, delete, void or reopen control', async ({
    page,
  }) => {
    const forbidden = /new|add|create|edit|update|delete|remove|void|reopen|save|cancel order/i;
    const forbiddenHref =
      /(?:^|\/)(?:new|add|create|edit|update|delete|remove|void|reopen)(?:\/|$|\?)/i;

    await gotoOrderHistory(page);
    await expect(page.locator('.reporting-page')).toContainText('Read-only');

    // The only buttons are the five sort headers and the pager.
    const buttonNames = await page
      .locator('.reporting-page button')
      .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
    expect(buttonNames.filter((name) => forbidden.test(name))).toEqual([]);
    // No forms and no writable inputs beyond the read filters.
    await expect(page.locator('.reporting-page form')).toHaveCount(0);
    await expect(
      page.locator(
        '.reporting-page input:not([type="search"]), .reporting-page textarea',
      ),
    ).toHaveCount(0);
    // Every link out of the list is a detail link.
    const listHrefs = await page
      .locator('.reporting-page a')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? ''),
      );
    expect(listHrefs.filter((href) => forbiddenHref.test(href))).toEqual([]);

    await openDetail(page, ids.split);
    const detailButtons = await page
      .locator('.reporting-page button')
      .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
    expect(detailButtons).toEqual([]);
    await expect(page.locator('.reporting-page form')).toHaveCount(0);
    await expect(
      page.locator('.reporting-page input, .reporting-page textarea, .reporting-page select'),
    ).toHaveCount(0);
    const detailHrefs = await page
      .locator('.reporting-page a')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? ''),
      );
    expect(detailHrefs.filter((href) => forbiddenHref.test(href))).toEqual([]);
  });

  test('AC: searching, filtering, sorting and paging issue no write and change no order', async ({
    page,
  }) => {
    // The detail as it stands before any reviewing happens.
    await openDetail(page, ids.split);
    const before = await page.locator('article').innerText();

    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });

    // Every control the screen has, exercised in turn, each one settled before
    // the next so the sequence is real reviewing and not a burst of clicks.
    await gotoOrderHistory(page);
    await searchField(page).fill('guest');
    await expectCount(page, 6);
    await setStatusFilter(page, 'Completed');
    await expectCount(page, 4);
    await setPaymentFilter(page, 'Online');
    await expectCount(page, 3);
    await sortHeader(page, 'Order total').click();
    await expectRows(page, [key(DAY_B, 5), key(DAY_B, 6), key(DAY_B, 7)]);
    await sortHeader(page, 'Order total').click();
    await expectRows(page, [key(DAY_B, 7), key(DAY_B, 6), key(DAY_B, 5)]);
    await setStatusFilter(page, '');
    await setPaymentFilter(page, '');
    await searchField(page).fill('');
    await expectCount(page, 10);
    await expect(resultsSummary(page)).toHaveText(
      `Showing 1-10 of ${TOTAL_ORDERS} orders`,
    );
    await setPageSize(page, 5);
    await expectCount(page, 5);
    await gotoPage(page, 3);
    await pagination(page).getByRole('button', { name: 'Next' }).click();
    await expect(
      pagination(page).getByRole('button', { name: 'Page 4' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectCount(page, 5);

    expect(writes).toEqual([]);

    // Re-open the order: identical, field for field.
    await openDetail(page, ids.split);
    expect(await page.locator('article').innerText()).toBe(before);
  });

  test('AC: no back-office address creates or edits an order', async ({ page }) => {
    // `/order-history/new` is caught by the detail route, which only ever
    // fetches. It resolves to no form.
    await page.goto('/order-history/new');
    await expect(page.locator('.reporting-notice')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.locator('input, textarea')).toHaveCount(0);
    await expect(page.locator('.order-detail-head')).toHaveCount(0);

    // `/order-history/:id/edit` matches no route at all.
    await page.goto(`/order-history/${ids.split}/edit`);
    await expect(
      page.getByRole('heading', { name: 'Administrator workspace' }),
    ).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.locator('input, textarea')).toHaveCount(0);

    // Neither address is reachable from the app, either.
    await gotoOrderHistory(page);
    await expect(page.locator('a[href*="/new"], a[href*="/edit"]')).toHaveCount(0);
  });

  test('AC: the Order History capability rejects every write attempt', async ({ page }) => {
    const detailBefore = await (
      await page.request.get(`${API_BASE_URL}/reporting/order-history/${ids.split}`)
    ).text();

    for (const path of [
      '/reporting/order-history',
      `/reporting/order-history/${ids.split}`,
    ]) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const response = await page.request[method](`${API_BASE_URL}${path}`, {
          data: { customerName: 'Injected', status: 'Parked', totalCents: 1 },
          failOnStatusCode: false,
        });
        expect(
          [404, 405],
          `${method.toUpperCase()} ${path} → ${response.status()}`,
        ).toContain(response.status());
      }
    }

    // Nothing moved.
    const detailAfter = await (
      await page.request.get(`${API_BASE_URL}/reporting/order-history/${ids.split}`)
    ).text();
    expect(detailAfter).toBe(detailBefore);

    // Structural, not a UI promise: the reporting module has no write route at
    // all (ADR 0005 §8). That is what makes this criterion hold.
    const reportingDir = resolve(REPO_ROOT, 'apps/api/src/reporting');
    const sources = readdirSync(reportingDir).filter(
      (name) => name.endsWith('.ts') && !name.includes('.spec.'),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = readFileSync(resolve(reportingDir, name), 'utf8');
      expect(source, name).not.toMatch(/@(Post|Put|Patch|Delete|All)\s*\(/);
    }
  });

  test('AC: a non-admin staff user reaches neither view and receives no order data', async ({
    context,
    page,
  }) => {
    // Start the role check without any existing identity.
    await context.clearCookies();
    await page.goto('/staff/sign-in');
    await page.getByRole('button', { name: 'Use Username and Password' }).click();
    const username = page.getByLabel('Username', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toBeVisible();
    await username.fill(STAFF_USERNAME);
    await password.fill(STAFF_PASSWORD);
    await expect(username).toHaveValue(STAFF_USERNAME);
    await expect(password).toHaveValue(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/pos(\/order)?$/);

    // Both views bounce back to the POS.
    await page.goto('/order-history');
    await expect(page).toHaveURL(/\/pos(\/order)?$/);
    await expect(page.getByRole('heading', { name: 'Order History' })).toHaveCount(0);

    await page.goto(`/order-history/${ids.split}`);
    await expect(page).toHaveURL(/\/pos(\/order)?$/);
    await expect(page.locator('.order-detail-head')).toHaveCount(0);

    // And the API hands a staff session no order-history data.
    for (const path of [
      '/reporting/order-history',
      `/reporting/order-history/${ids.split}`,
    ]) {
      const response = await page.request.get(`${API_BASE_URL}${path}`, {
        failOnStatusCode: false,
      });
      expect(response.status(), path).toBe(403);
      const body = await response.text();
      expect(body).not.toContain('Split Guest');
      expect(body).not.toContain('dayOrderNumber');
    }
  });
});

// ===========================================================================
// No orders at all. Runs last: it empties the tables.
// ===========================================================================

test.describe('Order History with no orders at all (story #93)', () => {
  test.beforeAll(() => {
    resetTradingDays();
  });

  test('AC: an empty history shows the same "No sales orders" copy as a filtered-to-empty one', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoOrderHistory(page);

    await expect(page.getByRole('heading', { name: 'No sales orders' })).toBeVisible();
    await expect(resultsSummary(page)).toHaveText('0 orders');
    await expect(table(page)).toHaveCount(0);
    await expect(pagination(page)).toHaveCount(0);
    await expect(page.locator('.reporting-notice')).toHaveCount(0);

    // Still read-only, still no create affordance, with nothing to show.
    await expect(page.locator('.reporting-page')).toContainText('Read-only');
    await expect(page.locator('.reporting-page form')).toHaveCount(0);
  });
});
