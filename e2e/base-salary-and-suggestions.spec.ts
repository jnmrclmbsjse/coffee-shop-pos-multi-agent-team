import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  countStoredAdjustmentsForStaff,
  countStoredEntriesForStaff,
  readStoredAdjustmentsForStaff,
  readStoredEntriesForStaff,
} from './fixtures/compensation';
import {
  deletePricedCatalog,
  deleteRosterMembersByPrefix,
  findRosterMemberId,
  readDayStatus,
  readRawGrossCents,
  readStoredBaseSalary,
  seedDayOpener,
  seedPricedCatalog,
  seedRosterMember,
  setSingleOpenDay,
  type PricedVariant,
  type SeededRosterMember,
} from './fixtures/compensation-suggestions';
import { isoShift, resetTradingDays, shopToday } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #414 — "Store a daily base salary per staff
 * member and suggest daily record amounts" (QA task #451).
 *
 * Two surfaces are under test: the staff add/edit dialog on `/staff`, which
 * gains an optional **Base salary**, and the Add daily record dialog on
 * `/compensation`, which gains the day's gross sales, a salary prefill, a
 * commission suggestion and an optional load allowance. ADR 0017 is binding
 * throughout.
 *
 * Four things decide how this suite is written.
 *
 * **`NULL` is not `0`.** ADR 0017 §1 makes "no base salary" and "a rate of
 * zero" different values. A `?? 0` collapsing them satisfies any test that only
 * distinguishes "has a salary" from "has none", so every base-salary assertion
 * covers all three states — unset, `0`, and a positive rate — and reads the
 * `base_salary_cents` column itself rather than trusting the form to report it.
 *
 * **A real ₱0.00 gross is not the no-business-day state.** The story makes these
 * two screens differ by one message, and the implementation is required to drive
 * it from an explicit `hasBusinessDay` flag rather than from testing gross
 * against zero. A day that opened and sold nothing is therefore asserted
 * separately, and asserted *negatively* — the note must be absent, not merely
 * "the gross is ₱0.00".
 *
 * **The commission rule is the story, so the arithmetic is asserted absolutely.**
 * Every figure is a literal peso string the test computes nowhere: ₱2,750 → ₱100,
 * ₱999.99 → ₱0, ₱1,000.00 → ₱50, ₱3,000 → ₱150. The two band boundaries are
 * adjacent on purpose — a rule of ₱50 per *started* ₱1,000, or per ₱1,000
 * rounded, passes the middle of a band and fails here. The suite was
 * mutation-tested against three changes and goes red for each: ₱40 per ₱1,000,
 * `Math.ceil` in place of the floor, and a `hasBusinessDay` derived from
 * `gross > 0` instead of from whether a day exists.
 *
 * **Gross is built through the real capture API.** `grossSalesCents` sums
 * `sale_payments` rows, and a void is an appended reversing sale with negated
 * payments, so seeding sales by hand would assert the fixture's arithmetic
 * instead of the product's ([[e2e-seeded-sale-lines-hide-snapshot-bugs]]). Each
 * day's figure is also cross-checked against the raw payment total so "the form
 * shows ₱2,750.00" cannot pass on a number the form invented.
 *
 * Isolation: the gross is whole-shop with no per-run scope, so the suite clears
 * the trading-day world once and owns every day it reads. Because only one day
 * may be OPEN and `POST /orders` writes against whichever that is, each test
 * that cares declares its own open day through `setSingleOpenDay` rather than
 * inheriting what the previous test left behind.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ROSTER_PREFIX = 'QA451 ';

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The work date control is `max={shopDate()}` and the form refuses a later
 * date, so every business date this suite uses is in the past. They sit 39–52
 * days back: outside the current pay cutoff, so a day of this suite's sales
 * cannot drift into another compensation spec's default filter range.
 */
const TODAY = shopToday();
const daysAgo = (n: number) => isoShift(TODAY, -n);

/** One business date per gross figure, so each assertion stands alone. */
const DATES = {
  /** ₱2,750.00 of completed sales — the story's first example. */
  gross2750: daysAgo(52),
  /** ₱999.99 — one centavo below the first commission band. */
  gross99999: daysAgo(51),
  /** ₱1,000.00 — the first centavo inside it. */
  gross100000: daysAgo(50),
  /** ₱3,000.00 — exactly three bands. */
  gross3000: daysAgo(49),
  /** ₱1,200.00 sold, ₱300.00 of it voided: a gross of ₱900.00. */
  voided: daysAgo(48),
  /** ₱1,000.00 completed plus a ₱2,000.00 order still parked. */
  parked: daysAgo(47),
  /** ₱1,000.00 completed with a ₱500.00 cash tip on top. */
  tipped: daysAgo(46),
  /** Opened, never sold on. Gross ₱0.00 — and NOT the no-business-day state. */
  openedEmpty: daysAgo(45),
  /** No trading day is ever created here. */
  noDay: daysAgo(44),
  /** Built inside the open-then-closed test, which owns it. */
  openThenClosed: daysAgo(43),
  /** Load-allowance tests; each owns one date so their rows cannot mix. */
  allowance: daysAgo(42),
  allowanceDuplicate: daysAgo(41),
  allowanceConflict: daysAgo(40),
  /** The dirty-flag tests need two dates with different suggestions. */
  dirtyA: daysAgo(39),
  /** The second Load allowance saved through the warning, on its own date so
   *  the duplicate *daily record* rule does not refuse the save instead. */
  secondAllowance: daysAgo(38),
} as const;

/** Prices chosen so every gross is reached by selling one unit, never by
 *  multiplying money in the fixture. */
const PRICES = {
  p2750: 275_000,
  p99999: 99_999,
  p1000: 100_000,
  p3000: 300_000,
  p900: 90_000,
  p300: 30_000,
  p2000: 200_000,
  p1500: 150_000,
} as const;

type PriceKey = keyof typeof PRICES;

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let catalog: Record<string, PricedVariant>;
let opener: string;

/** Roster members with a known stored rate, for the prefill assertions. */
let unsetSalary: SeededRosterMember;
let zeroSalary: SeededRosterMember;
let positiveSalary: SeededRosterMember;
/** A second member, so "the same suggestion for everyone" can be asserted. */
let secondMember: SeededRosterMember;

// ---------------------------------------------------------------------------
// Sign-in, navigation, API
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
  return `qa451-${randomUUID()}`;
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

interface PlacedOrder {
  clientGeneratedId: string;
  totalCents: number;
}

