import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';
import { shopToday } from './fixtures/reporting-seed';
import {
  closeOrderDay,
  openOrderDay,
  readOrders,
  resetOrderWorld,
  seedCashierSelection,
  seedHistoricalUnderTenderedOrder,
  seedOrderCatalog,
  seedOrderStaff,
  type SeededOrderCatalog,
  type SeededOrderDay,
  type SeededOrderStaff,
} from './fixtures/take-order';

/**
 * End-to-end coverage for charging, settling and voiding orders — story #197,
 * QA task #206. `take-order.spec.ts` covers everything up to the charge sheet;
 * this file starts there and covers tender, tip, change, completion, void and
 * cashier attribution.
 *
 * As in the companion file, user-facing criteria are asserted on screen and
 * money is asserted from stored integer cents through `readOrders()`.
 */

// Not `serial`: `beforeEach` resets the trading-day world and every test signs
// in fresh, so each one stands alone and a failure never hides the rest.
test.use({ viewport: { width: 1024, height: 768 } });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;
const MINIMUM_TOUCH_TARGET_PX = 44;

let catalog: SeededOrderCatalog;
let staffMember: SeededOrderStaff;
let day: SeededOrderDay;

test.beforeAll(() => {
  catalog = seedOrderCatalog(`s${RUN}`);
  staffMember = seedOrderStaff(`QA Settlement Opener ${RUN}`);
});

test.beforeEach(() => {
  resetOrderWorld();
  day = openOrderDay({
    businessDate: shopToday(),
    openedByStaffMemberId: staffMember.id,
  });
});

// ---- page objects -----------------------------------------------------------

function catalogPane(page: Page): Locator {
  return page.getByRole('region', { name: 'Take order' });
}

function currentOrder(page: Page): Locator {
  return page.getByRole('complementary');
}

function sizeButton(page: Page, productName: string, size: string): Locator {
  return catalogPane(page)
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: productName, exact: true }) })
    .getByRole('button', { name: new RegExp(`^${size}\\b`) });
}

function chargeSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Amount due/ });
}

function completedDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Order #\d+ (completed|is void)$/ });
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  const username = page.locator('#staff-username');
  await expect(username).toBeVisible();
  // The form autofocuses on a requestAnimationFrame; clicking pins focus so the
  // password fill cannot be re-routed into the username box.
  await username.click();
  await username.fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function openTakeOrder(page: Page): Promise<void> {
  await page.goto('/pos/order');
  await expect(page.getByRole('heading', { name: 'Take order' })).toBeVisible();
}

async function searchFor(page: Page, productName: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search products' }).fill(productName);
  await expect(sizeButton(page, productName, 'Regular')).toBeVisible();
}

/**
 * Sign in and build a one-line order worth ₱150.00, ready to charge.
 *
 * Every settlement criterion needs a chargeable order and none of them are
 * about how it was built, so this is deliberately the shortest path there.
 */
async function orderReadyToCharge(page: Page): Promise<void> {
  await signInAsStaff(page);
  await openTakeOrder(page);
  await searchFor(page, catalog.products.espresso.name);
  await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
  await expect(currentOrder(page)).toContainText('Order #1');
}

