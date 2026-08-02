import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';
import { shopToday } from './fixtures/reporting-seed';
import {
  closeOrderDay,
  editCatalogAfterSale,
  openOrderDay,
  readOrders,
  readProductAvailability,
  resetOrderWorld,
  seedOrderCatalog,
  seedOrderStaff,
  setCategoryFreeUpsizeEligible,
  setProductAvailability,
  type SeededOrderCatalog,
  type SeededOrderDay,
  type SeededOrderStaff,
  type StoredOrderLine,
} from './fixtures/take-order';

/**
 * End-to-end coverage for the Take Order workspace — story #197, QA task #206.
 *
 * Scope split: this file covers access, layout, catalog rendering, the order
 * header, lines, preferences, discounts, free upsize, totals arithmetic,
 * snapshots, park/resume and save idempotency. Payment, change, completion,
 * void and cashier attribution are in `order-settlement.spec.ts`; together the
 * two files cover the story's acceptance criteria.
 *
 * Two conventions matter for anyone editing this file:
 *
 *  - **The catalog is shared.** Every active category renders in the grid, so
 *    assertions either search for this run's own tagged products or compare the
 *    relative order of this run's own rows. Never assert a global count.
 *  - **Money is asserted from the database.** `readOrders()` returns stored
 *    integer cents. The screen is asserted for what staff must see; the stored
 *    amounts are asserted for what was actually charged. The ₱96-vs-₱90 case in
 *    particular is a statement about composition order, and a UI-only assertion
 *    would not catch a correctly formatted wrong number.
 */

// Not `serial`: `beforeEach` resets the trading-day world and every test signs
// in fresh, so each one stands alone. Serial mode would skip the rest of the
// file after the first failure and hide the true state of the story.
test.use({ viewport: { width: 1024, height: 768 } });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;

/** Every control the touch-target criterion names that lives on the main screen. */
const MINIMUM_TOUCH_TARGET_PX = 44;

let catalog: SeededOrderCatalog;
let staffMember: SeededOrderStaff;
let day: SeededOrderDay;

test.beforeAll(() => {
  catalog = seedOrderCatalog(RUN);
  staffMember = seedOrderStaff(`QA Order Opener ${RUN}`);
});

test.beforeEach(() => {
  resetOrderWorld();
  day = openOrderDay({
    businessDate: shopToday(),
    openedByStaffMemberId: staffMember.id,
  });
});

// ---- page objects -----------------------------------------------------------

function catalogPane(page: Page): Locator {
  return page.getByRole('region', { name: 'Take order' });
}

function currentOrder(page: Page): Locator {
  return page.getByRole('complementary');
}

function productCard(page: Page, productName: string): Locator {
  return catalogPane(page)
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: productName, exact: true }) });
}

function sizeButton(page: Page, productName: string, size: string): Locator {
  return productCard(page, productName).getByRole('button', {
    name: new RegExp(`^${size}\\b`),
  });
}

function orderLines(page: Page): Locator {
  return currentOrder(page).getByRole('article');
}

/** The order's only line — for the many tests that build a single-line order. */
function soleLine(page: Page): Locator {
  return orderLines(page);
}

/**
 * Address an order line by what it shows, never by position.
 *
 * The API returns lines ordered by their (random UUID) id, so the rendered
 * order is not insertion order and a positional index would silently point at
 * the wrong line. Every filter is applied in turn, so `orderLineShowing(page,
 * 'Regular ·', 'Senior')` is the Regular line that carries the Senior discount.
 */
function orderLineShowing(page: Page, ...texts: string[]): Locator {
  return texts.reduce<Locator>(
    (locator, text) => locator.filter({ hasText: text }),
    orderLines(page),
  );
}

/** The single line whose unit price identifies it, from the stored record. */
function storedLineAt(
  order: { lines: StoredOrderLine[] },
  unitPriceCents: number,
): StoredOrderLine {
  const matches = order.lines.filter(
    (line) => line.unitPriceCents === unitPriceCents,
  );
  expect(
    matches,
    `expected exactly one stored line priced ${unitPriceCents}`,
  ).toHaveLength(1);
  return matches[0];
}

function totalRow(page: Page, term: string): Locator {
  return currentOrder(page)
    .locator('dl div')
    .filter({ has: page.getByText(term, { exact: true }) })
    .locator('dd');
}

function announcement(page: Page): Locator {
  return page.locator('.take-order-message');
}

