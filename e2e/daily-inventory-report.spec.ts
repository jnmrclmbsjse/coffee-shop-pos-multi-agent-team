import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  BANDS,
  closeReportDay,
  openReportDay,
  readStockCounts,
  resetInventoryReportWorld,
  seedReportCatalog,
  seedReportCount,
  seedReportMovement,
  seedReportMovements,
  seedReportStaff,
  setItemActive,
  snapshotInventoryWorld,
  STOCK_LEVELS,
  type ReportCatalog,
  type SeededDay,
  type SeededItem,
} from './fixtures/daily-inventory-report';

/**
 * End-to-end coverage for story #324 — "Review a business day's inventory
 * counts, cup-and-lid reconciliation and restock needs from the Reports area"
 * (QA task #328).
 *
 * The observable surface is `/reports/daily-inventory`, reached from the local
 * Sales / Daily inventory switch on `/reports`. It is served by
 * `GET /reporting/daily-inventory?date=…`, which is `@Roles(Role.ADMIN)`.
 *
 * Three things decide how this suite is written.
 *
 * **The arithmetic is the story.** Expected closing is
 * `opening + deliveries − wastage − sold`. A day whose four terms are equal, or
 * whose sold term is zero, passes an implementation that drops or transposes
 * one of them, so the fixture day gives every item four distinct non-zero
 * inputs and the spec asserts absolute values. Sold usage is drawn from real
 * orders placed through `POST /orders` — never seeded — because
 * `SaleLine.packagingServingsSnapshot` is written by `OrdersService` and a
 * seeded line would supply the column default of 1 and hide exactly the
 * multi-serving bug these assertions exist to catch
 * ([[e2e-seeded-sale-lines-hide-snapshot-bugs]]).
 *
 * **`null` is not `0`.** "No count was taken" renders as the literal
 * `Unavailable`, and every derived figure that needs it is Unavailable too. A
 * test that only checks "something is rendered" passes a `?? 0` bug, so the
 * unavailable cases assert the cell text is *not* `0`, and a genuine counted
 * zero is asserted separately so the screen cannot satisfy both by rendering
 * everything as Unavailable.
 *
 * **Read-only is proven by observation.** The suite records every request the
 * page issues and compares a full dump of counts, movements, sales, par levels
 * and cup/lid mappings before and after the report is used, rather than
 * inspecting the source for writes.
 *
 * Isolation follows the contract the packaging suite established: the report
 * resolves a day by date with no per-run scope and the orders API writes
 * against the single open day, so every test clears the trading-day world and
 * builds exactly the days it needs. Items are tagged per run because the
 * reconciliation table reads every reconciled QUANTITY item globally.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa324-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let catalog: ReportCatalog;
let staff: SeededItem;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  // Clearing first is what frees the previous run's opener to be deleted: a
  // staff member is only unreferenced once its trading days and counts are.
  resetInventoryReportWorld();
  staff = seedReportStaff(`QA Report Opener ${TAG}`);
  catalog = seedReportCatalog(TAG);
});

test.beforeEach(() => {
  resetInventoryReportWorld();
});

test.afterAll(() => {
  // Leave one open day and nothing recorded against it — the state the rest of
  // the suite and a developer opening the app both expect.
  resetInventoryReportWorld();
  openReportDay({ businessDate: businessDate(0), openedByStaffMemberId: staff.id });
});

// ---------------------------------------------------------------------------
// Dates, sign-in, navigation
// ---------------------------------------------------------------------------

/**
 * A business date this suite owns, far enough out that it cannot collide with
 * the days other suites seed (the packaging suite lives in 2027-06).
 */
