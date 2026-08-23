import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  closeBusinessDayDirect,
  countCashMovements,
  openBusinessDayDirect,
  readDayClosings,
  readTradingDays,
  resetBusinessDayWorld,
  seedStaffMembers,
  type SeededOpenDay,
  type SeededStaff,
} from './fixtures/business-day';
import {
  readAmendableCashMovements,
  readCashMovementById,
  readCorrectionOf,
  seedCashMovementReturningId,
  type StoredAmendableCashMovement,
} from './fixtures/cash-amendments';
import { isoShift, shopToday, shortDate } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #351 — "Amend incorrect cash movements without
 * deleting history" (QA task #373).
 *
 * Screens under test: `/pos/cash` (the Amend affordance, the amendment form,
 * review-before-confirm and the linked pair in the ledger), `/pos/close` (the
 * effective cash figures that feed expected drawer cash) and `/reports` plus
 * its CSV export (the admin side of the same figures). The write is
 * `POST /trading-day/cash-movements/:id/amendments`.
 *
 * Four deliberate choices shape this file.
 *
 *  1. **Every "no correction was recorded" claim is asserted against stored
 *     rows, not against the screen.** The story is explicitly about a history
 *     that is never edited, hidden or deleted, so a screen-only assertion would
 *     pass against an implementation that quietly hid the original. Rejections
 *     pin `countCashMovements()` before and after, and the original row is
 *     re-read field by field after each amendment.
 *  2. **The arithmetic is asserted on the totals surfaces, never on the ledger
 *     row alone.** ₱100.00 amended to ₱80.00 has three plausible wrong answers
 *     — ₱180.00 (both rows counted), ₱20.00 (a signed delta) and ₱100.00 (the
 *     filter applied nowhere) — and all three are invisible in the ledger,
 *     which lists every row regardless.
 *  3. **Cross-path agreement gets its own scenario.** The per-kind effective
 *     totals are computed twice — Prisma in `trading-day.service.ts`, raw SQL
 *     in `reporting.service.ts` — and ADR 0015 §3 makes an equality check over
 *     a chain mandatory. It is asserted on one seeded day, across the close
 *     summary, the daily report table, the CSV export, and the stored
 *     `DayClosing` snapshot after that day is closed.
 *  4. **Refusals are checked at the API as well as in the UI.** A missing or
 *     disabled button is not a refusal; the closed-day and already-superseded
 *     criteria are about what the system will accept, so each is also driven
 *     straight at the route.
 *
 * Fixture isolation follows the #123/#154 suites: `resetBusinessDayWorld()`
 * before each test, each test opens exactly the day it needs, and the file runs
 * serially because every screen here reads "the current open business day"
 * globally.
 */

test.describe.configure({ mode: 'serial' });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa351-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TODAY = shopToday();

let staff: Record<string, SeededStaff>;

test.beforeAll(() => {
  staff = seedStaffMembers({
    ada: { displayName: `QA Ada Amender ${TAG}`, isActive: true },
    bruno: { displayName: `QA Bruno Amender ${TAG}`, isActive: true },
  });
});

test.beforeEach(() => {
  resetBusinessDayWorld();
});

