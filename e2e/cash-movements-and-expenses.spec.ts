import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeBusinessDayDirect,
  countCashMovements,
  openBusinessDayDirect,
  readCashMovements,
  resetBusinessDayWorld,
  seedCashMovement,
  seedStaffMembers,
  type SeededOpenDay,
  type SeededStaff,
} from './fixtures/business-day';

/**
 * End-to-end coverage for story #154 — "Record daily cash movements and
 * expenses" (QA task #159).
 *
 * Screen under test: `/pos/cash` (apps/web/src/trading-day/CashAndExpensesPage.tsx),
 * writing through `POST /trading-day/cash-movements` into `cash_movements`.
 *
 * Three deliberate choices shape this file.
 *
 *  1. **Validation is asserted as an absence of rows, not as a message.** The
 *     story's criterion is "no entry is recorded", so every rejection test pins
 *     `countCashMovements()` before and after. A spec that only asserted the
 *     error text would still pass if the entry were written anyway.
 *  2. **The peso→cents boundary is asserted twice.** Once against the stored
 *     `amountCents` (the only place rounding drift is exactly observable) and
 *     once against the close screen's expected-cash figure, because a drift of
 *     one centavo is invisible in the ledger's own formatting.
 *  3. **The roster change in the attribution-snapshot test goes through the real
 *     admin endpoint** (`PATCH /staff/:id`, the same call the roster screen
 *     makes), not a direct row edit — the criterion is about a change the
 *     product can actually produce.
 *
 * Fixture isolation follows the #123 suite: `resetBusinessDayWorld()` before each
 * test, and each test opens exactly the day it needs. Both screens read "the
 * current open business day" globally, so the file runs serially.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa154-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let staff: Record<string, SeededStaff>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  staff = seedStaffMembers({
    ada: { displayName: `QA Ada Recorder ${TAG}`, isActive: true },
    bruno: { displayName: `QA Bruno Recorder ${TAG}`, isActive: true },
    zara: { displayName: `QA Zara Retired ${TAG}`, isActive: false },
    rosa: { displayName: `QA Rosa Renamed ${TAG}`, isActive: true },
  });
});

test.beforeEach(() => {
  resetBusinessDayWorld();
});

test.afterAll(() => {
  // Leave the environment as the rest of the suite expects it: one open day,
  // nothing recorded against it.
  resetBusinessDayWorld();
  openBusinessDayDirect({
    businessDate: businessDate(0),
    dayType: 'NORMAL',
    openingFloatCents: 0,
    openedByStaffMemberId: staff.ada.id,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A business date this suite owns, far from the dates other suites seed. */
function businessDate(offset: number): string {
  const base = Date.UTC(2027, 4, 1); // 2027-05-01
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The business date exactly as `/pos/cash` renders it. Note this is NOT the same
 * format the open/close screens use (`month: 'short'` there, `'long'` here), so
 * it is derived from CashAndExpensesPage.tsx rather than shared with the #123 spec.
 */
function cashPageDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'long',
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
 * The API origin on the same hostname the page is served from. The session is an
 * httpOnly SameSite=Lax cookie, so a request issued against a different spelling
 * of localhost travels without it and 401s for the wrong reason.
 */
function apiOrigin(baseURL: string | undefined): string {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL;
  const hostname = baseURL ? new URL(baseURL).hostname : '127.0.0.1';
  return `http://${hostname}:3000`;
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

/** Navigate to a staff screen and wait for its initial load to settle. */
async function gotoScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
}

async function gotoCashScreen(page: Page): Promise<void> {
  await gotoScreen(page, '/pos/cash');
}

/** Open the day every test in this file records against. */
function openDay(offset: number, openingFloatCents = 0): SeededOpenDay {
  return openBusinessDayDirect({
    businessDate: businessDate(offset),
    dayType: 'NORMAL',
    openingFloatCents,
    openedByStaffMemberId: staff.ada.id,
  });
}

type EntryType = 'Cash in' | 'Cash out' | 'Expense';

const KIND_VALUE: Record<EntryType, string> = {
  'Cash in': 'CASH_IN',
  'Cash out': 'CASH_OUT',
  Expense: 'EXPENSE',
};

/**
 * The real radio input for one type. It is deliberately sr-only (the styled
 * `<span>` beside it is the visual control), so it is the thing to *assert*
 * against — `chooseType` is the thing to click.
 */
function typeRadio(page: Page, type: EntryType): Locator {
  return page.locator(`input[name="kind"][value="${KIND_VALUE[type]}"]`);
}

/** Select an entry type the way a user does: by pressing its label. */
async function chooseType(page: Page, type: EntryType): Promise<void> {
  await page
    .locator('.staff-cash-type-options label')
    .filter({ hasText: type })
    .click();
  await expect(typeRadio(page, type)).toBeChecked();
}

function amountField(page: Page): Locator {
  return page.locator('#cash-amount');
}

function reasonField(page: Page): Locator {
  return page.locator('#cash-reason');
}

function categoryField(page: Page): Locator {
  return page.locator('#cash-category');
}

function recordedByField(page: Page): Locator {
  return page.locator('#cash-recorded-by');
}

function recordButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Record entry' });
}

