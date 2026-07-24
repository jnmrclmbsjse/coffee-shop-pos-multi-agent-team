import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #40 — "Manage catalog categories, products,
 * sizes, and availability" (QA Task #44).
 *
 * Every acceptance criterion listed on #44 is exercised through the real
 * browser → web app → NestJS API → PostgreSQL path (no mocking). Fixtures are
 * the seeded `admin` (ADMIN) user from apps/api/prisma/seed.ts. Catalog data is
 * created by the tests themselves through the UI, so the suite is self-contained
 * and safe to re-run against a persistent database (all created records use a
 * per-run unique suffix to avoid name collisions and cross-test interference).
 *
 * Stock items (Cup/Lid mapping targets) have no creation surface in this story —
 * the story explicitly defers stock-item management to a future story — so a
 * small idempotent seed of active InventoryItem rows is applied once via the API
 * package's Prisma client before the mapping criteria run.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const REPO_ROOT = resolve(__dirname, '..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

// Deterministic stock-item labels seeded for the Cup/Lid mapping criteria.
const CUP_ITEM = '12oz Paper Cup';
const LID_ITEM = 'Standard Dome Lid';

// Unique per-run suffix keeps created categories/products from colliding with
// records left behind by earlier runs (the dev database persists between runs).
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
 * Idempotently ensure the Cup/Lid mapping targets exist and are active. Runs the
 * API package's Prisma client (not hoisted to the repo root) with apps/api as the
 * working directory so `@prisma/client` resolves.
 */