/** Park an order through the real order-capture API. */
async function parkOrder(
  request: APIRequestContext,
  origin: string,
  price: PriceKey,
): Promise<PlacedOrder> {
  const clientGeneratedId = randomUUID();
  const order = await postOk(request, `${origin}/orders`, {
    clientGeneratedId,
    deviceId: deviceId(),
    productVariantId: catalog[price]!.variantId,
    quantity: 1,
    serviceType: 'TAKE_OUT',
  });
  // The gross is asserted against literal pesos, so a price that did not
  // survive into the order total has to fail here rather than three screens
  // later as an arithmetic mismatch.
  expect(Number(order.totalCents), `order total for ${price}`).toBe(
    PRICES[price],
  );
  return { clientGeneratedId, totalCents: Number(order.totalCents) };
}

/** Park, then settle in cash — the ordinary "a sale happened" path. */
async function sell(
  request: APIRequestContext,
  origin: string,
  price: PriceKey,
  cashTipCents = 0,
): Promise<PlacedOrder> {
  const order = await parkOrder(request, origin, price);
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/complete`, {
    payments: [{ method: 'CASH', amountCents: order.totalCents }],
    cashReceivedCents: order.totalCents + cashTipCents,
    cashTipCents,
  });
  return order;
}

/**
 * Void through the real correction path (ADR 0005/0006). A deleted sale would
 * prove nothing: the criterion is about a sale that still exists and must
 * nonetheless lower the gross.
 */
async function voidOrder(
  request: APIRequestContext,
  origin: string,
  order: PlacedOrder,
): Promise<void> {
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/void`, {
    clientGeneratedId: randomUUID(),
    deviceId: deviceId(),
    voidReason: `QA451 void ${TAG}`,
  });
}

// ---------------------------------------------------------------------------
// The Add daily record dialog
// ---------------------------------------------------------------------------

function dialog(page: Page): Locator {
  return page.locator('.inventory-modal[role="dialog"]');
}

/** Open `/compensation` on the Daily records section. */
async function gotoCompensation(page: Page): Promise<void> {
  await page.goto('/compensation');
  await expect(page.getByRole('heading', { name: 'Compensation', level: 1 })).toBeVisible();
  await expect(addRecordButton(page)).toBeVisible();
}

/**
 * The header's Add daily record button.
 *
 * Scoped to the page head because the records table's empty state renders a
 * second button with the same accessible name, and which of the two exists
 * depends on how many records the filters happen to match.
 */
const addRecordButton = (page: Page) =>
  page.locator('.catalog-page-head').getByRole('button', { name: 'Add daily record' });

/** Switch to the Daily records section — the Add button only exists there. */
async function showDailyRecords(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Daily records' }).click();
  await expect(addRecordButton(page)).toBeVisible();
}

async function openAddRecord(page: Page): Promise<Locator> {
  await addRecordButton(page).click();
  const modal = dialog(page);
  await expect(modal.getByRole('heading', { name: 'Add daily record' })).toBeVisible();
  // Add-mode autofocuses the staff select on the next animation frame; edit
  // mode autofocuses the salary. Either way, waiting for it is what stops the
  // first fill being re-routed into the focused control.
  await expect(staffSelect(page)).toBeFocused();
  return modal;
}

const grossBlock = (page: Page) => dialog(page).locator('.compensation-gross');
const grossAmount = (page: Page) => grossBlock(page).locator('strong.num');
const grossNote = (page: Page) => grossBlock(page).locator('.compensation-gross-note');
const salaryInput = (page: Page) => dialog(page).locator('#compensation-salary');
const commissionInput = (page: Page) => dialog(page).locator('#compensation-commission');
const staffSelect = (page: Page) => dialog(page).locator('#compensation-staffMemberId');
const workDateInput = (page: Page) => dialog(page).locator('#compensation-workDate');
const allowanceCheckbox = (page: Page) => dialog(page).locator('#compensation-loadAllowance');
const allowanceAmount = (page: Page) =>
  dialog(page).locator('#compensation-loadAllowanceAmount');
const duplicateWarning = (page: Page) =>
  dialog(page).locator('.compensation-duplicate-warning');

/**
 * Select or clear "Include load allowance".
 *
 * The checkbox sits underneath its own touch-target label, whose `<span>`
 * intercepts the pointer, so `.check()` never lands and times out
 * ([[e2e-touch-target-label-intercepts-radio]]). Clicking the label is also
 * what the administrator actually does. The label toggles, so the current state
 * is read first and the click only happens when it would change something.
 */
async function setAllowance(page: Page, include: boolean): Promise<void> {
  const box = allowanceCheckbox(page);
  const toggled = (await box.isChecked()) !== include;
  if (toggled) {
    await dialog(page).locator('label[for="compensation-loadAllowance"]').click();
  }

  if (include) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();

  // A toggle moves focus on the next animation frame — into the amount field
  // when selected, back to the checkbox when cleared. Waiting for it keeps the
  // next fill from landing in whichever control the frame picked. Nothing moves
  // when the box was already in the wanted state, so there is nothing to wait
  // for either.
  if (!toggled) return;
  if (include) await expect(allowanceAmount(page)).toBeFocused();
  else await expect(box).toBeFocused();
}

/**
 * Wait until the gross lookup for the date the control currently holds has
 * settled.
 *
 * The block renders `Checking…` while the request is in flight, and the
 * commission is only written once it resolves. Reading either before that is
 * how a suggestion assertion passes against a stale value from the previous
 * date.
 */
async function grossSettled(page: Page): Promise<void> {
  await expect(grossAmount(page)).not.toHaveText('Checking…');
  await expect(grossAmount(page)).not.toHaveText('Unavailable');
}

/**
 * Select a staff member and wait for the selection to take effect.
 *
 * The dialog fills salary and commission from the selection inside the same
 * update, so asserting those fields before the `select` has actually changed
 * reads the pre-selection draft
 * ([[e2e-payslip-default-staff-selection-race]]).
 */
async function chooseStaff(page: Page, member: SeededRosterMember): Promise<void> {
  await staffSelect(page).selectOption({ label: member.displayName });
  await expect(staffSelect(page)).toHaveValue(member.id);
}

/** Change the work date and wait for the refreshed gross. */
async function chooseWorkDate(page: Page, date: string): Promise<void> {
  await workDateInput(page).fill(date);
  await expect(workDateInput(page)).toHaveValue(date);
  await grossSettled(page);
}

/**
 * Fill a money input and confirm the value landed in the field that was aimed
 * at.
 *
 * A refused submit refocuses the first field in error on the next animation
 * frame, which silently re-routes a following `fill` into that input — the save
 * then succeeds and the run reads as a missing validation message
 * ([[e2e-refused-submit-refocus-steals-fill]]).
 */