test.afterAll(() => {
  // Leave the world as the rest of the suite expects it: one open day with
  // nothing recorded against it.
  resetBusinessDayWorld();
  openBusinessDayDirect({
    businessDate: TODAY,
    dayType: 'NORMAL',
    openingFloatCents: 0,
    openedByStaffMemberId: staff.ada.id,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A business date this suite owns. Offsets are negative so the dates fall
 * inside the reports screen's default 14-date window, which the cross-path
 * scenario reads.
 */
function businessDate(offset: number): string {
  return isoShift(TODAY, -offset);
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
 * An entry reference exactly as the ledger renders it
 * (`entryReference` in CashAndExpensesPage.tsx) — the observable that makes a
 * correction and its original "clearly linked".
 */
function entryReference(id: string): string {
  return `Entry ${id.slice(0, 8)}…${id.slice(-4)}`;
}

function apiOrigin(baseURL: string | undefined): string {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL;
  const hostname = baseURL ? new URL(baseURL).hostname : '127.0.0.1';
  return `http://${hostname}:3000`;
}

function amendmentUrl(baseURL: string | undefined, targetId: string): string {
  return `${apiOrigin(baseURL)}/trading-day/cash-movements/${targetId}/amendments`;
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The username box takes focus on a rAF, so filling the password first would
  // be re-routed into it.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function gotoScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
}

async function gotoCashScreen(page: Page): Promise<void> {
  await gotoScreen(page, '/pos/cash');
  await expect(page.locator('.staff-cash-ledger')).toBeVisible();
}

function openDay(offset: number, openingFloatCents = 0): SeededOpenDay {
  return openBusinessDayDirect({
    businessDate: businessDate(offset),
    dayType: 'NORMAL',
    openingFloatCents,
    openedByStaffMemberId: staff.ada.id,
  });
}

// --- the ledger -------------------------------------------------------------

function ledgerRows(page: Page): Locator {
  return page.locator('.staff-cash-ledger tbody tr');
}

/** The single ledger row whose detail cell carries `description`. */
function ledgerRow(page: Page, description: string): Locator {
  return ledgerRows(page).filter({
    has: page.locator('.staff-cash-detail', { hasText: description }),
  });
}

/**
 * The single ledger row whose AMOUNT cell reads `centsValue`. Filtering the row
 * on the money text at large would also match the superseded row's link copy,
 * which quotes the correction's amount.
 */
function rowWithAmount(page: Page, centsValue: number): Locator {
  return ledgerRows(page).filter({
    has: page.locator('td.staff-cash-amount', { hasText: money(centsValue) }),
  });
}

function amendButton(row: Locator): Locator {
  return row.locator('button.staff-cash-row-action');
}

/** The Record status cell: `Effective` / `Superseded` plus the link copy. */
function statusCell(row: Locator): Locator {
  return row.locator('td').nth(4);
}

// --- the amendment flow -----------------------------------------------------

type EntryType = 'Cash in' | 'Cash out' | 'Expense';

const KIND_VALUE: Record<EntryType, 'CASH_IN' | 'CASH_OUT' | 'EXPENSE'> = {
  'Cash in': 'CASH_IN',
  'Cash out': 'CASH_OUT',
  Expense: 'EXPENSE',
};

function amendPanel(page: Page): Locator {
  return page.locator('.staff-cash-entry-panel');
}

function reviewPanel(page: Page): Locator {
  return page.locator('.staff-cash-review');
}

/** Open the amendment form for one ledger row. */
async function startAmend(page: Page, description: string): Promise<void> {
  await amendButton(ledgerRow(page, description)).click();
  await expect(page.getByRole('heading', { name: 'Amend entry' })).toBeVisible();
}

/** Choose a corrected type the way a user does: by pressing its label. */
async function chooseType(page: Page, type: EntryType): Promise<void> {
  await page
    .locator('.staff-cash-type-options label')
    .filter({ hasText: type })
    .click();
  await expect(
    page.locator(`input[name="kind"][value="${KIND_VALUE[type]}"]`),
  ).toBeChecked();
}

async function fillCorrection(
  page: Page,
  input: { type?: EntryType; amount?: string; reason?: string; category?: string },
): Promise<void> {
  if (input.type !== undefined) await chooseType(page, input.type);
  if (input.amount !== undefined) {
    await page.locator('#cash-amend-amount').fill(input.amount);
  }
  if (input.reason !== undefined) {
    await page.locator('#cash-amend-reason').fill(input.reason);
  }
  if (input.category !== undefined) {
    await page.locator('#cash-amend-category').fill(input.category);
  }
}

async function goToReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review correction' }).click();
  await expect(reviewPanel(page)).toBeVisible();
}

async function confirmCorrection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm correction' }).click();
}

/** Drive the whole flow for one row and wait for the ledger to come back. */
async function amend(
  page: Page,
  description: string,
  corrected: { type?: EntryType; amount?: string; reason?: string; category?: string },
): Promise<void> {
  await startAmend(page, description);
  await fillCorrection(page, corrected);
  await goToReview(page);
  await confirmCorrection(page);
  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    'Correction recorded once.',
  );
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
}

// --- the totals surfaces ----------------------------------------------------

/** `/pos/cash`'s own effective cash summary, as `{ label -> value }`. */
async function effectiveSummary(page: Page): Promise<Record<string, string>> {
  await expect(page.locator('.staff-cash-effective-summary')).toBeVisible();
  const entries = await page
    .locator('.staff-cash-effective-summary dl > div')
    .evaluateAll((nodes) =>
      nodes.map((node) => [
        node.querySelector('dt')?.textContent?.trim() ?? '',
        node.querySelector('dd')?.textContent?.trim() ?? '',
      ]),
    );
  return Object.fromEntries(entries) as Record<string, string>;
}

/** `/pos/close`'s cash summary, as `{ label -> value }` (signs stripped). */
async function closeSummary(page: Page): Promise<Record<string, string>> {
  const entries = await page
    .locator('.staff-cash-summary > div')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const term = node.querySelector('dt');
        const label = Array.from(term?.childNodes ?? [])
          .filter((child) => child.nodeType === 3)
          .map((child) => child.textContent ?? '')
          .join('')
          .trim();
        return [
          label,
          (node.querySelector('dd')?.textContent ?? '')
            .replace(/[+−]/g, '')
            .trim(),
        ];
      }),
    );
  return Object.fromEntries(entries) as Record<string, string>;
}

