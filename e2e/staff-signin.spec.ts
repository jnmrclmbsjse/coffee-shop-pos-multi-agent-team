import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #18 — "Staff POS sign-in with password or
 * 4-digit PIN" (QA Task #22).
 *
 * Every acceptance criterion on the parent story is exercised through the real
 * browser → web app → NestJS API → database path (no mocking). Fixtures are the
 * seeded `staff` (STAFF, with a 4-digit PIN) and `admin` (ADMIN) users from
 * apps/api/prisma/seed.ts; credentials default to the seed values and are
 * overridable via E2E_* env vars so the suite can run against any seeded
 * environment.
 *
 * Routing facts under test (apps/web/src/App.tsx):
 *   /staff/sign-in  → staff screen (this story)   /sign-in → admin screen
 *   /pos            → point of sale (STAFF only)
 *
 * The remembered-staff picker and the device id live in localStorage; the
 * session is an httpOnly cookie. "Sign out" is simulated by clearing cookies
 * (the app has no v1 sign-out control), which leaves the device-remembered
 * staff intact — exactly the state the PIN path is designed for.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const STAFF_PIN = process.env.E2E_STAFF_PIN ?? '0000';
const STAFF_DISPLAY_NAME = process.env.E2E_STAFF_DISPLAY_NAME ?? 'Coffee Shop Staff';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// The single generic failure the UI shows for every unsuccessful sign-in,
// regardless of method or which credential was wrong (StaffSignIn.tsx).
const GENERIC_FAILURE =
  'We could not sign you in. Check your details and try again.';

const STAFF_SIGN_IN_PATH = '/staff/sign-in';

function status(page: Page) {
  return page.getByRole('alert');
}

function usernameField(page: Page) {
  return page.locator('#staff-username');
}

function passwordField(page: Page) {
  return page.locator('#staff-password');
}

function pinSubmit(page: Page) {
  return page.getByRole('button', { name: 'Sign in' });
}

/** Move from the picker into the username + password form. */
async function openPasswordForm(page: Page) {
  await page
    .getByRole('button', { name: 'Use Username and Password' })
    .click();
  await expect(usernameField(page)).toBeVisible();
}

async function submitPassword(page: Page, username: string, password: string) {
  await usernameField(page).fill(username);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Tap PIN digits on the on-screen pad (no physical keyboard). */
async function tapPin(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

function filledPinCells(page: Page) {
  return page.locator('.staff-pin-cell.is-filled');
}

/** Simulate manual/auto sign-out: drop the session cookie, keep localStorage. */
async function signOut(context: BrowserContext) {
  await context.clearCookies();
}

/**
 * Complete a username + password sign-in from a fresh browser so the staff
 * member becomes remembered on this device, then return to a signed-out staff
 * screen with the picker populated.
 */
async function rememberStaffOnDevice(page: Page, context: BrowserContext) {
  await page.goto(STAFF_SIGN_IN_PATH);
  await openPasswordForm(page);
  await submitPassword(page, STAFF_USERNAME, STAFF_PASSWORD);
  await expect(page).toHaveURL(/\/pos$/);

  await signOut(context);
  await page.goto(STAFF_SIGN_IN_PATH);
  await expect(
    page.getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) }),
  ).toBeVisible();
}