async function openChargeSheet(page: Page): Promise<Locator> {
  await currentOrder(page).getByRole('button', { name: /^Charge/ }).click();
  const sheet = chargeSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

async function choosePayment(
  sheet: Locator,
  method: 'Cash' | 'Online' | 'Split',
): Promise<void> {
  await sheet.getByRole('tab', { name: method }).click();
  await expect(sheet.getByRole('tab', { name: method })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/**
 * Tick "Record change still owed" and enter the amount.
 *
 * The native checkbox sits under its styled label span, so a direct `.check()`
 * is intercepted. Clicking the label is what a real user does anyway.
 */
async function recordChangeOwed(
  sheet: Locator,
  amount: string,
): Promise<void> {
  const checkbox = sheet.getByRole('checkbox', {
    name: /Record change still owed/,
  });
  await sheet.getByText('Record change still owed', { exact: true }).click();
  await expect(checkbox).toBeChecked();
  await sheet.getByLabel('Amount still owed').fill(amount);
}

/** The day's own device id, so a cashier selection can be seeded for it. */
async function deviceId(page: Page): Promise<string> {
  return page.evaluate(
    () => window.localStorage.getItem('ucm.staff-auth.device-id.v1') ?? '',
  );
}

// ---- cash -------------------------------------------------------------------

test.describe('Cash payment', () => {
  test('cash received shows change due and completes the order', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await expect(sheet).toContainText('Amount due ₱150.00');
    await sheet.getByLabel('Cash received (optional)').fill('200');
    await expect(
      sheet.locator('dl div').filter({ hasText: 'Change due' }).locator('dd'),
    ).toHaveText('₱50.00');

    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    await expect(completedDialog(page)).toContainText('Cash payment');
    await expect(completedDialog(page)).toContainText('₱150.00');
    await expect(completedDialog(page)).toContainText('Change due');

    const [order] = readOrders();
    expect(order.status).toBe('COMPLETED');
    expect(order.cashReceivedCents).toBe(20000);
    expect(order.payments).toEqual([{ method: 'CASH', amountCents: 15000 }]);
    expect(order.changeOwedCents).toBe(0);

    // The completed state is shown on the order screen too.
    await completedDialog(page).getByRole('button', { name: 'Close' }).click();
    await expect(currentOrder(page)).toContainText('Completed');
  });

  test('blank cash received means the exact cash was taken', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await expect(sheet.getByLabel('Cash received (optional)')).toHaveValue('');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    const [order] = readOrders();
    expect(order.cashReceivedCents).toBe(15000);
    expect(order.payments).toEqual([{ method: 'CASH', amountCents: 15000 }]);
  });

  test('cash below the cash portion is rejected with a clear message', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await sheet.getByLabel('Cash received (optional)').fill('100');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();

    await expect(sheet.getByRole('alert')).toContainText(
      'cashReceivedCents cannot be less than the cash payment',
    );
    await expect(completedDialog(page)).toHaveCount(0);
    expect(readOrders()[0].status).toBe('PARKED');
    expect(readOrders()[0].payments).toHaveLength(0);
  });
});

// ---- online -----------------------------------------------------------------

test.describe('Online payment', () => {
  test('settles the full amount with no cash received or change fields', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await choosePayment(sheet, 'Online');

    await expect(sheet).toContainText('The full amount due will be recorded as Online.');
    await expect(sheet.getByLabel('Cash received (optional)')).toHaveCount(0);
    await expect(sheet.getByText('Change due')).toHaveCount(0);
    await expect(
      sheet.getByRole('checkbox', { name: /Record change still owed/ }),
    ).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Complete online payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    const [order] = readOrders();
    expect(order.payments).toEqual([{ method: 'ONLINE', amountCents: 15000 }]);
    expect(order.cashReceivedCents).toBeNull();
    expect(order.changeOwedCents).toBe(0);
  });
});

// ---- split ------------------------------------------------------------------