async function fillChecked(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

// ---------------------------------------------------------------------------
// The staff dialog
// ---------------------------------------------------------------------------

async function gotoStaff(page: Page): Promise<void> {
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
}

async function openAddStaff(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add staff' }).click();
  const modal = page.locator('.staff-modal[role="dialog"]');
  await expect(modal.getByRole('heading', { name: 'Add staff' })).toBeVisible();
  // The dialog focuses its name input on the next animation frame. Filling any
  // other field before that happens lets the autofocus re-route the keystrokes
  // into the name box, and the value silently lands in the wrong input
  // ([[e2e-staff-signin-focus-steal]]).
  await expect(staffName(page)).toBeFocused();
  return modal;
}

async function openEditStaff(page: Page, displayName: string): Promise<Locator> {
  await page.locator('#staff-search').fill(displayName);
  const row = page.locator('.staff-table tbody tr').filter({ hasText: displayName });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: `Edit ${displayName}` }).click();
  const modal = page.locator('.staff-modal[role="dialog"]');
  await expect(modal.getByRole('heading', { name: 'Edit staff' })).toBeVisible();
  await expect(staffName(page)).toBeFocused();
  return modal;
}

const staffName = (page: Page) => page.locator('#staff-display-name');
const staffBaseSalary = (page: Page) => page.locator('#staff-base-salary');
const staffBaseSalaryError = (page: Page) => page.locator('#staff-base-salary-error');

// ---------------------------------------------------------------------------
// Build the world
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser, baseURL }) => {
  // Clearing first frees this suite's previous openers to be deleted: a staff
  // member is only unreferenced once its trading days and sales are gone.
  resetTradingDays();
  deleteRosterMembersByPrefix(ROSTER_PREFIX);
  deletePricedCatalog(TAG);

  opener = seedDayOpener(`${ROSTER_PREFIX}Day opener ${TAG}`);
  catalog = seedPricedCatalog(TAG, { ...PRICES });

  unsetSalary = seedRosterMember(`${ROSTER_PREFIX}No rate ${TAG}`, null);
  zeroSalary = seedRosterMember(`${ROSTER_PREFIX}Zero rate ${TAG}`, 0);
  positiveSalary = seedRosterMember(`${ROSTER_PREFIX}Rate 700 ${TAG}`, 70_000);
  secondMember = seedRosterMember(`${ROSTER_PREFIX}Second ${TAG}`, 55_000);

  // Sales go through the real capture API, which needs an authenticated session
  // and writes against whichever day is OPEN — hence one day at a time.
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInAsAdmin(page);
  const origin = apiOrigin(baseURL);
  const request = page.request;

  setSingleOpenDay(DATES.gross2750, opener);
  await sell(request, origin, 'p2750');

  setSingleOpenDay(DATES.gross99999, opener);
  await sell(request, origin, 'p99999');

  setSingleOpenDay(DATES.gross100000, opener);
  await sell(request, origin, 'p1000');

  setSingleOpenDay(DATES.gross3000, opener);
  await sell(request, origin, 'p3000');

  // ₱900.00 stands, ₱300.00 is voided: ₱1,200.00 of sales, a gross of ₱900.00.
  // That crosses the first band downwards, so an implementation that ignores
  // the reversing sale suggests ₱50 where the rule gives ₱0.
  setSingleOpenDay(DATES.voided, opener);
  await sell(request, origin, 'p900');
  const toVoid = await sell(request, origin, 'p300');
  await voidOrder(request, origin, toVoid);

  // The parked ₱2,000.00 carries no payment rows and must contribute nothing.
  setSingleOpenDay(DATES.parked, opener);
  await sell(request, origin, 'p1000');
  await parkOrder(request, origin, 'p2000');

  // A ₱500.00 cash tip is excluded from the commission base (ADR 0017 §2): a
  // gross of ₱1,500.00 would suggest ₱50 too, so the *gross* is what separates
  // a correct implementation here, and both are asserted.
  setSingleOpenDay(DATES.tipped, opener);
  await sell(request, origin, 'p1000', 50_000);

  // Opened and never sold on. Left CLOSED here; the test that needs it open
  // says so itself.
  setSingleOpenDay(DATES.openedEmpty, opener);

  // Today's day carries ₱1,500.00 so the dialog's default work date has a real
  // gross to show before any staff member is selected.
  setSingleOpenDay(TODAY, opener);
  await sell(request, origin, 'p1500');

  await context.close();

  // The fixture asserted every order total; this asserts the sum the read model
  // actually reads, so a later gross mismatch is attributable to the product.
  expect(readRawGrossCents(DATES.gross2750), 'raw gross 2750').toBe(275_000);
  expect(readRawGrossCents(DATES.gross99999), 'raw gross 999.99').toBe(99_999);
  expect(readRawGrossCents(DATES.gross100000), 'raw gross 1000').toBe(100_000);
  expect(readRawGrossCents(DATES.gross3000), 'raw gross 3000').toBe(300_000);
  expect(readRawGrossCents(DATES.voided), 'raw gross after a void').toBe(90_000);
  expect(readRawGrossCents(DATES.parked), 'raw gross with a parked order').toBe(100_000);
  expect(readRawGrossCents(DATES.tipped), 'raw gross with a cash tip').toBe(100_000);
  expect(readRawGrossCents(DATES.openedEmpty), 'raw gross of an empty day').toBe(0);
  expect(readRawGrossCents(TODAY), "raw gross of today's day").toBe(150_000);
});

test.afterAll(() => {
  resetTradingDays();
  deleteRosterMembersByPrefix(ROSTER_PREFIX);
  deletePricedCatalog(TAG);
});

// ===========================================================================
// Base salary on the staff member
// ===========================================================================

test('an administrator enters a base salary when adding a staff member and it persists', async ({
  page,
}) => {
  const name = `${ROSTER_PREFIX}Added with rate ${TAG}`;
  await signInAsAdmin(page);
  await gotoStaff(page);

  const modal = await openAddStaff(page);
  await fillChecked(staffName(page), name);
  await fillChecked(staffBaseSalary(page), '650.75');
  await modal.getByRole('button', { name: 'Add staff' }).click();
  await expect(modal).toHaveCount(0);

  // Stored as integer cents, exactly — not 65074.99999 (ADR 0001).
  const id = findRosterMemberId(name);
  expect(id, `roster member ${name} was not created`).not.toBeNull();
  expect(readStoredBaseSalary(id!)).toBe(65_075);

  // And it survives a round trip through the dialog, which is what "persists"
  // means to the administrator.
  await page.reload();
  await openEditStaff(page, name);
  await expect(staffBaseSalary(page)).toHaveValue('650.75');
});

