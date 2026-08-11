import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  removeLogoutProduct,
  seedLogoutProduct,
  type SeededLogoutProduct,
} from './fixtures/logout';

/**
 * End-to-end coverage for story #274 — "Keep sign-out available after
 * refreshing protected workspaces" (QA task #282).
 *
 * ## What this suite can and cannot prove
 *
 * The defect behind #274 lives in the delivery layer, not the application:
 * CloudFront cached the SPA entry document *per URL path* and the deploy
 * invalidated only `/` and `/index.html`, so every deep path kept serving the
 * previous build (a pre-logout app) for up to a day. The dev task that fixed it
 * (#281) changed `deploy/nginx.conf` and the deploy invalidation only.
 *
 * Playwright cannot see that defect. This suite runs against the Vite dev
 * server (see `e2e/playwright.config.ts`), which serves `index.html` for every
 * path with no CDN in front, so these tests pass both before and after the
 * fix. **The edge-cache criterion is verified by the post-deploy `curl` check
 * specified in #281, not here.**
 *
 * What this suite *is* worth: it is the regression guard for the application
 * property the delivery fix exists to expose — that both shells render an
 * enabled sign-out control on a cold, deep entry with no visit to `/` first,
 * and keep rendering it across refreshes. If that ever regresses in app code,
 * fixing the CDN again would not help, and this file is what catches it.
 *
 * ## How "cold entry" is made real
 *
 * Signing in and then clicking through to `/catalog/products` is the exact
 * navigation that masks the bug: the entry document for `/` is already loaded
 * and the router does the rest. So each test here signs in ONCE per role in
 * `beforeAll`, captures the resulting `storageState`, and every test then opens
 * a **brand-new browser context** from that state and makes `page.goto(deep
 * path)` its first navigation — the story's "directly opening its saved address
 * in a new browser context", with no `/` in the history at any point.
 *
 * ## The intermediate-state guard
 *
 * One acceptance criterion is about a state that only exists for a few frames:
 * "during session validation a loading state may be shown, but an otherwise
 * usable workspace screen is not shown without its enabled sign-out control".
 * `AuthContext` starts at `checking` on every mount and the shell paints after
 * `GET /auth/session` resolves, so a plain `expect(...).toBeVisible()` samples
 * one instant and would miss a shell that painted control-less for two frames.
 * `installShellIntegrityObserver()` therefore runs a `MutationObserver` inside
 * the page from document start, recording every DOM state in which a workspace
 * shell exists without its sign-out control. Every test drains that log.
 *
 * Presence, not enabled-ness, is what the observer records: the control is
 * legitimately disabled for the moment it spends in its `Signing out…` state,
 * and asserting otherwise would fail on correct behaviour. "Enabled" is
 * asserted separately once the screen has settled, which is what the criterion
 * actually bounds it to.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const STAFF_DISPLAY_NAME = process.env.E2E_STAFF_DISPLAY_NAME ?? 'Coffee Shop Staff';

const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const ADMIN_SIGN_IN_PATH = '/sign-in';
const STAFF_SIGN_IN_PATH = '/staff/sign-in';

/**
 * The three representative protected screens named in the story's first
 * acceptance criterion. `/pos/order` rather than `/pos`: the index route
 * redirects, and a redirect is a second navigation — cold entry has to land on
 * the real address.
 */
const ADMIN_DASHBOARD_PATH = '/dashboard';
const ADMIN_CATALOG_PATH = '/catalog/products';
const STAFF_ORDER_PATH = '/pos/order';

const ADMIN_DEEP_PATHS = [ADMIN_DASHBOARD_PATH, ADMIN_CATALOG_PATH];

/** Shapes the story calls out because they are what actually gets bookmarked. */
const QUERY_AND_FRAGMENT_SUFFIXES = ['?ref=qa-274', '#top', '?ref=qa-274#top'];

type Role = 'admin' | 'staff';

// ---- locators ---------------------------------------------------------------

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

function signOutButtonFor(page: Page, role: Role) {
  return role === 'admin' ? adminSignOutButton(page) : staffSignOutTrigger(page);
}

// ---- the intermediate-state observer ---------------------------------------

const SHELL_INTEGRITY_KEY = '__qa274ShellWithoutSignOut';
const SIGN_OUT_SIGHTINGS_KEY = '__qa274SignOutEverSeen';