test.describe('Split payment', () => {
  test('valid Cash and Online portions are recorded and shown separately', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await choosePayment(sheet, 'Split');

    await sheet.getByLabel('Cash portion').fill('60');
    await sheet.getByLabel('Online portion').fill('90');
    await expect(sheet).toContainText('Portions match the amount due.');

    await sheet.getByRole('button', { name: 'Complete split payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    await expect(completedDialog(page)).toContainText('Cash payment');
    await expect(completedDialog(page)).toContainText('₱60.00');
    await expect(completedDialog(page)).toContainText('Online payment');
    await expect(completedDialog(page)).toContainText('₱90.00');

    const [order] = readOrders();
    expect(order.payments).toEqual([
      { method: 'CASH', amountCents: 6000 },
      { method: 'ONLINE', amountCents: 9000 },
    ]);
  });

  test('a negative portion is rejected', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await choosePayment(sheet, 'Split');

    await sheet.getByLabel('Cash portion').fill('-10');
    await sheet.getByLabel('Online portion').fill('160');
    await sheet.getByRole('button', { name: 'Complete split payment' }).click();

    await expect(sheet).toContainText(
      'Cash and Online portions cannot be negative.',
    );
    await expect(completedDialog(page)).toHaveCount(0);
    expect(readOrders()[0].status).toBe('PARKED');
  });

  test('portions that do not add up to the amount due are rejected', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await choosePayment(sheet, 'Split');

    await sheet.getByLabel('Cash portion').fill('50');
    await sheet.getByLabel('Online portion').fill('50');
    await expect(sheet).toContainText('₱50.00 remains to allocate.');
    await sheet.getByRole('button', { name: 'Complete split payment' }).click();
    await expect(completedDialog(page)).toHaveCount(0);
    expect(readOrders()[0].status).toBe('PARKED');

    // Over the amount due is refused just as clearly.
    await sheet.getByLabel('Online portion').fill('150');
    await expect(sheet).toContainText('₱50.00 is over the amount due.');
    await sheet.getByRole('button', { name: 'Complete split payment' }).click();
    await expect(completedDialog(page)).toHaveCount(0);
    expect(readOrders()[0].status).toBe('PARKED');
    expect(readOrders()[0].payments).toHaveLength(0);
  });
});

// ---- tip --------------------------------------------------------------------

test.describe('Cash tip', () => {
  test('is recorded separately and does not raise sales revenue', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    // The tip does not change the amount due.
    await sheet.getByLabel('Tip amount').fill('20');
    await expect(sheet).toContainText('Amount due ₱150.00');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    await expect(completedDialog(page)).toContainText('Cash tip (separate)');
    await expect(completedDialog(page)).toContainText('₱20.00');

    const [order] = readOrders();
    expect(order.cashTipCents).toBe(2000);
    expect(order.totalCents).toBe(15000);
    expect(order.payments).toEqual([{ method: 'CASH', amountCents: 15000 }]);

    // Sales stay ₱150.00; the tip lands on expected cash instead.
    await page.goto('/pos/close');
    const summary = page.locator('dl.staff-cash-summary');
    await expect(
      summary.locator('div').filter({ hasText: 'Cash sales' }).locator('dd'),
    ).toContainText('₱150.00');
    await expect(
      summary.locator('div').filter({ hasText: 'Cash tips' }).locator('dd'),
    ).toContainText('₱20.00');
  });

  test('a negative tip is refused', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await sheet.getByLabel('Tip amount').fill('-5');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(sheet.getByRole('alert')).toContainText(
      'Cash tip must be zero or more.',
    );
    expect(readOrders()[0].status).toBe('PARKED');
  });
});

// ---- change -----------------------------------------------------------------

