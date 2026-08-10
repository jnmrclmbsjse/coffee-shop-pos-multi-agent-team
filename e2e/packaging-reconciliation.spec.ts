import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  openPackagingDay,
  readProductServings,
  readSales,
  resetPackagingWorld,
  seedPackagingCatalog,
  seedPackagingStaff,
  seedStockCount,
  setProductServings,
  type PackagingCatalog,
  type SeededDay,
  type SeededItem,
} from './fixtures/packaging-servings';

/**
 * End-to-end coverage for story #247 — "Account for both servings in
 * buy-one-take-one cup and lid usage" (QA task #271).
 *
 * The observable surface for the packaging criteria is the `Cup / lid balance`
 * section of the staff close screen (`/pos/close`,
 * `aria-labelledby="packaging-title"`). The arithmetic under test is
 *
 *     expected = opening + deliveries − wastage − Σ (quantity × servings)
 *
 * (ADR 0010 §3, amending ADR 0006 §5). Every number the criteria state is
 * exact, so this suite asserts absolute values rather than directions of
 * change. That matters most for the void case: a void must not add packaging
 * *back past* the baseline, which a delta assertion cannot see.
 *
 * **Sales are placed through the real `/orders` API, never seeded.** The whole
 * mechanism this story adds is `SaleLine.packagingServingsSnapshot`, written by
 * `OrdersService.lineCreateData` when a line is added. A fixture that inserted
 * sale lines directly would supply the column default of 1 and the suite would
 * pass just as happily against an implementation that never reads the catalog.
 * The API is driven from the browser's own request context so the session
 * cookie and every guard, DTO and transaction on the path are real.
 *
 * The one thing that is *not* asserted through the close screen is money.
 * Criterion 6 forbids the servings count from reaching price, and "the order
 * total did not double" is a statement about stored integer cents, so it is
 * read from the database — a screen that formats correctly over a wrong stored
 * amount is exactly the failure that criterion guards.
 *
 * Fixture isolation follows the contract `business-day.ts` established: the
 * close screen reads "the current open business day" globally, so every test
 * clears the trading-day world and opens exactly the day it needs, and the
 * suite runs serially. Packaging assertions are scoped to this run's own tagged
 * items because the dev database keeps reconciled cup/lid rows from earlier
 * suites.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa247-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Opening count every item in this suite starts from, unless a test says otherwise. */
const OPENING = 100;

let catalog: PackagingCatalog;
let staff: SeededItem;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  staff = seedPackagingStaff(`QA Servings Opener ${TAG}`);
  catalog = seedPackagingCatalog(TAG);
});

test.beforeEach(() => {
  resetPackagingWorld();
});

