import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  countCashCounts,
  openBusinessDayDirect,
  readDayClosings,
  readTradingDays,
  resetBusinessDayWorld,
  seedCashMovement,
  seedDrinkVariant,
  seedPackagingItems,
  seedSale,
  seedStaffMembers,
  seedStockCount,
  seedStockMovement,
  withNoReconciledItems,
  type SeededPackagingItem,
  type SeededStaff,
  type SeededVariant,
} from './fixtures/business-day';

/**
 * End-to-end coverage for story #123 — "Open and close the daily business day"
 * (QA task #132).
 *
 * Screens under test (apps/web/src/App.tsx):
 *   /pos/open   /pos/close
 *
 * Every acceptance criterion runs through the real browser → web app → NestJS
 * API → PostgreSQL path. The only intercepted request is the pair of
 * double-submit tests, which hold the submit POST open so the in-flight window
 * is observable; the request itself still reaches the API, and the criterion is
 * then asserted as an *outcome* (exactly one open day / exactly one closing
 * record) rather than as a disabled button.
 *
 * Fixture isolation. This story is the thing that opens and closes days, so
 * unlike #108 the suite cannot lean on a shared open day: a test that closes one
 * would leave the environment unusable for the next. Every test therefore starts
 * from a cleared trading-day world (`resetBusinessDayWorld`) and opens exactly
 * the day it needs — through the UI where the opening screen is the subject,
 * directly through Prisma where an open day is only a precondition. The specs
 * run serially for the same reason: both screens read "the current open business
 * day" globally, with no per-run scope.
 *
 * Packaging assertions are scoped to this run's own tagged items, because the
 * persistent dev database carries reconciled cup/lid rows left behind by earlier
 * runs. The packaging empty state is the one exception and is served by
 * `withNoReconciledItems`, which restores the prior set afterwards.
 *
 * Seeded-but-uncapturable data. Cash sales, online sales, tips, change owed and
 * the three drawer movements have no capture workflow in v1 (both MISSING
 * FOUNDATION notes on #123, ADR 0006 §7). Two tests cover the two states that
 * matters in: one asserts the rows are present and labelled as genuine ₱0.00 on
 * a day with no records at all, and one seeds every term so the ADR 0006 §2
 * expected-cash formula and the online-sales exclusion are real assertions
 * rather than vacuous ones.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa123-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let staff: Record<string, SeededStaff>;
let items: Record<string, SeededPackagingItem>;
let latte: SeededVariant;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  staff = seedStaffMembers({
    ada: { displayName: `QA Ada Opener ${TAG}`, isActive: true },
    bruno: { displayName: `QA Bruno Closer ${TAG}`, isActive: true },
    zara: { displayName: `QA Zara Retired ${TAG}`, isActive: false },
  });
  items = seedPackagingItems(TAG, {
    cup: { name: `QA Cup 12oz ${TAG}`, unit: 'pcs' },
    lid: { name: `QA Lid 12oz ${TAG}`, unit: 'pcs' },
    zeroCup: { name: `QA Cup 8oz ${TAG}`, unit: 'pcs' },
    uncounted: { name: `QA Sleeve ${TAG}`, unit: 'pcs' },
  });
  latte = seedDrinkVariant(TAG, items.cup.id, items.lid.id);
});

test.beforeEach(() => {
  resetBusinessDayWorld();
});

test.afterAll(() => {
  // Leave the environment with one open day and nothing recorded against it —
  // the state a developer opening the app, and the rest of the suite, expects.
  resetBusinessDayWorld();
  openBusinessDayDirect({
    businessDate: businessDate(1),
    dayType: 'NORMAL',
    openingFloatCents: 0,
    openedByStaffMemberId: staff.ada.id,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A business date this suite owns. Dates are far enough out that they never
 * collide with the trading days other suites seed, and `offset` keeps each test
 * on its own date so a leaked row is obvious rather than silently reused.
 */
function businessDate(offset: number): string {
  const base = Date.UTC(2027, 2, 1); // 2027-03-01
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/** The business date exactly as both screens render it (StaffTradingDayPages.tsx). */
function businessDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
}

/** Money exactly as the screens render it (apps/web/src/reporting/format.ts). */
function money(centsValue: number): string {
  const absolute = Math.abs(centsValue);
  const pesos = new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 0,
  }).format(Math.trunc(absolute / 100));
  const centavos = String(absolute % 100).padStart(2, '0');
  return `₱${centsValue < 0 ? '-' : ''}${pesos}.${centavos}`;
}

