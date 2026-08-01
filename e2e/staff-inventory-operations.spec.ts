import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeOpenBusinessDays,
  openBusinessDay,
  readStockCounts,
  readStockMovements,
  resetInventoryOperations,
  seedInventoryItems,
  seedStaffMembers,
  updateStaffMember,
  type SeedItemSpec,
  type SeededItem,
  type SeededStaff,
} from './fixtures/inventory-operations';

/**
 * End-to-end coverage for story #108 — "Record opening and closing stock counts,
 * deliveries and wastage, and review restock status" (QA task #115).
 *
 * Every acceptance criterion listed on #115 is exercised through the real
 * browser → web app → NestJS API → PostgreSQL path (no mocking). The one place a
 * response is intercepted is the double-submit test, which delays the submit
 * POST so the in-flight window is long enough to assert against; the request
 * itself still reaches the API.
 *
 * Screens under test (apps/web/src/App.tsx):
 *   /pos/opening  /pos/closing  /pos/restock  /pos/movements
 *
 * Fixtures. The suite seeds its own stock items, par levels, staff roster and
 * open business day — see e2e/fixtures/inventory-operations.ts for why. Because
 * both count sheets and restock read *the whole* open business day rather than
 * anything this run owns, the specs run serially and every test starts from a
 * cleared counts/movements table and a freshly opened NORMAL business day.
 *
 * Assertions are written to survive the stock items other suites leave behind in
 * the persistent dev database: membership and ordering claims about the full
 * sheet are made as partitions ("every Critical row precedes every non-Critical
 * row") or about this run's own items, never as a fixed row count. Restock is
 * the exception — its rows are exactly the lines of the count this suite
 * submits, so those assertions are exact.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa108-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

const LEVEL_CHOICES = [
  'Empty',
  'Low',
  'Quarter',
  'One-third',
  'Half',
  'Two-thirds',
  'Three-quarters',
  'Full',
];

/**
 * The seeded stock items, chosen so one closing count produces every restock
 * status band, both count methods, an item with no par settings at all, and an
 * item deliberately left blank.
 *
 * `QA Almond Milk` is non-Critical and sorts alphabetically *before*
 * `QA Beans` — so "Critical first, then alphabetical" within the Urgent band is
 * distinguishable from plain alphabetical ordering.
 */
const ITEM_SPECS: Record<string, SeedItemSpec> = {
  beans: {
    name: `QA Beans ${TAG}`,
    unit: 'kg',
    countMethod: 'QUANTITY',
    critical: true,
    par: { parQty: 10, lowThreshold: 6, urgentThreshold: 3 },
  },
  almondMilk: {
    name: `QA Almond Milk ${TAG}`,
    unit: 'L',
    countMethod: 'QUANTITY',
    critical: false,
    par: { parQty: 10, lowThreshold: 8, urgentThreshold: 5 },
  },
  cups: {
    name: `QA Cups 12oz ${TAG}`,
    unit: 'pcs',
    countMethod: 'QUANTITY',
    critical: true,
    par: { parQty: 100, lowThreshold: 40, urgentThreshold: 10 },
  },
  sanitizer: {
    name: `QA Sanitizer ${TAG}`,
    unit: 'bottle',
    countMethod: 'LEVEL',
    critical: true,
    par: null,
  },
  milk: {
    name: `QA Milk ${TAG}`,
    unit: 'L',
    countMethod: 'QUANTITY',
    critical: true,
    par: { parQty: 20, lowThreshold: null, urgentThreshold: null },
  },
  sugar: {
    name: `QA Sugar ${TAG}`,
    unit: 'kg',
    countMethod: 'QUANTITY',
    critical: false,
    par: null,
  },
  syrup: {
    name: `QA Syrup ${TAG}`,
    unit: 'btl',
    countMethod: 'QUANTITY',
    critical: false,
    par: { parQty: 5, lowThreshold: 2, urgentThreshold: 1 },
  },
  napkins: {
    name: `QA Napkins ${TAG}`,
    unit: 'pcs',
    countMethod: 'QUANTITY',
    critical: false,
    par: { parQty: 50, lowThreshold: 20, urgentThreshold: 10 },
  },
};