function seedStockItems(): void {
  const script = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const items = [
      { sku: 'E2E-CUP-12OZ', name: ${JSON.stringify(CUP_ITEM)}, unit: 'piece' },
      { sku: 'E2E-LID-STD', name: ${JSON.stringify(LID_ITEM)}, unit: 'piece' },
    ];
    (async () => {
      for (const it of items) {
        await prisma.inventoryItem.upsert({
          where: { sku: it.sku },
          update: { name: it.name, unit: it.unit, active: true },
          create: { ...it, active: true },
        });
      }
      await prisma.$disconnect();
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  execFileSync('node', ['-e', script], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdio: 'pipe',
  });
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// ---- Categories page helpers -------------------------------------------------

function categoryRow(page: Page, name: string): Locator {
  return page.locator('tr', { has: page.getByRole('cell', { name, exact: true }) });
}

async function createCategory(
  page: Page,
  name: string,
  active = true,
): Promise<void> {
  await page.getByRole('button', { name: 'Create category' }).first().click();
  await page.locator('#category-name').fill(name);
  await page
    .locator('#category-state')
    .selectOption(active ? 'active' : 'inactive');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(categoryRow(page, name)).toBeVisible();
}

// ---- Product editor helpers --------------------------------------------------

function productRow(page: Page, name: string): Locator {
  // The product-name cell also carries a "<n> sizes" hint, so match the bold
  // product name exactly rather than the whole cell's accessible name.
  return page.locator('tbody tr', {
    has: page.getByText(name, { exact: true }),
  });
}

/** The n-th size row block in the editor (0-indexed). */
function sizeRow(page: Page, index: number): Locator {
  return page.locator('.size-row').nth(index);
}

// The Category / Label / Price fields carry a required-marker "*" in their
// <label>, so their accessible name is not an exact "Category"/"Label"/"Price".
// Target the underlying controls by id/attribute instead.
function categorySelect(page: Page): Locator {
  return page.locator('#product-category');
}
function sizeNameInput(row: Locator): Locator {
  return row.locator('input[id^="size-name-"]');
}
function sizePriceInput(row: Locator): Locator {
  return row.locator('input[id^="size-price-"]');
}

async function fillSize(
  row: Locator,
  label: string,
  price: string,
): Promise<void> {
  await sizeNameInput(row).fill(label);
  await sizePriceInput(row).fill(price);
}

/**
 * Create a product through the editor with a single size and return its name.
 * The caller supplies the category name (must already exist).
 */
async function createProduct(
  page: Page,
  options: {
    category: string;
    name: string;
    sizeLabel?: string;
    price?: string;
    active?: boolean;
    available?: boolean;
  },
): Promise<void> {
  await page.goto('/catalog/products/new');
  await categorySelect(page).selectOption({ label: options.category });
  await page.locator('#product-name').fill(options.name);
  if (options.active === false) {
    await page.getByRole('switch', { name: 'Catalog active' }).click();
  }
  if (options.available === false) {
    await page.getByRole('switch', { name: 'Currently available' }).click();
  }
  await fillSize(sizeRow(page, 0), options.sizeLabel ?? 'Regular', options.price ?? '120.00');
  await page.getByRole('button', { name: 'Save product' }).first().click();
  await expect(page).toHaveURL(/\/catalog\/products$/);
  await expect(productRow(page, options.name)).toBeVisible();
}

/** Keyboard reorder: lift the handle, step one row, drop. */
async function keyboardMove(
  handle: Locator,
  direction: 'ArrowUp' | 'ArrowDown',
): Promise<void> {
  await handle.focus();
  await handle.press(' ');
  await handle.press(direction);
  await handle.press(' ');
}

test.describe('Catalog management (story #40)', () => {
  test.beforeAll(() => {
    seedStockItems();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // === Categories ============================================================

  // AC: category list shows name, sort weight, active/inactive and product
  // count; create then edit persist and are visible on return.
  test('category create, list columns, edit — all persist across reload', async ({
    page,
  }) => {
    const name = unique('Espresso');
    await page.goto('/catalog/categories');
    await createCategory(page, name, true);

    const row = categoryRow(page, name);
    // Columns: name, a numeric stored weight, Active status, 0 products.
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    await expect(row.locator('td[data-label="Stored weight"]')).toHaveText(/\d+/);
    await expect(row.locator('td[data-label="Products"]')).toHaveText('0');

    // Persist across reload.
    await page.reload();
    await expect(categoryRow(page, name)).toBeVisible();

    // Edit: rename and flip to inactive; changes visible on return.
    const renamed = `${name} Bar`;
    await categoryRow(page, name).getByRole('button', { name: 'Edit' }).click();
    await page.locator('#category-name').fill(renamed);
    await page.locator('#category-state').selectOption('inactive');
    await page.getByRole('button', { name: 'Save category' }).click();

    await page.reload();
    const editedRow = categoryRow(page, renamed);
    await expect(editedRow).toBeVisible();
    await expect(editedRow.getByText('Inactive', { exact: true })).toBeVisible();
  });

  // AC / edge: blank name and case-insensitive-trimmed duplicate are rejected
  // with a visible validation message.
  test('category name validation: blank and duplicate rejected', async ({
    page,
  }) => {
    const name = unique('Latte');
    await page.goto('/catalog/categories');
    await createCategory(page, name);

    // Blank name.
    await page.getByRole('button', { name: 'Create category' }).first().click();
    await page.locator('#category-name').fill('   ');
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(page.locator('#category-name-error')).toBeVisible();

    // Duplicate ignoring case and surrounding spaces.
    await page.locator('#category-name').fill(`  ${name.toUpperCase()}  `);
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(page.locator('#category-name-error')).toContainText(/already exists/i);
  });

  // AC: categories can be reordered and the new order persists across reload.
  test('categories reorder persists across reload', async ({ page }) => {
    const first = unique('AAA-Cat');
    const second = unique('BBB-Cat');
    await page.goto('/catalog/categories');
    await createCategory(page, first);
    await createCategory(page, second);

    const indexOfName = async (target: string): Promise<number> => {
      const all = await page
        .locator('tbody tr td[data-label="Category name"]')
        .allInnerTexts();
      return all.indexOf(target);
    };
    const secondAboveFirst = async (): Promise<boolean> => {
      const s = await indexOfName(second);
      const f = await indexOfName(first);
      return s >= 0 && f >= 0 && s < f;
    };

    // `second` was created after `first`, so it sorts below it initially.
    await expect.poll(async () => {
      const s = await indexOfName(second);
      const f = await indexOfName(first);
      return s >= 0 && f >= 0 && s > f;
    }).toBe(true);

    // Move `second` up one row via the keyboard reorder control.
    const handle = page.getByRole('button', {
      name: new RegExp(`^Reorder ${second}\\.`),
    });
    await keyboardMove(handle, 'ArrowUp');
    await expect(page.getByText('Category order saved.')).toBeVisible();

    await expect.poll(secondAboveFirst).toBe(true);

    // Order survives a reload (stored sort weights were rewritten).
    await page.reload();
    await expect.poll(secondAboveFirst).toBe(true);
  });

  // === Product list: search / filter / sort / columns ========================

  // AC: search (case-insensitive partial, name only), filter by category and
  // active status, sort by category/name/active; list shows category, name,
  // active state and availability.
  test('product list search, filters, sort and columns', async ({ page }) => {
    const catA = unique('Coffee');
    const catB = unique('Pastry');
    await page.goto('/catalog/categories');
    await createCategory(page, catA);
    await createCategory(page, catB);

    const flatWhite = unique('Flat White');
    const croissant = unique('Croissant');
    const coldBrew = unique('Cold Brew');
    await createProduct(page, { category: catA, name: flatWhite, active: true });
    await createProduct(page, { category: catA, name: coldBrew, active: false });
    await createProduct(page, { category: catB, name: croissant, active: true });

    await page.goto('/catalog/products');

    // Columns: category, name, catalog state, availability control all present.
    const fwRow = productRow(page, flatWhite);
    await expect(fwRow.getByRole('cell', { name: catA, exact: true })).toBeVisible();
    await expect(fwRow.getByText('Active', { exact: true })).toBeVisible();
    await expect(
      fwRow.getByRole('switch', { name: `${flatWhite} availability` }),
    ).toBeVisible();

    // Case-insensitive partial search on product name.
    const search = page.getByPlaceholder('Search product name');
    await search.fill('flat wh');
    await expect(productRow(page, flatWhite)).toBeVisible();
    await expect(productRow(page, croissant)).toHaveCount(0);

    // Search matches the product name only — not the category name.
    await search.fill(catA.split(' ')[0]); // e.g. "Coffee"
    await expect(productRow(page, flatWhite)).toHaveCount(0);
    await expect(productRow(page, croissant)).toHaveCount(0);
    await search.fill('');

    // Filter by category.
    await page.getByLabel('Filter by category').selectOption({ label: catB });
    await expect(productRow(page, croissant)).toBeVisible();
    await expect(productRow(page, flatWhite)).toHaveCount(0);
    await page.getByLabel('Filter by category').selectOption('');

    // Filter by active status (inactive shows Cold Brew, hides the active ones).
    await page.getByLabel('Filter by catalog state').selectOption('inactive');
    await expect(productRow(page, coldBrew)).toBeVisible();
    await expect(productRow(page, flatWhite)).toHaveCount(0);
    await page.getByLabel('Filter by catalog state').selectOption('all');

    // Sort by product name — verify our three products are in ascending order.
    await page.getByLabel('Sort products').selectOption('name');
    const names = await page
      .locator('tbody tr td[data-label="Product name"] strong')
      .allInnerTexts();
    const mine = names.filter((n) =>
      [flatWhite, croissant, coldBrew].includes(n),
    );
    expect(mine).toEqual([...mine].sort((a, b) => a.localeCompare(b)));
  });

  // AC / edge: inactive product and sold-out-but-active product are represented
  // distinctly (catalog state vs availability are independent fields).
  test('active vs available are shown as distinct states', async ({ page }) => {
    const cat = unique('Drinks');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);

    const inactive = unique('Retired Mocha');
    const soldOut = unique('Popular Americano');
    await createProduct(page, { category: cat, name: inactive, active: false, available: true });
    await createProduct(page, { category: cat, name: soldOut, active: true, available: false });

    await page.goto('/catalog/products');

    const inactiveRow = productRow(page, inactive);
    await expect(inactiveRow.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(
      inactiveRow.getByRole('switch', { name: `${inactive} availability` }),
    ).toHaveAttribute('aria-checked', 'true');

    const soldOutRow = productRow(page, soldOut);
    await expect(soldOutRow.getByText('Active', { exact: true })).toBeVisible();
    await expect(soldOutRow.getByText('Sold out', { exact: true })).toBeVisible();
    await expect(
      soldOutRow.getByRole('switch', { name: `${soldOut} availability` }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  // AC: inline Available/Sold-out toggle on the product list persists and is
  // reflected consistently after reload (availability single source of truth).
  test('inline availability toggle persists across reload', async ({ page }) => {
    const cat = unique('Seasonal');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const product = unique('Pumpkin Latte');
    await createProduct(page, { category: cat, name: product, available: true });

    await page.goto('/catalog/products');
    const toggle = productRow(page, product).getByRole('switch', {
      name: `${product} availability`,
    });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(
      productRow(page, product).getByText('Sold out', { exact: true }),
    ).toBeVisible();

    // Persisted: reload the list and confirm it reads back as sold out.
    await page.reload();
    await expect(
      productRow(page, product).getByRole('switch', {
        name: `${product} availability`,
      }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  // AC / edge: availability set in the back-office editor is the value read back
  // on the product list after reload (single field, no divergence). The POS
  // product-listing surface is not reachable in e2e for this story (POS route is
  // a placeholder), so cross-surface reflection is covered by the shared
  // availability field asserted here; see the QA verdict note.
  test('availability round-trips between editor and product list', async ({
    page,
  }) => {
    const cat = unique('Signature');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const product = unique('House Blend');
    await createProduct(page, { category: cat, name: product, available: true });

    // Set to sold out from the editor.
    await page.goto('/catalog/products');
    await productRow(page, product).getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/.+\/edit$/);
    await page.getByRole('switch', { name: 'Currently available' }).click();
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    // The product list reflects the editor's availability after reload.
    await page.reload();
    await expect(
      productRow(page, product).getByRole('switch', {
        name: `${product} availability`,
      }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  // AC / edge: category product count updates when a product's category changes.
  test('category product count follows a product between categories', async ({
    page,
  }) => {
    const from = unique('From-Cat');
    const to = unique('To-Cat');
    await page.goto('/catalog/categories');
    await createCategory(page, from);
    await createCategory(page, to);
    const product = unique('Movable Feast');
    await createProduct(page, { category: from, name: product });

    await page.goto('/catalog/categories');
    await expect(
      categoryRow(page, from).locator('td[data-label="Products"]'),
    ).toHaveText('1');
    await expect(
      categoryRow(page, to).locator('td[data-label="Products"]'),
    ).toHaveText('0');

    // Reassign the product to the other category.
    await page.goto('/catalog/products');
    await productRow(page, product).getByRole('link', { name: 'Edit' }).click();
    await categorySelect(page).selectOption({ label: to });
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    await page.goto('/catalog/categories');
    await expect(
      categoryRow(page, from).locator('td[data-label="Products"]'),
    ).toHaveText('0');
    await expect(
      categoryRow(page, to).locator('td[data-label="Products"]'),
    ).toHaveText('1');
  });

  // === Product create / edit / required fields ===============================

  // AC: create/edit a product with required category, required name,
  // active/inactive and available/sold-out; changes visible on return.
  test('product create and edit persist product-level fields', async ({
    page,
  }) => {
    const cat = unique('Editable');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const name = unique('Editable Drink');
    await createProduct(page, {
      category: cat,
      name,
      active: true,
      available: true,
    });

    // Edit: flip active and available, confirm on return via the list.
    await page.goto('/catalog/products');
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    await page.getByRole('switch', { name: 'Catalog active' }).click(); // -> inactive
    await page.getByRole('switch', { name: 'Currently available' }).click(); // -> sold out
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    await page.reload();
    const row = productRow(page, name);
    await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(row.getByText('Sold out', { exact: true })).toBeVisible();
  });

  // AC / edge: saving is rejected with a visible validation message when no
  // category is selected or the name is blank after trimming.
  test('product required-field validation blocks save', async ({ page }) => {
    await page.goto('/catalog/products/new');
    // No category, blank name, default valid price.
    await page.locator('#product-name').fill('   ');
    await page.getByRole('button', { name: 'Save product' }).first().click();

    // Stays on the editor with field-level messages surfaced.
    await expect(page).toHaveURL(/\/catalog\/products\/new$/);
    await expect(page.locator('#product-category-error')).toBeVisible();
    await expect(page.locator('#product-name-error')).toBeVisible();
  });

  // === Sizes: persistence, price boundary, mappings, reorder, removal ========

  // AC: a product always has >=1 size; each size persists label, price, sort
  // weight and active/inactive.
  test('size fields persist across reload of the editor', async ({ page }) => {
    const cat = unique('Sized');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const name = unique('Sized Drink');

    await page.goto('/catalog/products/new');
    await categorySelect(page).selectOption({ label: cat });
    await page.locator('#product-name').fill(name);
    await fillSize(sizeRow(page, 0), 'Tall', '95.50');
    // Flip the size inactive.
    await sizeRow(page, 0).getByRole('switch', { name: /Tall active/ }).click();
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    // Reopen the editor and confirm the size fields round-tripped.
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    const row = sizeRow(page, 0);
    await expect(sizeNameInput(row)).toHaveValue('Tall');
    await expect(sizePriceInput(row)).toHaveValue('95.50');
    await expect(row.getByRole('switch', { name: /Tall active/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  // AC / edge: price boundary — 0 accepted; negative and missing rejected with a
  // field-level error naming the affected size, and the save is blocked.
  test('size price boundary: zero saves, negative and empty are rejected', async ({
    page,
  }) => {
    const cat = unique('Priced');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);

    // Negative price is rejected and blocks the save.
    await page.goto('/catalog/products/new');
    await categorySelect(page).selectOption({ label: cat });
    const negName = unique('Negative Price');
    await page.locator('#product-name').fill(negName);
    await fillSize(sizeRow(page, 0), 'Solo', '-1');
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products\/new$/);
    await expect(sizeRow(page, 0).locator('.catalog-field-error')).toContainText(
      /price/i,
    );

    // Empty price is rejected too.
    await sizePriceInput(sizeRow(page, 0)).fill('');
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products\/new$/);
    await expect(sizeRow(page, 0).locator('.catalog-field-error')).toContainText(
      /price/i,
    );

    // Zero is accepted and the product saves.
    await sizePriceInput(sizeRow(page, 0)).fill('0');
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);
    await expect(productRow(page, negName)).toBeVisible();
  });

  // AC / edge: optional Cup and Lid mappings — can be set to an existing stock
  // item and can be left blank; both states persist. Also covers set-then-clear
  // persisting as blank.
  test('cup/lid mappings persist for both set and blank states', async ({
    page,
  }) => {
    const cat = unique('Mapped');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const name = unique('Mapped Drink');

    // Create with Cup set to a real stock item and Lid left blank.
    await page.goto('/catalog/products/new');
    await categorySelect(page).selectOption({ label: cat });
    await page.locator('#product-name').fill(name);
    await fillSize(sizeRow(page, 0), 'Grande', '150.00');
    await sizeRow(page, 0)
      .getByLabel('Cup stock item')
      .selectOption({ label: CUP_ITEM });
    // Lid stays at "No mapping".
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    // Reopen: Cup persisted to the item, Lid persisted as No mapping (blank).
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    let row = sizeRow(page, 0);
    await expect(row.getByLabel('Cup stock item')).toHaveValue(/.+/);
    await expect(
      row.getByLabel('Cup stock item').locator('option:checked'),
    ).toHaveText(CUP_ITEM);
    await expect(
      row.getByLabel('Lid stock item').locator('option:checked'),
    ).toHaveText('No mapping');

    // Now set the Lid, clear the Cup, save, and confirm both changes persist.
    await row.getByLabel('Lid stock item').selectOption({ label: LID_ITEM });
    await row.getByLabel('Cup stock item').selectOption({ label: 'No mapping' });
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    row = sizeRow(page, 0);
    await expect(
      row.getByLabel('Cup stock item').locator('option:checked'),
    ).toHaveText('No mapping');
    await expect(
      row.getByLabel('Lid stock item').locator('option:checked'),
    ).toHaveText(LID_ITEM);
  });

  // AC: sizes can be reordered and the order persists across reload.
  test('sizes reorder and the order persists across reload', async ({ page }) => {
    const cat = unique('Multi');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const name = unique('Multi Size');

    await page.goto('/catalog/products/new');
    await categorySelect(page).selectOption({ label: cat });
    await page.locator('#product-name').fill(name);
    await fillSize(sizeRow(page, 0), 'Small', '80.00');
    await page.getByRole('button', { name: 'Add size' }).click();
    await fillSize(sizeRow(page, 1), 'Large', '110.00');
    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);

    // Reopen and move the second size (Large) above the first (Small).
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    const labelsNow = () =>
      page
        .locator('.size-row')
        .locator('input[id^="size-name-"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    await expect.poll(labelsNow).toEqual(['Small', 'Large']);

    const handle = page.getByRole('button', {
      name: /^Reorder Large\./,
    });
    await keyboardMove(handle, 'ArrowUp');
    await expect.poll(labelsNow).toEqual(['Large', 'Small']);

    // Persisted order survives navigating away and reopening the editor.
    await page.goto('/catalog/products');
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    await expect.poll(labelsNow).toEqual(['Large', 'Small']);
  });

  // AC / edge: removing a size works when >=2 exist; the remove control is
  // unavailable when only one size remains (no product ends up with zero sizes).
  test('last-size guard and size removal', async ({ page }) => {
    const cat = unique('Guarded');
    await page.goto('/catalog/categories');
    await createCategory(page, cat);
    const name = unique('Guarded Drink');

    await page.goto('/catalog/products/new');
    await categorySelect(page).selectOption({ label: cat });
    await page.locator('#product-name').fill(name);
    await fillSize(sizeRow(page, 0), 'One', '70.00');

    // With a single size, the remove control is disabled (last-size guard).
    const removeFirst = sizeRow(page, 0).getByRole('button', { name: /^Remove / });
    await expect(removeFirst).toBeDisabled();

    // Add a second size — now removal is available.
    await page.getByRole('button', { name: 'Add size' }).click();
    await fillSize(sizeRow(page, 1), 'Two', '90.00');
    await expect(
      sizeRow(page, 0).getByRole('button', { name: /^Remove / }),
    ).toBeEnabled();

    await page.getByRole('button', { name: 'Save product' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/products$/);
    await expect(productRow(page, name)).toContainText('2 sizes');

    // Reopen and remove one size; the deletion persists and one size remains.
    await productRow(page, name).getByRole('link', { name: 'Edit' }).click();
    await expect(page.locator('.size-row')).toHaveCount(2);
    await sizeRow(page, 1).getByRole('button', { name: /^Remove / }).click();
    await expect(page.locator('.size-row')).toHaveCount(1);
    // The lone remaining size is now guarded again.
    await expect(
      sizeRow(page, 0).getByRole('button', { name: /^Remove / }),
    ).toBeDisabled();

    await page.goto('/catalog/products');
    await expect(productRow(page, name)).toContainText('1 size');
  });
});