/**
 * The API origin, on the same hostname the page is served from. The session
 * cookie is SameSite=Lax, so a replayed request issued against a different
 * spelling of localhost would travel without it and 401 for the wrong reason.
 */
function apiOrigin(baseURL: string | undefined): string {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL;
  const hostname = baseURL ? new URL(baseURL).hostname : '127.0.0.1';
  return `http://${hostname}:3000`;
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form auto-focuses its first field on the next animation frame; waiting
  // for that stops it stealing focus mid-fill.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

/**
 * Navigate to a screen and wait for it to finish loading. `.staff-inventory-screen`
 * is the shell both pages render, so also wait for the loading indicator to go.
 */
async function gotoScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
}

async function fillOpenForm(
  page: Page,
  input: {
    date?: string;
    dayType?: 'Normal day' | 'Peak day';
    float?: string;
    openedBy?: string;
  },
): Promise<void> {
  if (input.date !== undefined) {
    await page.locator('#businessDate').fill(input.date);
  }
  if (input.dayType !== undefined) {
    await page.getByRole('radio', { name: input.dayType }).check();
  }
  if (input.float !== undefined) {
    await page.locator('#openingFloat').fill(input.float);
  }
  if (input.openedBy !== undefined) {
    await page.locator('#openedBy').selectOption({ label: input.openedBy });
  }
}

function openDayButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Open day' });
}

function closeDayButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Close day' });
}

/** The open-day summary's `<dd>` for one labelled fact. */
function summaryValue(page: Page, term: string): Locator {
  return page
    .locator('.staff-day-summary-list > div')
    .filter({ has: page.getByText(term, { exact: true }) })
    .locator('dd');
}

/** The packaging row for one reconciled item, as `[expected, actual, variance]`. */
function packagingRow(page: Page, itemName: string): Locator {
  return page
    .locator('.staff-packaging-table tbody tr')
    .filter({ hasText: itemName });
}

async function packagingCells(
  page: Page,
  itemName: string,
): Promise<{ expected: string; actual: string; variance: string }> {
  const cells = packagingRow(page, itemName).locator('td');
  await expect(cells).toHaveCount(3);
  const [expected, actual, variance] = await cells.allInnerTexts();
  return {
    expected: expected!.trim(),
    actual: actual!.trim(),
    variance: variance!.trim(),
  };
}

/**
 * The cash summary as an ordered list of `{ label, value }`. The label is the
 * `<dt>`'s own text only — the explanatory `<small>` note is read separately so
 * a copy change to a note cannot silently break a row assertion.
 */
async function cashSummaryRows(
  page: Page,
): Promise<Array<{ label: string; note: string | null; value: string }>> {
  return page
    .locator('.staff-cash-summary > div')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const term = node.querySelector('dt');
        const note = term?.querySelector('small');
        const label = Array.from(term?.childNodes ?? [])
          .filter((child) => child.nodeType === 3)
          .map((child) => child.textContent ?? '')
          .join('')
          .trim();
        return {
          label,
          note: note?.textContent?.trim() ?? null,
          value: node.querySelector('dd')?.textContent?.trim() ?? '',
        };
      }),
    );
}

async function cashValue(page: Page, label: string): Promise<string> {
  const rows = await cashSummaryRows(page);
  const row = rows.find((candidate) => candidate.label === label);
  expect(row, `no cash summary row labelled "${label}"`).toBeTruthy();
  return row!.value;
}

function discrepancy(page: Page): Locator {
  return page.locator('.staff-discrepancy strong');
}

/**
 * Seed the fully-populated day the cash and packaging assertions are made
 * against. Returns the trading day and the arithmetic the criteria pin.
 *
 * The parked order and the voided pair deliberately carry no payments and no
 * tip: the criteria constrain them only on the packaging side ("parked orders
 * contribute nothing"; "a sale that is later voided and its void record both
 * contribute nothing"), and a parked order has by definition not been tendered.
 * Leaving them out of the cash arithmetic keeps every cash assertion pinned to
 * behaviour the criteria actually state.
 */
