import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  clearPreviousParRuns,
  createParCategory,
  readItemByName,
  readParRow,
  removeParCategory,
} from './fixtures/level-par';
import {
  openBusinessDay,
  resetInventoryOperations,
  seedStaffMembers,
  type SeededStaff,
} from './fixtures/inventory-operations';

/**
 * End-to-end coverage for story #286 — "Par settings use the item's count
 * method" (QA task #292).
 *
 * Everything runs through the real browser → web app → NestJS API → PostgreSQL
 * path. Nothing is mocked and no `par_levels` row is hand-written: every par
 * setting asserted here was entered in the admin item editor and saved through
 * `PUT /inventory/items/:id/par-levels/:dayType`, because the whole story is
 * about that round-trip.
 *
 * Scope boundary, taken from the clarification resolved on #286 (candidate 1):
 * a saved level target is deliberately **inert everywhere except the item
 * editor**. So the observable outcome of saving one is that it comes back on
 * reload and *nothing else in the product changes*. The last describe block
 * asserts the second half against Restock status, which keeps #108's fixed
 * level-to-status mapping and a `—` Par. There is deliberately no assertion
 * that a level target influences Restock — that would encode a future story as
 * a present requirement and would fail correct code.
 *
 * Screens under test:
 *   /inventory                        stock item list (admin)
 *   /inventory/items/new              item editor, create
 *   /inventory/items/:id/edit         item editor, edit
 *   /pos/closing, /pos/restock        staff screens, for the non-effect guard
 *
 * The suite is serial and every item it creates carries a per-run tag, so it is
 * safe to re-run against the persistent dev database; `afterAll` removes the
 * run's category and everything in it.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa286-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The eight level choices, in the order the editor must offer them. */
const LEVEL_CHOICES = [
  'Empty',
  'Low',
  'Quarter',
  'One-third',
  'Half',
  'Two-thirds',
  'Three-quarters',
  'Full',
] as const;

type LevelChoice = (typeof LEVEL_CHOICES)[number];
type DayLabel = 'Normal day' | 'Peak day';

/** `StockLevel` enum value behind each visible choice. */
const LEVEL_ENUM: Record<LevelChoice, string> = {
  Empty: 'EMPTY',
  Low: 'LOW',
  Quarter: 'QUARTER',
  'One-third': 'ONE_THIRD',
  Half: 'HALF',
  'Two-thirds': 'TWO_THIRDS',
  'Three-quarters': 'THREE_QUARTERS',
  Full: 'FULL',
};

let category: { id: string; name: string };
let seq = 0;

function unique(base: string): string {
  seq += 1;
  return `QA ${base} ${TAG}-${seq}`;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  clearPreviousParRuns();
  category = createParCategory(TAG);
});

test.afterAll(() => {
  removeParCategory(category.id);
});

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

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
  // The form autofocuses its first field inside a requestAnimationFrame; filling
  // before that lands re-routes the password into the username box.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

/** Sign in for real in a throwaway context and keep only the cookie jar. */
async function captureAdminState(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsAdmin(page);
  const state = await context.storageState();
  await context.close();
  return state;
}

// ---------------------------------------------------------------------------
// Item editor helpers
// ---------------------------------------------------------------------------

/** The Normal-day or Peak-day par fieldset, whichever controls it renders. */
function dayGroup(page: Page, day: DayLabel): Locator {
  return page.getByRole('group', { name: day });
}

function countMethodGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Count method' });
}

async function chooseCountMethod(
  page: Page,
  method: 'Quantity' | 'Level',
): Promise<void> {
  const radio = countMethodGroup(page).getByRole('radio', {
    name: new RegExp(`^${method}\\b`),
  });
  await radio.check();
  await expect(radio).toBeChecked();
}

function levelRadio(page: Page, day: DayLabel, choice: LevelChoice): Locator {
  return dayGroup(page, day).getByRole('radio', { name: choice, exact: true });
}

/**
 * Choose a level target. The radio input sits underneath its label in the
 * touch-target layout, so the label is what a user actually taps — clicking the
 * input itself is intercepted by the label.
 */
async function chooseLevel(
  page: Page,
  day: DayLabel,
  choice: LevelChoice,
): Promise<void> {
  const prefix = day === 'Normal day' ? 'normal' : 'peak';
  const id = `${prefix}-level-${LEVEL_ENUM[choice].toLowerCase()}`;
  await dayGroup(page, day).locator(`label[for="${id}"]`).click();
  await expect(levelRadio(page, day, choice)).toBeChecked();
}