function businessDate(offset: number): string {
  const base = Date.UTC(2027, 8, 1); // 2027-09-01
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/** The long business-date label the report renders, computed independently. */
function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

const LOCATION = 'UCM Coffee Studio';

function apiOrigin(baseURL: string | undefined): string {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL;
  const hostname = baseURL ? new URL(baseURL).hostname : '127.0.0.1';
  return `http://${hostname}:3000`;
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form autofocuses its first field on the next animation frame; waiting
  // for that stops it stealing focus mid-fill.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

/** Open the report on a chosen date and wait for the load to settle. */
async function gotoReport(page: Page, date?: string): Promise<void> {
  await page.goto('/reports/daily-inventory');
  await expect(page.getByRole('heading', { name: 'Daily inventory report' })).toBeVisible();
  if (date !== undefined) await selectDate(page, date);
  await settled(page);
}

/** Change the selected business day and wait for the refreshed report. */
async function selectDate(page: Page, date: string): Promise<void> {
  await page.locator('input[type="date"]').fill(date);
  await settled(page);
}

/**
 * Reload and return to the same business day.
 *
 * The date control is component state, so a bare reload silently drops back to
 * today — and a report of today's empty day would read as "the row vanished".
 */
async function reloadReport(page: Page, date: string): Promise<void> {
  await page.reload();
  await selectDate(page, date);
}

/**
 * Wait until the report has finished loading *and* is showing the date the
 * control holds — the applied-range line is what tells the two apart, so a
 * stale table cannot be read as a fresh one.
 */
async function settled(page: Page): Promise<void> {
  const requested = await page.locator('input[type="date"]').inputValue();
  await expect(page.locator('.applied-range strong')).toHaveText(
    `${longDate(requested)} · ${LOCATION}`,
  );
  await expect(page.locator('.reporting-content')).not.toHaveClass(/reporting-refreshing/);
}

function packagingRow(page: Page, item: SeededItem): Locator {
  return page
    .locator('.packaging-report-table tbody tr')
    .filter({ hasText: item.name });
}

function restockRow(page: Page, item: SeededItem): Locator {
  return page.locator('.restock-report-table tbody tr').filter({ hasText: item.name });
}

interface RenderedRow {
  opening: string;
  deliveries: string;
  wastage: string;
  sold: string;
  expected: string;
  actual: string;
  variance: string;
}

/** Every reconciliation cell for one item, as rendered text. */
async function readPackagingRow(page: Page, item: SeededItem): Promise<RenderedRow> {
  const row = packagingRow(page, item);
  await expect(row, `no reconciliation row for ${item.name}`).toHaveCount(1);
  const cells = row.locator('td');
  await expect(cells).toHaveCount(7);
  const text = await cells.allInnerTexts();
  const [opening, deliveries, wastage, sold, expected, actual, variance] = text.map(
    (value) => value.trim().replace(/\s+/g, ' '),
  );
  return {
    opening: opening!,
    deliveries: deliveries!,
    wastage: wastage!,
    sold: sold!,
    expected: expected!,
    actual: actual!,
    variance: variance!,
  };
}

// ---------------------------------------------------------------------------
// Placing real orders
// ---------------------------------------------------------------------------

interface PlacedOrder {
  clientGeneratedId: string;
  totalCents: number;
}

function deviceId(): string {
  return `qa324-${randomUUID()}`;
}

async function postOk(
  request: APIRequestContext,
  url: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await request.post(url, { data, failOnStatusCode: false });
  expect(
    response.ok(),
    `POST ${url} failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/** Park an order through the real order-capture API. */
async function parkOrder(
  request: APIRequestContext,
  origin: string,
  variantId: string,
  quantity: number,
): Promise<PlacedOrder> {
  const clientGeneratedId = randomUUID();
  const order = await postOk(request, `${origin}/orders`, {
    clientGeneratedId,
    deviceId: deviceId(),
    productVariantId: variantId,
    quantity,
    serviceType: 'TAKE_OUT',
  });
  return { clientGeneratedId, totalCents: Number(order.totalCents) };
}

/** Park, then settle in cash — the ordinary "a sale happened" path. */
async function sell(
  request: APIRequestContext,
  origin: string,
  variantId: string,
  quantity: number,
): Promise<PlacedOrder> {
  const order = await parkOrder(request, origin, variantId, quantity);
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/complete`, {
    payments: [{ method: 'CASH', amountCents: order.totalCents }],
  });
  return order;
}

/**
 * Record a void through the real correction path (ADR 0005/0006) — a deleted
 * sale would prove nothing, because the criterion is about a sale that still
 * exists and must nonetheless contribute no usage.
 */
async function voidOrder(
  request: APIRequestContext,
  origin: string,
  order: PlacedOrder,
): Promise<void> {
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/void`, {
    clientGeneratedId: randomUUID(),
    deviceId: deviceId(),
    voidReason: `QA report void ${TAG}`,
  });
}

// ---------------------------------------------------------------------------
// The arithmetic day
// ---------------------------------------------------------------------------

/**
 * One day's inputs per item. Every term is non-zero and no two terms of the
 * same row are equal, so a dropped or transposed term cannot still produce the
 * right expected figure.
 */
const DAY = {
  cup: { opening: 500, deliveries: 40, wastage: 6, sold: 11, actual: 520 },
  lidRegular: { opening: 300, deliveries: 25, wastage: 4, sold: 3, actual: 321 },
  lidLarge: { opening: 200, deliveries: 12, wastage: 9, sold: 8, actual: 195 },
  promoCup: { opening: 150, deliveries: 20, wastage: 5, sold: 12, actual: 148 },
  promoLid: { opening: 90, deliveries: 11, wastage: 2, sold: 12, actual: 95 },
} as const;

type ArithmeticKey = keyof typeof DAY;

/**
 * Expected closing and variance, computed here from the seeded inputs.
 *
 * Deliberately not imported from the app: reusing the product's own formula
 * would mirror a bug straight into the expectation.
 */
function expectedClosing(key: ArithmeticKey): number {
  const day = DAY[key];
  return day.opening + day.deliveries - day.wastage - day.sold;
}

function variance(key: ArithmeticKey): number {
  return DAY[key].actual - expectedClosing(key);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Seed the arithmetic day: opening count, deliveries, wastage, three completed
 * sales, one parked order, one voided sale, then the closing count.
 *
 * The parked and the voided order each draw items that *are* in the day, so an
 * implementation that counts them produces a wrong number rather than an extra
 * row that could be overlooked.
 */
async function seedArithmeticDay(
  request: APIRequestContext,
  origin: string,
  date: string,
): Promise<SeededDay> {
  const items = catalog.items;
  const day = openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });

  seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: (Object.keys(DAY) as ArithmeticKey[]).map((key) => ({
      inventoryItemId: items[key]!.id,
      quantity: DAY[key].opening,
    })),
  });

  seedReportMovements(
    date,
    (Object.keys(DAY) as ArithmeticKey[]).flatMap((key) => [
      { inventoryItemId: items[key]!.id, type: 'DELIVERY' as const, quantity: DAY[key].deliveries },
      { inventoryItemId: items[key]!.id, type: 'WASTAGE' as const, quantity: DAY[key].wastage },
    ]),
  );

  const house = catalog.products.house!.variants;
  const promo = catalog.products.promo!.variants;

  // Completed: 3 regular (cup + regular lid) and 8 large (the SAME cup, large
  // lid) — the shared cup must accumulate from both sizes.
  await sell(request, origin, house.regular!.id, 3);
  await sell(request, origin, house.large!.id, 8);
  // Completed: 4 of a 3-serving product — 12 cups and 12 lids, not 4.
  await sell(request, origin, promo.regular!.id, 4);
  // Parked: draws nothing.
  await parkOrder(request, origin, house.regular!.id, 6);
  // Completed then voided through the correction path: draws nothing.
  const voided = await sell(request, origin, house.large!.id, 9);
  await voidOrder(request, origin, voided);

  seedReportCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: (Object.keys(DAY) as ArithmeticKey[]).map((key) => ({
      inventoryItemId: items[key]!.id,
      quantity: DAY[key].actual,
    })),
  });

  return day;
}

// ---------------------------------------------------------------------------
// AC: access, navigation and authorization
// ---------------------------------------------------------------------------

test('an administrator reaches the report from the Reports area without passing through the staff closing workflow', async ({
  page,
}) => {
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });

  await signInAsAdmin(page);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);

  // The local report-type switch on /reports is the whole route in.
  await page
    .getByRole('navigation', { name: 'Report type' })
    .getByRole('link', { name: 'Daily inventory' })
    .click();
  await expect(page).toHaveURL(/\/reports\/daily-inventory$/);
  await expect(page.getByRole('heading', { name: 'Daily inventory report' })).toBeVisible();

  // Not one step of the journey entered the staff closing or restock screens.
  expect(
    visited.filter((url) => /\/pos(\/|$)/.test(new URL(url).pathname)),
    `admin route to the report passed through the staff workflow: ${visited.join(', ')}`,
  ).toEqual([]);
});

test('a staff user entering the report route directly sees no report data, and the API refuses it for every verb', async ({
  browser,
  page,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);

  await signInAsStaff(page);
  const staffState = await page.context().storageState();

  // Cold, direct entry on a fresh context — a hidden nav link is not
  // authorization, and navigating in-app would let the SPA's own guard mask
  // whether the route itself is reachable.
  const cold = await browser.newContext({ storageState: staffState, baseURL });
  const coldPage = await cold.newPage();
  await coldPage.goto('/reports/daily-inventory');
  await expect(coldPage).not.toHaveURL(/\/reports\/daily-inventory$/);
  await expect(
    coldPage.getByRole('heading', { name: 'Daily inventory report' }),
  ).toHaveCount(0);
  await expect(coldPage.locator('.packaging-report-table')).toHaveCount(0);
  await expect(coldPage.locator('.restock-report-table')).toHaveCount(0);
  await expect(coldPage.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  await cold.close();

  // The API is the real boundary. A STAFF session needs /auth/staff/login with
  // a deviceId — /auth/login 401s for staff, which would prove nothing.
  const login = await page.request.post(`${origin}/auth/staff/login`, {
    data: { username: STAFF_USERNAME, password: STAFF_PASSWORD, deviceId: deviceId() },
  });
  expect(login.ok(), await login.text()).toBeTruthy();

  const url = `${origin}/reporting/daily-inventory?date=${businessDate(0)}`;

  // The read verb the report actually uses is refused outright, not merely
  // emptied — 403, with no report body behind it.
  const read = await page.request.get(url, { failOnStatusCode: false });
  expect(read.status(), `GET ${url} for a staff session`).toBe(403);
  expect(await read.text()).not.toContain('reconciliation');

  // Every write verb is refused too. The report is a `@Get`-only resource, so
  // an unrouted verb answers 404/405 rather than 403; what the criterion needs
  // is that none of them succeeds and none returns report data.
  for (const [method, response] of [
    ['POST', await page.request.post(url, { data: {}, failOnStatusCode: false })],
    ['PATCH', await page.request.patch(url, { data: {}, failOnStatusCode: false })],
    ['PUT', await page.request.put(url, { data: {}, failOnStatusCode: false })],
    ['DELETE', await page.request.delete(url, { failOnStatusCode: false })],
  ] as const) {
    expect(response.ok(), `${method} ${url} must not succeed for staff`).toBe(false);
    expect([403, 404, 405], `${method} ${url} → ${response.status()}`).toContain(
      response.status(),
    );
    expect(await response.text()).not.toContain('reconciliation');
  }

  // Control: the same URL serves an ADMIN, so a blanket route failure cannot
  // masquerade as a passing authorization test.
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  await signInAsAdmin(adminPage);
  const allowed = await adminPage.request.get(url, { failOnStatusCode: false });
  expect(allowed.status(), `GET ${url} for an admin session`).toBe(200);
  expect(await allowed.text()).toContain('reconciliation');
  await adminContext.close();
});

test('an administrator sees the selected business day and location, defaulting to today', async ({
  page,
  baseURL,
}) => {
  await signInAsAdmin(page);
  await seedArithmeticDay(page.request, apiOrigin(baseURL), businessDate(0));

  await page.goto('/reports/daily-inventory');
  await expect(page.getByRole('heading', { name: 'Daily inventory report' })).toBeVisible();

  // The control opens on today's shop date (Asia/Manila).
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await expect(page.locator('input[type="date"]')).toHaveValue(today);
  await settled(page);
  await expect(page.locator('.reporting-context')).toContainText(longDate(today));
  await expect(page.locator('.reporting-context')).toContainText(LOCATION);

  // Choosing another day re-labels the report with that day and location.
  await selectDate(page, businessDate(0));
  await expect(page.locator('.applied-range strong')).toHaveText(
    `${longDate(businessDate(0))} · ${LOCATION}`,
  );
  await expect(page.locator('.packaging-report-table')).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC: cup-and-lid reconciliation arithmetic
// ---------------------------------------------------------------------------

test('every cup and lid shows opening, deliveries, wastage, sold, expected, actual and variance, with parked and voided orders drawing nothing', async ({
  page,
  baseURL,
}) => {
  const date = businessDate(0);
  await signInAsAdmin(page);
  await seedArithmeticDay(page.request, apiOrigin(baseURL), date);
  await gotoReport(page, date);

  for (const key of Object.keys(DAY) as ArithmeticKey[]) {
    const day = DAY[key];
    const rendered = await readPackagingRow(page, catalog.items[key]!);
    expect(rendered, `reconciliation row for ${key}`).toEqual({
      opening: String(day.opening),
      deliveries: String(day.deliveries),
      wastage: String(day.wastage),
      sold: String(day.sold),
      expected: String(expectedClosing(key)),
      actual: String(day.actual),
      variance: `${signed(variance(key))} ${
        // The label is upper-cased by the stylesheet, and innerText reads
        // what is rendered rather than what the JSX holds.
        variance(key) > 0 ? 'SURPLUS' : variance(key) < 0 ? 'SHORT' : 'EVEN'
      }`,
    });
  }

  // The shared cup accumulated from BOTH sizes (3 regular + 8 large), and the
  // 3-serving promo drew 3 per item sold rather than 1 — the two arithmetic
  // failures a single-size, single-serving fixture would let through.
  expect(DAY.cup.sold).toBe(3 + 8);
  expect(DAY.promoCup.sold).toBe(4 * 3);
});

test('the sold column moves by exactly the servings a further sale draws', async ({
  page,
  baseURL,
}) => {
  // A mutation check on the assertion above: if the sold figure were a constant
  // — or the servings multiplier ignored — one more 3-serving sale would not
  // move it by exactly 3.
  const date = businessDate(0);
  const origin = apiOrigin(baseURL);
  await signInAsAdmin(page);
  await seedArithmeticDay(page.request, origin, date);
  await gotoReport(page, date);

  const before = await readPackagingRow(page, catalog.items.promoCup!);
  expect(before.sold).toBe(String(DAY.promoCup.sold));

  await sell(page.request, origin, catalog.products.promo!.variants.regular!.id, 1);
  await reloadReport(page, date);

  const after = await readPackagingRow(page, catalog.items.promoCup!);
  expect(Number(after.sold) - Number(before.sold)).toBe(3);
  expect(Number(after.expected)).toBe(Number(before.expected) - 3);
  expect(Number(after.variance.split(' ')[0])).toBe(Number(before.variance.split(' ')[0]) + 3);
});

test('variance is signed: surplus positive, shortage negative, exact match zero', async ({
  page,
  baseURL,
}) => {
  const date = businessDate(0);
  await signInAsAdmin(page);
  await seedArithmeticDay(page.request, apiOrigin(baseURL), date);
  await gotoReport(page, date);

  // lidRegular is counted above expectation, cup below it, lidLarge exactly.
  expect(variance('lidRegular')).toBeGreaterThan(0);
  expect(variance('cup')).toBeLessThan(0);
  expect(variance('lidLarge')).toBe(0);

  const surplus = packagingRow(page, catalog.items.lidRegular!).locator('.variance');
  await expect(surplus).toHaveClass(/variance-over/);
  await expect(surplus.locator('.num')).toHaveText(`+${variance('lidRegular')}`);

  const shortage = packagingRow(page, catalog.items.cup!).locator('.variance');
  await expect(shortage).toHaveClass(/variance-short/);
  // A shortage must not be rendered as a positive number.
  await expect(shortage.locator('.num')).toHaveText(String(variance('cup')));
  expect(String(variance('cup')).startsWith('-')).toBe(true);

  const even = packagingRow(page, catalog.items.lidLarge!).locator('.variance');
  await expect(even).toHaveClass(/variance-even/);
  await expect(even.locator('.num')).toHaveText('0');
  await expect(even).not.toContainText('Unavailable');
});

// ---------------------------------------------------------------------------
// AC: corrections follow the chain, originals are preserved
// ---------------------------------------------------------------------------

test('the report uses the latest corrected opening and closing counts, keeps the originals, and follows the chain rather than the clock', async ({
  page,
}) => {
  const date = businessDate(1);
  const item = catalog.items.cup!;
  await signInAsAdmin(page);

  const day = openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  const originalOpening = seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 100 }],
  });
  const originalClosing = seedReportCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 60 }],
  });
  seedReportMovement({
    businessDate: date,
    inventoryItemId: item.id,
    type: 'DELIVERY',
    quantity: 30,
  });
  seedReportMovement({
    businessDate: date,
    inventoryItemId: item.id,
    type: 'WASTAGE',
    quantity: 5,
  });

  // Before any correction: expected 100 + 30 − 5 − 0 = 125, actual 60.
  await gotoReport(page, date);
  expect(await readPackagingRow(page, item)).toMatchObject({
    opening: '100',
    expected: '125',
    actual: '60',
    variance: '-65 SHORT',
  });

  // Correct the opening upward and the closing downward. The opening
  // correction is stamped a full day BEFORE the row it corrects: the chain
  // decides, not the clock.
  const correctedOpening = seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 140 }],
    correctsStockCountId: originalOpening,
    recordedAtOffsetMs: -86_400_000,
  });
  seedReportCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 55 }],
    correctsStockCountId: originalClosing,
  });

  await reloadReport(page, date);
  expect(await readPackagingRow(page, item)).toMatchObject({
    opening: '140',
    expected: '165',
    actual: '55',
    variance: '-110 SHORT',
  });

  // A second link in the opening chain is followed all the way to its leaf.
  seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 200 }],
    correctsStockCountId: correctedOpening,
  });
  await reloadReport(page, date);
  expect(await readPackagingRow(page, item)).toMatchObject({
    opening: '200',
    expected: '225',
    actual: '55',
  });

  // Counts are append-only: every original submission still exists, unchanged.
  const stored = readStockCounts(date);
  expect(stored).toHaveLength(5);
  const openingOriginal = stored.find((count) => count.id === originalOpening);
  expect(openingOriginal?.correctsStockCountId).toBeNull();
  expect(openingOriginal?.lines[0]?.quantity).toBe(100);
  const closingOriginal = stored.find((count) => count.id === originalClosing);
  expect(closingOriginal?.lines[0]?.quantity).toBe(60);

  closeReportDay(day.id, staff.id);
});

// ---------------------------------------------------------------------------
// AC: Unavailable is not zero
// ---------------------------------------------------------------------------

test('a missing opening count leaves opening, expected and variance Unavailable while the actual closing is still shown', async ({
  page,
}) => {
  const date = businessDate(2);
  const item = catalog.items.cup!;
  await signInAsAdmin(page);
  openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: [{ inventoryItemId: item.id, quantity: 77 }],
  });

  await gotoReport(page, date);
  const rendered = await readPackagingRow(page, item);
  expect(rendered.opening).toBe('Unavailable');
  expect(rendered.expected).toBe('Unavailable');
  expect(rendered.variance).toBe('Unavailable');
  expect(rendered.actual).toBe('77');
  // The `?? 0` bug this criterion exists to catch.
  for (const cell of [rendered.opening, rendered.expected, rendered.variance]) {
    expect(cell).not.toBe('0');
  }
});

test('a missing closing count leaves the actual and the variance Unavailable but still shows the expected figure', async ({
  page,
}) => {
  const date = businessDate(3);
  const item = catalog.items.cup!;
  await signInAsAdmin(page);
  openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [
      { inventoryItemId: item.id, quantity: 64 },
      // A genuine counted zero, on the same screen: without it, every
      // assertion above could be satisfied by rendering everything Unavailable.
      { inventoryItemId: catalog.items.lidRegular!.id, quantity: 0 },
    ],
  });
  seedReportMovement({
    businessDate: date,
    inventoryItemId: item.id,
    type: 'DELIVERY',
    quantity: 6,
  });

  await gotoReport(page, date);
  const rendered = await readPackagingRow(page, item);
  // Expected does not depend on the closing count: 64 + 6 − 0 − 0.
  expect(rendered.expected).toBe('70');
  expect(rendered.actual).toBe('Unavailable');
  expect(rendered.variance).toBe('Unavailable');
  expect(rendered.actual).not.toBe('0');

  const zeroed = await readPackagingRow(page, catalog.items.lidRegular!);
  expect(zeroed.opening).toBe('0');
  expect(zeroed.expected).toBe('0');
  expect(zeroed.actual).toBe('Unavailable');
  // A real zero and an absent count are visibly different things.
  expect(zeroed.opening).not.toBe(rendered.actual);
});

test('with neither count taken, every derived figure is Unavailable and the day still reports its movements', async ({
  page,
}) => {
  const date = businessDate(4);
  const item = catalog.items.cup!;
  await signInAsAdmin(page);
  openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedReportMovement({
    businessDate: date,
    inventoryItemId: item.id,
    type: 'WASTAGE',
    quantity: 4,
  });

  await gotoReport(page, date);
  const rendered = await readPackagingRow(page, item);
  expect(rendered).toMatchObject({
    opening: 'Unavailable',
    deliveries: '0',
    wastage: '4',
    sold: '0',
    expected: 'Unavailable',
    actual: 'Unavailable',
    variance: 'Unavailable',
  });

  // No count at all — the restock section says so instead of listing nothing.
  await expect(page.locator('.restock-report-table')).toHaveCount(0);
  await expect(page.getByText('No count submitted for this day')).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC: restock needs
// ---------------------------------------------------------------------------

/** Seed a restock day whose count exercises all four bands and both targets. */
function seedRestockCount(date: string, phase: 'OPEN' | 'CLOSE'): void {
  const items = catalog.items;
  seedReportCount({
    businessDate: date,
    phase,
    submittedBy: staff,
    lines: [
      { inventoryItemId: items.urgentCritical!.id, quantity: 5 },
      { inventoryItemId: items.urgentPlain!.id, quantity: 8 },
      { inventoryItemId: items.lowEarly!.id, quantity: 15 },
      { inventoryItemId: items.lowLate!.id, quantity: 18 },
      { inventoryItemId: items.belowPar!.id, quantity: 30 },
      { inventoryItemId: items.enough!.id, quantity: 45 },
      // Both "no applicable target" shapes, counted far below every threshold
      // the other items use — they are Enough purely because no target applies.
      { inventoryItemId: items.unmanaged!.id, quantity: 1 },
      { inventoryItemId: items.peakOnly!.id, quantity: 1 },
      // A level-counted item shares the list with the quantity-counted ones.
      { inventoryItemId: items.levelQUARTER!.id, level: 'QUARTER' },
    ],
  });
}

test('the restock list shows counted amount, target and urgency, ordered by status then Critical then name', async ({
  page,
}) => {
  const date = businessDate(5);
  await signInAsAdmin(page);
  openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedRestockCount(date, 'CLOSE');
  await gotoReport(page, date);

  const items = catalog.items;
  const target = String(BANDS.parQty);
  const expected: Array<[SeededItem, string, string, string]> = [
    // URGENT: Critical first even though it sorts last alphabetically — the
    // only arrangement that tells the two ordering rules apart.
    [items.urgentCritical!, '5', target, 'Urgent'],
    [items.urgentPlain!, '8', target, 'Urgent'],
    // LOW: no Critical among them, so the alphabet decides.
    [items.lowEarly!, '15', target, 'Low'],
    [items.levelQUARTER!, 'Quarter', 'Unavailable', 'Low'],
    [items.lowLate!, '18', target, 'Low'],
    [items.belowPar!, '30', target, 'Below par'],
  ];

  for (const [item, counted, itemTarget, status] of expected) {
    const cells = restockRow(page, item).locator('td');
    await expect(cells, `restock cells for ${item.name}`).toHaveCount(3);
    await expect(cells.nth(0)).toHaveText(counted);
    await expect(cells.nth(1)).toHaveText(itemTarget);
    await expect(cells.nth(2)).toHaveText(status);
  }

  // An item with no applicable target reads Unavailable, never 0.
  await expect(restockRow(page, items.levelQUARTER!).locator('td').nth(1)).not.toHaveText('0');

  // Enough is not listed. `unmanaged` has no par row and `peakOnly` has one for
  // the other day type: both were counted at 1 and are listed nowhere, because
  // a quantity item with no applicable target carries no thresholds either.
  for (const absent of [items.enough!, items.unmanaged!, items.peakOnly!]) {
    await expect(restockRow(page, absent), `${absent.name} should not be listed`).toHaveCount(0);
  }

  // Order on screen matches the order asserted above.
  const names = await page.locator('.restock-report-table tbody tr th').allInnerTexts();
  const mine = names
    .map((name) => name.replace(/\s*Critical\s*$/, '').trim())
    .filter((name) => name.startsWith('QA Report'));
  expect(mine).toEqual(expected.map(([item]) => item.name));

  // Critical is marked, so the reason it sorted first is visible.
  await expect(
    restockRow(page, items.urgentCritical!).locator('.critical-marker'),
  ).toHaveText('Critical');
});

test('the restock list uses the closing count when there is one and the opening count otherwise, and says which', async ({
  page,
}) => {
  const openOnly = businessDate(6);
  await signInAsAdmin(page);
  const day = openReportDay({ businessDate: openOnly, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: openOnly,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [{ inventoryItemId: catalog.items.urgentPlain!.id, quantity: 3 }],
  });

  await gotoReport(page, openOnly);
  await expect(page.locator('.restock-copy').first()).toContainText(
    'uses the opening count submitted on',
  );
  await expect(restockRow(page, catalog.items.urgentPlain!).locator('td').nth(0)).toHaveText('3');

  // Add a closing count for the SAME day: the list switches to it and the
  // label changes with it. Asserting both is what stops a hardcoded string.
  seedReportCount({
    businessDate: openOnly,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: [{ inventoryItemId: catalog.items.urgentPlain!.id, quantity: 7 }],
  });
  await reloadReport(page, openOnly);
  await expect(page.locator('.restock-copy').first()).toContainText(
    'uses the closing count submitted on',
  );
  await expect(page.locator('.restock-copy').first()).not.toContainText(
    'uses the opening count',
  );
  await expect(restockRow(page, catalog.items.urgentPlain!).locator('td').nth(0)).toHaveText('7');

  closeReportDay(day.id, staff.id);
});

test('a level-counted item shows its level, has no target, and never appears in the cup and lid reconciliation', async ({
  page,
}) => {
  const date = businessDate(7);
  await signInAsAdmin(page);
  openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: STOCK_LEVELS.map((level) => ({
      inventoryItemId: catalog.items[`level${level}`]!.id,
      level,
    })),
  });
  await gotoReport(page, date);

  const bands: Record<string, string | null> = {
    EMPTY: 'Urgent',
    LOW: 'Urgent',
    QUARTER: 'Low',
    ONE_THIRD: 'Low',
    HALF: 'Below par',
    TWO_THIRDS: 'Below par',
    THREE_QUARTERS: null,
    FULL: null,
  };
  const labels: Record<string, string> = {
    EMPTY: 'Empty',
    LOW: 'Low',
    QUARTER: 'Quarter',
    ONE_THIRD: 'One-third',
    HALF: 'Half',
    TWO_THIRDS: 'Two-thirds',
    THREE_QUARTERS: 'Three-quarters',
    FULL: 'Full',
  };

  for (const level of STOCK_LEVELS) {
    const item = catalog.items[`level${level}`]!;
    const row = restockRow(page, item);
    if (bands[level] === null) {
      // Three-quarters and Full are Enough, so they are not listed at all.
      await expect(row, `${level} should not be listed`).toHaveCount(0);
      continue;
    }
    const cells = row.locator('td');
    await expect(cells, `restock cells for ${level}`).toHaveCount(3);
    // The level is shown rather than a quantity, and it has no numeric target.
    await expect(cells.nth(0)).toHaveText(labels[level]!);
    await expect(cells.nth(1)).toHaveText('Unavailable');
    await expect(cells.nth(2)).toHaveText(bands[level]!);

    // A level has no numeric quantity to reconcile against, so it must never
    // reach the cup/lid arithmetic table.
    await expect(
      packagingRow(page, item),
      `${level} must not appear in the reconciliation table`,
    ).toHaveCount(0);
  }
});

test('a day where nothing needs restocking says so, and reads differently from a day with no data at all', async ({
  page,
}) => {
  const stocked = businessDate(8);
  await signInAsAdmin(page);
  const day = openReportDay({ businessDate: stocked, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: stocked,
    phase: 'CLOSE',
    submittedBy: staff,
    lines: [
      { inventoryItemId: catalog.items.enough!.id, quantity: 90 },
      { inventoryItemId: catalog.items.levelFULL!.id, level: 'FULL' },
    ],
  });

  await gotoReport(page, stocked);
  await expect(page.getByText('Nothing needs restocking')).toBeVisible();
  await expect(page.locator('.restock-report-table')).toHaveCount(0);
  await expect(page.getByText('No count submitted for this day')).toHaveCount(0);
  closeReportDay(day.id, staff.id);

  // The no-data day is a different message, not the same empty box.
  const barren = businessDate(9);
  openReportDay({ businessDate: barren, openedByStaffMemberId: staff.id });
  await selectDate(page, barren);
  await expect(page.getByText('Nothing reportable for this opened day')).toBeVisible();
  await expect(page.getByText('Nothing needs restocking')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// AC: historical days and empty states
// ---------------------------------------------------------------------------

test('an item deactivated after the selected day still appears on that day’s report', async ({
  page,
}) => {
  const date = businessDate(10);
  const retired = catalog.items.historicCup!;
  await signInAsAdmin(page);
  const day = openReportDay({ businessDate: date, openedByStaffMemberId: staff.id });
  seedReportCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: [{ inventoryItemId: retired.id, quantity: 42 }],
  });

  await gotoReport(page, date);
  await expect(packagingRow(page, retired)).toHaveCount(1);

  // Retire it *after* the day it participated in.
  setItemActive(retired.id, false);
  try {
    await reloadReport(page, date);
    const rendered = await readPackagingRow(page, retired);
    expect(rendered.opening).toBe('42');
  } finally {
    setItemActive(retired.id, true);
    closeReportDay(day.id, staff.id);
  }
});

test('a day for which no business day was ever opened shows the empty state, not an error and not a table of zeroes', async ({
  page,
}) => {
  const never = businessDate(11);
  await signInAsAdmin(page);
  await gotoReport(page, never);

  await expect(page.getByText('Business day not opened')).toBeVisible();
  await expect(page.locator('.report-empty')).toContainText(longDate(never));
  await expect(page.locator('.report-empty')).toContainText(LOCATION);
  await expect(page.locator('.packaging-report-table')).toHaveCount(0);
  await expect(page.locator('.restock-report-table')).toHaveCount(0);
  await expect(page.locator('.reporting-notice')).toHaveCount(0);
});

test('switching from a populated day to an empty one and back leaves no stale figures under the new date', async ({
  page,
  baseURL,
}) => {
  const populated = businessDate(0);
  const empty = businessDate(11);
  await signInAsAdmin(page);
  const day = await seedArithmeticDay(page.request, apiOrigin(baseURL), populated);

  await gotoReport(page, populated);
  await expect(packagingRow(page, catalog.items.cup!)).toHaveCount(1);

  await selectDate(page, empty);
  await expect(page.locator('.applied-range strong')).toHaveText(
    `${longDate(empty)} · ${LOCATION}`,
  );
  await expect(page.locator('.packaging-report-table')).toHaveCount(0);
  await expect(
    page.getByText(String(DAY.cup.opening), { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Business day not opened')).toBeVisible();

  await selectDate(page, populated);
  expect(await readPackagingRow(page, catalog.items.cup!)).toMatchObject({
    opening: String(DAY.cup.opening),
    expected: String(expectedClosing('cup')),
  });
  closeReportDay(day.id, staff.id);
});

// ---------------------------------------------------------------------------
// AC: the report is read-only
// ---------------------------------------------------------------------------

test('loading the report and changing the day issue no write request and change no stored data', async ({
  page,
  baseURL,
}) => {
  const populated = businessDate(0);
  const other = businessDate(11);
  const origin = apiOrigin(baseURL);
  await signInAsAdmin(page);
  await seedArithmeticDay(page.request, origin, populated);

  const before = snapshotInventoryWorld();

  // Record every request the page makes from the moment the report opens.
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(origin)) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  });

  await gotoReport(page, populated);
  await selectDate(page, other);
  await selectDate(page, populated);

  expect(requests.length, 'the report issued no API request at all').toBeGreaterThan(0);
  expect(
    requests.filter((entry) => !entry.startsWith('GET ')),
    `the read-only report issued a write: ${requests.join(', ')}`,
  ).toEqual([]);

  // Nothing on the page offers to change anything: the only control is the
  // date, and every link leads away to another read surface.
  await expect(page.locator('.reporting-content button')).toHaveCount(0);
  const inputs = page.locator('.reporting-page input');
  await expect(inputs).toHaveCount(1);
  await expect(inputs).toHaveAttribute('type', 'date');

  // Counts, movements, sales, par levels and cup/lid mappings are untouched.
  expect(snapshotInventoryWorld()).toBe(before);
});