async function fillEntry(
  page: Page,
  input: {
    type?: EntryType;
    amount?: string;
    reason?: string;
    category?: string;
    recordedBy?: string;
  },
): Promise<void> {
  if (input.type !== undefined) {
    await chooseType(page, input.type);
  }
  if (input.amount !== undefined) {
    await amountField(page).fill(input.amount);
  }
  if (input.reason !== undefined) {
    await reasonField(page).fill(input.reason);
  }
  if (input.category !== undefined) {
    await categoryField(page).fill(input.category);
  }
  if (input.recordedBy !== undefined) {
    await recordedByField(page).selectOption({ label: input.recordedBy });
  }
}

/** Fill and submit one entry, waiting for the success acknowledgement. */
async function recordEntry(
  page: Page,
  input: Parameters<typeof fillEntry>[1],
): Promise<void> {
  await fillEntry(page, input);
  await recordButton(page).click();
  await expect(page.locator('.staff-inventory-message.success')).toBeVisible();
}

function ledgerRows(page: Page): Locator {
  return page.locator('.staff-cash-ledger tbody tr');
}

/** One ledger row as the five columns the criteria name. */
async function ledgerRow(
  page: Page,
  index: number,
): Promise<{ type: string; amount: string; detail: string; by: string }> {
  const cells = ledgerRows(page).nth(index).locator('td');
  const [type, amount, detail, by] = await cells.allInnerTexts();
  return {
    // The type cell carries a decorative +/− glyph that is aria-hidden; the
    // criterion is about the label, so it is stripped here.
    type: type!.replace(/[+−]/g, '').trim(),
    amount: amount!.trim(),
    detail: detail!.trim(),
    by: by!.trim(),
  };
}

/** The exact rendered detail text for a row — the AC 8 assertion. */
async function detailText(page: Page, index: number): Promise<string> {
  return (
    (await ledgerRows(page).nth(index).locator('.staff-cash-detail').textContent()) ??
    ''
  ).trim();
}

