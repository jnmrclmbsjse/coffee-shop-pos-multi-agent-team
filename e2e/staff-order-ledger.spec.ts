import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import {
  readStaffOrderLedgerSnapshot,
  seedStaffOrderLedgerFixture,
  type StaffOrderLedgerFixture,
} from './fixtures/staff-order-ledger';

/**
 * End-to-end coverage for story #142's staff, read-only business-day ledger.
 * Order capture is not implemented, so the complete matrix is seeded directly
 * and then exercised through the browser -> API -> PostgreSQL path.
 */

test.describe.configure({ mode: 'serial' });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;

let fixture: StaffOrderLedgerFixture;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function orderCard(page: Page, number: number, customer: string): Locator {
  const title = page.getByRole('heading', {
    name: new RegExp(
      `(?:Order\\s*)?#?${number}\\b.*${escapeRegExp(customer)}`,
      'i',
    ),
  });
  return page.getByRole('article').filter({ has: title });
}

function selectedOption(page: Page, label: 'Status' | 'Payment'): Locator {
  return page.getByRole('combobox', { name: label }).locator('option:checked');
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  await page.getByLabel('Username', { exact: true }).fill(STAFF_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

function isLedgerResponse(request: Request): boolean {
  return (
    request.method() === 'GET' &&
    new URL(request.url()).pathname.startsWith(
      '/reporting/staff-order-ledger/',
    )
  );
}

async function selectLedgerOption(
  page: Page,
  label: 'Business day' | 'Status' | 'Payment',
  option: { label: string } | { value: string },
): Promise<void> {
  const response = page.waitForResponse((candidate) =>
    isLedgerResponse(candidate.request()),
  );
  await page.getByRole('combobox', { name: label }).selectOption(option);
  expect((await response).ok()).toBe(true);
}

async function searchCustomers(page: Page, query: string): Promise<void> {
  const response = page.waitForResponse((candidate) =>
    isLedgerResponse(candidate.request()),
  );
  await page.getByRole('searchbox', { name: 'Customer name' }).fill(query);
  expect((await response).ok()).toBe(true);
}

function trackMutatingRequests(page: Page): {
  requests: string[];
  stop: () => void;
} {
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  };
  page.on('request', listener);
  return {
    requests,
    stop: () => page.off('request', listener),
  };
}

test.describe('staff order history ledger (story #142, QA #148)', () => {
  test.beforeAll(() => {
    fixture = seedStaffOrderLedgerFixture(RUN);
  });

  test('staff can scope, filter and inspect every read-only ledger state without changing an order', async ({
    page,
  }) => {
    await signInAsStaff(page);
    const storedBefore = readStaffOrderLedgerSnapshot();
    const writes = trackMutatingRequests(page);

    await test.step('staff navigation reaches the ledger and defaults to the open day', async () => {
      const historyLink = page.getByRole('link', { name: 'Order History' });
      await expect(historyLink).toBeVisible();
      await historyLink.click();

      await expect(page).toHaveURL(/\/pos\/orders(?:\?|$)/);
      await expect(page.getByRole('heading', { name: 'Order History' })).toBeVisible();
      await expect(historyLink).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('combobox', { name: 'Business day' }),
      ).toHaveValue(fixture.openDay.id);

      await expect(orderCard(page, 1, 'Open Day First')).toBeVisible();
      await expect(orderCard(page, 1, 'Closed Day First')).toHaveCount(0);
    });

    await test.step('status filters All, Completed, Parked and Void are exclusive', async () => {
      await expect(selectedOption(page, 'Status')).toHaveText('All');

      await selectLedgerOption(page, 'Status', { label: 'Completed' });
      await expect(orderCard(page, 5, 'Senior Online Guest')).toBeVisible();
      await expect(orderCard(page, 3, 'Open Parked Guest')).toHaveCount(0);
      await expect(orderCard(page, 6, 'Open Voided Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Status', { label: 'Parked' });
      await expect(orderCard(page, 3, 'Open Parked Guest')).toBeVisible();
      await expect(orderCard(page, 5, 'Senior Online Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Status', { label: 'Void' });
      await expect(orderCard(page, 6, 'Open Voided Guest')).toBeVisible();
      await expect(orderCard(page, 3, 'Open Parked Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Status', { label: 'All' });
    });

    await test.step('payment filters Any, Cash, Online and Split are exclusive', async () => {
      await expect(selectedOption(page, 'Payment')).toHaveText('Any payment');

      await selectLedgerOption(page, 'Payment', { label: 'Cash' });
      await expect(orderCard(page, 1, 'Open Day First')).toBeVisible();
      await expect(orderCard(page, 5, 'Senior Online Guest')).toHaveCount(0);
      await expect(orderCard(page, 4, 'Open Split Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Payment', { label: 'Online' });
      await expect(orderCard(page, 5, 'Senior Online Guest')).toBeVisible();
      await expect(orderCard(page, 1, 'Open Day First')).toHaveCount(0);
      await expect(orderCard(page, 4, 'Open Split Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Payment', { label: 'Split' });
      await expect(orderCard(page, 4, 'Open Split Guest')).toBeVisible();
      await expect(orderCard(page, 5, 'Senior Online Guest')).toHaveCount(0);

      await selectLedgerOption(page, 'Payment', { label: 'Any payment' });
    });

    await test.step('customer search and the full filter conjunction exclude partial matches', async () => {
      await searchCustomers(page, '  open parked  ');
      await expect(orderCard(page, 3, 'Open Parked Guest')).toBeVisible();
      await expect(orderCard(page, 2, 'Walk-in')).toHaveCount(0);

      await searchCustomers(page, 'Senior');
      await selectLedgerOption(page, 'Status', { label: 'Completed' });
      await selectLedgerOption(page, 'Payment', { label: 'Online' });

      await expect(orderCard(page, 5, 'Senior Online Guest')).toBeVisible();
      await expect(orderCard(page, 8, 'Senior Cash Guest')).toHaveCount(0);
      await expect(orderCard(page, 4, 'Open Split Guest')).toHaveCount(0);

      expect(new URL(page.url()).search).not.toBe('');
      await page.reload();
      await expect(selectedOption(page, 'Status')).toHaveText('Completed');
      await expect(selectedOption(page, 'Payment')).toHaveText('Online');
      await expect(page.getByRole('searchbox', { name: 'Customer name' })).toHaveValue(
        'Senior',
      );
      await expect(orderCard(page, 5, 'Senior Online Guest')).toBeVisible();

      await selectLedgerOption(page, 'Status', { label: 'Parked' });
      await expect(page.getByText('No orders to show', { exact: true })).toBeVisible();
    });

    await test.step('the closed day retains Completed, Parked and Void orders', async () => {
      await selectLedgerOption(page, 'Status', { label: 'All' });
      await selectLedgerOption(page, 'Payment', { label: 'Any payment' });
      await searchCustomers(page, '');
      await selectLedgerOption(page, 'Business day', {
        value: fixture.closedDay.id,
      });

      await expect(orderCard(page, 1, 'Closed Day First')).toContainText(
        'Completed',
      );
      await expect(orderCard(page, 2, 'Closed Parked Guest')).toContainText(
        'Parked',
      );
      await expect(orderCard(page, 3, 'Closed Voided Guest')).toContainText(
        'Void',
      );
      await expect(orderCard(page, 5, 'Closed Split Guest')).toContainText(
        'Completed',
      );
      await expect(orderCard(page, 1, 'Open Day First')).toHaveCount(0);
    });

    await test.step('cards render nullable, payment, line, void and change states', async () => {
      await selectLedgerOption(page, 'Business day', {
        value: fixture.openDay.id,
      });

      const noCashier = orderCard(page, 1, 'Open Day First');
      await expect(noCashier).toContainText('Completed');
      await expect(noCashier).toContainText('Cash');
      await expect(noCashier).toContainText('₱150.00');
      await expect(noCashier).toContainText('Change still owed');
      await expect(noCashier).toContainText('₱20.00');
      await expect(noCashier).not.toContainText('null');
      await expect(noCashier).not.toContainText('Cashier');

      const walkIn = orderCard(page, 2, 'Walk-in');
      await expect(walkIn).toContainText(fixture.cashierName);
      await expect(walkIn).toContainText('Change given');
      await expect(walkIn).toContainText('₱20.00');
      await expect(walkIn).not.toContainText('null');

      const parked = orderCard(page, 3, 'Open Parked Guest');
      await expect(parked).toContainText('Parked');
      await expect(parked).not.toContainText(/\b(?:Cash|Online|Split)\b/);
      await expect(parked).not.toContainText(/\b\d{1,2}:\d{2}\b/);

      const split = orderCard(page, 4, 'Open Split Guest');
      await expect(split).toContainText('Cash');
      await expect(split).toContainText('₱80.00');
      await expect(split).toContainText('Online');
      await expect(split).toContainText('₱120.00');

      const discounted = orderCard(page, 5, 'Senior Online Guest');
      await expect(discounted).toContainText('Completed');
      await expect(discounted).toContainText('Online');
      await expect(discounted).toContainText('₱240.00');
      await expect(discounted).toContainText(
        /\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i,
      );
      await expect(discounted).toContainText(/2\s*[×x]/);
      await expect(discounted).toContainText(/1\s*[×x]/);
      await expect(discounted).toContainText(fixture.productNames.latte);
      await expect(discounted).toContainText('Small');
      await expect(discounted).toContainText(fixture.productNames.pastry);
      await expect(discounted).toContainText('Regular');
      await expect(discounted).toContainText(/Senior(?: discount)?/i);

      const voided = orderCard(page, 6, 'Open Voided Guest');
      await expect(voided).toContainText('Void');
      await expect(voided).toContainText('Wrong milk selected');
    });

    await test.step('the ledger and correction guidance expose no mutating affordance', async () => {
      const main = page.getByRole('main');
      const mutatingName = /create|edit|resume|complete|void|delete|change order/i;
      await expect(main.getByRole('button', { name: mutatingName })).toHaveCount(0);
      await expect(main.getByRole('link', { name: mutatingName })).toHaveCount(0);
      await expect(page.getByRole('article').getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('article').getByRole('link')).toHaveCount(0);

      const guidance = page.getByTestId('correction-guidance');
      await expect(guidance).toContainText(/void(?:ing)? the original/i);
      await expect(guidance).toContainText(/enter(?:ing)? the corrected order again/i);
      await expect(guidance).toContainText(/reviewing or filtering history never changes an order/i);
      await expect(guidance.getByRole('button')).toHaveCount(0);
      await expect(guidance.getByRole('link')).toHaveCount(0);
    });

    await test.step('staff access does not widen the admin-only history API', async () => {
      for (const path of [
        '/reporting/order-history',
        `/reporting/order-history/${encodeURIComponent(fixture.openDay.id)}`,
      ]) {
        const response = await page.request.get(`${API_BASE_URL}${path}`, {
          failOnStatusCode: false,
        });
        expect(response.status(), path).toBe(403);
        expect(await response.text(), path).not.toContain('Open Day First');
      }
    });

    writes.stop();
    expect(writes.requests).toEqual([]);
    expect(readStaffOrderLedgerSnapshot()).toBe(storedBefore);
  });
});
