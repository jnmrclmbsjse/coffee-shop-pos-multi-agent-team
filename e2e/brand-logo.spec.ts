import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #250 — "The official coffee shop logo appears
 * consistently throughout the system" (QA task #253, dev task #252).
 *
 * Placements under test (apps/web/src):
 *   admin sign-in            /sign-in        `.site-header .brand`
 *   admin session-loading    any admin route `main.session-loading .brand`
 *   admin sidebar            /dashboard      `.admin-sidebar > .brand`
 *   admin bottom navigation  /dashboard @390 `.admin-sidebar > .brand`
 *   staff sign-in            /staff/sign-in  `.staff-brand`
 *   staff workspace header   /pos/orders     `.staff-workspace-brand`
 *
 * What this file asserts, and why in this shape.
 *
 * "The same official logo" is deliberately tested by comparing the *resolved*
 * image source across surfaces rather than by asserting each screen has some
 * image, and never by hardcoding a path — Vite fingerprints the asset filename,
 * so a hardcoded URL would be a maintenance trap while telling us nothing about
 * consistency. Two screens can each hold a perfectly valid `<img>` and still
 * fail this story by holding *different* artwork.
 *
 * Every presence assertion is paired with `naturalWidth > 0` and `complete`.
 * A 404 leaves the `<img>` element in the DOM, so a bare "the element exists"
 * check passes for a screen showing a broken-image glyph. The story says a
 * failed asset fails the story, so decoding is the assertion, not the element.
 *
 * The source artwork is square (1080x1080) and every lockup it was dropped into
 * is horizontal, so distortion is the real regression risk here. That is tested
 * numerically — rendered box ratio against decoded intrinsic ratio — because a
 * subtly stretched mark survives a screenshot review.
 *
 * State. Nothing in this story is state-dependent, so this file seeds nothing
 * and mutates no trading-day, roster or catalog data. It signs in with the
 * environment's existing admin and staff accounts and reads the rendered shell.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

/** The accessible name the story requires on the identity-bearing image. */
const LOGO_NAME = 'UCM Coffee logo';

/** Any logo image, regardless of which lockup it sits in. */
const LOGO = 'img.ucm-logo';

/**
 * The hand-built marks this story replaces. `.brand-mark` was the CSS-drawn
 * abstract shape and `.staff-brand-mark` the boxed "UCM" text; both must be
 * gone rather than merely covered up.
 */
const RETIRED_MARKS = ['.brand-mark', '.staff-brand-mark'] as const;

/** The two viewports named by the acceptance criteria. */
const VIEWPORTS = [
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const;

/** Below this width the administrator sidebar becomes the fixed bottom bar. */
const BOTTOM_NAV_MAX_WIDTH = 760;

type Session = 'none' | 'admin' | 'staff';

interface Placement {
  /** Human name, used in assertion messages. */
  readonly name: string;
  readonly session: Session;
  readonly route: string;
  /** The lockup wrapper — the element that also holds the visible shop name. */
  readonly lockup: string;
}

/**
 * The five placements reachable by ordinary navigation. The session-loading
 * view is intentionally not here: it only exists while `/auth/session` is in
 * flight, so it needs its own request-stalling setup rather than a `goto`.
 */
const PLACEMENTS: readonly Placement[] = [
  {
    name: 'administrator sign-in',
    session: 'none',
    route: '/sign-in',
    lockup: '.site-header .brand',
  },
  {
    name: 'administrator sidebar',
    session: 'admin',
    route: '/dashboard',
    lockup: '.admin-sidebar > .brand',
  },
  {
    name: 'staff sign-in',
    session: 'none',
    route: '/staff/sign-in',
    lockup: '.staff-brand',
  },
  {
    name: 'staff workspace header',
    session: 'staff',
    route: '/pos/orders',
    lockup: '.staff-workspace-brand',
  },
];

// ---- sign-in helpers --------------------------------------------------------

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
  // The form autofocuses its first field on the next animation frame; waiting
  // for that stops it stealing focus mid-fill.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function establish(page: Page, session: Session): Promise<void> {
  if (session === 'admin') await signInAsAdmin(page);
  if (session === 'staff') await signInAsStaff(page);
}