/** The close screen's cash summary as `{ label -> value }`. */
async function cashSummary(page: Page): Promise<Record<string, string>> {
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
        return [label, node.querySelector('dd')?.textContent?.trim() ?? ''];
      }),
    );
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Sign in a fresh request context as the administrator. */
async function adminRequest(page: Page, baseURL: string | undefined) {
  const context = await page.context().browser()!.newContext({ baseURL });
  const response = await context.request.post(`${apiOrigin(baseURL)}/auth/login`, {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(
    response.ok(),
    `admin sign-in failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
  return context;
}

// ---------------------------------------------------------------------------
// AC 1 — the business day context is fixed and visible
// ---------------------------------------------------------------------------

test('names the business date the entry belongs to and offers no way to choose another', async ({
  page,
}) => {
  openDay(1);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const context = page.locator('.staff-cash-day-context');
  await expect(context).toBeVisible();
  await expect(context).toContainText('This entry will be written to');
  await expect(context.locator('strong')).toHaveText(
    cashPageDateLabel(businessDate(1)),
  );

  // No date control of any kind — not a picker, not a free-text date, not a
  // select. The criterion is that the date cannot be chosen at all.
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.locator('#businessDate')).toHaveCount(0);
  const selects = page.locator('form select');
  await expect(selects).toHaveCount(1);
  await expect(selects.first()).toHaveAttribute('id', 'cash-recorded-by');
});

// ---------------------------------------------------------------------------
// AC 2 — exactly one entry type, readable programmatically
// ---------------------------------------------------------------------------

test('offers three mutually exclusive entry types and exposes the selected one programmatically', async ({
  page,
}) => {
  openDay(2);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const radios = page.locator('input[name="kind"]');
  await expect(radios).toHaveCount(3);

  for (const type of ['Cash in', 'Cash out', 'Expense'] as EntryType[]) {
    await chooseType(page, type);

    // Selected state is carried by the control itself, not by styling: this is
    // the v1 accessibility regression the story's "clear explanation" criterion
    // depends on (docs/discovery-findings.md, 2026-08-01).
    await expect(typeRadio(page, type)).toBeChecked();
    await expect(typeRadio(page, type)).toHaveRole('radio');

    // ...and every other type is deselected.
    for (const other of ['Cash in', 'Cash out', 'Expense'] as EntryType[]) {
      if (other === type) continue;
      await expect(typeRadio(page, other)).not.toBeChecked();
    }
    expect(await radios.evaluateAll((nodes) =>
      nodes.filter((node) => (node as HTMLInputElement).checked).length,
    )).toBe(1);
  }
});

test('marks amount and reason as required programmatically, not only visually', async ({
  page,
}) => {
  openDay(3);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  for (const field of [amountField(page), reasonField(page)]) {
    await expect(field).toHaveAttribute('required', '');
    await expect(field).toHaveAttribute('aria-required', 'true');
  }

  // Category and attribution are optional and must not claim otherwise.
  await chooseType(page, 'Expense');
  await expect(categoryField(page)).not.toHaveAttribute('required', '');
  await expect(recordedByField(page)).not.toHaveAttribute('required', '');
});

// ---------------------------------------------------------------------------
// AC 3 — amount and reason are enforced, and nothing is recorded
// ---------------------------------------------------------------------------

test('rejects every invalid amount and reason without recording an entry', async ({
  page,
}) => {
  openDay(4);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const before = countCashMovements();
  expect(before).toBe(0);

  const invalidAmounts: Array<{ amount: string; why: string }> = [
    { amount: '', why: 'blank' },
    { amount: '0', why: 'zero' },
    { amount: '0.00', why: 'zero with centavos' },
    { amount: '-5', why: 'negative' },
    { amount: '-0.01', why: 'negative centavo' },
    { amount: 'abc', why: 'non-numeric' },
    { amount: '19.999', why: 'over-precision' },
    { amount: '21474836.48', why: 'over-maximum' },
  ];

  for (const { amount, why } of invalidAmounts) {
    await fillEntry(page, {
      type: 'Cash in',
      amount,
      reason: `Rejected because ${why}`,
    });
    await recordButton(page).click();

    const error = page.locator('#cash-amount-error');
    await expect(error, `no explanation shown for the ${why} amount`).toBeVisible();
    await expect(error).not.toBeEmpty();
    await expect(amountField(page)).toHaveAttribute('aria-invalid', 'true');
    // The explanation is beside the field it is about.
    await expect(amountField(page)).toHaveAttribute(
      'aria-describedby',
      'cash-amount-error',
    );
    await expect(page.locator('.staff-inventory-message.success')).toHaveCount(0);
    expect(
      countCashMovements(),
      `the ${why} amount was recorded anyway`,
    ).toBe(before);
  }

  const invalidReasons: Array<{ reason: string; why: string }> = [
    { reason: '', why: 'blank' },
    { reason: '   ', why: 'whitespace-only' },
    { reason: '\t\n ', why: 'whitespace characters only' },
  ];

  for (const { reason, why } of invalidReasons) {
    await fillEntry(page, { type: 'Cash in', amount: '25.00', reason });
    await recordButton(page).click();

    const error = page.locator('#cash-reason-error');
    await expect(error, `no explanation shown for the ${why} reason`).toBeVisible();
    await expect(error).not.toBeEmpty();
    await expect(reasonField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(reasonField(page)).toHaveAttribute(
      'aria-describedby',
      'cash-reason-error',
    );
    expect(
      countCashMovements(),
      `the ${why} reason was recorded anyway`,
    ).toBe(before);
  }

  // The ledger is still empty, from the screen's point of view too.
  await expect(ledgerRows(page)).toHaveCount(0);
  await expect(page.locator('.staff-cash-empty')).toBeVisible();
});

test('rejects an over-maximum amount at the API too, not only in the form', async ({
  page,
  baseURL,
}) => {
  openDay(5);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  // The form is not the only guard: a request that bypasses it must still be
  // refused, because the ledger is permanent.
  for (const amountCents of [0, -1, 2_147_483_648]) {
    const response = await page.request.post(
      `${apiOrigin(baseURL)}/trading-day/cash-movements`,
      {
        data: {
          clientGeneratedId: crypto.randomUUID(),
          kind: 'CASH_IN',
          amountCents,
          description: 'Bypassing the form',
        },
      },
    );
    expect(response.ok(), `amountCents ${amountCents} was accepted`).toBe(false);
  }

  const blankReason = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/cash-movements`,
    {
      data: {
        clientGeneratedId: crypto.randomUUID(),
        kind: 'CASH_IN',
        amountCents: 100,
        description: '   ',
      },
    },
  );
  expect(blankReason.ok(), 'a whitespace-only reason was accepted').toBe(false);

  expect(countCashMovements()).toBe(0);
});

// ---------------------------------------------------------------------------
// AC 4 / AC 5 — optional attribution, active staff only
// ---------------------------------------------------------------------------

test('records an unattributed entry as "Unattributed" and an attributed one by name', async ({
  page,
}) => {
  openDay(6);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  // Attribution is optional: the default selection records no staff member.
  await expect(recordedByField(page)).toHaveValue('');
  await recordEntry(page, {
    type: 'Cash in',
    amount: '120.00',
    reason: 'Float top-up',
  });

  await expect(ledgerRows(page)).toHaveCount(1);
  expect((await ledgerRow(page, 0)).by).toBe('Unattributed');

  await recordEntry(page, {
    type: 'Cash out',
    amount: '80.00',
    reason: 'Bank deposit',
    recordedBy: staff.bruno.displayName,
  });

  await expect(ledgerRows(page)).toHaveCount(2);
  expect((await ledgerRow(page, 0)).by).toBe(staff.bruno.displayName);
  expect((await ledgerRow(page, 1)).by).toBe('Unattributed');

  const stored = readCashMovements();
  expect(stored).toHaveLength(2);
  expect(stored[0]!.recordedByStaffMemberId).toBeNull();
  expect(stored[0]!.recordedByNameSnapshot).toBeNull();
  expect(stored[1]!.recordedByStaffMemberId).toBe(staff.bruno.id);
  expect(stored[1]!.recordedByNameSnapshot).toBe(staff.bruno.displayName);
});

test('does not offer an inactive staff member for attribution', async ({
  page,
  baseURL,
}) => {
  openDay(7);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const options = await recordedByField(page).locator('option').allInnerTexts();
  expect(options).toContain(staff.ada.displayName);
  expect(options).toContain(staff.bruno.displayName);
  expect(options).not.toContain(staff.zara.displayName);

  // Nor may an inactive member be attached by a request that skips the select.
  const response = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/cash-movements`,
    {
      data: {
        clientGeneratedId: crypto.randomUUID(),
        kind: 'CASH_IN',
        amountCents: 500,
        description: 'Attributing a retired member',
        recordedByStaffMemberId: staff.zara.id,
      },
    },
  );
  expect(response.ok(), 'an inactive staff member was accepted').toBe(false);
  expect(countCashMovements()).toBe(0);
});

// ---------------------------------------------------------------------------
// AC 6 / AC 8 — category is Expense-only, optional, and renders exactly
// ---------------------------------------------------------------------------

test('requests a category only for Expense', async ({ page }) => {
  openDay(8);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const slot = page.locator('.staff-cash-category-slot');

  for (const type of ['Cash in', 'Cash out'] as EntryType[]) {
    await chooseType(page, type);
    await expect(slot).toHaveAttribute('aria-hidden', 'true');
    await expect(categoryField(page)).toBeDisabled();
    // Hidden from the accessibility tree, so it is genuinely not requested.
    await expect(
      page.getByRole('textbox', { name: /Category/ }),
    ).toHaveCount(0);
  }

  await chooseType(page, 'Expense');
  await expect(slot).toHaveAttribute('aria-hidden', 'false');
  await expect(categoryField(page)).toBeEnabled();
  await expect(categoryField(page)).toBeVisible();
});

test('records an Expense with the category left blank and shows no category artifact', async ({
  page,
}) => {
  openDay(9);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Expense',
    amount: '250.00',
    reason: 'Cleaning supplies',
  });

  await expect(ledgerRows(page)).toHaveCount(1);

  // The exact rendered text. A stray separator, placeholder or empty span would
  // change this string — that is the point of asserting equality, not containment.
  expect(await detailText(page, 0)).toBe('Cleaning supplies');

  const stored = readCashMovements();
  expect(stored).toHaveLength(1);
  expect(stored[0]!.category).toBeNull();
});

test('renders reason and category for an Expense that has one, and only the reason for Cash in and Cash out', async ({
  page,
}) => {
  openDay(10);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Cash in',
    amount: '100.00',
    reason: 'Owner float top-up',
  });
  await recordEntry(page, {
    type: 'Cash out',
    amount: '60.00',
    reason: 'Petty cash to bank',
  });
  await recordEntry(page, {
    type: 'Expense',
    amount: '340.00',
    reason: 'Milk delivery',
    category: 'Supplies',
  });

  await expect(ledgerRows(page)).toHaveCount(3);

  // Newest first.
  expect(await detailText(page, 0)).toBe('Supplies / Milk delivery');
  expect(await detailText(page, 1)).toBe('Petty cash to bank');
  expect(await detailText(page, 2)).toBe('Owner float top-up');

  // Cash in / Cash out details carry the reason and nothing else — no category
  // fragment leaks into a non-expense row.
  expect(await detailText(page, 1)).not.toContain('/');
  expect(await detailText(page, 2)).not.toContain('/');
});

test('treats a whitespace-only category as absent', async ({ page }) => {
  openDay(11);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Expense',
    amount: '45.00',
    reason: 'Bin liners',
    category: '   ',
  });

  await expect(ledgerRows(page)).toHaveCount(1);
  expect(await detailText(page, 0)).toBe('Bin liners');

  const stored = readCashMovements();
  expect(stored[0]!.category).toBeNull();
});

test('discards a category typed for an Expense when the type is switched before submitting', async ({
  page,
}) => {
  openDay(12);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await fillEntry(page, {
    type: 'Expense',
    amount: '75.00',
    reason: 'Changed my mind',
    category: 'Supplies',
  });
  // Switch away from Expense after the category was typed.
  await fillEntry(page, { type: 'Cash out' });
  await recordButton(page).click();
  await expect(page.locator('.staff-inventory-message.success')).toBeVisible();

  const stored = readCashMovements();
  expect(stored).toHaveLength(1);
  expect(stored[0]!.kind).toBe('CASH_OUT');
  expect(stored[0]!.category, 'the abandoned category was attached anyway').toBeNull();
  expect(await detailText(page, 0)).toBe('Changed my mind');
});

test('refuses a category on a non-expense submitted directly to the API', async ({
  page,
  baseURL,
}) => {
  openDay(13);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const response = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/cash-movements`,
    {
      data: {
        clientGeneratedId: crypto.randomUUID(),
        kind: 'CASH_OUT',
        amountCents: 1000,
        description: 'Category on a cash out',
        category: 'Supplies',
      },
    },
  );
  expect(response.ok(), 'a category was accepted on a CASH_OUT').toBe(false);
  expect(countCashMovements()).toBe(0);
});