function errorAlert(page: Page): Locator {
  return page.locator('.take-order-error');
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  const username = page.locator('#staff-username');
  await expect(username).toBeVisible();
  // The form autofocuses on a requestAnimationFrame. Clicking the field first
  // pins focus, so the password fill cannot be re-routed into the username box.
  await username.click();
  await username.fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Sign-in lands on the staff workspace; Take Order is its default screen.
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function openTakeOrder(page: Page): Promise<void> {
  await page.goto('/pos/order');
  await expect(page.getByRole('heading', { name: 'Take order' })).toBeVisible();
}

async function signInAndOpenTakeOrder(page: Page): Promise<void> {
  await signInAsStaff(page);
  await openTakeOrder(page);
}

/** Narrow the grid to one product so shared catalog rows cannot interfere. */
async function searchFor(page: Page, productName: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search products' }).fill(productName);
  await expect(productCard(page, productName)).toBeVisible();
}

async function addSize(
  page: Page,
  productName: string,
  size: string,
): Promise<void> {
  await sizeButton(page, productName, size).click();
  // Every add is a server round trip; the aside re-renders when it lands.
  await expect(currentOrder(page).getByText('Order is empty')).toBeHidden();
}

async function openLineEditor(
  page: Page,
  line: Locator,
  control: 'Preferences' | 'Discount' | 'Free upsize',
): Promise<Locator> {
  await line.getByRole('button', { name: control }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Assert a control is actually on screen, then click it.
 *
 * `.take-order-page` is `overflow: clip`, so a control pushed below it can
 * never be scrolled to and Playwright reports only a 30-second timeout that
 * says nothing about why. Checking the box first fails in a second with a
 * message that names the problem.
 */
async function clickOnScreen(
  page: Page,
  control: Locator,
  label: string,
): Promise<void> {
  const box = await control.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  const viewportHeight = page.viewportSize()!.height;
  expect(
    Math.round(box!.y + box!.height),
    `${label} should be on screen, not below the clipped order panel`,
  ).toBeLessThanOrEqual(viewportHeight);
  await control.click();
}

async function saveLineEditor(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Save line' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

// ---- access and business day ------------------------------------------------

test.describe('Access and business day', () => {
  test('a signed-in staff member can take an order while a day is open', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    await expect(
      page.getByRole('heading', { name: 'Take order' }),
    ).toBeVisible();
    await expect(currentOrder(page)).toContainText('New order');
    await expect(currentOrder(page).getByText('Order is empty')).toBeVisible();
  });

  test('with no business day open the workflow explains why and points to Open Day', async ({
    page,
  }) => {
    closeOrderDay(day.id);
    await signInAsStaff(page);

    // Reached by direct navigation.
    await page.goto('/pos/order');

    await expect(
      page.getByRole('heading', { name: 'No business day is open' }),
    ).toBeVisible();
    await expect(
      page.getByText('An order cannot be started until today’s business day is open.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open business day' }),
    ).toBeVisible();
    // No order could have been started.
    expect(readOrders()).toHaveLength(0);
  });

  test('a day closed while the screen is open refuses the save with a clear message', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);

    // The screen was loaded against an open day; the day closes underneath it.
    closeOrderDay(day.id);
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();

    await expect(errorAlert(page)).toContainText('No business day is open');
    expect(readOrders()).toHaveLength(0);
  });
});

// ---- touch layout -----------------------------------------------------------

test.describe('Touch layout at 1024×768', () => {
  test('the workspace fits without page-level horizontal scrolling', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The three panes the criterion names are all usable on screen.
    await expect(catalogPane(page)).toBeVisible();
    await expect(currentOrder(page)).toBeVisible();
    await expect(
      currentOrder(page).getByRole('button', { name: /^Charge/ }),
    ).toBeVisible();
  });

  test('the totals and primary actions are on screen on a freshly loaded empty order', async ({
    page,
  }) => {
    // This is the very first thing staff see, and it is also the state they
    // come back to when resuming a parked order, so the totals block, the
    // park/charge row and the parked-orders list all have to be reachable
    // before any other interaction happens.
    await signInAndOpenTakeOrder(page);
    await expect(currentOrder(page).getByText('Order is empty')).toBeVisible();

    const viewportHeight = page.viewportSize()!.height;
    for (const [label, locator] of [
      ['totals', currentOrder(page).locator('dl.current-order-totals')],
      ['order actions', currentOrder(page).locator('.current-order-actions')],
    ] as Array<[string, Locator]>) {
      const box = await locator.boundingBox();
      expect(box, `${label} should be laid out`).not.toBeNull();
      expect(
        Math.round(box!.y),
        `${label} should start within the ${viewportHeight}px viewport`,
      ).toBeLessThan(viewportHeight);
    }
  });

  test('order controls meet the 44×44 CSS pixel touch target', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const line = soleLine(page);
    const controls: Array<[string, Locator]> = [
      ['product size', sizeButton(page, catalog.products.espresso.name, 'Regular')],
      [
        'availability',
        productCard(page, catalog.products.espresso.name).getByRole('button', {
          name: /^Mark /,
        }),
      ],
      [
        'order type Dine-in',
        currentOrder(page)
          .getByRole('group', { name: 'Order type' })
          .getByRole('button', { name: 'Dine-in' }),
      ],
      [
        'order type Take-out',
        currentOrder(page)
          .getByRole('group', { name: 'Order type' })
          .getByRole('button', { name: 'Take-out' }),
      ],
      ['increase quantity', line.getByRole('button', { name: /^Increase / })],
      ['decrease quantity', line.getByRole('button', { name: /^Decrease / })],
      ['preferences', line.getByRole('button', { name: 'Preferences' })],
      ['discount', line.getByRole('button', { name: 'Discount' })],
      ['free upsize', line.getByRole('button', { name: 'Free upsize' })],
      ['remove line', line.getByRole('button', { name: /^Remove / })],
      ['park', currentOrder(page).getByRole('button', { name: 'Park order' })],
      ['charge', currentOrder(page).getByRole('button', { name: /^Charge/ })],
    ];

    for (const [label, control] of controls) {
      const box = await control.boundingBox();
      expect(box, `${label} control should be laid out`).not.toBeNull();
      expect(
        Math.round(box!.width),
        `${label} control width`,
      ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
      expect(
        Math.round(box!.height),
        `${label} control height`,
      ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
    }
  });
});

// ---- catalog rendering and availability -------------------------------------

