import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  removeLogoutProduct,
  seedLogoutProduct,
  type SeededLogoutProduct,
} from './fixtures/logout';

/**
 * End-to-end coverage for story #226 — "Log out of administrator and staff
 * workspaces" (QA task #261).
 *
 * Every acceptance criterion is exercised through the real browser → web app →
 * NestJS API → database path. Fixtures are the seeded `admin` (ADMIN) and
 * `staff` (STAFF) users from apps/api/prisma/seed.ts plus one uniquely named
 * product seeded per run (see fixtures/logout.ts); credentials default to the
 * seed values and are overridable via E2E_* env vars.
 *
 * Three things shape how these tests are written:
 *
 *  1. **Absence is asserted on real data, not on the URL.** Criteria 3 and 4
 *     say protected information must no longer be *shown*. A redirect that
 *     fires after the protected page has painted still leaked it, so each
 *     post-logout assertion names something concrete that was demonstrably on
 *     screen a moment earlier — the seeded product for the administrator, the
 *     signed-in staff display name and the point-of-sale navigation for staff.
 *
 *  2. **Criterion 5 is three independent tests.** `goBack()` (a bfcache
 *     restore, where the page is resurrected rather than re-rendered),
 *     `reload()` of a protected URL, and a direct navigation to a protected URL
 *     fail for different reasons and are covered separately for both roles.
 *
 *  3. **The cross-tab boundary is the server, not the screen.** ADR 0011 §3
 *     makes the 401 authoritative and treats the `BroadcastChannel` /
 *     `visibilitychange` flip as best-effort promptness. The load-bearing
 *     assertion in the cross-tab test is therefore that the second tab cannot
 *     perform a protected request; the visible flip is asserted too, but as the
 *     UX consequence rather than as the security gate.
 *
 * Deliberately NOT tested, per ADR 0011 and the story's scope notes:
 *  - Token revocation. ADR 0011 §2 declines revocation in v1: a token captured
 *    before logout stays valid until expiry (≤ 8 h). Asserting otherwise would
 *    encode the opposite of the accepted decision.
 *  - Automatic / inactivity logout — out of this story's scope.
 *  - Survival of the ADR 0007 device cashier selection across logout — intended
 *    behaviour, and covered by the active-cashier suite.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const STAFF_PIN = process.env.E2E_STAFF_PIN ?? '0000';
const STAFF_DISPLAY_NAME = process.env.E2E_STAFF_DISPLAY_NAME ?? 'Coffee Shop Staff';

const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const ADMIN_SIGN_IN_PATH = '/sign-in';
const STAFF_SIGN_IN_PATH = '/staff/sign-in';
const ADMIN_PROTECTED_PATH = '/catalog/products';
const STAFF_PROTECTED_PATH = '/pos/order';

const REMEMBERED_STAFF_KEY = 'ucm.staff-auth.remembered-staff.v1';
const SIGNED_OUT_NOTICE = 'You have been signed out.';
const SESSION_ENDED_NOTICE = 'Your session ended. Sign in to continue.';

/**
 * A second remembered staff member that no sign-in in this suite ever touches.
 * Criterion 8 ("logout does not remove or add any other remembered staff
 * names") is only testable against a picker that holds someone else too — a
 * single-name test passes even against an implementation that wipes the list
 * and re-adds the person who just signed out.
 */
const DECOY_STAFF = {
  id: '00000000-0000-4000-8000-0000000000d1',
  displayName: 'QA Decoy Colleague',
};

// ---- shared locators --------------------------------------------------------

function adminSignOutButton(page: Page) {
  return page.locator('.admin-sidebar-user').getByRole('button', {
    name: /Sign(ing)? out/,
  });
}

function staffSignOutTrigger(page: Page) {
  return page.locator('.staff-context-actions').getByRole('button', {
    name: /Sign(ing)? out/,
  });
}

function logoutDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Sign out of this session?' });
}

function staffPickerTiles(page: Page) {
  return page.locator('.staff-picker-tile');
}

// ---- sign-in / sign-out helpers --------------------------------------------

async function signInAsAdmin(page: Page) {
  await page.goto(ADMIN_SIGN_IN_PATH);
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(adminSignOutButton(page)).toBeVisible();
}

async function signInAsStaff(page: Page) {
  await page.goto(STAFF_SIGN_IN_PATH);
  await page
    .getByRole('button', { name: 'Use Username and Password' })
    .click();
  const username = page.locator('#staff-username');
  // The form autofocuses its first field inside a requestAnimationFrame; typing
  // before that lands re-routes the password into the username box.
  await expect(username).toBeFocused();
  await username.fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await expect(
    page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
  ).toBeVisible();
}

