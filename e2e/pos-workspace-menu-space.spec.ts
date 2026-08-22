import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  clearPreviousWorkspaceFixtures,
  closeWorkspaceDay,
  openWorkspaceDay,
  reopenWorkspaceDay,
  resetWorkspaceWorld,
  seedWorkspaceCatalog,
  seedWorkspaceOrders,
  seedWorkspaceStaff,
  seedWorkspaceStockItems,
  shopToday,
  type SeededWorkspaceCatalog,
  type SeededWorkspaceDay,
  type SeededWorkspaceStaff,
} from './fixtures/pos-workspace-space';

/**
 * End-to-end coverage for story #349 — "Use the full POS workspace when the
 * menu is hidden" (QA task #362).
 *
 * This is a geometry story, so almost nothing here asserts on visibility alone.
 * Every criterion that says "expands", "moves up", "reaches the bottom" or
 * "does not accumulate" is asserted as arithmetic over measured bounding boxes,
 * to the 2 CSS pixel tolerance the acceptance criteria state. A spec that only
 * checked `aria-expanded` and that the chrome disappears would have passed on
 * the reported bug — the header always did shrink; the workspace just did not
 * follow it.
 *
 * Anchors, fixed during In Preparation and repeated here so they are not
 * silently re-invented:
 *
 *  - "the point-of-sale menu"        -> `#staff-workspace-chrome`
 *  - "the workspace header"          -> `header.staff-workspace-header`
 *  - "the operational area/content"  -> `main#staff-main` for the current route
 *  - "the saved preference"          -> localStorage `ucm.pos.nav-visible.v1`
 *
 * The five in-scope screens (AC2) are Take Order `/pos/order` (the only
 * viewport-fitted one), and the flow-height Order History `/pos/orders`, Stock
 * Counts `/pos/opening`, Cash & Expenses `/pos/cash` and Trading Day
 * `/pos/close`.
 *
 * Serial: the suite resets the trading-day world once and every test shares the
 * seeded day, catalog, orders and stock items. Nothing here mutates them.
 */

test.describe.configure({ mode: 'serial' });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;

/** The tolerance every geometry criterion on #349 is written to. */
const TOLERANCE_PX = 2;

const NAV_VISIBILITY_KEY = 'ucm.pos.nav-visible.v1';

/** Desktop and tablet POS widths. Both are above the 767px breakpoint (AC3). */
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
/** Just above the narrow breakpoint, where the fitted layout still applies. */
const NARROW_DESKTOP = { width: 800, height: 900 };
/** Below it, where Take Order is stacked and document-scrolling (AC8). */
const PHONE = { width: 390, height: 844 };

interface ScreenUnderTest {
  name: string;
  path: string;
  /** The element that proves the route rendered, not just that the shell did. */
  ready: (page: Page) => Locator;
}

const TAKE_ORDER: ScreenUnderTest = {
  name: 'Take Order',
  path: '/pos/order',
  ready: (page) => page.getByRole('heading', { name: 'Take order' }),
};

const FLOW_SCREENS: ScreenUnderTest[] = [
  {
    name: 'Order History',
    path: '/pos/orders',
    ready: (page) => page.locator('.staff-order-filters'),
  },
  {
    name: 'Stock Counts',
    path: '/pos/opening',
    ready: (page) => page.locator('.staff-count-groups'),
  },
  {
    name: 'Cash & Expenses',
    path: '/pos/cash',
    ready: (page) => page.locator('#cash-amount'),
  },
  {
    name: 'Trading Day',
    path: '/pos/close',
    ready: (page) => page.getByRole('button', { name: 'Close day' }),
  },
];

let staffMember: SeededWorkspaceStaff;
let day: SeededWorkspaceDay;
let catalog: SeededWorkspaceCatalog;

test.beforeAll(() => {
  resetWorkspaceWorld();
  clearPreviousWorkspaceFixtures();
  staffMember = seedWorkspaceStaff(`QA 349 Opener ${RUN}`);
  day = openWorkspaceDay({
    businessDate: shopToday(),
    openedByStaffMemberId: staffMember.id,
  });
  catalog = seedWorkspaceCatalog(RUN);
  seedWorkspaceStockItems(RUN);
  seedWorkspaceOrders({
    tradingDayId: day.id,
    variantIds: catalog.variantIds,
    cashierName: staffMember.displayName,
  });
});