test.describe('Catalog rendering and availability', () => {
  test('products render under their active categories in the maintained order', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    // Category headings for this run appear in maintained sort-weight order.
    const headings = catalogPane(page).getByRole('heading', {
      name: new RegExp(`QA (Coffee|Bakery) ${RUN}`),
    });
    await expect(headings).toHaveText([
      catalog.eligibleCategoryName,
      catalog.ineligibleCategoryName,
    ]);

    const espresso = productCard(page, catalog.products.espresso.name);
    await expect(espresso).toContainText('Available');
    // Each size shows its label and current price.
    await expect(
      espresso.getByRole('button', { name: /^Regular/ }),
    ).toContainText('₱150.00');
    await expect(
      espresso.getByRole('button', { name: /^Large/ }),
    ).toContainText('₱180.00');

    // The eligible category is marked as such; the other is not.
    await expect(
      catalogPane(page)
        .getByRole('region', { name: catalog.eligibleCategoryName })
        .getByText('Free upsize eligible'),
    ).toBeVisible();
    await expect(
      catalogPane(page)
        .getByRole('region', { name: catalog.ineligibleCategoryName })
        .getByText('Free upsize eligible'),
    ).toHaveCount(0);
  });

  test('a sold-out product stays visible but cannot be added', async ({
    page,
  }) => {
    setProductAvailability(catalog.products.latte.id, false);
    try {
      await signInAndOpenTakeOrder(page);
      await searchFor(page, catalog.products.latte.name);

      const card = productCard(page, catalog.products.latte.name);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Sold out');
      await expect(
        card.getByRole('button', { name: /^Regular/ }),
      ).toBeDisabled();
      expect(readOrders()).toHaveLength(0);
    } finally {
      setProductAvailability(catalog.products.latte.id, true);
    }
  });

  test('marking sold out from the grid survives a reload and reaches the back office', async ({
    page,
    browser,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.tiny.name);

    try {
      await productCard(page, catalog.products.tiny.name)
        .getByRole('button', { name: 'Mark sold out' })
        .click();
      await expect(announcement(page)).toContainText('marked sold out');
      expect(readProductAvailability(catalog.products.tiny.id)).toBe(false);

      // Persists across a reload of the order screen.
      await page.reload();
      await searchFor(page, catalog.products.tiny.name);
      await expect(
        productCard(page, catalog.products.tiny.name),
      ).toContainText('Sold out');

      // And in the back-office catalog, in a separate admin session.
      const adminContext = await browser.newContext({
        baseURL: page.url().replace(/\/pos.*$/, ''),
      });
      const adminPage = await adminContext.newPage();
      try {
        await adminPage.goto('/sign-in');
        await adminPage
          .locator('#username')
          .fill(process.env.E2E_ADMIN_USERNAME ?? 'admin');
        await adminPage
          .locator('#password')
          .fill(process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding');
        await adminPage.getByRole('button', { name: 'Sign in' }).click();
        await expect(adminPage).toHaveURL(/\/dashboard$/);

        await adminPage.goto('/catalog/products');
        await expect(
          adminPage.getByRole('heading', { name: 'Products' }),
        ).toBeVisible();
        // The product table is paged, so narrow it to this run's product first.
        await adminPage
          .getByRole('searchbox', { name: 'Search product name' })
          .fill(catalog.products.tiny.name);
        await expect(
          adminPage
            .getByRole('row')
            .filter({ hasText: catalog.products.tiny.name }),
        ).toContainText('Sold out');
      } finally {
        await adminContext.close();
      }

      // Marking it available again also persists.
      await productCard(page, catalog.products.tiny.name)
        .getByRole('button', { name: 'Mark available' })
        .click();
      await expect(announcement(page)).toContainText('marked available');
      expect(readProductAvailability(catalog.products.tiny.id)).toBe(true);
    } finally {
      setProductAvailability(catalog.products.tiny.id, true);
    }
  });
});

// ---- order header -----------------------------------------------------------