/** Administrator sign-out: a single control, no confirmation (by design). */
async function signOutAsAdmin(page: Page) {
  await adminSignOutButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${ADMIN_SIGN_IN_PATH}$`));
}

/** Staff sign-out: the control opens a confirmation dialog first (by design). */
async function signOutAsStaff(page: Page) {
  await staffSignOutTrigger(page).click();
  const dialog = logoutDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(new RegExp(`${STAFF_SIGN_IN_PATH}$`));
}

/** Ask the API, with this context's cookies, whether a session still exists. */
async function sessionStatus(context: BrowserContext): Promise<number> {
  const response = await context.request.get(`${API_BASE_URL}/auth/session`, {
    failOnStatusCode: false,
  });
  return response.status();
}

/** Put a second, untouched staff member in the device's remembered list. */
async function seedDecoyRememberedStaff(context: BrowserContext) {
  await context.addInitScript(
    ([key, decoy]) => {
      try {
        if (!window.localStorage.getItem(key as string)) {
          window.localStorage.setItem(key as string, JSON.stringify([decoy]));
        }
      } catch {
        // A context without storage access cannot run this suite anyway.
      }
    },
    [REMEMBERED_STAFF_KEY, DECOY_STAFF] as const,
  );
}

async function readRememberedStaff(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw
      ? (JSON.parse(raw) as { id: string; displayName: string }[])
      : [];
  }, REMEMBERED_STAFF_KEY);
}

/** Filter the administrator product list down to this run's seeded row. */
async function findSeededProduct(page: Page, seeded: SeededLogoutProduct) {
  await page.goto(ADMIN_PROTECTED_PATH);
  await page.getByLabel('Search product name').fill(seeded.productName);
  await expect(page.getByText(seeded.productName)).toBeVisible();
}

// ---- assertions on what must no longer be visible ---------------------------

async function expectAdminSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(`\\${ADMIN_SIGN_IN_PATH}`));
  // Specifically the ADMINISTRATOR sign-in screen — both landings are sign-in
  // screens, so a generic "a form is visible" check passes for the wrong one.
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Administrators only')).toBeVisible();
  await expect(page.locator('#username')).toBeVisible();
  // ...and not the staff one.
  await expect(page.locator('#staff-username')).toHaveCount(0);
}

async function expectStaffSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${STAFF_SIGN_IN_PATH}`));
  await expect(page.getByText('Staff sign-in')).toBeVisible();
  // ...and not the administrator one.
  await expect(page.getByText('Administrator access')).toHaveCount(0);
  await expect(page.locator('#username')).toHaveCount(0);
}

async function expectNoAdminContent(page: Page, seeded: SeededLogoutProduct) {
  await expect(page.getByText(seeded.productName)).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Administrator navigation' }),
  ).toHaveCount(0);
  await expect(page.locator('.admin-sidebar-user')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Products' })).toHaveCount(0);
}

async function expectNoStaffContent(page: Page) {
  await expect(
    page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Staff workspace' }),
  ).toHaveCount(0);
  await expect(page.locator('.staff-inventory-shell')).toHaveCount(0);
}

// -----------------------------------------------------------------------------