test.afterAll(() => {
  // Leave the shared catalog no larger than this suite found it.
  clearPreviousWorkspaceFixtures();
});

// ---------------------------------------------------------------------------
// Page objects
// ---------------------------------------------------------------------------

function menuToggle(page: Page): Locator {
  return page.locator('button.staff-workspace-nav-toggle');
}

function workspaceChrome(page: Page): Locator {
  return page.locator('#staff-workspace-chrome');
}

function operationalArea(page: Page): Locator {
  return page.locator('main#staff-main');
}

/**
 * Take Order's primary order action — "Charge ₱x", which is present for an
 * empty draft as well as a filled one, unlike the "Park order" label beside it.
 */
function orderAction(page: Page): Locator {
  return page.locator('.current-order-actions button.is-primary');
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

async function gotoScreen(page: Page, screen: ScreenUnderTest): Promise<void> {
  await page.goto(screen.path);
  await expect(screen.ready(page)).toBeVisible();
  await settle(page);
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface Geometry {
  headerHeight: number;
  headerBottom: number;
  mainTop: number;
  mainBottom: number;
  mainHeight: number;
  viewportHeight: number;
  documentScrollHeight: number;
  documentClientHeight: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  chromeHidden: boolean;
}

/**
 * Wait until the shell has stopped moving.
 *
 * Reduced motion is emulated for every test, but a layout change still lands
 * over a frame or two. Measuring before it settles would read as random
 * sub-pixel drift against a 2px tolerance, so the header rect must repeat
 * across consecutive animation frames before anything is measured.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const header = document.querySelector('header.staff-workspace-header');
    if (!header) return;
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let previous = -1;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await frame();
      const height = header.getBoundingClientRect().height;
      if (Math.abs(height - previous) < 0.01) return;
      previous = height;
    }
  });
}

/**
 * Measure from the top of the document.
 *
 * The header is `position: sticky`, so every "the content sits under the
 * header" and "the content moved up by the header delta" claim is only
 * meaningful at scroll offset 0. Tests that scroll do so after measuring.
 */
async function measure(page: Page): Promise<Geometry> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  return page.evaluate(() => {
    const header = document.querySelector('header.staff-workspace-header')!;
    const main = document.querySelector('main#staff-main')!;
    const chrome = document.querySelector('#staff-workspace-chrome');
    const headerRect = header.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      headerHeight: headerRect.height,
      headerBottom: headerRect.bottom,
      mainTop: mainRect.top,
      mainBottom: mainRect.bottom,
      mainHeight: mainRect.height,
      viewportHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      chromeHidden: chrome === null || (chrome as HTMLElement).hidden,
    };
  });
}

function expectClose(
  actual: number,
  expected: number,
  what: string,
): void {
  expect(
    Math.abs(actual - expected),
    `${what}: expected ${expected.toFixed(2)}px, measured ${actual.toFixed(2)}px`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
}

// ---------------------------------------------------------------------------
// The menu itself
// ---------------------------------------------------------------------------

async function setMenu(page: Page, visible: boolean): Promise<void> {
  const toggle = menuToggle(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute('aria-expanded')) === String(visible)) {
    await settle(page);
    return;
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(visible));
  await expect(toggle).toHaveText(visible ? 'Hide menu' : 'Show menu');
  if (visible) {
    await expect(workspaceChrome(page)).toBeVisible();
  } else {
    await expect(workspaceChrome(page)).toBeHidden();
  }
  await settle(page);
}

/** Measure the current screen in the shown state and then the hidden state. */
async function measureBothStates(
  page: Page,
): Promise<{ shown: Geometry; hidden: Geometry; headerDelta: number }> {
  await setMenu(page, true);
  const shown = await measure(page);
  await setMenu(page, false);
  const hidden = await measure(page);
  const headerDelta = shown.headerHeight - hidden.headerHeight;
  // Guard the guard: if the header did not shrink, every downstream assertion
  // would pass vacuously and the suite would report a green on a broken menu.
  expect(
    headerDelta,
    'hiding the menu must actually shrink the workspace header',
  ).toBeGreaterThan(10);
  return { shown, hidden, headerDelta };
}