/** Assert exactly `choice` is selected for `day` and nothing else is. */
async function expectLevelSelection(
  page: Page,
  day: DayLabel,
  choice: LevelChoice | null,
): Promise<void> {
  for (const candidate of LEVEL_CHOICES) {
    const radio = levelRadio(page, day, candidate);
    if (candidate === choice) {
      await expect(radio).toBeChecked();
    } else {
      await expect(radio).not.toBeChecked();
    }
  }
}

/** The three quantity inputs of one day type, by their stable ids. */
function quantityFields(page: Page, day: DayLabel) {
  const prefix = day === 'Normal day' ? 'normal' : 'peak';
  return {
    par: page.locator(`#${prefix}-par`),
    low: page.locator(`#${prefix}-low`),
    urgent: page.locator(`#${prefix}-urgent`),
  };
}

/** Level mode must offer the eight choices and none of the quantity inputs. */
async function expectLevelControls(page: Page, day: DayLabel): Promise<void> {
  const group = dayGroup(page, day);
  await expect(group.getByRole('radio')).toHaveCount(LEVEL_CHOICES.length);
  await expect(
    group.locator('.level-radio-option label'),
  ).toHaveText([...LEVEL_CHOICES]);
  const fields = quantityFields(page, day);
  await expect(fields.par).toHaveCount(0);
  await expect(fields.low).toHaveCount(0);
  await expect(fields.urgent).toHaveCount(0);
}

/** Quantity mode must offer par/Low/Urgent and no level choices. */
async function expectQuantityControls(page: Page, day: DayLabel): Promise<void> {
  const fields = quantityFields(page, day);
  await expect(fields.par).toBeVisible();
  await expect(fields.low).toBeVisible();
  await expect(fields.urgent).toBeVisible();
  await expect(dayGroup(page, day).getByRole('radio')).toHaveCount(0);
}

interface QuantityPar {
  par: string;
  low?: string;
  urgent?: string;
}

async function fillQuantityPar(
  page: Page,
  day: DayLabel,
  values: QuantityPar,
): Promise<void> {
  const fields = quantityFields(page, day);
  await fields.par.fill(values.par);
  if (values.low !== undefined) await fields.low.fill(values.low);
  if (values.urgent !== undefined) await fields.urgent.fill(values.urgent);
}

function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Save stock item' });
}