test.describe('Change', () => {
  test('change still owed is recorded, stays visible, and survives handover', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await sheet.getByLabel('Cash received (optional)').fill('200');
    await recordChangeOwed(sheet, '50');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();

    await expect(completedDialog(page)).toBeVisible();
    await expect(completedDialog(page)).toContainText('Change still owed');
    const [completed] = readOrders();
    expect(completed.changeOwedCents).toBe(5000);
    expect(completed.changeSettled).toBe(false);

    // It stays visible for follow-up in Order History.
    await completedDialog(page).getByRole('button', { name: 'Close' }).click();
    await page.goto('/pos/orders');
    const card = page.getByRole('article').filter({ hasText: '#1' });
    await expect(card).toContainText('Change still owed');
    await expect(card).toContainText('₱50.00');

    // Confirming handover records the settlement…
    await card
      .getByRole('button', { name: 'Confirm change handed over' })
      .click();
    await expect(page.getByText(/Change handover recorded/)).toBeVisible();
    await expect(card).toContainText('Change given');

    // …and the original amount owed stays on the record.
    const [settled] = readOrders();
    expect(settled.changeSettled).toBe(true);
    expect(settled.changeOwedCents).toBe(5000);
    await expect(card).toContainText('₱50.00');
  });

  test('change owed above the change due is refused', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await sheet.getByLabel('Cash received (optional)').fill('160');
    await recordChangeOwed(sheet, '50');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();

    await expect(sheet.getByRole('alert')).toContainText(
      'Change still owed must be between zero and the change due.',
    );
    expect(readOrders()[0].status).toBe('PARKED');
  });

  test('change owed on an order from a closed day can still be handed over', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await sheet.getByLabel('Cash received (optional)').fill('200');
    await recordChangeOwed(sheet, '50');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    // The business day closes before the customer comes back.
    closeOrderDay(day.id);
    await page.goto('/pos/orders');

    const card = page.getByRole('article').filter({ hasText: '#1' });
    await expect(card).toContainText('Change still owed');
    await card
      .getByRole('button', { name: 'Confirm change handed over' })
      .click();
    await expect(page.getByText(/Change handover recorded/)).toBeVisible();

    const [settled] = readOrders();
    expect(settled.changeSettled).toBe(true);
    expect(settled.changeOwedCents).toBe(5000);
  });
});

// ---- completion -------------------------------------------------------------

test.describe('Completion', () => {
  test('records the order once and contributes to the day figures', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await choosePayment(sheet, 'Split');
    await sheet.getByLabel('Cash portion').fill('100');
    await sheet.getByLabel('Online portion').fill('50');
    await sheet.getByLabel('Tip amount').fill('10');
    await sheet.getByRole('button', { name: 'Complete split payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    const orders = readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('COMPLETED');

    await page.goto('/pos/close');
    const summary = page.locator('dl.staff-cash-summary');
    await expect(
      summary.locator('div').filter({ hasText: 'Cash sales' }).locator('dd'),
    ).toContainText('₱100.00');
    await expect(
      summary
        .locator('div')
        .filter({ hasText: 'Online sales (excluded)' })
        .locator('dd'),
    ).toContainText('₱50.00');
    await expect(
      summary.locator('div').filter({ hasText: 'Cash tips' }).locator('dd'),
    ).toContainText('₱10.00');
  });

  test('replaying a completion does not double-count the order', async ({
    page,
  }) => {
    await orderReadyToCharge(page);

    let completeUrl: string | null = null;
    let completeBody: string | null = null;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.endsWith('/complete')
      ) {
        completeUrl = request.url();
        completeBody = request.postData();
      }
    });

    const sheet = await openChargeSheet(page);
    await sheet.getByLabel('Cash received (optional)').fill('200');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    expect(completeBody).not.toBeNull();

    const before = readOrders();
    const replay = await page.request.post(completeUrl!, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.parse(completeBody!) as Record<string, unknown>,
    });
    expect(replay.ok()).toBe(true);

    const after = readOrders();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].dayOrderNumber).toBe(1);
    expect(after[0].totalCents).toBe(before[0].totalCents);
    // The tender rows are not written twice.
    expect(after[0].payments).toEqual([{ method: 'CASH', amountCents: 15000 }]);
  });

  test('a double-tap on Complete records one order', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    await sheet.getByRole('button', { name: 'Complete cash payment' }).dblclick();
    await expect(completedDialog(page)).toBeVisible();

    const orders = readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].payments).toEqual([{ method: 'CASH', amountCents: 15000 }]);
  });
});

// ---- void -------------------------------------------------------------------