test.describe('Logout from the administrator and point-of-sale workspaces (story #226)', () => {
  let seeded: SeededLogoutProduct;

  test.beforeAll(() => {
    seeded = seedLogoutProduct();
  });

  test.afterAll(() => {
    removeLogoutProduct(seeded);
  });

  // AC1 — a signed-in administrator can find and use a logout option from the
  // administrator workspace.
  test('AC1: the administrator workspace offers a working sign-out control', async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);

    const control = adminSignOutButton(page);
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    // Reachable from any administrator screen, not just the landing one.
    await page.goto(ADMIN_PROTECTED_PATH);
    await expect(adminSignOutButton(page)).toBeVisible();

    expect(await sessionStatus(context)).toBe(200);
    await signOutAsAdmin(page);
    expect(await sessionStatus(context)).toBe(401);
  });

  // AC2 — a signed-in staff member can find and use a logout option from the
  // point-of-sale workspace.
  test('AC2: the point-of-sale workspace offers a working sign-out control', async ({
    page,
    context,
  }) => {
    await signInAsStaff(page);

    const trigger = staffSignOutTrigger(page);
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeEnabled();

    // The staff control confirms first — and says, in words, that ending the
    // session is not a till handover.
    await trigger.click();
    const dialog = logoutDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('The active cashier on this till stays');

    // Cancelling leaves the session intact.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/pos(\/order)?$/);
    expect(await sessionStatus(context)).toBe(200);

    await signOutAsStaff(page);
    expect(await sessionStatus(context)).toBe(401);
  });

  // AC3 — after an administrator logs out, administrator-only information is no
  // longer shown and the administrator sign-in screen is displayed.
  test('AC3: administrator logout hides administrator-only data and lands on the administrator sign-in screen', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    // Real, seeded, administrator-only data is genuinely on screen first.
    await findSeededProduct(page, seeded);

    await signOutAsAdmin(page);

    await expectAdminSignInScreen(page);
    await expectNoAdminContent(page, seeded);
    await expect(page.getByText(SIGNED_OUT_NOTICE)).toBeVisible();
  });

  // AC4 — after a staff member logs out, point-of-sale information is no longer
  // shown and the staff sign-in screen is displayed.
  test('AC4: staff logout hides point-of-sale data and lands on the staff sign-in screen', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await expect(
      page.getByRole('navigation', { name: 'Staff workspace' }),
    ).toBeVisible();

    await signOutAsStaff(page);

    await expectStaffSignInScreen(page);
    await expectNoStaffContent(page);
    await expect(page.getByText(SIGNED_OUT_NOTICE)).toBeVisible();
  });

  // AC5.1 — browser Back after logout must not restore the protected page.
  // This is the bfcache path: the page is restored, not re-rendered, so the
  // `pageshow` revalidation is what has to catch it.
  test('AC5: browser Back after administrator logout does not restore the workspace', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await findSeededProduct(page, seeded);
    await signOutAsAdmin(page);

    await page.goBack();

    await expectNoAdminContent(page, seeded);
    await expectAdminSignInScreen(page);
  });

  test('AC5: browser Back after staff logout does not restore the workspace', async ({
    page,
  }) => {
    await signInAsStaff(page);
    // Two protected entries, so Back has somewhere real to go: signing in
    // replaces the sign-in entry rather than pushing onto it, and the
    // post-logout redirect replaces as well, so a single-page history would
    // step back past the app entirely and prove nothing.
    await page.goto('/pos/orders');
    await expect(
      page.getByRole('navigation', { name: 'Staff workspace' }),
    ).toBeVisible();
    await page.goto(STAFF_PROTECTED_PATH);
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();
    await signOutAsStaff(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/pos\/orders|\/staff\/sign-in/);

    await expectNoStaffContent(page);
    await expectStaffSignInScreen(page);
  });

  // AC5.2 — reloading a previously open protected page after logout.
  test('AC5: reloading a protected administrator page after logout requires signing in again', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await findSeededProduct(page, seeded);

    // Sign out from the protected page itself, then reload it.
    await signOutAsAdmin(page);
    await page.goto(ADMIN_PROTECTED_PATH);
    await page.reload();

    await expectNoAdminContent(page, seeded);
    await expectAdminSignInScreen(page);
  });

  test('AC5: reloading a protected point-of-sale page after logout requires signing in again', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await page.goto(STAFF_PROTECTED_PATH);
    await signOutAsStaff(page);

    await page.goto(STAFF_PROTECTED_PATH);
    await page.reload();

    await expectNoStaffContent(page);
    await expectStaffSignInScreen(page);
  });

  // AC5.3 — opening a protected link directly after logout.
  test('AC5: a direct protected link after logout reveals nothing and demands sign-in', async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await findSeededProduct(page, seeded);
    await signOutAsAdmin(page);

    for (const path of ['/dashboard', ADMIN_PROTECTED_PATH, '/reports']) {
      await page.goto(path);
      await expectNoAdminContent(page, seeded);
      await expect(page).toHaveURL(new RegExp(`\\${ADMIN_SIGN_IN_PATH}`));
    }

    await page.goto(STAFF_PROTECTED_PATH);
    await expectNoStaffContent(page);
    await expectStaffSignInScreen(page);

    // The server agrees, not just the router.
    expect(await sessionStatus(context)).toBe(401);
  });

  // AC6 — logging out in one tab ends access for other open tabs in the same
  // browser. Both pages share ONE context: a second context would have its own
  // cookie jar and would prove nothing while looking green.
  test('AC6: logging out in one tab ends access in another tab of the same browser', async ({
    page,
    context,
  }) => {
    await signInAsStaff(page);

    const otherTab = await context.newPage();
    await otherTab.goto(STAFF_PROTECTED_PATH);
    await expect(
      otherTab.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();

    await signOutAsStaff(page);

    // (a) The load-bearing assertion: the second tab can no longer perform a
    // protected request. This is the server-side boundary ADR 0011 §3 makes
    // authoritative, and it holds regardless of what the tab is showing.
    await expect
      .poll(async () => {
        const response = await otherTab.request.get(
          `${API_BASE_URL}/auth/session`,
          { failOnStatusCode: false },
        );
        return response.status();
      })
      .toBe(401);

    // (b) The UX consequence: the tab does not allow further protected activity
    // and ends up at sign-in. Promptness is best-effort (BroadcastChannel /
    // visibilitychange), so a reload is an acceptable trigger per the criterion
    // — "when next used or reloaded".
    await otherTab.bringToFront();
    await otherTab.reload();
    await expectNoStaffContent(otherTab);
    await expectStaffSignInScreen(otherTab);
    await otherTab.close();
  });

  test('AC6: a stale administrator tab is turned away on its next protected use', async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);

    const otherTab = await context.newPage();
    await otherTab.goto(ADMIN_PROTECTED_PATH);
    await expect(
      otherTab.getByRole('heading', { name: 'Products' }),
    ).toBeVisible();

    await signOutAsAdmin(page);

    await otherTab.bringToFront();
    // Prompt teardown is best-effort but is what the design promises here, so
    // it is asserted: the stale tab flips itself to sign-in without a reload.
    await expect(otherTab).toHaveURL(
      new RegExp(`\\${ADMIN_SIGN_IN_PATH}`),
      { timeout: 15_000 },
    );
    await expect(otherTab.getByText(SESSION_ENDED_NOTICE)).toBeVisible();
    await expectNoAdminContent(otherTab, seeded);
    await otherTab.close();
  });

  // AC7 — a remembered staff member who logs out stays available in that
  // browser's picker for a subsequent PIN sign-in.
  // AC8 — logout removes and adds no other remembered staff names.
  test('AC7/AC8: logout leaves the remembered-staff picker exactly as it was', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await seedDecoyRememberedStaff(context);
    const page = await context.newPage();

    await signInAsStaff(page);

    const before = await readRememberedStaff(page);
    expect(before.map((entry) => entry.displayName)).toEqual([
      STAFF_DISPLAY_NAME,
      DECOY_STAFF.displayName,
    ]);

    await signOutAsStaff(page);

    // AC8 — same names, same count, same order. Nothing removed, nothing added.
    const after = await readRememberedStaff(page);
    expect(after).toEqual(before);

    // AC7 — and the picker really offers both for PIN entry.
    await expect(staffPickerTiles(page)).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(DECOY_STAFF.displayName) }),
    ).toBeVisible();

    // AC7 — "available for subsequent PIN sign-in" means it actually works.
    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();
    for (const digit of STAFF_PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/pos(\/order)?$/);
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();

    // A second logout still leaves the list untouched.
    await signOutAsStaff(page);
    expect(await readRememberedStaff(page)).toEqual(before);

    await context.close();
  });

  // Regression guard — #260 routed eight API clients through one shared 401
  // handler. The most plausible breakage is a bad credential being swallowed as
  // a global "you were signed out" instead of surfacing on the form.
  test('guard: a wrong administrator password still shows the inline sign-in error', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await signOutAsAdmin(page);

    await page.locator('#username').fill(ADMIN_USERNAME);
    await page.locator('#password').fill(`${ADMIN_PASSWORD}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText(
      'Invalid username or password.',
    );
    await expect(page).toHaveURL(new RegExp(`\\${ADMIN_SIGN_IN_PATH}`));
    // The inline failure is not reported as a session ending.
    await expect(page.getByText(SESSION_ENDED_NOTICE)).toHaveCount(0);
  });

  test('guard: a wrong staff PIN after logout still shows the inline sign-in error', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await signOutAsStaff(page);

    await page
      .getByRole('button', { name: new RegExp(STAFF_DISPLAY_NAME) })
      .click();
    const wrongPin = STAFF_PIN === '9999' ? '1111' : '9999';
    for (const digit of wrongPin) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText(
      'We could not sign you in. Check your details and try again.',
    );
    await expect(page).not.toHaveURL(/\/pos(\/order)?$/);
    await expect(page.getByText(SESSION_ENDED_NOTICE)).toHaveCount(0);
  });

  // "Must sign in again" entails that signing in again still works.
  test('guard: signing back in after logout works in the same tab, for both roles', async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await signOutAsAdmin(page);
    await signInAsAdmin(page);
    await findSeededProduct(page, seeded);
    expect(await sessionStatus(context)).toBe(200);

    await signOutAsAdmin(page);
    await signInAsStaff(page);
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();
    await signOutAsStaff(page);
    expect(await sessionStatus(context)).toBe(401);
  });

  // Idempotence — signing out when already signed out must not error or leave a
  // half-built screen. This covers the repeat-click / second-tab-control case.
  test('guard: logging out when already logged out is harmless', async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await signOutAsAdmin(page);

    const repeat = await context.request.post(`${API_BASE_URL}/auth/logout`, {
      failOnStatusCode: false,
    });
    expect(repeat.status()).toBe(204);

    // The sign-in screen is intact and still usable afterwards.
    await page.reload();
    await expectAdminSignInScreen(page);
    await expectNoAdminContent(page, seeded);
    await signInAsAdmin(page);
    expect(await sessionStatus(context)).toBe(200);
  });
});