/**
 * Is this element the thing a finger would hit at its own centre?
 *
 * The sticky header overlaps rather than clips, so "the control is in the DOM
 * and has a box" is not the criterion — AC6 is that the top bar does not cover
 * it. `elementFromPoint` is the only honest answer to that.
 */
async function expectHittable(control: Locator, what: string): Promise<void> {
  await expect(control, `${what} should be visible`).toBeVisible();
  const covered = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 'has no box';
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) {
      return 'centre is outside the viewport';
    }
    const hit = document.elementFromPoint(x, y);
    if (hit === null) return 'nothing is painted at its centre';
    if (hit === element || element.contains(hit) || hit.contains(element)) {
      return null;
    }
    const header = document.querySelector('header.staff-workspace-header');
    const blocker = header?.contains(hit)
      ? 'the workspace header'
      : `<${hit.tagName.toLowerCase()} class="${hit.className}">`;
    return `covered by ${blocker}`;
  });
  expect(covered, `${what} should be reachable, but it is ${covered}`).toBeNull();
}

// ---------------------------------------------------------------------------
// AC1 — the toggle keeps working, and keeps its accessible wiring
// ---------------------------------------------------------------------------

test.describe('The menu toggle', () => {
  test.use({ viewport: DESKTOP });

  test('hides and shows the menu, and stays visible and usable in both states', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, TAKE_ORDER);

    const toggle = menuToggle(page);
    await expect(toggle).toHaveText('Hide menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'staff-workspace-chrome');
    await expect(workspaceChrome(page)).toBeVisible();
    await expectHittable(toggle, 'the menu toggle with the menu shown');

    await setMenu(page, false);
    await expect(toggle).toHaveText('Show menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(workspaceChrome(page)).toBeHidden();
    await expectHittable(toggle, 'the menu toggle with the menu hidden');

    await setMenu(page, true);
    await expect(workspaceChrome(page)).toBeVisible();
    await expect(toggle).toHaveText('Hide menu');

    // The skip link still targets the operational area it names.
    await expect(page.locator('a.staff-skip-link')).toHaveAttribute(
      'href',
      '#staff-main',
    );
  });
});

// ---------------------------------------------------------------------------
// AC3 — Take Order is fitted above 767px, in both states
// ---------------------------------------------------------------------------