function itemRow(page: Page, name: string): Locator {
  return page.locator('.inventory-items-table tbody tr', {
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/**
 * Open the item list filtered down to one item. The dev database persists
 * between runs and carries every item earlier runs and other suites created, so
 * the search box — not "it will be somewhere on the page" — is what makes the
 * row locator reliable.
 */
async function findItemInList(page: Page, name: string): Promise<Locator> {
  await page.goto('/inventory');
  await page.locator('#inventory-search').fill(name);
  const row = itemRow(page, name);
  await expect(row).toBeVisible();
  return row;
}

/** Fill the identity fields every item needs, on an open editor. */
async function fillIdentity(page: Page, name: string): Promise<void> {
  await page
    .locator('#inventory-item-category')
    .selectOption({ label: category.name });
  await page.locator('#inventory-item-name').fill(name);
  await page.locator('#inventory-item-unit').fill('pcs');
}

/**
 * Create a level-counted item with both day targets set, through the editor.
 * Returns the created item's id, read back from the database.
 */
async function createLevelItem(
  page: Page,
  name: string,
  normal: LevelChoice,
  peak: LevelChoice,
): Promise<string> {
  await page.goto('/inventory/items/new');
  await fillIdentity(page, name);
  await chooseCountMethod(page, 'Level');
  await chooseLevel(page, 'Normal day', normal);
  await chooseLevel(page, 'Peak day', peak);
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await findItemInList(page, name);
  const record = readItemByName(name);
  expect(record).not.toBeNull();
  return record!.id;
}

/** Reopen an item's editor the way an administrator does — from the list. */
async function reopenFromList(page: Page, name: string): Promise<void> {
  const row = await findItemInList(page, name);
  await row.getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/inventory\/items\/.+\/edit$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
}

// ===========================================================================
// Level par entry, independence and persistence
// ===========================================================================

test.describe('level par entry and persistence (#286)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // AC 1: a level-counted item is given level-based par settings for both day
  // types, and the quantity-domain inputs are not shown at all.
  test('a level-counted item offers the eight level choices for both day types and no quantity inputs', async ({
    page,
  }) => {
    await page.goto('/inventory/items/new');
    await fillIdentity(page, unique('Level Controls'));

    // Quantity is the default, so the quantity controls are the starting point.
    await expectQuantityControls(page, 'Normal day');
    await expectQuantityControls(page, 'Peak day');

    await chooseCountMethod(page, 'Level');

    await expectLevelControls(page, 'Normal day');
    await expectLevelControls(page, 'Peak day');
    // A brand-new level item starts with neither day type selected — no value
    // is defaulted in for the administrator.
    await expectLevelSelection(page, 'Normal day', null);
    await expectLevelSelection(page, 'Peak day', null);
  });

  // AC 2: the two day types are set independently — changing one leaves the
  // other alone. Deliberately two *different* levels: a spec that set both to
  // the same value would pass even if the two controls shared one piece of
  // state.
  test('Normal-day and Peak-day level targets are set independently', async ({
    page,
  }) => {
    const name = unique('Level Independence');
    await page.goto('/inventory/items/new');
    await fillIdentity(page, name);
    await chooseCountMethod(page, 'Level');

    await chooseLevel(page, 'Normal day', 'Quarter');
    await expectLevelSelection(page, 'Peak day', null);

    await chooseLevel(page, 'Peak day', 'Full');
    await expectLevelSelection(page, 'Normal day', 'Quarter');

    // Changing Normal again must not disturb the already-set Peak.
    await chooseLevel(page, 'Normal day', 'Two-thirds');
    await expectLevelSelection(page, 'Peak day', 'Full');

    await saveButton(page).click();
    await expect(page).toHaveURL(/\/inventory$/);

    // The two day types are two rows, each carrying its own level and no
    // quantity — asserted in the database so a shared-state bug that renders
    // correctly cannot hide behind the editor.
    expect(readParRow(name, 'NORMAL')).toEqual({
      dayType: 'NORMAL',
      parQty: null,
      parLevel: 'TWO_THIRDS',
      lowThreshold: null,
      urgentThreshold: null,
    });
    expect(readParRow(name, 'PEAK')).toEqual({
      dayType: 'PEAK',
      parQty: null,
      parLevel: 'FULL',
      lowThreshold: null,
      urgentThreshold: null,
    });
  });

  // AC 3, client-side half: reopening the editor from the list shows both saved
  // level targets.
  test('saved level targets are shown again when the editor is reopened from the list', async ({
    page,
  }) => {
    const name = unique('Level Reopen');
    await createLevelItem(page, name, 'Low', 'Three-quarters');

    await reopenFromList(page, name);

    await expectLevelControls(page, 'Normal day');
    await expectLevelControls(page, 'Peak day');
    await expectLevelSelection(page, 'Normal day', 'Low');
    await expectLevelSelection(page, 'Peak day', 'Three-quarters');
  });

  // AC 3, cold half: a *cold* entry straight onto the deep edit route in a new
  // browser context. This is the path that genuinely exercises the API
  // round-trip — reopening from the list can be satisfied by surviving client
  // state, a cold `goto` cannot.
  test('saved level targets survive a cold deep entry onto the edit route and a reload', async ({
    page,
    browser,
  }) => {
    const name = unique('Level Cold Entry');
    const itemId = await createLevelItem(page, name, 'Empty', 'Half');

    const state = await captureAdminState(browser);
    const cold: BrowserContext = await browser.newContext({ storageState: state });
    try {
      const coldPage = await cold.newPage();
      // First request this context ever makes is the deep route itself.
      await coldPage.goto(`/inventory/items/${itemId}/edit`);
      await expect(coldPage.getByRole('heading', { level: 1 })).toContainText(name);

      await expectLevelControls(coldPage, 'Normal day');
      await expectLevelSelection(coldPage, 'Normal day', 'Empty');
      await expectLevelSelection(coldPage, 'Peak day', 'Half');

      // And again after a hard reload of the same deep route.
      await coldPage.reload();
      await expect(coldPage.getByRole('heading', { level: 1 })).toContainText(name);
      await expectLevelSelection(coldPage, 'Normal day', 'Empty');
      await expectLevelSelection(coldPage, 'Peak day', 'Half');
    } finally {
      await cold.close();
    }
  });

  // AC 4 regression guard: the quantity path is untouched — same fields, same
  // validation, same round-trip.
  test('a quantity-counted item still enters, validates and persists both day pars as quantities', async ({
    page,
  }) => {
    const name = unique('Quantity Regression');
    await page.goto('/inventory/items/new');
    await fillIdentity(page, name);
    await expectQuantityControls(page, 'Normal day');
    await expectQuantityControls(page, 'Peak day');

    await fillQuantityPar(page, 'Normal day', { par: '20', low: '8', urgent: '3' });
    await fillQuantityPar(page, 'Peak day', { par: '40', low: '15', urgent: '5' });

    // #55's quantity rules still bite: Low above Par is rejected in place.
    await fillQuantityPar(page, 'Peak day', { par: '40', low: '99' });
    await saveButton(page).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(
      dayGroup(page, 'Peak day').getByText(/Low must be less than or equal to Par/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    expect(readItemByName(name)).toBeNull();

    await fillQuantityPar(page, 'Peak day', { par: '40', low: '15', urgent: '5' });
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/inventory$/);

    expect(readParRow(name, 'NORMAL')).toEqual({
      dayType: 'NORMAL',
      parQty: 20,
      parLevel: null,
      lowThreshold: 8,
      urgentThreshold: 3,
    });
    expect(readParRow(name, 'PEAK')).toEqual({
      dayType: 'PEAK',
      parQty: 40,
      parLevel: null,
      lowThreshold: 15,
      urgentThreshold: 5,
    });

    // Reopened, the item is still quantity-based with its saved numbers.
    await reopenFromList(page, name);
    await expectQuantityControls(page, 'Normal day');
    await expect(quantityFields(page, 'Normal day').par).toHaveValue('20');
    await expect(quantityFields(page, 'Normal day').low).toHaveValue('8');
    await expect(quantityFields(page, 'Normal day').urgent).toHaveValue('3');
    await expect(quantityFields(page, 'Peak day').par).toHaveValue('40');
    await expect(quantityFields(page, 'Peak day').low).toHaveValue('15');
    await expect(quantityFields(page, 'Peak day').urgent).toHaveValue('5');
  });
});

// ===========================================================================
// The count-method switch — a pre-save, in-page state change
// ===========================================================================

test.describe('count-method switch before saving (#286)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // AC 5, Quantity → Level. The par controls must re-present immediately, with
  // nothing converted or defaulted, *without* saving and *without* reloading —
  // and leaving the page must persist nothing.
  test('Quantity to Level re-presents the par controls in place, converts nothing, and persists nothing', async ({
    page,
  }) => {
    const name = unique('Switch To Level');
    await page.goto('/inventory/items/new');
    await fillIdentity(page, name);
    await fillQuantityPar(page, 'Normal day', { par: '12', low: '6', urgent: '2' });
    await fillQuantityPar(page, 'Peak day', { par: '30', low: '10', urgent: '4' });
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/inventory$/);

    await reopenFromList(page, name);
    await expectQuantityControls(page, 'Normal day');

    // The switch itself. No save, no reload.
    await chooseCountMethod(page, 'Level');
    await expectLevelControls(page, 'Normal day');
    await expectLevelControls(page, 'Peak day');
    // Nothing derived from 12 or 30 — both day types start unset.
    await expectLevelSelection(page, 'Normal day', null);
    await expectLevelSelection(page, 'Peak day', null);

    // Switching back before saving restores the original quantity entries.
    await chooseCountMethod(page, 'Quantity');
    await expect(quantityFields(page, 'Normal day').par).toHaveValue('12');
    await expect(quantityFields(page, 'Normal day').low).toHaveValue('6');
    await expect(quantityFields(page, 'Normal day').urgent).toHaveValue('2');
    await expect(quantityFields(page, 'Peak day').par).toHaveValue('30');

    // Switch away again, then leave without saving: nothing was written.
    await chooseCountMethod(page, 'Level');
    await chooseLevel(page, 'Normal day', 'Half');
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    const saved = readItemByName(name);
    expect(saved?.countMethod).toBe('QUANTITY');
    expect(readParRow(name, 'NORMAL')).toEqual({
      dayType: 'NORMAL',
      parQty: 12,
      parLevel: null,
      lowThreshold: 6,
      urgentThreshold: 2,
    });
    expect(readParRow(name, 'PEAK')?.parLevel).toBeNull();
  });

  // AC 5, Level → Quantity. The direction the story is *not* motivated by, and
  // therefore the one a regression is likeliest to hide in.
  test('Level to Quantity re-presents the par controls in place, converts nothing, and persists nothing', async ({
    page,
  }) => {
    const name = unique('Switch To Quantity');
    await createLevelItem(page, name, 'Three-quarters', 'Full');

    await reopenFromList(page, name);
    await expectLevelControls(page, 'Normal day');

    await chooseCountMethod(page, 'Quantity');
    await expectQuantityControls(page, 'Normal day');
    await expectQuantityControls(page, 'Peak day');
    // No quantity was invented from "Three-quarters" or "Full".
    await expect(quantityFields(page, 'Normal day').par).toHaveValue('');
    await expect(quantityFields(page, 'Normal day').low).toHaveValue('');
    await expect(quantityFields(page, 'Normal day').urgent).toHaveValue('');
    await expect(quantityFields(page, 'Peak day').par).toHaveValue('');

    // Switching back before saving restores the saved level targets.
    await chooseCountMethod(page, 'Level');
    await expectLevelSelection(page, 'Normal day', 'Three-quarters');
    await expectLevelSelection(page, 'Peak day', 'Full');

    // Leave without saving.
    await chooseCountMethod(page, 'Quantity');
    await fillQuantityPar(page, 'Normal day', { par: '7' });
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    const saved = readItemByName(name);
    expect(saved?.countMethod).toBe('LEVEL');
    expect(readParRow(name, 'NORMAL')).toEqual({
      dayType: 'NORMAL',
      parQty: null,
      parLevel: 'THREE_QUARTERS',
      lowThreshold: null,
      urgentThreshold: null,
    });
    expect(readParRow(name, 'PEAK')?.parLevel).toBe('FULL');
  });
});

// ===========================================================================
// Invalid par settings
// ===========================================================================

test.describe('invalid level par settings (#286)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // AC 6, first half: a level target is required for both day types, and the
  // explanation names the day type that must be corrected.
  test('saving is blocked with a visible explanation when a day type has no level target', async ({
    page,
  }) => {
    const name = unique('Level Unset');
    await page.goto('/inventory/items/new');
    await fillIdentity(page, name);
    await chooseCountMethod(page, 'Level');
    await chooseLevel(page, 'Normal day', 'Half');
    // Peak deliberately left unset.

    await saveButton(page).click();

    // Still on the editor, with an explanation that names Peak day.
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    await expect(
      dayGroup(page, 'Peak day').getByRole('alert'),
    ).toHaveText(/Choose a level for Peak day/i);
    await expect(dayGroup(page, 'Normal day').getByRole('alert')).toHaveCount(0);
    // Nothing was created.
    expect(readItemByName(name)).toBeNull();

    // Correcting the named day type is enough to save.
    await chooseLevel(page, 'Peak day', 'Full');
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/inventory$/);
    expect(readParRow(name, 'PEAK')?.parLevel).toBe('FULL');
  });

  // AC 6, second half: the previously saved settings survive a rejected save.
  // Asserting only that the message appears would miss this entirely.
  test('a rejected save leaves the previously saved level targets unchanged', async ({
    page,
  }) => {
    const name = unique('Level Rejected Save');
    await createLevelItem(page, name, 'Quarter', 'Two-thirds');

    await reopenFromList(page, name);
    // Switch to Quantity and leave the par blank — the reachable invalid state
    // for an already-saved item.
    await chooseCountMethod(page, 'Quantity');
    await quantityFields(page, 'Normal day').par.fill('');
    await quantityFields(page, 'Peak day').par.fill('');
    await saveButton(page).click();

    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(
      dayGroup(page, 'Normal day').getByText(/Normal day par must be a non-negative whole number/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/items\/.+\/edit$/);

    // The saved item is untouched: still LEVEL, still Quarter and Two-thirds.
    const saved = readItemByName(name);
    expect(saved?.countMethod).toBe('LEVEL');
    expect(readParRow(name, 'NORMAL')?.parLevel).toBe(LEVEL_ENUM.Quarter);
    expect(readParRow(name, 'PEAK')?.parLevel).toBe(LEVEL_ENUM['Two-thirds']);

    // And a fresh reopen shows exactly what was saved before the rejection.
    await reopenFromList(page, name);
    await expectLevelControls(page, 'Normal day');
    await expectLevelSelection(page, 'Normal day', 'Quarter');
    await expectLevelSelection(page, 'Peak day', 'Two-thirds');
  });
});