test.describe('Order header', () => {
  test('a new order defaults to Dine-in, visibly and programmatically', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    const orderType = currentOrder(page).getByRole('group', {
      name: 'Order type',
    });
    await expect(
      orderType.getByRole('button', { name: 'Dine-in' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      orderType.getByRole('button', { name: 'Take-out' }),
    ).toHaveAttribute('aria-pressed', 'false');

    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    expect(readOrders()[0].serviceType).toBe('DINE_IN');
  });

  test('service type and customer name can be changed; no name is a walk-in', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const orderType = currentOrder(page).getByRole('group', {
      name: 'Order type',
    });
    await orderType.getByRole('button', { name: 'Take-out' }).click();
    await expect(
      orderType.getByRole('button', { name: 'Take-out' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => readOrders()[0].serviceType).toBe('TAKE_OUT');

    const name = currentOrder(page).getByLabel('Customer name (optional)');
    // No name yet — the order is a walk-in, shown by the placeholder.
    await expect(name).toHaveAttribute('placeholder', 'Walk-in');
    expect(readOrders()[0].customerName).toBeNull();

    await name.fill('Mina Santos');
    await name.blur();
    await expect.poll(() => readOrders()[0].customerName).toBe('Mina Santos');

    await name.fill('Mina S. Reyes');
    await name.blur();
    await expect.poll(() => readOrders()[0].customerName).toBe('Mina S. Reyes');

    // Removing the name returns the order to a walk-in.
    await name.fill('');
    await name.blur();
    await expect.poll(() => readOrders()[0].customerName).toBeNull();
  });
});

// ---- lines ------------------------------------------------------------------

test.describe('Lines', () => {
  test('the first item saves the order and takes the next order number for the day', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    await expect(currentOrder(page)).toContainText('Order #1');
    const [first] = readOrders();
    expect(first.dayOrderNumber).toBe(1);
    expect(first.status).toBe('PARKED');

    // Park it, start another: the next order takes the next number.
    await currentOrder(page).getByRole('button', { name: 'Park order' }).click();
    await expect(announcement(page)).toContainText('Order #1 parked.');
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await expect(currentOrder(page)).toContainText('Order #2');
    expect(readOrders().map((order) => order.dayOrderNumber)).toEqual([1, 2]);
  });

  test('re-selecting the same plain product and size increments instead of duplicating', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();

    await expect(orderLines(page)).toHaveCount(1);
    await expect
      .poll(() => readOrders()[0].lines[0].quantity)
      .toBe(2);

    // A different size is a different line, not a merge.
    await addSize(page, catalog.products.espresso.name, 'Large');
    await expect(orderLines(page)).toHaveCount(2);
  });

  test('quantity can be increased, decreased, and the last unit removes the line', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const line = soleLine(page);
    await line.getByRole('button', { name: /^Increase / }).click();
    await expect.poll(() => readOrders()[0].lines[0].quantity).toBe(2);
    await expect(line).toContainText('₱300.00');

    await line.getByRole('button', { name: /^Decrease / }).click();
    await expect.poll(() => readOrders()[0].lines[0].quantity).toBe(1);

    // Reducing the last unit removes the line — and with it the empty order.
    await line.getByRole('button', { name: /^Decrease / }).click();
    expect(readOrders()).toHaveLength(0);
    // The discard succeeded, so the screen must follow it: no error, and the
    // deleted order must not still be sitting in the panel.
    await expect(errorAlert(page)).toHaveCount(0);
    await expect(currentOrder(page).getByText('Order is empty')).toBeVisible();
  });

  test('Remove clears a line and leaves the other lines untouched', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await addSize(page, catalog.products.espresso.name, 'Large');
    await expect(orderLines(page)).toHaveCount(2);

    await orderLineShowing(page, 'Regular ·')
      .getByRole('button', { name: /^Remove / })
      .click();
    await expect(orderLines(page)).toHaveCount(1);
    const lines = readOrders()[0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].variantNameSnapshot).toBe('Large');
  });

  test('preferences and a note apply to one line only', async ({ page }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await addSize(page, catalog.products.espresso.name, 'Large');

    const dialog = await openLineEditor(
      page,
      orderLineShowing(page, 'Regular ·'),
      'Preferences',
    );
    for (const preference of ['Sweeter', 'Stronger', 'Less sweet', 'Less ice']) {
      await dialog.getByRole('checkbox', { name: preference }).check();
    }
    // ADR 0008 §3: Sweeter with Less sweet is deliberately accepted.
    await expect(dialog).toContainText('will be saved as requested');
    await dialog
      .getByLabel('Preparation note (optional)')
      .fill('Serve in a ceramic cup');
    await saveLineEditor(page, dialog);

    const order = readOrders()[0];
    const regular = storedLineAt(order, 15000);
    const large = storedLineAt(order, 18000);
    expect([...regular.preferences].sort()).toEqual(
      ['LESS_ICE', 'LESS_SWEET', 'STRONGER', 'SWEETER'].sort(),
    );
    expect(regular.preferenceNote).toBe('Serve in a ceramic cup');
    // The other line is untouched.
    expect(large.preferences).toEqual([]);
    expect(large.preferenceNote).toBeNull();

    await expect(orderLineShowing(page, 'Regular ·')).toContainText(
      'Serve in a ceramic cup',
    );
    await expect(orderLineShowing(page, 'Large ·')).not.toContainText('Sweeter');
  });

  test('a whitespace-only note is stored as absent and 255 characters is accepted', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const whitespace = await openLineEditor(page, soleLine(page), 'Preferences');
    await whitespace.getByLabel('Preparation note (optional)').fill('     ');
    await saveLineEditor(page, whitespace);
    expect(readOrders()[0].lines[0].preferenceNote).toBeNull();

    const boundary = 'x'.repeat(255);
    const atLimit = await openLineEditor(page, soleLine(page), 'Preferences');
    await atLimit.getByLabel('Preparation note (optional)').fill(boundary);
    await expect(atLimit).toContainText('255 / 255 characters');
    await saveLineEditor(page, atLimit);
    expect(readOrders()[0].lines[0].preferenceNote).toBe(boundary);

    // One character over is refused with a clear message and nothing is saved.
    const overLimit = await openLineEditor(page, soleLine(page), 'Preferences');
    await overLimit.getByLabel('Preparation note (optional)').fill('y'.repeat(256));
    await expect(overLimit).toContainText(
      'Shorten the note to 255 characters or fewer.',
    );
    await expect(
      overLimit.getByRole('button', { name: 'Save line' }),
    ).toBeDisabled();
    await overLimit.getByRole('button', { name: 'Cancel' }).click();
    expect(readOrders()[0].lines[0].preferenceNote).toBe(boundary);
  });

  test('None, PWD and Senior each take 20% off that line only, with no ID fields', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular'); // ₱150.00
    await addSize(page, catalog.products.espresso.name, 'Large'); // ₱180.00

    const pwd = await openLineEditor(
      page,
      orderLineShowing(page, 'Regular ·'),
      'Discount',
    );
    await expect(pwd).not.toContainText('ID number');
    await expect(pwd).toContainText('without customer ID details');
    await pwd.getByRole('radio', { name: 'PWD' }).check();
    await saveLineEditor(page, pwd);

    let order = readOrders()[0];
    expect(storedLineAt(order, 15000).discountKind).toBe('PWD');
    expect(storedLineAt(order, 15000).discountCents).toBe(3000);
    expect(storedLineAt(order, 15000).lineTotalCents).toBe(12000);
    // No cascade onto the other line.
    expect(storedLineAt(order, 18000).discountKind).toBe('NONE');
    expect(storedLineAt(order, 18000).discountCents).toBe(0);

    const senior = await openLineEditor(
      page,
      orderLineShowing(page, 'Large ·'),
      'Discount',
    );
    await senior.getByRole('radio', { name: 'Senior' }).check();
    await saveLineEditor(page, senior);

    order = readOrders()[0];
    expect(storedLineAt(order, 18000).discountKind).toBe('SENIOR');
    expect(storedLineAt(order, 18000).discountCents).toBe(3600);
    expect(storedLineAt(order, 18000).lineTotalCents).toBe(14400);

    // Back to None clears just that line's discount.
    const none = await openLineEditor(
      page,
      orderLineShowing(page, 'Regular ·'),
      'Discount',
    );
    await none.getByRole('radio', { name: 'None' }).check();
    await saveLineEditor(page, none);
    order = readOrders()[0];
    expect(storedLineAt(order, 15000).discountKind).toBe('NONE');
    expect(storedLineAt(order, 15000).discountCents).toBe(0);
    expect(storedLineAt(order, 18000).discountKind).toBe('SENIOR');
  });
});