let items: Record<string, SeededItem>;
let staff: Record<string, SeededStaff>;
let businessDate: string;

/** The business date exactly as the screens render it (StaffInventoryPages.tsx). */
function businessDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(
    new Date(`${isoDate}T00:00:00`),
  );
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  items = seedInventoryItems(TAG, ITEM_SPECS);
  staff = seedStaffMembers({
    ada: { displayName: `QA Ada ${TAG}`, isActive: true },
    bruno: { displayName: `QA Bruno ${TAG}`, isActive: true },
    zara: { displayName: `QA Zara Retired ${TAG}`, isActive: false },
  });
});

test.beforeEach(() => {
  resetInventoryOperations();
  businessDate = openBusinessDay(staff.ada.id, 'NORMAL');
});

test.afterAll(() => {
  // Leave the environment with an open day and no counts, the state the rest of
  // the suite (and a developer opening the app) expects to find.
  resetInventoryOperations();
  openBusinessDay(staff.ada.id, 'NORMAL');
});

// ---------------------------------------------------------------------------
// Sign-in and navigation helpers
// ---------------------------------------------------------------------------

/**
 * Sign in as staff. Deliberately the plain username + password path: it reaches
 * /pos with no cashier or staff-member selection anywhere in the flow, which is
 * the "without selecting a cashier first" half of the navigation criterion.
 */
async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form auto-focuses its first field on the next animation frame. Waiting
  // for that to land first stops it stealing focus mid-fill, which would
  // otherwise drop the password into the username box.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

/**
 * Navigate to a screen and wait for it to finish loading. `.staff-inventory-screen`
 * is only rendered once the screen's data has arrived — waiting on the *absence*
 * of the loading indicator instead would pass before React has even mounted.
 */
async function gotoScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
}

/** The count-sheet row for one stock item. */
function countRow(page: Page, itemName: string): Locator {
  return page.locator('.staff-count-row').filter({ hasText: itemName });
}

function quantityInput(page: Page, itemName: string): Locator {
  return page.getByLabel(`Quantity for ${itemName}`);
}

async function setQuantity(
  page: Page,
  item: SeededItem,
  value: string,
): Promise<void> {
  await quantityInput(page, item.name).fill(value);
}

/**
 * Choose a level. The radio input sits under its label in the touch-target
 * layout, so the label is what a user actually taps.
 */
async function setLevel(
  page: Page,
  item: SeededItem,
  label: string,
): Promise<void> {
  const row = countRow(page, item.name);
  await row.getByText(label, { exact: true }).click();
  await expect(row.getByLabel(label, { exact: true })).toBeChecked();
}

function submitCountButton(page: Page, phase: 'opening' | 'closing'): Locator {
  return page.getByRole('button', { name: `Submit ${phase} count` });
}

/** Fill and submit a complete closing count of every seeded item but Napkins. */
async function submitSeededClosingCount(
  page: Page,
  overrides: Partial<Record<string, string>> = {},
): Promise<void> {
  await gotoScreen(page, '/pos/closing');
  await page.getByLabel('Submitted by').selectOption({
    label: staff.ada.displayName,
  });
  await setQuantity(page, items.beans, overrides.beans ?? '2');
  await setQuantity(page, items.almondMilk, overrides.almondMilk ?? '1');
  await setQuantity(page, items.cups, overrides.cups ?? '30');
  await setLevel(page, items.sanitizer, 'One-third');
  await setQuantity(page, items.milk, overrides.milk ?? '5');
  await setQuantity(page, items.sugar, overrides.sugar ?? '12');
  await setQuantity(page, items.syrup, overrides.syrup ?? '9');
  // QA Napkins is deliberately left blank — it must stay uncounted.
  await submitCountButton(page, 'closing').click();
  await expect(page.getByText('Count submitted')).toBeVisible();
}

