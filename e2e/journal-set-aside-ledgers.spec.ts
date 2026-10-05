import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  deletePricedCatalog,
  deleteRosterMembersByPrefix,
  readDayStatus,
  readRawGrossCents,
  seedDayOpener,
  seedPricedCatalog,
  setSingleOpenDay,
  type PricedVariant,
} from './fixtures/compensation-suggestions';
import {
  countCashMovements,
  countStoredDeposits,
  countStoredLedgers,
  countStoredWithdrawals,
  deleteRateRowsOnOrAfter,
  readStoredDeposits,
  readStoredRates,
  readStoredWithdrawals,
  resetJournal,
  seedCashCount,
  type StoredDeposit,
} from './fixtures/journal';
import {
  isoShift,
  longDate,
  resetTradingDays,
  shopToday,
} from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #467 — "Maintain set-aside fund ledgers in the
 * administrator Journal" (QA task #483). ADR 0018 is binding throughout.
 *
 * The surface under test is the administrator **Journal** page at `/journal`:
 * a ledger overview with a running balance, an Activity tab carrying deposits,
 * withdrawals and still-outstanding closed days, a Bulk add tab for catching up
 * missing days, and a suggestion-settings dialog for the Rent percentage and
 * the Chair amount and threshold.
 *
 * Six things decide how this suite is written.
 *
 * **Three states, not two.** ADR 0018 §2/§6 make a saved ₱0 deposit, a real ₱0
 * suggestion and "no suggestion at all" (`null`) three distinct things. A `?? 0`
 * anywhere in the stack collapses two of them and still passes any test that
 * only separates "has a suggestion" from "has none", so every one of the three
 * is asserted to render differently, and the ₱0 deposit is additionally read
 * back out of `journal_deposits` rather than trusted to the screen.
 *
 * **Recorded-ness is a row, not a flag.** The `@@unique([ledgerId,
 * businessDate])` constraint *is* "that business day is completed for that
 * ledger". So a deposit is asserted to leave the bulk-add list, a second
 * deposit for the same ledger and day is asserted to be refused rather than to
 * overwrite, and — the assertion that actually proves the mechanism — deleting
 * it is asserted to bring the day back with its suggestion intact.
 *
 * **Round-then-percent, not percent-then-round.** The Rent rule rounds the
 * gross by its hundreds digit and only then applies the percentage. A ₱7,800
 * gross must suggest **₱800**; ₱780 is the signature of the reversed order of
 * operations and is pinned as a negative assertion. The 7↔8 digit edge is
 * asserted on both sides, and ₱999.99 → ₱100 is asserted explicitly: it rounds
 * **up**, which is the case most likely to be "fixed" by someone who mistook
 * this rule for the flooring ₱50-per-₱1,000 band of ADR 0017.
 *
 * **"Later business days only" needs a day on each side of the change.** A
 * mutable rate column passes a naive "the new rate applies" test. The rate test
 * therefore reads an earlier closed day's suggestion and today's, changes the
 * percentage, and asserts the earlier day has not moved — then changes it a
 * second time the same day and asserts it still has not.
 *
 * **Gross is built through the real capture API.** Every suggestion here is
 * arithmetic over a derived figure, and seeded `SaleLine` rows supply column
 * defaults that hide snapshot bugs ([[e2e-seeded-sale-lines-hide-snapshot-bugs]]).
 * Each day's gross is placed through `POST /orders` and cross-checked against
 * the raw `sale_payments` total in `beforeAll`, so a wrong suggestion and a
 * wrong fixture are never indistinguishable.
 *
 * **Inertness is asserted, not assumed.** ADR 0018 §7 makes "a set-aside is not
 * a cash movement" a binding test. The whole `/reporting/report` body and the
 * `cash_movements` count are snapshotted, every Journal write and delete is
 * exercised against them, and both are asserted byte-identical afterwards.
 *
 * Isolation: the gross is whole-shop with no per-run scope and the Journal's
 * built-in ledgers carry a migration-seeded start date, so the suite clears the
 * trading-day world and the Journal once (`resetJournal`) and owns every day
 * and ledger it reads. Only one trading day may be OPEN at a time and
 * `POST /orders` writes against whichever that is, so the days are built one at
 * a time through `setSingleOpenDay`.
 *
 * The file is `serial` and its tests share two administrator-added ledgers and a
 * deposit-free Rent ledger. The order is load bearing and is called out where it
 * matters.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ROSTER_PREFIX = 'QA483 ';

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const TODAY = shopToday();
const daysAgo = (n: number) => isoShift(TODAY, -n);

/**
 * The built-in ledgers are moved to this start date, which is before every
 * business date below. A rate row cannot be deleted through the API, so a rate
 * effective earlier than every day the suite asserts on is what keeps the
 * story's initial 10% / ₱100 / ₱3,000 settings in force for all of them.
 */
const LEDGER_START = daysAgo(90);

/** One business date per gross figure, so each assertion stands alone. */
const DATES = {
  /** The Rent worked examples, one gross each. */
  rent760: daysAgo(80),
  rent769999: daysAgo(79),
  rent770000: daysAgo(78),
  rent779999: daysAgo(77),
  rent780000: daysAgo(76),
  rent700000: daysAgo(75),
  rent79900: daysAgo(74),
  rent80000: daysAgo(73),
  rent99999: daysAgo(72),
  /** One centavo below the Chair threshold, and exactly on it. */
  chairBelow: daysAgo(71),
  chairAt: daysAgo(70),
  /** The ₱0-deposit-marks-the-day-complete day. */
  zeroDeposit: daysAgo(69),
  /** Criterion 13 — its gross is changed after a deposit is recorded. */
  grossChange: daysAgo(68),
  /** Criterion 16 — carries a cash count so its variance is a real number. */
  inert: daysAgo(67),
  /** The balance-arithmetic deposits land here. */
  balance: daysAgo(66),
  /** The bulk-add and start-date-filter days. */
  bulkA: daysAgo(65),
  bulkB: daysAgo(64),
  bulkC: daysAgo(63),
  /** No trading day is ever created on this date. */
  noDay: daysAgo(62),
  /** Left as the single OPEN day, with a real gross on it. */
  openDay: daysAgo(61),
  /** Closed, and the only day on or after the date a rate change takes effect. */
  today: TODAY,
} as const;

/** Prices chosen so every gross is reached by selling one unit. */
const PRICES = {
  p760000: 760_000,
  p769999: 769_999,
  p770000: 770_000,
  p779999: 779_999,
  p780000: 780_000,
  p700000: 700_000,
  p79900: 79_900,
  p80000: 80_000,
  p99999: 99_999,
  p299999: 299_999,
  p300000: 300_000,
  p500000: 500_000,
  /** Added to `grossChange` after its deposit is recorded. */
  p100000: 100_000,
} as const;

type PriceKey = keyof typeof PRICES;

/**
 * The gross every date carries once `beforeAll` has built the world. Asserted
 * against the raw `sale_payments` total there, so every suggestion assertion
 * below rests on a gross the product itself reads.
 */