function seedFullDay(date: string): {
  tradingDayId: string;
  openingFloatCents: number;
  cashSalesCents: number;
  onlineSalesCents: number;
  cashTipsCents: number;
  cashInCents: number;
  cashOutCents: number;
  cashExpensesCents: number;
  outstandingChangeCents: number;
  expectedCashCents: number;
} {
  const day = openBusinessDayDirect({
    businessDate: date,
    dayType: 'NORMAL',
    openingFloatCents: 100_000,
    openedByStaffMemberId: staff.ada.id,
  });

  // Completed cash sale: ₱500.00 cash, ₱20.00 tip, ₱15.00 change still owed.
  seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 1,
    status: 'COMPLETED',
    totalCents: 50_000,
    cashTipCents: 2_000,
    changeOwedCents: 1_500,
    payments: [{ method: 'CASH', amountCents: 50_000 }],
    lines: [{ productVariantId: latte.id, quantity: 2 }],
  });
  // Completed online sale: excluded from expected cash, still one drink's
  // worth of packaging.
  seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 2,
    status: 'COMPLETED',
    totalCents: 30_000,
    payments: [{ method: 'ONLINE', amountCents: 30_000 }],
    lines: [{ productVariantId: latte.id, quantity: 1 }],
  });
  // Completed cash sale whose change was handed back — settled change is no
  // longer in the drawer and must not lift expected cash.
  seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 3,
    status: 'COMPLETED',
    totalCents: 20_000,
    changeOwedCents: 800,
    changeSettled: true,
    payments: [{ method: 'CASH', amountCents: 20_000 }],
  });
  // Parked order: five drinks that must not be deducted from packaging.
  seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 4,
    status: 'PARKED',
    totalCents: 0,
    payments: [],
    lines: [{ productVariantId: latte.id, quantity: 5 }],
  });
  // Voided pair: three drinks that must not be deducted and then added back.
  const voided = seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 5,
    status: 'COMPLETED',
    totalCents: 0,
    payments: [],
    lines: [{ productVariantId: latte.id, quantity: 3 }],
  });
  seedSale({
    tradingDayId: day.id,
    dayOrderNumber: 6,
    status: 'COMPLETED',
    kind: 'VOID',
    correctsSaleId: voided,
    totalCents: 0,
    payments: [],
  });

  seedCashMovement({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 5_000,
    description: `QA float top-up ${TAG}`,
  });
  seedCashMovement({
    tradingDayId: day.id,
    kind: 'CASH_OUT',
    amountCents: 2_500,
    description: `QA drop to safe ${TAG}`,
  });
  seedCashMovement({
    tradingDayId: day.id,
    kind: 'EXPENSE',
    amountCents: 3_000,
    description: `QA milk run ${TAG}`,
  });

  const openingFloatCents = 100_000;
  const cashSalesCents = 70_000;
  const onlineSalesCents = 30_000;
  const cashTipsCents = 2_000;
  const cashInCents = 5_000;
  const cashOutCents = 2_500;
  const cashExpensesCents = 3_000;
  const outstandingChangeCents = 1_500;

  return {
    tradingDayId: day.id,
    openingFloatCents,
    cashSalesCents,
    onlineSalesCents,
    cashTipsCents,
    cashInCents,
    cashOutCents,
    cashExpensesCents,
    outstandingChangeCents,
    // ADR 0006 §2, verbatim.
    expectedCashCents:
      openingFloatCents +
      cashSalesCents +
      cashTipsCents +
      cashInCents +
      outstandingChangeCents -
      cashOutCents -
      cashExpensesCents,
  };
}

/**
 * Opening and closing counts for the seeded day, chosen so the packaging table
 * carries every case the criteria distinguish at once: an unavailable expected,
 * an unavailable actual, a genuine recorded zero on both sides, and a short, an
 * over and a balanced variance.
 *
 *   cup      opening 100 + delivery 20 − wastage 5 − sold 3 = expected 112,
 *            actual 110  → short 2
 *   lid      opening  50                        − sold 3 = expected  47,
 *            actual  50  → over 3
 *   zeroCup  opening   0                                  = expected   0,
 *            actual   0  → balanced (a rendered zero, not a dash)
 *   uncounted in neither count → expected and actual both unavailable
 */