/** Fill and submit a complete opening count (Critical items only). */
async function submitSeededOpeningCount(page: Page): Promise<void> {
  await gotoScreen(page, '/pos/opening');
  await page.getByLabel('Submitted by').selectOption({
    label: staff.ada.displayName,
  });
  await setQuantity(page, items.beans, '2');
  await setQuantity(page, items.cups, '30');
  await setLevel(page, items.sanitizer, 'One-third');
  await setQuantity(page, items.milk, '5');
  await submitCountButton(page, 'opening').click();
  await expect(page.getByText('Count submitted')).toBeVisible();
}

/** Choose Delivery or Wastage on the movement form, the way a user taps it. */
async function chooseMovementType(
  page: Page,
  label: 'Delivery' | 'Wastage',
): Promise<void> {
  await page
    .locator('.staff-movement-type')
    .getByText(label, { exact: true })
    .click();
  await expect(page.getByLabel(label, { exact: true })).toBeChecked();
}

function restockRows(page: Page): Locator {
  return page.locator('.staff-inventory-table-wrap table tbody tr');
}

function movementRows(page: Page): Locator {
  return page.locator('.staff-movement-table-section table tbody tr');
}

// ---------------------------------------------------------------------------
// Navigation and business-day context
// ---------------------------------------------------------------------------