const GROSS: Record<string, number> = {
  [DATES.rent760]: 760_000,
  [DATES.rent769999]: 769_999,
  [DATES.rent770000]: 770_000,
  [DATES.rent779999]: 779_999,
  [DATES.rent780000]: 780_000,
  [DATES.rent700000]: 700_000,
  [DATES.rent79900]: 79_900,
  [DATES.rent80000]: 80_000,
  [DATES.rent99999]: 99_999,
  [DATES.chairBelow]: 299_999,
  [DATES.chairAt]: 300_000,
  [DATES.zeroDeposit]: 760_000,
  [DATES.grossChange]: 760_000,
  [DATES.inert]: 500_000,
  [DATES.balance]: 300_000,
  [DATES.bulkA]: 300_000,
  [DATES.bulkB]: 299_999,
  [DATES.bulkC]: 760_000,
  [DATES.openDay]: 760_000,
  [DATES.today]: 760_000,
};

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let catalog: Record<string, PricedVariant>;
let opener: string;
let rentLedgerId: string;
let chairLedgerId: string;
/** The administrator-added, fully manual ledger. Created by the AC2 test. */
let manualLedgerId = '';
const MANUAL_LEDGER_NAME = `Fund ${TAG}`;

// ---------------------------------------------------------------------------
// Sign-in, API, money
// ---------------------------------------------------------------------------

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

function deviceId(): string {
  return `qa483-${randomUUID()}`;
}

/** The peso string the page renders for an integer number of cents. */
function peso(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const pesos = new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 0,
  }).format(Math.trunc(absolute / 100));
  return `₱${sign}${pesos}.${String(absolute % 100).padStart(2, '0')}`;
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

/**
 * Place one completed cash sale through the real order-capture API. The order
 * total is asserted against the price so a gross that did not survive into the
 * sale fails here rather than three screens later as an arithmetic mismatch.
 */
async function sell(
  request: APIRequestContext,
  origin: string,
  price: PriceKey,
): Promise<void> {
  const clientGeneratedId = randomUUID();
  const order = await postOk(request, `${origin}/orders`, {
    clientGeneratedId,
    deviceId: deviceId(),
    productVariantId: catalog[price]!.variantId,
    quantity: 1,
    serviceType: 'TAKE_OUT',
  });
  expect(Number(order.totalCents), `order total for ${price}`).toBe(PRICES[price]);
  await postOk(request, `${origin}/orders/${clientGeneratedId}/complete`, {
    payments: [{ method: 'CASH', amountCents: order.totalCents }],
    cashReceivedCents: order.totalCents,
    cashTipCents: 0,
  });
}

// ---------------------------------------------------------------------------
// The Journal page
// ---------------------------------------------------------------------------

async function gotoJournal(page: Page): Promise<void> {
  await page.goto('/journal');
  await expect(page.getByRole('heading', { name: 'Journal', level: 1 })).toBeVisible();
  await expect(page.locator('.journal-ledger-row').first()).toBeVisible();
}

const ledgerRow = (page: Page, name: string) =>
  page.locator('.journal-ledger-row').filter({ hasText: name });

/** Select a ledger and wait for its workspace to finish loading. */
async function selectLedger(page: Page, name: string): Promise<void> {
  await ledgerRow(page, name).click();
  await expect(
    page.locator('#journal-workspace-title'),
  ).toHaveText(name);
  // The activity and missing-days requests both resolve before the tabs can be
  // trusted; the loading panel is the one thing that is up while either is.
  await expect(page.locator('.journal-state-panel')).toHaveCount(0);
}

const workspaceBalance = (page: Page) =>
  page.locator('.journal-summary .report-metric dd');

const sectionTab = (page: Page, name: 'Activity' | 'Bulk add') =>
  page.locator('.compensation-sections').getByRole('button', { name });

async function showActivity(page: Page): Promise<void> {
  await sectionTab(page, 'Activity').click();
  await expect(page.locator('.journal-activity-table, .journal-empty')).toBeVisible();
}

async function showBulkAdd(page: Page): Promise<void> {
  await sectionTab(page, 'Bulk add').click();
  await expect(page.locator('.journal-bulk-panel')).toBeVisible();
  await expect(page.locator('.journal-state-panel')).toHaveCount(0);
}

/**
 * One Bulk add row, located by the business date in its amount input's id
 * rather than by rendered text, so no date string can prefix-match another.
 */
const bulkRow = (page: Page, isoDate: string) =>
  page
    .locator('.journal-bulk-row')
    .filter({ has: page.locator(`#journal-bulk-amount-${isoDate}`) });

const bulkGross = (page: Page, isoDate: string) =>
  bulkRow(page, isoDate).locator('.journal-bulk-day strong');
const bulkSuggestion = (page: Page, isoDate: string) =>
  bulkRow(page, isoDate).locator(`#journal-bulk-amount-${isoDate}-suggestion`);
const bulkAmount = (page: Page, isoDate: string) =>
  page.locator(`#journal-bulk-amount-${isoDate}`);
const bulkCheckbox = (page: Page, isoDate: string) =>
  bulkRow(page, isoDate).locator('input[type="checkbox"]');

/** The Activity-tab row for one date. */
const activityRow = (page: Page, isoDate: string) =>
  page.locator('.journal-activity-table tbody tr').filter({ hasText: longDate(isoDate) });

const entryDialog = (page: Page) =>
  page.locator('.journal-modal[role="dialog"]');

/**
 * Open the record-deposit or record-withdrawal dialog from the toolbar.
 *
 * The dialog focuses the dialog element itself rather than a field, which is
 * what keeps the first `fill()` from being re-routed into an autofocused input
 * ([[e2e-dialog-autofocus-steals-first-fill]]). Waiting for that focus is still
 * what proves the dialog is interactive before anything is typed.
 */
async function openEntry(
  page: Page,
  kind: 'deposit' | 'withdrawal',
): Promise<Locator> {
  await page.locator('.journal-toolbar').getByRole('button', {
    name: `Record ${kind}`,
  }).click();
  const modal = entryDialog(page);
  await expect(
    modal.getByRole('heading', { name: `Record ${kind}` }),
  ).toBeVisible();
  await expect(modal).toBeFocused();
  return modal;
}

const entryDate = (page: Page) => page.locator('#journal-entry-date');
const entryAmount = (page: Page) => page.locator('#journal-entry-amount');
const entryNote = (page: Page) => page.locator('#journal-entry-note');
const entrySuggestionChip = (page: Page) =>
  page.locator('#journal-entry-amount-suggested');

/**
 * Fill a field and confirm the value landed in the field that was aimed at.
 *
 * A refused submit refocuses the first field in error on the next animation
 * frame, which silently re-routes a following `fill` into that input
 * ([[e2e-refused-submit-refocus-steals-fill]]).
 */
