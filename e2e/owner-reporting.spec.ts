import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ensureStaffMemberId,
  isoShift,
  longDate,
  resetTradingDays,
  seedReportingCatalog,
  seedTradingDay,
  shopToday,
  shortDate,
  type SeededVariant,
} from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #80 — "Review sales performance and
 * trading-day reconciliation" (QA task #87).
 *
 * Everything is exercised through the real browser → web app → NestJS API →
 * PostgreSQL path, signed in as the seeded `admin` (ADMIN) user. The capture
 * workflows that would create trading days, tender rows, tips, cash counts and
 * cash expenses are out of scope for #80 (ADR 0004 §6), so the source records
 * are seeded directly (see `fixtures/reporting-seed.ts`).
 *
 * Reporting aggregates the entire trading-day table, so each scenario resets
 * those tables and seeds exactly the rows it asserts on. That makes the file
 * order-dependent: it runs serially, and the scenarios that deliberately leave
 * the database without an open day (or without any day) come last.
 *
 * All dates are derived from the current Asia/Manila shop date at run time, so
 * the suite is not pinned to the day it was written.
 */

test.describe.configure({ mode: 'serial' });

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TODAY = shopToday();
/** The inclusive 14-date window the Dashboard and the initial report use. */
const WINDOW_FROM = isoShift(TODAY, -13);

// One trading day per scenario slot. Offsets are chosen so the 14-date window
// starts exactly on DAY_BOUNDARY (proving the inclusive lower bound) and so
// several calendar dates inside the window have no trading day at all.
const DAY_BOUNDARY = isoShift(TODAY, -13); // closed, balanced count
const DAY_FLOAT_ONLY = isoShift(TODAY, -10); // float, no sales, drawer short
const DAY_ZERO_COUNT = isoShift(TODAY, -8); // a recorded ZERO count
const DAY_TWO_COUNTS = isoShift(TODAY, -6); // two counts, drawer over
const DAY_NO_COUNT = isoShift(TODAY, -4); // closed, never counted
const DAY_OPEN = isoShift(TODAY, -2); // OPEN, business date ≠ today

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let variants: Record<string, SeededVariant>;
let staffMemberId: string;

function product(key: string): string {
  return variants[key]!.productName;
}

/**
 * Seed the full scenario: six trading days across the 14-date window, one of
 * them open with a business date two days behind "now", and a void recorded on
 * the open day that corrects a purchase belonging to an earlier trading day.
 */
