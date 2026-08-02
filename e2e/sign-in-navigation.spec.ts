import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #227 — "Navigate from administrator sign-in to
 * staff sign-in" (QA Task #230).
 *
 * The story adds the missing half of a pair of affordances: the staff sign-in
 * screen already links across to administrator sign-in (`.admin-sign-in-link`,
 * a plain `<a href>`), and #227 adds the mirror "Staff sign-in" link to the
 * administrator screen (a router `<Link>`). Because the two are implemented
 * with different navigation mechanics, every assertion here is on the resulting
 * URL and on the destination screen's own content — never on how the browser
 * got there.
 *
 * Both routes are public, so the whole story is exercised signed out. That is
 * also the only state in which it is testable: `SignInPage` redirects an
 * authenticated administrator away from `/sign-in`, so the link is by design
 * not reachable with a session (explicitly out of scope per the QA task).
 *
 * `SignInPage` renders `SessionLoading` while `auth.status === 'checking'`, so
 * every navigation waits for the signed-out form before asserting on chrome.
 */

const ADMIN_SIGN_IN_PATH = '/sign-in';
const STAFF_SIGN_IN_PATH = '/staff/sign-in';

const STAFF_LINK_NAME = 'Staff sign-in';
const ADMIN_LINK_NAME = 'Administrator sign-in';

/** The link this story adds, on the administrator screen. */
function staffSignInLink(page: Page) {
  return page.getByRole('link', { name: STAFF_LINK_NAME });
}

/** The pre-existing mirror link on the staff screen. */
function adminSignInLink(page: Page) {
  return page.getByRole('link', { name: ADMIN_LINK_NAME });
}

/**
 * Wait for the administrator sign-in screen to have settled out of its
 * `SessionLoading` state — the username/password form is only rendered once
 * `auth.status` has resolved to signed out.
 */
