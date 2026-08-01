import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openBusinessDayDirect,
  resetBusinessDayWorld,
  seedStaffMembers,
  type SeededOpenDay,
  type SeededStaff,
} from './fixtures/business-day';

/**
 * End-to-end coverage for story #174 — "Related screens use a deliberate and
 * consistent experience" (QA task #180, dev tasks #178 and #179).
 *
 * Screens under test (apps/web/src/App.tsx):
 *   staff  /pos /pos/open /pos/opening /pos/restock /pos/movements
 *          /pos/orders /pos/cash /pos/closing /pos/close
 *   admin  /dashboard /catalog/categories /catalog/products /inventory
 *          /staff /reports /order-history
 *
 * What this suite is and is not. #174 changes presentation only — it explicitly
 * forbids changing sales, money, inventory, attribution, authentication, or
 * append-only rules. The regression half of the story is therefore covered by
 * re-running the existing specs unchanged against the merge-base baseline, not
 * by new assertions here; this file covers the shell behaviour the story adds:
 * destination set and order, reachability from every staff route, non-actionable
 * unavailable destinations, current-destination and business-day cues, the
 * staff/administrator separation, keyboard access, touch targets, both supported
 * viewports, and reduced motion.
 *
 * Colour is deliberately never asserted as the carrier of a state. Every state
 * assertion here is either a semantic one (`aria-current`, `aria-disabled`,
 * accessible name, tab order) or a non-colour visual one (an inset indicator
 * bar, a weight change, a lock glyph, a dashed border). A screen that satisfied
 * these only through colour would fail.
 *
 * Fixture isolation. The unavailable-destination criteria need both "no business
 * day open" and "a day is open", and the app reads the current open day globally
 * with no per-run scope. Each describe therefore clears the trading-day world
 * and opens exactly the day it needs, and the file runs serially for the same
 * reason the rest of the suite does.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa174-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The binding destination order from story #174's acceptance criteria. */
const STAFF_DESTINATIONS = [
  'Sell',
  'Open Day',
  'Opening',
  'Restock',
  'Deliveries & Wastage',
  'Order History',
  'Cash & Expenses',
  'Closing',
  'Close Day',
] as const;

/**
 * Destinations whose *existing* business prerequisite is an open business day.
 * The story requires the prerequisite to be preserved, not invented, so this
 * list mirrors what each screen already refused to do without an open day.
 */
const REQUIRES_OPEN_DAY = new Set<string>([
  'Opening',
  'Restock',
  'Deliveries & Wastage',
  'Cash & Expenses',
  'Closing',
  'Close Day',
]);

const ALWAYS_AVAILABLE = STAFF_DESTINATIONS.filter(
  (label) => !REQUIRES_OPEN_DAY.has(label),
);

const STAFF_ROUTES = [
  '/pos',
  '/pos/open',
  '/pos/opening',
  '/pos/restock',
  '/pos/movements',
  '/pos/orders',
  '/pos/cash',
  '/pos/closing',
  '/pos/close',
] as const;

const ADMIN_ROUTES = [
  '/dashboard',
  '/catalog/categories',
  '/catalog/products',
  '/inventory',
  '/staff',
  '/reports',
  '/order-history',
] as const;

/** The two supported viewports named by the acceptance criteria. */
const VIEWPORTS = [
  { name: 'landscape tablet 1024x768', width: 1024, height: 768 },
  { name: 'narrow screen 390x844', width: 390, height: 844 },
] as const;

const BUSINESS_DATE = '2026-07-15';

let staff: Record<string, SeededStaff>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  staff = seedStaffMembers({
    nav: { displayName: `QA Nav Opener ${TAG}`, isActive: true },
  });
});

test.afterAll(() => {
  // Leave the environment with one open day and nothing recorded against it —
  // the state the rest of the suite and a developer opening the app expect.
  resetBusinessDayWorld();
  openBusinessDayDirect({
    businessDate: BUSINESS_DATE,
    dayType: 'NORMAL',
    openingFloatCents: 100000,
    openedByStaffMemberId: staff.nav.id,
  });
});