for (const viewport of [DESKTOP, TABLET, NARROW_DESKTOP]) {
  test.describe(`Take Order at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('reaches the viewport bottom in both menu states, and grows by exactly the header delta', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAsStaff(page);
      await gotoScreen(page, TAKE_ORDER);

      const { shown, hidden, headerDelta } = await measureBothStates(page);

      expectClose(
        shown.mainBottom,
        shown.viewportHeight,
        'with the menu shown, the operational area should reach the viewport bottom',
      );
      expectClose(
        hidden.mainBottom,
        hidden.viewportHeight,
        'with the menu hidden, the operational area should reach the viewport bottom',
      );
      expectClose(
        hidden.mainHeight - shown.mainHeight,
        headerDelta,
        'the operational area should grow by the amount the header shrank',
      );

      // A fitted page scrolls internally; the document itself must not grow.
      expect(
        Math.round(hidden.documentScrollHeight),
        'the fitted workspace should not introduce document scrolling',
      ).toBeLessThanOrEqual(Math.round(hidden.documentClientHeight) + TOLERANCE_PX);

      // AC5 — showing the menu again restores the shown-state geometry.
      await setMenu(page, true);
      const restored = await measure(page);
      expectClose(
        restored.mainHeight,
        shown.mainHeight,
        'restored operational-area height',
      );
      expectClose(
        restored.mainTop,
        shown.mainTop,
        'restored operational-area top',
      );
    });
  });
}

// ---------------------------------------------------------------------------
// AC4 — the flow-height screens move up by the header delta
// ---------------------------------------------------------------------------

test.describe('Flow-height screens at 1440x900', () => {
  test.use({ viewport: DESKTOP });

  for (const screen of FLOW_SCREENS) {
    test(`${screen.name} moves its content up by the header delta and restores it`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAsStaff(page);
      await gotoScreen(page, screen);

      const { shown, hidden, headerDelta } = await measureBothStates(page);

      expectClose(
        shown.mainTop - hidden.mainTop,
        headerDelta,
        `${screen.name} content should move up by the header shrink`,
      );
      // The content sits directly under the header in both states — no band of
      // reserved space is left where the menu used to be.
      expectClose(
        hidden.mainTop,
        hidden.headerBottom,
        `${screen.name} content should start at the collapsed header's bottom`,
      );
      expectClose(
        shown.mainTop,
        shown.headerBottom,
        `${screen.name} content should start at the expanded header's bottom`,
      );

      // AC5.
      await setMenu(page, true);
      const restored = await measure(page);
      expectClose(restored.mainTop, shown.mainTop, `${screen.name} restored top`);
      expectClose(
        restored.headerHeight,
        shown.headerHeight,
        `${screen.name} restored header height`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// AC6 — nothing is covered, clipped or unreachable in either state
// ---------------------------------------------------------------------------

test.describe('Named controls stay reachable in both menu states', () => {
  test.use({ viewport: TABLET });

  test('Take Order item selection, current order and order action', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, TAKE_ORDER);

    const search = page.getByRole('searchbox', { name: 'Search products' });
    await search.fill(catalog.firstProductName);
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: catalog.firstProductName }) });
    await expect(card).toBeVisible();

    for (const menuVisible of [true, false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';

      await expectHittable(search, `the product search with the menu ${state}`);
      await expectHittable(
        card.getByRole('button', { name: /^Regular\b/ }),
        `an item size button with the menu ${state}`,
      );
      await expectHittable(
        page.getByRole('complementary'),
        `the current-order area with the menu ${state}`,
      );
      await expectHittable(
        orderAction(page),
        `the order action with the menu ${state}`,
      );
    }

    // Operable, not merely uncovered: adding an item with the menu hidden
    // reaches the API and lands in the current-order pane.
    await setMenu(page, false);
    await card.getByRole('button', { name: /^Regular\b/ }).click();
    await expect(
      page.getByRole('complementary').getByText('Order is empty'),
    ).toBeHidden();
    await expectHittable(
      page.getByRole('complementary').getByRole('article').first(),
      'the order line added with the menu hidden',
    );
  });

  test('Order History filters and the final displayed order', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, FLOW_SCREENS[0]);

    const filters = page.locator('.staff-order-filters');
    const lastOrder = page.locator('.staff-order-ledger > li').last();
    await expect(lastOrder).toBeVisible();

    for (const menuVisible of [true, false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectHittable(
        filters.getByRole('combobox', { name: 'Status' }),
        `the Status filter with the menu ${state}`,
      );
      await expectHittable(
        filters.getByRole('searchbox', { name: 'Customer name' }),
        `the customer search with the menu ${state}`,
      );

      // AC7 — the final order can be brought fully into view and used.
      await lastOrder.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(lastOrder, `the final order with the menu ${state}`);
      const fullyVisible = await lastOrder.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const header = document
          .querySelector('header.staff-workspace-header')!
          .getBoundingClientRect();
        return rect.top >= header.bottom - 1 && rect.bottom <= window.innerHeight + 1;
      });
      expect(
        fullyVisible,
        `the final order should sit clear of the sticky header with the menu ${state}`,
      ).toBe(true);
    }
  });

  test('Stock Counts entry and completion action', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, FLOW_SCREENS[1]);

    const firstEntry = page.locator('input.staff-quantity-input').first();
    const lastEntry = page.locator('input.staff-quantity-input').last();
    const submit = page.getByRole('button', { name: /^Submit opening count$/ });

    for (const menuVisible of [true, false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectHittable(firstEntry, `the first count entry with the menu ${state}`);

      await lastEntry.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(lastEntry, `the last count entry with the menu ${state}`);
      // Operable, not just visible.
      await lastEntry.fill('7');
      await expect(lastEntry).toHaveValue('7');

      await submit.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(submit, `the completion action with the menu ${state}`);
      await expect(submit).toBeEnabled();
    }
  });

  test('Cash & Expenses entry and submission action', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, FLOW_SCREENS[2]);

    const amount = page.locator('#cash-amount');
    const record = page.getByRole('button', { name: 'Record entry' });

    for (const menuVisible of [true, false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectHittable(amount, `the amount field with the menu ${state}`);
      await amount.fill('12.50');
      await expect(amount).toHaveValue('12.50');

      await record.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(record, `the submission action with the menu ${state}`);
    }
  });

  test('the Trading Day close action', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, FLOW_SCREENS[3]);

    const close = page.getByRole('button', { name: 'Close day' });

    for (const menuVisible of [true, false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';
      await close.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(close, `the close-day action with the menu ${state}`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC7 — Take Order's internal scroll panes stay fully reachable
// ---------------------------------------------------------------------------

test.describe('Take Order internal scrolling at 1024x768', () => {
  test.use({ viewport: TABLET });

  test('the last product is reachable with the menu hidden and after showing it again', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, TAKE_ORDER);

    const lastCard = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: catalog.lastProductName }) });

    for (const menuVisible of [false, true]) {
      await setMenu(page, menuVisible);
      const state = menuVisible ? 'shown' : 'hidden';
      await lastCard.scrollIntoViewIfNeeded();
      await settle(page);
      await expectHittable(
        lastCard.getByRole('button', { name: /^Regular\b/ }),
        `the last product's size button with the menu ${state}`,
      );
      // The fitted page must still not have turned into one long document.
      const geometry = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));
      expect(
        Math.round(geometry.scrollHeight),
        `the fitted page should scroll internally, not as a document, with the menu ${state}`,
      ).toBeLessThanOrEqual(Math.round(geometry.clientHeight) + TOLERANCE_PX);
    }
  });
});