/**
 * Record, from document start, two things:
 *
 *  - every moment at which a workspace shell is in the DOM WITHOUT its sign-out
 *    control (the positive criterion's intermediate-state guard), and
 *  - every moment at which a sign-out control is in the DOM at all (the
 *    negative criterion's guard — "does not show a usable workspace or sign-out
 *    control" is a statement about the whole load, and a control that flashes
 *    for three frames before the redirect lands has still been shown).
 *
 * Must be installed on the CONTEXT before its first navigation, or the window
 * it exists to watch has already passed.
 */
async function installShellIntegrityObserver(context: BrowserContext) {
  await context.addInitScript(([key, seenKey]: [string, string]) => {
    const violations: string[] = [];
    const sightings: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = violations;
    (window as unknown as Record<string, unknown>)[seenKey] = sightings;

    const check = () => {
      const adminShell = document.querySelector('.admin-shell');
      const adminControl = document.querySelector(
        '.admin-sidebar-user .sign-out-button',
      );
      if (adminShell && !adminControl) {
        violations.push(`admin shell without sign-out at ${location.pathname}`);
      }
      const staffShell = document.querySelector('.staff-inventory-shell');
      const staffControl = document.querySelector(
        '.staff-context-actions .sign-out-button',
      );
      if (staffShell && !staffControl) {
        violations.push(`staff shell without sign-out at ${location.pathname}`);
      }
      if (document.querySelector('.sign-out-button')) {
        sightings.push(`sign-out control at ${location.pathname}`);
      }
    };

    const start = () => {
      check();
      new MutationObserver(check).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };

    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  }, [SHELL_INTEGRITY_KEY, SIGN_OUT_SIGHTINGS_KEY] as [string, string]);
}

/** Drain one of the observer's logs, proving it was installed on the way. */
async function drainObserverLog(page: Page, key: string): Promise<string[]> {
  const entries = await page.evaluate((observerKey) => {
    const found = (window as unknown as Record<string, unknown>)[observerKey];
    if (!Array.isArray(found)) return null;
    const copy = [...found];
    found.length = 0;
    return copy as string[];
  }, key);

  expect(
    entries,
    `shell-integrity observer (${key}) was not installed on this page`,
  ).not.toBeNull();
  return entries as string[];
}

/**
 * Assert the observer saw no control-less workspace, then clear the log.
 *
 * Reading it also proves the observer is actually installed: an array that is
 * `undefined` because the init script never ran would otherwise look exactly
 * like a clean run. This suite has a standing reason to be paranoid about
 * that — the reduced-motion fixture in this repo was a silent no-op for
 * exactly this reason.
 */
async function expectNoControllessShell(page: Page) {
  expect(await drainObserverLog(page, SHELL_INTEGRITY_KEY)).toEqual([]);
  // The sightings log is drained too, so a later negative assertion is not
  // handed this test's legitimate sightings.
  await drainObserverLog(page, SIGN_OUT_SIGHTINGS_KEY);
}

/**
 * Assert no sign-out control existed at ANY point since the last drain — not
 * merely at the instant a `toHaveCount(0)` sampled. This is what makes the
 * expired/invalid-session criterion a real assertion rather than a race the
 * suite happens to win.
 */
async function expectSignOutNeverSeen(page: Page) {
  expect(await drainObserverLog(page, SIGN_OUT_SIGHTINGS_KEY)).toEqual([]);
  expect(await drainObserverLog(page, SHELL_INTEGRITY_KEY)).toEqual([]);
}

// ---- sign-in, once per role, then reused as storage state -------------------

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
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
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

/** Sign in for real, in a throwaway context, and keep only the cookie jar. */
async function captureSignedInState(browser: Browser, role: Role) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (role === 'admin') {
    await signInAsAdmin(page);
  } else {
    await signInAsStaff(page);
  }
  const state = await context.storageState();
  await context.close();
  return state;
}

// ---- cold entry -------------------------------------------------------------

interface ColdEntry {
  context: BrowserContext;
  page: Page;
}

/**
 * A new browser context carrying a valid session and nothing else, with the
 * observer armed and no navigation performed yet. The caller's first `goto` is
 * genuinely the first request the context ever makes.
 */
async function openColdContext(
  browser: Browser,
  state: Awaited<ReturnType<BrowserContext['storageState']>> | undefined,
): Promise<ColdEntry> {
  const context = await browser.newContext(
    state ? { storageState: state } : undefined,
  );
  await installShellIntegrityObserver(context);
  const page = await context.newPage();
  return { context, page };
}