// ---- helpers ----------------------------------------------------------------

/** The app's own business-date formatting, so the assertion is not a re-render. */
function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function openDay(): SeededOpenDay {
  return openBusinessDayDirect({
    businessDate: BUSINESS_DATE,
    dayType: 'NORMAL',
    openingFloatCents: 100000,
    openedByStaffMemberId: staff.nav.id,
  });
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form auto-focuses its first field on the next animation frame; waiting
  // for that stops it stealing focus mid-fill.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function staffNav(page: Page): Locator {
  return page.locator('nav[aria-label="Staff workspace"]');
}

function dayContext(page: Page): Locator {
  return page.locator('[aria-label="Business day context"]');
}

function staffNavItem(page: Page, label: string): Locator {
  return staffNav(page).locator('.staff-nav-item', {
    has: page.locator(`text="${label}"`),
  });
}

/**
 * Navigate to a staff route and wait for the shell to settle.
 *
 * The strip renders every prerequisite-bound destination as unavailable while
 * the business day is still loading, which is indistinguishable from "no day is
 * open". Waiting for the day context to stop saying "Checking business day…" is
 * what makes the unavailable assertions mean what they claim.
 */
async function gotoStaff(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(staffNav(page)).toBeVisible();
  await expect(dayContext(page)).not.toContainText('Checking business day');
}

async function gotoAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.admin-sidebar')).toBeVisible();
}

/** Labels of the strip, in DOM order — which is the visible order. */
async function stripLabels(page: Page): Promise<string[]> {
  const raw = await staffNav(page).locator('.staff-nav-item').allTextContents();
  return raw.map((value) => value.trim());
}

/**
 * Tab from the top of the document and record what focus lands on inside the
 * staff strip, in the order it is reached.
 */
async function tabbedStaffDestinations(page: Page): Promise<string[]> {
  // Blurring is not enough: Chromium keeps a sequential-focus starting point,
  // so after a destination was clicked, Tab would resume from inside the strip.
  // Clicking the non-focusable brand text moves that starting point to the top
  // of the shell, ahead of the strip, without focusing anything.
  await page.locator('.staff-workspace-brand strong').click();
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur();
  });
  const reached: string[] = [];
  let entered = false;

  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      return {
        inNav: Boolean(element.closest('nav[aria-label="Staff workspace"]')),
        text: (element.textContent ?? '').trim(),
      };
    });
    if (!focused) break;
    if (focused.inNav) {
      entered = true;
      reached.push(focused.text);
    } else if (entered) {
      break;
    }
  }

  return reached;
}

/** True when the page itself scrolls sideways, ignoring inner scrollers. */
async function hasPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth;
  });
}

// ---- staff strip: destination set, order and reachability -------------------