async function fillChecked(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

/** Record a deposit or withdrawal through the dialog and wait for the notice. */
async function recordEntry(
  page: Page,
  kind: 'deposit' | 'withdrawal',
  options: { date: string; amount: string; note?: string },
): Promise<void> {
  const modal = await openEntry(page, kind);
  await fillChecked(entryDate(page), options.date);
  await fillChecked(entryAmount(page), options.amount);
  if (options.note !== undefined) {
    await fillChecked(entryNote(page), options.note);
  }
  await modal.getByRole('button', { name: `Save ${kind}` }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.catalog-notice, .notice').first()).toBeVisible();
}

async function deleteEntry(
  page: Page,
  kind: 'deposit' | 'withdrawal',
  isoDate: string,
): Promise<void> {
  await activityRow(page, isoDate)
    .getByRole('button', { name: `Delete ${kind} from ${longDate(isoDate)}` })
    .click();
  const confirm = page.locator('.journal-confirm-modal[role="dialog"]');
  await expect(confirm.getByRole('heading', { name: `Delete ${kind}?` })).toBeVisible();
  await confirm.getByRole('button', { name: `Delete ${kind}` }).click();
  await expect(confirm).toHaveCount(0);
}

const addLedgerButton = (page: Page) =>
  page.locator('.journal-page-actions').getByRole('button', { name: 'Add ledger' });

/** Add a ledger through the dialog. Returns nothing: the page is the subject. */
async function addLedger(
  page: Page,
  options: { name: string; startDate: string; startingBalance?: string },
): Promise<void> {
  await addLedgerButton(page).click();
  const modal = page.locator('.journal-modal[role="dialog"]');
  await expect(modal.getByRole('heading', { name: 'Add ledger' })).toBeVisible();
  await expect(modal).toBeFocused();
  await fillChecked(page.locator('#journal-ledger-name'), options.name);
  await fillChecked(page.locator('#journal-ledger-startDate'), options.startDate);
  if (options.startingBalance !== undefined) {
    await fillChecked(
      page.locator('#journal-ledger-startingBalance'),
      options.startingBalance,
    );
  }
  await modal.getByRole('button', { name: 'Add ledger' }).click();
}

const settingsButton = (page: Page) =>
  page.locator('.journal-page-actions').getByRole('button', {
    name: 'Suggestion settings',
  });

/** The ledger id behind a rendered ledger name, read through the API. */
async function ledgerIdByName(
  request: APIRequestContext,
  origin: string,
  name: string,
): Promise<string> {
  const response = await request.get(`${origin}/journal/ledgers`, {
    failOnStatusCode: false,
  });
  expect(response.status(), 'GET /journal/ledgers for an administrator').toBe(200);
  const ledgers = (await response.json()) as Array<{ id: string; name: string }>;
  const match = ledgers.find((ledger) => ledger.name === name);
  expect(match, `ledger named ${name}`).toBeTruthy();
  return match!.id;
}

// ---------------------------------------------------------------------------
// Build the world
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser, baseURL }) => {
  // The Journal first: its deposits and withdrawals reference no trading day,
  // so they outlive a trading-day reset and would otherwise mark days recorded
  // in a world that no longer exists.
  resetTradingDays();
  const builtIn = resetJournal(LEDGER_START);
  rentLedgerId = builtIn.rentId;
  chairLedgerId = builtIn.chairId;
  deleteRosterMembersByPrefix(ROSTER_PREFIX);
  deletePricedCatalog(TAG);

  opener = seedDayOpener(`${ROSTER_PREFIX}Day opener ${TAG}`);
  catalog = seedPricedCatalog(TAG, { ...PRICES });

  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInAsAdmin(page);
  const origin = apiOrigin(baseURL);
  const request = page.request;

  // One day at a time: only one trading day may be OPEN, and `POST /orders`
  // writes against whichever that is. Each call closes the previous day.
  const built: Array<[string, PriceKey]> = [
    [DATES.rent760, 'p760000'],
    [DATES.rent769999, 'p769999'],
    [DATES.rent770000, 'p770000'],
    [DATES.rent779999, 'p779999'],
    [DATES.rent780000, 'p780000'],
    [DATES.rent700000, 'p700000'],
    [DATES.rent79900, 'p79900'],
    [DATES.rent80000, 'p80000'],
    [DATES.rent99999, 'p99999'],
    [DATES.chairBelow, 'p299999'],
    [DATES.chairAt, 'p300000'],
    [DATES.zeroDeposit, 'p760000'],
    [DATES.grossChange, 'p760000'],
    [DATES.inert, 'p500000'],
    [DATES.balance, 'p300000'],
    [DATES.bulkA, 'p300000'],
    [DATES.bulkB, 'p299999'],
    [DATES.bulkC, 'p760000'],
    [DATES.today, 'p760000'],
  ];
  for (const [businessDate, price] of built) {
    setSingleOpenDay(businessDate, opener);
    await sell(request, origin, price);
  }

  // Last, so it is the one day left OPEN. An open day must be invisible to the
  // Journal — not merely suggestion-free — and it carries a real gross so an
  // implementation that forgot the status filter surfaces it.
  setSingleOpenDay(DATES.openDay, opener);
  await sell(request, origin, 'p760000');

  await context.close();

  // A counted-cash row makes the inert day's variance a real number rather than
  // `null`, so criterion 16 asserts a figure that could actually move.
  seedCashCount(DATES.inert, 400_000, opener);

  // Every suggestion below is arithmetic over the gross, so the gross is proven
  // against the raw payment total the read model sums before a single
  // suggestion is read.
  for (const [businessDate, expected] of Object.entries(GROSS)) {
    expect(readRawGrossCents(businessDate), `raw gross on ${businessDate}`).toBe(
      expected,
    );
  }
  expect(readDayStatus(DATES.openDay), 'the open day').toBe('OPEN');
  expect(readDayStatus(DATES.noDay), 'a date with no trading day').toBeNull();
  for (const businessDate of Object.keys(GROSS)) {
    if (businessDate === DATES.openDay) continue;
    expect(readDayStatus(businessDate), `status of ${businessDate}`).toBe('CLOSED');
  }
});

test.afterAll(() => {
  resetTradingDays();
  resetJournal(LEDGER_START);
  deleteRosterMembersByPrefix(ROSTER_PREFIX);
  deletePricedCatalog(TAG);
});

// ===========================================================================
// Criterion 1 — administrators only, including through a direct request
// ===========================================================================