/** Navigate to a placement's route and wait for its lockup to be rendered. */
async function gotoPlacement(page: Page, placement: Placement): Promise<Locator> {
  await page.goto(placement.route);
  const logo = page.locator(`${placement.lockup} ${LOGO}`);
  await expect(logo, `${placement.name}: logo element`).toHaveCount(1);
  await expect(logo).toBeVisible();
  return logo;
}

// ---- measurement ------------------------------------------------------------

interface LogoMetrics {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  currentSrc: string;
  boxWidth: number;
  boxHeight: number;
  objectFit: string;
}

/**
 * Read everything the distortion and load criteria need in a single evaluate,
 * so the numbers all describe the same layout pass.
 */
async function measure(logo: Locator): Promise<LogoMetrics> {
  return logo.evaluate((element) => {
    const image = element as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      currentSrc: image.currentSrc,
      boxWidth: box.width,
      boxHeight: box.height,
      objectFit: getComputedStyle(image).objectFit,
    };
  });
}

/**
 * Assert the image decoded. `complete` alone is true for a failed load, which
 * is exactly the false green this story calls out, so intrinsic size carries
 * the assertion.
 */
function expectDecoded(metrics: LogoMetrics, label: string): void {
  expect(metrics.complete, `${label}: image finished loading`).toBe(true);
  expect(metrics.naturalWidth, `${label}: intrinsic width`).toBeGreaterThan(0);
  expect(metrics.naturalHeight, `${label}: intrinsic height`).toBeGreaterThan(0);
}

/**
 * Assert the rendered box preserves the artwork's own aspect ratio to within
 * 1%, and that nothing is cropped away to achieve it. `object-fit: cover` can
 * satisfy a ratio check while silently cutting the artwork's edges off, so the
 * fit mode is asserted alongside the ratio rather than inferred from it.
 */
function expectUndistorted(metrics: LogoMetrics, label: string): void {
  expect(metrics.boxWidth, `${label}: rendered width`).toBeGreaterThan(0);
  expect(metrics.boxHeight, `${label}: rendered height`).toBeGreaterThan(0);

  const intrinsicRatio = metrics.naturalWidth / metrics.naturalHeight;
  const renderedRatio = metrics.boxWidth / metrics.boxHeight;
  const drift = Math.abs(renderedRatio - intrinsicRatio) / intrinsicRatio;

  expect(
    drift,
    `${label}: rendered ratio ${renderedRatio.toFixed(4)} vs intrinsic ${intrinsicRatio.toFixed(4)}`,
  ).toBeLessThanOrEqual(0.01);

  // `contain` and `fill` both show the complete artwork; with the ratio already
  // matching, `fill` cannot stretch. `cover` and `none` can crop.
  expect(['contain', 'fill'], `${label}: object-fit`).toContain(
    metrics.objectFit,
  );
}

/**
 * True when an ancestor's overflow clipping cuts into the element's own box.
 * "The complete artwork remains visible without clipping" is about the box
 * surviving its container, not only about the pixels inside the box.
 */
async function clippedByAncestor(logo: Locator): Promise<boolean> {
  return logo.evaluate((element) => {
    const own = element.getBoundingClientRect();
    // Sub-pixel layout rounding is not clipping.
    const tolerance = 1;
    let parent = element.parentElement;

    while (parent) {
      const style = getComputedStyle(parent);
      const clips =
        style.overflowX !== 'visible' || style.overflowY !== 'visible';
      if (clips) {
        const bounds = parent.getBoundingClientRect();
        if (
          own.left < bounds.left - tolerance ||
          own.right > bounds.right + tolerance ||
          own.top < bounds.top - tolerance ||
          own.bottom > bounds.bottom + tolerance
        ) {
          return true;
        }
      }
      parent = parent.parentElement;
    }
    return false;
  });
}

/**
 * Selectors for everything the story forbids the logo from covering:
 * navigation, actionable controls, status messages, and form fields.
 */
const OBSTRUCTABLE = [
  'nav',
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="alert"]',
  '[role="status"]',
  '[aria-live]',
].join(', ');

interface Overlap {
  description: string;
  area: number;
}

/**
 * Bounding-box overlaps between the logo and anything obstructable that is
 * currently laid out on screen.
 *
 * Ancestors and descendants of the logo are excluded: the session-loading view
 * is itself an `aria-live` region *containing* the logo, and containment is not
 * obstruction. Zero-area elements are skipped — a display:none control has an
 * empty rect that trivially fails an intersection test.
 */
