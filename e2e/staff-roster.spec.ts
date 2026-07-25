import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * End-to-end coverage for story #67 — "Manage the staff roster used for cashier
 * attribution" (QA Task #73).
 *
 * Every acceptance criterion on #67 is exercised through the real
 * browser → web app → NestJS API → PostgreSQL path. The fixture is the seeded
 * `admin` (ADMIN) user from apps/api/prisma/seed.ts; `/staff` is admin-guarded
 * (`@Roles(ADMIN)`, ADR 0003).
 *
 * The dev database persists between runs and — by design — the roster has no
 * delete surface (retention is deactivate-not-delete, ADR 0003), so rows created
 * by earlier runs can never be cleaned up. Every test therefore tags its own
 * records with a per-test unique suffix and scopes all list assertions to that
 * tag via the search box. That keeps ordering/filtering assertions exact without
 * assuming anything about the rest of the roster.
 *
 * Rows are seeded through the authenticated browser request context (the same
 * cookie the app uses) rather than by clicking through the add modal repeatedly;
 * the add modal itself is covered directly by its own tests.
 *
 * One exception to the no-stubbing rule is called out at its test: the
 * empty-roster state (AC 13) is unreachable end-to-end once any staff member
 * exists, precisely because the story forbids deletion, so that single state is
 * driven by fulfilling the list request with an empty array.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// Must match the origin the web app itself calls, because the session cookie is
// host-scoped: the request-context calls below only carry it when they hit the
// same host. Vite reads env files from apps/web, so the repo-root VITE_API_URL is
// not picked up and the app falls back to localhost:3000 (apps/web/src/staff/api.ts).
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const NAME_REQUIRED_MESSAGE =
  'Name is required. Enter at least one visible character.';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-test tag that is also a unique, searchable substring. */
function newTag(): string {
  seq += 1;
  return `qa73-${RUN}-${seq}`;
}

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function gotoStaff(page: Page): Promise<void> {
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
  await expect(page.locator('.staff-table')).toBeVisible();
}