test.describe('navigation and business-day context (#108)', () => {
  test('all four screens are reachable from the staff workspace nav after sign-in, with no cashier selection', async ({
    page,
  }) => {
    await signInAsStaff(page);

    const nav = page.getByRole('navigation', { name: 'Staff workspace' });
    await expect(nav).toBeVisible();

    for (const [linkName, expectedPath, heading] of [
      ['Opening', '/pos/opening', 'Opening count'],
      ['Closing', '/pos/closing', 'Closing count'],
      ['Restock', '/pos/restock', 'Restock status'],
      ['Deliveries & Wastage', '/pos/movements', 'Deliveries & wastage'],
    ] as const) {
      await nav.getByRole('link', { name: linkName }).click();
      await expect(page).toHaveURL(new RegExp(`${expectedPath}$`));
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
  });

  test('each screen identifies the current open business day, and Restock names the count it is reading', async ({
    page,
  }) => {
    await signInAsStaff(page);
    const expectedDate = businessDateLabel(businessDate);

    for (const path of ['/pos/opening', '/pos/closing', '/pos/movements']) {
      await gotoScreen(page, path);
      const context = page.locator('[aria-label="Business day context"]');
      await expect(context).toContainText(expectedDate);
      await expect(context).toContainText('Normal day');
    }

    // The shared shell owns the day context; Restock separately names the
    // count it is reading and repeats the business date in the table caption.
    await submitSeededClosingCount(page);
    await gotoScreen(page, '/pos/restock');
    const restockDayContext = page.locator('[aria-label="Business day context"]');
    await expect(restockDayContext).toContainText(expectedDate);
    await expect(restockDayContext).toContainText('Normal day');
    await expect(page.locator('.staff-restock-source')).toContainText(
      /^Using closing count submitted at /,
    );
    await expect(page.locator('.staff-inventory-table-wrap caption')).toContainText(
      expectedDate,
    );
  });

  test('the day type shown follows the open day (Peak)', async ({ page }) => {
    openBusinessDay(staff.ada.id, 'PEAK');
    await signInAsStaff(page);

    await gotoScreen(page, '/pos/opening');
    await expect(page.locator('[aria-label="Business day context"]')).toContainText('Peak day');
  });
});

// ---------------------------------------------------------------------------
// Opening count sheet
// ---------------------------------------------------------------------------

test.describe('opening count sheet (#108)', () => {
  test('lists only active Critical items — an active non-Critical item is absent', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/opening');

    for (const key of ['beans', 'cups', 'sanitizer', 'milk']) {
      await expect(countRow(page, items[key].name)).toHaveCount(1);
    }
    for (const key of ['almondMilk', 'sugar', 'syrup', 'napkins']) {
      await expect(countRow(page, items[key].name)).toHaveCount(0);
    }

    // Every row on the opening sheet carries the Critical badge.
    const rows = page.locator('.staff-count-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(
      page.locator('.staff-count-row .staff-count-item-name span'),
    ).toHaveCount(rowCount);
  });

  test('Submitted by is required, Shift lead is optional, and an inactive staff member is in neither select', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/opening');

    const submittedBy = page.getByLabel('Submitted by');
    const shiftLead = page.getByLabel('Shift lead');

    // Required vs optional is stated on the labels themselves.
    await expect(page.locator('label[for="open-submitted-by"]')).not.toContainText(
      '(optional)',
    );
    await expect(page.locator('label[for="open-shift-lead"]')).toContainText(
      '(optional)',
    );
    await expect(submittedBy).toHaveAttribute('required', '');

    // Neither select offers the inactive staff member.
    await expect(
      submittedBy.getByRole('option', { name: staff.zara.displayName }),
    ).toHaveCount(0);
    await expect(
      shiftLead.getByRole('option', { name: staff.zara.displayName }),
    ).toHaveCount(0);
    for (const select of [submittedBy, shiftLead]) {
      await expect(
        select.getByRole('option', { name: staff.ada.displayName }),
      ).toHaveCount(1);
      await expect(
        select.getByRole('option', { name: staff.bruno.displayName }),
      ).toHaveCount(1);
    }

    // Without a submitter the sheet cannot be submitted, and the reason is shown.
    await setQuantity(page, items.beans, '4');
    await expect(submitCountButton(page, 'opening')).toBeDisabled();
    await expect(
      page.getByText('Choose Submitted by to enable submission.'),
    ).toBeVisible();

    // Choosing one — and leaving Shift lead at its "None" default — is enough.
    await submittedBy.selectOption({ label: staff.ada.displayName });
    await expect(shiftLead).toHaveValue('');
    await expect(submitCountButton(page, 'opening')).toBeEnabled();
  });

  test('a quantity entry cannot be set below zero', async ({ page }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/opening');

    const input = quantityInput(page, items.beans.name);
    await expect(input).toHaveAttribute('min', '0');
    await expect(input).toHaveAttribute('step', '1');

    await input.fill('-5');
    await expect(input).toHaveValue('0');

    await input.fill('7');
    await expect(input).toHaveValue('7');
  });

  test('a level item offers exactly the eight choices, with none selected on load', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/opening');

    const row = countRow(page, items.sanitizer.name);
    await expect(row.getByRole('radio')).toHaveCount(8);
    await expect(row.locator('.staff-radio-option label')).toHaveText(
      LEVEL_CHOICES,
    );
    for (const choice of LEVEL_CHOICES) {
      await expect(row.getByLabel(choice, { exact: true })).not.toBeChecked();
    }

    // A level item has no numeric entry, and a quantity item has no level radios.
    await expect(row.locator('input[type="number"]')).toHaveCount(0);
    await expect(
      countRow(page, items.beans.name).getByRole('radio'),
    ).toHaveCount(0);
  });

  test('Submit opening count submits the sheet as one opening count', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededOpeningCount(page);

    const counts = readStockCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0].phase).toBe('OPEN');
    expect(counts[0].submittedByNameSnapshot).toBe(staff.ada.displayName);
    expect(counts[0].lines).toEqual([
      { itemName: items.beans.name, quantity: 2, level: null },
      { itemName: items.cups.name, quantity: 30, level: null },
      { itemName: items.milk.name, quantity: 5, level: null },
      { itemName: items.sanitizer.name, quantity: null, level: 'ONE_THIRD' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Closing count sheet
// ---------------------------------------------------------------------------

test.describe('closing count sheet (#108)', () => {
  test('lists every active stock item with Critical items before non-Critical', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/closing');

    for (const item of Object.values(items)) {
      await expect(countRow(page, item.name)).toHaveCount(1);
    }

    // Ordering is asserted as a partition over the whole sheet, not just this
    // run's items: every Critical row must precede every non-Critical row.
    const criticalFlags = await page
      .locator('.staff-count-row .staff-count-item-name')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector('span') !== null),
      );
    expect(criticalFlags.length).toBeGreaterThan(1);
    const lastCritical = criticalFlags.lastIndexOf(true);
    const firstNonCritical = criticalFlags.indexOf(false);
    expect(firstNonCritical).toBeGreaterThan(-1);
    expect(lastCritical).toBeLessThan(firstNonCritical);
  });

  test('uses the same staff selects and counting controls as the opening sheet', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/closing');

    const submittedBy = page.getByLabel('Submitted by');
    const shiftLead = page.getByLabel('Shift lead');
    await expect(submittedBy).toHaveAttribute('required', '');
    await expect(page.locator('label[for="close-shift-lead"]')).toContainText(
      '(optional)',
    );
    await expect(
      submittedBy.getByRole('option', { name: staff.zara.displayName }),
    ).toHaveCount(0);
    await expect(
      shiftLead.getByRole('option', { name: staff.zara.displayName }),
    ).toHaveCount(0);

    // The same two counting controls: a whole-number entry and the eight levels.
    const quantity = quantityInput(page, items.beans.name);
    await expect(quantity).toHaveAttribute('min', '0');
    await expect(quantity).toHaveAttribute('step', '1');
    await quantity.fill('-3');
    await expect(quantity).toHaveValue('0');

    const levelRow = countRow(page, items.sanitizer.name);
    await expect(levelRow.locator('.staff-radio-option label')).toHaveText(
      LEVEL_CHOICES,
    );
    for (const choice of LEVEL_CHOICES) {
      await expect(levelRow.getByLabel(choice, { exact: true })).not.toBeChecked();
    }
  });

  test('Submit closing count submits the sheet as one closing count', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);

    const counts = readStockCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0].phase).toBe('CLOSE');
    expect(counts[0].lines).toEqual([
      { itemName: items.almondMilk.name, quantity: 1, level: null },
      { itemName: items.beans.name, quantity: 2, level: null },
      { itemName: items.cups.name, quantity: 30, level: null },
      { itemName: items.milk.name, quantity: 5, level: null },
      { itemName: items.sanitizer.name, quantity: null, level: 'ONE_THIRD' },
      { itemName: items.sugar.name, quantity: 12, level: null },
      { itemName: items.syrup.name, quantity: 9, level: null },
    ]);
    // The blank item was omitted rather than recorded as zero.
    expect(
      counts[0].lines.some((line) => line.itemName === items.napkins.name),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test.describe('submitted counts are immutable (#108)', () => {
  test('a submitted sheet is read-only with no edit and no delete control', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededOpeningCount(page);

    const panel = page.locator('.staff-inventory-panel');
    await expect(panel.locator('input')).toHaveCount(0);
    await expect(panel.locator('select')).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: /edit|delete|remove|change/i }),
    ).toHaveCount(0);

    // The only action offered is starting a new count for a correction.
    await expect(panel.getByRole('button')).toHaveCount(1);
    await expect(
      panel.getByRole('button', { name: 'Record another opening count' }),
    ).toBeVisible();

    // The submitted values are shown, not editable.
    await expect(countRow(page, items.beans.name)).toContainText(
      `2 ${items.beans.unit}`,
    );
    await expect(countRow(page, items.sanitizer.name)).toContainText('One-third');

    // Reloading keeps the read-only state — it is not a client-side artefact.
    await gotoScreen(page, '/pos/opening');
    await expect(page.getByText('Count submitted')).toBeVisible();
    await expect(submitCountButton(page, 'opening')).toHaveCount(0);
  });

  test('a correction is a new count: the corrected figure is shown afterwards and the earlier count is not overwritten', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);

    await gotoScreen(page, '/pos/restock');
    await expect(
      restockRows(page).filter({ hasText: items.beans.name }).locator('td').nth(1),
    ).toHaveText('2');

    // Record the correction as a brand-new sheet.
    await gotoScreen(page, '/pos/closing');
    await page
      .getByRole('button', { name: 'Record another closing count' })
      .click();
    await page.getByLabel('Submitted by').selectOption({
      label: staff.bruno.displayName,
    });
    await setQuantity(page, items.beans, '9');
    await submitCountButton(page, 'closing').click();
    await expect(page.getByText('Count submitted')).toBeVisible();

    // Two separate counts exist; the first one still holds its original values.
    const counts = readStockCounts();
    expect(counts).toHaveLength(2);
    expect(counts[0].submittedByNameSnapshot).toBe(staff.ada.displayName);
    expect(counts[0].lines).toContainEqual({
      itemName: items.beans.name,
      quantity: 2,
      level: null,
    });
    expect(counts[1].submittedByNameSnapshot).toBe(staff.bruno.displayName);
    expect(counts[1].lines).toEqual([
      { itemName: items.beans.name, quantity: 9, level: null },
    ]);

    // The corrected figure is the one that appears afterwards.
    await gotoScreen(page, '/pos/restock');
    await expect(restockRows(page)).toHaveCount(1);
    await expect(restockRows(page).locator('td').nth(1)).toHaveText('9');
  });

  test('the submit action is unavailable while a submission is in flight, so one action cannot submit twice', async ({
    page,
  }) => {
    await signInAsStaff(page);

    // Hold the submit POST open so the in-flight window is observable. The
    // request still reaches the API — only its timing is controlled.
    await page.route(
      (url) => url.pathname === '/inventory/counts',
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      },
    );

    await gotoScreen(page, '/pos/opening');
    await page.getByLabel('Submitted by').selectOption({
      label: staff.ada.displayName,
    });
    await setQuantity(page, items.beans, '4');

    const submit = submitCountButton(page, 'opening');
    await submit.click();

    // In flight: the action is gone from reach.
    await expect(
      page.getByRole('button', { name: 'Submitting count…' }),
    ).toBeDisabled();
    // A second press during the flight does nothing (a disabled button has no
    // activation behaviour, even for a forced synthetic click).
    await page
      .getByRole('button', { name: 'Submitting count…' })
      .click({ force: true });

    await expect(page.getByText('Count submitted')).toBeVisible({
      timeout: 15_000,
    });
    expect(readStockCounts()).toHaveLength(1);
  });

  test('deactivating and renaming the submitter afterwards does not rewrite the submitted count', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededOpeningCount(page);
    await expect(
      page.getByText(`by ${staff.ada.displayName}`, { exact: false }),
    ).toBeVisible();

    updateStaffMember(staff.ada.id, {
      displayName: `QA Renamed ${TAG}`,
      isActive: false,
    });

    await gotoScreen(page, '/pos/opening');
    await expect(page.getByText('Count submitted')).toBeVisible();
    await expect(
      page.getByText(`by ${staff.ada.displayName}`, { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(`QA Renamed ${TAG}`)).toHaveCount(0);

    expect(readStockCounts()[0].submittedByNameSnapshot).toBe(
      staff.ada.displayName,
    );

    // Restore the roster so the remaining tests keep their active submitter.
    updateStaffMember(staff.ada.id, {
      displayName: staff.ada.displayName,
      isActive: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Deliveries & wastage
// ---------------------------------------------------------------------------

test.describe('deliveries and wastage (#108)', () => {
  test('with nothing recorded, the list shows exactly "No movements recorded today."', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/movements');

    const emptyState = page.locator(
      '.staff-movement-table-section .staff-inventory-blocking p',
    );
    await expect(emptyState).toHaveText('No movements recorded today.');
    await expect(movementRows(page)).toHaveCount(0);
  });

  test('the screen states that each entry is permanent', async ({ page }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/movements');

    await expect(page.locator('.staff-permanence-warning')).toContainText(
      'Each entry is permanent.',
    );
  });

  test('Delivery is selected by default and can be changed to Wastage before recording', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/movements');

    await expect(page.getByLabel('Delivery', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Wastage', { exact: true })).not.toBeChecked();

    await page.getByLabel('Item').selectOption({ label: items.milk.name });
    await page.getByLabel('Quantity').fill('3');
    await chooseMovementType(page, 'Wastage');
    await expect(page.getByLabel('Delivery', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Record movement' }).click();

    await expect(movementRows(page)).toHaveCount(1);
    await expect(movementRows(page).first().locator('td').nth(1)).toHaveText(
      'Wastage',
    );
    expect(readStockMovements()[0].type).toBe('WASTAGE');

    // The form returns to its initial state, Delivery selected again.
    await expect(page.getByLabel('Delivery', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Quantity')).toHaveValue('');
  });

  test('an entry records item, type, quantity, optional recorder and optional reason, and is listed with no edit or delete action', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/movements');

    // Fully specified entry, including both optional fields.
    await page.getByLabel('Item').selectOption({ label: items.beans.name });
    await page.getByLabel('Quantity').fill('12');
    await page
      .getByLabel('Recorded by')
      .selectOption({ label: staff.bruno.displayName });
    await page.getByLabel('Reason').fill('AM delivery');
    await page.getByRole('button', { name: 'Record movement' }).click();
    await expect(movementRows(page)).toHaveCount(1);

    // Second entry omitting both optional fields.
    await page.getByLabel('Item').selectOption({ label: items.syrup.name });
    await chooseMovementType(page, 'Wastage');
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Record movement' }).click();
    await expect(movementRows(page)).toHaveCount(2);

    // Item, Type, Quantity, Reason and Who — newest first.
    const headers = page.locator('.staff-movement-table-section thead th');
    await expect(headers).toHaveText([
      'Item',
      'Type',
      'Quantity',
      'Reason',
      'Who',
    ]);
    await expect(movementRows(page).nth(0).locator('td')).toHaveText([
      items.syrup.name,
      'Wastage',
      '1',
      '—',
      '—',
    ]);
    await expect(movementRows(page).nth(1).locator('td')).toHaveText([
      items.beans.name,
      'Delivery',
      '12',
      'AM delivery',
      staff.bruno.displayName,
    ]);

    // No row offers an edit or delete action — the listing has no controls at all.
    await expect(
      page.locator('.staff-movement-table-section').getByRole('button'),
    ).toHaveCount(0);
    await expect(
      page.locator('.staff-movement-table-section').getByRole('link'),
    ).toHaveCount(0);

    const stored = readStockMovements();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      itemName: items.beans.name,
      type: 'DELIVERY',
      quantity: 12,
      reason: 'AM delivery',
      recordedByNameSnapshot: staff.bruno.displayName,
    });
    expect(stored[1]).toMatchObject({
      itemName: items.syrup.name,
      type: 'WASTAGE',
      quantity: 1,
      reason: null,
      recordedByNameSnapshot: null,
    });
  });

  test('recording a movement does not change restock status (stock is counted, not decremented)', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);

    await gotoScreen(page, '/pos/restock');
    await expect(restockRows(page)).toHaveCount(7);
    const before = await restockRows(page).allInnerTexts();

    await gotoScreen(page, '/pos/movements');
    await page.getByLabel('Item').selectOption({ label: items.beans.name });
    await page.getByLabel('Quantity').fill('50');
    await page.getByRole('button', { name: 'Record movement' }).click();
    await expect(movementRows(page)).toHaveCount(1);

    await gotoScreen(page, '/pos/restock');
    await expect(restockRows(page)).toHaveCount(7);
    expect(await restockRows(page).allInnerTexts()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Restock status
// ---------------------------------------------------------------------------

test.describe('restock status (#108)', () => {
  test('with no count submitted, shows exactly "No count has been submitted for this day yet."', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await gotoScreen(page, '/pos/restock');

    await expect(
      page.locator('.staff-inventory-blocking p'),
    ).toHaveText('No count has been submitted for this day yet.');
    await expect(restockRows(page)).toHaveCount(0);
  });

  test('shows Item, Counted, Par and Status, most urgent first', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);
    await gotoScreen(page, '/pos/restock');

    await expect(page.locator('thead th')).toHaveText([
      'Item',
      'Counted',
      'Par',
      'Status',
    ]);

    // Exactly the seven counted lines — the blank item is not a row.
    await expect(restockRows(page)).toHaveCount(7);

    // Urgent, Low, Below par, then Enough; Critical first within a band, then
    // alphabetical. QA Almond Milk sorting after QA Beans despite the alphabet
    // is what proves Critical-first is applied.
    await expect(restockRows(page).locator('td:nth-child(1) strong')).toHaveText([
      items.beans.name,
      items.almondMilk.name,
      items.cups.name,
      items.sanitizer.name,
      items.milk.name,
      items.sugar.name,
      items.syrup.name,
    ]);
    await expect(restockRows(page).locator('td:nth-child(4)')).toHaveText([
      'Urgent',
      'Urgent',
      'Low',
      'Low',
      'Below par',
      'Enough',
      'Enough',
    ]);
    await expect(restockRows(page).locator('td:nth-child(2)')).toHaveText([
      '2',
      '1',
      '30',
      /^One-third/,
      '5',
      '12',
      '9',
    ]);
    await expect(restockRows(page).locator('td:nth-child(3)')).toHaveText([
      '10',
      '10',
      '100',
      '—',
      '20',
      '—',
      '5',
    ]);
  });

  test('a level-counted item shows its level as Counted, "—" as Par, and still carries a status', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);
    await gotoScreen(page, '/pos/restock');

    const row = restockRows(page).filter({ hasText: items.sanitizer.name });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toContainText('One-third');
    await expect(row.locator('td').nth(2)).toHaveText('—');
    await expect(row.locator('td').nth(3)).toHaveText('Low');
  });

  test('a quantity item with no par settings shows "—" as Par and status Enough', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);
    await gotoScreen(page, '/pos/restock');

    const row = restockRows(page).filter({ hasText: items.sugar.name });
    await expect(row.locator('td').nth(1)).toHaveText('12');
    await expect(row.locator('td').nth(2)).toHaveText('—');
    await expect(row.locator('td').nth(3)).toHaveText('Enough');
  });

  test('an item left blank is uncounted, not counted zero — it is not a row at all', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededClosingCount(page);
    await gotoScreen(page, '/pos/restock');

    await expect(
      restockRows(page).filter({ hasText: items.napkins.name }),
    ).toHaveCount(0);
    // Its par settings would have made a zero count Urgent, so its absence is
    // the whole assertion.
    await expect(restockRows(page)).toHaveCount(7);
  });

  test('uses the opening count when only one exists, and flips to the closing count once one is submitted', async ({
    page,
  }) => {
    await signInAsStaff(page);
    await submitSeededOpeningCount(page);

    await gotoScreen(page, '/pos/restock');
    await expect(page.locator('.staff-restock-source')).toContainText(
      /^Using opening count submitted at /,
    );
    // An opening count only ever holds Critical items, so restock lists those.
    await expect(restockRows(page)).toHaveCount(4);
    await expect(restockRows(page).locator('td:nth-child(1) strong')).toHaveText([
      items.beans.name,
      items.cups.name,
      items.sanitizer.name,
      items.milk.name,
    ]);
    await expect(restockRows(page).locator('td:nth-child(1) small')).toHaveCount(
      4,
    );

    await submitSeededClosingCount(page);

    await gotoScreen(page, '/pos/restock');
    await expect(page.locator('.staff-restock-source')).toContainText(
      /^Using closing count submitted at /,
    );
    await expect(page.locator('.staff-inventory-table-wrap caption')).toContainText(
      businessDateLabel(businessDate),
    );
    await expect(restockRows(page)).toHaveCount(7);
  });
});

// ---------------------------------------------------------------------------
// No open business day
// ---------------------------------------------------------------------------

test.describe('no open business day (#108)', () => {
  test('all four screens block and nothing can be submitted', async ({ page }) => {
    await signInAsStaff(page);
    closeOpenBusinessDays();

    for (const path of [
      '/pos/opening',
      '/pos/closing',
      '/pos/restock',
      '/pos/movements',
    ]) {
      await gotoScreen(page, path);
      await expect(page.locator('.staff-inventory-blocking p')).toHaveText(
        'No business day is open.',
      );
      // No sheet, no movement form, no submit action anywhere on the screen.
      await expect(page.locator('.staff-count-row')).toHaveCount(0);
      await expect(page.locator('form')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /Submit .* count|Record movement/ }),
      ).toHaveCount(0);
    }

    expect(readStockCounts()).toHaveLength(0);
    expect(readStockMovements()).toHaveLength(0);
  });
});