function seedFullScenario(): void {
  resetTradingDays();

  seedTradingDay(
    {
      businessDate: DAY_BOUNDARY,
      status: 'CLOSED',
      openingFloatCents: 100_000,
      sales: [
        {
          cashCents: 50_000,
          cashTipCents: 2_000,
          lines: [
            {
              variant: variants.alphaLarge!,
              quantity: 1,
              unitPriceCents: 50_000,
              lineTotalCents: 50_000,
            },
          ],
        },
        {
          onlineCents: 30_000,
          lines: [
            {
              variant: variants.delta!,
              quantity: 3,
              unitPriceCents: 10_000,
              lineTotalCents: 30_000,
            },
          ],
        },
      ],
      cashExpenses: [5_000],
      cashCounts: [147_000], // exactly the expected cash → zero variance
    },
    staffMemberId,
  );

  seedTradingDay(
    {
      businessDate: DAY_FLOAT_ONLY,
      status: 'CLOSED',
      openingFloatCents: 200_000,
      cashCounts: [195_000], // ₱50.00 short
    },
    staffMemberId,
  );

  seedTradingDay(
    {
      businessDate: DAY_ZERO_COUNT,
      status: 'CLOSED',
      openingFloatCents: 0,
      cashCounts: [0], // a recorded zero is NOT a missing count
    },
    staffMemberId,
  );

  const twoCounts = seedTradingDay(
    {
      businessDate: DAY_TWO_COUNTS,
      status: 'CLOSED',
      openingFloatCents: 100_000,
      sales: [
        {
          cashCents: 20_000,
          cashTipCents: 500,
          lines: [
            {
              variant: variants.gamma!,
              quantity: 1,
              unitPriceCents: 20_000,
              lineTotalCents: 20_000,
            },
          ],
        },
        {
          onlineCents: 10_000,
          cashTipCents: 500,
          lines: [
            {
              variant: variants.beta!,
              quantity: 1,
              unitPriceCents: 10_000,
              lineTotalCents: 10_000,
            },
          ],
        },
      ],
      // The LATEST count is the actual cash (ADR 0004 §4) — not the first,
      // and not the sum.
      cashCounts: [100_000, 124_000],
    },
    staffMemberId,
  );

  seedTradingDay(
    {
      businessDate: DAY_NO_COUNT,
      status: 'CLOSED',
      openingFloatCents: 50_000,
      sales: [
        {
          cashCents: 13_000,
          lines: [
            {
              variant: variants.delta!,
              quantity: 1,
              unitPriceCents: 5_000,
              lineTotalCents: 5_000,
            },
            {
              variant: variants.epsilon!,
              quantity: 1,
              unitPriceCents: 4_000,
              lineTotalCents: 4_000,
            },
            {
              variant: variants.zeta!,
              quantity: 1,
              unitPriceCents: 4_000,
              lineTotalCents: 4_000,
            },
          ],
        },
      ],
    },
    staffMemberId,
  );

  seedTradingDay(
    {
      businessDate: DAY_OPEN,
      status: 'OPEN',
      openingFloatCents: 150_000,
      sales: [
        {
          cashCents: 40_000,
          cashTipCents: 1_000,
          lines: [
            {
              variant: variants.alphaSmall!,
              quantity: 2,
              unitPriceCents: 20_000,
              lineTotalCents: 40_000,
            },
          ],
        },
        {
          onlineCents: 40_000,
          cashTipCents: 2_000,
          lines: [
            {
              variant: variants.beta!,
              quantity: 1,
              unitPriceCents: 40_000,
              lineTotalCents: 40_000,
            },
          ],
        },
        {
          cashCents: 25_000,
          cashTipCents: 500,
          lines: [
            {
              variant: variants.gamma!,
              quantity: 1,
              unitPriceCents: 25_000,
              lineTotalCents: 25_000,
            },
          ],
        },
        {
          // A correcting void of a purchase made on DAY_TWO_COUNTS. It belongs
          // to the trading day of the CORRECTION, so it must reduce this day's
          // figures and leave DAY_TWO_COUNTS untouched.
          kind: 'VOID',
          correctsSaleId: twoCounts.saleIds[0]!,
          cashCents: -20_000,
          cashTipCents: -500,
          lines: [
            {
              variant: variants.gamma!,
              quantity: -1,
              unitPriceCents: 20_000,
              lineTotalCents: -20_000,
            },
          ],
        },
      ],
      cashExpenses: [2_500],
    },
    staffMemberId,
  );
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.locator('.reporting-loading')).toHaveCount(0);
}

async function gotoReports(page: Page): Promise<void> {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.locator('.applied-range')).toBeVisible();
}

function metric(page: Page, label: string): Locator {
  return page.locator('.report-metric', { has: page.locator('dt', { hasText: label }) }).locator('dd');
}

/** Read a table's body as an array of per-row cell-text arrays. */
async function tableRows(table: Locator): Promise<string[][]> {
  return table.locator('tbody tr').evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) =>
        (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    ),
  );
}

/** The From/To date inputs, scoped to the filter form. */
function dateField(page: Page, label: 'From' | 'To'): Locator {
  return page.locator('.report-filter label', { hasText: label }).locator('input');
}

async function applyRange(page: Page, from: string, to: string): Promise<void> {
  await dateField(page, 'From').fill(from);
  await dateField(page, 'To').fill(to);
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.locator('.applied-range strong')).toHaveText(
    `${shortDate(from)} to ${shortDate(to)}`,
  );
}

test.beforeAll(() => {
  variants = seedReportingCatalog(RUN);
  staffMemberId = ensureStaffMemberId();
});

// ---------------------------------------------------------------------------
// Scenario A — the full seeded dataset, with an open trading day.
// ---------------------------------------------------------------------------