// ---- merge-key negatives ----------------------------------------------------

test.describe('Merge-key negatives', () => {
  test('a customised line never absorbs a plain add, and lines edited alike stay apart', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    // Give line one a preference, then add the same product and size again.
    const preferences = await openLineEditor(page, soleLine(page), 'Preferences');
    await preferences.getByRole('checkbox', { name: 'Stronger' }).check();
    await saveLineEditor(page, preferences);
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
    await expect(orderLines(page)).toHaveCount(2);

    // Editing them to look identical must leave two lines, not merge them.
    const clear = await openLineEditor(
      page,
      orderLineShowing(page, 'Stronger'),
      'Preferences',
    );
    await clear.getByRole('checkbox', { name: 'Stronger' }).uncheck();
    await saveLineEditor(page, clear);

    await expect(orderLines(page)).toHaveCount(2);
    const lines = readOrders()[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].preferences).toEqual([]);
    expect(lines[1].preferences).toEqual([]);
    expect(lines[0].quantity).toBe(1);
    expect(lines[1].quantity).toBe(1);
  });

  test('a discounted line and an upsized line each stay separate from a plain add', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);

    // Discounted line does not absorb a plain add.
    await addSize(page, catalog.products.espresso.name, 'Regular');
    const discount = await openLineEditor(page, soleLine(page), 'Discount');
    await discount.getByRole('radio', { name: 'Senior' }).check();
    await saveLineEditor(page, discount);
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
    await expect(orderLines(page)).toHaveCount(2);

    // Upsized line does not absorb a plain add either. The plain line is the
    // one the Senior discount is not on.
    const upsize = await openLineEditor(
      page,
      orderLines(page).filter({ hasNotText: 'Senior' }),
      'Free upsize',
    );
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);
    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
    await expect(orderLines(page)).toHaveCount(3);

    const lines = readOrders()[0].lines;
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.discountKind === 'SENIOR')).toHaveLength(1);
    expect(lines.filter((line) => line.freeUpsizeCount === 1)).toHaveLength(1);
  });
});

// ---- free upsize ------------------------------------------------------------

test.describe('Free upsize', () => {
  test('is offered only on a line from an eligible category', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    // An ineligible line cannot reach the promotion.
    await searchFor(page, catalog.products.croissant.name);
    await addSize(page, catalog.products.croissant.name, 'Regular');
    const croissantLine = orderLineShowing(page, catalog.products.croissant.name);
    await expect(
      croissantLine.getByRole('button', { name: 'Free upsize' }),
    ).toBeDisabled();
    expect(readOrders()[0].lines[0].freeUpsizeEligible).toBe(false);

    // Adding an eligible line makes it available on that line, not the other.
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    const espressoLine = orderLineShowing(page, catalog.products.espresso.name);
    await expect(
      croissantLine.getByRole('button', { name: 'Free upsize' }),
    ).toBeDisabled();
    await expect(
      espressoLine.getByRole('button', { name: 'Free upsize' }),
    ).toBeEnabled();

    // The promotion attaches to the eligible line only.
    const upsize = await openLineEditor(page, espressoLine, 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);
    const order = readOrders()[0];
    expect(storedLineAt(order, 9000).freeUpsizeCount).toBe(0);
    expect(storedLineAt(order, 15000).freeUpsizeCount).toBe(1);
    expect(storedLineAt(order, 15000).freeUpsizeCents).toBe(3000);
  });

  test('each upsize takes ₱30 off and is shown apart from a line discount', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    await expect(totalRow(page, 'Amount due')).toHaveText('₱150.00');

    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);

    await expect(totalRow(page, 'Free upsize')).toHaveText('−₱30.00');
    await expect(totalRow(page, 'Line discounts')).toHaveText('₱0.00');
    await expect(totalRow(page, 'Amount due')).toHaveText('₱120.00');
    await expect(soleLine(page)).toContainText('1 free upsize · −₱30.00');
  });

  test('the upsize count may equal the quantity but never exceed it', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await soleLine(page).getByRole('button', { name: /^Increase / }).click();
    await expect.poll(() => readOrders()[0].lines[0].quantity).toBe(2);

    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    const increase = upsize.getByRole('button', {
      name: 'Increase free upsize count',
    });
    await increase.click();
    await increase.click();
    // Count now equals quantity — allowed, and the UI refuses to go further.
    await expect(upsize).toContainText('2');
    await expect(increase).toBeDisabled();
    await saveLineEditor(page, upsize);
    expect(readOrders()[0].lines[0].freeUpsizeCount).toBe(2);
    expect(readOrders()[0].lines[0].freeUpsizeCents).toBe(6000);

    // Quantity cannot then be reduced below the upsize count.
    await expect(
      soleLine(page).getByRole('button', { name: /^Decrease / }),
    ).toBeDisabled();
  });

  test('an upsize worth more than the line gross is refused, not clamped', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.tiny.name);
    await addSize(page, catalog.products.tiny.name, 'Regular'); // ₱25.00

    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await upsize.getByRole('button', { name: 'Save line' }).click();

    await expect(errorAlert(page)).toContainText(
      'Free upsize value cannot exceed the line gross amount',
    );
    const line = readOrders()[0].lines[0];
    expect(line.freeUpsizeCount).toBe(0);
    expect(line.lineTotalCents).toBe(2500);
  });
});