/** The `/reports` daily-reconciliation row for one business date. */
async function reportRow(page: Page, date: string): Promise<string[]> {
  const rows = await page
    .getByRole('table', { name: 'Daily reconciliation' })
    .locator('tbody tr')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        Array.from(node.querySelectorAll('td')).map((cell) =>
          (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    );
  const row = rows.find((cells) => cells[0] === date);
  expect(row, `no daily reconciliation row for ${date}`).toBeDefined();
  return row!;
}

async function applyRange(page: Page, from: string, to: string): Promise<void> {
  await page.locator('.report-filter label', { hasText: 'From' }).locator('input').fill(from);
  await page.locator('.report-filter label', { hasText: 'To' }).locator('input').fill(to);
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.locator('.applied-range strong')).toHaveText(
    `${shortDate(from)} to ${shortDate(to)}`,
  );
}

/** The CSV data row for one business date, as raw fields. */
async function csvRow(page: Page, date: string): Promise<string[]> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const lines = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/);
  const row = lines.slice(1).find((line) => line.startsWith(`${date},`));
  expect(row, `no CSV row for ${date}`).toBeDefined();
  return row!.split(',');
}

/** Sign in a second browser context as the administrator. */
async function adminPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInAsAdmin(page);
  return { context, page };
}

/** Close the current open day through the real closing screen. */
async function closeDayThroughUi(page: Page, actualCash: string): Promise<void> {
  await gotoScreen(page, '/pos/close');
  await page.locator('#actualCash').fill(actualCash);
  await page.locator('#closedBy').selectOption({ label: staff.bruno.displayName });
  await page.getByRole('button', { name: 'Close day' }).click();
  await expect(page.locator('.staff-close-success')).toBeVisible();
}

/** The stored row set, keyed by id, for before/after comparisons. */
function storedById(): Map<string, StoredAmendableCashMovement> {
  return new Map(readAmendableCashMovements().map((row) => [row.id, row]));
}

// ---------------------------------------------------------------------------
// crit 1, 2 — the Amend action identifies its target and offers every value
// ---------------------------------------------------------------------------

test('offers an Amend action that names the entry it corrects and opens with every correctable value', async ({
  page,
}) => {
  const day = openDay(1);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'EXPENSE',
    amountCents: 12_345,
    description: `Milk delivery ${TAG}`,
    category: 'Supplies',
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);

  // crit 1 — the affordance identifies the entry, in its accessible name, by
  // the three facts a person uses to recognise it.
  const row = ledgerRow(page, `Milk delivery ${TAG}`);
  await expect(amendButton(row)).toBeEnabled();
  await expect(amendButton(row)).toHaveAttribute(
    'aria-label',
    `Amend Expense ${money(12_345)}, Milk delivery ${TAG}`,
  );

  await startAmend(page, `Milk delivery ${TAG}`);

  // The original is shown in full, named by the same reference the ledger uses.
  const original = page.locator('.staff-cash-original');
  await expect(original.getByRole('heading')).toHaveText(
    `Original entry, ${entryReference(targetId)}`,
  );
  await expect(original).toContainText('Expense');
  await expect(original).toContainText(money(12_345));
  await expect(original).toContainText(`Milk delivery ${TAG}`);
  await expect(original).toContainText('Supplies');

  // crit 2 — type, amount, description and category are all correctable, and
  // they open pre-loaded with the recorded values.
  await expect(page.locator('input[name="kind"][value="EXPENSE"]')).toBeChecked();
  await expect(page.locator('#cash-amend-amount')).toHaveValue('123.45');
  await expect(page.locator('#cash-amend-reason')).toHaveValue(`Milk delivery ${TAG}`);
  await expect(page.locator('#cash-amend-category')).toHaveValue('Supplies');

  // Category is accepted only for an expense: choosing another type withdraws
  // the field rather than sending a category the server would refuse.
  await chooseType(page, 'Cash out');
  await expect(page.locator('#cash-amend-category')).toHaveCount(0);
  await expect(amendPanel(page)).toContainText(
    'Category is not available for Cash out.',
  );

  // Nothing has been written by merely opening the flow.
  expect(countCashMovements()).toBe(1);
});

// ---------------------------------------------------------------------------
// crit 3, 5, 6 — the story's worked example, asserted on the real totals
// ---------------------------------------------------------------------------