test.afterAll(() => {
  // Leave one open day and nothing recorded against it — the state the rest of
  // the suite and a developer opening the app both expect.
  resetPackagingWorld();
  openPackagingDay({
    businessDate: businessDate(0),
    openedByStaffMemberId: staff.id,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A business date this suite owns, far enough out that it cannot collide with
 * the days other suites seed. Each test takes its own offset so a leaked row is
 * obvious rather than silently reused.
 */
function businessDate(offset: number): string {
  const base = Date.UTC(2027, 5, 1); // 2027-06-01
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The API origin on the same hostname the page is served from. The session is
 * an httpOnly SameSite=Lax cookie, so a request to a different spelling of
 * localhost would travel without it and 401 for the wrong reason.
 */
function apiOrigin(baseURL: string | undefined): string {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL;
  const hostname = baseURL ? new URL(baseURL).hostname : '127.0.0.1';
  return `http://${hostname}:3000`;
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

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Open the close screen and wait for it to finish loading. */
async function gotoClose(page: Page): Promise<void> {
  await page.goto('/pos/close');
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
  await expect(page.locator('.staff-packaging-table')).toBeVisible();
}

function packagingRow(page: Page, itemName: string): Locator {
  return page
    .locator('.staff-packaging-table tbody tr')
    .filter({ hasText: itemName });
}

/** The rendered Expected figure for one reconciled item. */
async function expectedFor(page: Page, item: SeededItem): Promise<string> {
  const cells = packagingRow(page, item.name).locator('td');
  await expect(cells).toHaveCount(3);
  return (await cells.nth(0).innerText()).trim();
}

/**
 * Assert the Expected column for a set of items in one read of the screen.
 * Numbers are given as numbers so a test reads as arithmetic, not as strings.
 */
async function expectExpected(
  page: Page,
  expectations: Array<[SeededItem, number | string]>,
): Promise<void> {
  for (const [item, value] of expectations) {
    expect(
      await expectedFor(page, item),
      `Expected column for ${item.name}`,
    ).toBe(String(value));
  }
}

// --- placing real orders ----------------------------------------------------

interface PlacedOrder {
  clientGeneratedId: string;
  totalCents: number;
}

/**
 * A cashier device id. Orders are keyed to one, and the active-cashier suite
 * keys its own state by device, so each order gets a fresh one.
 */
function deviceId(): string {
  return `qa247-${randomUUID()}`;
}

async function postOk(
  request: APIRequestContext,
  url: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await request.post(url, { data, failOnStatusCode: false });
  expect(
    response.ok(),
    `POST ${url} failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Park an order holding the given lines, through the real order-capture API.
 *
 * The first line goes on `POST /orders` and the rest on
 * `POST /orders/:id/lines`, which is the path the Take Order screen itself
 * uses, so both entry points into `lineCreateData` are exercised.
 */
async function parkOrder(
  request: APIRequestContext,
  origin: string,
  lines: Array<{ variantId: string; quantity?: number }>,
): Promise<PlacedOrder> {
  const clientGeneratedId = randomUUID();
  const device = deviceId();
  const [first, ...rest] = lines;

  let order = await postOk(request, `${origin}/orders`, {
    clientGeneratedId,
    deviceId: device,
    productVariantId: first!.variantId,
    quantity: first!.quantity ?? 1,
    serviceType: 'TAKE_OUT',
  });
  for (const line of rest) {
    order = await postOk(
      request,
      `${origin}/orders/${clientGeneratedId}/lines`,
      { productVariantId: line.variantId, quantity: line.quantity ?? 1 },
    );
  }

  return { clientGeneratedId, totalCents: Number(order.totalCents) };
}

/** Settle a parked order in cash for exactly its total. */
async function completeOrder(
  request: APIRequestContext,
  origin: string,
  order: PlacedOrder,
): Promise<void> {
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/complete`, {
    payments: [{ method: 'CASH', amountCents: order.totalCents }],
  });
}

/** Park, then immediately complete — the ordinary "a sale happened" path. */
async function sell(
  request: APIRequestContext,
  origin: string,
  lines: Array<{ variantId: string; quantity?: number }>,
): Promise<PlacedOrder> {
  const order = await parkOrder(request, origin, lines);
  await completeOrder(request, origin, order);
  return order;
}

/** Record a void correction against a completed sale. */
async function voidOrder(
  request: APIRequestContext,
  origin: string,
  order: PlacedOrder,
): Promise<void> {
  await postOk(request, `${origin}/orders/${order.clientGeneratedId}/void`, {
    clientGeneratedId: randomUUID(),
    deviceId: deviceId(),
    voidReason: `QA servings void ${TAG}`,
  });
}

/**
 * Prepare a day: open it and record an opening count of `OPENING` for every
 * item named, so Expected has a base to move away from.
 */
function openDayWithCounts(
  offset: number,
  countedItems: SeededItem[],
): SeededDay {
  const date = businessDate(offset);
  const day = openPackagingDay({
    businessDate: date,
    openedByStaffMemberId: staff.id,
  });
  seedStockCount({
    businessDate: date,
    phase: 'OPEN',
    submittedBy: staff,
    lines: countedItems.map((item) => ({
      inventoryItemId: item.id,
      quantity: OPENING,
    })),
  });
  return day;
}

// ---------------------------------------------------------------------------
// Criteria 1 and 2 — declaring the value in the product editor
// ---------------------------------------------------------------------------

// AC 1: the servings count is a required whole number of 1 or greater, it
// defaults to 1, and it round-trips. This is the one test that drives the
// editor UI; everywhere else the value is seeded, per the task's guidance.
test('the product editor defaults servings to 1, round-trips an edited value, and marks a non-default product in the list', async ({
  page,
}) => {
  await signInAsAdmin(page);

  // An existing product created without the field reads as 1 — the default
  // applies to existing rows, not only to new ones.
  const ordinary = catalog.products.ordinary;
  await page.goto(`/catalog/products/${ordinary.id}/edit`);
  const servings = page.locator('#product-packaging-servings');
  await expect(servings).toHaveValue('1');

  // A new product opens on 1 as well, and says the value is required.
  await page.goto('/catalog/products/new');
  await expect(page.locator('#product-packaging-servings')).toHaveValue('1');
  const label = page.locator('label[for="product-packaging-servings"]');
  await expect(label).toContainText('Drinks handed over per item sold');
  // The help text states the price exclusion ADR 0010 §1 makes binding, so an
  // admin cannot read the field as a promotion-pricing control.
  await expect(
    page.locator('#product-packaging-servings-help'),
  ).toContainText('does not change the product price');

  // Edit the existing product to 2 and save.
  await page.goto(`/catalog/products/${ordinary.id}/edit`);
  await page.locator('#product-packaging-servings').fill('2');
  await page.getByRole('button', { name: 'Save product' }).first().click();
  await expect(page).toHaveURL(/\/catalog\/products$/);

  // It round-trips through the API and back into the editor, and it is what
  // was actually stored — not merely what the form still holds.
  expect(readProductServings(ordinary.id)).toBe(2);
  await page.goto(`/catalog/products/${ordinary.id}/edit`);
  await expect(page.locator('#product-packaging-servings')).toHaveValue('2');

  // The products list marks the non-default value, so a wrong setting is
  // visible rather than silent.
  await page.goto('/catalog/products');
  const row = page.locator('tbody tr', {
    has: page.getByText(ordinary.name, { exact: true }),
  });
  await expect(row.locator('.state-badge.promotion')).toHaveText(
    '2 drinks / sale',
  );

  // Restore the control product for the rest of the suite.
  setProductServings(ordinary.id, 1);
});

// AC 2: blank, zero, negative and fractional are each refused with a clear
// message, and none of them is saved. Enumerating all four matters — this is
// the full set of ways the field can be made to lie.
test('the product editor refuses a blank, zero, negative or fractional servings count and saves nothing', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const promo = catalog.products.promo;
  const before = readProductServings(promo.id);
  expect(before).toBe(2);

  for (const invalid of ['', '0', '-1', '1.5']) {
    await page.goto(`/catalog/products/${promo.id}/edit`);
    const field = page.locator('#product-packaging-servings');
    await field.fill(invalid);
    await page.getByRole('button', { name: 'Save product' }).first().click();

    // The save is refused, not merely warned about: the editor stays put.
    await expect(
      page,
      `servings "${invalid}" should not have saved`,
    ).toHaveURL(new RegExp(`/catalog/products/${promo.id}/edit$`));
    const error = page.locator('#product-packaging-servings-error');
    await expect(error, `no error shown for "${invalid}"`).toHaveText(
      'Enter a whole number of 1 or greater.',
    );
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAttribute(
      'aria-describedby',
      'product-packaging-servings-error',
    );

    // And nothing reached the database.
    expect(readProductServings(promo.id), `"${invalid}" was stored`).toBe(2);
  }
});

// ---------------------------------------------------------------------------
// Criteria 3, 4, 5 and 10 — the packaging arithmetic on the close screen
// ---------------------------------------------------------------------------

// AC 3 + AC 10 (QA case 1): the core case. One 2-serving product sold once
// draws two cups and two lids, not one of each.
test('one completed sale of a 2-serving product draws two cups and two lids', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(1, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  await sell(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 2],
    [items.lid, OPENING - 2],
  ]);

  // The value the arithmetic ran on was captured on the line, not read live.
  const sales = readSales();
  expect(sales).toHaveLength(1);
  expect(sales[0]!.lines[0]!.packagingServingsSnapshot).toBe(2);
});

// AC 4 + AC 5 (QA cases 2 and 3): quantity multiplies the servings, and an
// ordinary product is not doubled. Both run against the same close screen so
// one read proves the change and the non-change together — a doubling applied
// indiscriminately would fail the second half.
test('quantity multiplies a promotional product’s draw while an ordinary product stays one per unit', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(2, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  // 3 × 2 servings = 6, and 3 × 1 serving = 3, against the same cup and lid.
  await sell(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id, quantity: 3 },
  ]);
  await sell(page.request, origin, [
    { variantId: catalog.products.ordinary.variants.regular.id, quantity: 3 },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 9],
    [items.lid, OPENING - 9],
  ]);

  // Pin the split the combined figure is made of, so a compensating pair of
  // errors — the promo under-drawing and the ordinary over-drawing — cannot
  // hide behind a correct total.
  const sales = readSales();
  const snapshots = sales.flatMap((sale) =>
    sale.lines.map((line) => [
      line.productNameSnapshot,
      line.quantity,
      line.packagingServingsSnapshot,
    ]),
  );
  expect(snapshots).toEqual([
    [catalog.products.promo.name, 3, 2],
    [catalog.products.ordinary.name, 3, 1],
  ]);
});