test('staff cannot reach Journal information or actions, on any verb', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);
  const ledgersBefore = countStoredLedgers();
  const depositsBefore = countStoredDeposits();
  const withdrawalsBefore = countStoredWithdrawals();

  // A STAFF session needs /auth/staff/login WITH a deviceId — /auth/login 401s
  // for a staff account, which would prove nothing
  // ([[e2e-staff-session-for-authz-tests]]).
  const login = await page.request.post(`${origin}/auth/staff/login`, {
    data: {
      username: STAFF_USERNAME,
      password: STAFF_PASSWORD,
      deviceId: deviceId(),
    },
    failOnStatusCode: false,
  });
  expect(login.ok(), await login.text()).toBeTruthy();

  // Fabricated ids: the guard is class-level, so it must answer before any
  // lookup. A 404 here would mean the handler ran.
  const ghost = randomUUID();
  const verbs: Array<[string, string, unknown?]> = [
    ['GET', `${origin}/journal/ledgers`],
    ['GET', `${origin}/journal/ledgers/${rentLedgerId}`],
    ['GET', `${origin}/journal/ledgers/${rentLedgerId}/rate`],
    ['GET', `${origin}/journal/ledgers/${rentLedgerId}/missing-days`],
    ['POST', `${origin}/journal/ledgers`, {
      name: `Staff fund ${TAG}`,
      startDate: DATES.rent760,
    }],
    ['POST', `${origin}/journal/ledgers/${rentLedgerId}/deposits`, {
      businessDate: DATES.rent760,
      amountCents: 1,
    }],
    ['POST', `${origin}/journal/ledgers/${rentLedgerId}/deposits/bulk`, {
      deposits: [{ businessDate: DATES.rent760, amountCents: 1 }],
    }],
    ['POST', `${origin}/journal/ledgers/${rentLedgerId}/withdrawals`, {
      withdrawnOn: DATES.rent760,
      amountCents: 1,
    }],
    ['PATCH', `${origin}/journal/deposits/${ghost}`, {
      businessDate: DATES.rent760,
      amountCents: 1,
    }],
    ['DELETE', `${origin}/journal/deposits/${ghost}`],
    ['PATCH', `${origin}/journal/withdrawals/${ghost}`, {
      withdrawnOn: DATES.rent760,
      amountCents: 1,
    }],
    ['DELETE', `${origin}/journal/withdrawals/${ghost}`],
    ['PUT', `${origin}/journal/ledgers/${rentLedgerId}/rate`, {
      rentPercentBasisPoints: 5_000,
    }],
  ];

  for (const [method, url, data] of verbs) {
    const response = await page.request.fetch(url, {
      method,
      ...(data === undefined ? {} : { data }),
      failOnStatusCode: false,
    });
    expect(response.status(), `${method} ${url} for a staff session`).toBe(403);
  }

  // Refused, not merely unrendered: nothing was written by any of them.
  expect(countStoredLedgers()).toBe(ledgersBefore);
  expect(countStoredDeposits()).toBe(depositsBefore);
  expect(countStoredWithdrawals()).toBe(withdrawalsBefore);

  // Hiding the page is a courtesy, and it is still asserted: a staff session
  // does not land on /journal.
  await page.goto('/journal');
  await expect(page).not.toHaveURL(/\/journal$/);
  await expect(page.getByRole('link', { name: 'Journal' })).toHaveCount(0);

  // Control: the same URLs serve an administrator, so a blanket route failure
  // cannot masquerade as a passing authorization test.
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  await signInAsAdmin(adminPage);
  for (const url of [
    `${origin}/journal/ledgers`,
    `${origin}/journal/ledgers/${rentLedgerId}`,
    `${origin}/journal/ledgers/${rentLedgerId}/rate`,
    `${origin}/journal/ledgers/${rentLedgerId}/missing-days`,
  ]) {
    const response = await adminPage.request.get(url, { failOnStatusCode: false });
    expect(response.status(), `GET ${url} for an administrator`).toBe(200);
  }
  await adminPage.goto('/journal');
  await expect(
    adminPage.getByRole('heading', { name: 'Journal', level: 1 }),
  ).toBeVisible();
  await expect(adminPage.getByRole('link', { name: 'Journal' })).toHaveCount(1);
  await adminContext.close();
});

// ===========================================================================
// Criterion 2 — the two built-in ledgers, and a fully manual added one
// ===========================================================================

test('the Journal starts with Rent and Chair, and an added ledger is fully manual', async ({
  page,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);
  await signInAsAdmin(page);
  await gotoJournal(page);

  await expect(ledgerRow(page, 'Rent')).toHaveCount(1);
  await expect(ledgerRow(page, 'Chair')).toHaveCount(1);

  // Rent is a suggesting ledger, so the settings affordance is offered for it.
  await selectLedger(page, 'Rent');
  await expect(settingsButton(page)).toBeVisible();

  await addLedger(page, {
    name: MANUAL_LEDGER_NAME,
    startDate: DATES.rent760,
    startingBalance: '500.00',
  });
  await expect(ledgerRow(page, MANUAL_LEDGER_NAME)).toHaveCount(1);
  manualLedgerId = await ledgerIdByName(
    page.request,
    origin,
    MANUAL_LEDGER_NAME,
  );

  await selectLedger(page, MANUAL_LEDGER_NAME);
  await expect(workspaceBalance(page)).toHaveText(peso(50_000));

  // Fully manual: no rate, so no settings affordance at all, and the API
  // refuses a rate for it outright (ADR 0018 §4).
  await expect(settingsButton(page)).toHaveCount(0);
  const rate = await page.request.get(
    `${origin}/journal/ledgers/${manualLedgerId}/rate`,
    { failOnStatusCode: false },
  );
  expect(rate.status()).toBe(200);
  // A `null` return serialises as an EMPTY 200 body, not the four bytes
  // `null`, so `json()` would throw rather than fail an assertion. The body
  // being empty is the statement: there is no rate row for this ledger.
  expect(['', 'null'], 'rate body for a manual ledger').toContain(
    (await rate.text()).trim(),
  );
  const refused = await page.request.put(
    `${origin}/journal/ledgers/${manualLedgerId}/rate`,
    { data: { rentPercentBasisPoints: 1_000 }, failOnStatusCode: false },
  );
  expect(refused.status(), 'PUT a rate onto a manual ledger').toBe(400);

  // "No suggestion at all" is `null`, not ₱0.00 — the third state.
  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.rent760)).toHaveText(
    'No suggestion available',
  );
  await expect(
    bulkRow(page, DATES.rent760).locator('.compensation-suggested'),
  ).toHaveCount(0);
  // Nothing is prefilled and nothing is ticked on the administrator's behalf.
  await expect(bulkAmount(page, DATES.rent760)).toHaveValue('');
  await expect(bulkCheckbox(page, DATES.rent760)).not.toBeChecked();

  // The name is compared without regard to letter case.
  await showActivity(page);
  await addLedger(page, {
    name: MANUAL_LEDGER_NAME.toLowerCase(),
    startDate: DATES.rent760,
  });
  await expect(
    page.locator('.journal-modal[role="dialog"]').getByText('already exists'),
  ).toBeVisible();
  await page
    .locator('.journal-modal[role="dialog"]')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(ledgerRow(page, MANUAL_LEDGER_NAME)).toHaveCount(1);
});

// ===========================================================================
// Criteria 8–10 — the Rent rule: round by the hundreds digit, THEN apply the %
// ===========================================================================