test.describe('staff POS strip — one coherent navigation experience', () => {
  test.beforeEach(async ({ page }) => {
    resetBusinessDayWorld();
    openDay();
    await signInAsStaff(page);
  });

  test('AC: the strip lists the nine destinations in the required order', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');
    expect(await stripLabels(page)).toEqual([...STAFF_DESTINATIONS]);
  });

  test('AC: every available destination is reachable from every staff route through the same strip', async ({
    page,
  }) => {
    for (const route of STAFF_ROUTES) {
      await gotoStaff(page, route);

      // One navigation pattern: exactly one staff strip, and no administrator
      // sidebar standing in for it on any route.
      await expect(staffNav(page)).toHaveCount(1);
      await expect(page.locator('.admin-sidebar')).toHaveCount(0);

      expect(await stripLabels(page), `strip contents on ${route}`).toEqual([
        ...STAFF_DESTINATIONS,
      ]);

      // With a day open every destination is available, so every one of them
      // must be a real link with an href — not a label that only looks like one.
      for (const label of STAFF_DESTINATIONS) {
        const item = staffNavItem(page, label);
        await expect(item, `${label} on ${route}`).toHaveJSProperty(
          'tagName',
          'A',
        );
        await expect(item).toHaveAttribute('href', /\/pos/);
      }
    }
  });

  test('AC: a destination reached from the strip navigates and marks itself current', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');

    for (const [label, path] of [
      ['Order History', '/pos/orders'],
      ['Cash & Expenses', '/pos/cash'],
      ['Closing', '/pos/closing'],
      ['Sell', '/pos'],
    ] as const) {
      await staffNavItem(page, label).click();
      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`));
      await expect(staffNavItem(page, label)).toHaveAttribute(
        'aria-current',
        'page',
      );
      // Exactly one current destination, never several.
      await expect(staffNav(page).locator('[aria-current="page"]')).toHaveCount(
        1,
      );
    }
  });

  test('AC: the current destination is identifiable without colour', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos/orders');

    const current = staffNav(page).locator('[aria-current="page"]');
    await expect(current).toHaveText('Order History');

    const currentStyle = await current.evaluate((element) => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, fontWeight: style.fontWeight };
    });
    const restingStyle = await staffNavItem(page, 'Restock').evaluate(
      (element) => {
        const style = getComputedStyle(element);
        return { boxShadow: style.boxShadow, fontWeight: style.fontWeight };
      },
    );

    // A visible indicator bar plus a weight change: both survive greyscale.
    expect(currentStyle.boxShadow).not.toBe('none');
    expect(currentStyle.boxShadow).not.toBe(restingStyle.boxShadow);
    expect(Number(currentStyle.fontWeight)).toBeGreaterThan(
      Number(restingStyle.fontWeight),
    );
  });

  test('AC: signed-in and business-day context sit in the same shell position on every staff route', async ({
    page,
  }) => {
    let firstBox: { x: number; y: number } | null = null;

    for (const route of STAFF_ROUTES) {
      await gotoStaff(page, route);

      await expect(
        page.locator('.staff-workspace-brand small'),
        `signed-in context on ${route}`,
      ).toContainText('Signed in as');

      const context = dayContext(page);
      await expect(context, `day context on ${route}`).toHaveCount(1);
      await expect(context).toContainText(formatBusinessDate(BUSINESS_DATE));
      await expect(context).toContainText('Normal day');

      // Same shell slot, not merely present somewhere on the page.
      await expect(
        page.locator(
          'header.staff-workspace-header .staff-workspace-context-row [aria-label="Business day context"]',
        ),
      ).toHaveCount(1);

      const box = await context.boundingBox();
      expect(box, `day context box on ${route}`).not.toBeNull();
      if (firstBox === null) {
        firstBox = { x: box!.x, y: box!.y };
      } else {
        expect(Math.round(box!.x)).toBe(Math.round(firstBox.x));
        expect(Math.round(box!.y)).toBe(Math.round(firstBox.y));
      }
    }
  });

  test('AC: every actionable destination has a 44x44 touch target', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');

    for (const label of STAFF_DESTINATIONS) {
      const box = await staffNavItem(page, label).boundingBox();
      expect(box, `${label} box`).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ---- staff strip: unavailable destinations ----------------------------------

test.describe('staff POS strip — destinations with an unmet prerequisite', () => {
  test.beforeEach(async ({ page }) => {
    resetBusinessDayWorld();
    await signInAsStaff(page);
  });

  test('AC: with no business day open, prerequisite-bound destinations are visible but non-actionable', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');

    // Still visible, still in the same order — visibility is what keeps the
    // workspace learnable; only actionability changes.
    expect(await stripLabels(page)).toEqual([...STAFF_DESTINATIONS]);

    for (const label of REQUIRES_OPEN_DAY) {
      const item = staffNavItem(page, label);
      await expect(item, `${label} is not a link`).not.toHaveJSProperty(
        'tagName',
        'A',
      );
      await expect(item).toHaveAttribute('aria-disabled', 'true');
      // Announced as unavailable, not merely dimmed.
      await expect(item).toHaveAttribute(
        'aria-label',
        `${label}, unavailable until a business day is open`,
      );
      // A non-colour cue: the lock glyph and a dashed border.
      await expect(item.locator('svg.staff-nav-lock')).toHaveCount(1);
      const borderStyle = await item.evaluate(
        (element) => getComputedStyle(element).borderStyle,
      );
      expect(borderStyle).toContain('dashed');
    }

    for (const label of ALWAYS_AVAILABLE) {
      await expect(
        staffNavItem(page, label),
        `${label} stays actionable`,
      ).toHaveJSProperty('tagName', 'A');
    }
  });

  test('AC: an unavailable destination is out of the keyboard tab order', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');

    const reached = await tabbedStaffDestinations(page);
    expect(reached).toEqual([...ALWAYS_AVAILABLE]);
  });

  test('AC: activating an unavailable destination does not navigate', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');

    for (const label of ['Opening', 'Cash & Expenses', 'Close Day']) {
      await staffNavItem(page, label).click({ force: true });
      await expect(page).toHaveURL(/\/pos$/);
    }
  });

  test('AC: the day context states "No business day open" rather than disappearing', async ({
    page,
  }) => {
    for (const route of ['/pos', '/pos/open', '/pos/orders']) {
      await gotoStaff(page, route);
      await expect(dayContext(page), `day context on ${route}`).toHaveCount(1);
      await expect(dayContext(page)).toContainText('No business day open');
    }
  });

  test('AC: destinations become actionable once the prerequisite is met', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos');
    await expect(staffNavItem(page, 'Opening')).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    openDay();
    await gotoStaff(page, '/pos');

    for (const label of REQUIRES_OPEN_DAY) {
      const item = staffNavItem(page, label);
      await expect(item, `${label} after opening a day`).toHaveJSProperty(
        'tagName',
        'A',
      );
      await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    }

    // Every destination is now reachable by keyboard, in the visible order.
    expect(await tabbedStaffDestinations(page)).toEqual([
      ...STAFF_DESTINATIONS,
    ]);

    await staffNavItem(page, 'Opening').click();
    await expect(page).toHaveURL(/\/pos\/opening$/);
  });
});

// ---- staff shell: keyboard access -------------------------------------------

test.describe('staff POS shell — keyboard and assistive-technology access', () => {
  test.beforeEach(async ({ page }) => {
    resetBusinessDayWorld();
    openDay();
    await signInAsStaff(page);
  });

  test('AC: the skip link is first in the tab order and lands on the staff main region', async ({
    page,
  }) => {
    for (const route of ['/pos', '/pos/cash', '/pos/close']) {
      await gotoStaff(page, route);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await page.keyboard.press('Tab');

      const skipLink = page.locator('a.staff-skip-link');
      await expect(skipLink, `skip link on ${route}`).toBeFocused();
      await expect(skipLink).toBeVisible();
      await expect(skipLink).toHaveAttribute('href', '#staff-main');

      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#staff-main$/);
      // The target is the page's own main landmark, not an arbitrary anchor.
      const targetTag = await page.evaluate(
        () => document.getElementById('staff-main')?.tagName ?? null,
      );
      expect(targetTag, `skip target on ${route}`).toBe('MAIN');
    }
  });

  test('AC: focus order follows the visible destination order and focus is visible', async ({
    page,
  }) => {
    await gotoStaff(page, '/pos/restock');

    expect(await tabbedStaffDestinations(page)).toEqual([
      ...STAFF_DESTINATIONS,
    ]);

    const outline = await staffNavItem(page, 'Sell').evaluate((element) => {
      element.focus();
      const style = getComputedStyle(element);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
      };
    });
    expect(outline.style).not.toBe('none');
    expect(Number.parseFloat(outline.width)).toBeGreaterThan(0);
  });

  test('AC: a route change moves focus to the destination page heading region', async ({
    page,
  }) => {
    // Route-change focus behaviour is inherited, not introduced by #174. The
    // assertion is that it still holds after the shell was reconciled: the
    // strip stays in the document and the new page's main landmark is present
    // and reachable as the first stop after the skip link.
    await gotoStaff(page, '/pos');
    await staffNavItem(page, 'Order History').click();
    await expect(page).toHaveURL(/\/pos\/orders$/);
    await expect(page.locator('main#staff-main')).toBeVisible();
    await expect(staffNav(page)).toHaveCount(1);
  });
});

// ---- administrator shell ----------------------------------------------------

test.describe('administrator shell — distinct from the staff POS, internally consistent', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('AC: administrator routes render the sidebar and never the staff strip', async ({
    page,
  }) => {
    for (const route of ADMIN_ROUTES) {
      await gotoAdmin(page, route);
      await expect(page.locator('.admin-sidebar'), route).toHaveCount(1);
      await expect(staffNav(page), route).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Administrator navigation' }),
      ).toHaveCount(1);
    }
  });

  test('AC: the sidebar keeps the Workspace, Catalog and Operations groups', async ({
    page,
  }) => {
    await gotoAdmin(page, '/dashboard');

    for (const group of ['Workspace', 'Catalog', 'Operations']) {
      await expect(
        page.locator('.admin-sidebar .admin-nav-label', { hasText: group }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('group', { name: group }),
      ).toHaveCount(1);
    }
  });

  test('AC: the active administrator destination is current and identifiable without colour', async ({
    page,
  }) => {
    for (const route of ADMIN_ROUTES) {
      await gotoAdmin(page, route);

      const current = page.locator(
        '.admin-sidebar nav a[aria-current="page"]',
      );
      await expect(current, `current destination on ${route}`).toHaveCount(1);
      await expect(current).toHaveAttribute('href', route);

      const currentStyle = await current.evaluate((element) => {
        const style = getComputedStyle(element);
        return { boxShadow: style.boxShadow, fontWeight: style.fontWeight };
      });
      const resting = page
        .locator('.admin-sidebar nav a:not([aria-current="page"])')
        .first();
      const restingStyle = await resting.evaluate((element) => {
        const style = getComputedStyle(element);
        return { boxShadow: style.boxShadow, fontWeight: style.fontWeight };
      });

      expect(currentStyle.boxShadow).not.toBe('none');
      expect(currentStyle.boxShadow).not.toBe(restingStyle.boxShadow);
      expect(Number(currentStyle.fontWeight)).toBeGreaterThan(
        Number(restingStyle.fontWeight),
      );
    }
  });

  test('AC: administrator destinations use distinct icons rather than one repeated glyph', async ({
    page,
  }) => {
    await gotoAdmin(page, '/dashboard');

    const glyphs = await page
      .locator('.admin-sidebar nav a svg')
      .evaluateAll((elements) =>
        elements.map((element) => element.innerHTML.trim()),
      );

    expect(glyphs.length).toBe(ADMIN_ROUTES.length);
    expect(new Set(glyphs).size, 'distinct icon shapes').toBe(glyphs.length);
  });

  test('AC: administrator destinations keep 44px touch targets and visible focus', async ({
    page,
  }) => {
    await gotoAdmin(page, '/dashboard');

    const links = page.locator('.admin-sidebar nav a');
    const count = await links.count();
    expect(count).toBe(ADMIN_ROUTES.length);

    for (let index = 0; index < count; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    const outlineStyle = await links.first().evaluate((element) => {
      element.focus();
      return getComputedStyle(element).outlineStyle;
    });
    expect(outlineStyle).not.toBe('none');
  });

  test('AC: role routing still separates the two workspaces', async ({
    page,
  }) => {
    // Admin into the staff workspace.
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(staffNav(page)).toHaveCount(0);
  });
});

test.describe('workspace separation from the staff side', () => {
  test('AC: staff sent to an administrator route land back in the staff workspace', async ({
    page,
  }) => {
    resetBusinessDayWorld();
    openDay();
    await signInAsStaff(page);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator('.admin-sidebar')).toHaveCount(0);
    await expect(staffNav(page)).toHaveCount(1);
  });
});

// ---- both supported viewports -----------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`no page-level horizontal overflow at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('AC: every staff route fits the viewport width', async ({ page }) => {
      resetBusinessDayWorld();
      openDay();
      await signInAsStaff(page);

      for (const route of STAFF_ROUTES) {
        await gotoStaff(page, route);
        expect(await hasPageOverflow(page), `page overflow on ${route}`).toBe(
          false,
        );
      }
    });

    test('AC: the staff strip scrolls within its own bounds without widening the page', async ({
      page,
    }) => {
      resetBusinessDayWorld();
      openDay();
      await signInAsStaff(page);
      await gotoStaff(page, '/pos');

      const strip = await staffNav(page).evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      // Inner horizontal scrolling is intended and must not be flagged; the
      // page-level width is the thing under test.
      expect(strip.clientWidth).toBeLessThanOrEqual(viewport.width);
      expect(await hasPageOverflow(page)).toBe(false);

      // Every destination remains reachable inside that scroller.
      expect(await stripLabels(page)).toEqual([...STAFF_DESTINATIONS]);
    });

    test('AC: every administrator route fits the viewport width and keeps its groups', async ({
      page,
    }) => {
      await signInAsAdmin(page);

      for (const route of ADMIN_ROUTES) {
        await gotoAdmin(page, route);
        expect(await hasPageOverflow(page), `page overflow on ${route}`).toBe(
          false,
        );
      }

      await gotoAdmin(page, '/dashboard');
      for (const group of ['Workspace', 'Catalog', 'Operations']) {
        await expect(
          page.locator('.admin-sidebar .admin-nav-label', { hasText: group }),
          `${group} label at ${viewport.name}`,
        ).toBeVisible();
      }
    });
  });
}