// AC 3's size clause (QA case 4): usage lands only on the items mapped to the
// size that was actually sold. This is the criterion most likely to pass by
// accident — an implementation that ignores the variant mapping still produces
// a plausible-looking total — so the untouched size is asserted explicitly.
test('only the sold size’s mapped cup and lid are drawn; the other size’s items are untouched', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(3, [
    items.cup,
    items.lid,
    items.largeCup,
    items.largeLid,
  ]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  // Two Large of a 2-serving product: 4 large cups, 4 large lids, nothing else.
  await sell(page.request, origin, [
    { variantId: catalog.products.sized.variants.large.id, quantity: 2 },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.largeCup, OPENING - 4],
    [items.largeLid, OPENING - 4],
    // The Regular size of the very same product is mapped to these, and no
    // Regular was sold.
    [items.cup, OPENING],
    [items.lid, OPENING],
  ]);
});

// QA case 7: ADR 0006 §5 draws per role, so one item filling both the cup and
// the lid role on a variant is drawn twice. The new multiplier has to compose
// with that rule rather than quietly replace it.
test('an item mapped as both cup and lid is drawn twice per serving', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(4, [items.dual]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  // 2 units × 2 servings × 2 roles = 8.
  await sell(page.request, origin, [
    { variantId: catalog.products.combo.variants.regular.id, quantity: 2 },
  ]);

  await gotoClose(page);
  await expectExpected(page, [[items.dual, OPENING - 8]]);
});