test('Rent suggests the percentage of the hundreds-digit-rounded gross, for closed days only', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, 'Rent');
  await showBulkAdd(page);

  /**
   * The story's worked examples at the initial 10%, plus the two boundaries
   * that separate this rule from every plausible mis-implementation of it.
   */
  const expected: Array<[string, number, number]> = [
    [DATES.rent760, 760_000, 70_000],
    // The 7↔8 hundreds-digit edge, both sides.
    [DATES.rent769999, 769_999, 70_000],
    [DATES.rent770000, 770_000, 70_000],
    [DATES.rent779999, 779_999, 70_000],
    [DATES.rent780000, 780_000, 80_000],
    [DATES.rent700000, 700_000, 70_000],
    [DATES.rent79900, 79_900, 0],
    [DATES.rent80000, 80_000, 10_000],
    // ₱999.99 has hundreds digit 9, so it rounds UP to ₱1,000 and suggests
    // ₱100. A rule that floored — ADR 0017's commission band does — gives ₱0.
    [DATES.rent99999, 99_999, 10_000],
  ];

  for (const [businessDate, gross, suggestion] of expected) {
    await expect(
      bulkGross(page, businessDate),
      `gross shown for ${businessDate}`,
    ).toHaveText(`Gross ${peso(gross)}`);
    await expect(
      bulkSuggestion(page, businessDate),
      `Rent suggestion for a gross of ${peso(gross)}`,
    ).toHaveText(`${peso(suggestion)} suggested, not saved`);
    // A suggestion is a suggestion until it is saved: the amount is prefilled,
    // and no deposit row exists for the day.
    await expect(bulkAmount(page, businessDate)).toHaveValue(
      `${Math.trunc(suggestion / 100)}.${String(suggestion % 100).padStart(2, '0')}`,
    );
  }
  expect(countStoredDeposits(rentLedgerId), 'nothing was saved by looking').toBe(0);

  // ₱780.00 is the signature of applying the percentage first and rounding
  // after. Pinned, because it is the one wrong answer a plausible
  // implementation produces for a ₱7,800 gross.
  await expect(bulkSuggestion(page, DATES.rent780000)).not.toContainText(
    peso(78_000),
  );

  // Suggestions appear only for closed business days. The open day carries a
  // ₱7,600 gross, so a missing status filter would surface it here; a date with
  // no trading day does not exist for the Journal at all.
  await expect(bulkRow(page, DATES.openDay)).toHaveCount(0);
  await expect(bulkRow(page, DATES.noDay)).toHaveCount(0);
  await showActivity(page);
  await expect(activityRow(page, DATES.openDay)).toHaveCount(0);
  await expect(activityRow(page, DATES.noDay)).toHaveCount(0);
});

// ===========================================================================
// Criterion 11 — Chair: ₱100 at ₱3,000, ₱0 below, and ₱0 is a real suggestion
// ===========================================================================

test('Chair suggests ₱100 from ₱3,000 and a real ₱0 below it', async ({ page }) => {
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, 'Chair');
  await showBulkAdd(page);

  await expect(bulkGross(page, DATES.chairAt)).toHaveText(
    `Gross ${peso(300_000)}`,
  );
  await expect(bulkSuggestion(page, DATES.chairAt)).toHaveText(
    `${peso(10_000)} suggested, not saved`,
  );

  // One centavo below the threshold. A ₱0.00 suggestion is a REAL suggestion:
  // it is offered through the same chip, it is prefilled, and its row is ticked
  // — none of which is true of the manual ledger's `null`.
  await expect(bulkGross(page, DATES.chairBelow)).toHaveText(
    `Gross ${peso(299_999)}`,
  );
  await expect(bulkSuggestion(page, DATES.chairBelow)).toHaveText(
    `${peso(0)} suggested, not saved`,
  );
  await expect(
    bulkRow(page, DATES.chairBelow).locator('.compensation-suggested'),
  ).toHaveCount(1);
  await expect(
    bulkRow(page, DATES.chairBelow).locator('.journal-no-suggestion'),
  ).toHaveCount(0);
  await expect(bulkAmount(page, DATES.chairBelow)).toHaveValue('0.00');
  await expect(bulkCheckbox(page, DATES.chairBelow)).toBeChecked();
});

// ===========================================================================
// Criteria 4, 6 — a ₱0 deposit marks the day complete, and deleting un-marks it
// ===========================================================================

test('a saved ₱0 deposit records its business day, refuses a second, and un-records it when deleted', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, 'Chair');

  // The day's gross is ₱7,600, so Chair suggests ₱100 for it. A ₱0 is the
  // administrator's own figure, deliberately not the suggestion.
  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.zeroDeposit)).toHaveText(
    `${peso(10_000)} suggested, not saved`,
  );

  await showActivity(page);
  await recordEntry(page, 'deposit', {
    date: DATES.zeroDeposit,
    amount: '0',
    note: `QA483 zero ${TAG}`,
  });

  // (a) The row exists and holds a real `0` — not `null`, not absent.
  const stored = readStoredDeposits(chairLedgerId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    businessDate: DATES.zeroDeposit,
    amountCents: 0,
    note: `QA483 zero ${TAG}`,
  });

  // (b) The day reads as recorded rather than outstanding, and says so.
  const row = activityRow(page, DATES.zeroDeposit);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Deposit');
  await expect(row).toContainText('Recorded in ledger');
  await expect(row.locator('.journal-zero-label')).toHaveText('Saved ₱0.00 deposit');
  await expect(row).not.toContainText('Not recorded');
  await expect(row).not.toContainText('Needs review');

  // (c) It is gone from Bulk add. Recorded-ness is the row's existence, so the
  // anti-join must drop it even though its amount is falsy.
  await showBulkAdd(page);
  await expect(bulkRow(page, DATES.zeroDeposit)).toHaveCount(0);

  // (d) A second deposit for the same ledger and day is refused, and the
  // existing one is untouched.
  await showActivity(page);
  const modal = await openEntry(page, 'deposit');
  await fillChecked(entryDate(page), DATES.zeroDeposit);
  await expect(
    page.locator('#journal-entry-date-help'),
  ).toContainText('already has a deposit for this business day');
  await fillChecked(entryAmount(page), '250');
  await modal.getByRole('button', { name: 'Save deposit' }).click();
  await expect(modal.getByText('already has a deposit for')).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  expect(readStoredDeposits(chairLedgerId)).toEqual(stored);

  // (e) Deleting it brings the day back into Bulk add with its suggestion
  // intact. This is the assertion that proves recorded-ness is the row and not
  // a flag somewhere.
  await deleteEntry(page, 'deposit', DATES.zeroDeposit);
  expect(readStoredDeposits(chairLedgerId)).toHaveLength(0);
  await showBulkAdd(page);
  await expect(bulkRow(page, DATES.zeroDeposit)).toHaveCount(1);
  await expect(bulkSuggestion(page, DATES.zeroDeposit)).toHaveText(
    `${peso(10_000)} suggested, not saved`,
  );
});

// ===========================================================================
// Criteria 3, 5, 6, 7 — balance arithmetic, withdrawals, edits, deletes,
// and a negative balance
// ===========================================================================

