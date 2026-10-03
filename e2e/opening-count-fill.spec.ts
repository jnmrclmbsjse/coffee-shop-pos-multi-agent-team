import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  deactivateStaleInventoryItems,
  openBusinessDay,
  readStockCounts,
  resetInventoryOperations,
  seedInventoryItems,
  seedStaffMembers,
  type SeedItemSpec,
  type SeededItem,
  type SeededStaff,
} from './fixtures/inventory-operations';
import { seedHistoricalClosingCount } from './fixtures/opening-count-fill';

/**
 * End-to-end coverage for story #409 — fill an opening inventory count from
 * the last submitted closing count. The UI and submissions use the real
 * browser → React → NestJS → PostgreSQL path. Only historical closing records
 * are seeded directly because the product cannot submit a count for a closed,
 * several-days-old business date.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD =
  process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const TAG = `qa409-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

const ITEM_SPECS: Record<string, SeedItemSpec> = {
  zero: {
    name: `QA Zero ${TAG}`,
    unit: 'pcs',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  level: {
    name: `QA Level ${TAG}`,
    unit: 'level',
    countMethod: 'LEVEL',
    critical: true,
    par: null,
  },
  individual: {
    name: `QA Individual ${TAG}`,
    unit: 'bag',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  preserved: {
    name: `QA Preserved ${TAG}`,
    unit: 'btl',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  cleared: {
    name: `QA Cleared ${TAG}`,
    unit: 'kg',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  absent: {
    name: `QA No Source ${TAG}`,
    unit: 'box',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  mismatch: {
    name: `QA Method Changed ${TAG}`,
    unit: 'pcs',
    countMethod: 'QUANTITY',
    critical: true,
    par: null,
  },
  closingOnly: {
    name: `QA Closing Only ${TAG}`,
    unit: 'pcs',
    countMethod: 'QUANTITY',
    critical: false,
    par: null,
  },
};

let items: Record<string, SeededItem>;
let staff: Record<string, SeededStaff>;
let businessDate: string;

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function businessDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(
    new Date(`${isoDate}T00:00:00`),
  );
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

async function gotoOpening(page: Page): Promise<void> {
  await page.goto('/pos/opening');
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
}

function row(page: Page, item: SeededItem): Locator {
  return page.locator('.staff-count-row').filter({ hasText: item.name });
}

function quantity(page: Page, item: SeededItem): Locator {
  return page.getByLabel(`Quantity for ${item.name}`);
}

function perItemFill(page: Page, item: SeededItem): Locator {
  return page.getByRole('button', {
    name: `Fill ${item.name} from last closing count`,
  });
}

function indicator(page: Page, item: SeededItem): Locator {
  return row(page, item).locator('.staff-fill-indicator');
}

function seedCorrectedOlderClosing(): string {
  const sourceDate = shiftDate(businessDate, -3);
  const originalId = seedHistoricalClosingCount({
    businessDate: sourceDate,
    recordedAt: `${sourceDate}T12:00:00.000Z`,
    submittedByStaffMemberId: staff.ada.id,
    submittedByNameSnapshot: staff.ada.displayName,
    lines: [
      { inventoryItemId: items.zero.id, quantity: 88 },
      { inventoryItemId: items.level.id, level: 'FULL' },
      { inventoryItemId: items.individual.id, quantity: 81 },
    ],
  });
  seedHistoricalClosingCount({
    businessDate: sourceDate,
    recordedAt: `${sourceDate}T13:00:00.000Z`,
    submittedByStaffMemberId: staff.bruno.id,
    submittedByNameSnapshot: staff.bruno.displayName,
    correctsStockCountId: originalId,
    lines: [
      { inventoryItemId: items.zero.id, quantity: 0 },
      { inventoryItemId: items.level.id, level: 'EMPTY' },
      { inventoryItemId: items.individual.id, quantity: 4 },
      { inventoryItemId: items.preserved.id, quantity: 7 },
      { inventoryItemId: items.cleared.id, quantity: 5 },
      { inventoryItemId: items.mismatch.id, level: 'FULL' },
      { inventoryItemId: items.closingOnly.id, quantity: 99 },
    ],
  });
  return sourceDate;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  deactivateStaleInventoryItems(TAG);
  items = seedInventoryItems(TAG, ITEM_SPECS);
  staff = seedStaffMembers({
    ada: { displayName: `QA Ada Fill ${TAG}`, isActive: true },
    bruno: { displayName: `QA Bruno Fill ${TAG}`, isActive: true },
  });
});

test.beforeEach(() => {
  resetInventoryOperations();
  businessDate = openBusinessDay(staff.ada.id, 'NORMAL');
});

test.afterAll(() => {
  resetInventoryOperations();
  openBusinessDay(staff.ada.id, 'NORMAL');
});

test('with no closing count, explains the empty state and offers no fill actions', async ({
  page,
}) => {
  await signInAsStaff(page);
  await gotoOpening(page);

  await expect(
    page.getByText(
      'No previous closing count. There is nothing to fill from yet, so enter this opening count by hand.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /fill .*last closing/i }),
  ).toHaveCount(0);
});

test('uses the latest older correction and fills only eligible untouched fields', async ({
  page,
}) => {
  const sourceDate = seedCorrectedOlderClosing();
  await signInAsStaff(page);
  await gotoOpening(page);

  const source = page.locator('.staff-fill-source-banner');
  await expect(source).toContainText(businessDateLabel(sourceDate));
  await expect(source).toContainText(staff.bruno.displayName);
  await expect(source).toContainText(
    'Fills only untouched empty fields. Values you entered are kept.',
  );

  // The opening sheet remains critical-only; a closing-only source line does
  // not create a row. Missing and method-mismatched source values stay blank
  // and have no inert per-item action.
  await expect(row(page, items.closingOnly)).toHaveCount(0);
  for (const item of [items.absent, items.mismatch]) {
    await expect(quantity(page, item)).toHaveValue('');
    await expect(perItemFill(page, item)).toHaveCount(0);
  }

  // Per-item fill is scoped to exactly one row.
  await perItemFill(page, items.individual).click();
  await expect(quantity(page, items.individual)).toHaveValue('4');
  await expect(indicator(page, items.individual)).toContainText(
    'From last closing',
  );
  await expect(quantity(page, items.zero)).toHaveValue('');

  // A hand-entered value equal to the source remains hand-entered: fill-all
  // keeps it and does not infer provenance by comparing values.
  await quantity(page, items.preserved).fill('7');
  await page
    .getByRole('button', { name: 'Fill all from last closing count' })
    .click();
  await expect(quantity(page, items.preserved)).toHaveValue('7');
  await expect(indicator(page, items.preserved)).toHaveCount(0);

  // Both zero-ish source values are real values, not empty sentinels.
  await expect(quantity(page, items.zero)).toHaveValue('0');
  await expect(row(page, items.level).getByLabel('Empty', { exact: true })).toBeChecked();
  await expect(indicator(page, items.zero)).toContainText('From last closing');
  await expect(indicator(page, items.level)).toContainText('From last closing');

  // A filled value enables its existing note control. Clearing the value
  // clears that note, removes only this indicator, and marks the field as an
  // intentional blank that neither fill action can refill.
  const clearedNote = page.getByLabel(`Note for ${items.cleared.name}`);
  await expect(clearedNote).toBeEnabled();
  await clearedNote.fill('temporary note');
  await quantity(page, items.cleared).fill('');
  await expect(clearedNote).toHaveValue('');
  await expect(clearedNote).toBeDisabled();
  await expect(indicator(page, items.cleared)).toHaveCount(0);
  await expect(perItemFill(page, items.cleared)).toHaveCount(0);

  // Edit another filled field, then invoke fill-all a second time. Both the
  // typed value and the intentionally cleared field survive, while unrelated
  // indicators remain present.
  await quantity(page, items.individual).fill('12');
  await page
    .getByRole('button', { name: 'Fill all from last closing count' })
    .click();
  await expect(quantity(page, items.individual)).toHaveValue('12');
  await expect(quantity(page, items.cleared)).toHaveValue('');
  await expect(indicator(page, items.individual)).toHaveCount(0);
  await expect(indicator(page, items.zero)).toHaveCount(1);

  // Changing a level removes only its own provenance indicator.
  await row(page, items.level).getByText('Full', { exact: true }).click();
  await expect(row(page, items.level).getByLabel('Full', { exact: true })).toBeChecked();
  await expect(indicator(page, items.level)).toHaveCount(0);
  await expect(indicator(page, items.zero)).toHaveCount(1);

  // Filling is draft-only: the database still contains only the two closing
  // records until the explicit submit action.
  expect(readStockCounts().map((count) => count.phase)).toEqual([
    'CLOSE',
    'CLOSE',
  ]);

  await page.getByLabel('Submitted by').selectOption({ label: staff.ada.displayName });
  await page.getByRole('button', { name: 'Submit opening count' }).click();
  await expect(page.getByText('Count submitted')).toBeVisible();

  const counts = readStockCounts();
  expect(counts).toHaveLength(3);
  expect(counts[2]).toMatchObject({
    phase: 'OPEN',
    submittedByNameSnapshot: staff.ada.displayName,
    lines: [
      { itemName: items.individual.name, quantity: 12, level: null },
      { itemName: items.level.name, quantity: null, level: 'FULL' },
      { itemName: items.preserved.name, quantity: 7, level: null },
      { itemName: items.zero.name, quantity: 0, level: null },
    ],
  });

  // Submitted/read-only state never exposes fill provenance or actions.
  await expect(page.locator('.staff-fill-indicator')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /fill .*last closing/i }),
  ).toHaveCount(0);
});

test('a re-count draft offers the same closing-source actions, not opening values', async ({
  page,
}) => {
  seedCorrectedOlderClosing();
  await signInAsStaff(page);
  await gotoOpening(page);
  await quantity(page, items.individual).fill('42');
  await page.getByLabel('Submitted by').selectOption({ label: staff.ada.displayName });
  await page.getByRole('button', { name: 'Submit opening count' }).click();
  await expect(page.getByText('Count submitted')).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Fill all from last closing count' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Record another opening count' })
    .click();

  await expect(
    page.getByText(
      'Filling still uses the last closing count, not that opening count.',
      { exact: false },
    ),
  ).toBeVisible();
  await expect(quantity(page, items.individual)).toHaveValue('');
  await perItemFill(page, items.individual).click();
  await expect(quantity(page, items.individual)).toHaveValue('4');
  await expect(quantity(page, items.individual)).not.toHaveValue('42');
});

test('filled and typed drafts submit the same payload shape and stored lines', async ({
  page,
}) => {
  const sourceDate = shiftDate(businessDate, -1);
  const seedSource = () =>
    seedHistoricalClosingCount({
      businessDate: sourceDate,
      recordedAt: `${sourceDate}T12:00:00.000Z`,
      submittedByStaffMemberId: staff.ada.id,
      submittedByNameSnapshot: staff.ada.displayName,
      lines: [
        { inventoryItemId: items.zero.id, quantity: 0 },
        { inventoryItemId: items.level.id, level: 'EMPTY' },
      ],
    });
  seedSource();

  const submittedPayloads: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/inventory/counts'
    ) {
      submittedPayloads.push(request.postDataJSON());
    }
  });

  await signInAsStaff(page);
  await gotoOpening(page);
  await page.getByLabel('Submitted by').selectOption({ label: staff.ada.displayName });
  await page
    .getByRole('button', { name: 'Fill all from last closing count' })
    .click();
  await page.getByRole('button', { name: 'Submit opening count' }).click();
  await expect(page.getByText('Count submitted')).toBeVisible();
  const filledLines = readStockCounts().find((count) => count.phase === 'OPEN')!.lines;

  resetInventoryOperations();
  seedSource();
  await gotoOpening(page);
  await page.getByLabel('Submitted by').selectOption({ label: staff.ada.displayName });
  await quantity(page, items.zero).fill('0');
  await row(page, items.level).getByText('Empty', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit opening count' }).click();
  await expect(page.getByText('Count submitted')).toBeVisible();
  const typedLines = readStockCounts().find((count) => count.phase === 'OPEN')!.lines;

  expect(submittedPayloads).toHaveLength(2);
  expect(submittedPayloads[0]).toEqual(submittedPayloads[1]);
  expect(JSON.stringify(submittedPayloads)).not.toMatch(/filled|provenance|source/i);
  expect(typedLines).toEqual(filledLines);
});