test.describe('Void', () => {
  test('needs a reason, stays visible as void, and is not revenue', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    await completedDialog(page).getByRole('button', { name: 'Void order' }).click();
    const voidDialog = page.getByRole('dialog', { name: 'Void this order?' });
    await expect(voidDialog).toBeVisible();

    // A blank reason is refused.
    await voidDialog.getByRole('button', { name: 'Void completed order' }).click();
    await expect(voidDialog.getByRole('alert')).toContainText(
      'Enter a reason before voiding the order.',
    );
    expect(readOrders()).toHaveLength(1);

    await voidDialog
      .getByLabel('Reason for void')
      .fill('  Customer changed their mind  ');
    await voidDialog.getByRole('button', { name: 'Void completed order' }).click();
    await expect(completedDialog(page)).toContainText('is void');
    await expect(completedDialog(page)).toContainText(
      'Customer changed their mind',
    );

    // A correction record is added; the original stays as it was.
    const orders = readOrders();
    expect(orders).toHaveLength(2);
    const [original, correction] = orders;
    expect(original.kind).toBe('PURCHASE');
    expect(original.totalCents).toBe(15000);
    expect(correction.kind).toBe('VOID');
    expect(correction.correctsSaleId).toBe(original.id);
    expect(correction.voidReason).toBe('Customer changed their mind');
    expect(correction.totalCents).toBe(-15000);
    // Net revenue for the day is nil.
    expect(original.totalCents + correction.totalCents).toBe(0);

    // The original remains visible, labelled void, in Order History.
    await completedDialog(page).getByRole('button', { name: 'Close' }).click();
    await page.goto('/pos/orders');
    const originalCard = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: /^Order #1\b/ }) });
    await expect(originalCard).toBeVisible();
    await expect(originalCard).toContainText('Void');
    await expect(originalCard).toContainText('₱150.00');
  });

  test('a corrected purchase is entered as a new order', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await completedDialog(page).getByRole('button', { name: 'Void order' }).click();
    const voidDialog = page.getByRole('dialog', { name: 'Void this order?' });
    await voidDialog.getByLabel('Reason for void').fill('Wrong drink');
    await voidDialog.getByRole('button', { name: 'Void completed order' }).click();
    await expect(completedDialog(page)).toContainText('is void');

    // The void screen offers a new order, not an edit of the completed one.
    await completedDialog(page)
      .getByRole('button', { name: 'Start new order' })
      .click();
    await expect(currentOrder(page)).toContainText('New order');
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
    await expect(currentOrder(page)).toContainText('Order #3');

    const orders = readOrders();
    expect(orders.map((order) => order.kind)).toEqual([
      'PURCHASE',
      'VOID',
      'PURCHASE',
    ]);
    // The original is untouched by the correction.
    expect(orders[0].totalCents).toBe(15000);
    expect(orders[0].lines).toHaveLength(1);
  });

  test('an order with withheld change can be voided', async ({ page }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);
    await sheet.getByLabel('Cash received (optional)').fill('200');
    await recordChangeOwed(sheet, '50');
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    await completedDialog(page).getByRole('button', { name: 'Void order' }).click();
    const voidDialog = page.getByRole('dialog', { name: 'Void this order?' });
    await voidDialog.getByLabel('Reason for void').fill('Rung up twice');
    await voidDialog.getByRole('button', { name: 'Void completed order' }).click();
    await expect(completedDialog(page)).toContainText('is void');

    const orders = readOrders();
    expect(orders).toHaveLength(2);
    // The withheld change stays on the original record.
    expect(orders[0].changeOwedCents).toBe(5000);
    expect(orders[1].kind).toBe('VOID');
    expect(orders[0].totalCents + orders[1].totalCents).toBe(0);
  });

  test('a parked order offers no void, only park or charge', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    await expect(
      currentOrder(page).getByRole('button', { name: 'Void order' }),
    ).toHaveCount(0);
    await expect(
      currentOrder(page).getByRole('button', { name: 'Park order' }),
    ).toBeVisible();
    await expect(
      currentOrder(page).getByRole('button', { name: /^Charge/ }),
    ).toBeVisible();
  });
});

// ---- cashier attribution ----------------------------------------------------