// ---------------------------------------------------------------------------
// AC8 — the narrow breakpoint keeps its stacked, document-scrolling layout
// ---------------------------------------------------------------------------

test.describe('Take Order at 390x844', () => {
  test.use({ viewport: PHONE });

  test('stays stacked, loses the menu height, and keeps every action reachable', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await gotoScreen(page, TAKE_ORDER);

    const { shown, hidden, headerDelta } = await measureBothStates(page);

    // Stacked and document-scrolling, exactly as before the change.
    expect(
      Math.round(shown.documentScrollHeight),
      'the narrow layout should still scroll as a document',
    ).toBeGreaterThan(Math.round(shown.documentClientHeight));
    expect(
      await operationalArea(page).evaluate(
        (element) => getComputedStyle(element).display,
      ),
    ).toBe('block');

    // Hiding the menu removes exactly the height the menu occupied.
    expectClose(
      shown.documentScrollHeight - hidden.documentScrollHeight,
      headerDelta,
      'the document should shrink by the menu height',
    );
    expectClose(
      shown.mainTop - hidden.mainTop,
      headerDelta,
      'the stacked content should move up by the menu height',
    );

    // No horizontal clipping in either state.
    for (const geometry of [shown, hidden]) {
      expect(
        Math.round(geometry.documentScrollWidth),
        'the narrow layout should not clip horizontally',
      ).toBeLessThanOrEqual(Math.round(geometry.documentClientWidth));
    }

    // The order action at the bottom of the stack is still reachable.
    await setMenu(page, false);
    const action = orderAction(page);
    await action.scrollIntoViewIfNeeded();
    await settle(page);
    await expectHittable(action, 'the order action on the narrow layout');
  });
});

// ---------------------------------------------------------------------------
// AC9 — Take Order's loading, blocked and failure states follow the same rules
// ---------------------------------------------------------------------------

test.describe('Take Order state screens at 1440x900', () => {
  test.use({ viewport: DESKTOP });

  /** Every state screen is `.take-order-state`, and must be fitted like the page. */
  async function expectFittedStateScreen(
    page: Page,
    heading: string,
  ): Promise<void> {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(operationalArea(page)).toHaveClass(/take-order-state/);
    await settle(page);

    const { shown, hidden, headerDelta } = await measureBothStates(page);
    expectClose(
      shown.mainBottom,
      shown.viewportHeight,
      `"${heading}" should reach the viewport bottom with the menu shown`,
    );
    expectClose(
      hidden.mainBottom,
      hidden.viewportHeight,
      `"${heading}" should reach the viewport bottom with the menu hidden`,
    );
    expectClose(
      hidden.mainHeight - shown.mainHeight,
      headerDelta,
      `"${heading}" should grow by the header shrink`,
    );
  }

  test('the loading state is fitted while it is on screen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);

    // Hold the business-day response open so the transient state can be
    // measured rather than waited out.
    await page.route('**/trading-day/current', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      await route.continue();
    });
    await page.goto('/pos/order');

    await expectFittedStateScreen(page, 'Loading Take Order');
    await page.unroute('**/trading-day/current');
  });

  test('the no-business-day state is fitted', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    closeWorkspaceDay(day.id);
    try {
      await page.goto('/pos/order');
      await expectFittedStateScreen(page, 'No business day is open');
    } finally {
      // Every later test runs against this day; put it back.
      reopenWorkspaceDay(day.id);
    }
  });

  test('the load-failure state is fitted', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await page.route('**/catalog/products*', (route) => route.abort());
    await page.goto('/pos/order');
    await expectFittedStateScreen(page, 'Take Order could not be loaded');
  });

  test('the business-day failure state is fitted', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await page.route('**/trading-day/current', (route) => route.abort());
    await page.goto('/pos/order');
    await expectFittedStateScreen(page, 'Business day could not be checked');
  });
});