test('base salary is optional: saving it blank stores no rate at all, which is not a rate of zero', async ({
  page,
}) => {
  const name = `${ROSTER_PREFIX}Added blank ${TAG}`;
  await signInAsAdmin(page);
  await gotoStaff(page);

  const modal = await openAddStaff(page);
  await fillChecked(staffName(page), name);
  await expect(staffBaseSalary(page)).toHaveValue('');
  await modal.getByRole('button', { name: 'Add staff' }).click();
  await expect(modal).toHaveCount(0);

  const id = findRosterMemberId(name);
  expect(id, `roster member ${name} was not created`).not.toBeNull();
  // `null`, and specifically not `0`: ADR 0017 §1 makes these different values
  // and a `?? 0` on the write path is the bug this asserts against.
  const stored = readStoredBaseSalary(id!);
  expect(stored).toBeNull();
  expect(stored).not.toBe(0);
});

test('editing a staff member sets, changes and clears the base salary, keeping a rate of zero distinct from none', async ({
  page,
}) => {
  const name = `${ROSTER_PREFIX}Edited rate ${TAG}`;
  const member = seedRosterMember(name, null);
  await signInAsAdmin(page);
  await gotoStaff(page);

  // none → a rate of zero. The stored column must become 0, not stay null.
  let modal = await openEditStaff(page, name);
  await expect(staffBaseSalary(page)).toHaveValue('');
  await fillChecked(staffBaseSalary(page), '0');
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(modal).toHaveCount(0);
  expect(readStoredBaseSalary(member.id)).toBe(0);

  // A stored zero renders as ₱0.00 rather than as an empty field, which is how
  // the administrator can tell the two apart at all.
  await page.reload();
  modal = await openEditStaff(page, name);
  await expect(staffBaseSalary(page)).toHaveValue('0.00');

  // zero → a positive rate.
  await fillChecked(staffBaseSalary(page), '125.50');
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(modal).toHaveCount(0);
  expect(readStoredBaseSalary(member.id)).toBe(12_550);

  // positive → cleared. "Clearing a previously saved base salary removes it",
  // so the column goes back to null and not to 0.
  await page.reload();
  modal = await openEditStaff(page, name);
  await expect(staffBaseSalary(page)).toHaveValue('125.50');
  await fillChecked(staffBaseSalary(page), '');
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(modal).toHaveCount(0);
  const cleared = readStoredBaseSalary(member.id);
  expect(cleared).toBeNull();
  expect(cleared).not.toBe(0);
});

test('an invalid base salary is refused with a message naming the field, and nothing is stored', async ({
  page,
}) => {
  const name = `${ROSTER_PREFIX}Invalid rate ${TAG}`;
  const member = seedRosterMember(name, 40_000);
  await signInAsAdmin(page);
  await gotoStaff(page);

  const modal = await openEditStaff(page, name);
  const save = modal.getByRole('button', { name: 'Save changes' });

  for (const [value, message] of [
    ['-1', 'Base salary cannot be negative.'],
    ['12.345', 'Base salary cannot have more than 2 decimal places.'],
    ['abc', 'Base salary must be a number.'],
  ] as const) {
    // The refused submit refocuses this very input on the next animation frame.
    // Waiting for that before the next fill is what stops the following value
    // landing somewhere else and the save quietly succeeding
    // ([[e2e-refused-submit-refocus-steals-fill]]).
    await fillChecked(staffBaseSalary(page), value);
    await save.click();

    // The message identifies the field: it is rendered as that input's own
    // error and wired to it through aria-describedby.
    await expect(staffBaseSalaryError(page)).toHaveText(message);
    await expect(staffBaseSalary(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(staffBaseSalary(page)).toHaveAttribute(
      'aria-describedby',
      /staff-base-salary-error/,
    );
    // The dialog stayed open and the stored rate is untouched.
    await expect(modal).toBeVisible();
    expect(readStoredBaseSalary(member.id), `after rejecting ${value}`).toBe(40_000);
    await expect(staffBaseSalary(page)).toBeFocused();
  }

  // Control: a valid value through the same dialog does save, so the three
  // refusals above cannot be a dialog that never saves anything.
  await fillChecked(staffBaseSalary(page), '410.25');
  await save.click();
  await expect(modal).toHaveCount(0);
  expect(readStoredBaseSalary(member.id)).toBe(41_025);
});

test('changing a base salary leaves every existing daily record untouched', async ({
  page,
  baseURL,
}) => {
  const name = `${ROSTER_PREFIX}Record keeper ${TAG}`;
  const member = seedRosterMember(name, 30_000);
  await signInAsAdmin(page);

  // A daily record saved while the rate is ₱300.00, with amounts that are
  // deliberately NOT the rate — a recompute-on-read bug would overwrite them
  // with the base salary and this would catch it either way.
  const created = await postOk(page.request, `${apiOrigin(baseURL)}/compensation/entries`, {
    staffMemberId: member.id,
    workDate: DATES.gross2750,
    salaryCents: 51_234,
    commissionCents: 777,
  });
  const entryId = String(created.id);

  await gotoStaff(page);
  const modal = await openEditStaff(page, name);
  await fillChecked(staffBaseSalary(page), '999.99');
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(modal).toHaveCount(0);
  expect(readStoredBaseSalary(member.id)).toBe(99_999);

  const stored = readStoredEntriesForStaff(member.id);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: entryId,
    workDate: DATES.gross2750,
    salaryCents: 51_234,
    commissionCents: 777,
  });

  // And clearing the rate does not disturb it either.
  await page.reload();
  const again = await openEditStaff(page, name);
  await fillChecked(staffBaseSalary(page), '');
  await again.getByRole('button', { name: 'Save changes' }).click();
  await expect(again).toHaveCount(0);
  expect(readStoredBaseSalary(member.id)).toBeNull();
  expect(readStoredEntriesForStaff(member.id)[0]).toMatchObject({
    salaryCents: 51_234,
    commissionCents: 777,
  });
});