// ---------------------------------------------------------------------------
// AC 7 — ledger row contents, and ordering
// ---------------------------------------------------------------------------

test('lists a recorded entry with its type, amount, detail and staff member, newest first', async ({
  page,
}) => {
  openDay(14);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Cash in',
    amount: '1000.00',
    reason: 'Opening top-up',
    recordedBy: staff.ada.displayName,
  });
  await recordEntry(page, {
    type: 'Expense',
    amount: '19.99',
    reason: 'Coffee filters',
    category: 'Consumables',
    recordedBy: staff.bruno.displayName,
  });

  await expect(ledgerRows(page)).toHaveCount(2);

  expect(await ledgerRow(page, 0)).toEqual({
    type: 'Expense',
    amount: money(1999),
    detail: 'Consumables / Coffee filters',
    by: staff.bruno.displayName,
  });
  expect(await ledgerRow(page, 1)).toEqual({
    type: 'Cash in',
    amount: money(100_000),
    detail: 'Opening top-up',
    by: staff.ada.displayName,
  });

  // The order survives a reload — it is the read model's order, not a client
  // artifact of having just prepended a row.
  await page.reload();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
  expect((await ledgerRow(page, 0)).detail).toBe('Consumables / Coffee filters');
  expect((await ledgerRow(page, 1)).detail).toBe('Opening top-up');
});