async function overlapsWithObstructables(
  logo: Locator,
  selector: string,
): Promise<Overlap[]> {
  return logo.evaluate(
    (element, candidateSelector: string) => {
      const own = element.getBoundingClientRect();
      const results: { description: string; area: number }[] = [];

      for (const candidate of Array.from(
        document.querySelectorAll(candidateSelector),
      )) {
        if (candidate.contains(element) || element.contains(candidate)) continue;

        const box = candidate.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        if (getComputedStyle(candidate).visibility === 'hidden') continue;

        const width = Math.min(own.right, box.right) - Math.max(own.left, box.left);
        const height = Math.min(own.bottom, box.bottom) - Math.max(own.top, box.top);
        if (width <= 0 || height <= 0) continue;

        const label = (candidate.getAttribute('aria-label') ??
          candidate.textContent ??
          '')
          .trim()
          .slice(0, 40);
        results.push({
          description: `${candidate.tagName.toLowerCase()}${
            candidate.className && typeof candidate.className === 'string'
              ? `.${candidate.className.split(/\s+/).filter(Boolean).join('.')}`
              : ''
          }${label ? ` "${label}"` : ''}`,
          area: width * height,
        });
      }

      return results;
    },
    selector,
  );
}

/**
 * True when the point at an element's centre reaches that element.
 *
 * Elements laid out outside the viewport are reported reachable rather than
 * blocked: `document.elementFromPoint` returns null for them, and the shell's
 * skip link deliberately parks itself above the top edge until focused. That is
 * an inherited accessibility pattern, not the logo covering something.
 */
async function isReachable(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    const offscreen =
      centreX < 0 ||
      centreY < 0 ||
      centreX > document.documentElement.clientWidth ||
      centreY > document.documentElement.clientHeight;
    if (offscreen) return true;

    const hit = document.elementFromPoint(centreX, centreY);
    return Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element)));
  });
}

// ---- AC: every placement shows the official logo, decoded --------------------

test.describe('every shop-identity placement renders the official logo', () => {
  for (const placement of PLACEMENTS) {
    test(`AC: ${placement.name} shows a logo image that actually loaded`, async ({
      page,
    }) => {
      await establish(page, placement.session);
      const logo = await gotoPlacement(page, placement);

      const metrics = await measure(logo);
      expectDecoded(metrics, placement.name);

      // The retired hand-built marks are gone from the screen entirely.
      for (const retired of RETIRED_MARKS) {
        await expect(
          page.locator(retired),
          `${placement.name}: retired mark ${retired}`,
        ).toHaveCount(0);
      }
    });
  }

  test('AC: the administrator session-loading view shows the logo before access resolves', async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // Delay `/auth/session` so the checking state is a stable thing to assert
    // against rather than a frame we race. A broken asset import shows up on
    // this screen first, which is why it is worth the extra setup. The delay is
    // fixed rather than released by the test body: unrouting while a handler is
    // still parked cancels the in-flight request, and the point here is that
    // the screen resolves normally afterwards.
    const HELD_MS = 3_000;
    await page.route('**/auth/session', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, HELD_MS));
      await route.continue();
    });

    await page.goto('/dashboard', { waitUntil: 'commit' });

    const loading = page.locator('main.session-loading');
    await expect(loading).toBeVisible();
    await expect(loading).toContainText('Checking administrator access');

    const logo = loading.locator(LOGO);
    await expect(logo, 'session-loading: logo element').toHaveCount(1);
    await expect(logo).toBeVisible();

    const metrics = await measure(logo);
    expectDecoded(metrics, 'administrator session-loading');
    expectUndistorted(metrics, 'administrator session-loading');
    await expect(logo).toHaveAccessibleName(LOGO_NAME);

    // And the shell still resolves normally once the session request completes.
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 15_000 });
    await page.unroute('**/auth/session');
  });
});

// ---- AC: one identity across admin and staff --------------------------------

test('AC: every placement resolves to the identical logo artwork', async ({
  page,
}) => {
  const resolved = new Map<string, string>();

  for (const placement of PLACEMENTS) {
    await establish(page, placement.session);
    const logo = await gotoPlacement(page, placement);
    const metrics = await measure(logo);
    expectDecoded(metrics, placement.name);
    resolved.set(placement.name, metrics.currentSrc);
  }

  // Compared to each other, never to a hardcoded path: Vite fingerprints the
  // filename, and the point of the criterion is sameness, not a known URL.
  const sources = [...resolved.values()];
  expect(sources).toHaveLength(PLACEMENTS.length);
  expect(
    new Set(sources).size,
    `distinct logo sources across placements: ${JSON.stringify(
      Object.fromEntries(resolved),
      null,
      2,
    )}`,
  ).toBe(1);
});