// ---- totals -----------------------------------------------------------------

test.describe('Totals', () => {
  test('the ADR worked example lands on ₱96.00, not ₱90.00', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular'); // ₱150.00

    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);

    const senior = await openLineEditor(page, soleLine(page), 'Discount');
    await senior.getByRole('radio', { name: 'Senior' }).check();
    await saveLineEditor(page, senior);

    // ₱150 gross − ₱30 upsize = ₱120 discount base; 20% of ₱120 is ₱24.
    // ₱90.00 would mean the 20% ran before the promotion — a bug, not rounding.
    const line = readOrders()[0].lines[0];
    expect(line.lineGrossCents).toBe(15000);
    expect(line.freeUpsizeCents).toBe(3000);
    expect(line.discountCents).toBe(2400);
    expect(line.lineTotalCents).toBe(9600);

    await expect(soleLine(page)).toContainText('₱96.00');
    await expect(soleLine(page)).toContainText('Senior · −₱24.00');
  });

  test('the four totals are shown separately, in order, and never netted', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);
    const senior = await openLineEditor(page, soleLine(page), 'Discount');
    await senior.getByRole('radio', { name: 'Senior' }).check();
    await saveLineEditor(page, senior);

    await expect(
      currentOrder(page).locator('dl.current-order-totals dt'),
    ).toHaveText([
      'Pre-discount subtotal',
      'Free upsize',
      'Line discounts',
      'Amount due',
    ]);
    await expect(totalRow(page, 'Pre-discount subtotal')).toHaveText('₱150.00');
    await expect(totalRow(page, 'Free upsize')).toHaveText('−₱30.00');
    await expect(totalRow(page, 'Line discounts')).toHaveText('−₱24.00');
    await expect(totalRow(page, 'Amount due')).toHaveText('₱96.00');
  });

  test('visible line amounts sum to the visible order amount', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await searchFor(page, catalog.products.croissant.name);
    await addSize(page, catalog.products.croissant.name, 'Regular');
    await searchFor(page, catalog.products.roundUp.name);
    await addSize(page, catalog.products.roundUp.name, 'Regular');

    // Mix the money features so the sum is not trivially the subtotal.
    const espressoLine = orderLineShowing(page, catalog.products.espresso.name);
    const upsize = await openLineEditor(page, espressoLine, 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);
    const senior = await openLineEditor(page, espressoLine, 'Discount');
    await senior.getByRole('radio', { name: 'Senior' }).check();
    await saveLineEditor(page, senior);
    const pwd = await openLineEditor(
      page,
      orderLineShowing(page, catalog.products.roundUp.name),
      'Discount',
    );
    await pwd.getByRole('radio', { name: 'PWD' }).check();
    await saveLineEditor(page, pwd);

    const order = readOrders()[0];
    const lineSum = order.lines.reduce(
      (total, line) => total + line.lineTotalCents,
      0,
    );
    expect(lineSum).toBe(order.totalCents);
    expect(order.totalCents).toBe(
      order.subtotalCents - order.freeUpsizeCents - order.discountCents,
    );

    // The same identity holds for what is actually on screen.
    const shown = await currentOrder(page)
      .getByRole('article')
      .evaluateAll((articles) =>
        articles.map(
          (article) =>
            article.querySelector('.current-order-line-main strong')
              ?.textContent ?? '',
        ),
      );
    const toCents = (value: string) =>
      Math.round(Number(value.replace(/[^0-9.]/g, '')) * 100);
    expect(shown.reduce((total, value) => total + toCents(value), 0)).toBe(
      order.totalCents,
    );
  });

  test('a 20% discount rounds half-up and leaves no residual', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    // Twenty percent of an integer cent amount always lands on a fifth of a
    // cent, never exactly a half, so an exact .5 case is unreachable. These two
    // pin both sides of the half-up rule instead.
    await searchFor(page, catalog.products.roundUp.name);
    await addSize(page, catalog.products.roundUp.name, 'Regular'); // ₱100.03
    await searchFor(page, catalog.products.roundDown.name);
    await addSize(page, catalog.products.roundDown.name, 'Regular'); // ₱100.01

    for (const productName of [
      catalog.products.roundUp.name,
      catalog.products.roundDown.name,
    ]) {
      const dialog = await openLineEditor(
        page,
        orderLineShowing(page, productName),
        'Discount',
      );
      await dialog.getByRole('radio', { name: 'Senior' }).check();
      await saveLineEditor(page, dialog);
    }

    const order = readOrders()[0];
    // 10003 × 20% = 2000.6 → 2001 (up). 10001 × 20% = 2000.2 → 2000 (down).
    expect(storedLineAt(order, 10003).discountCents).toBe(2001);
    expect(storedLineAt(order, 10003).lineTotalCents).toBe(8002);
    expect(storedLineAt(order, 10001).discountCents).toBe(2000);
    expect(storedLineAt(order, 10001).lineTotalCents).toBe(8001);
    // No residual between the line sum and the order total.
    expect(
      order.lines.reduce((total, line) => total + line.lineTotalCents, 0),
    ).toBe(order.totalCents);
    expect(order.totalCents).toBe(16003);
  });

  test('no total can be typed over', async ({ page }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const totals = currentOrder(page).locator('dl.current-order-totals');
    await expect(totals).toBeVisible();
    // The totals block holds no editable control of any kind.
    await expect(totals.locator('input, textarea, select')).toHaveCount(0);
    await expect(totals.locator('[contenteditable="true"]')).toHaveCount(0);
  });
});