test('keeps a very long reason and category readable without losing them', async ({
  page,
}) => {
  openDay(15);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const longReason = `Emergency replacement of the espresso machine group head gasket ${TAG} after the morning service, purchased from the supplier on Session Road because the usual one had no stock`;
  const longCategory = `Equipment maintenance and unscheduled repairs ${TAG}`;

  await recordEntry(page, {
    type: 'Expense',
    amount: '3500.00',
    reason: longReason,
    category: longCategory,
  });

  await expect(ledgerRows(page)).toHaveCount(1);

  // The full text is present — a CSS ellipsis is acceptable, silently dropping
  // the reason is not.
  expect(await detailText(page, 0)).toBe(`${longCategory} / ${longReason}`);

  const stored = readCashMovements();
  expect(stored[0]!.description).toBe(longReason);
  expect(stored[0]!.category).toBe(longCategory);

  // The row does not push the ledger past its own scroll container.
  const overflow = await page
    .locator('.staff-cash-table-wrap')
    .evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// AC 9 — day scoping and the empty state
// ---------------------------------------------------------------------------

test('shows an empty state on an open day with no entries', async ({ page }) => {
  openDay(16);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await expect(ledgerRows(page)).toHaveCount(0);
  const empty = page.locator('.staff-cash-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No cash entries yet');
});

test('lists only the current business day\'s entries', async ({ page }) => {
  // A previous, now-closed day carrying entries of every kind.
  const previous = openDay(17, 50_000);
  seedCashMovement({
    tradingDayId: previous.id,
    kind: 'CASH_IN',
    amountCents: 111_11,
    description: `Yesterday cash in ${TAG}`,
  });
  seedCashMovement({
    tradingDayId: previous.id,
    kind: 'CASH_OUT',
    amountCents: 222_22,
    description: `Yesterday cash out ${TAG}`,
  });
  seedCashMovement({
    tradingDayId: previous.id,
    kind: 'EXPENSE',
    amountCents: 333_33,
    description: `Yesterday expense ${TAG}`,
    category: `Yesterday category ${TAG}`,
  });
  closeBusinessDayDirect(previous.id);

  const current = openDay(18, 50_000);
  seedCashMovement({
    tradingDayId: current.id,
    kind: 'CASH_IN',
    amountCents: 444_44,
    description: `Today cash in ${TAG}`,
  });

  await signInAsStaff(page);
  await gotoCashScreen(page);

  await expect(page.locator('.staff-cash-day-context strong')).toHaveText(
    cashPageDateLabel(businessDate(18)),
  );
  await expect(ledgerRows(page)).toHaveCount(1);
  expect((await ledgerRow(page, 0)).detail).toBe(`Today cash in ${TAG}`);

  const ledgerText = await page.locator('.staff-cash-ledger').innerText();
  expect(ledgerText).not.toContain(`Yesterday cash in ${TAG}`);
  expect(ledgerText).not.toContain(`Yesterday cash out ${TAG}`);
  expect(ledgerText).not.toContain(`Yesterday expense ${TAG}`);
  expect(ledgerText).not.toContain(`Yesterday category ${TAG}`);
});

// ---------------------------------------------------------------------------
// AC 10 — permanent and read-only
// ---------------------------------------------------------------------------

test('offers no way to edit or delete a recorded entry, and a later entry leaves an earlier one untouched', async ({
  page,
  baseURL,
}) => {
  openDay(19);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Expense',
    amount: '210.50',
    reason: 'First entry',
    category: 'Supplies',
    recordedBy: staff.ada.displayName,
  });

  const firstRowBefore = await ledgerRow(page, 0);
  const firstStoredBefore = readCashMovements()[0]!;

  // No affordance on any row: no button, no link, no editable control.
  const firstRow = ledgerRows(page).first();
  await expect(firstRow.locator('button')).toHaveCount(0);
  await expect(firstRow.locator('a')).toHaveCount(0);
  await expect(firstRow.locator('input, select, textarea')).toHaveCount(0);
  await expect(firstRow.locator('[contenteditable="true"]')).toHaveCount(0);

  await recordEntry(page, {
    type: 'Cash out',
    amount: '15.00',
    reason: 'Second entry',
  });

  await expect(ledgerRows(page)).toHaveCount(2);

  // The earlier entry is unchanged in every column the criterion names.
  expect(await ledgerRow(page, 1)).toEqual(firstRowBefore);
  const firstStoredAfter = readCashMovements().find(
    (movement) => movement.id === firstStoredBefore.id,
  );
  expect(firstStoredAfter).toEqual(firstStoredBefore);

  // Read-only throughout the system: there is no update or delete route.
  for (const method of ['put', 'patch', 'delete'] as const) {
    const response = await page.request[method](
      `${apiOrigin(baseURL)}/trading-day/cash-movements/${firstStoredBefore.id}`,
      method === 'delete' ? undefined : { data: { amountCents: 1 } },
    );
    expect(
      response.status(),
      `${method.toUpperCase()} on a recorded entry was routed`,
    ).toBe(404);
  }
  expect(readCashMovements()).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// AC 11 — attribution survives a roster change
// ---------------------------------------------------------------------------

test('keeps the staff name recorded at the time even after that member is renamed and deactivated', async ({
  page,
  baseURL,
}) => {
  openDay(20);
  const originalName = staff.rosa.displayName;
  const renamedTo = `QA Rosa RENAMED-LATER ${TAG}`;

  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, {
    type: 'Cash out',
    amount: '90.00',
    reason: 'Change fund',
    recordedBy: originalName,
  });
  expect((await ledgerRow(page, 0)).by).toBe(originalName);

  // Drive the roster change through the product's own admin path — the same
  // endpoint the roster screen calls — not a raw row edit.
  const admin = await adminRequest(page, baseURL);
  const update = await admin.request.patch(
    `${apiOrigin(baseURL)}/staff/${staff.rosa.id}`,
    { data: { displayName: renamedTo, isActive: false } },
  );
  expect(
    update.ok(),
    `renaming/deactivating failed (${update.status()}): ${await update.text()}`,
  ).toBe(true);
  await admin.close();

  await page.reload();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);

  // The row still names the person as they were when the entry was recorded.
  await expect(ledgerRows(page)).toHaveCount(1);
  const row = await ledgerRow(page, 0);
  expect(row.by).toBe(originalName);
  expect(row.by).not.toBe(renamedTo);
  expect(row.by).not.toBe('');
  expect(row.by).not.toBe('Unattributed');
  await expect(page.locator('.staff-cash-ledger')).not.toContainText(renamedTo);

  // Deactivation only stops future selection.
  const options = await recordedByField(page).locator('option').allInnerTexts();
  expect(options).not.toContain(renamedTo);
  expect(options).not.toContain(originalName);
});