test('the balance is starting balance plus deposits minus withdrawals, and may go negative', async ({
  page,
}) => {
  expect(manualLedgerId, 'the manual ledger from the AC2 test').not.toBe('');
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, MANUAL_LEDGER_NAME);
  await expect(workspaceBalance(page)).toHaveText(peso(50_000));

  // A deposit is tied to a closed business day.
  await recordEntry(page, 'deposit', {
    date: DATES.balance,
    amount: '200',
    note: `QA483 deposit ${TAG}`,
  });
  await expect(workspaceBalance(page)).toHaveText(peso(70_000));

  // A withdrawal is NOT tied to a business day: this date has no trading day at
  // all, and two withdrawals may share one date.
  await recordEntry(page, 'withdrawal', {
    date: DATES.noDay,
    amount: '50',
    note: `QA483 first out ${TAG}`,
  });
  await expect(workspaceBalance(page)).toHaveText(peso(65_000));
  await recordEntry(page, 'withdrawal', {
    date: DATES.noDay,
    amount: '25',
  });
  await expect(workspaceBalance(page)).toHaveText(peso(62_500));

  const withdrawals = readStoredWithdrawals(manualLedgerId);
  expect(withdrawals).toHaveLength(2);
  expect(withdrawals.map((row) => row.withdrawnOn)).toEqual([
    DATES.noDay,
    DATES.noDay,
  ]);
  expect(withdrawals.map((row) => row.amountCents)).toEqual([5_000, 2_500]);
  // A blank note is stored as `null`, not as an empty string.
  expect(withdrawals[1]!.note).toBeNull();

  // Edit the deposit: amount and note both change, and the balance follows.
  await activityRow(page, DATES.balance)
    .getByRole('button', { name: `Edit deposit from ${longDate(DATES.balance)}` })
    .click();
  const depositModal = entryDialog(page);
  await expect(depositModal.getByRole('heading', { name: 'Edit deposit' })).toBeVisible();
  await expect(depositModal).toBeFocused();
  await fillChecked(entryAmount(page), '300.50');
  await fillChecked(entryNote(page), `QA483 corrected ${TAG}`);
  await depositModal.getByRole('button', { name: 'Save deposit' }).click();
  await expect(depositModal).toHaveCount(0);
  await expect(workspaceBalance(page)).toHaveText(peso(72_550));
  expect(readStoredDeposits(manualLedgerId)[0]).toMatchObject({
    businessDate: DATES.balance,
    amountCents: 30_050,
    note: `QA483 corrected ${TAG}`,
  });

  // Edit a withdrawal, then delete the other one.
  await activityRow(page, DATES.noDay)
    .filter({ hasText: `QA483 first out ${TAG}` })
    .getByRole('button', { name: `Edit withdrawal from ${longDate(DATES.noDay)}` })
    .click();
  const withdrawalModal = entryDialog(page);
  await expect(
    withdrawalModal.getByRole('heading', { name: 'Edit withdrawal' }),
  ).toBeVisible();
  await expect(withdrawalModal).toBeFocused();
  await fillChecked(entryAmount(page), '80');
  await withdrawalModal.getByRole('button', { name: 'Save withdrawal' }).click();
  await expect(withdrawalModal).toHaveCount(0);
  await expect(workspaceBalance(page)).toHaveText(peso(69_550));

  await activityRow(page, DATES.noDay)
    .filter({ hasText: 'No note' })
    .getByRole('button', { name: `Delete withdrawal from ${longDate(DATES.noDay)}` })
    .click();
  const confirm = page.locator('.journal-confirm-modal[role="dialog"]');
  await confirm.getByRole('button', { name: 'Delete withdrawal' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(workspaceBalance(page)).toHaveText(peso(72_050));
  expect(readStoredWithdrawals(manualLedgerId)).toHaveLength(1);

  // A withdrawal that overdraws the ledger SUCCEEDS, and the negative balance
  // is shown as a negative figure — not as the em dash `MoneyValue` reserves
  // for an unavailable one.
  await recordEntry(page, 'withdrawal', {
    date: DATES.bulkA,
    amount: '1000',
    note: `QA483 overdraw ${TAG}`,
  });
  expect(readStoredWithdrawals(manualLedgerId).map((row) => row.amountCents)).toEqual([
    100_000, 8_000,
  ]);
  await expect(workspaceBalance(page)).toHaveText(peso(-27_950));
  await expect(workspaceBalance(page)).not.toHaveText('—');
  await expect(workspaceBalance(page)).toHaveClass(/variance-short/);
  await expect(page.locator('.journal-summary .report-metric span')).toHaveText(
    'Negative balance',
  );
  await expect(ledgerRow(page, MANUAL_LEDGER_NAME)).toContainText(peso(-27_950));
  await expect(ledgerRow(page, MANUAL_LEDGER_NAME)).toContainText('Negative');

  // Deleting the deposit un-records its business day for this ledger, so the
  // day comes back as outstanding.
  await deleteEntry(page, 'deposit', DATES.balance);
  expect(readStoredDeposits(manualLedgerId)).toHaveLength(0);
  await showBulkAdd(page);
  await expect(bulkRow(page, DATES.balance)).toHaveCount(1);
});

// ===========================================================================
// Criteria 14, 15 — bulk add: the start date, the unticked row, the ₱0 row,
// and the all-or-nothing conflict
// ===========================================================================

test('bulk add lists only undeposited closed days from the start date, and saves all or nothing', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);
  const lateName = `Late fund ${TAG}`;
  await signInAsAdmin(page);
  await gotoJournal(page);

  // A ledger whose start date falls after several closed days.
  await addLedger(page, { name: lateName, startDate: DATES.bulkA });
  await expect(ledgerRow(page, lateName)).toHaveCount(1);
  const lateLedgerId = await ledgerIdByName(page.request, origin, lateName);
  await selectLedger(page, lateName);
  await showBulkAdd(page);

  // `>=`, not `>`: the start date itself IS listed, the day before it is not.
  await expect(bulkRow(page, DATES.bulkA)).toHaveCount(1);
  for (const businessDate of [
    DATES.balance,
    DATES.inert,
    DATES.grossChange,
    DATES.rent760,
    DATES.chairAt,
  ]) {
    await expect(
      bulkRow(page, businessDate),
      `${businessDate} is before the ledger start date`,
    ).toHaveCount(0);
  }
  // An open day and a date with no trading day are absent whatever the start
  // date says.
  await expect(bulkRow(page, DATES.openDay)).toHaveCount(0);
  await expect(bulkRow(page, DATES.noDay)).toHaveCount(0);
  // Exactly the four closed days from the start date onward.
  await expect(page.locator('.journal-bulk-row')).toHaveCount(4);
  for (const businessDate of [DATES.bulkA, DATES.bulkB, DATES.bulkC, DATES.today]) {
    await expect(bulkRow(page, businessDate)).toHaveCount(1);
    // A manual ledger lists the same days with no suggested amounts.
    await expect(bulkSuggestion(page, businessDate)).toHaveText(
      'No suggestion available',
    );
  }

  // Amounts are entered by hand; one day is unticked; one ticked row holds ₱0.
  await bulkAmount(page, DATES.bulkA).fill('150');
  await bulkAmount(page, DATES.bulkB).fill('0');
  await bulkAmount(page, DATES.bulkC).fill('75.50');
  for (const businessDate of [DATES.bulkA, DATES.bulkB, DATES.bulkC]) {
    await bulkCheckbox(page, businessDate).check();
    await expect(bulkCheckbox(page, businessDate)).toBeChecked();
  }
  await bulkCheckbox(page, DATES.today).uncheck();
  await expect(bulkCheckbox(page, DATES.today)).not.toBeChecked();
  await expect(page.locator('.journal-bulk-header .results-meta')).toHaveText(
    '3 of 4 selected',
  );

  await page.getByRole('button', { name: 'Save selected deposits' }).click();
  await expect(page.getByText('3 deposits were recorded.')).toBeVisible();

  // All selected days saved together; the unticked day wrote nothing; the
  // ticked ₱0 row wrote a real row holding `0`.
  const saved = readStoredDeposits(lateLedgerId);
  expect(saved.map((row) => [row.businessDate, row.amountCents])).toEqual([
    [DATES.bulkA, 15_000],
    [DATES.bulkB, 0],
    [DATES.bulkC, 7_550],
  ]);
  await showBulkAdd(page);
  await expect(page.locator('.journal-bulk-row')).toHaveCount(1);
  await expect(bulkRow(page, DATES.today)).toHaveCount(1);

  // ---- the all-or-nothing conflict ----------------------------------------
  // A fresh ledger, so the race is run against a full list.
  const raceName = `Race fund ${TAG}`;
  await showActivity(page);
  await addLedger(page, { name: raceName, startDate: DATES.bulkA });
  // The row appearing is what proves the create landed; reading the id straight
  // off the API would race the still-in-flight POST.
  await expect(ledgerRow(page, raceName)).toHaveCount(1);
  const raceLedgerId = await ledgerIdByName(page.request, origin, raceName);
  await selectLedger(page, raceName);
  await showBulkAdd(page);
  await expect(page.locator('.journal-bulk-row')).toHaveCount(4);
  for (const businessDate of [DATES.bulkA, DATES.bulkB, DATES.bulkC, DATES.today]) {
    await bulkAmount(page, businessDate).fill('10');
    await bulkCheckbox(page, businessDate).check();
  }

  // Another administrator records one of the listed days while this list is on
  // screen.
  const otherContext = await browser.newContext({ baseURL });
  const otherPage = await otherContext.newPage();
  await signInAsAdmin(otherPage);
  const outOfBand = await otherPage.request.post(
    `${origin}/journal/ledgers/${raceLedgerId}/deposits`,
    {
      data: { businessDate: DATES.bulkB, amountCents: 4_200 },
      failOnStatusCode: false,
    },
  );
  expect(outOfBand.status(), 'the out-of-band deposit').toBe(201);
  await otherContext.close();
  expect(countStoredDeposits(raceLedgerId)).toBe(1);

  await page.getByRole('button', { name: 'Save selected deposits' }).click();
  await expect(page.getByText('nothing at all was saved')).toBeVisible();

  // Zero rows written for the whole batch — queried, not read off the banner.
  // A half-caught-up ledger is the failure this assertion exists to catch.
  const afterConflict = readStoredDeposits(raceLedgerId);
  expect(afterConflict.map((row) => [row.businessDate, row.amountCents])).toEqual([
    [DATES.bulkB, 4_200],
  ]);
  // The list refetched, so the day that was taken is gone from it.
  await expect(page.locator('.journal-bulk-row')).toHaveCount(3);
  await expect(bulkRow(page, DATES.bulkB)).toHaveCount(0);
});