test('base salary and the gross suggestion are unreachable by a non-administrator', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = apiOrigin(baseURL);

  // A STAFF session needs /auth/staff/login with a deviceId — /auth/login 401s
  // for staff, which would prove nothing ([[e2e-staff-session-for-authz-tests]]).
  const login = await page.request.post(`${origin}/auth/staff/login`, {
    data: { username: STAFF_USERNAME, password: STAFF_PASSWORD, deviceId: deviceId() },
    failOnStatusCode: false,
  });
  expect(login.ok(), await login.text()).toBeTruthy();

  // The admin roster, which is the only shape carrying baseSalaryCents, and the
  // suggestion endpoint are both refused outright.
  for (const url of [
    `${origin}/staff`,
    `${origin}/compensation/daily-gross?workDate=${DATES.gross2750}`,
  ]) {
    const response = await page.request.get(url, { failOnStatusCode: false });
    expect(response.status(), `GET ${url} for a staff session`).toBe(403);
    expect(await response.text()).not.toContain('baseSalaryCents');
  }

  // Writing one is refused too, so the field is not merely hidden from reads.
  const write = await page.request.patch(`${origin}/staff/${positiveSalary.id}`, {
    data: { baseSalaryCents: 1 },
    failOnStatusCode: false,
  });
  expect(write.status(), 'PATCH /staff/:id for a staff session').toBe(403);
  expect(readStoredBaseSalary(positiveSalary.id)).toBe(70_000);

  // The roster information staff *can* reach carries no base-salary field at
  // all — not a nulled one, not a zeroed one.
  const selectable = await page.request.get(`${origin}/staff/selectable`, {
    failOnStatusCode: false,
  });
  expect(selectable.status(), 'GET /staff/selectable for a staff session').toBe(200);
  const members = (await selectable.json()) as Record<string, unknown>[];
  expect(members.length).toBeGreaterThan(0);
  for (const member of members) {
    expect(Object.keys(member)).not.toContain('baseSalaryCents');
  }
  expect(await selectable.text()).not.toContain('baseSalary');

  // Control: the same two URLs serve an administrator, so a blanket route
  // failure cannot masquerade as a passing authorization test.
  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  await signInAsAdmin(adminPage);
  const roster = await adminPage.request.get(`${origin}/staff`, { failOnStatusCode: false });
  expect(roster.status()).toBe(200);
  expect(await roster.text()).toContain('baseSalaryCents');
  const suggestion = await adminPage.request.get(
    `${origin}/compensation/daily-gross?workDate=${DATES.gross2750}`,
    { failOnStatusCode: false },
  );
  expect(suggestion.status()).toBe(200);
  expect(await suggestion.json()).toMatchObject({
    hasBusinessDay: true,
    grossSalesCents: 275_000,
    suggestedCommissionCents: 10_000,
  });
  await adminContext.close();
});

// ===========================================================================
// Opening the form, and the salary prefill
// ===========================================================================

test('the form opens with no staff member, a blank salary, and the gross already shown for the default work date', async ({
  page,
}) => {
  setSingleOpenDay(TODAY, opener);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await expect(workDateInput(page)).toHaveValue(TODAY);
  await expect(staffSelect(page)).toHaveValue('');
  await expect(salaryInput(page)).toHaveValue('');

  // Gross and the suggestion are shown immediately, before any staff member is
  // chosen — the whole-shop figure does not depend on who is selected.
  await grossSettled(page);
  await expect(grossAmount(page)).toHaveText('₱1,500.00');
  await expect(commissionInput(page)).toHaveValue('50.00');
  await expect(grossNote(page)).toHaveCount(0);
  await expect(staffSelect(page)).toHaveValue('');
});

test('selecting a staff member fills the salary from the stored rate, distinguishing no rate, a rate of zero, and a positive rate', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);
  await grossSettled(page);

  // A positive rate prefills, and the field is annotated as coming from it.
  await chooseStaff(page, positiveSalary);
  await expect(salaryInput(page)).toHaveValue('700.00');
  await expect(dialog(page).locator('#compensation-salary-suggested')).toHaveText(
    'From base salary',
  );

  // A stored rate of zero prefills ₱0.00. A `?? 0` implementation passes this
  // and fails the next assertion; one that treats 0 as absent fails this one.
  await chooseStaff(page, zeroSalary);
  await expect(salaryInput(page)).toHaveValue('0.00');

  // No stored rate leaves the field genuinely empty — not '0.00'.
  await chooseStaff(page, unsetSalary);
  await expect(salaryInput(page)).toHaveValue('');
  await expect(dialog(page).locator('#compensation-salary-suggested')).toHaveCount(0);

  // Returning the selection to the placeholder clears the field again.
  await chooseStaff(page, positiveSalary);
  await expect(salaryInput(page)).toHaveValue('700.00');
  await staffSelect(page).selectOption('');
  await expect(staffSelect(page)).toHaveValue('');
  await expect(salaryInput(page)).toHaveValue('');
});

// ===========================================================================
// Gross sales and the commission suggestion
// ===========================================================================

test("the form shows the shop's gross for the work date and suggests ₱50 per full ₱1,000, on both sides of a band boundary", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  // The story's own examples, plus the centavo either side of the first band.
  // ₱999.99 → ₱0 and ₱1,000.00 → ₱50 are adjacent: a rule of ₱50 per *started*
  // ₱1,000, or a rounded one, satisfies ₱2,750 → ₱100 and fails here.
  const cases = [
    { date: DATES.gross2750, gross: '₱2,750.00', commission: '100.00', raw: 275_000 },
    { date: DATES.gross99999, gross: '₱999.99', commission: '0.00', raw: 99_999 },
    { date: DATES.gross100000, gross: '₱1,000.00', commission: '50.00', raw: 100_000 },
    { date: DATES.gross3000, gross: '₱3,000.00', commission: '150.00', raw: 300_000 },
  ] as const;

  for (const { date, gross, commission, raw } of cases) {
    // Changing the work date is also what proves the figures update with it.
    await chooseWorkDate(page, date);
    expect(readRawGrossCents(date), `raw payment total for ${date}`).toBe(raw);
    await expect(grossAmount(page), `gross for ${date}`).toHaveText(gross);
    await expect(commissionInput(page), `suggestion for ${date}`).toHaveValue(commission);
    await expect(grossNote(page)).toHaveCount(0);
    await expect(
      dialog(page).locator('#compensation-commission-suggested'),
    ).toHaveText('Suggested from gross sales');
  }
});

test('no business day on the work date shows ₱0.00, says so, and suggests ₱0', async ({
  page,
}) => {
  expect(readDayStatus(DATES.noDay), `${DATES.noDay} should have no trading day`).toBeNull();
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseWorkDate(page, DATES.noDay);
  await expect(grossAmount(page)).toHaveText('₱0.00');
  await expect(grossNote(page)).toHaveText('No business day on this date');
  await expect(commissionInput(page)).toHaveValue('0.00');
});