/** Cold-enter `path` and assert the workspace came up with a usable sign-out. */
async function expectWorkspaceWithSignOut(page: Page, role: Role) {
  const control = signOutButtonFor(page, role);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();

  // The shell around it is the real workspace, not a stray button.
  if (role === 'admin') {
    await expect(
      page.getByRole('navigation', { name: 'Administrator navigation' }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('navigation', { name: 'Staff workspace' }),
    ).toBeVisible();
    await expect(
      page.getByText(`Signed in as ${STAFF_DISPLAY_NAME}`),
    ).toBeVisible();
  }

  await expectNoControllessShell(page);
}

// ---- assertions about the signed-out landings -------------------------------

async function expectAdminSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(`\\${ADMIN_SIGN_IN_PATH}`));
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Administrators only')).toBeVisible();
  // ...and specifically not the staff one.
  await expect(page.locator('#staff-username')).toHaveCount(0);
}

async function expectStaffSignInScreen(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${STAFF_SIGN_IN_PATH}`));
  await expect(page.getByText('Staff sign-in')).toBeVisible();
  await expect(page.locator('#username')).toHaveCount(0);
}

async function expectNoWorkspaceAnywhere(page: Page) {
  await expect(page.locator('.admin-shell')).toHaveCount(0);
  await expect(page.locator('.staff-inventory-shell')).toHaveCount(0);
  await expect(page.locator('.sign-out-button')).toHaveCount(0);
}

/** Ask the API, with this context's cookies, whether a session still exists. */
async function sessionStatus(context: BrowserContext): Promise<number> {
  const response = await context.request.get(`${API_BASE_URL}/auth/session`, {
    failOnStatusCode: false,
  });
  return response.status();
}

// -----------------------------------------------------------------------------

test.describe('Sign-out survives refresh and cold deep-link entry (story #274)', () => {
  let adminState: Awaited<ReturnType<BrowserContext['storageState']>>;
  let staffState: Awaited<ReturnType<BrowserContext['storageState']>>;
  let seeded: SeededLogoutProduct;

  test.beforeAll(async ({ browser }) => {
    seeded = seedLogoutProduct();
    adminState = await captureSignedInState(browser, 'admin');
    staffState = await captureSignedInState(browser, 'staff');
  });

  test.afterAll(() => {
    removeLogoutProduct(seeded);
  });

  // AC — "With a valid administrator session, the administrator sign-out control
  // is visible and enabled ... after either direct entry or refresh", on the
  // administrator dashboard and product catalog, reached WITHOUT visiting `/`.
  for (const path of ADMIN_DEEP_PATHS) {
    test(`AC: cold direct entry to ${path} shows an enabled administrator sign-out`, async ({
      browser,
    }) => {
      const { context, page } = await openColdContext(browser, adminState);

      // The first navigation this context ever performs is the deep one.
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expectWorkspaceWithSignOut(page, 'admin');

      // ...and the same address refreshed in place.
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expectWorkspaceWithSignOut(page, 'admin');

      await context.close();
    });
  }

  // The catalog screen again, but proving the workspace is genuinely *usable* on
  // cold entry rather than merely chrome-shaped: administrator-only seeded data
  // is on screen alongside the control.
  test('AC: cold direct entry to the product catalog renders real administrator data with the control', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, adminState);

    await page.goto(ADMIN_CATALOG_PATH);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByLabel('Search product name').fill(seeded.productName);
    await expect(page.getByText(seeded.productName)).toBeVisible();

    await expectWorkspaceWithSignOut(page, 'admin');

    await context.close();
  });

  // AC — the staff half of the same criterion.
  test(`AC: cold direct entry to ${STAFF_ORDER_PATH} shows an enabled staff sign-out`, async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, staffState);

    await page.goto(STAFF_ORDER_PATH);
    await expect(page).toHaveURL(new RegExp(`${STAFF_ORDER_PATH}$`));
    await expectWorkspaceWithSignOut(page, 'staff');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${STAFF_ORDER_PATH}$`));
    await expectWorkspaceWithSignOut(page, 'staff');

    await context.close();
  });

  // AC — "The direct-entry and refresh outcomes above also hold when a
  // representative address includes a query string or a page fragment."
  test('AC: query strings and fragments on a deep address do not cost the administrator its sign-out', async ({
    browser,
  }) => {
    for (const path of ADMIN_DEEP_PATHS) {
      for (const suffix of QUERY_AND_FRAGMENT_SUFFIXES) {
        const { context, page } = await openColdContext(browser, adminState);
        await page.goto(`${path}${suffix}`);
        // The address is preserved — a bounce through sign-in and back would
        // drop the fragment and is the failure this is watching for.
        await expect(page).toHaveURL(new RegExp(`${path}\\??`));
        await expectWorkspaceWithSignOut(page, 'admin');
        await page.reload();
        await expectWorkspaceWithSignOut(page, 'admin');
        await context.close();
      }
    }
  });

  test('AC: query strings and fragments on a deep address do not cost staff its sign-out', async ({
    browser,
  }) => {
    for (const suffix of QUERY_AND_FRAGMENT_SUFFIXES) {
      const { context, page } = await openColdContext(browser, staffState);
      await page.goto(`${STAFF_ORDER_PATH}${suffix}`);
      await expect(page).toHaveURL(new RegExp(`${STAFF_ORDER_PATH}\\??`));
      await expectWorkspaceWithSignOut(page, 'staff');
      await page.reload();
      await expectWorkspaceWithSignOut(page, 'staff');
      await context.close();
    }
  });

  // AC — "the enabled sign-out control is still present after three consecutive
  // refreshes while the session remains valid", on each representative screen.
  test('AC: three consecutive refreshes leave the control in place on every representative screen', async ({
    browser,
  }) => {
    const screens: { role: Role; path: string }[] = [
      { role: 'admin', path: ADMIN_DASHBOARD_PATH },
      { role: 'admin', path: ADMIN_CATALOG_PATH },
      { role: 'staff', path: STAFF_ORDER_PATH },
    ];

    for (const screen of screens) {
      const { context, page } = await openColdContext(
        browser,
        screen.role === 'admin' ? adminState : staffState,
      );
      await page.goto(screen.path);
      await expectWorkspaceWithSignOut(page, screen.role);

      for (let refresh = 1; refresh <= 3; refresh += 1) {
        await page.reload();
        // Waiting on the control rather than on a timeout is the point: every
        // mount starts at `checking`, so the assertion has to be what clears it.
        await expectWorkspaceWithSignOut(page, screen.role);
        expect(
          await sessionStatus(context),
          `session should still be valid after refresh ${refresh}`,
        ).toBe(200);
      }

      await context.close();
    }
  });

  // AC — "From each representative screen, using sign out ends the session and
  // shows the role-appropriate sign-in screen. Refreshing the same saved address
  // after sign-out does not restore the workspace or session."
  for (const path of ADMIN_DEEP_PATHS) {
    test(`AC: signing out from a cold-entered ${path} ends the session and does not come back on refresh`, async ({
      browser,
    }) => {
      const { context, page } = await openColdContext(browser, adminState);
      await page.goto(path);
      await expectWorkspaceWithSignOut(page, 'admin');

      await adminSignOutButton(page).click();
      await expect(page).toHaveURL(new RegExp(`${ADMIN_SIGN_IN_PATH}$`));
      await expectAdminSignInScreen(page);
      expect(await sessionStatus(context)).toBe(401);

      // Back to the same saved address, cold: no workspace, no control.
      await page.goto(path);
      await page.reload();
      await expectAdminSignInScreen(page);
      await expectNoWorkspaceAnywhere(page);
      await expect(page.getByText(seeded.productName)).toHaveCount(0);
      expect(await sessionStatus(context)).toBe(401);

      await context.close();
    });
  }

  test(`AC: signing out from a cold-entered ${STAFF_ORDER_PATH} ends the session and does not come back on refresh`, async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, staffState);
    await page.goto(STAFF_ORDER_PATH);
    await expectWorkspaceWithSignOut(page, 'staff');

    // The staff control confirms first, by design (#226).
    await staffSignOutTrigger(page).click();
    const dialog = page.getByRole('dialog', {
      name: 'Sign out of this session?',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(new RegExp(`${STAFF_SIGN_IN_PATH}$`));
    await expectStaffSignInScreen(page);
    expect(await sessionStatus(context)).toBe(401);

    await page.goto(STAFF_ORDER_PATH);
    await page.reload();
    await expectStaffSignInScreen(page);
    await expectNoWorkspaceAnywhere(page);
    expect(await sessionStatus(context)).toBe(401);

    await context.close();
  });

  // AC — "Directly opening a representative protected address with an expired or
  // invalid session shows the role-appropriate sign-in screen and does not show
  // a usable workspace or sign-out control."
  //
  // This is the guard that makes every assertion above mean something. A spec
  // that only ever asserts "sign-out is visible" stays green against a build
  // that renders the shell to a signed-out user, which would be a far worse bug
  // than the one this story fixes.
  test('AC: cold deep entry with no session lands on sign-in and never shows a sign-out control', async ({
    browser,
  }) => {
    for (const path of [...ADMIN_DEEP_PATHS, STAFF_ORDER_PATH]) {
      const { context, page } = await openColdContext(browser, undefined);
      await page.goto(path);

      if (path === STAFF_ORDER_PATH) {
        await expectStaffSignInScreen(page);
      } else {
        await expectAdminSignInScreen(page);
      }
      await expectNoWorkspaceAnywhere(page);
      // Absence held through the whole session-validation window, not just at
      // the instant the assertions above sampled.
      await expectSignOutNeverSeen(page);
      expect(await sessionStatus(context)).toBe(401);

      await context.close();
    }
  });

  test('AC: an invalid session cookie is treated as no session on cold deep entry', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, adminState);
    // Keep the cookie's shape, destroy its signature — the closest a browser
    // test gets to "expired or invalid" without waiting eight hours.
    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(
      cookies.map((cookie) => ({ ...cookie, value: `${cookie.value}tampered` })),
    );
    expect(await sessionStatus(context)).toBe(401);

    await page.goto(ADMIN_CATALOG_PATH);
    await expectAdminSignInScreen(page);
    await expectNoWorkspaceAnywhere(page);
    await expect(page.getByText(seeded.productName)).toHaveCount(0);
    await expectSignOutNeverSeen(page);

    await context.close();
  });

  // AC — "Direct entry does not expose the other role's workspace." Both shells
  // render a sign-out control, so "a sign-out control is visible" would be
  // satisfied by the WRONG workspace; this pins which one.
  test('AC: a staff session cold-entering an administrator address does not get the administrator workspace', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, staffState);

    await page.goto(ADMIN_CATALOG_PATH);

    await expect(page).toHaveURL(/\/pos(\/order)?$/);
    await expect(page.locator('.admin-shell')).toHaveCount(0);
    await expect(page.getByText(seeded.productName)).toHaveCount(0);
    // Existing authorization rules are unchanged: staff still land in their own
    // workspace, with their own working control.
    await expectWorkspaceWithSignOut(page, 'staff');

    await context.close();
  });

  test('AC: an administrator session cold-entering the point-of-sale address does not get the staff workspace', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, adminState);

    await page.goto(STAFF_ORDER_PATH);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.staff-inventory-shell')).toHaveCount(0);
    await expectWorkspaceWithSignOut(page, 'admin');

    await context.close();
  });

  // Not an acceptance criterion — the story explicitly scopes unknown addresses
  // out. It is kept as a guard because the administrator catch-all renders
  // `AdminPage` *inside* `AdminLayout`, so a regression there would leave a
  // signed-in administrator on a real-looking screen with no way out.
  test('guard: the administrator catch-all route still carries the sign-out control', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, adminState);

    await page.goto('/no-such-admin-screen-274');
    await expect(
      page.getByRole('heading', { name: 'Administrator workspace' }),
    ).toBeVisible();
    await expectWorkspaceWithSignOut(page, 'admin');

    await page.reload();
    await expectWorkspaceWithSignOut(page, 'admin');

    await context.close();
  });

  // The story's "reaching it by first visiting the main application address
  // does not satisfy this criterion" cuts both ways: the client-side route is
  // asserted here too, so a future regression can be attributed to cold entry
  // specifically rather than to sign-out being broken everywhere.
  test('guard: the control is equally present when the same screen is reached by navigating from the root', async ({
    browser,
  }) => {
    const { context, page } = await openColdContext(browser, adminState);

    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectWorkspaceWithSignOut(page, 'admin');

    await page
      .getByRole('navigation', { name: 'Administrator navigation' })
      .getByRole('link', { name: 'Products' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${ADMIN_CATALOG_PATH}$`));
    await expectWorkspaceWithSignOut(page, 'admin');

    await context.close();
  });
});
