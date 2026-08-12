import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #55 — "Manage inventory categories, stock items,
 * and par levels" (QA Task #60).
 *
 * Every acceptance criterion on #55 is exercised through the real
 * browser → web app → NestJS API → PostgreSQL path (no mocking). The fixture is
 * the seeded `admin` (ADMIN) user from apps/api/prisma/seed.ts. Categories and
 * stock items are created by the tests themselves through the UI, so the suite
 * is self-contained and safe to re-run against a persistent database — every
 * created record carries a per-run unique suffix to avoid collisions and
 * cross-test interference.
 *
 * Two situations have no creation surface in this master-data story and are
 * therefore seeded directly through the API package's Prisma client:
 *   - the delete-guard failure branch (crit 10), which needs a stock item that
 *     is referenced as a catalog product-size Cup mapping (ProductVariant
 *     .cupInventoryItemId, onDelete: Restrict); and
 *   - a stock item whose id we need for the server-side Reconciled+Level
 *     rejection check (crit 8), which we drive through the authenticated
 *     browser request context.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const REPO_ROOT = resolve(__dirname, '..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

// The seeded initial category set (apps/api/prisma/seed.ts).
const SEEDED_CATEGORIES = ['Water & Ice', 'Cups', 'Lids', 'Dairies', 'Others'];

// Unique per-run suffix keeps created records from colliding with rows left
// behind by earlier runs (the dev database persists between runs).
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
function unique(base: string): string {
  seq += 1;
  return `${base} ${RUN}-${seq}`;
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
  const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env);
  if (!match) throw new Error('DATABASE_URL not found in environment or .env');
  return match[1];
}

/**
 * Run a Node script against the API package's Prisma client (not hoisted to the
 * repo root) with apps/api as the working directory so `@prisma/client`
 * resolves. Whatever the script prints on stdout is returned verbatim.
 */
function runPrisma(script: string): string {
  return execFileSync('node', ['-e', script], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdio: 'pipe',
  })
    .toString()
    .trim();
}

/**
 * Seed a stock item that is referenced as a catalog product-size Cup mapping,
 * so the delete guard (crit 10) has a concrete, reproducible blocking state.
 * Returns the created item's id and display name.
 */
function seedReferencedCupItem(tag: string): { id: string; name: string } {
  const itemName = `${tag} Referenced Cup`;
  const script = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      const stockCategory = await prisma.stockCategory.create({
        data: { name: ${JSON.stringify(`${tag} Ref Stock Cat`)}, sortWeight: 990001 },
      });
      const item = await prisma.inventoryItem.create({
        data: {
          sku: ${JSON.stringify(`E2E-REFCUP-${tag}`)},
          name: ${JSON.stringify(itemName)},
          categoryId: stockCategory.id,
          unit: 'pcs',
          countMethod: 'QUANTITY',
          active: true,
        },
      });
      const catalogCategory = await prisma.category.create({
        data: { name: ${JSON.stringify(`${tag} Ref Catalog Cat`)}, sortWeight: 990001 },
      });
      const product = await prisma.product.create({
        data: {
          sku: ${JSON.stringify(`E2E-REFPROD-${tag}`)},
          name: ${JSON.stringify(`${tag} Ref Product`)},
          categoryId: catalogCategory.id,
        },
      });
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: 'Regular',
          priceCents: 12000,
          sortWeight: 10,
          cupInventoryItemId: item.id,
        },
      });
      process.stdout.write(JSON.stringify({ id: item.id, name: item.name }));
      await prisma.$disconnect();
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  return JSON.parse(runPrisma(script)) as { id: string; name: string };
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// ---- Categories tab helpers -------------------------------------------------

async function goToCategories(page: Page): Promise<void> {
  await page.goto('/inventory');
  await page.getByRole('tab', { name: 'Categories' }).click();
  await expect(page.locator('.inventory-categories-table')).toBeVisible();
}

/**
 * Reload the inventory page and return to the Categories tab. The tab selection
 * is component state, so a reload always lands back on the default Stock-items
 * tab — category assertions after a reload must re-open Categories first.
 */
async function reloadCategories(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('tab', { name: 'Categories' }).click();
  await expect(page.locator('.inventory-categories-table')).toBeVisible();
}