test('a business day that opened and sold nothing shows ₱0.00 WITHOUT the no-business-day message', async ({
  page,
}) => {
  // The single most likely implementation slip in this story: deriving the
  // message from `gross === 0` instead of from an explicit hasBusinessDay flag
  // (ADR 0017 §4). Both screens show ₱0.00, so only the message separates them.
  setSingleOpenDay(DATES.openedEmpty, opener);
  expect(readDayStatus(DATES.openedEmpty)).toBe('OPEN');
  expect(readRawGrossCents(DATES.openedEmpty)).toBe(0);

  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseWorkDate(page, DATES.openedEmpty);
  await expect(grossAmount(page)).toHaveText('₱0.00');
  await expect(commissionInput(page)).toHaveValue('0.00');
  await expect(grossNote(page)).toHaveCount(0);
  await expect(grossBlock(page)).not.toContainText('No business day on this date');

  // Control, in the same dialog: a date with genuinely no day does say it. One
  // implementation cannot satisfy both by always, or never, rendering the note.
  await chooseWorkDate(page, DATES.noDay);
  await expect(grossNote(page)).toHaveText('No business day on this date');
});

test("completed sales count towards the gross whether the day is still open or already closed", async ({
  page,
  baseURL,
}) => {
  const date = DATES.openThenClosed;
  await signInAsAdmin(page);

  // Sell onto the day while it is open — the only time the capture API accepts
  // an order for it.
  setSingleOpenDay(date, opener);
  await sell(page.request, apiOrigin(baseURL), 'p2750');
  expect(readRawGrossCents(date)).toBe(275_000);
  expect(readDayStatus(date)).toBe('OPEN');

  await gotoCompensation(page);
  await openAddRecord(page);
  await chooseWorkDate(page, date);
  await expect(grossAmount(page)).toHaveText('₱2,750.00');
  await expect(commissionInput(page)).toHaveValue('100.00');
  await expect(grossNote(page)).toHaveCount(0);

  // Close it by opening another day, and read the same date again. The figure
  // must be identical: the criterion is about the sales, not the day's status.
  setSingleOpenDay(TODAY, opener);
  expect(readDayStatus(date)).toBe('CLOSED');

  await page.reload();
  await gotoCompensation(page);
  await openAddRecord(page);
  await chooseWorkDate(page, date);
  await expect(grossAmount(page)).toHaveText('₱2,750.00');
  await expect(commissionInput(page)).toHaveValue('100.00');
  await expect(grossNote(page)).toHaveCount(0);
});

test('a voided sale lowers the gross, and the suggestion with it across a band boundary', async ({
  page,
}) => {
  // ₱1,200.00 was sold and ₱300.00 of it voided. Counting the reversed sale
  // would show ₱1,200.00 and suggest ₱50; the rule on the real gross of
  // ₱900.00 gives ₱0.
  expect(readRawGrossCents(DATES.voided)).toBe(90_000);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseWorkDate(page, DATES.voided);
  await expect(grossAmount(page)).toHaveText('₱900.00');
  await expect(grossAmount(page)).not.toHaveText('₱1,200.00');
  await expect(commissionInput(page)).toHaveValue('0.00');
});

test('a parked order contributes nothing to the gross or the suggestion', async ({
  page,
}) => {
  // ₱1,000.00 completed and ₱2,000.00 still parked. Counting the parked order
  // would show ₱3,000.00 and suggest ₱150.
  expect(readRawGrossCents(DATES.parked)).toBe(100_000);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseWorkDate(page, DATES.parked);
  await expect(grossAmount(page)).toHaveText('₱1,000.00');
  await expect(commissionInput(page)).toHaveValue('50.00');
});

test('a cash tip is excluded from the gross and from the commission base', async ({
  page,
}) => {
  // ₱1,000.00 of sales with a ₱500.00 cash tip. An inflated gross of ₱1,500.00
  // happens to suggest ₱50 as well, so the gross itself is what distinguishes a
  // correct implementation (ADR 0017 §2) — hence both assertions.
  expect(readRawGrossCents(DATES.tipped)).toBe(100_000);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseWorkDate(page, DATES.tipped);
  await expect(grossAmount(page)).toHaveText('₱1,000.00');
  await expect(grossAmount(page)).not.toHaveText('₱1,500.00');
  await expect(commissionInput(page)).toHaveValue('50.00');
});

test('two staff members on the same work date get the same commission suggestion', async ({
  page,
}) => {
  // The commission base is the whole shop's gross, not the staff member's own
  // sales (human-confirmed, ADR 0017 §2). Asserting it makes a later
  // per-person "fix" fail loudly instead of passing unnoticed.
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);
  await chooseWorkDate(page, DATES.gross2750);

  await chooseStaff(page, positiveSalary);
  await expect(commissionInput(page)).toHaveValue('100.00');
  await expect(salaryInput(page)).toHaveValue('700.00');

  await chooseStaff(page, secondMember);
  await expect(commissionInput(page)).toHaveValue('100.00');
  // The salary, unlike the commission, is per-person.
  await expect(salaryInput(page)).toHaveValue('550.00');
});

// ===========================================================================
// What the administrator typed wins
// ===========================================================================

test('a commission the administrator changed survives a gross refetch, and is re-suggested only after a different staff member or work date', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);
  await chooseWorkDate(page, DATES.gross2750);
  await expect(commissionInput(page)).toHaveValue('100.00');

  // Typed over. The annotation disappearing is the form admitting the value is
  // no longer a suggestion.
  await fillChecked(commissionInput(page), '12.34');
  await expect(
    dialog(page).locator('#compensation-commission-suggested'),
  ).toHaveCount(0);

  // A refetch of the same date must not overwrite it. Editing an unrelated
  // field is what re-renders the form without changing the date.
  await fillChecked(salaryInput(page), '321.00');
  await expect(commissionInput(page)).toHaveValue('12.34');

  // Selecting a staff member re-suggests it — the story names this as one of
  // the two events that may.
  await chooseStaff(page, positiveSalary);
  await expect(commissionInput(page)).toHaveValue('100.00');
  // ...and the salary the administrator typed is replaced by that member's
  // rate, which is the same rule applied to the other field.
  await expect(salaryInput(page)).toHaveValue('700.00');

  // Type over it again, then change the work date: the other event that may.
  await fillChecked(commissionInput(page), '7.00');
  await chooseWorkDate(page, DATES.gross3000);
  await expect(commissionInput(page)).toHaveValue('150.00');
  await expect(
    dialog(page).locator('#compensation-commission-suggested'),
  ).toHaveText('Suggested from gross sales');
});