test('amending a ₱100.00 cash-in to ₱80.00 appends one linked correction and leaves effective cash-in ₱80.00', async ({
  page,
}) => {
  const day = openDay(2);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  // The entry being corrected is recorded through the real capture path, so
  // the amendment operates on a row the product itself produced.
  await chooseType(page, 'Cash in');
  await page.locator('#cash-amount').fill('100');
  await page.locator('#cash-reason').fill(`Float top-up ${TAG}`);
  await page.getByRole('button', { name: 'Record entry' }).click();
  await expect(page.locator('.staff-inventory-message.success')).toBeVisible();

  const originalId = readAmendableCashMovements()[0]!.id;
  const originalBefore = readCashMovementById(originalId);
  expect(await effectiveSummary(page)).toMatchObject({ 'Cash in': money(10_000) });

  await startAmend(page, `Float top-up ${TAG}`);
  await fillCorrection(page, { amount: '80' });

  // crit 3 — review before confirmation: original beside proposed, with what
  // changed marked, and nothing recorded yet.
  await goToReview(page);
  await expect(reviewPanel(page)).toContainText('Nothing has been recorded yet.');
  const originalSide = reviewPanel(page).locator(
    'section[aria-labelledby="cash-review-original-title"]',
  );
  const proposedSide = reviewPanel(page).locator('section.proposed');
  await expect(originalSide.getByRole('heading')).toHaveText(
    `Original, ${entryReference(originalId)}`,
  );
  await expect(originalSide).toContainText(money(10_000));
  await expect(proposedSide).toContainText(money(8_000));
  await expect(proposedSide.locator('div.changed')).toContainText(money(8_000));
  expect(countCashMovements()).toBe(1);

  await confirmCorrection(page);
  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    'Correction recorded once.',
  );
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);

  // crit 3 — one appended row carrying the corrected values in full, and the
  // original is byte-for-byte what it was.
  const rows = readAmendableCashMovements();
  expect(rows).toHaveLength(2);
  expect(readCashMovementById(originalId)).toEqual(originalBefore);
  const correction = readCorrectionOf(originalId)!;
  expect(correction).toMatchObject({
    kind: 'CASH_IN',
    amountCents: 8_000,
    description: `Float top-up ${TAG}`,
    tradingDayId: day.id,
    amendsCashMovementId: originalId,
  });

  // crit 5 — both halves stay visible, distinguishable, and each names the
  // other.
  await expect(ledgerRows(page)).toHaveCount(2);
  const originalRow = rowWithAmount(page, 10_000);
  const correctionRow = rowWithAmount(page, 8_000);
  await expect(statusCell(originalRow)).toContainText('Superseded');
  await expect(statusCell(originalRow)).toContainText(
    `Corrected by ${entryReference(correction.id)}`,
  );
  await expect(statusCell(correctionRow)).toContainText('Effective');
  await expect(statusCell(correctionRow)).toContainText(
    `Corrects ${entryReference(originalId)}`,
  );
  await expect(originalRow).toHaveClass(/staff-cash-row-superseded/);
  await expect(correctionRow).toHaveClass(/staff-cash-row-correction/);

  // crit 6 — the number. ₱80.00, not ₱180.00 (both rows) and not ₱20.00 (a
  // signed delta), on the drawer surface as well as the ledger's own summary.
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(8_000),
    'Expected cash': money(8_000),
  });

  await gotoScreen(page, '/pos/close');
  const summary = await closeSummary(page);
  expect(summary['Cash in']).toBe(money(8_000));
  expect(summary['Expected cash']).toBe(money(8_000));
  expect(summary['Cash in']).not.toBe(money(18_000));
});

// ---------------------------------------------------------------------------
// crit 2, 6 — the cross-type correction moves BOTH totals
// ---------------------------------------------------------------------------

