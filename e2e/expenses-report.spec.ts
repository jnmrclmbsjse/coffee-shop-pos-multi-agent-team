import { expect, test, type Page } from '@playwright/test';
import {
  cleanupExpenseReportFixture,
  seedExpenseReportFixture,
  type ExpenseReportFixture,
} from './fixtures/reporting-seed';

test.describe.configure({ mode: 'serial' });

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;

let fixture: ExpenseReportFixture;

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
  await page.getByLabel('Username', { exact: true }).fill(STAFF_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

test.describe('admin expenses report', () => {
  test.beforeAll(() => {
    fixture = seedExpenseReportFixture(RUN);
  });

  test.afterAll(() => {
    cleanupExpenseReportFixture(fixture);
  });

  test('shows the effective categorized breakdown and matches Sales cash expenses', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/reports');
    const expensesTab = page.getByRole('link', { name: 'Expenses' });
    await expect(expensesTab).toBeVisible();
    await expensesTab.click();
    await expect(page).toHaveURL(/\/reports\/expenses$/);

    await page.getByRole('textbox', { name: 'From' }).fill(fixture.from);
    await page.getByRole('textbox', { name: 'To' }).fill(fixture.to);
    await page.getByRole('button', { name: 'Apply range' }).click();
    await expect(page.getByRole('heading', { name: 'Expense entries' })).toBeVisible();

    await expect(page.getByText('₱130.00')).toBeVisible();
    const categories = page.getByRole('table', { name: 'Expenses by category' });
    const categoryRows = categories.locator('tbody tr');
    await expect(categoryRows).toHaveCount(3);
    await expect(categoryRows.nth(0)).toContainText('Supplies');
    await expect(categoryRows.nth(0)).toContainText('₱80.00');
    await expect(categories).toContainText('Utilities');
    await expect(categories).toContainText('Uncategorized');

    const entries = page.getByRole('table', { name: 'Expense entries' });
    await expect(entries.locator('tbody tr')).toHaveCount(3);
    await expect(entries).toContainText('Corrected cup cost');
    await expect(entries).toContainText('Amended');
    await expect(entries).not.toContainText('Original cup cost');
    await expect(entries).not.toContainText('Wrongly filed payout');
    await expect(entries).toContainText('Open');
    await expect(entries).toContainText('Closed');

    const [expenseResponse, salesResponse] = await Promise.all([
      page.request.get(
        `${API_BASE_URL}/reporting/expenses?from=${fixture.from}&to=${fixture.to}`,
      ),
      page.request.get(
        `${API_BASE_URL}/reporting/report?from=${fixture.from}&to=${fixture.to}`,
      ),
    ]);
    expect(expenseResponse.ok()).toBe(true);
    expect(salesResponse.ok()).toBe(true);
    const expenseReport = (await expenseResponse.json()) as {
      totalCents: number;
    };
    const salesReport = (await salesResponse.json()) as {
      dailyReconciliation: Array<{ cashExpensesCents: number }>;
    };
    expect(expenseReport.totalCents).toBe(fixture.expectedTotalCents);
    expect(
      salesReport.dailyReconciliation.reduce(
        (total, day) => total + day.cashExpensesCents,
        0,
      ),
    ).toBe(expenseReport.totalCents);
  });

  test('staff cannot open the page or call the endpoint', async ({ page }) => {
    await signInAsStaff(page);
    const response = await page.request.get(
      `${API_BASE_URL}/reporting/expenses?from=${fixture.from}&to=${fixture.to}`,
      { failOnStatusCode: false },
    );
    expect(response.status()).toBe(403);

    await page.goto('/reports/expenses');
    await expect(page).not.toHaveURL(/\/reports\/expenses$/);
    await expect(page.getByRole('heading', { name: 'Expenses' })).toHaveCount(0);
  });
});