// QA case 8: a bigger `sold` term is exactly what could resurrect the
// negative-expected defect that ADR 0006 §5's NULL-on-missing-opening-count
// rule replaced. With no opening count, Expected must stay unavailable.
test('with no opening count, a multi-serving draw leaves Expected unavailable rather than negative', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  // bareCup and bareLid are deliberately absent from this count.
  openDayWithCounts(5, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  // 4 units × 3 servings = 12 drawn from two items that have no opening figure.
  await sell(page.request, origin, [
    { variantId: catalog.products.triple.variants.regular.id, quantity: 4 },
  ]);

  await gotoClose(page);
  for (const item of [items.bareCup, items.bareLid]) {
    const expectedText = await expectedFor(page, item);
    expect(expectedText, item.name).toBe('— no opening count');
    expect(expectedText).not.toMatch(/-\d/);
  }
  // The dash is carried in the markup too, not only in the copy.
  await expect(
    packagingRow(page, items.bareCup.name).locator('td.unknown').first(),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// Criteria 8 and 9 — sales that must not count
// ---------------------------------------------------------------------------

// AC 8 (QA case 5): a parked order contributes nothing until it is completed,
// and then contributes its full multiplied draw.
test('a parked 2-serving order draws nothing until it is completed, then draws two', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(6, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  const parked = await parkOrder(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING],
    [items.lid, OPENING],
  ]);

  // Completing the very same order — no new line, no new snapshot — moves it.
  await completeOrder(page.request, origin, parked);
  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 2],
    [items.lid, OPENING - 2],
  ]);
});

// AC 9 (QA case 6): a voided sale contributes nothing. Asserted as an absolute
// figure, because the failure worth catching is a void that adds packaging back
// *past* the baseline — a delta assertion would read that as correct.
test('voiding a completed 2-serving sale returns the expected balance to its baseline exactly', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(7, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  // One sale that stays, so the day is not trivially empty after the void.
  await sell(page.request, origin, [
    { variantId: catalog.products.ordinary.variants.regular.id },
  ]);
  const doomed = await sell(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id, quantity: 2 },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 1 - 4],
    [items.lid, OPENING - 1 - 4],
  ]);

  await voidOrder(page.request, origin, doomed);
  await gotoClose(page);
  await expectExpected(page, [
    // Back to exactly the surviving sale's one cup and one lid — not to
    // OPENING, and not above it.
    [items.cup, OPENING - 1],
    [items.lid, OPENING - 1],
  ]);

  // The void is recorded as a correction rather than an edit, per the
  // append-only convention, so the original line and its snapshot survive.
  const sales = readSales();
  expect(sales.map((sale) => sale.kind)).toEqual([
    'PURCHASE',
    'PURCHASE',
    'VOID',
  ]);
  expect(sales[1]!.lines[0]!.packagingServingsSnapshot).toBe(2);
});