// ---- snapshots --------------------------------------------------------------

test.describe('Snapshots', () => {
  test('a later catalog change does not alter what an order recorded', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.latte.name);
    await addSize(page, catalog.products.latte.name, 'Regular'); // ₱120.00

    const before = readOrders()[0].lines[0];
    expect(before.productNameSnapshot).toBe(catalog.products.latte.name);
    expect(before.unitPriceCents).toBe(12000);

    editCatalogAfterSale({
      productId: catalog.products.latte.id,
      newName: `QA Renamed Latte ${RUN}`,
      variantId: catalog.products.latte.variants.regular.id,
      newPriceCents: 19900,
    });
    setCategoryFreeUpsizeEligible(catalog.eligibleCategoryId, false);

    try {
      const after = readOrders()[0].lines[0];
      expect(after.productNameSnapshot).toBe(catalog.products.latte.name);
      expect(after.variantNameSnapshot).toBe('Regular');
      expect(after.unitPriceCents).toBe(12000);
      expect(after.lineTotalCents).toBe(12000);
      // Eligibility recorded on the line is retained as charged.
      expect(after.freeUpsizeEligible).toBe(true);

      // And the order screen still shows what was charged after a reload.
      await page.reload();
      await expect(currentOrder(page).getByText('Order is empty')).toBeVisible();
      await expect(
        currentOrder(page).getByText(catalog.products.latte.name),
      ).toHaveCount(0);
      await expect(page.getByText('Parked orders')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    } finally {
      editCatalogAfterSale({
        productId: catalog.products.latte.id,
        newName: catalog.products.latte.name,
        variantId: catalog.products.latte.variants.regular.id,
        newPriceCents: 12000,
      });
      setCategoryFreeUpsizeEligible(catalog.eligibleCategoryId, true);
    }
  });
});

// ---- park and resume --------------------------------------------------------