// ---------------------------------------------------------------------------
// AC 12 — drawer arithmetic, end to end
// ---------------------------------------------------------------------------

test('cash in increases and cash out and expense reduce expected drawer cash, each exactly once', async ({
  page,
}) => {
  const openingFloatCents = 200_000; // ₱2,000.00
  openDay(21, openingFloatCents);

  await signInAsStaff(page);
  await gotoCashScreen(page);

  await recordEntry(page, { type: 'Cash in', amount: '500.00', reason: 'Top-up' });
  await recordEntry(page, { type: 'Cash out', amount: '150.00', reason: 'Deposit' });
  await recordEntry(page, {
    type: 'Expense',
    amount: '75.25',
    reason: 'Milk',
    category: 'Supplies',
  });

  await gotoScreen(page, '/pos/close');
  const summary = await cashSummary(page);

  expect(summary['Cash float']).toBe(money(openingFloatCents));
  expect(summary['Cash in']).toBe(`+${money(50_000)}`);
  expect(summary['Cash out']).toBe(`−${money(15_000)}`);
  expect(summary['Expenses (cash)']).toBe(`−${money(7_525)}`);

  // Counted once each, in the right direction.
  const expected = openingFloatCents + 50_000 - 15_000 - 7_525;
  await expect(
    page.locator('.staff-cash-summary .total dd'),
  ).toHaveText(money(expected));
});