// ---------------------------------------------------------------------------
// Criterion 7 — the servings count is fixed when the line is added
// ---------------------------------------------------------------------------

// AC 7 (QA case 10, added at authoring time — it postdates the nine cases on
// #271). The story's whole point is that packaging reconciliation is quietly
// wrong by a predictable amount; reading the catalog live at close time would
// allow a second quiet wrongness with the same signature, silently rewriting
// every past day's close when a promotion ends.
test('changing a product’s servings later does not move a completed sale’s packaging usage', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(8, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  await sell(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id, quantity: 2 },
  ]);

  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 4],
    [items.lid, OPENING - 4],
  ]);

  try {
    // The promotion ends and the product goes back to one serving.
    setProductServings(catalog.products.promo.id, 1);
    await gotoClose(page);
    await expectExpected(page, [
      [items.cup, OPENING - 4],
      [items.lid, OPENING - 4],
    ]);

    // And it does not follow a change in the other direction either.
    setProductServings(catalog.products.promo.id, 5);
    await gotoClose(page);
    await expectExpected(page, [
      [items.cup, OPENING - 4],
      [items.lid, OPENING - 4],
    ]);
  } finally {
    setProductServings(catalog.products.promo.id, 2);
  }
});

// AC 7's precise wording — usage is fixed from the value recorded "when the
// product is added to the order", not when the sale completes. A parked order
// that straddles a catalog edit therefore keeps the count in force when its
// line was added, which is the case the looser "at completion" reading gets
// wrong.
test('a parked order straddling a catalog edit keeps the servings count in force when its line was added', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(9, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  const parked = await parkOrder(page.request, origin, [
    { variantId: catalog.products.promo.variants.regular.id },
  ]);

  try {
    setProductServings(catalog.products.promo.id, 5);
    await completeOrder(page.request, origin, parked);

    await gotoClose(page);
    await expectExpected(page, [
      // 2 — the value when the line was added — not 5.
      [items.cup, OPENING - 2],
      [items.lid, OPENING - 2],
    ]);
    expect(readSales()[0]!.lines[0]!.packagingServingsSnapshot).toBe(2);
  } finally {
    setProductServings(catalog.products.promo.id, 2);
  }
});

// ---------------------------------------------------------------------------
// Criterion 6 — the servings count is not money
// ---------------------------------------------------------------------------

// AC 6 (QA case 9): ADR 0010 §1 forbids the field from being a term in price,
// discount or tax outright. Cheap to assert, and the failure it catches — a
// customer charged twice for a promotion — is the worst one in the story.
test('a 2-serving product is still sold at one unit price, and does not double any total', async ({
  page,
  baseURL,
}) => {
  const items = catalog.items;
  openDayWithCounts(10, [items.cup, items.lid]);

  await signInAsStaff(page);
  const origin = apiOrigin(baseURL);
  const promo = catalog.products.promo;
  const unitPriceCents = promo.variants.regular.priceCents;

  const order = await sell(page.request, origin, [
    { variantId: promo.variants.regular.id },
  ]);
  // The tender the API accepted equals one unit price — a doubled total would
  // have rejected this payment, and the assertion below pins the amount.
  expect(order.totalCents).toBe(unitPriceCents);

  const sales = readSales();
  expect(sales).toHaveLength(1);
  const sale = sales[0]!;
  const line = sale.lines[0]!;
  expect(line.quantity).toBe(1);
  expect(line.packagingServingsSnapshot).toBe(2);
  expect(line.unitPriceCents).toBe(unitPriceCents);
  expect(line.lineGrossCents).toBe(unitPriceCents);
  expect(line.lineTotalCents).toBe(unitPriceCents);
  expect(sale.subtotalCents).toBe(unitPriceCents);
  expect(sale.totalCents).toBe(unitPriceCents);

  // The packaging draw still happened — this is a price assertion, not a
  // vacuous one about a product that does nothing.
  await gotoClose(page);
  await expectExpected(page, [
    [items.cup, OPENING - 2],
    [items.lid, OPENING - 2],
  ]);
});