// ===========================================================================
// Criterion 12 — a rate change affects later business days only
// ===========================================================================

test('a suggestion-settings change moves later business days only, and cannot be backdated', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, 'Rent');
  await showBulkAdd(page);

  // One closed day on each side of the change: an earlier one, and today.
  await expect(bulkSuggestion(page, DATES.rent780000)).toHaveText(
    `${peso(80_000)} suggested, not saved`,
  );
  await expect(bulkSuggestion(page, DATES.today)).toHaveText(
    `${peso(70_000)} suggested, not saved`,
  );

  await settingsButton(page).click();
  const settings = page.locator('.journal-modal[role="dialog"]');
  await expect(settings.getByRole('heading', { name: 'Suggestion settings' })).toBeVisible();
  await expect(settings).toBeFocused();
  await expect(page.locator('#journal-rate-rentPercent')).toHaveValue('10');

  // Backdating is not offered: no effective-date control of any kind, and the
  // rounding rule is explained as text rather than rendered as a setting
  // (ADR 0018 §4).
  await expect(settings.locator('input[type="date"]')).toHaveCount(0);
  await expect(settings.getByLabel(/effective/i)).toHaveCount(0);
  await expect(settings.locator('input, select, textarea')).toHaveCount(1);
  await expect(settings).toContainText('The Rent rounding rule is fixed');
  await expect(settings).toContainText('cannot be backdated');

  await fillChecked(page.locator('#journal-rate-rentPercent'), '20');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByText('They apply to business days from today onward')).toBeVisible();

  // Today moves. The earlier day does NOT — a mutable rate column would move
  // both and still pass a naive "the new rate applies" test.
  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.today)).toHaveText(
    `${peso(140_000)} suggested, not saved`,
  );
  await expect(
    bulkSuggestion(page, DATES.rent780000),
    'an earlier business day keeps the rate in force on its own date',
  ).toHaveText(`${peso(80_000)} suggested, not saved`);
  await expect(bulkSuggestion(page, DATES.rent99999)).toHaveText(
    `${peso(10_000)} suggested, not saved`,
  );

  // A change is a NEW row with today's effective date, never an edit of the one
  // already in force.
  let rates = readStoredRates(rentLedgerId);
  expect(rates).toEqual([
    {
      effectiveFrom: LEDGER_START,
      rentPercentBasisPoints: 1_000,
      chairAmountCents: null,
      chairThresholdCents: null,
    },
    {
      effectiveFrom: TODAY,
      rentPercentBasisPoints: 2_000,
      chairAmountCents: null,
      chairThresholdCents: null,
    },
  ]);

  // Changed again the same day: the latest intent for today wins, today's row
  // is upserted rather than appended, and the earlier day still has not moved.
  await settingsButton(page).click();
  await expect(page.locator('#journal-rate-rentPercent')).toHaveValue('20');
  await fillChecked(page.locator('#journal-rate-rentPercent'), '30');
  await page
    .locator('.journal-modal[role="dialog"]')
    .getByRole('button', { name: 'Save settings' })
    .click();
  await expect(page.locator('.journal-modal[role="dialog"]')).toHaveCount(0);

  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.today)).toHaveText(
    `${peso(210_000)} suggested, not saved`,
  );
  await expect(bulkSuggestion(page, DATES.rent780000)).toHaveText(
    `${peso(80_000)} suggested, not saved`,
  );
  rates = readStoredRates(rentLedgerId);
  expect(rates).toHaveLength(2);
  expect(rates[1]).toMatchObject({
    effectiveFrom: TODAY,
    rentPercentBasisPoints: 3_000,
  });

  // The Chair amount and threshold are changeable in the same way.
  await selectLedger(page, 'Chair');
  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.chairBelow)).toHaveText(
    `${peso(0)} suggested, not saved`,
  );
  await settingsButton(page).click();
  const chairSettings = page.locator('.journal-modal[role="dialog"]');
  await expect(page.locator('#journal-rate-chairAmount')).toHaveValue('100.00');
  await expect(page.locator('#journal-rate-chairThreshold')).toHaveValue('3000.00');
  await expect(chairSettings.locator('input[type="date"]')).toHaveCount(0);
  await fillChecked(page.locator('#journal-rate-chairAmount'), '250');
  await fillChecked(page.locator('#journal-rate-chairThreshold'), '2000');
  await chairSettings.getByRole('button', { name: 'Save settings' }).click();
  await expect(chairSettings).toHaveCount(0);

  await showBulkAdd(page);
  // Today crosses the new, lower threshold and suggests the new amount; the
  // earlier sub-₱3,000 day keeps its ₱0.
  await expect(bulkSuggestion(page, DATES.today)).toHaveText(
    `${peso(25_000)} suggested, not saved`,
  );
  await expect(bulkSuggestion(page, DATES.chairBelow)).toHaveText(
    `${peso(0)} suggested, not saved`,
  );
  expect(readStoredRates(chairLedgerId)).toHaveLength(2);

  // The API offers no way to unsay a rate change, so the rows this test
  // appended are removed here rather than left to re-rate every later test.
  deleteRateRowsOnOrAfter(TODAY);
  expect(readStoredRates(rentLedgerId)).toHaveLength(1);
  expect(readStoredRates(chairLedgerId)).toHaveLength(1);
});