test('the dirty flag is per field: editing only the commission still lets the next work date re-suggest it, and a typed salary is not clobbered by a gross refetch', async ({
  page,
}) => {
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);
  await chooseStaff(page, positiveSalary);
  await chooseWorkDate(page, DATES.gross100000);
  await expect(salaryInput(page)).toHaveValue('700.00');
  await expect(commissionInput(page)).toHaveValue('50.00');

  // Touch the commission only. A dirty flag shared between the two fields
  // would now also freeze the salary, or be reset by the salary's own history.
  await fillChecked(commissionInput(page), '1.00');
  await expect(salaryInput(page)).toHaveValue('700.00');

  // Changing the work date re-suggests the commission even though it was the
  // field edited.
  await chooseWorkDate(page, DATES.gross3000);
  await expect(commissionInput(page)).toHaveValue('150.00');

  // A typed salary survives a gross refetch triggered by a date change, since
  // the gross has nothing to say about the salary.
  await fillChecked(salaryInput(page), '88.88');
  await chooseWorkDate(page, DATES.gross2750);
  await expect(salaryInput(page)).toHaveValue('88.88');
  await expect(commissionInput(page)).toHaveValue('100.00');
});

// ===========================================================================
// Load allowance
// ===========================================================================

test('saving with Include load allowance records the daily record and a Load allowance that appears on the Adjustments view', async ({
  page,
}) => {
  const member = seedRosterMember(`${ROSTER_PREFIX}Allowance ${TAG}`, 48_000);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  await openAddRecord(page);

  await chooseStaff(page, member);
  await chooseWorkDate(page, DATES.allowance);
  await fillChecked(salaryInput(page), '480.00');
  await fillChecked(commissionInput(page), '0');

  await setAllowance(page, true);
  await fillChecked(allowanceAmount(page), '150.50');
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(dialog(page)).toHaveCount(0);

  // Both rows exist, and the allowance carries the description, the amount and
  // the work date as its effective date.
  const entries = readStoredEntriesForStaff(member.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    workDate: DATES.allowance,
    salaryCents: 48_000,
    commissionCents: 0,
  });

  const adjustments = readStoredAdjustmentsForStaff(member.id);
  expect(adjustments).toHaveLength(1);
  expect(adjustments[0]).toMatchObject({
    kind: 'ALLOWANCE',
    description: 'Load allowance',
    amountCents: 15_050,
    effectiveDate: DATES.allowance,
  });

  // The success message says so, but the criterion asks for the allowance to be
  // verifiable where allowances live, so the Adjustments view is what settles it.
  await page.getByRole('button', { name: 'Adjustments' }).click();
  const filters = page.locator('form[aria-label="Filter compensation adjustments"]');
  await filters.locator('select').first().selectOption({ label: member.displayName });
  await filters.locator('input[type="date"]').first().fill(DATES.allowance);
  await filters.locator('input[type="date"]').nth(1).fill(DATES.allowance);

  const row = page.locator('.adjustment-table tbody tr').filter({ hasText: 'Load allowance' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.adjustment-kind')).toHaveText('Allowance');
  await expect(row.locator('.adjustment-description')).toHaveText('Load allowance');
  await expect(row.locator('.adjustment-amount')).toContainText('150.50');
});

test('selecting Include load allowance makes the amount required and applies the same amount rules as other allowances', async ({
  page,
}) => {
  const member = seedRosterMember(`${ROSTER_PREFIX}Allowance rules ${TAG}`, 20_000);
  await signInAsAdmin(page);
  await gotoCompensation(page);
  const modal = await openAddRecord(page);

  await chooseStaff(page, member);
  await chooseWorkDate(page, DATES.allowance);
  await fillChecked(salaryInput(page), '200.00');
  await fillChecked(commissionInput(page), '0');

  await setAllowance(page, true);
  const save = modal.getByRole('button', { name: 'Add record' });
  const error = modal.locator('#compensation-loadAllowance-error');

  for (const [value, message] of [
    ['', 'Enter an amount.'],
    ['0', 'Amount must be at least ₱0.01.'],
    ['-5', 'Amount cannot be negative.'],
    ['1.234', 'Amount cannot have more than 2 decimal places.'],
    ['x', 'Amount must be a number.'],
  ] as const) {
    // A refused submit refocuses the field in error, so the next fill has to be
    // confirmed to have landed there
    // ([[e2e-refused-submit-refocus-steals-fill]]).
    await fillChecked(allowanceAmount(page), value);
    await save.click();
    await expect(error, `refusing ${JSON.stringify(value)}`).toHaveText(message);
    await expect(allowanceAmount(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(modal).toBeVisible();
    // Nothing was written — neither half of the pair.
    expect(countStoredEntriesForStaff(member.id), `entries after ${value}`).toBe(0);
    expect(countStoredAdjustmentsForStaff(member.id), `allowances after ${value}`).toBe(0);
  }

  // Clearing the checkbox removes the requirement, and the record saves alone.
  await setAllowance(page, false);
  await expect(allowanceAmount(page)).toHaveCount(0);
  await save.click();
  await expect(modal).toHaveCount(0);
  expect(countStoredEntriesForStaff(member.id)).toBe(1);
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);
});

test('a duplicate daily record refuses the save and leaves no orphan Load allowance behind', async ({
  page,
  baseURL,
}) => {
  const member = seedRosterMember(`${ROSTER_PREFIX}Duplicate ${TAG}`, 25_000);
  await signInAsAdmin(page);

  // The reachable "one of the two writes fails" case: the entry already exists,
  // so the refusal comes from the daily record and the allowance must not
  // survive it. Both are written in one transaction (ADR 0017 §5).
  await postOk(page.request, `${apiOrigin(baseURL)}/compensation/entries`, {
    staffMemberId: member.id,
    workDate: DATES.allowanceConflict,
    salaryCents: 25_000,
    commissionCents: 0,
  });
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);

  await gotoCompensation(page);
  const modal = await openAddRecord(page);
  await chooseStaff(page, member);
  await chooseWorkDate(page, DATES.allowanceConflict);
  await fillChecked(salaryInput(page), '250.00');
  await fillChecked(commissionInput(page), '0');
  await setAllowance(page, true);
  await fillChecked(allowanceAmount(page), '99.00');

  await modal.getByRole('button', { name: 'Add record' }).click();

  // A message explains what failed, and says the allowance was not recorded
  // either — the administrator is not left guessing.
  const conflict = modal.locator('.compensation-conflict');
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('already has a record');
  await expect(conflict).toContainText('No load allowance was recorded either.');
  await expect(modal).toBeVisible();

  // Neither a second daily record nor an orphan allowance.
  expect(countStoredEntriesForStaff(member.id)).toBe(1);
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);
  expect(readStoredAdjustmentsForStaff(member.id)).toEqual([]);
});