test('AC: no placeholder or substitute mark is displayed alongside the logo', async ({
  page,
}) => {
  for (const placement of PLACEMENTS) {
    await establish(page, placement.session);
    await gotoPlacement(page, placement);

    for (const retired of RETIRED_MARKS) {
      await expect(
        page.locator(retired),
        `${placement.name}: ${retired}`,
      ).toHaveCount(0);
    }

    // Exactly one identity image per lockup — a substitute left in place beside
    // the official mark would show up here as a second image.
    await expect(
      page.locator(`${placement.lockup} img`),
      `${placement.name}: images inside the lockup`,
    ).toHaveCount(1);
  }
});

// ---- AC: proportion, clipping and obstruction at both viewports -------------

for (const viewport of VIEWPORTS) {
  test.describe(`logo geometry at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const placement of PLACEMENTS) {
      // Below 760px the administrator sidebar *is* the bottom navigation, which
      // has its own dedicated criteria and its own test further down.
      const isBottomNav =
        placement.lockup === '.admin-sidebar > .brand' &&
        viewport.width <= BOTTOM_NAV_MAX_WIDTH;

      test(`AC: ${placement.name} logo is proportionate and uncropped`, async ({
        page,
      }) => {
        await establish(page, placement.session);
        const logo = await gotoPlacement(page, placement);

        const metrics = await measure(logo);
        expectDecoded(metrics, `${placement.name} @ ${viewport.name}`);
        expectUndistorted(metrics, `${placement.name} @ ${viewport.name}`);

        expect(
          await clippedByAncestor(logo),
          `${placement.name} @ ${viewport.name}: clipped by an ancestor`,
        ).toBe(false);
      });

      test(`AC: ${placement.name} logo obscures no control, status or field`, async ({
        page,
      }) => {
        test.skip(
          isBottomNav,
          'covered by the bottom-navigation criteria, which permit the fixed region to overlay scrolling content',
        );

        await establish(page, placement.session);
        const logo = await gotoPlacement(page, placement);

        const overlaps = await overlapsWithObstructables(logo, OBSTRUCTABLE);
        expect(
          overlaps,
          `${placement.name} @ ${viewport.name}: logo overlaps ${JSON.stringify(overlaps)}`,
        ).toEqual([]);

        // Nothing the logo sits near is rendered unreachable by it.
        const controls = page.locator(
          'a[href]:visible, button:visible, input:visible',
        );
        const count = Math.min(await controls.count(), 12);
        for (let index = 0; index < count; index += 1) {
          const control = controls.nth(index);
          expect(
            await isReachable(control),
            `${placement.name} @ ${viewport.name}: control ${index} reachable`,
          ).toBe(true);
        }
      });
    }
  });
}

// ---- AC: the responsive administrator bottom navigation ---------------------

test.describe('administrator bottom navigation at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC: the bottom navigation shows the complete official logo, not a substitute', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/dashboard');

    const sidebar = page.locator('.admin-sidebar');
    await expect(sidebar).toBeVisible();

    // It really is the fixed bottom region, not the desktop sidebar.
    const position = await sidebar.evaluate(
      (element) => getComputedStyle(element).position,
    );
    expect(position, 'bottom navigation is fixed').toBe('fixed');

    const logo = sidebar.locator(`> .brand ${LOGO}`);
    await expect(logo, 'bottom navigation logo').toHaveCount(1);
    await expect(logo).toBeVisible();

    const metrics = await measure(logo);
    expectDecoded(metrics, 'administrator bottom navigation');
    expectUndistorted(metrics, 'administrator bottom navigation');
    expect(
      await clippedByAncestor(logo),
      'bottom navigation logo is clipped',
    ).toBe(false);

    // Same artwork as the desktop sidebar — no narrow-width substitute.
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(sidebar).toBeVisible();
    const desktop = await measure(page.locator(`.admin-sidebar > .brand ${LOGO}`));
    expect(desktop.currentSrc, 'narrow and wide use one artwork').toBe(
      metrics.currentSrc,
    );

    // And no text-only placeholder stood in for it: the retired marks are gone
    // at this width too.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const retired of RETIRED_MARKS) {
      await expect(page.locator(retired), retired).toHaveCount(0);
    }
  });

  test('AC: the bottom-navigation logo neither overlaps nor blocks a navigation control', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/dashboard');

    const logo = page.locator(`.admin-sidebar > .brand ${LOGO}`);
    await expect(logo).toBeVisible();

    // Scoped to the fixed region: the story explicitly permits that region to
    // overlay scrolling page content, so only what shares the bar is in play.
    const overlaps = await overlapsWithObstructables(
      logo,
      '.admin-sidebar nav, .admin-sidebar a[href], .admin-sidebar button',
    );
    expect(
      overlaps,
      `bottom-navigation logo overlaps ${JSON.stringify(overlaps)}`,
    ).toEqual([]);

    // Every destination stays reachable through the bar's own horizontal
    // scrolling, and the logo rail does not eat any of them.
    const links = page.locator('.admin-sidebar nav a[href]');
    const count = await links.count();
    expect(count, 'administrator destinations in the bottom bar').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      await link.scrollIntoViewIfNeeded();
      expect(
        await isReachable(link),
        `destination ${index} reachable after scrolling`,
      ).toBe(true);
    }
  });

  test('AC: the logo stays inside the fixed region and page content scrolls clear of it', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/dashboard');

    const bar = await page.locator('.admin-sidebar').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    });
    const box = await page.locator(`.admin-sidebar > .brand ${LOGO}`).boundingBox();
    expect(box, 'bottom-navigation logo box').not.toBeNull();

    // Entirely within the region, and not making the region taller.
    expect(box!.y).toBeGreaterThanOrEqual(bar.top - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar.bottom + 1);
    expect(bar.height, 'fixed region height').toBeLessThanOrEqual(80);

    // Content underneath can be scrolled above the fixed region and read. The
    // shell reserves the region's height as bottom padding for exactly this.
    const reserved = await page
      .locator('.catalog-admin-shell')
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
    expect(reserved, 'shell reserves room for the fixed region').toBeGreaterThanOrEqual(
      bar.height,
    );
  });
});

// ---- AC: assistive technology ----------------------------------------------

test.describe('the logo is identifiable to assistive technology', () => {
  for (const placement of PLACEMENTS) {
    test(`AC: ${placement.name} announces the logo exactly once`, async ({
      page,
    }) => {
      await establish(page, placement.session);
      const logo = await gotoPlacement(page, placement);

      // The name is on the image itself…
      await expect(logo).toHaveAccessibleName(LOGO_NAME);

      // …and not duplicated onto the wrapper that also holds the visible shop
      // name, which would announce the identity twice.
      const wrapper = page.locator(placement.lockup);
      await expect(wrapper).not.toHaveAttribute('aria-label', /.+/);
      await expect(wrapper).not.toHaveAttribute('aria-labelledby', /.+/);
      await expect(wrapper).not.toHaveAttribute('role', 'img');

      // Exactly one thing on the whole screen carries this name.
      await expect(
        page.getByRole('img', { name: LOGO_NAME }),
        `${placement.name}: elements named "${LOGO_NAME}"`,
      ).toHaveCount(1);

      // Any decorative copy of the same artwork is hidden from AT rather than
      // announced a second time.
      const exposedLogos = await page
        .locator(LOGO)
        .evaluateAll((elements) =>
          elements.filter(
            (element) => element.closest('[aria-hidden="true"]') === null,
          ).length,
        );
      expect(exposedLogos, `${placement.name}: logos exposed to AT`).toBe(1);
    });
  }
});

// ---- AC: the browser-tab favicon -------------------------------------------

test.describe('browser tab favicon', () => {
  test('AC: a favicon is declared, loads, and decodes to a non-empty image', async ({
    page,
    request,
  }) => {
    await page.goto('/sign-in');

    const icons = page.locator('link[rel~="icon"]');
    await expect(icons, 'favicon declarations').toHaveCount(1);

    const href = await icons.first().getAttribute('href');
    expect(href, 'favicon href').toBeTruthy();

    const url = new URL(href!, page.url()).toString();
    const response = await request.get(url);
    expect(response.status(), `favicon ${url}`).toBe(200);
    expect(
      response.headers()['content-type'] ?? '',
      'favicon content type',
    ).toContain('image');

    const decoded = await page.evaluate(
      (source) =>
        new Promise<{ width: number; height: number } | null>((resolve) => {
          const image = new Image();
          image.onload = () =>
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => resolve(null);
          image.src = source;
        }),
      url,
    );
    expect(decoded, 'favicon decodes').not.toBeNull();
    expect(decoded!.width, 'favicon intrinsic width').toBeGreaterThan(0);
    expect(decoded!.height, 'favicon intrinsic height').toBeGreaterThan(0);
  });

  test('AC: the favicon is the same artwork as the in-app logo, only resized', async ({
    page,
  }) => {
    await page.goto('/sign-in');

    const logoSrc = await page
      .locator(`.site-header .brand ${LOGO}`)
      .evaluate((element) => (element as HTMLImageElement).currentSrc);
    const faviconHref = await page
      .locator('link[rel~="icon"]')
      .first()
      .getAttribute('href');
    const faviconSrc = new URL(faviconHref!, page.url()).toString();

    /**
     * "Changed only by uniform resizing and/or format conversion" is checked by
     * resampling both images onto a common grid and comparing them pixel by
     * pixel over white. A recolour, a redraw, a crop or an unrelated mark moves
     * pixels well past this tolerance; a resize and a re-encode do not. Both
     * images are same-origin, so the canvas stays readable.
     *
     * The grid is the favicon's own resolution, not an arbitrary thumbnail.
     * Comparing two independently downscaled thumbnails measures the browser's
     * resampling filter as much as the artwork — on this pair the apparent
     * difference falls steadily from ~14 at 8px to ~1.8 at 512px purely from
     * that effect. Sampling where one image is already native keeps the number
     * a statement about the artwork.
     */
    const comparison = await page.evaluate(
      async ([a, b]) => {
        async function intrinsicWidth(source: string): Promise<number> {
          const image = new Image();
          image.src = source;
          await image.decode();
          return image.naturalWidth;
        }

        const GRID = Math.min(await intrinsicWidth(b!), 512);

        async function sample(source: string): Promise<Uint8ClampedArray | null> {
          const image = new Image();
          image.src = source;
          try {
            await image.decode();
          } catch {
            return null;
          }
          const canvas = document.createElement('canvas');
          canvas.width = GRID;
          canvas.height = GRID;
          const context = canvas.getContext('2d');
          if (!context) return null;
          // Composite over white so transparent padding compares equal rather
          // than as undefined RGB noise.
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, GRID, GRID);
          context.drawImage(image, 0, 0, GRID, GRID);
          return context.getImageData(0, 0, GRID, GRID).data;
        }

        const [left, right] = await Promise.all([sample(a!), sample(b!)]);
        if (!left || !right) return null;

        let total = 0;
        let samples = 0;
        for (let index = 0; index < left.length; index += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            total += Math.abs(left[index + channel]! - right[index + channel]!);
            samples += 1;
          }
        }
        return { meanChannelDifference: total / samples, grid: GRID };
      },
      [logoSrc, faviconSrc] as const,
    );

    expect(comparison, 'both images sampled').not.toBeNull();
    // Same artwork, uniformly resized, sits near 2 on this scale; anything
    // recoloured, redrawn, cropped or replaced lands far above 8.
    expect(
      comparison!.meanChannelDifference,
      `mean per-channel difference between favicon and in-app logo at ${comparison?.grid}px`,
    ).toBeLessThan(8);

    // Uniform resizing preserves the aspect ratio.
    const ratios = await page.evaluate(
      async ([a, b]) => {
        async function ratio(source: string): Promise<number | null> {
          const image = new Image();
          image.src = source;
          try {
            await image.decode();
          } catch {
            return null;
          }
          return image.naturalWidth / image.naturalHeight;
        }
        return Promise.all([ratio(a!), ratio(b!)]);
      },
      [logoSrc, faviconSrc] as const,
    );

    expect(ratios[0], 'in-app logo ratio').not.toBeNull();
    expect(ratios[1], 'favicon ratio').not.toBeNull();
    expect(
      Math.abs(ratios[1]! - ratios[0]!) / ratios[0]!,
      'favicon aspect ratio drift from the source artwork',
    ).toBeLessThanOrEqual(0.01);
  });
});