// ---------------------------------------------------------------------------
// AC10 — a saved "hidden" preference reclaims the space on first paint
// ---------------------------------------------------------------------------

test.describe('A saved hidden preference at 1440x900', () => {
  test.use({ viewport: DESKTOP });

  test('every in-scope screen renders reclaimed on entry, reload and navigation', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);

    for (const screen of [TAKE_ORDER, ...FLOW_SCREENS]) {
      // Baseline: what the screen measures when the menu is hidden by toggling.
      await setMenu(page, true);
      await gotoScreen(page, screen);
      const { hidden: toggled } = await measureBothStates(page);

      // Save the preference and come back cold. No second toggle is performed.
      await setMenu(page, false);
      await page.reload();
      await expect(screen.ready(page)).toBeVisible();
      await settle(page);

      await expect(menuToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(workspaceChrome(page)).toBeHidden();
      const reloaded = await measure(page);
      expectClose(
        reloaded.mainTop,
        toggled.mainTop,
        `${screen.name} reloaded with the preference saved: content top`,
      );
      expectClose(
        reloaded.mainHeight,
        toggled.mainHeight,
        `${screen.name} reloaded with the preference saved: content height`,
      );

      // And on a fresh navigation to the same screen, still no toggle.
      await page.goto('/pos/order');
      await gotoScreen(page, screen);
      const navigated = await measure(page);
      expect(await page.evaluate(
        (key) => window.localStorage.getItem(key),
        NAV_VISIBILITY_KEY,
      )).toBe('false');
      expectClose(
        navigated.mainTop,
        toggled.mainTop,
        `${screen.name} entered by navigation with the preference saved`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC11 — three hide/show cycles accumulate nothing
// ---------------------------------------------------------------------------

test.describe('Three hide-and-show cycles at 1440x900', () => {
  test.use({ viewport: DESKTOP });

  for (const screen of [TAKE_ORDER, FLOW_SCREENS[0], FLOW_SCREENS[2]]) {
    test(`${screen.name} measures the same on every cycle`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAsStaff(page);
      await gotoScreen(page, screen);

      const cycles: Array<{ shown: Geometry; hidden: Geometry }> = [];
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await setMenu(page, true);
        const shown = await measure(page);
        await setMenu(page, false);
        const hidden = await measure(page);
        cycles.push({ shown, hidden });
      }

      const first = cycles[0];
      for (const [index, cycle] of cycles.entries()) {
        for (const state of ['shown', 'hidden'] as const) {
          expectClose(
            cycle[state].mainHeight,
            first[state].mainHeight,
            `${screen.name} cycle ${index + 1} ${state}: usable area height`,
          );
          expectClose(
            cycle[state].mainTop,
            first[state].mainTop,
            `${screen.name} cycle ${index + 1} ${state}: content top`,
          );
          expectClose(
            cycle[state].headerHeight,
            first[state].headerHeight,
            `${screen.name} cycle ${index + 1} ${state}: header height`,
          );
          expectClose(
            cycle[state].documentScrollHeight,
            first[state].documentScrollHeight,
            `${screen.name} cycle ${index + 1} ${state}: document height`,
          );
        }
      }

      // And the space really was reclaimed on every cycle, not merely stable.
      for (const [index, cycle] of cycles.entries()) {
        expect(
          cycle.hidden.headerHeight,
          `${screen.name} cycle ${index + 1}: the header should shrink`,
        ).toBeLessThan(cycle.shown.headerHeight - 10);
      }
    });
  }
});