test('entries do not affect a different business day\'s expected cash', async ({
  page,
}) => {
  const openingFloatCents = 200_000;
  const first = openDay(22, openingFloatCents);

  await signInAsStaff(page);
  await gotoCashScreen(page);
  await recordEntry(page, { type: 'Cash in', amount: '500.00', reason: 'Top-up' });
  await recordEntry(page, { type: 'Expense', amount: '75.25', reason: 'Milk' });

  // Move to a different business day with the same float and nothing recorded.
  closeBusinessDayDirect(first.id);
  openDay(23, openingFloatCents);

  await gotoScreen(page, '/pos/close');
  const summary = await cashSummary(page);

  expect(summary['Cash in']).toBe(`+${money(0)}`);
  expect(summary['Cash out']).toBe(`−${money(0)}`);
  expect(summary['Expenses (cash)']).toBe(`−${money(0)}`);
  await expect(page.locator('.staff-cash-summary .total dd')).toHaveText(
    money(openingFloatCents),
  );
});

test('converts pesos to cents exactly at the boundary amounts', async ({ page }) => {
  const openingFloatCents = 0;
  openDay(24, openingFloatCents);

  await signInAsStaff(page);
  await gotoCashScreen(page);

  const amounts: Array<{ typed: string; cents: number }> = [
    { typed: '0.01', cents: 1 },
    { typed: '0.10', cents: 10 },
    { typed: '0.1', cents: 10 },
    { typed: '19.99', cents: 1999 },
    { typed: '1000.00', cents: 100_000 },
    { typed: '7', cents: 700 },
  ];

  for (const { typed } of amounts) {
    await recordEntry(page, {
      type: 'Cash in',
      amount: typed,
      reason: `Boundary ${typed}`,
    });
  }

  const stored = readCashMovements();
  expect(stored).toHaveLength(amounts.length);
  for (const [index, { typed, cents }] of amounts.entries()) {
    expect(stored[index]!.amountCents, `"${typed}" did not land as ${cents}`).toBe(
      cents,
    );
    expect(stored[index]!.description).toBe(`Boundary ${typed}`);
  }

  // The figure the drift would actually show up in.
  const total = amounts.reduce((sum, entry) => sum + entry.cents, 0);
  await gotoScreen(page, '/pos/close');
  expect((await cashSummary(page))['Cash in']).toBe(`+${money(total)}`);
  await expect(page.locator('.staff-cash-summary .total dd')).toHaveText(
    money(openingFloatCents + total),
  );
});

// ---------------------------------------------------------------------------
// Edge case — double submit and request retry
// ---------------------------------------------------------------------------