// ===========================================================================
// Restock status is not affected — the guard this story is most exposed to
// ===========================================================================

test.describe('Restock status is unchanged by saved level targets (#286 / #108)', () => {
  let staff: Record<string, SeededStaff>;

  test.beforeAll(() => {
    staff = seedStaffMembers({
      ada: { displayName: `QA Par Ada ${TAG}`, isActive: true },
    });
  });

  test.beforeEach(() => {
    resetInventoryOperations();
    openBusinessDay(staff.ada.id, 'NORMAL');
  });

  test.afterAll(() => {
    // Leave the environment the way the rest of the suite expects to find it:
    // an open day and no counts.
    resetInventoryOperations();
    openBusinessDay(staff.ada.id, 'NORMAL');
  });

  /**
   * A level-counted item counted at One-third maps to `Low` under #108's fixed
   * table, whatever its saved level targets are. The two targets used here
   * bracket the counted level from both sides — `Full` for Normal (a leak would
   * push the row *below* par) and `Empty` (a leak would push it to `Enough`) —
   * so a Restock implementation that started reading them could not land on
   * `Low` by luck in both halves of the test.
   */
  test('a level item with saved level targets still shows "—" for Par and the fixed level-derived status', async ({
    page,
    browser,
  }) => {
    const name = unique('Level Restock Guard');
    await signInAsAdmin(page);
    const itemId = await createLevelItem(page, name, 'Full', 'Empty');

    const staffContext = await browser.newContext();
    try {
      const staffPage = await staffContext.newPage();
      await signInAsStaff(staffPage);

      // Submit a closing count recording One-third for this item only.
      await staffPage.goto('/pos/closing');
      await expect(staffPage.locator('.staff-inventory-screen')).toBeVisible();
      await staffPage
        .getByLabel('Submitted by')
        .selectOption({ label: staff.ada.displayName });
      const countRow = staffPage.locator('.staff-count-row').filter({ hasText: name });
      await countRow.getByText('One-third', { exact: true }).click();
      await expect(countRow.getByLabel('One-third', { exact: true })).toBeChecked();
      await staffPage.getByRole('button', { name: 'Submit closing count' }).click();
      await expect(staffPage.getByText('Count submitted')).toBeVisible();

      const restockRow = async () => {
        await staffPage.goto('/pos/restock');
        await expect(staffPage.locator('.staff-inventory-screen')).toBeVisible();
        const rows = staffPage.locator('.staff-inventory-table-wrap table tbody tr');
        // Only this item was counted, so the whole table is its one row.
        await expect(rows).toHaveCount(1);
        return rows.first();
      };

      // Saved targets: Normal = Full, Peak = Empty. Neither appears, and the
      // status is the fixed One-third → Low mapping.
      let row = await restockRow();
      await expect(row.locator('td').nth(1)).toContainText('One-third');
      await expect(row.locator('td').nth(2)).toHaveText('—');
      await expect(row.locator('td').nth(3)).toHaveText('Low');

      // Flip the Normal-day target to the opposite end of the scale. If Restock
      // read it, the row would have to move; it must not.
      await page.goto(`/inventory/items/${itemId}/edit`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await chooseLevel(page, 'Normal day', 'Empty');
      await chooseLevel(page, 'Peak day', 'Full');
      await saveButton(page).click();
      await expect(page).toHaveURL(/\/inventory$/);
      expect(readParRow(name, 'NORMAL')?.parLevel).toBe('EMPTY');
      expect(readParRow(name, 'PEAK')?.parLevel).toBe('FULL');

      row = await restockRow();
      await expect(row.locator('td').nth(1)).toContainText('One-third');
      await expect(row.locator('td').nth(2)).toHaveText('—');
      await expect(row.locator('td').nth(3)).toHaveText('Low');
    } finally {
      await staffContext.close();
    }
  });
});