test('an existing Load allowance warns without blocking: the administrator may save a second one, or clear the checkbox and save without', async ({
  page,
}) => {
  const member = seedRosterMember(`${ROSTER_PREFIX}Second allowance ${TAG}`, 36_000);
  const date = DATES.allowanceDuplicate;
  await signInAsAdmin(page);
  await gotoCompensation(page);

  // First save: record plus allowance, no warning yet.
  let modal = await openAddRecord(page);
  await chooseStaff(page, member);
  await chooseWorkDate(page, date);
  await fillChecked(salaryInput(page), '360.00');
  await fillChecked(commissionInput(page), '0');
  await setAllowance(page, true);
  await expect(duplicateWarning(page)).toHaveCount(0);
  await fillChecked(allowanceAmount(page), '100.00');
  await modal.getByRole('button', { name: 'Add record' }).click();
  await expect(modal).toHaveCount(0);
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(1);

  // Second attempt on the same member and date. Checking the box warns.
  modal = await openAddRecord(page);
  await chooseStaff(page, member);
  await chooseWorkDate(page, date);
  await setAllowance(page, true);
  await expect(duplicateWarning(page)).toContainText('already has a Load allowance');
  await expect(duplicateWarning(page)).toContainText('Saving adds a second one.');

  // The warning is advisory: it does not clear the checkbox on the
  // administrator's behalf, and it does not disable the save (ADR 0017 §6).
  await expect(allowanceCheckbox(page)).toBeChecked();
  await expect(modal.getByRole('button', { name: 'Add record' })).toBeEnabled();

  // Clearing the checkbox removes the warning...
  await setAllowance(page, false);
  await expect(duplicateWarning(page)).toHaveCount(0);
  // ...and re-selecting it brings it back, so it tracks the current choice.
  await setAllowance(page, true);
  await expect(duplicateWarning(page)).toContainText('already has a Load allowance');

  // Saving through the warning creates a genuine second allowance row. The
  // daily record would be a duplicate, so this uses a different work date —
  // what is under test is that the warning does not block the allowance.
  await chooseWorkDate(page, DATES.secondAllowance);
  await fillChecked(salaryInput(page), '360.00');
  await fillChecked(commissionInput(page), '0');
  await setAllowance(page, true);
  await fillChecked(allowanceAmount(page), '75.25');
  await modal.getByRole('button', { name: 'Add record' }).click();
  await expect(modal).toHaveCount(0);

  const adjustments = readStoredAdjustmentsForStaff(member.id);
  expect(adjustments).toHaveLength(2);
  expect(adjustments.map((adjustment) => adjustment.amountCents).sort((a, b) => a - b)).toEqual([
    7_525, 10_000,
  ]);
  for (const adjustment of adjustments) {
    expect(adjustment.description).toBe('Load allowance');
    expect(adjustment.kind).toBe('ALLOWANCE');
  }

  // Two rows on the Adjustments view, not one deduplicated row.
  await page.getByRole('button', { name: 'Adjustments' }).click();
  const filters = page.locator('form[aria-label="Filter compensation adjustments"]');
  await filters.locator('select').first().selectOption({ label: member.displayName });
  // The two allowances sit on different work dates, so the range has to span
  // both — oldest in From, newest in To. An inverted range matches neither day
  // fully and would read as a deduplicated single row.
  await filters.locator('input[type="date"]').first().fill(date);
  await filters.locator('input[type="date"]').nth(1).fill(DATES.secondAllowance);
  await expect(
    page.locator('.adjustment-table tbody tr').filter({ hasText: 'Load allowance' }),
  ).toHaveCount(2);

  // And the other branch: clear the checkbox and the record saves with no
  // allowance at all, leaving the count where it was.
  await showDailyRecords(page);
  modal = await openAddRecord(page);
  await chooseStaff(page, member);
  await chooseWorkDate(page, DATES.gross3000);
  await fillChecked(salaryInput(page), '360.00');
  await fillChecked(commissionInput(page), '0');
  await setAllowance(page, true);
  await setAllowance(page, false);
  await modal.getByRole('button', { name: 'Add record' }).click();
  await expect(modal).toHaveCount(0);
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(2);
  expect(countStoredEntriesForStaff(member.id)).toBe(3);
});

test('editing a daily record offers no load allowance, no gross and no suggestions, and does not recompute the saved amounts', async ({
  page,
  baseURL,
}) => {
  const member = seedRosterMember(`${ROSTER_PREFIX}Edit record ${TAG}`, 90_000);
  await signInAsAdmin(page);

  // Amounts that are neither the member's rate nor the day's suggestion, so a
  // recompute on open would be visible as either value.
  const created = await postOk(page.request, `${apiOrigin(baseURL)}/compensation/entries`, {
    staffMemberId: member.id,
    workDate: DATES.gross2750,
    salaryCents: 11_111,
    commissionCents: 2_222,
  });

  await gotoCompensation(page);
  const filters = page.locator('form[aria-label="Filter compensation records"]');
  await filters.locator('select').first().selectOption({ label: member.displayName });
  await filters.locator('input[type="date"]').first().fill(DATES.gross2750);
  await filters.locator('input[type="date"]').nth(1).fill(DATES.gross2750);

  const row = page.locator('.compensation-table tbody tr').filter({ hasText: member.displayName });
  await expect(row).toHaveCount(1);
  await row
    .getByRole('button', {
      name: `Edit ${member.displayName}'s ${DATES.gross2750} record`,
    })
    .click();
  const modal = dialog(page);
  await expect(modal.getByRole('heading', { name: 'Edit daily record' })).toBeVisible();

  // None of the add-only affordances is present.
  await expect(modal.locator('.compensation-gross')).toHaveCount(0);
  await expect(modal.locator('#compensation-loadAllowance')).toHaveCount(0);
  await expect(modal.getByText('Include load allowance')).toHaveCount(0);
  await expect(modal.locator('#compensation-salary-suggested')).toHaveCount(0);
  await expect(modal.locator('#compensation-commission-suggested')).toHaveCount(0);

  // The saved amounts are shown as saved — not the ₱900.00 base salary and not
  // the ₱100.00 the day's gross would suggest.
  await expect(salaryInput(page)).toHaveValue('111.11');
  await expect(commissionInput(page)).toHaveValue('22.22');

  // Saving the record unchanged keeps the stored values and writes no allowance.
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(modal).toHaveCount(0);
  const stored = readStoredEntriesForStaff(member.id);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: String(created.id),
    salaryCents: 11_111,
    commissionCents: 2_222,
  });
  expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);
});