// ===========================================================================
// Criterion 13 — a later change to the day's gross disturbs nothing
// ===========================================================================

test('a saved deposit and its recorded day survive a later change to that day gross', async ({
  page,
  baseURL,
  browser,
}) => {
  const origin = apiOrigin(baseURL);
  await signInAsAdmin(page);
  await gotoJournal(page);
  await selectLedger(page, 'Rent');

  // Record the suggested amount for a closed day.
  await showBulkAdd(page);
  await expect(bulkSuggestion(page, DATES.grossChange)).toHaveText(
    `${peso(70_000)} suggested, not saved`,
  );
  await showActivity(page);
  const modal = await openEntry(page, 'deposit');
  await fillChecked(entryDate(page), DATES.grossChange);
  await expect(entrySuggestionChip(page)).toHaveText(
    `${peso(70_000)} suggested, not saved`,
  );
  await modal.getByRole('button', { name: 'Save deposit' }).click();
  await expect(modal).toHaveCount(0);

  const before = readStoredDeposits(rentLedgerId);
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({
    businessDate: DATES.grossChange,
    amountCents: 70_000,
  });

  // Now really change that day's gross: reopen it, sell another ₱1,000 through
  // the capture API, and close it again. ₱8,600 rounds down to ₱8,000 and would
  // suggest ₱800, so a recomputed figure is visibly different from ₱700.
  const context = await browser.newContext({ baseURL });
  const sellerPage = await context.newPage();
  await signInAsAdmin(sellerPage);
  setSingleOpenDay(DATES.grossChange, opener);
  await sell(sellerPage.request, origin, 'p100000');
  // Restore the suite's single open day, which closes `grossChange` again.
  setSingleOpenDay(DATES.openDay, opener);
  await context.close();
  expect(readRawGrossCents(DATES.grossChange)).toBe(860_000);
  expect(readDayStatus(DATES.grossChange)).toBe('CLOSED');

  // The stored deposit is untouched, down to its id and its `null` note.
  expect(readStoredDeposits(rentLedgerId)).toEqual<StoredDeposit[]>(before);

  // And no suggestion reappears for the day: a recorded day is not a missing
  // day, so no suggestion is computed for it at all.
  await page.reload();
  // A bare reload resets the page's own component state, so the ledger and the
  // tab are both re-selected rather than assumed to have survived
  // ([[e2e-reload-resets-date-control]]).
  await expect(page.getByRole('heading', { name: 'Journal', level: 1 })).toBeVisible();
  await selectLedger(page, 'Rent');
  await showBulkAdd(page);
  await expect(bulkRow(page, DATES.grossChange)).toHaveCount(0);
  await showActivity(page);
  const row = activityRow(page, DATES.grossChange);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(peso(70_000));
  await expect(row).toContainText('Recorded in ledger');
  await expect(row).toContainText('Saved amount');
  await expect(row).not.toContainText('suggested');
  await expect(row).not.toContainText(peso(80_000));

  const missing = await page.request.get(
    `${origin}/journal/ledgers/${rentLedgerId}/missing-days`,
    { failOnStatusCode: false },
  );
  expect(missing.status()).toBe(200);
  const days = (await missing.json()) as Array<{ businessDate: string }>;
  expect(days.map((day) => day.businessDate)).not.toContain(DATES.grossChange);
});

// ===========================================================================
// Criterion 16 — the Journal is inert with respect to cash and sales
// ===========================================================================

test('Journal deposits and withdrawals change no cash, variance or sales figure', async ({
  page,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);
  await signInAsAdmin(page);

  const reportUrl = `${origin}/reporting/report?from=${DATES.rent760}&to=${TODAY}`;
  async function report(): Promise<Record<string, unknown>> {
    const response = await page.request.get(reportUrl, { failOnStatusCode: false });
    expect(response.status(), 'GET /reporting/report').toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  const before = await report();
  const cashMovementsBefore = countCashMovements();

  // The day carries a cash count, so these are real numbers that could move.
  const dayBefore = (
    before.dailyReconciliation as Array<Record<string, unknown>>
  ).find((day) => day.date === DATES.inert);
  expect(dayBefore, `the reconciliation row for ${DATES.inert}`).toBeTruthy();
  expect(typeof dayBefore!.expectedCashCents).toBe('number');
  expect(typeof dayBefore!.varianceCents).toBe('number');

  await gotoJournal(page);
  await selectLedger(page, 'Rent');

  // Record, edit and delete both kinds of entry against that very day.
  await recordEntry(page, 'deposit', {
    date: DATES.inert,
    amount: '500',
    note: `QA483 inert ${TAG}`,
  });
  await recordEntry(page, 'withdrawal', {
    date: DATES.inert,
    amount: '125.25',
  });
  expect(countStoredDeposits(rentLedgerId)).toBeGreaterThan(0);

  await activityRow(page, DATES.inert)
    .filter({ hasText: 'Deposit' })
    .getByRole('button', { name: `Edit deposit from ${longDate(DATES.inert)}` })
    .click();
  const modal = entryDialog(page);
  await expect(modal).toBeFocused();
  await fillChecked(entryAmount(page), '600');
  await modal.getByRole('button', { name: 'Save deposit' }).click();
  await expect(modal).toHaveCount(0);

  const during = await report();
  expect(
    JSON.stringify(during),
    'the whole sales report while Journal entries exist',
  ).toBe(JSON.stringify(before));
  expect(countCashMovements(), 'a set-aside is not a cash movement').toBe(
    cashMovementsBefore,
  );

  await deleteEntry(page, 'withdrawal', DATES.inert);
  await deleteEntry(page, 'deposit', DATES.inert);

  const after = await report();
  expect(
    JSON.stringify(after),
    'the whole sales report after the Journal entries are gone',
  ).toBe(JSON.stringify(before));
  expect(countCashMovements()).toBe(cashMovementsBefore);
});