test.describe('Park and resume', () => {
  test('a parked order resumes with everything intact', async ({ page }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');

    const name = currentOrder(page).getByLabel('Customer name (optional)');
    await name.fill('Parked Guest');
    await name.blur();
    await expect.poll(() => readOrders()[0].customerName).toBe('Parked Guest');
    await currentOrder(page)
      .getByRole('group', { name: 'Order type' })
      .getByRole('button', { name: 'Take-out' })
      .click();
    await expect.poll(() => readOrders()[0].serviceType).toBe('TAKE_OUT');

    await soleLine(page).getByRole('button', { name: /^Increase / }).click();
    await expect.poll(() => readOrders()[0].lines[0].quantity).toBe(2);
    const preferences = await openLineEditor(page, soleLine(page), 'Preferences');
    await preferences.getByRole('checkbox', { name: 'Less ice' }).check();
    await preferences.getByLabel('Preparation note (optional)').fill('Extra hot');
    await saveLineEditor(page, preferences);
    const upsize = await openLineEditor(page, soleLine(page), 'Free upsize');
    await upsize.getByRole('button', { name: 'Increase free upsize count' }).click();
    await saveLineEditor(page, upsize);
    const discount = await openLineEditor(page, soleLine(page), 'Discount');
    await discount.getByRole('radio', { name: 'PWD' }).check();
    await saveLineEditor(page, discount);

    const parkedTotals = readOrders()[0];

    await currentOrder(page).getByRole('button', { name: 'Park order' }).click();
    await expect(announcement(page)).toContainText('Order #1 parked.');
    await expect(currentOrder(page).getByText('Order is empty')).toBeVisible();
    // Parking records no payment.
    expect(readOrders()[0].status).toBe('PARKED');
    expect(readOrders()[0].payments).toHaveLength(0);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(currentOrder(page)).toContainText('Order #1');
    await expect(
      currentOrder(page).getByLabel('Customer name (optional)'),
    ).toHaveValue('Parked Guest');
    await expect(
      currentOrder(page)
        .getByRole('group', { name: 'Order type' })
        .getByRole('button', { name: 'Take-out' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(soleLine(page)).toContainText('Less ice');
    await expect(soleLine(page)).toContainText('Extra hot');
    await expect(soleLine(page)).toContainText('1 free upsize · −₱30.00');
    await expect(soleLine(page)).toContainText('PWD');
    await expect(totalRow(page, 'Amount due')).toHaveText(
      `₱${(parkedTotals.totalCents / 100).toFixed(2)}`,
    );
  });

  test('parking an empty order discards it and consumes no order number', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    await clickOnScreen(
      page,
      currentOrder(page).getByRole('button', { name: 'Discard empty order' }),
      'Discard empty order',
    );
    await expect(announcement(page)).toContainText('Empty order discarded.');

    // No parked order appeared.
    await expect(page.getByText('Parked orders')).toHaveCount(0);
    expect(readOrders()).toHaveLength(0);

    // The next real order still takes number 1.
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    await expect(currentOrder(page)).toContainText('Order #1');
    expect(readOrders()[0].dayOrderNumber).toBe(1);
  });

  test('removing the last line discards the order rather than parking it empty', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    expect(readOrders()).toHaveLength(1);

    await soleLine(page).getByRole('button', { name: /^Remove / }).click();
    expect(readOrders()).toHaveLength(0);
    await expect(errorAlert(page)).toHaveCount(0);
    await expect(announcement(page)).toContainText('Empty order discarded.');

    await addSize(page, catalog.products.espresso.name, 'Regular');
    expect(readOrders()[0].dayOrderNumber).toBe(1);
  });

  test('a product sold out mid-order leaves the parked line intact', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.latte.name);
    await addSize(page, catalog.products.latte.name, 'Regular');
    await currentOrder(page).getByRole('button', { name: 'Park order' }).click();
    await expect(announcement(page)).toContainText('Order #1 parked.');

    setProductAvailability(catalog.products.latte.id, false);
    try {
      await page.reload();
      await clickOnScreen(
        page,
        page.getByRole('button', { name: 'Resume' }),
        'Resume parked order',
      );

      await expect(currentOrder(page)).toContainText('Order #1');
      await expect(soleLine(page)).toContainText(catalog.products.latte.name);
      await expect(totalRow(page, 'Amount due')).toHaveText('₱120.00');
      // The order can still be charged.
      await expect(
        currentOrder(page).getByRole('button', { name: /^Charge/ }),
      ).toBeEnabled();
      const line = readOrders()[0].lines[0];
      expect(line.lineTotalCents).toBe(12000);
    } finally {
      setProductAvailability(catalog.products.latte.id, true);
    }
  });
});

// ---- idempotency ------------------------------------------------------------

test.describe('Idempotency', () => {
  test('replaying a save returns the same order and consumes no second number', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);

    let createBody: string | null = null;
    let createUrl: string | null = null;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/orders'
      ) {
        createBody = request.postData();
        createUrl = request.url();
      }
    });

    await searchFor(page, catalog.products.espresso.name);
    await addSize(page, catalog.products.espresso.name, 'Regular');
    const original = readOrders();
    expect(original).toHaveLength(1);
    expect(createBody).not.toBeNull();

    // Replay the identical save, exactly as a retried request would arrive.
    const replay = await page.request.post(createUrl!, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.parse(createBody!) as Record<string, unknown>,
    });
    expect(replay.ok()).toBe(true);
    const replayed = (await replay.json()) as {
      id: string;
      dayOrderNumber: number;
      lines: unknown[];
    };
    expect(replayed.id).toBe(original[0].id);
    expect(replayed.dayOrderNumber).toBe(1);
    expect(replayed.lines).toHaveLength(1);

    const after = readOrders();
    expect(after).toHaveLength(1);
    expect(after[0].dayOrderNumber).toBe(1);
    expect(after[0].lines).toHaveLength(1);
    expect(after[0].lines[0].quantity).toBe(1);
  });

  test('a double-tap on the same size never records two orders', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);

    const size = sizeButton(page, catalog.products.espresso.name, 'Regular');
    await size.dblclick();
    await expect(currentOrder(page)).toContainText('Order #1');

    // Whatever the second tap did to quantity, it is one order with one number.
    const orders = readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].dayOrderNumber).toBe(1);
    expect(orders[0].lines).toHaveLength(1);
  });

  test('a reload mid-save leaves exactly one recorded order', async ({
    page,
  }) => {
    await signInAndOpenTakeOrder(page);
    await searchFor(page, catalog.products.espresso.name);

    // Let the save reach the server, then hold its response back, so the
    // reload lands while the client is still waiting for a reply it never
    // gets. Delaying the *request* instead would only prove that an aborted
    // save records nothing, which is not the case under test.
    await page.route(
      '**/orders',
      async (route) => {
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        // The reload tears the route down; losing that race is the point.
        await route.fulfill({ response }).catch(() => {});
      },
      { times: 1 },
    );

    await sizeButton(page, catalog.products.espresso.name, 'Regular').click();
    await page.waitForTimeout(1_000);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Take order' })).toBeVisible();

    // The in-flight save was recorded once, as order #1, and is resumable.
    await expect.poll(() => readOrders().length).toBe(1);
    const orders = readOrders();
    expect(orders[0].dayOrderNumber).toBe(1);
    expect(orders[0].status).toBe('PARKED');
    expect(orders[0].lines).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  });
});