test('tapping Record twice records exactly one entry', async ({ page }) => {
  openDay(25, 100_000);
  await signInAsStaff(page);

  // Hold the POST open so the in-flight window is observable. The request still
  // reaches the API — only its timing is controlled.
  await page.route(
    (url) => url.pathname === '/trading-day/cash-movements',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    },
  );

  await gotoCashScreen(page);
  await fillEntry(page, {
    type: 'Cash out',
    amount: '42.00',
    reason: 'Double tap',
  });

  await recordButton(page).click();
  const inFlight = page.getByRole('button', { name: 'Recording…' });
  await expect(inFlight).toBeDisabled();
  await inFlight.click({ force: true });
  await inFlight.click({ force: true });

  await expect(page.locator('.staff-inventory-message.success')).toBeVisible();

  // Exactly one entry, exactly one row, and the drawer moved exactly once.
  expect(countCashMovements()).toBe(1);
  await expect(ledgerRows(page)).toHaveCount(1);

  await page.unroute((url) => url.pathname === '/trading-day/cash-movements');
  await gotoScreen(page, '/pos/close');
  expect((await cashSummary(page))['Cash out']).toBe(`−${money(4_200)}`);
  await expect(page.locator('.staff-cash-summary .total dd')).toHaveText(
    money(100_000 - 4_200),
  );
});

test('replaying the same submission records exactly one entry', async ({
  page,
  baseURL,
}) => {
  openDay(26, 100_000);
  await signInAsStaff(page);

  // Capture the exact payload the app sent, so the replay is the real retry the
  // criterion describes rather than a payload this spec invented.
  let submitted: string | null = null;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/trading-day/cash-movements'
    ) {
      submitted = request.postData();
    }
  });

  await gotoCashScreen(page);
  await recordEntry(page, {
    type: 'Cash in',
    amount: '333.00',
    reason: 'Retried submission',
  });

  expect(submitted, 'the submission payload was not captured').not.toBeNull();
  const payload = JSON.parse(submitted!) as Record<string, unknown>;
  expect(countCashMovements()).toBe(1);
  const original = readCashMovements()[0]!;

  const replay = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/cash-movements`,
    { data: payload },
  );
  expect(
    replay.ok(),
    'a replay of an accepted submission should be answered, not errored',
  ).toBe(true);
  // The replay returns the entry that already exists rather than making another.
  expect(((await replay.json()) as { id: string }).id).toBe(original.id);

  expect(countCashMovements(), 'the replay recorded a second entry').toBe(1);

  await page.reload();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
  await expect(ledgerRows(page)).toHaveCount(1);

  await gotoScreen(page, '/pos/close');
  expect((await cashSummary(page))['Cash in']).toBe(`+${money(33_300)}`);
});

// ---------------------------------------------------------------------------
// AC 13 — no open business day, and a day closed mid-entry
// ---------------------------------------------------------------------------

test('explains there is no open business day and offers no way to record an entry', async ({
  page,
  baseURL,
}) => {
  // No day opened at all — resetBusinessDayWorld() ran in beforeEach.
  await signInAsStaff(page);
  await gotoCashScreen(page);

  const blocking = page.locator('.staff-cash-no-day');
  await expect(blocking).toBeVisible();
  await expect(blocking).toContainText('No business day is open');

  // No entry form of any kind.
  await expect(page.locator('form')).toHaveCount(0);
  await expect(amountField(page)).toHaveCount(0);
  await expect(reasonField(page)).toHaveCount(0);
  await expect(recordButton(page)).toHaveCount(0);
  await expect(ledgerRows(page)).toHaveCount(0);

  // And a submission that skips the screen records nothing.
  const response = await page.request.post(
    `${apiOrigin(baseURL)}/trading-day/cash-movements`,
    {
      data: {
        clientGeneratedId: crypto.randomUUID(),
        kind: 'CASH_IN',
        amountCents: 1000,
        description: 'No day is open',
      },
    },
  );
  expect(response.ok(), 'an entry was accepted with no open day').toBe(false);
  expect(countCashMovements()).toBe(0);
});

test('rejects a submission when the day closed while the form was open, writing nothing', async ({
  page,
}) => {
  const day = openDay(27, 100_000);
  await signInAsStaff(page);
  await gotoCashScreen(page);

  await fillEntry(page, {
    type: 'Expense',
    amount: '60.00',
    reason: 'Recorded too late',
    category: 'Supplies',
  });

  // The day closes elsewhere while this form sits open.
  closeBusinessDayDirect(day.id);

  await recordButton(page).click();

  // A clear explanation, and no success.
  await expect(page.locator('.staff-inventory-message.success')).toHaveCount(0);
  await expect(page.locator('.staff-cash-no-day')).toBeVisible();
  await expect(page.locator('.staff-cash-no-day')).toContainText(
    'The business day closed before the entry was recorded. No entry was saved.',
  );

  // Nothing was written — not against the closed day, and not against a new one.
  expect(countCashMovements()).toBe(0);

  const next = openDay(28, 100_000);
  await gotoCashScreen(page);
  await expect(ledgerRows(page)).toHaveCount(0);
  expect(
    readCashMovements().filter((movement) => movement.tradingDayId === next.id),
  ).toHaveLength(0);
});