test.describe('Staff POS sign-in (story #18)', () => {
  // AC1 — The staff sign-in screen is a separate route/screen from admin.
  test('AC1: staff sign-in is a distinct screen from admin sign-in', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    // Staff-specific chrome, and an explicit link across to the admin screen.
    await expect(page.getByText('Staff sign-in')).toBeVisible();
    const adminLink = page.getByRole('link', { name: 'Administrator sign-in' });
    await expect(adminLink).toHaveAttribute('href', '/sign-in');
    // The admin-only "Administrator access" chrome does not appear here.
    await expect(page.getByText('Administrator access')).toHaveCount(0);

    // The admin screen is genuinely a different screen.
    await page.goto('/sign-in');
    await expect(page.getByText('Administrator access')).toBeVisible();
    await expect(page.locator('#staff-username')).toHaveCount(0);
  });

  // AC2 — Active staff signs in with username + password and lands in the POS.
  test('AC2: valid username + password reaches the POS', async ({ page }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    await openPasswordForm(page);
    await submitPassword(page, STAFF_USERNAME, STAFF_PASSWORD);

    await expect(page).toHaveURL(/\/pos$/);
    await expect(
      page.getByRole('heading', { name: 'Ready for the next order.' }),
    ).toBeVisible();
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();
  });

  // AC3 — Active staff signs in with a 4-digit PIN via the on-screen pad and
  // lands in the POS (no physical keyboard used — every digit is a tap).
  test('AC3: assigned 4-digit PIN via the on-screen pad reaches the POS', async ({
    page,
    context,
  }) => {
    await rememberStaffOnDevice(page, context);

    // AC4 — the PIN path requires picking the staff member first.
    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();
    await expect(
      page.getByText('Enter your 4-digit staff PIN.'),
    ).toBeVisible();

    await tapPin(page, STAFF_PIN);
    await expect(filledPinCells(page)).toHaveCount(4);
    await pinSubmit(page).click();

    await expect(page).toHaveURL(/\/pos$/);
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();
  });

  // AC4 — The picker only lists staff previously signed in on this device.
  test('AC4: a fresh device shows an empty picker and steers to password', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);

    await expect(
      page.getByText('No staff remembered on this device'),
    ).toBeVisible();
    await expect(page.locator('.staff-picker-tile')).toHaveCount(0);
    // The only way forward is username + password.
    await expect(
      page.getByRole('button', { name: 'Use Username and Password' }),
    ).toBeVisible();
  });

  test('AC4: a remembered staff member appears in the picker after sign-out', async ({
    page,
    context,
  }) => {
    // Before any sign-in, the staff member is not offered for PIN entry.
    await page.goto(STAFF_SIGN_IN_PATH);
    await expect(
      page.getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) }),
    ).toHaveCount(0);

    await rememberStaffOnDevice(page, context);
    // Now present in the picker (assertion inside the helper), and reusable.
    await expect(page.locator('.staff-picker-tile')).toHaveCount(1);
  });

  test('AC4: remembered staff are scoped to the device (not shared with a fresh browser)', async ({
    page,
    context,
    browser,
  }) => {
    await rememberStaffOnDevice(page, context);

    // A different browser context = a different device: nothing remembered.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto(STAFF_SIGN_IN_PATH);
    await expect(
      otherPage.getByText('No staff remembered on this device'),
    ).toBeVisible();
    await expect(otherPage.locator('.staff-picker-tile')).toHaveCount(0);
    await otherContext.close();
  });

  // AC5 — A PIN accepts exactly four digits; submission is gated on four digits,
  // and the correct (backspace) and clear controls work.
  test('AC5: PIN submit is gated on exactly four digits; correct and clear work', async ({
    page,
    context,
  }) => {
    await rememberStaffOnDevice(page, context);
    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();

    // Fewer than four digits: submission stays unavailable.
    await tapPin(page, '123');
    await expect(filledPinCells(page)).toHaveCount(3);
    await expect(pinSubmit(page)).toBeDisabled();

    // The fourth digit enables submission.
    await tapPin(page, '4');
    await expect(filledPinCells(page)).toHaveCount(4);
    await expect(pinSubmit(page)).toBeEnabled();

    // The pad never exceeds four digits: with four entered, the digit keys are
    // disabled so a fifth digit cannot be added.
    await expect(
      page.getByRole('button', { name: '5', exact: true }),
    ).toBeDisabled();
    await expect(filledPinCells(page)).toHaveCount(4);

    // Correct (backspace) removes the last digit and re-gates submission.
    await page.getByRole('button', { name: 'Correct last PIN digit' }).click();
    await expect(filledPinCells(page)).toHaveCount(3);
    await expect(pinSubmit(page)).toBeDisabled();

    // Clear empties the entry entirely.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(filledPinCells(page)).toHaveCount(0);
    await expect(pinSubmit(page)).toBeDisabled();
  });

  // AC5 — an incorrect PIN does not sign in, does not reach the POS, and shows
  // the generic error.
  test('AC5: an incorrect PIN is refused with the generic error and no POS', async ({
    page,
    context,
  }) => {
    await rememberStaffOnDevice(page, context);
    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();

    const wrongPin = STAFF_PIN === '9999' ? '1111' : '9999';
    await tapPin(page, wrongPin);
    await pinSubmit(page).click();

    await expect(status(page)).toHaveText(GENERIC_FAILURE);
    await expect(page).not.toHaveURL(/\/pos$/);

    // A refused attempt cannot then reach the POS by direct URL.
    await page.goto('/pos');
    await expect(page).toHaveURL(new RegExp(STAFF_SIGN_IN_PATH));
    await expect(
      page.getByRole('heading', { name: 'Ready for the next order.' }),
    ).toHaveCount(0);
  });

  // AC6 — Administrator credentials are rejected on the staff screen and do not
  // reach the POS.
  test('AC6: administrator credentials are rejected on the staff screen', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    await openPasswordForm(page);
    await submitPassword(page, ADMIN_USERNAME, ADMIN_PASSWORD);

    await expect(status(page)).toHaveText(GENERIC_FAILURE);
    await expect(page).not.toHaveURL(/\/pos$/);

    await page.goto('/pos');
    await expect(page).toHaveURL(new RegExp(STAFF_SIGN_IN_PATH));
    await expect(
      page.getByRole('heading', { name: 'Ready for the next order.' }),
    ).toHaveCount(0);
  });

  // AC7 / edge — Failures do not reveal whether a username or PIN belongs to an
  // account: unknown username, wrong password, valid-admin, and wrong PIN all
  // surface the identical generic message.
  test('AC7: unknown username and wrong password are indistinguishable', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    await openPasswordForm(page);

    await submitPassword(page, 'no-such-staff', 'whatever-password');
    await expect(status(page)).toBeVisible();
    const unknownUserMessage = (await status(page).textContent())?.trim();
    await expect(page).not.toHaveURL(/\/pos$/);

    await usernameField(page).fill('');
    await passwordField(page).fill('');
    await submitPassword(page, STAFF_USERNAME, `${STAFF_PASSWORD}-wrong`);
    await expect(status(page)).toBeVisible();
    const wrongPasswordMessage = (await status(page).textContent())?.trim();
    await expect(page).not.toHaveURL(/\/pos$/);

    expect(unknownUserMessage).toBe(GENERIC_FAILURE);
    expect(wrongPasswordMessage).toBe(GENERIC_FAILURE);
    expect(wrongPasswordMessage).toBe(unknownUserMessage);
  });

  test('AC7: a rejected admin and a wrong PIN share the password path generic message', async ({
    page,
    context,
  }) => {
    // Valid administrator credentials (a real, existing account) are refused
    // with the same message used for an unknown account — no enumeration.
    await page.goto(STAFF_SIGN_IN_PATH);
    await openPasswordForm(page);
    await submitPassword(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(status(page)).toBeVisible();
    const adminMessage = (await status(page).textContent())?.trim();

    // A wrong PIN for a real remembered staff member yields the same message.
    await rememberStaffOnDevice(page, context);
    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();
    const wrongPin = STAFF_PIN === '9999' ? '1111' : '9999';
    await tapPin(page, wrongPin);
    await pinSubmit(page).click();
    await expect(status(page)).toBeVisible();
    const wrongPinMessage = (await status(page).textContent())?.trim();

    expect(adminMessage).toBe(GENERIC_FAILURE);
    expect(wrongPinMessage).toBe(GENERIC_FAILURE);
    expect(wrongPinMessage).toBe(adminMessage);
  });

  // Edge — After the throttle threshold (ADR 0002: 5 failures per identity per
  // device), further attempts are paused with a generic, non-identifying
  // message that says when another attempt may be made.
  test('edge: repeated failures throttle with a non-identifying message', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    await openPasswordForm(page);
    await usernameField(page).fill(STAFF_USERNAME);
    await passwordField(page).fill(`${STAFF_PASSWORD}-wrong`);

    const submit = page.getByRole('button', { name: 'Sign in' });

    // First five failures show the ordinary generic error.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await submit.click();
      await expect(status(page)).toHaveText(GENERIC_FAILURE);
      await expect(submit).toBeEnabled();
    }

    // The sixth attempt is throttled: a distinct, time-boxed message that still
    // does not reveal whether the account exists.
    await submit.click();
    await expect(status(page)).toContainText(/Too many failed attempts/i);
    await expect(status(page)).toContainText(/try again in/i);
    const throttleMessage = (await status(page).textContent()) ?? '';
    expect(throttleMessage.toLowerCase()).not.toContain(
      STAFF_USERNAME.toLowerCase(),
    );
    await expect(page).not.toHaveURL(/\/pos$/);
  });
});
