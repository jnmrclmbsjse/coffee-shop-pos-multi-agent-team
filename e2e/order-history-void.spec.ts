import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  readVoidCorrections,
  seedOrderHistoryVoidFixture,
  type OrderHistoryVoidFixture,
  type OrderHistoryVoidOrder,
} from './fixtures/staff-order-ledger';

/**
 * Voiding completed orders from Order History, browser -> API -> PostgreSQL.
 * The authority rule depends on the session's role, which the unit tests mock:
 * staff may void only orders from the business day that is open now, and an
 * administrator may void a completed order from any day. Either way the void is
 * a new correcting record; the original order is never edited.
 */

test.describe.configure({ mode: 'serial' });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;

// Mirrors STAFF_VOID_OPEN_DAY_ONLY_MESSAGE in apps/api/src/orders/orders.service.ts.
const STAFF_VOID_SCOPE_MESSAGE =
  'Staff can only void orders from the business day that is open now. Ask an administrator to void an order from an earlier day.';

let fixture: OrderHistoryVoidFixture;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function orderCard(page: Page, order: OrderHistoryVoidOrder): Locator {
  const title = page.getByRole('heading', {
    name: new RegExp(
      `Order\\s*#${order.dayOrderNumber}\\b.*${escapeRegExp(order.customerName)}`,
    ),
  });
  return page.getByRole('article').filter({ has: title });
}

function isVoidRequest(page: Page, order: OrderHistoryVoidOrder) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/orders/${order.clientGeneratedId}/void`,
  );
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form focuses its first field one frame after it appears; filling
  // before that can re-route the password into the username box.
  const username = page.locator('#staff-username');
  await expect(username).toBeFocused();
  await username.fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await expect(username).toHaveValue(STAFF_USERNAME);
  await expect(page.locator('#staff-password')).toHaveValue(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await expect(page.locator('#username')).toHaveValue(ADMIN_USERNAME);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('voiding completed orders from Order History', () => {
  test.beforeAll(() => {
    fixture = seedOrderHistoryVoidFixture(RUN);
  });

  test('staff voids an open-day order from the ledger but cannot void an earlier day\'s', async ({
    page,
  }) => {
    const reason = `Charged the wrong customer ${RUN}`;
    await signInAsStaff(page);

    await test.step('the open day\'s completed order is voided with a required reason', async () => {
      await page.goto('/pos/orders');
      await expect(
        page.getByRole('combobox', { name: 'Business day' }),
      ).toHaveValue(fixture.openDayId);
      const card = orderCard(page, fixture.openOrder);
      await expect(card.locator('.staff-order-status')).toHaveText('Completed');

      await card.getByRole('button', { name: 'Void order' }).click();
      const dialog = page.getByRole('dialog', { name: 'Void this order?' });
      await expect(dialog).toBeVisible();

      await dialog.getByRole('button', { name: 'Void completed order' }).click();
      await expect(dialog.getByRole('alert')).toHaveText(
        'Enter a reason before voiding the order.',
      );
      await expect(dialog).toBeVisible();
      expect(readVoidCorrections(fixture.openOrder.id)).toEqual([]);

      const reasonField = dialog.getByLabel('Reason for void');
      await reasonField.fill(reason);
      await expect(reasonField).toHaveValue(reason);
      const voided = isVoidRequest(page, fixture.openOrder);
      await dialog.getByRole('button', { name: 'Void completed order' }).click();
      expect((await voided).status()).toBe(201);

      await expect(dialog).toHaveCount(0);
      await expect(card.locator('.staff-order-status')).toHaveText('Void');
      await expect(card).toContainText(`Void reason: ${reason}`);
      await expect(card.getByRole('button', { name: 'Void order' })).toHaveCount(0);
    });

    await test.step('the void is a correcting record on the open day and survives a reload', async () => {
      expect(readVoidCorrections(fixture.openOrder.id)).toEqual([
        { tradingDayId: fixture.openDayId, voidReason: reason, totalCents: -15_000 },
      ]);

      await page.reload();
      const card = orderCard(page, fixture.openOrder);
      await expect(card.locator('.staff-order-status')).toHaveText('Void');
      await expect(card).toContainText(`Void reason: ${reason}`);
    });

    await test.step('an earlier day\'s ledger offers no void', async () => {
      await page.goto(`/pos/orders?day=${encodeURIComponent(fixture.earlierDayId)}`);
      await expect(
        page.getByRole('combobox', { name: 'Business day' }),
      ).toHaveValue(fixture.earlierDayId);
      const card = orderCard(page, fixture.earlierOrder);
      await expect(card.locator('.staff-order-status')).toHaveText('Completed');
      await expect(
        page.getByRole('main').getByRole('button', { name: 'Void order' }),
      ).toHaveCount(0);
    });

    await test.step('the API refuses a staff void of an earlier day\'s order', async () => {
      const response = await page.request.post(
        `${API_BASE_URL}/orders/${fixture.earlierOrder.clientGeneratedId}/void`,
        {
          data: {
            clientGeneratedId: randomUUID(),
            deviceId: `e2e-void-${RUN}`,
            voidReason: 'Staff attempt on a closed day',
          },
          failOnStatusCode: false,
        },
      );
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(STAFF_VOID_SCOPE_MESSAGE);
      expect(readVoidCorrections(fixture.earlierOrder.id)).toEqual([]);
    });
  });

  test('an administrator voids an earlier day\'s order from the Order History detail', async ({
    page,
  }) => {
    const reason = `Duplicate entry found at close ${RUN}`;
    await signInAsAdmin(page);
    await page.goto(`/order-history/${fixture.earlierOrder.id}`);

    const status = page.locator('.order-detail-head .order-status');
    const voidReason = page.locator('.order-void-reason');
    await expect(
      page.getByRole('heading', { name: `Order ${fixture.earlierOrder.dayOrderNumber}`, level: 1 }),
    ).toBeVisible();
    await expect(status).toHaveText('Completed');

    await page.getByRole('button', { name: 'Void order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Void this order?' });
    const reasonField = dialog.getByLabel('Reason for void');
    await reasonField.fill(reason);
    await expect(reasonField).toHaveValue(reason);
    const voided = isVoidRequest(page, fixture.earlierOrder);
    await dialog.getByRole('button', { name: 'Void completed order' }).click();
    expect((await voided).status()).toBe(201);

    await expect(dialog).toHaveCount(0);
    await expect(status).toHaveText('Void');
    await expect(voidReason).toContainText(reason);
    await expect(page.getByRole('button', { name: 'Void order' })).toHaveCount(0);

    // The correction lands on the open day; the earlier day is not reopened.
    expect(readVoidCorrections(fixture.earlierOrder.id)).toEqual([
      { tradingDayId: fixture.openDayId, voidReason: reason, totalCents: -12_000 },
    ]);

    await page.reload();
    await expect(status).toHaveText('Void');
    await expect(voidReason).toContainText(reason);
    await expect(page.getByRole('button', { name: 'Void order' })).toHaveCount(0);
  });
});