test('a cash-in corrected to a cash-out leaves the amount in exactly one total', async ({
  page,
}) => {
  const day = openDay(3);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 10_000,
    description: `Wrong direction ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(10_000),
    'Cash out': money(0),
  });

  await amend(page, `Wrong direction ${TAG}`, { type: 'Cash out' });

  const correction = readCorrectionOf(targetId)!;
  expect(correction).toMatchObject({ kind: 'CASH_OUT', amountCents: 10_000 });

  // Both totals move in one step: the amount leaves cash-in and joins cash-out.
  // Counting it in both would leave cash-in at ₱100.00 here.
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(0),
    'Cash out': money(10_000),
    'Expected cash': money(-10_000),
  });

  await gotoScreen(page, '/pos/close');
  const summary = await closeSummary(page);
  expect(summary['Cash in']).toBe(money(0));
  expect(summary['Cash out']).toBe(money(10_000));
});

// ---------------------------------------------------------------------------
// crit 5, 6 — a correction that changes no money still reads as a pair
// ---------------------------------------------------------------------------

test('a description-and-category-only correction moves no total and still reads as a corrected pair', async ({
  page,
}) => {
  const day = openDay(4);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'EXPENSE',
    amountCents: 4_500,
    description: `Typo in reason ${TAG}`,
    category: 'Misc',
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  const before = await effectiveSummary(page);
  expect(before).toMatchObject({ 'Expenses (cash)': money(4_500) });

  await amend(page, `Typo in reason ${TAG}`, {
    reason: `Corrected reason ${TAG}`,
    category: 'Supplies',
  });

  const correction = readCorrectionOf(targetId)!;
  expect(correction).toMatchObject({
    kind: 'EXPENSE',
    amountCents: 4_500,
    description: `Corrected reason ${TAG}`,
    category: 'Supplies',
  });

  // Not a centavo moves — the amount was never in question.
  expect(await effectiveSummary(page)).toEqual(before);

  // And the pair still reads as corrected, so a person can see which reason is
  // the effective one.
  await expect(ledgerRows(page)).toHaveCount(2);
  await expect(
    statusCell(ledgerRow(page, `Typo in reason ${TAG}`)),
  ).toContainText('Superseded');
  await expect(
    statusCell(ledgerRow(page, `Corrected reason ${TAG}`)),
  ).toContainText('Effective');
});

// ---------------------------------------------------------------------------
// crit 8 — cancelling records nothing and asks nothing of the server
// ---------------------------------------------------------------------------

test('cancelling from the review step records no entry, issues no request and changes no total', async ({
  page,
}) => {
  const day = openDay(5);
  seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 25_000,
    description: `Kept as recorded ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  const before = await effectiveSummary(page);
  const rowsBefore = readAmendableCashMovements();

  const amendmentRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/amendments')) amendmentRequests.push(request.url());
  });

  await startAmend(page, `Kept as recorded ${TAG}`);
  await fillCorrection(page, { amount: '250.50', reason: `Never confirmed ${TAG}` });
  await goToReview(page);
  await page.getByRole('button', { name: 'Cancel, record nothing' }).click();

  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    'Correction cancelled. Nothing was recorded.',
  );
  expect(amendmentRequests).toEqual([]);
  expect(readAmendableCashMovements()).toEqual(rowsBefore);
  expect(await effectiveSummary(page)).toEqual(before);
  await expect(ledgerRows(page)).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// crit 9 — one correction per confirmed amendment, however many times it is sent
// ---------------------------------------------------------------------------

