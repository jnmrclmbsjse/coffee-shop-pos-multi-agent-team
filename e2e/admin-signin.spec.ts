import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #3 — "Administrator username sign-in".
 *
 * Each acceptance criterion on the parent story is exercised through the real
 * browser → web app → NestJS API → database path (no mocking). Fixtures are the
 * seeded `admin` (ADMIN) and `staff` (STAFF) users from apps/api/prisma/seed.ts;
 * credentials default to the seed values and are overridable via E2E_* env vars
 * so the suite can run against any seeded environment.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';
const PROTECTED_PATHS = ['/dashboard', '/inventory', '/reports'] as const;
const PROTECTED_HEADINGS: Record<(typeof PROTECTED_PATHS)[number], string> = {
  '/dashboard': 'Dashboard',
  '/inventory': 'Inventory',
  '/reports': 'Reports',
};

function usernameField(page: Page) {
  return page.locator('#username');
}

function passwordField(page: Page) {
  return page.locator('#password');
}

function submit(page: Page) {
  return page.getByRole('button', { name: 'Sign in' });
}

async function attemptSignIn(page: Page, username: string, password: string) {
  await usernameField(page).fill(username);
  await passwordField(page).fill(password);
  await submit(page).click();
}

test.describe('Administrator username sign-in (story #3)', () => {
  // AC1 — When signed out, directly opening any admin-only area routes to
  // sign-in before any protected contents are shown (deep-link, not nav click).
  for (const path of PROTECTED_PATHS) {
    test(`AC1: signed-out deep link to ${path} is gated behind sign-in`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
      // The originally requested path is preserved for return-to.
      expect(decodeURIComponent(new URL(page.url()).search)).toContain(path);
      // No protected content leaked.
      await expect(
        page.getByRole('heading', { name: PROTECTED_HEADINGS[path] }),
      ).toHaveCount(0);
      await expect(submit(page)).toBeVisible();
    });
  }

  // AC2 — Valid administrator username + password signs in and lands on an
  // admin area; usernames are case-insensitive and trimmed, passwords exact.
  test('AC2: valid admin credentials sign in and reach the dashboard', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${ADMIN_USERNAME}`)).toBeVisible();
  });

  test('AC2: username is matched case-insensitively and after trimming spaces', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, `  ${ADMIN_USERNAME.toUpperCase()}  `, ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('AC2: password is case-sensitive (wrong-case password is refused)', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD.toUpperCase());

    await expect(page.getByRole('alert')).toHaveText(INVALID_CREDENTIALS_MESSAGE);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  // AC3 — The identifier is a username, not an email. An email-shaped value
  // does not identify the account.
  test('AC3: an email-shaped username is not accepted as an identifier', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, `${ADMIN_USERNAME}@ucm.coffee`, ADMIN_PASSWORD);

    await expect(page.getByRole('alert')).toHaveText(INVALID_CREDENTIALS_MESSAGE);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  });

  // AC4 — After success, land on the exact requested admin path including query
  // params; a directly-opened sign-in defaults to the dashboard.
  test('AC4: return-to preserves the exact deep-linked path and query params', async ({
    page,
  }) => {
    await page.goto('/reports?range=today&sort=desc');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
    // The destination context confirms the intended target.
    await expect(page.getByText('Sign in to continue to')).toContainText('Reports');

    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/reports\?range=today&sort=desc$/);
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });

  test('AC4: a directly-opened sign-in defaults to the dashboard', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // AC5 — Unknown username and known-username/wrong-password are refused with a
  // byte-identical generic message; user stays signed out on the sign-in page.
  test('AC5: unknown username and wrong password are indistinguishable', async ({
    page,
  }) => {
    await page.goto('/sign-in');

    await attemptSignIn(page, 'no-such-admin', 'whatever-password');
    await expect(page.getByRole('alert')).toBeVisible();
    const unknownUserMessage = await page.getByRole('alert').textContent();
    await expect(page).toHaveURL(/\/sign-in/);

    await usernameField(page).fill('');
    await passwordField(page).fill('');
    await attemptSignIn(page, ADMIN_USERNAME, `${ADMIN_PASSWORD}-wrong`);
    await expect(page.getByRole('alert')).toBeVisible();
    const wrongPasswordMessage = await page.getByRole('alert').textContent();
    await expect(page).toHaveURL(/\/sign-in/);

    expect(unknownUserMessage?.trim()).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(wrongPasswordMessage?.trim()).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(wrongPasswordMessage).toBe(unknownUserMessage);
  });

  test('AC5: a refused attempt cannot then reach an admin area by direct URL', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, `${ADMIN_PASSWORD}-wrong`);
    await expect(page.getByRole('alert')).toBeVisible();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  });

  // AC6 — Field-level validation: required username / password, sign-in does
  // not proceed, and password spaces are preserved (not trimmed).
  test('AC6: a missing username shows "Username is required" and blocks sign-in', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await passwordField(page).fill(ADMIN_PASSWORD);
    await submit(page).click();

    await expect(page.locator('#username-error')).toHaveText('Username is required');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('AC6: an all-space username shows "Username is required"', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, '   ', ADMIN_PASSWORD);

    await expect(page.locator('#username-error')).toHaveText('Username is required');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('AC6: a missing password shows "Password is required" and blocks sign-in', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await usernameField(page).fill(ADMIN_USERNAME);
    await submit(page).click();

    await expect(page.locator('#password-error')).toHaveText('Password is required');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('AC6: password spaces are preserved, not stripped, in the field', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    const spaced = '  spaced pass  ';
    await passwordField(page).fill(spaced);

    await expect(passwordField(page)).toHaveValue(spaced);
  });

  // AC7 — A valid non-admin (staff) account is refused at admin sign-in with the
  // same generic result and cannot enter an admin-only area.
  test('AC7: valid staff credentials are refused with the generic message', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, STAFF_USERNAME, STAFF_PASSWORD);

    await expect(page.getByRole('alert')).toHaveText(INVALID_CREDENTIALS_MESSAGE);
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  });

  // AC8 — Session persists across reload and a second tab of the same browser.
  test('AC8: session persists across a reload of an admin page', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('AC8: session persists in a second tab of the same browser', async ({
    page,
    context,
  }) => {
    await page.goto('/sign-in');
    await attemptSignIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    const secondTab = await context.newPage();
    await secondTab.goto('/inventory');
    await expect(secondTab).toHaveURL(/\/inventory$/);
    await expect(
      secondTab.getByRole('heading', { name: 'Inventory' }),
    ).toBeVisible();
    await secondTab.close();
  });
});