/** Create a staff member directly through the admin API (test setup only). */
async function seedStaff(
  page: Page,
  displayName: string,
  isActive = true,
): Promise<StaffMemberPayload> {
  const response = await page.request.post(`${API_BASE_URL}/staff`, {
    data: { displayName, isActive },
  });
  expect(
    response.ok(),
    `seeding "${displayName}" failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as StaffMemberPayload;
}

async function fetchStaffByTag(
  page: Page,
  tag: string,
): Promise<StaffMemberPayload[]> {
  const response = await page.request.get(
    `${API_BASE_URL}/staff?search=${encodeURIComponent(tag)}`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as StaffMemberPayload[];
}

// ---- page object helpers ----------------------------------------------------

function searchBox(page: Page): Locator {
  return page.locator('#staff-search');
}

function statusFilter(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Status', exact: true });
}

function sortBy(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Sort by', exact: true });
}

function directionToggle(page: Page): Locator {
  return page.getByRole('button', { name: /^Sort direction:/ });
}

function rows(page: Page): Locator {
  // Loading skeletons and the empty/no-results state each render a <tr> of their
  // own, so a staff row is identified by having a Name data cell.
  return page.locator('.staff-table tbody tr:has(td[data-label="Name"])');
}

function nameCells(page: Page): Locator {
  return page.locator('.staff-table tbody td[data-label="Name"]');
}

function row(page: Page, name: string): Locator {
  return page
    .locator('.staff-table tbody tr')
    .filter({ has: page.locator('td[data-label="Name"]', { hasText: name }) });
}

function addStaffButton(page: Page): Locator {
  return page.locator('.catalog-page-head').getByRole('button', { name: 'Add staff' });
}

function modal(page: Page): Locator {
  return page.getByRole('dialog');
}

/** Narrow the visible roster to a single test's rows and wait for the result. */
async function scopeTo(page: Page, tag: string, expectedCount: number): Promise<void> {
  await searchBox(page).fill(tag);
  await expect(rows(page)).toHaveCount(expectedCount);
}

async function visibleNames(page: Page): Promise<string[]> {
  return (await nameCells(page).allTextContents()).map((text) => text.trim());
}

async function statusOf(page: Page, name: string): Promise<string> {
  return (await row(page, name).locator('.state-badge').textContent())?.trim() ?? '';
}

test.describe('Staff roster management (story #67)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // AC 1 — list shows exactly Name and Is active.
  test('the roster lists exactly the Name and Is active columns', async ({ page }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Ada ${tag}`, true);
    await seedStaff(page, `Bram ${tag}`, false);
    await page.reload();
    await scopeTo(page, tag, 2);

    const headers = page.locator('.staff-table thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toHaveText('Name');
    await expect(headers.nth(1)).toHaveText('Is active');
    // Third header is the row-action column, exposed to screen readers only —
    // it carries no staff data, so Name + Is active are the only data columns.
    await expect(headers.nth(2).locator('.sr-only')).toHaveText('Actions');

    const dataLabels = await page
      .locator('.staff-table tbody tr')
      .first()
      .locator('td')
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-label')));
    expect(dataLabels).toEqual(['Name', 'Is active', 'Actions']);

    expect(await statusOf(page, `Ada ${tag}`)).toBe('Active');
    expect(await statusOf(page, `Bram ${tag}`)).toBe('Inactive');
  });

  // AC 2 — case-insensitive substring search; clearing restores the roster.
  test('search narrows the roster by case-insensitive substring and clears back', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Marisol ${tag}`);
    await seedStaff(page, `Tomas ${tag}`);
    await page.reload();

    await scopeTo(page, tag, 2);
    const rosterWithTag = await visibleNames(page);
    expect(rosterWithTag).toContain(`Marisol ${tag}`);

    // Substring, and case-insensitive.
    await searchBox(page).fill(`marisol ${tag}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(nameCells(page)).toHaveText([`Marisol ${tag}`]);

    await searchBox(page).fill(`RISOL ${tag}`);
    await expect(nameCells(page)).toHaveText([`Marisol ${tag}`]);

    // Clearing the search shows everything the filter permits — at minimum both
    // tagged rows come back.
    await searchBox(page).fill('');
    await expect(row(page, `Marisol ${tag}`)).toBeVisible();
    await expect(row(page, `Tomas ${tag}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear search and filter' })).toHaveCount(0);
  });

  // AC 3 — All / Active / Inactive filter, All on first load.
  test('status filter defaults to All and narrows to Active or Inactive', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Active One ${tag}`, true);
    await seedStaff(page, `Inactive One ${tag}`, false);
    await page.reload();

    await expect(statusFilter(page)).toHaveValue('all');
    await scopeTo(page, tag, 2);

    await statusFilter(page).selectOption('true');
    await expect(nameCells(page)).toHaveText([`Active One ${tag}`]);

    await statusFilter(page).selectOption('false');
    await expect(nameCells(page)).toHaveText([`Inactive One ${tag}`]);

    await statusFilter(page).selectOption('all');
    await expect(rows(page)).toHaveCount(2);
  });

  // AC 4 — sort by Name and by Is active, both directions; Name asc by default.
  test('sorting by name and by active status honours both directions', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Ana ${tag}`, false);
    await seedStaff(page, `Bea ${tag}`, true);
    await seedStaff(page, `Caro ${tag}`, false);
    await page.reload();

    // Defaults on first load: sort by Name, ascending.
    await expect(sortBy(page)).toHaveValue('name');
    await expect(directionToggle(page)).toHaveText(/Ascending/);

    await scopeTo(page, tag, 3);
    expect(await visibleNames(page)).toEqual([`Ana ${tag}`, `Bea ${tag}`, `Caro ${tag}`]);

    await directionToggle(page).click();
    await expect(directionToggle(page)).toHaveText(/Descending/);
    await expect(nameCells(page)).toHaveText([`Caro ${tag}`, `Bea ${tag}`, `Ana ${tag}`]);

    // Is active ascending → inactive before active.
    await sortBy(page).selectOption('active');
    await directionToggle(page).click();
    await expect(directionToggle(page)).toHaveText(/Ascending/);
    await expect(nameCells(page)).toHaveText([
      `Ana ${tag}`,
      `Caro ${tag}`,
      `Bea ${tag}`,
    ]);

    // Descending reverses that: active first.
    await directionToggle(page).click();
    await expect(nameCells(page)).toHaveText([
      `Bea ${tag}`,
      `Ana ${tag}`,
      `Caro ${tag}`,
    ]);
  });

  // AC 5 — search + filter + sort applied together.
  test('search, status filter and sort apply together', async ({ page }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Zoe Barista ${tag}`, true);
    await seedStaff(page, `Alma Barista ${tag}`, true);
    await seedStaff(page, `Nils Barista ${tag}`, false);
    await seedStaff(page, `Omar Roaster ${tag}`, true);
    await page.reload();

    await searchBox(page).fill(`Barista ${tag}`);
    await statusFilter(page).selectOption('true');
    await sortBy(page).selectOption('name');
    await directionToggle(page).click(); // → descending

    // Barista + active + name descending: Roaster excluded by search, Nils by
    // the filter, and the two survivors are reverse-alphabetical.
    await expect(nameCells(page)).toHaveText([
      `Zoe Barista ${tag}`,
      `Alma Barista ${tag}`,
    ]);
    await expect(page.locator('.results-meta')).toContainText('2 staff members shown');
  });

  // AC 6 — add modal: required name, active choice, active by default, trimming,
  // duplicates allowed, saved staff appears in the list.
  test('adding a staff member saves a trimmed name, active by default', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);

    await addStaffButton(page).click();
    await expect(modal(page).getByRole('heading', { name: 'Add staff' })).toBeVisible();
    // Active by default.
    await expect(page.locator('#staff-active-state')).toHaveValue('true');

    await page.locator('#staff-display-name').fill(`   Priya ${tag}   `);
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toHaveCount(0);

    await scopeTo(page, tag, 1);
    // Leading/trailing whitespace removed from the saved name.
    await expect(nameCells(page)).toHaveText([`Priya ${tag}`]);
    expect(await statusOf(page, `Priya ${tag}`)).toBe('Active');
    const [saved] = await fetchStaffByTag(page, tag);
    expect(saved.displayName).toBe(`Priya ${tag}`);
    expect(saved.isActive).toBe(true);

    // The active choice is available at add time.
    await addStaffButton(page).click();
    await page.locator('#staff-display-name').fill(`Quentin ${tag}`);
    await page.locator('#staff-active-state').selectOption('false');
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    expect(await statusOf(page, `Quentin ${tag}`)).toBe('Inactive');

    // Duplicate names are allowed.
    await addStaffButton(page).click();
    await page.locator('#staff-display-name').fill(`Priya ${tag}`);
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);
    await expect(row(page, `Priya ${tag}`)).toHaveCount(2);
  });

  // AC 7 + edge case — empty and whitespace-only names rejected on add.
  test('adding rejects an empty or whitespace-only name with a clear message', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Keeper ${tag}`);
    await page.reload();
    await scopeTo(page, tag, 1);

    await addStaffButton(page).click();
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    // Modal stays open with a specific correction message.
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#staff-name-error')).toHaveText(NAME_REQUIRED_MESSAGE);
    await expect(page.locator('#staff-display-name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // Whitespace-only is rejected the same way.
    await page.locator('#staff-display-name').fill('     ');
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#staff-name-error')).toHaveText(NAME_REQUIRED_MESSAGE);

    // Correcting it clears the error and saves.
    await page.locator('#staff-display-name').fill(`Rosa ${tag}`);
    await expect(page.locator('#staff-name-error')).toHaveCount(0);
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    // Nothing blank was created.
    const saved = await fetchStaffByTag(page, tag);
    expect(saved.map((member) => member.displayName).sort()).toEqual([
      `Keeper ${tag}`,
      `Rosa ${tag}`,
    ]);
  });

  // AC 8 + edge case — edit modal changes name and/or status, same name rules.
  test('editing changes the name and status, and applies the same name rules', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Original ${tag}`, true);
    await page.reload();
    await scopeTo(page, tag, 1);

    await page.getByRole('button', { name: `Edit Original ${tag}` }).click();
    await expect(modal(page).getByRole('heading', { name: 'Edit staff' })).toBeVisible();
    await expect(page.locator('#staff-display-name')).toHaveValue(`Original ${tag}`);

    // Whitespace-only rejected on edit too.
    await page.locator('#staff-display-name').fill('   ');
    await modal(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#staff-name-error')).toHaveText(NAME_REQUIRED_MESSAGE);

    // Change name and status together; the name is trimmed.
    await page.locator('#staff-display-name').fill(`  Renamed ${tag}  `);
    await page.locator('#staff-active-state').selectOption('false');
    await modal(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(modal(page)).toHaveCount(0);

    await expect(rows(page)).toHaveCount(1);
    await expect(nameCells(page)).toHaveText([`Renamed ${tag}`]);
    expect(await statusOf(page, `Renamed ${tag}`)).toBe('Inactive');
  });

  // AC 9 — inline activate/deactivate straight from the row.
  test('a row activates and deactivates inline without the edit modal', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    const name = `Toggle ${tag}`;
    await seedStaff(page, name, true);
    await page.reload();
    await scopeTo(page, tag, 1);

    expect(await statusOf(page, name)).toBe('Active');
    await page.getByRole('switch', { name: `Deactivate ${name}` }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(row(page, name).locator('.state-badge')).toHaveText('Inactive');

    await page.getByRole('switch', { name: `Activate ${name}` }).click();
    await expect(row(page, name).locator('.state-badge')).toHaveText('Active');

    // The change is persisted, not just local state.
    await page.reload();
    await scopeTo(page, tag, 1);
    expect(await statusOf(page, name)).toBe('Active');
  });

  // AC 10 + edge case — inactive staff are retained, findable, reactivatable.
  test('inactive staff remain listed, are findable via the Inactive filter, and can be reactivated', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    const name = `Retained ${tag}`;
    const seeded = await seedStaff(page, name, true);
    await page.reload();
    await scopeTo(page, tag, 1);

    await page.getByRole('switch', { name: `Deactivate ${name}` }).click();
    await expect(row(page, name).locator('.state-badge')).toHaveText('Inactive');

    // Still present under All…
    await page.reload();
    await scopeTo(page, tag, 1);
    await expect(row(page, name)).toBeVisible();

    // …and findable with the Inactive filter after a fresh search.
    await searchBox(page).fill('');
    await statusFilter(page).selectOption('false');
    await searchBox(page).fill(tag);
    await expect(nameCells(page)).toHaveText([name]);

    // Reactivate, then it belongs to the Active filter again.
    await page.getByRole('switch', { name: `Activate ${name}` }).click();
    await statusFilter(page).selectOption('true');
    await expect(nameCells(page)).toHaveText([name]);
    await statusFilter(page).selectOption('false');
    await expect(page.getByRole('heading', { name: 'No staff match your search or filter' })).toBeVisible();

    // Same record throughout — the id never changed.
    const [record] = await fetchStaffByTag(page, tag);
    expect(record.id).toBe(seeded.id);
    expect(record.createdAt).toBe(seeded.createdAt);
  });

  // AC 11 — no delete action; renaming/deactivating updates the same entry.
  test('no delete action is offered and renaming keeps the same roster entry', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    const seeded = await seedStaff(page, `Persistent ${tag}`, true);
    await page.reload();
    await scopeTo(page, tag, 1);

    await expect(page.getByRole('button', { name: /delete|remove/i })).toHaveCount(0);
    await page.getByRole('button', { name: `Edit Persistent ${tag}` }).click();
    await expect(modal(page).getByRole('button', { name: /delete|remove/i })).toHaveCount(0);

    await page.locator('#staff-display-name').fill(`Persistent Renamed ${tag}`);
    await page.locator('#staff-active-state').selectOption('false');
    await modal(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(modal(page)).toHaveCount(0);

    // Exactly one row for this tag: updated in place, no replacement entry and
    // no removal.
    await expect(rows(page)).toHaveCount(1);
    await expect(nameCells(page)).toHaveText([`Persistent Renamed ${tag}`]);
    const records = await fetchStaffByTag(page, tag);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(seeded.id);
    expect(records[0].createdAt).toBe(seeded.createdAt);
    // The API exposes no delete surface at all (ADR 0003 retention).
    const deleteAttempt = await page.request.delete(`${API_BASE_URL}/staff/${seeded.id}`);
    expect(deleteAttempt.status()).toBe(404);
  });

  // AC 12 + edge case — cancelling add or edit leaves the roster unchanged.
  test('cancelling or closing add and edit modals leaves the roster unchanged', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    const name = `Unchanged ${tag}`;
    await seedStaff(page, name, true);
    await page.reload();
    await scopeTo(page, tag, 1);

    // Cancel an add after typing.
    await addStaffButton(page).click();
    await page.locator('#staff-display-name').fill(`Discarded ${tag}`);
    await modal(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(nameCells(page)).toHaveText([name]);

    // Close (X) an add after typing.
    await addStaffButton(page).click();
    await page.locator('#staff-display-name').fill(`Also discarded ${tag}`);
    await modal(page).getByRole('button', { name: 'Close staff editor' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(nameCells(page)).toHaveText([name]);

    // Cancel an edit after typing changes — the changes are discarded.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.locator('#staff-display-name').fill(`Never saved ${tag}`);
    await page.locator('#staff-active-state').selectOption('false');
    await modal(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(nameCells(page)).toHaveText([name]);
    expect(await statusOf(page, name)).toBe('Active');

    // Re-opening the edit modal shows the unmodified values.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await expect(page.locator('#staff-display-name')).toHaveValue(name);
    await expect(page.locator('#staff-active-state')).toHaveValue('true');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);

    // Nothing was created and nothing changed server-side.
    const records = await fetchStaffByTag(page, tag);
    expect(records).toHaveLength(1);
    expect(records[0].displayName).toBe(name);
    expect(records[0].isActive).toBe(true);
  });

  // AC 13 (no-results half) + edge case — a search with no matches shows a
  // no-results state that is distinct from the empty-roster state, and the page
  // stays usable.
  test('a search with no matches shows a usable no-results state', async ({ page }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Present ${tag}`);
    await page.reload();
    await scopeTo(page, tag, 1);

    await searchBox(page).fill(`no-such-person-${tag}`);
    await expect(
      page.getByRole('heading', { name: 'No staff match your search or filter' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No staff members yet' })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);

    // Still usable: adding is offered, and the selections can be cleared.
    await expect(addStaffButton(page)).toBeEnabled();
    await page
      .locator('.staff-empty')
      .getByRole('button', { name: 'Clear search and filter' })
      .click();
    await expect(searchBox(page)).toHaveValue('');
    await expect(statusFilter(page)).toHaveValue('all');
    await expect(row(page, `Present ${tag}`)).toBeVisible();
  });

  /**
   * AC 13 (empty-roster half). Retention forbids deletion, so once any staff
   * member exists the truly-empty roster is unreachable through the product —
   * this is the one state driven by fulfilling the list request with an empty
   * array instead of real data.
   */
  test('an empty roster shows its own empty state with an add affordance', async ({
    page,
  }) => {
    await page.route(`${API_BASE_URL}/staff*`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    await gotoStaff(page);
    await expect(page.getByRole('heading', { name: 'No staff members yet' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'No staff match your search or filter' }),
    ).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);

    // Usable: the empty state itself offers the add modal.
    await page.locator('.staff-empty').getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page).getByRole('heading', { name: 'Add staff' })).toBeVisible();
  });

  // Edge case — combined selections that exclude a just-added or just-toggled
  // row behave consistently.
  test('rows appear or disappear according to the active selections after a write', async ({
    page,
  }) => {
    const tag = newTag();
    await gotoStaff(page);
    await seedStaff(page, `Base ${tag}`, false);
    await page.reload();

    await searchBox(page).fill(tag);
    await statusFilter(page).selectOption('false');
    await expect(nameCells(page)).toHaveText([`Base ${tag}`]);

    // Add an ACTIVE member while the Inactive filter is on — it must not show.
    await addStaffButton(page).click();
    await page.locator('#staff-display-name').fill(`Fresh ${tag}`);
    await modal(page).getByRole('button', { name: 'Add staff' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(nameCells(page)).toHaveText([`Base ${tag}`]);

    // Switching to All reveals it.
    await statusFilter(page).selectOption('all');
    await expect(rows(page)).toHaveCount(2);

    // Toggling a row out of the current filter drops it from the visible list.
    await statusFilter(page).selectOption('true');
    await expect(nameCells(page)).toHaveText([`Fresh ${tag}`]);
    await page.getByRole('switch', { name: `Deactivate Fresh ${tag}` }).click();
    await expect(
      page.getByRole('heading', { name: 'No staff match your search or filter' }),
    ).toBeVisible();
    await statusFilter(page).selectOption('false');
    await expect(rows(page)).toHaveCount(2);
  });
});