async function expectAdminSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${ADMIN_SIGN_IN_PATH}(\\?|$)`));
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

/** Wait for the staff sign-in screen's own content, not just its URL. */
async function expectStaffSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(STAFF_SIGN_IN_PATH));
  await expect(adminSignInLink(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use Username and Password' }),
  ).toBeVisible();
  // Administrator-only chrome does not follow us across.
  await expect(page.getByText('Administrator access')).toHaveCount(0);
}

/**
 * Assert the visitor is still signed out, by the only means that actually
 * proves it: an administrator-only route still bounces to sign-in.
 */
async function expectStillSignedOut(page: Page) {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
}

/**
 * Tab forward from the top of the document until `locator` holds focus.
 * Proves keyboard reachability without hard-coding a tab-stop count, which
 * would turn any unrelated header change into a false failure.
 */
async function tabTo(page: Page, locator: ReturnType<Page['getByRole']>) {
  const MAX_TAB_STOPS = 15;
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let stop = 0; stop < MAX_TAB_STOPS; stop += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement)) {
      return stop + 1;
    }
  }
  throw new Error(
    `Element was not reachable by keyboard within ${MAX_TAB_STOPS} tab stops`,
  );
}

test.describe('Administrator ↔ staff sign-in navigation (story #227)', () => {
  // AC1 — On a cold, signed-out visit, a persistent visible text link with the
  // accessible name "Staff sign-in" is present with no prior interaction.
  test('AC1: a cold signed-out visit shows a visible "Staff sign-in" link', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    const link = staffSignInLink(page);
    // Exactly one such affordance, and it is a link (not a button or menu item).
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    // Its accessible name identifies the destination, and it is a text link —
    // the visible text carries the name rather than an icon-only label.
    await expect(link).toHaveAccessibleName(STAFF_LINK_NAME);
    await expect(link).toHaveText(STAFF_LINK_NAME);
    // Persistent: it was there on arrival, with nothing expanded or hovered.
    await expect(link).toHaveAttribute('href', STAFF_SIGN_IN_PATH);
  });

  test('AC1: the link survives a reload of the signed-out administrator screen', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);
    await expect(staffSignInLink(page)).toBeVisible();

    await page.reload();
    await expectAdminSignInScreen(page);
    await expect(staffSignInLink(page)).toBeVisible();
  });

  // AC2 — Activating the link opens staff sign-in and leaves the person signed
  // out; it submits neither sign-in form and changes no authentication state.
  test('AC2: activating "Staff sign-in" opens staff sign-in and leaves us signed out', async ({
    page,
    context,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    const cookiesBefore = await context.cookies();

    await staffSignInLink(page).click();
    await expectStaffSignInScreen(page);

    // No authentication state was created by the navigation itself.
    const cookiesAfter = await context.cookies();
    expect(cookiesAfter.map((c) => c.name).sort()).toEqual(
      cookiesBefore.map((c) => c.name).sort(),
    );
    await expectStillSignedOut(page);
  });

  test('AC2: a filled-in administrator form is not submitted by the link', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    // Credentials typed but deliberately never submitted.
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('some-password');

    await staffSignInLink(page).click();
    await expectStaffSignInScreen(page);

    // Neither a success (POS) nor a failure (sign-in error) — the form never ran.
    await expect(page).not.toHaveURL(/\/pos(\/order)?$/);
    await expect(page).not.toHaveURL(/\/dashboard/);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectStillSignedOut(page);
  });

  // AC3 — A pending post-login destination on the administrator screen is not
  // carried into the staff sign-in flow.
  test('AC3: a pending administrator destination is not carried into staff sign-in', async ({
    page,
  }) => {
    // Arrive at administrator sign-in the way a gated deep link does, so the
    // screen genuinely holds a pending destination.
    await page.goto('/reports?range=today&sort=desc');
    await expectAdminSignInScreen(page);
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
    await expect(page.getByText('Sign in to continue to')).toContainText(
      'Reports',
    );

    await staffSignInLink(page).click();
    await expectStaffSignInScreen(page);

    // The administrator destination is gone from the URL entirely.
    const staffUrl = new URL(page.url());
    expect(staffUrl.pathname).toBe(STAFF_SIGN_IN_PATH);
    expect(staffUrl.search).toBe('');
    expect(decodeURIComponent(page.url())).not.toContain('returnTo');
    expect(decodeURIComponent(page.url())).not.toContain('/reports');

    // And it does not resurface once staff sign-in actually completes: signing
    // in as staff must not land on an administrator report.
    await expect(page.getByText('Reports')).toHaveCount(0);
  });

  // AC4 — Keyboard only: reach the link by Tab, see a visible focus indicator,
  // activate with Enter.
  test('AC4: the link is reachable by Tab, shows a focus indicator, and Enter activates it', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    const link = staffSignInLink(page);

    // Focus indicator is only drawn on :focus-visible, so measure the
    // un-focused baseline first to prove the keyboard focus actually changes it.
    const baselineOutline = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });

    await tabTo(page, link);
    await expect(link).toBeFocused();

    const focusedOutline = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        matchesFocusVisible: el.matches(':focus-visible'),
      };
    });

    // Keyboard focus puts it in :focus-visible and draws a real outline.
    expect(focusedOutline.matchesFocusVisible).toBe(true);
    expect(focusedOutline.style).not.toBe('none');
    expect(Number.parseFloat(focusedOutline.width)).toBeGreaterThan(0);
    expect(focusedOutline).not.toMatchObject(baselineOutline);

    // Enter — not a click — performs the navigation.
    await page.keyboard.press('Enter');
    await expectStaffSignInScreen(page);
    await expectStillSignedOut(page);
  });

  // AC5 — Browser Back returns to the administrator sign-in screen with its
  // sign-in form available.
  test('AC5: browser Back returns to a usable administrator sign-in screen', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    await staffSignInLink(page).click();
    await expectStaffSignInScreen(page);

    await page.goBack();
    await expectAdminSignInScreen(page);
    // "Available" means actually usable, not merely rendered.
    await expect(page.locator('#username')).toBeEditable();
    await expect(page.locator('#password')).toBeEditable();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    // And the affordance itself came back with the screen.
    await expect(staffSignInLink(page)).toBeVisible();
  });

  // AC6 — The existing "Administrator sign-in" option on the staff screen still
  // works and opens a usable administrator sign-in screen.
  test('AC6: the staff screen\'s "Administrator sign-in" option still works', async ({
    page,
  }) => {
    await page.goto(STAFF_SIGN_IN_PATH);
    await expectStaffSignInScreen(page);

    const link = adminSignInLink(page);
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(ADMIN_LINK_NAME);

    await link.click();
    await expectAdminSignInScreen(page);
    await expect(page.locator('#username')).toBeEditable();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  // Round trip — the pair of affordances is exercised in one continuous flow,
  // so the two halves are shown to compose rather than each working in isolation.
  test('round trip: administrator → staff → administrator in one flow', async ({
    page,
  }) => {
    await page.goto(ADMIN_SIGN_IN_PATH);
    await expectAdminSignInScreen(page);

    await staffSignInLink(page).click();
    await expectStaffSignInScreen(page);

    await adminSignInLink(page).click();
    await expectAdminSignInScreen(page);
    await expect(staffSignInLink(page)).toBeVisible();

    // Back where we started, and still signed out the whole way.
    await expectStillSignedOut(page);
  });
});