/** The item-list filter controls are wrapped selects exposed as comboboxes. */
function itemFilter(page: Page, name: string): Locator {
  return page.getByRole('combobox', { name, exact: true });
}

function categoryRow(page: Page, name: string): Locator {
  return page.locator('.inventory-categories-table tbody tr', {
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/** Create a category through the modal; the caller is on the Categories tab. */
async function createCategory(
  page: Page,
  name: string,
  options: { active?: boolean; sortWeight?: number } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'Create category' }).click();
  await page.locator('#stock-category-name').fill(name);
  if (options.sortWeight !== undefined) {
    await page.locator('#stock-category-weight').fill(String(options.sortWeight));
  }
  await page
    .locator('#stock-category-state')
    .selectOption(options.active === false ? 'inactive' : 'active');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(categoryRow(page, name)).toBeVisible();
}

async function editCategory(page: Page, name: string): Promise<void> {
  await categoryRow(page, name).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

function categoryNames(page: Page): Promise<string[]> {
  return page
    .locator('.inventory-categories-table tbody tr td[data-label="Category"]')
    .allInnerTexts();
}

async function indexOfCategory(page: Page, name: string): Promise<number> {
  return (await categoryNames(page)).indexOf(name);
}

// ---- Stock item helpers -----------------------------------------------------

function itemRow(page: Page, name: string): Locator {
  return page.locator('.inventory-items-table tbody tr', {
    has: page.getByRole('cell', { name, exact: true }),
  });
}

interface ParInput {
  par?: string;
  low?: string;
  urgent?: string;
}

interface ItemInput {
  category: string;
  name: string;
  unit?: string;
  size?: string;
  countMethod?: 'Quantity' | 'Level';
  critical?: boolean;
  reconciled?: boolean;
  active?: boolean;
  normal?: ParInput;
  peak?: ParInput;
}

async function fillPar(page: Page, prefix: 'normal' | 'peak', par?: ParInput) {
  if (!par) return;
  if (par.par !== undefined) await page.locator(`#${prefix}-par`).fill(par.par);
  if (par.low !== undefined) await page.locator(`#${prefix}-low`).fill(par.low);
  if (par.urgent !== undefined)
    await page.locator(`#${prefix}-urgent`).fill(par.urgent);
}

/** Fill the item editor from an already-open /inventory/items/new|:id/edit page. */
async function fillItemForm(page: Page, input: ItemInput): Promise<void> {
  await page
    .locator('#inventory-item-category')
    .selectOption({ label: input.category });
  await page.locator('#inventory-item-name').fill(input.name);
  if (input.unit !== undefined) await page.locator('#inventory-item-unit').fill(input.unit);
  if (input.size !== undefined) await page.locator('#inventory-item-size').fill(input.size);
  // Reconciled forces Quantity, so set Reconciled before the count method.
  if (input.reconciled) {
    await page.getByRole('switch', { name: 'Reconciled' }).click();
  }
  if (input.countMethod) {
    await page.getByRole('radio', { name: new RegExp(input.countMethod) }).check();
  }
  if (input.countMethod === 'Level') {
    // Story #286 makes a level target required for both day types before a
    // level-counted item can be saved, and replaces the quantity par inputs
    // with the eight-level scale. #55's own criteria are indifferent to which
    // level is chosen, so pick one for each day and move on — the level par
    // rules themselves are covered by e2e/level-par-settings.spec.ts. The
    // label is what a user taps: the radio sits underneath it in the
    // touch-target layout and a direct click on the input is intercepted.
    for (const prefix of ['normal', 'peak'] as const) {
      await page.locator(`label[for="${prefix}-level-half"]`).click();
      await expect(page.locator(`#${prefix}-level-half`)).toBeChecked();
    }
  }
  if (input.critical) {
    await page.getByRole('switch', { name: 'Critical' }).click();
  }
  if (input.active === false) {
    await page.getByRole('switch', { name: 'Active' }).click();
  }
  await fillPar(page, 'normal', input.normal);
  await fillPar(page, 'peak', input.peak);
}

/** Create a stock item through the editor and return to the list. */
async function createItem(page: Page, input: ItemInput): Promise<void> {
  await page.goto('/inventory/items/new');
  await fillItemForm(page, input);
  await page.getByRole('button', { name: 'Save stock item' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(itemRow(page, input.name)).toBeVisible();
}

async function openItemEditor(page: Page, name: string): Promise<void> {
  await page.goto('/inventory');
  await itemRow(page, name).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/inventory\/items\/.+\/edit$/);
}

test.describe('Inventory management (story #55)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // === Stock categories ======================================================

  // AC crit 2: the initial category set is seeded.
  test('seeded categories include the initial set', async ({ page }) => {
    await goToCategories(page);
    for (const name of SEEDED_CATEGORIES) {
      await expect(categoryRow(page, name)).toBeVisible();
    }
  });

  // AC crit 1/3: list columns; create then edit persist and survive reload;
  // toggling active persists.
  test('category create, columns, edit and active-toggle persist across reload', async ({
    page,
  }) => {
    const name = unique('Syrups');
    await goToCategories(page);
    await createCategory(page, name, { active: true });

    const row = categoryRow(page, name);
    // Columns: name, sort weight (numeric), item count (0 for a new category),
    // and an Active status.
    await expect(row.locator('td[data-label="Sort weight"]')).toHaveText(/\d+/);
    await expect(row.locator('td[data-label="Items"]')).toHaveText('0');
    await expect(row.getByText('Active', { exact: true })).toBeVisible();

    // Survives reload.
    await reloadCategories(page);
    await expect(categoryRow(page, name)).toBeVisible();

    // Edit: rename; the change is visible on return.
    const renamed = `${name} Bar`;
    await editCategory(page, name);
    await page.locator('#stock-category-name').fill(renamed);
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(categoryRow(page, renamed)).toBeVisible();

    // Toggle active off from the list; it persists across reload.
    await categoryRow(page, renamed)
      .getByRole('switch', { name: new RegExp(`Deactivate ${renamed}`) })
      .click();
    await expect(
      categoryRow(page, renamed).getByText('Inactive', { exact: true }),
    ).toBeVisible();
    await reloadCategories(page);
    await expect(
      categoryRow(page, renamed).getByText('Inactive', { exact: true }),
    ).toBeVisible();
  });

  // AC crit 3: an empty category can be deleted; a non-empty one is blocked with
  // a visible explanation and both the category and its item remain unchanged.
  test('category delete guard: empty deletes, non-empty is blocked', async ({
    page,
  }) => {
    const empty = unique('Deletable-Cat');
    const nonEmpty = unique('Occupied-Cat');
    await goToCategories(page);
    await createCategory(page, empty);
    await createCategory(page, nonEmpty);

    // Put an item in the non-empty category.
    const item = unique('Occupant');
    await createItem(page, { category: nonEmpty, name: item });

    // Empty category deletes cleanly.
    await goToCategories(page);
    await editCategory(page, empty);
    await page.getByRole('button', { name: 'Delete category' }).click();
    await expect(categoryRow(page, empty)).toHaveCount(0);

    // Non-empty category is blocked with a visible explanation in the dialog.
    await editCategory(page, nonEmpty);
    await page.getByRole('button', { name: 'Delete category' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toContainText(/contains stock items/i);

    // Category and its item are unchanged.
    await page.getByRole('button', { name: 'Close category editor' }).click();
    await expect(categoryRow(page, nonEmpty)).toBeVisible();
    await expect(
      categoryRow(page, nonEmpty).locator('td[data-label="Items"]'),
    ).toHaveText('1');
    await page.goto('/inventory');
    await expect(itemRow(page, item)).toBeVisible();
  });

  // AC crit 4: an owner can place categories in a preferred order by changing
  // their sort weights, and that order is shown after reopening/reloading.
  //
  // The order is driven through the sort-weight field (the underlying mechanism
  // the "Move up/down" buttons write to) rather than the buttons themselves:
  // the dev database persists across runs, so the two categories are not
  // guaranteed to be adjacent, and rapid button clicks would fire overlapping
  // reorder writes. Setting explicit, well-separated weights is one round-trip
  // each and makes the saved order deterministic.
  test('category reorder persists across reload', async ({ page }) => {
    const first = unique('AAA-Order');
    const second = unique('BBB-Order');
    await goToCategories(page);
    // Weights far above any seeded/leftover category so the two are isolated;
    // `first` heavier than `second`, so `second` must sort above `first`.
    await createCategory(page, first, { sortWeight: 960900 });
    await createCategory(page, second, { sortWeight: 960100 });

    const secondAboveFirst = async () => {
      const s = await indexOfCategory(page, second);
      const f = await indexOfCategory(page, first);
      return s >= 0 && f >= 0 && s < f;
    };

    // The chosen order is shown immediately...
    await expect.poll(secondAboveFirst).toBe(true);
    // ...and survives a reload (persisted, not just optimistic UI state).
    await reloadCategories(page);
    await expect.poll(secondAboveFirst).toBe(true);

    // Changing a sort weight re-places the category: make `second` the heavier
    // of the two and confirm the order flips and persists.
    await editCategory(page, second);
    await page.locator('#stock-category-weight').fill('961900');
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const firstAboveSecond = async () => {
      const s = await indexOfCategory(page, second);
      const f = await indexOfCategory(page, first);
      return s >= 0 && f >= 0 && f < s;
    };
    await expect.poll(firstAboveSecond).toBe(true);
    await reloadCategories(page);
    await expect.poll(firstAboveSecond).toBe(true);
  });

  // AC crit 4 (edge): equal sort weights fall back to a stable name-ascending
  // secondary order that survives reload.
  test('sort-weight tie orders by name and persists', async ({ page }) => {
    const alpha = unique('AAA-Tie');
    const bravo = unique('BBB-Tie');
    await goToCategories(page);
    // Both created with the same explicit sort weight.
    await createCategory(page, alpha, { sortWeight: 970001 });
    await createCategory(page, bravo, { sortWeight: 970001 });

    const alphaAboveBravo = async () => {
      const a = await indexOfCategory(page, alpha);
      const b = await indexOfCategory(page, bravo);
      return a >= 0 && b >= 0 && a < b;
    };
    await expect.poll(alphaAboveBravo).toBe(true);
    await reloadCategories(page);
    await expect.poll(alphaAboveBravo).toBe(true);
  });

  // AC crit 5: the category item count reacts to add, delete, and both sides of
  // a move.
  test('category item count reacts to add, move and delete', async ({ page }) => {
    const from = unique('From-Cat');
    const to = unique('To-Cat');
    await goToCategories(page);
    await createCategory(page, from);
    await createCategory(page, to);

    // Add: creating an item in `from` makes its count 1, `to` stays 0.
    const item = unique('Mover');
    await createItem(page, { category: from, name: item });
    await goToCategories(page);
    await expect(
      categoryRow(page, from).locator('td[data-label="Items"]'),
    ).toHaveText('1');
    await expect(
      categoryRow(page, to).locator('td[data-label="Items"]'),
    ).toHaveText('0');

    // Move: reassigning the item flips both counts.
    await openItemEditor(page, item);
    await page.locator('#inventory-item-category').selectOption({ label: to });
    await page.getByRole('button', { name: 'Save stock item' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await goToCategories(page);
    await expect(
      categoryRow(page, from).locator('td[data-label="Items"]'),
    ).toHaveText('0');
    await expect(
      categoryRow(page, to).locator('td[data-label="Items"]'),
    ).toHaveText('1');

    // Delete: removing the item returns `to` to 0.
    await openItemEditor(page, item);
    await page.getByRole('button', { name: 'Delete stock item' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await goToCategories(page);
    await expect(
      categoryRow(page, to).locator('td[data-label="Items"]'),
    ).toHaveText('0');
  });

  // AC crit 3 (edge): blank name is rejected with a visible explanation.
  test('category blank-name validation blocks save', async ({ page }) => {
    await goToCategories(page);
    await page.getByRole('button', { name: 'Create category' }).click();
    await page.locator('#stock-category-name').fill('   ');
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(page.locator('#stock-category-name-error')).toBeVisible();
    // The dialog stays open (save was blocked).
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  // === Stock items: columns, create/edit, delete =============================

  // AC crit 6/7: create with required category + name, a changed unit, optional
  // size, count method, Critical, Reconciled and active; the list shows every
  // column and edits persist on return.
  test('stock item create, list columns and edit persist', async ({ page }) => {
    const category = unique('Dairy-Items');
    await goToCategories(page);
    await createCategory(page, category);

    const name = unique('Whole Milk');
    await createItem(page, {
      category,
      name,
      unit: 'ml',
      size: '1L',
      countMethod: 'Level',
      critical: true,
      active: true,
    });

    // List columns.
    const row = itemRow(page, name);
    await expect(row.locator('td[data-label="Category"]')).toHaveText(category);
    await expect(row.locator('td[data-label="Unit"]')).toHaveText('ml');
    await expect(row.locator('td[data-label="Size"]')).toHaveText('1L');
    await expect(row.locator('td[data-label="Count method"]')).toHaveText('Level');
    await expect(row.locator('td[data-label="Reconciled"]')).toContainText('No');
    await expect(row.locator('td[data-label="Critical"]')).toContainText('Yes');
    await expect(row.locator('td[data-label="Status"]')).toContainText('Active');

    // The unit defaults to pcs on a fresh form (crit 7).
    await page.goto('/inventory/items/new');
    await expect(page.locator('#inventory-item-unit')).toHaveValue('pcs');

    // Edit: flip Critical off and deactivate; changes visible on return.
    await openItemEditor(page, name);
    await page.getByRole('switch', { name: 'Critical' }).click();
    await page.getByRole('switch', { name: 'Active' }).click();
    await page.getByRole('button', { name: 'Save stock item' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await page.reload();
    await expect(
      itemRow(page, name).locator('td[data-label="Critical"]'),
    ).toContainText('No');
    await expect(
      itemRow(page, name).locator('td[data-label="Status"]'),
    ).toContainText('Inactive');
  });

  // AC crit 7 (edge): missing required category/name blocks save with a visible
  // explanation identifying what needs correcting.
  test('stock item required-field validation blocks save', async ({ page }) => {
    await page.goto('/inventory/items/new');
    await page.locator('#inventory-item-name').fill('   ');
    await page.getByRole('button', { name: 'Save stock item' }).click();
    // Stays on the editor with field-level messages surfaced.
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    await expect(page.getByText('Choose a stock category.')).toBeVisible();
    await expect(page.getByText('Enter a stock item name.')).toBeVisible();
  });

  // === Reconciled ↔ count-method coupling (crit 8) ===========================

  // Turning Reconciled on forces Quantity and makes Level unavailable.
  test('reconciled forces quantity and disables level in the form', async ({
    page,
  }) => {
    await page.goto('/inventory/items/new');
    const quantity = page.getByRole('radio', { name: /Quantity/ });
    const level = page.getByRole('radio', { name: /Level/ });

    // Choose Level first, then turn Reconciled on.
    await level.check();
    await expect(level).toBeChecked();
    await page.getByRole('switch', { name: 'Reconciled' }).click();

    // Count method snaps back to Quantity and Level is no longer selectable.
    await expect(quantity).toBeChecked();
    await expect(level).toBeDisabled();
  });

  // A direct Reconciled+Level save request is rejected server-side and leaves
  // the stored item unchanged.
  test('reconciled + level save request is rejected server-side, item unchanged', async ({
    page,
  }) => {
    const category = unique('Recon-Cat');
    await goToCategories(page);
    await createCategory(page, category);
    const name = unique('Recon Target');
    // Create an ordinary Level, non-reconciled item.
    await createItem(page, { category, name, countMethod: 'Level' });

    // Resolve the item's id via the authenticated browser request context (the
    // API auth cookie is shared with page.request after UI sign-in).
    const list = await page.request.get(
      `${API_BASE_URL}/inventory/items?search=${encodeURIComponent(name)}`,
    );
    expect(list.ok()).toBeTruthy();
    const items = (await list.json()) as Array<{
      id: string;
      name: string;
      countMethod: string;
      reconciled: boolean;
    }>;
    const target = items.find((it) => it.name === name);
    expect(target, 'seeded Level item is listed').toBeTruthy();

    // Attempt the forbidden combination directly against the API.
    const patch = await page.request.patch(
      `${API_BASE_URL}/inventory/items/${target!.id}`,
      { data: { reconciled: true, countMethod: 'LEVEL' } },
    );
    expect(patch.status()).toBe(400);

    // The stored item is unchanged: still Level, still not reconciled.
    const after = await page.request.get(
      `${API_BASE_URL}/inventory/items/${target!.id}`,
    );
    const stored = (await after.json()) as {
      countMethod: string;
      reconciled: boolean;
    };
    expect(stored.countMethod).toBe('LEVEL');
    expect(stored.reconciled).toBe(false);
  });

  // === Search & filters (crit 11/12) =========================================

  test('search and multiple filters combine with AND semantics', async ({
    page,
  }) => {
    const catX = unique('FilterCat-X');
    const catY = unique('FilterCat-Y');
    await goToCategories(page);
    await createCategory(page, catX);
    await createCategory(page, catY);

    const alphaRecon = unique('Alpha Recon');
    const alphaPlain = unique('Alpha Plain');
    const betaRecon = unique('Beta Recon');
    // Reconciled forces Quantity, which is fine for these rows.
    await createItem(page, {
      category: catX,
      name: alphaRecon,
      reconciled: true,
      critical: true,
    });
    await createItem(page, { category: catX, name: alphaPlain });
    await createItem(page, { category: catY, name: betaRecon, reconciled: true });

    await page.goto('/inventory');

    // Search by name only: "Alpha" matches the two Alpha rows, not Beta.
    const search = page.getByPlaceholder('Search by item name');
    await search.fill('Alpha');
    await expect(itemRow(page, alphaRecon)).toBeVisible();
    await expect(itemRow(page, alphaPlain)).toBeVisible();
    await expect(itemRow(page, betaRecon)).toHaveCount(0);

    // Add category = catX and Reconciled = Yes: only alphaRecon satisfies all.
    await itemFilter(page, 'Category').selectOption({ label: catX });
    await itemFilter(page, 'Reconciled').selectOption('true');
    await expect(itemRow(page, alphaRecon)).toBeVisible();
    await expect(itemRow(page, alphaPlain)).toHaveCount(0); // excluded: not reconciled
    await expect(itemRow(page, betaRecon)).toHaveCount(0); // excluded: search + category

    // Add Critical = No: now zero rows match → empty state.
    await itemFilter(page, 'Critical').selectOption('false');
    await expect(itemRow(page, alphaRecon)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'No items match these filters' }),
    ).toBeVisible();
  });

  test('count-method and active filters narrow the list', async ({ page }) => {
    const category = unique('MethodCat');
    await goToCategories(page);
    await createCategory(page, category);

    const quantityItem = unique('Counted Beans');
    const levelItem = unique('Estimated Syrup');
    const inactiveItem = unique('Retired Straw');
    await createItem(page, { category, name: quantityItem, countMethod: 'Quantity' });
    await createItem(page, { category, name: levelItem, countMethod: 'Level' });
    await createItem(page, { category, name: inactiveItem, active: false });

    await page.goto('/inventory');
    await itemFilter(page, 'Category').selectOption({ label: category });

    // Count-method filter.
    await itemFilter(page, 'Count method').selectOption('LEVEL');
    await expect(itemRow(page, levelItem)).toBeVisible();
    await expect(itemRow(page, quantityItem)).toHaveCount(0);
    await itemFilter(page, 'Count method').selectOption('');

    // Active/inactive filter.
    await itemFilter(page, 'Status').selectOption('false');
    await expect(itemRow(page, inactiveItem)).toBeVisible();
    await expect(itemRow(page, quantityItem)).toHaveCount(0);
  });

  // === Delete guard for stock items (crit 10) ================================

  test('unreferenced item deletes; referenced item delete is blocked', async ({
    page,
  }) => {
    // Unreferenced: deleting removes it from the list.
    const category = unique('DeleteCat');
    await goToCategories(page);
    await createCategory(page, category);
    const disposable = unique('Disposable Item');
    await createItem(page, { category, name: disposable });
    await openItemEditor(page, disposable);
    await page.getByRole('button', { name: 'Delete stock item' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(itemRow(page, disposable)).toHaveCount(0);

    // Referenced (seeded as a catalog product-size Cup mapping): blocked.
    const referenced = seedReferencedCupItem(RUN);
    await page.goto(`/inventory/items/${referenced.id}/edit`);
    await expect(page.locator('#inventory-item-name')).toHaveValue(referenced.name);
    await page.getByRole('button', { name: 'Delete stock item' }).click();

    // A clear explanation is shown and the item is unchanged (still editable).
    await expect(page.getByRole('alert')).toContainText(
      /cannot be deleted because it is referenced/i,
    );
    await expect(page).toHaveURL(/\/inventory\/items\/.+\/edit$/);
    await page.goto('/inventory');
    await expect(itemRow(page, referenced.name)).toBeVisible();
  });

  // === Par levels (crit 13/14/15/16) =========================================

  // Accepts Urgent = Low = Par and all-zero values, keeps day types independent,
  // and the saved values survive reload.
  test('par levels accept boundary values, stay independent and persist', async ({
    page,
  }) => {
    const category = unique('ParCat');
    await goToCategories(page);
    await createCategory(page, category);
    const name = unique('Par Item');

    await createItem(page, {
      category,
      name,
      normal: { par: '5', low: '5', urgent: '5' }, // Urgent = Low = Par
      peak: { par: '0', low: '0', urgent: '0' }, // all zero
    });

    // Values persist after reopening the editor.
    await openItemEditor(page, name);
    await expect(page.locator('#normal-par')).toHaveValue('5');
    await expect(page.locator('#normal-low')).toHaveValue('5');
    await expect(page.locator('#normal-urgent')).toHaveValue('5');
    await expect(page.locator('#peak-par')).toHaveValue('0');
    await expect(page.locator('#peak-low')).toHaveValue('0');
    await expect(page.locator('#peak-urgent')).toHaveValue('0');

    // Change only Normal-day par; Peak-day par is untouched (independence).
    await page.locator('#normal-par').fill('9');
    await page.getByRole('button', { name: 'Save stock item' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await openItemEditor(page, name);
    await expect(page.locator('#normal-par')).toHaveValue('9');
    await expect(page.locator('#peak-par')).toHaveValue('0');
  });

  // Rejects every invalid par/threshold shape with a visible explanation and
  // leaves previously saved values unchanged.
  test('par level validation blocks invalid values and preserves saved data', async ({
    page,
  }) => {
    const category = unique('ParValidCat');
    await goToCategories(page);
    await createCategory(page, category);
    const name = unique('Par Valid Item');
    await createItem(page, { category, name, normal: { par: '4', low: '2', urgent: '1' } });

    await openItemEditor(page, name);
    const save = page.getByRole('button', { name: 'Save stock item' });

    // Negative par.
    await page.locator('#normal-par').fill('-1');
    await save.click();
    await expect(page).toHaveURL(/\/inventory\/items\/.+\/edit$/);
    await expect(
      page.getByText(/Normal day par must be a non-negative whole number/i),
    ).toBeVisible();

    // Non-whole par.
    await page.locator('#normal-par').fill('1.5');
    await save.click();
    await expect(
      page.getByText(/Normal day par must be a non-negative whole number/i),
    ).toBeVisible();

    // Urgent without Low.
    await page.locator('#normal-par').fill('4');
    await page.locator('#normal-low').fill('');
    await page.locator('#normal-urgent').fill('2');
    await save.click();
    await expect(
      page.getByText(/Enter Normal day Low before adding Urgent/i),
    ).toBeVisible();

    // Ordering violation: Low > Par.
    await page.locator('#normal-low').fill('9');
    await page.locator('#normal-urgent').fill('');
    await save.click();
    await expect(
      page.getByText(/Normal day Low must be less than or equal to Par/i),
    ).toBeVisible();

    // Ordering violation: Urgent > Low.
    await page.locator('#normal-low').fill('2');
    await page.locator('#normal-urgent').fill('3');
    await save.click();
    await expect(
      page.getByText(/Normal day Urgent must be less than or equal to Low/i),
    ).toBeVisible();

    // Every blocked save left the originally saved values intact.
    await page.goto('/inventory');
    await openItemEditor(page, name);
    await expect(page.locator('#normal-par')).toHaveValue('4');
    await expect(page.locator('#normal-low')).toHaveValue('2');
    await expect(page.locator('#normal-urgent')).toHaveValue('1');
  });
});