test('double-clicking Confirm and replaying the same request record exactly one correction', async ({
  page,
  baseURL,
}) => {
  const day = openDay(6);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 30_000,
    description: `Impatient confirm ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);

  // Capture the exact request the confirm issues, so it can be replayed
  // verbatim — the retry half of the criterion.
  let sentBody: Record<string, unknown> | null = null;
  page.on('request', (request) => {
    if (request.url().includes('/amendments') && request.method() === 'POST') {
      sentBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    }
  });

  await startAmend(page, `Impatient confirm ${TAG}`);
  await fillCorrection(page, { amount: '200' });
  await goToReview(page);

  const confirm = page.getByRole('button', { name: /^Confirm(ing)? correction|^Confirming…/ });
  await page.getByRole('button', { name: 'Confirm correction' }).dblclick();
  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    'Correction recorded once.',
  );
  await expect(confirm).toHaveCount(0);

  expect(countCashMovements()).toBe(2);
  const correction = readCorrectionOf(targetId)!;
  expect(correction.amountCents).toBe(20_000);
  expect(sentBody, 'the confirm did not issue an amendment request').not.toBeNull();

  // The same submission, replayed against the route as a retry would.
  const replay = await page.request.post(amendmentUrl(baseURL, targetId), {
    data: sentBody!,
  });
  expect(
    replay.ok(),
    `replay was refused (${replay.status()}): ${await replay.text()}`,
  ).toBe(true);
  expect(((await replay.json()) as { id: string }).id).toBe(correction.id);

  // One correction, one movement of the total.
  expect(countCashMovements()).toBe(2);
  await gotoCashScreen(page);
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(20_000),
    'Expected cash': money(20_000),
  });
});

// ---------------------------------------------------------------------------
// crit 4 — an already-superseded entry cannot be amended a second time
// ---------------------------------------------------------------------------

test('an entry that is already superseded offers no Amend affordance and refuses a direct request', async ({
  page,
  baseURL,
}) => {
  const day = openDay(7);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_OUT',
    amountCents: 5_000,
    description: `Already corrected ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  await amend(page, `Already corrected ${TAG}`, { amount: '40' });
  const correction = readCorrectionOf(targetId)!;

  // The UI path: the affordance is withdrawn and says why, naming the entry
  // that already corrected this one.
  // Both halves carry the same description here (the correction changed only
  // the amount), so the superseded half is identified by its amount.
  const supersededRow = rowWithAmount(page, 5_000);
  await expect(amendButton(supersededRow)).toBeDisabled();
  await expect(supersededRow.locator('.staff-cash-action-note')).toHaveText(
    `Already corrected by ${entryReference(correction.id)}.`,
  );

  // The API path: a hidden button is not a refusal.
  const before = countCashMovements();
  const refused = await page.request.post(amendmentUrl(baseURL, targetId), {
    data: {
      clientGeneratedId: crypto.randomUUID(),
      kind: 'CASH_OUT',
      amountCents: 1_000,
      description: `Second correction of the same original ${TAG}`,
    },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({
    supersededByCashMovementId: correction.id,
  });
  expect(countCashMovements()).toBe(before);

  // The correction itself, however, may be amended — that is what makes a
  // chain rather than a dead end.
  await gotoCashScreen(page);
  await expect(
    amendButton(rowWithAmount(page, 4_000)),
  ).toBeEnabled();
});

// ---------------------------------------------------------------------------
// crit 10 — two submissions racing for the same entry
// ---------------------------------------------------------------------------

test('a submission for an entry corrected meanwhile is refused and staff are prompted with the winning correction', async ({
  page,
  baseURL,
}) => {
  const day = openDay(8);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 60_000,
    description: `Contended entry ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);

  // This screen opens its review step first…
  await startAmend(page, `Contended entry ${TAG}`);
  await fillCorrection(page, { amount: '500' });
  await goToReview(page);

  // …while a second device corrects the same entry and wins.
  const winner = await page.request.post(amendmentUrl(baseURL, targetId), {
    data: {
      clientGeneratedId: crypto.randomUUID(),
      kind: 'CASH_IN',
      amountCents: 55_000,
      description: `Winning correction ${TAG}`,
    },
  });
  expect(winner.ok()).toBe(true);
  const winnerId = ((await winner.json()) as { id: string }).id;

  await confirmCorrection(page);

  // The loser records nothing and is told which correction won.
  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    `${entryReference(targetId)} was already corrected by ${entryReference(winnerId)}.`,
  );
  await expect(page.locator('.staff-inventory-message.success')).toContainText(
    'No correction was recorded by this request.',
  );

  expect(countCashMovements()).toBe(2);
  expect(readCorrectionOf(targetId)!.id).toBe(winnerId);
  expect(
    readAmendableCashMovements().some((row) => row.amountCents === 50_000),
  ).toBe(false);

  // The refreshed ledger shows the winning correction, and the total counts it
  // exactly once.
  await expect(ledgerRow(page, `Winning correction ${TAG}`)).toHaveCount(1);
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(55_000),
  });
});

// ---------------------------------------------------------------------------
// crit 4, 5, 7 — a chain, and the same effective totals wherever they are shown
// ---------------------------------------------------------------------------

test('a two-link chain is effective at its tail, and the close summary, daily report and CSV agree exactly', async ({
  page,
  browser,
  baseURL,
}) => {
  const date = businessDate(9);
  const day = openBusinessDayDirect({
    businessDate: date,
    dayType: 'NORMAL',
    openingFloatCents: 0,
    openedByStaffMemberId: staff.ada.id,
  });
  const originalId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 10_000,
    description: `Chained entry ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  await amend(page, `Chained entry ${TAG}`, { reason: `First correction ${TAG}`, amount: '80' });
  await amend(page, `First correction ${TAG}`, { reason: `Second correction ${TAG}`, amount: '75' });

  // crit 4, 5 — three rows, one chain, each link naming the next.
  const first = readCorrectionOf(originalId)!;
  const second = readCorrectionOf(first.id)!;
  expect(readAmendableCashMovements()).toHaveLength(3);
  expect(second.amendsCashMovementId).toBe(first.id);
  expect(readCashMovementById(originalId)!.amountCents).toBe(10_000);

  await expect(ledgerRows(page)).toHaveCount(3);
  const originalRow = ledgerRow(page, `Chained entry ${TAG}`);
  const firstRow = ledgerRow(page, `First correction ${TAG}`);
  const secondRow = ledgerRow(page, `Second correction ${TAG}`);
  await expect(originalRow.locator('.staff-cash-chain-position')).toHaveText('Original');
  await expect(firstRow.locator('.staff-cash-chain-position')).toHaveText('Correction 1 of 2');
  await expect(secondRow.locator('.staff-cash-chain-position')).toHaveText('Correction 2 of 2');
  await expect(statusCell(originalRow)).toContainText('Superseded');
  await expect(statusCell(firstRow)).toContainText('Superseded');
  await expect(statusCell(secondRow)).toContainText('Effective');
  await expect(statusCell(firstRow)).toContainText(
    `Corrected again by ${entryReference(second.id)}`,
  );

  // crit 6 — the tail is what counts, once.
  expect(await effectiveSummary(page)).toMatchObject({
    'Cash in': money(7_500),
    'Expected cash': money(7_500),
  });

  await gotoScreen(page, '/pos/close');
  const beforeClose = await closeSummary(page);
  expect(beforeClose['Cash in']).toBe(money(7_500));
  expect(beforeClose['Expected cash']).toBe(money(7_500));

  // crit 7 — the admin side reads the same day through a different
  // implementation of the effective-set filter (raw SQL, not Prisma). The two
  // must agree exactly, on the screen and in the export.
  const admin = await adminPage(browser, baseURL);
  try {
    await admin.page.goto('/reports');
    await expect(
      admin.page.getByRole('heading', { name: 'Reports', level: 1 }),
    ).toBeVisible();
    await applyRange(admin.page, date, date);

    const openRow = await reportRow(admin.page, date);
    expect(openRow[1]).toBe('Open');
    expect(openRow[6]).toBe(money(7_500)); // Cash in
    expect(openRow[7]).toBe(money(0)); // Cash out
    expect(openRow[8]).toBe(money(0)); // Cash expenses
    expect(openRow[10]).toBe(money(7_500)); // Expected cash

    const openCsv = await csvRow(admin.page, date);
    expect(openCsv[6]).toBe('75.00'); // Cash in
    expect(openCsv[7]).toBe('0.00'); // Cash out
    expect(openCsv[8]).toBe('0.00'); // Cash expenses
    expect(openCsv[10]).toBe('75.00'); // Expected cash

    // And again once the day is closed, because the stored snapshot is
    // computed by the close path rather than by the report's query.
    await closeDayThroughUi(page, '75');
    const closing = readDayClosings();
    expect(closing).toHaveLength(1);
    expect(closing[0]).toMatchObject({
      cashInCents: 7_500,
      cashOutCents: 0,
      cashExpensesCents: 0,
      expectedCashCents: 7_500,
    });

    await admin.page.reload();
    await applyRange(admin.page, date, date);
    const closedRow = await reportRow(admin.page, date);
    expect(closedRow[1]).toBe('Closed');
    expect(closedRow[6]).toBe(money(7_500));
    expect(closedRow[10]).toBe(money(7_500));
    expect(closedRow[11]).toBe(money(7_500)); // Actual cash
    expect(closedRow[12]).toBe(money(0)); // Variance

    const closedCsv = await csvRow(admin.page, date);
    expect(closedCsv[6]).toBe('75.00');
    expect(closedCsv[10]).toBe('75.00');
  } finally {
    await admin.context.close();
  }

  // The whole chain survives the close: nothing was hidden or removed.
  expect(readAmendableCashMovements()).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// crit 12 — the day closing between review and confirmation
// ---------------------------------------------------------------------------

test('a day that closes between the review step and confirmation refuses the correction and records nothing', async ({
  page,
}) => {
  const day = openDay(10);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'EXPENSE',
    amountCents: 3_000,
    description: `Closing race ${TAG}`,
    category: 'Supplies',
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  await startAmend(page, `Closing race ${TAG}`);
  await fillCorrection(page, { amount: '20' });
  await goToReview(page);

  // The day closes while the review step is open.
  closeBusinessDayDirect(day.id);
  await confirmCorrection(page);

  await expect(page.locator('.staff-cash-no-day')).toContainText(
    'The business day closed before confirmation. No correction was recorded.',
  );
  expect(countCashMovements()).toBe(1);
  expect(readCorrectionOf(targetId)).toBeNull();
  expect(readCashMovementById(targetId)!.amountCents).toBe(3_000);
});

// ---------------------------------------------------------------------------
// crit 13 — a closed day stays read-only, and its recorded close is untouched
// ---------------------------------------------------------------------------

test('an entry belonging to a closed day cannot be amended and the recorded close does not change', async ({
  page,
  baseURL,
}) => {
  const closedDay = openDay(12, 10_000);
  const targetId = seedCashMovementReturningId({
    tradingDayId: closedDay.id,
    kind: 'CASH_IN',
    amountCents: 20_000,
    description: `Recorded on a closed day ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  // Close that day for real, so there is a stored snapshot to compare against.
  await closeDayThroughUi(page, '300');
  const closingBefore = readDayClosings();
  expect(closingBefore).toHaveLength(1);
  expect(closingBefore[0]!.cashInCents).toBe(20_000);

  const refused = await page.request.post(amendmentUrl(baseURL, targetId), {
    data: {
      clientGeneratedId: crypto.randomUUID(),
      kind: 'CASH_IN',
      amountCents: 100,
      description: `Amending after the close ${TAG}`,
    },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain('closed business day');

  // Nothing appended, nothing edited, and the recorded close is byte-for-byte
  // what it was — the criterion's "not silently changed".
  expect(countCashMovements()).toBe(1);
  expect(readCashMovementById(targetId)!.amountCents).toBe(20_000);
  expect(readDayClosings()).toEqual(closingBefore);
  expect(readTradingDays()[0]!.status).toBe('CLOSED');

  // And a later open day never offers the closed day's entry for amendment.
  openDay(11);
  await gotoCashScreen(page);
  await expect(ledgerRow(page, `Recorded on a closed day ${TAG}`)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// crit 11 — an amendment is not a privileged write
// ---------------------------------------------------------------------------

test('an amendment is validated as strictly as an original entry, and a rejection records nothing', async ({
  page,
  baseURL,
}) => {
  const day = openDay(13);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 9_900,
    description: `Validation target ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  const before = await effectiveSummary(page);

  await startAmend(page, `Validation target ${TAG}`);

  // A non-positive amount never reaches the review step.
  await fillCorrection(page, { amount: '0' });
  await page.getByRole('button', { name: 'Review correction' }).click();
  await expect(page.locator('#cash-amend-amount-error')).toBeVisible();
  await expect(reviewPanel(page)).toHaveCount(0);

  // Neither does a blank description.
  await fillCorrection(page, { amount: '50', reason: '   ' });
  await page.getByRole('button', { name: 'Review correction' }).click();
  await expect(page.locator('#cash-amend-reason-error')).toBeVisible();
  await expect(reviewPanel(page)).toHaveCount(0);

  expect(countCashMovements()).toBe(1);

  // The form is not the only guard: the route refuses the same shapes, plus a
  // category on a non-expense correction, which the form cannot even express.
  const rejected: Array<[string, Record<string, unknown>]> = [
    ['zero amount', { kind: 'CASH_IN', amountCents: 0, description: 'Zero' }],
    ['negative amount', { kind: 'CASH_IN', amountCents: -5_000, description: 'Negative' }],
    ['blank description', { kind: 'CASH_IN', amountCents: 5_000, description: '   ' }],
    [
      'category on a non-expense',
      {
        kind: 'CASH_IN',
        amountCents: 5_000,
        description: 'Category where it does not belong',
        category: 'Supplies',
      },
    ],
  ];
  for (const [label, body] of rejected) {
    const response = await page.request.post(amendmentUrl(baseURL, targetId), {
      data: { clientGeneratedId: crypto.randomUUID(), ...body },
    });
    expect(response.status(), `${label} was accepted`).toBe(400);
  }

  // A target that does not exist is refused too, and not with a 500.
  const missing = await page.request.post(
    amendmentUrl(baseURL, '00000000-0000-4000-8000-000000000000'),
    {
      data: {
        clientGeneratedId: crypto.randomUUID(),
        kind: 'CASH_IN',
        amountCents: 5_000,
        description: `Amending a ghost ${TAG}`,
      },
    },
  );
  expect(missing.status()).toBe(404);

  // No rejection wrote a row or moved a total.
  expect(countCashMovements()).toBe(1);
  expect(readCorrectionOf(targetId)).toBeNull();
  await gotoCashScreen(page);
  expect(await effectiveSummary(page)).toEqual(before);
});

// ---------------------------------------------------------------------------
// crit 14 — no hard-delete path anywhere
// ---------------------------------------------------------------------------

test('neither the ledger nor the API offers a way to delete or void a cash entry', async ({
  page,
  baseURL,
}) => {
  const day = openDay(14);
  const targetId = seedCashMovementReturningId({
    tradingDayId: day.id,
    kind: 'CASH_IN',
    amountCents: 7_000,
    description: `Permanent record ${TAG}`,
    recordedBy: staff.ada,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);
  await amend(page, `Permanent record ${TAG}`, { amount: '65' });

  // The only row-level control is Amend — no delete, void, hide or remove, on
  // either half of the pair.
  const controls = await ledgerRows(page)
    .locator('button, a')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').trim()),
    );
  expect(controls).toEqual(['Amend', 'Amend']);
  await expect(page.locator('.staff-cash-ledger')).not.toContainText(/delete|void|remove|hide/i);

  // And the route does not exist either — a UI without a button is not the
  // same as a system that cannot delete.
  const correction = readCorrectionOf(targetId)!;
  for (const id of [targetId, correction.id]) {
    const response = await page.request.delete(
      `${apiOrigin(baseURL)}/trading-day/cash-movements/${id}`,
    );
    expect(response.ok(), `DELETE for ${id} was accepted`).toBe(false);
  }

  // Both halves are still there, and still say what they always said.
  const rows = storedById();
  expect(rows.size).toBe(2);
  expect(rows.get(targetId)!.amountCents).toBe(7_000);
  expect(rows.get(correction.id)!.amountCents).toBe(6_500);
});