test.describe('Cashier attribution', () => {
  test('an order started with no active cashier is recorded without attribution', async ({
    page,
  }) => {
    await orderReadyToCharge(page);

    await expect(currentOrder(page)).toContainText('No cashier');
    expect(readOrders()[0].cashierNameSnapshot).toBeNull();

    const sheet = await openChargeSheet(page);
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    await expect(completedDialog(page)).toContainText('No cashier attribution');
    expect(readOrders()[0].cashierNameSnapshot).toBeNull();
  });

  test('selecting a cashier later never rewrites attribution already fixed', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    expect(readOrders()[0].cashierNameSnapshot).toBeNull();

    // A cashier is chosen on this device after the order was started.
    seedCashierSelection({
      deviceId: await deviceId(page),
      staffMemberId: staffMember.id,
      username: STAFF_USERNAME,
    });

    const sheet = await openChargeSheet(page);
    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();

    // Completing does not backfill the attribution fixed when it started.
    expect(readOrders()[0].cashierNameSnapshot).toBeNull();
    await expect(completedDialog(page)).toContainText('No cashier attribution');

    // Clearing the cashier again also leaves the record alone.
    seedCashierSelection({
      deviceId: await deviceId(page),
      staffMemberId: null,
      username: STAFF_USERNAME,
    });
    await page.reload();
    expect(readOrders()[0].cashierNameSnapshot).toBeNull();
  });
});

// ---- historical records -----------------------------------------------------

test.describe('Historical records', () => {
  test('an order that breaches today’s tender rule still renders', async ({
    page,
  }) => {
    // ADR 0005 §5: at least one historical order was tendered below its total.
    seedHistoricalUnderTenderedOrder({
      tradingDayId: day.id,
      dayOrderNumber: 1,
      productVariantId: catalog.products.espresso.variants.regular.id,
      customerName: `Legacy Guest ${RUN}`,
    });

    await signInAsStaff(page);
    await page.goto('/pos/orders');

    const card = page.getByRole('article').filter({ hasText: `Legacy Guest ${RUN}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText('₱150.00');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

// ---- touch layout of the settlement controls --------------------------------

test.describe('Touch layout at 1024×768', () => {
  test('payment and void controls meet the 44×44 CSS pixel target', async ({
    page,
  }) => {
    await orderReadyToCharge(page);
    const sheet = await openChargeSheet(page);

    const paymentControls: Array<[string, Locator]> = [
      ['Cash tab', sheet.getByRole('tab', { name: 'Cash' })],
      ['Online tab', sheet.getByRole('tab', { name: 'Online' })],
      ['Split tab', sheet.getByRole('tab', { name: 'Split' })],
      ['cash received', sheet.getByLabel('Cash received (optional)')],
      ['tip amount', sheet.getByLabel('Tip amount')],
      [
        'complete payment',
        sheet.getByRole('button', { name: 'Complete cash payment' }),
      ],
      ['cancel', sheet.getByRole('button', { name: 'Cancel' })],
    ];
    for (const [label, control] of paymentControls) {
      const box = await control.boundingBox();
      expect(box, `${label} should be laid out`).not.toBeNull();
      expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(
        MINIMUM_TOUCH_TARGET_PX,
      );
      expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(
        MINIMUM_TOUCH_TARGET_PX,
      );
    }

    await sheet.getByRole('button', { name: 'Complete cash payment' }).click();
    await expect(completedDialog(page)).toBeVisible();
    const voidTrigger = completedDialog(page).getByRole('button', {
      name: 'Void order',
    });
    const triggerBox = await voidTrigger.boundingBox();
    expect(Math.round(triggerBox!.height)).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );
    expect(Math.round(triggerBox!.width)).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );

    await voidTrigger.click();
    const voidDialog = page.getByRole('dialog', { name: 'Void this order?' });
    const confirm = voidDialog.getByRole('button', {
      name: 'Void completed order',
    });
    const confirmBox = await confirm.boundingBox();
    expect(Math.round(confirmBox!.height)).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );
    expect(Math.round(confirmBox!.width)).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );
  });
});