// ---- reduced motion ---------------------------------------------------------

test.describe('reduced motion', () => {
  /**
   * Emulated per page rather than through `test.use({ reducedMotion })`: the
   * fixture form does not reach the page in this project's configuration, and a
   * reduced-motion test that silently runs without reduced motion would pass for
   * the wrong reason. `assertReducedMotion` makes the emulation itself an
   * assertion.
   */
  async function assertReducedMotion(page: Page): Promise<void> {
    const applied = await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(applied, 'reduced motion is actually emulated').toBe(true);
  }

  test('AC: navigation and state cues do not depend on animation', async ({
    page,
  }) => {
    resetBusinessDayWorld();
    openDay();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await assertReducedMotion(page);
    await gotoStaff(page, '/pos/cash');

    // The screen's entrance animation is suppressed…
    const screenAnimation = await page
      .locator('main#staff-main')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(screenAnimation).toBe('none');

    // …and the current-destination state is still carried by semantics plus a
    // static, non-colour indicator rather than by a transition.
    const current = staffNav(page).locator('[aria-current="page"]');
    await expect(current).toHaveText('Cash & Expenses');
    const style = await current.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        boxShadow: computed.boxShadow,
        fontWeight: computed.fontWeight,
        animationName: computed.animationName,
      };
    });
    expect(style.boxShadow).not.toBe('none');
    expect(Number(style.fontWeight)).toBeGreaterThan(650);
    expect(style.animationName).toBe('none');

    await expect(dayContext(page)).toContainText(
      formatBusinessDate(BUSINESS_DATE),
    );
  });

  test('AC: unavailable destinations stay announced and marked with reduced motion', async ({
    page,
  }) => {
    resetBusinessDayWorld();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsStaff(page);
    await assertReducedMotion(page);
    await gotoStaff(page, '/pos');

    const closeDay = staffNavItem(page, 'Close Day');
    await expect(closeDay).toHaveAttribute('aria-disabled', 'true');
    await expect(closeDay.locator('svg.staff-nav-lock')).toHaveCount(1);
    await expect(dayContext(page)).toContainText('No business day open');
  });

  test('AC: the administrator shell keeps its cues with reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsAdmin(page);
    await assertReducedMotion(page);
    await gotoAdmin(page, '/inventory');

    const current = page.locator('.admin-sidebar nav a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    const style = await current.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        boxShadow: computed.boxShadow,
        animationName: computed.animationName,
      };
    });
    expect(style.boxShadow).not.toBe('none');
    expect(style.animationName).toBe('none');
  });
});