test.describe('owner reporting — seeded trading days with an open day', () => {
  test.beforeAll(() => {
    seedFullScenario();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('crit 1: the dashboard shows a 14-day trend with cash and online separated', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const trend = page.locator('.sales-trend-panel');
    await expect(trend.getByRole('heading', { name: 'Sales trend' })).toBeVisible();
    // Cash and online are shown as distinct series, not one combined figure.
    await expect(trend.locator('.chart-legend')).toContainText('Cash');
    await expect(trend.locator('.chart-legend')).toContainText('Online');
    await expect(trend.locator('.sales-bar-cash')).toHaveCount(6);
    await expect(trend.locator('.sales-bar-online')).toHaveCount(6);

    // The readable equivalent of the chart.
    await trend.getByText('Read sales values').click();
    const rows = await tableRows(trend.getByRole('table', { name: 'Sales trend values' }));

    expect(rows).toEqual([
      [shortDate(DAY_BOUNDARY), '₱500.00', '₱300.00', '₱800.00'],
      [shortDate(DAY_FLOAT_ONLY), '₱0.00', '₱0.00', '₱0.00'],
      [shortDate(DAY_ZERO_COUNT), '₱0.00', '₱0.00', '₱0.00'],
      [shortDate(DAY_TWO_COUNTS), '₱200.00', '₱100.00', '₱300.00'],
      [shortDate(DAY_NO_COUNT), '₱130.00', '₱0.00', '₱130.00'],
      [shortDate(DAY_OPEN), '₱450.00', '₱400.00', '₱850.00'],
    ]);

    // Calendar dates inside the window with no trading day are omitted, and the
    // window starts on its inclusive lower bound.
    expect(rows[0]![0]).toBe(shortDate(WINDOW_FROM));
    expect(rows.map((row) => row[0])).not.toContain(shortDate(isoShift(TODAY, -12)));
  });

  test('crit 2: the dashboard summary reports the OPEN trading day, not the calendar date', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const summary = page.locator('.trading-summary');
    await expect(summary.getByRole('heading', { level: 2 })).toHaveText(
      'Current trading day',
    );
    await expect(summary.locator('.report-status')).toHaveText('Open');

    // The business date is two days behind "now" and is what the screen reports.
    expect(DAY_OPEN).not.toBe(TODAY);
    await expect(summary.locator('header')).toContainText(longDate(DAY_OPEN));
    await expect(summary.locator('header')).not.toContainText(longDate(TODAY));

    await expect(metric(page, 'Completed orders')).toHaveText('3');
    await expect(metric(page, 'Gross sales')).toHaveText('₱850.00');
    await expect(metric(page, 'Cash sales')).toHaveText('₱450.00');
    await expect(metric(page, 'Online sales')).toHaveText('₱400.00');
    // 85000 cents over 3 completed orders, rounded to the nearest cent.
    await expect(metric(page, 'Average order value')).toHaveText('₱283.33');
    await expect(metric(page, 'Cash tips')).toHaveText('₱30.00');

    // The void on this day reduced gross, cash and tips but is not an order,
    // and tips are excluded from gross sales.
    await expect(metric(page, 'Completed orders')).not.toHaveText('4');
  });

  test('crit 3: the dashboard shows best-selling products for the last 14 days', async ({
    page,
  }) => {
    await gotoDashboard(page);

    const items = page.locator('.product-bars li');
    // Ranked by revenue, capped at five base products, variants combined.
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText(product('alphaLarge'));
    await expect(items.nth(0)).toContainText('3 sold'); // 1 Large + 2 Small
    await expect(items.nth(0)).toContainText('₱900.00');
    await expect(items.nth(1)).toContainText(product('beta'));
    await expect(items.nth(1)).toContainText('₱500.00');
    await expect(items.nth(2)).toContainText(product('delta'));
    await expect(items.nth(2)).toContainText('₱350.00');
    await expect(items.nth(3)).toContainText(product('gamma'));
    await expect(items.nth(3)).toContainText('₱250.00');
    await expect(items.nth(4)).toContainText(product('epsilon'));

    // Sixth-ranked product is cut by the five-product cap.
    await expect(page.locator('.product-bars')).not.toContainText(product('zeta'));
  });

  test('crit 4: reports opens on the inclusive 14-date range ending on the shop date', async ({
    page,
  }) => {
    await gotoReports(page);

    await expect(dateField(page, 'From')).toHaveValue(WINDOW_FROM);
    await expect(dateField(page, 'To')).toHaveValue(TODAY);
    await expect(page.locator('.applied-range strong')).toHaveText(
      `${shortDate(WINDOW_FROM)} to ${shortDate(TODAY)}`,
    );
  });

  test('crit 6 + 7 + 8: totals and the daily reconciliation for the default range', async ({
    page,
  }) => {
    await gotoReports(page);

    const totals = page.locator('.report-totals');
    await expect(totals.locator('.report-metric', { hasText: 'Gross sales' })).toContainText(
      '₱2,080.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Cash sales' })).toContainText(
      '₱1,280.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Online sales' })).toContainText(
      '₱800.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Cash tips' })).toContainText(
      '₱60.00',
    );

    const rows = await tableRows(page.getByRole('table', { name: 'Daily reconciliation' }));

    // One row per TRADING DAY (not per calendar date), oldest to newest, with
    // date, status, cash, online, gross, tips, expected, actual and variance.
    expect(rows).toEqual([
      [DAY_BOUNDARY, 'Closed', '₱500.00', '₱300.00', '₱800.00', '₱20.00', '₱1,470.00', '₱1,470.00', '₱0.00'],
      [DAY_FLOAT_ONLY, 'Closed', '₱0.00', '₱0.00', '₱0.00', '₱0.00', '₱2,000.00', '₱1,950.00', 'Short₱-50.00'],
      [DAY_ZERO_COUNT, 'Closed', '₱0.00', '₱0.00', '₱0.00', '₱0.00', '₱0.00', '₱0.00', '₱0.00'],
      [DAY_TWO_COUNTS, 'Closed', '₱200.00', '₱100.00', '₱300.00', '₱10.00', '₱1,210.00', '₱1,240.00', 'Over₱30.00'],
      [DAY_NO_COUNT, 'Closed', '₱130.00', '₱0.00', '₱130.00', '₱0.00', '₱630.00', '—', '—'],
      [DAY_OPEN, 'Open', '₱450.00', '₱400.00', '₱850.00', '₱30.00', '₱1,955.00', '—', '—'],
    ]);

    // Calendar dates without a trading day produce no row.
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row[0])).not.toContain(isoShift(TODAY, -12));

    // crit 8 — the open day has an expected figure but a genuinely absent
    // actual and variance. "—", never ₱0.00.
    const openRow = rows[5]!;
    expect(openRow[6]).toBe('₱1,955.00');
    expect(openRow[7]).toBe('—');
    expect(openRow[8]).toBe('—');
    expect(openRow[7]).not.toBe('₱0.00');
    expect(openRow[8]).not.toBe('₱0.00');

    // A closed day that was never counted renders the same way …
    expect(rows[4]![7]).toBe('—');
    expect(rows[4]![8]).toBe('—');
    // … while a RECORDED zero count is ₱0.00 and is not treated as missing.
    expect(rows[2]![7]).toBe('₱0.00');
    expect(rows[2]![8]).toBe('₱0.00');

    // Tips move expected cash but never gross sales; a cash expense reduces
    // expected cash without appearing on screen.
    // DAY_OPEN: float 1500 + cash 450 + tips 30 − expense 25 = 1955.
    await expect(page.getByRole('table', { name: 'Daily reconciliation' })).not.toContainText(
      'Cash expenses',
    );
  });

  test('crit 9: product sales for the range show signed quantity and revenue per base product', async ({
    page,
  }) => {
    await gotoReports(page);

    const rows = await tableRows(page.getByRole('table', { name: 'Product sales' }));

    expect(rows).toEqual([
      [product('alphaLarge'), '3', '₱900.00'],
      [product('beta'), '2', '₱500.00'],
      [product('delta'), '4', '₱350.00'],
      [product('gamma'), '1', '₱250.00'],
      // Equal revenue falls back to alphabetical base-product name.
      [product('epsilon'), '1', '₱40.00'],
      [product('zeta'), '1', '₱40.00'],
    ]);
  });

  test('crit 5: choosing a different range shows results for that range only', async ({
    page,
  }) => {
    await gotoReports(page);
    await applyRange(page, DAY_FLOAT_ONLY, DAY_TWO_COUNTS);

    const rows = await tableRows(page.getByRole('table', { name: 'Daily reconciliation' }));
    // Range boundaries are inclusive on both ends.
    expect(rows.map((row) => row[0])).toEqual([
      DAY_FLOAT_ONLY,
      DAY_ZERO_COUNT,
      DAY_TWO_COUNTS,
    ]);

    const totals = page.locator('.report-totals');
    await expect(totals.locator('.report-metric', { hasText: 'Gross sales' })).toContainText(
      '₱300.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Cash sales' })).toContainText(
      '₱200.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Online sales' })).toContainText(
      '₱100.00',
    );
    await expect(totals.locator('.report-metric', { hasText: 'Cash tips' })).toContainText(
      '₱10.00',
    );

    // The void that reversed this purchase lives on DAY_OPEN, outside this
    // range, so the original day's figures are untouched by it.
    const products = await tableRows(page.getByRole('table', { name: 'Product sales' }));
    expect(products).toEqual([
      [product('gamma'), '1', '₱200.00'],
      [product('beta'), '1', '₱100.00'],
    ]);
  });

  test('crit 10: a range with no trading days shows the empty-state copy, not empty tables', async ({
    page,
  }) => {
    await gotoReports(page);
    // Two calendar dates that sit between seeded trading days.
    await applyRange(page, isoShift(TODAY, -12), isoShift(TODAY, -11));

    await expect(page.getByText('No days in this range.')).toBeVisible();
    await expect(page.getByText('No sales in this range.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Daily reconciliation' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Product sales' })).toHaveCount(0);

    const totals = page.locator('.report-totals');
    await expect(totals.locator('dd')).toHaveText(['₱0.00', '₱0.00', '₱0.00', '₱0.00']);
  });

  test('crit 10: trading days with no sales still list rows but show the no-sales copy', async ({
    page,
  }) => {
    await gotoReports(page);
    await applyRange(page, DAY_FLOAT_ONLY, DAY_FLOAT_ONLY);

    const rows = await tableRows(page.getByRole('table', { name: 'Daily reconciliation' }));
    expect(rows.map((row) => row[0])).toEqual([DAY_FLOAT_ONLY]);
    await expect(page.getByText('No sales in this range.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Product sales' })).toHaveCount(0);
  });

  test('crit 11: Export CSV downloads a named file carrying the on-screen values plus cash expenses', async ({
    page,
  }) => {
    await gotoReports(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);

    // The filename identifies From and To in ISO form.
    expect(download.suggestedFilename()).toBe(
      `ucm-report-${WINDOW_FROM}_to_${TODAY}.csv`,
    );

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString('utf8');
    const lines = csv.trim().split(/\r?\n/);

    expect(lines[0]).toBe(
      'Date,Status,Cash sales,Online sales,Gross,Tips,Cash expenses,Expected cash,Actual cash,Variance',
    );
    expect(lines.slice(1)).toEqual([
      `${DAY_BOUNDARY},closed,500.00,300.00,800.00,20.00,50.00,1470.00,1470.00,0.00`,
      `${DAY_FLOAT_ONLY},closed,0.00,0.00,0.00,0.00,0.00,2000.00,1950.00,-50.00`,
      `${DAY_ZERO_COUNT},closed,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00`,
      `${DAY_TWO_COUNTS},closed,200.00,100.00,300.00,10.00,0.00,1210.00,1240.00,30.00`,
      // Missing actual cash and variance are EMPTY fields, never 0.00.
      `${DAY_NO_COUNT},closed,130.00,0.00,130.00,0.00,0.00,630.00,,`,
      `${DAY_OPEN},open,450.00,400.00,850.00,30.00,25.00,1955.00,,`,
    ]);

    // The cash-expenses column exists in the CSV and nowhere on screen.
    expect(lines[1]!.split(',')[6]).toBe('50.00');
    await expect(page.locator('.reporting-page')).not.toContainText('Cash expenses');
  });

  test('crit 11: a valid range with no trading days exports a header-only CSV', async ({
    page,
  }) => {
    await gotoReports(page);
    const from = isoShift(TODAY, -12);
    const to = isoShift(TODAY, -11);
    await applyRange(page, from, to);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe(`ucm-report-${from}_to_${to}.csv`);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/)).toHaveLength(1);
  });

  test('edge: an invalid range is rejected inline, keeps the last results, and issues no request', async ({
    page,
  }) => {
    await gotoReports(page);
    await applyRange(page, DAY_FLOAT_ONLY, DAY_TWO_COUNTS);

    const reportRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/reporting/')) reportRequests.push(request.url());
    });

    // From later than To.
    await dateField(page, 'From').fill(DAY_OPEN);
    await expect(page.getByRole('alert')).toHaveText(
      'From date must be on or before To date.',
    );
    await expect(page.getByRole('button', { name: 'Apply range' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();

    // A blank date.
    await dateField(page, 'From').fill('');
    await expect(page.getByRole('alert')).toHaveText(
      'Choose both a From date and a To date.',
    );
    await expect(page.getByRole('button', { name: 'Apply range' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();

    // The last valid results stay on screen, and nothing was fetched.
    const rows = await tableRows(page.getByRole('table', { name: 'Daily reconciliation' }));
    expect(rows.map((row) => row[0])).toEqual([
      DAY_FLOAT_ONLY,
      DAY_ZERO_COUNT,
      DAY_TWO_COUNTS,
    ]);
    expect(reportRequests).toEqual([]);

    // No 500 and no leaked internals — v1 returned a SQL-bearing stack here.
    for (const query of [
      `from=${DAY_OPEN}&to=${DAY_FLOAT_ONLY}`,
      'from=&to=',
      `from=not-a-date&to=${TODAY}`,
    ]) {
      const response = await page.request.get(
        `${process.env.E2E_API_URL ?? 'http://127.0.0.1:3000'}/reporting/report?${query}`,
      );
      expect(response.status()).toBe(400);
      const body = await response.text();
      expect(body).not.toMatch(/select |from trading_days|prisma|postgres|at .*\.ts:\d+/i);
    }
  });

  test('crit 12: both screens are read-only and issue no non-GET request', async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    });

    await gotoDashboard(page);
    // No affordance to change anything on the dashboard.
    await expect(page.locator('.reporting-page').getByRole('button')).toHaveCount(0);
    await expect(page.locator('.reporting-page')).toContainText('Read-only');

    await gotoReports(page);
    // Filtering and exporting are the only controls.
    await expect(page.locator('.reporting-page').getByRole('button')).toHaveText([
      'Apply range',
      'Export CSV',
    ]);
    await expect(page.locator('.reporting-page')).toContainText('Read-only');

    await applyRange(page, DAY_FLOAT_ONLY, DAY_TWO_COUNTS);
    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);

    expect(writes).toEqual([]);

    // Viewing and exporting changed nothing: the reconciliation is unchanged.
    await page.reload();
    await expect(page.locator('.applied-range')).toBeVisible();
    const rows = await tableRows(page.getByRole('table', { name: 'Daily reconciliation' }));
    expect(rows).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Scenario B — no trading day is open. Runs after scenario A because it
// removes the open day the assertions above depend on.
// ---------------------------------------------------------------------------

test.describe('owner reporting — no trading day open', () => {
  test.beforeAll(() => {
    resetTradingDays();
    seedTradingDay(
      {
        businessDate: DAY_BOUNDARY,
        status: 'CLOSED',
        openingFloatCents: 100_000,
        cashCounts: [100_000],
      },
      staffMemberId,
    );
    seedTradingDay(
      {
        businessDate: DAY_TWO_COUNTS,
        status: 'CLOSED',
        openingFloatCents: 50_000,
        sales: [
          {
            cashCents: 10_000,
            lines: [
              {
                variant: variants.beta!,
                quantity: 1,
                unitPriceCents: 10_000,
                lineTotalCents: 10_000,
              },
            ],
          },
        ],
        cashCounts: [60_000],
      },
      staffMemberId,
    );
  });

  test('the dashboard degrades to the most recent CLOSED day, explicitly labelled', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoDashboard(page);

    const summary = page.locator('.trading-summary');
    await expect(summary.getByRole('heading', { level: 2 })).toHaveText(
      'Latest closed trading day',
    );
    await expect(summary.locator('.report-status')).toHaveText('Closed');
    await expect(summary.locator('header')).toContainText(longDate(DAY_TWO_COUNTS));
    await expect(metric(page, 'Gross sales')).toHaveText('₱100.00');
    await expect(metric(page, 'Completed orders')).toHaveText('1');
  });
});

// ---------------------------------------------------------------------------
// Scenario C — no trading day exists at all. Runs last: it empties the tables.
// ---------------------------------------------------------------------------

test.describe('owner reporting — no trading days at all', () => {
  test.beforeAll(() => {
    resetTradingDays();
  });

  test('the dashboard shows an explicit empty state, not blank tiles or zeros', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoDashboard(page);

    await expect(page.getByText('No trading day data yet.')).toBeVisible();
    await expect(page.locator('.trading-summary')).toHaveCount(0);
    await expect(page.locator('.report-metric')).toHaveCount(0);
    await expect(page.getByText('No sales trend data yet.')).toBeVisible();
    await expect(page.getByText('No sales in this range.')).toBeVisible();
  });

  test('reports shows both empty states and zero totals', async ({ page }) => {
    await signInAsAdmin(page);
    await gotoReports(page);

    await expect(page.getByText('No days in this range.')).toBeVisible();
    await expect(page.getByText('No sales in this range.')).toBeVisible();
    await expect(page.locator('.report-totals dd')).toHaveText([
      '₱0.00',
      '₱0.00',
      '₱0.00',
      '₱0.00',
    ]);
  });
});