function seedCounts(date: string, options: { closing: boolean }): void {
  seedStockCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff.ada,
    lines: [
      { inventoryItemId: items.cup.id, quantity: 100 },
      { inventoryItemId: items.lid.id, quantity: 50 },
      { inventoryItemId: items.zeroCup.id, quantity: 0 },
    ],
  });
  seedStockMovement({
    businessDate: date,
    inventoryItemId: items.cup.id,
    type: 'DELIVERY',
    quantity: 20,
  });
  seedStockMovement({
    businessDate: date,
    inventoryItemId: items.cup.id,
    type: 'WASTAGE',
    quantity: 5,
  });

  if (!options.closing) return;
  seedStockCount({
    businessDate: date,
    phase: 'CLOSE',
    submittedBy: staff.bruno,
    lines: [
      { inventoryItemId: items.cup.id, quantity: 110 },
      { inventoryItemId: items.lid.id, quantity: 50 },
      { inventoryItemId: items.zeroCup.id, quantity: 0 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Opening a business day
// ---------------------------------------------------------------------------

test('opens a business day from /pos/open and shows the read-only open-day summary', async ({
  page,
}) => {
  const date = businessDate(2);
  await signInAsStaff(page);
  await gotoScreen(page, '/pos/open');

  await expect(openDayButton(page)).toBeVisible();
  await fillOpenForm(page, {
    date,
    dayType: 'Normal day',
    float: '1500.50',
    openedBy: staff.ada.displayName,
  });
  await openDayButton(page).click();

  // The screen flips to the read-only summary carrying all four facts.
  const summary = page.locator('.staff-day-open-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('heading', { level: 2 })).toHaveText(
    businessDateLabel(date),
  );
  await expect(summaryValue(page, 'Day type')).toHaveText('Normal day');
  await expect(summaryValue(page, 'Cash float')).toHaveText(money(150_050));
  await expect(summaryValue(page, 'Opened by')).toHaveText(
    staff.ada.displayName,
  );

  const days = readTradingDays();
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({
    businessDate: date,
    status: 'OPEN',
    dayType: 'NORMAL',
    openingFloatCents: 150_050,
  });
});

test('opens a Peak day and records the peak day type', async ({ page }) => {
  const date = businessDate(3);
  await signInAsStaff(page);
  await gotoScreen(page, '/pos/open');

  await fillOpenForm(page, {
    date,
    dayType: 'Peak day',
    // Exactly zero is a valid float and must be accepted, not read as missing.
    float: '0',
    openedBy: staff.bruno.displayName,
  });
  await openDayButton(page).click();

  await expect(summaryValue(page, 'Day type')).toHaveText('Peak day');
  await expect(summaryValue(page, 'Cash float')).toHaveText(money(0));

  const days = readTradingDays();
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({ dayType: 'PEAK', openingFloatCents: 0 });
});

test('refuses to open a day when required information is missing or the float is negative', async ({
  page,
}) => {
  await signInAsStaff(page);
  await gotoScreen(page, '/pos/open');

  // Nothing entered: every missing field is explained, and no day is opened.
  await openDayButton(page).click();
  const errors = page.locator('.staff-inventory-field-error');
  await expect(errors).toHaveText([
    'Choose a business date.',
    'Choose Normal day or Peak day.',
    'Enter the opening cash float.',
    'Choose the staff member opening the day.',
  ]);
  expect(readTradingDays()).toHaveLength(0);

  // A negative float is refused with its own explanation.
  await fillOpenForm(page, {
    date: businessDate(4),
    dayType: 'Normal day',
    float: '-1',
    openedBy: staff.ada.displayName,
  });
  await openDayButton(page).click();
  await expect(errors).toHaveText([
    'Opening cash float cannot be negative.',
  ]);
  expect(readTradingDays()).toHaveLength(0);

  // Correcting only the float then succeeds — proof the refusal was about the
  // value and not about the form being wedged.
  await fillOpenForm(page, { float: '250' });
  await openDayButton(page).click();
  await expect(page.locator('.staff-day-open-summary')).toBeVisible();
  expect(readTradingDays()).toHaveLength(1);
});

test('does not offer an inactive staff member in the opening select', async ({
  page,
}) => {
  await signInAsStaff(page);
  await gotoScreen(page, '/pos/open');

  const options = page.locator('#openedBy option');
  await expect(options.filter({ hasText: staff.ada.displayName })).toHaveCount(1);
  // Absent, not merely disabled.
  await expect(
    options.filter({ hasText: staff.zara.displayName }),
  ).toHaveCount(0);
});

test('offers no way to open another day while one is open', async ({ page }) => {
  const date = businessDate(5);
  openBusinessDayDirect({
    businessDate: date,
    dayType: 'PEAK',
    openingFloatCents: 75_000,
    openedByStaffMemberId: staff.bruno.id,
  });

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/open');

  await expect(page.locator('.staff-day-open-summary')).toBeVisible();
  await expect(summaryValue(page, 'Day type')).toHaveText('Peak day');
  await expect(summaryValue(page, 'Cash float')).toHaveText(money(75_000));
  await expect(summaryValue(page, 'Opened by')).toHaveText(
    staff.bruno.displayName,
  );

  // No opening control and no opening form anywhere on the screen.
  await expect(openDayButton(page)).toHaveCount(0);
  await expect(page.locator('.staff-open-day-form')).toHaveCount(0);
  await expect(page.locator('#businessDate')).toHaveCount(0);
});

test('opening the same action twice produces only one business day', async ({
  page,
  baseURL,
}) => {
  const date = businessDate(6);
  await signInAsStaff(page);

  // Hold the open POST so the in-flight window is observable. The request still
  // reaches the API — only its timing is controlled.
  await page.route(
    (url) => url.pathname === '/trading-day/open',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    },
  );

  await gotoScreen(page, '/pos/open');
  await fillOpenForm(page, {
    date,
    dayType: 'Normal day',
    float: '500',
    openedBy: staff.ada.displayName,
  });
  await openDayButton(page).click();

  const inFlight = page.getByRole('button', { name: 'Opening day…' });
  await expect(inFlight).toBeDisabled();
  await inFlight.click({ force: true });

  await expect(page.locator('.staff-day-open-summary')).toBeVisible();

  // The stronger half of the criterion: replaying the submission outright.
  const replay = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/open`,
    {
      data: {
        businessDate: date,
        dayType: 'NORMAL',
        openingFloatCents: 50_000,
        openedByStaffMemberId: staff.ada.id,
      },
    },
  );
  expect(replay.ok()).toBe(false);

  const days = readTradingDays();
  expect(days).toHaveLength(1);
  expect(days[0]!.status).toBe('OPEN');
});

// ---------------------------------------------------------------------------
// Closing screen — packaging
// ---------------------------------------------------------------------------

test('names the open business date and distinguishes unavailable expected, unavailable actual and recorded zero', async ({
  page,
}) => {
  const date = businessDate(7);
  seedFullDay(date);
  seedCounts(date, { closing: true });

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  // The screen identifies the day being closed.
  await expect(page.locator('.staff-business-context')).toHaveText(
    businessDateLabel(date),
  );

  // Column headings are Expected / Actual / Var, per item.
  await expect(page.locator('.staff-packaging-table thead th')).toHaveText([
    'Item',
    'Expected',
    'Actual',
    'Var',
  ]);

  // Expected = opening + deliveries − wastage − packaging used by completed,
  // non-voided sales. The parked order's 5 drinks and the voided sale's 3 are
  // both absent from the arithmetic: 100 + 20 − 5 − 3 = 112.
  expect(await packagingCells(page, items.cup.name)).toEqual({
    expected: '112',
    actual: '110',
    variance: '▾ Short 2',
  });
  expect(await packagingCells(page, items.lid.name)).toEqual({
    expected: '47',
    actual: '50',
    variance: '▴ Over 3',
  });

  // A genuine recorded zero renders as a zero on all three axes — this is the
  // v1 `-1` defect's replacement and the sharpest criterion in the story.
  expect(await packagingCells(page, items.zeroCup.name)).toEqual({
    expected: '0',
    actual: '0',
    variance: '0 Balanced',
  });

  // An unavailable expected and an unavailable actual are each visually
  // distinct from that zero, and from each other.
  const uncounted = await packagingCells(page, items.uncounted.name);
  expect(uncounted.expected).toBe('— no opening count');
  expect(uncounted.actual).toBe('— not in count');
  expect(uncounted.variance).toBe('— needs both counts');
  expect(uncounted.expected).not.toBe('0');
  expect(uncounted.actual).not.toBe('0');
  expect(uncounted.expected).not.toBe(uncounted.actual);

  // The distinction is carried in the markup too, not only in the copy.
  await expect(
    packagingRow(page, items.uncounted.name).locator('td.unknown'),
  ).toHaveCount(3);
  await expect(
    packagingRow(page, items.zeroCup.name).locator('td.unknown'),
  ).toHaveCount(0);
});

test('warns that the closing count is missing, links to it, and still allows closing', async ({
  page,
}) => {
  const date = businessDate(8);
  seedFullDay(date);
  seedCounts(date, { closing: false });

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  // Advisory warning, with a direct link to the closing inventory count.
  const advisory = page.locator('.staff-closing-advisory');
  await expect(advisory).toBeVisible();
  await expect(advisory).toContainText('No closing count submitted yet.');
  const link = advisory.getByRole('link', { name: 'Do the closing count.' });
  await expect(link).toHaveAttribute('href', '/pos/closing');

  // A missing closing count is distinguishable from an item simply absent from
  // a count that was taken, and from a recorded zero.
  const cup = await packagingCells(page, items.cup.name);
  expect(cup.expected).toBe('112');
  expect(cup.actual).toBe('— no closing count');
  expect(cup.variance).toBe('— needs closing count');

  // And the warning does not block: the day closes straight through it.
  await page.locator('#actualCash').fill('1740');
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await expect(advisory).toBeVisible();
  await closeDayButton(page).click();

  await expect(page.locator('.staff-close-success')).toBeVisible();
  expect(readDayClosings()).toHaveLength(1);
  expect(readTradingDays()[0]!.status).toBe('CLOSED');
});

test('shows an empty state instead of placeholder data when no items are reconciled', async ({
  page,
}) => {
  const date = businessDate(9);
  seedFullDay(date);

  await withNoReconciledItems(async () => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/close');

    await expect(page.locator('.staff-packaging-empty')).toHaveText(
      'No cup or lid items are marked for reconciliation.',
    );
    await expect(page.locator('.staff-packaging-table')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Closing screen — cash
// ---------------------------------------------------------------------------

test('shows every cash-summary term as a separate labelled row, as genuine zeros before the capture stories land', async ({
  page,
}) => {
  const date = businessDate(10);
  openBusinessDayDirect({
    businessDate: date,
    dayType: 'NORMAL',
    openingFloatCents: 120_000,
    openedByStaffMemberId: staff.ada.id,
  });

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  const rows = await cashSummaryRows(page);
  expect(rows.map((row) => row.label)).toEqual([
    'Cash float',
    'Cash sales',
    'Online sales (excluded)',
    'Cash tips',
    'Cash in',
    'Cash out',
    'Expenses (cash)',
    'Change owed (still in drawer)',
    'Expected cash',
  ]);

  // With nothing recorded, the rows nothing yet writes are labelled zeros —
  // not dashes, not hidden, not placeholder copy (ADR 0006 §7).
  expect(await cashValue(page, 'Cash sales')).toBe(money(0));
  expect(await cashValue(page, 'Online sales (excluded)')).toBe(money(0));
  expect(await cashValue(page, 'Cash tips')).toBe(`+${money(0)}`);
  expect(await cashValue(page, 'Cash in')).toBe(`+${money(0)}`);
  expect(await cashValue(page, 'Cash out')).toBe(`−${money(0)}`);
  expect(await cashValue(page, 'Expenses (cash)')).toBe(`−${money(0)}`);
  expect(await cashValue(page, 'Change owed (still in drawer)')).toBe(
    `+${money(0)}`,
  );
  expect(await cashValue(page, 'Cash float')).toBe(money(120_000));
  expect(await cashValue(page, 'Expected cash')).toBe(money(120_000));
});

test('excludes online sales from expected cash and matches the ADR 0006 §2 formula', async ({
  page,
}) => {
  const date = businessDate(11);
  const seeded = seedFullDay(date);

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  expect(await cashValue(page, 'Cash float')).toBe(
    money(seeded.openingFloatCents),
  );
  expect(await cashValue(page, 'Cash sales')).toBe(money(seeded.cashSalesCents));
  expect(await cashValue(page, 'Cash tips')).toBe(
    `+${money(seeded.cashTipsCents)}`,
  );
  expect(await cashValue(page, 'Cash in')).toBe(`+${money(seeded.cashInCents)}`);
  expect(await cashValue(page, 'Cash out')).toBe(
    `−${money(seeded.cashOutCents)}`,
  );
  expect(await cashValue(page, 'Expenses (cash)')).toBe(
    `−${money(seeded.cashExpensesCents)}`,
  );
  // Settled change (₱8.00) is out of the drawer and is not in this figure;
  // the ₱15.00 still owed is.
  expect(await cashValue(page, 'Change owed (still in drawer)')).toBe(
    `+${money(seeded.outstandingChangeCents)}`,
  );

  // Online sales are shown, labelled excluded, and absent from expected cash.
  const rows = await cashSummaryRows(page);
  const online = rows.find((row) => row.label === 'Online sales (excluded)')!;
  expect(online.value).toBe(money(seeded.onlineSalesCents));
  expect(online.note).toBe('Does not contribute to expected cash.');
  expect(seeded.onlineSalesCents).toBeGreaterThan(0);

  expect(await cashValue(page, 'Expected cash')).toBe(
    money(seeded.expectedCashCents),
  );
  // The arithmetic holds only because the ₱300.00 of online sales is excluded:
  // including it would have produced a different figure.
  expect(seeded.expectedCashCents).not.toBe(
    seeded.expectedCashCents + seeded.onlineSalesCents,
  );
});

// ---------------------------------------------------------------------------
// Closing the day
// ---------------------------------------------------------------------------

test('requires a non-negative actual cash count and a closing staff member', async ({
  page,
}) => {
  const date = businessDate(12);
  seedFullDay(date);

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  // Nothing entered.
  await closeDayButton(page).click();
  const errors = page.locator('.staff-inventory-field-error');
  await expect(errors).toHaveText([
    'Enter the actual cash counted.',
    'Choose the staff member closing the day.',
  ]);
  expect(readDayClosings()).toHaveLength(0);
  expect(readTradingDays()[0]!.status).toBe('OPEN');

  // A negative count is refused with a visible explanation and no close.
  await page.locator('#actualCash').fill('-50');
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await closeDayButton(page).click();
  await expect(errors).toHaveText([
    'Actual cash counted cannot be negative.',
  ]);
  expect(readDayClosings()).toHaveLength(0);
  expect(readTradingDays()[0]!.status).toBe('OPEN');

  // Inactive staff are absent from the closing select, not merely disabled.
  const options = page.locator('#closedBy option');
  await expect(
    options.filter({ hasText: staff.bruno.displayName }),
  ).toHaveCount(1);
  await expect(
    options.filter({ hasText: staff.zara.displayName }),
  ).toHaveCount(0);
});

test('updates the discrepancy as the count is typed, with direction and amount', async ({
  page,
}) => {
  const date = businessDate(13);
  const seeded = seedFullDay(date);
  const expectedPesos = seeded.expectedCashCents / 100;

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  // Before anything is typed the discrepancy is pending, not a false zero.
  await expect(discrepancy(page)).toHaveText('— enter actual cash count');

  // A matching count is a rendered zero, not an em dash.
  await page.locator('#actualCash').fill(String(expectedPesos));
  await expect(discrepancy(page)).toHaveText(`${money(0)} Balanced`);
  await expect(discrepancy(page)).toHaveClass(/balanced/);

  // A lower count is a shortage, with direction and amount…
  await page.locator('#actualCash').fill(String(expectedPesos - 12.5));
  await expect(discrepancy(page)).toHaveText(`▾ Short ${money(1_250)}`);
  await expect(discrepancy(page)).toHaveClass(/short/);

  // …and a higher count an overage — distinguishable from the shortage of the
  // same magnitude, not merely "a number appeared".
  await page.locator('#actualCash').fill(String(expectedPesos + 12.5));
  await expect(discrepancy(page)).toHaveText(`▴ Over ${money(1_250)}`);
  await expect(discrepancy(page)).toHaveClass(/over/);

  // All of this happened before submission: nothing has been recorded.
  expect(readDayClosings()).toHaveLength(0);
  expect(readTradingDays()[0]!.status).toBe('OPEN');
});

test('closes with a non-zero discrepancy and no reason given', async ({
  page,
}) => {
  const date = businessDate(14);
  const seeded = seedFullDay(date);
  const shortBy = 5_000;
  const counted = seeded.expectedCashCents - shortBy;

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  await page.locator('#actualCash').fill(String(counted / 100));
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await expect(discrepancy(page)).toHaveText(`▾ Short ${money(shortBy)}`);

  // The reason is left deliberately empty — it is optional and must stay so.
  await expect(page.locator('#varianceReason')).toHaveValue('');
  await closeDayButton(page).click();

  await expect(page.locator('.staff-close-success')).toBeVisible();
  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  expect(closings[0]).toMatchObject({
    actualCashCents: counted,
    expectedCashCents: seeded.expectedCashCents,
    varianceCents: -shortBy,
    varianceReason: null,
    closedByNameSnapshot: staff.bruno.displayName,
  });
});

test('records the closing result, including a discrepancy reason, and cannot be reopened', async ({
  page,
}) => {
  const date = businessDate(15);
  const seeded = seedFullDay(date);
  seedCounts(date, { closing: true });
  const overBy = 2_500;
  const counted = seeded.expectedCashCents + overBy;
  const reason = `QA over from tips ${TAG}`;

  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  await page.locator('#actualCash').fill(String(counted / 100));
  await page.locator('#varianceReason').fill(reason);
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await closeDayButton(page).click();

  // The close is confirmed on screen and the day is gone from the close flow.
  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  await expect(page.getByText('No business day is open to close.')).toBeVisible();
  await expect(closeDayButton(page)).toHaveCount(0);

  // The recorded closing result carries every figure the criteria enumerate,
  // including the packaging snapshot.
  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  expect(closings[0]).toMatchObject({
    openingFloatCents: seeded.openingFloatCents,
    cashSalesCents: seeded.cashSalesCents,
    onlineSalesCents: seeded.onlineSalesCents,
    cashTipsCents: seeded.cashTipsCents,
    cashInCents: seeded.cashInCents,
    cashOutCents: seeded.cashOutCents,
    cashExpensesCents: seeded.cashExpensesCents,
    outstandingChangeCents: seeded.outstandingChangeCents,
    expectedCashCents: seeded.expectedCashCents,
    actualCashCents: counted,
    varianceCents: overBy,
    varianceReason: reason,
    closedByNameSnapshot: staff.bruno.displayName,
  });
  expect(
    closings[0]!.lines.find((line) => line.itemName === items.cup.name),
  ).toMatchObject({ expectedQty: 112, actualQty: 110, varianceQty: -2 });

  // No reopen affordance anywhere, on either screen.
  for (const path of ['/pos/close', '/pos/open']) {
    await gotoScreen(page, path);
    await expect(page.getByRole('button', { name: /reopen/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /reopen/i })).toHaveCount(0);
  }

  // And the opening screen will not take the closed day's date back: the day
  // stays closed, with its record untouched.
  await gotoScreen(page, '/pos/open');
  await fillOpenForm(page, {
    date,
    dayType: 'Normal day',
    float: '100',
    openedBy: staff.ada.displayName,
  });
  await openDayButton(page).click();
  await expect(page.locator('.staff-inventory-message.error')).toBeVisible();

  const days = readTradingDays();
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({ businessDate: date, status: 'CLOSED' });
  expect(readDayClosings()).toEqual(closings);
});

test('closing the same action twice produces only one closing record', async ({
  page,
  baseURL,
}) => {
  const date = businessDate(16);
  const seeded = seedFullDay(date);
  const counted = seeded.expectedCashCents;

  await signInAsStaff(page);

  await page.route(
    (url) => url.pathname === '/trading-day/close',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    },
  );

  await gotoScreen(page, '/pos/close');
  await page.locator('#actualCash').fill(String(counted / 100));
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await closeDayButton(page).click();

  const inFlight = page.getByRole('button', { name: 'Closing day…' });
  await expect(inFlight).toBeDisabled();
  await inFlight.click({ force: true });

  await expect(page.locator('.staff-close-success')).toBeVisible();

  // Replaying the submission outright — the same client-generated id, exactly
  // as a retried request would carry — must not close a second time.
  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  const replay = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/close`,
    {
      data: {
        clientGeneratedId: closings[0]!.id,
        actualCashCents: counted,
        varianceReason: null,
        closedByStaffMemberId: staff.bruno.id,
      },
    },
  );
  expect(replay.ok()).toBe(true);

  expect(readDayClosings()).toEqual(closings);
  expect(countCashCounts()).toBe(1);
  const days = readTradingDays();
  expect(days).toHaveLength(1);
  expect(days[0]!.status).toBe('CLOSED');
});

test('explains there is no open day to close and accepts no submission', async ({
  page,
  baseURL,
}) => {
  await signInAsStaff(page);
  await gotoScreen(page, '/pos/close');

  await expect(page.getByText('No business day is open to close.')).toBeVisible();

  // No closing form and no closing control to submit.
  await expect(closeDayButton(page)).toHaveCount(0);
  await expect(page.locator('#actualCash')).toHaveCount(0);
  await expect(page.locator('#closedBy')).toHaveCount(0);
  await expect(page.locator('.staff-cash-summary')).toHaveCount(0);

  // Nor does the API behind it accept one.
  const submission = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/close`,
    {
      data: {
        clientGeneratedId: '00000000-0000-4000-8000-0000000c1053',
        actualCashCents: 10_000,
        varianceReason: null,
        closedByStaffMemberId: staff.bruno.id,
      },
    },
  );
  expect(submission.ok()).toBe(false);
  expect(readDayClosings()).toHaveLength(0);
});
