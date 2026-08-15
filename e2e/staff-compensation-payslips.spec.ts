import { expect, test, type Page } from '@playwright/test';
import {
  countStoredEntriesForStaff,
  deleteStoredEntriesForStaff,
  readStoredEntriesForStaff,
  readStoredEntry,
} from './fixtures/compensation';
import { isoShift, longDate, shopToday } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #309 — "Record daily staff compensation and
 * generate payslips" (QA task #316).
 *
 * Everything runs through the real browser → web app → NestJS API → PostgreSQL
 * path against the `admin` (ADMIN) and `staff` (STAFF) users from
 * apps/api/prisma/seed.ts. `/compensation` is admin-guarded in the router and
 * `@Roles(ADMIN)` on the controller (ADR 0013 §6).
 *
 * Three conventions run through the whole file.
 *
 * - **Every test owns its roster members.** Each one creates freshly tagged
 *   staff members, so no test can see another's entries and the order of the
 *   file does not matter. The roster has no delete surface (ADR 0003) and
 *   `staff_compensation_entries` is `ON DELETE RESTRICT` on the member, so
 *   teardown deletes the *entries* and leaves the tagged members behind.
 * - **Refusals assert the negative.** The story words each refusal as "nothing
 *   is saved" / "without changing the existing record". A toast does not prove
 *   that, so refusals re-read the stored integer-cent columns through
 *   `e2e/fixtures/compensation.ts`.
 * - **Money is computed in integer cents.** `peso()` below formats expected
 *   values from cents with its own grouping logic rather than importing the
 *   app's `formatMoney`, so a float bug in the product cannot be mirrored into
 *   the expectation. Amounts like `0.07` and `1,234.56` are used deliberately:
 *   a float bug shows up there, not on whole pesos.
 *
 * List and payslip assertions never rely on the screens' default date range
 * (current month / relative window). Every test types the dates it needs, so a
 * run on the 1st of a month behaves like a run on the 20th.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

// Same host the web app itself calls: the session cookie is host-scoped, so the
// request-context calls below only carry it when they hit the same origin.
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-test tag that is also a unique, selectable display name. */
function newName(label: string): string {
  seq += 1;
  return `QA316 ${label} ${RUN}-${seq}`;
}

const TODAY = shopToday();
/** `n` whole days before the current shop date. Always a legal work date. */
const daysAgo = (n: number) => isoShift(TODAY, -n);

/** Roster members created by this file, cleaned up (entries only) at the end. */
const seededStaffIds: string[] = [];

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
}

interface EntryPayload {
  id: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  workDate: string;
  salaryCents: number;
  commissionCents: number;
  dailyTotalCents: number;
}

/**
 * Format integer cents the way the UI does, derived independently of the app.
 * Grouping is done by regex on the peso part so the expectation cannot inherit
 * a rounding bug from `formatMoney`.
 */
function peso(totalCents: number): string {
  const sign = totalCents < 0 ? '-' : '';
  const absolute = Math.abs(totalCents);
  const centavos = String(absolute % 100).padStart(2, '0');
  const pesos = String(Math.trunc(absolute / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  return `₱${sign}${pesos}.${centavos}`;
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Create a roster member through the admin API (test setup only). */
async function seedStaffMember(
  page: Page,
  displayName: string,
): Promise<StaffMemberPayload> {
  const response = await page.request.post(`${API_BASE_URL}/staff`, {
    data: { displayName, isActive: true },
  });
  expect(
    response.ok(),
    `seeding staff "${displayName}" failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const member = (await response.json()) as StaffMemberPayload;
  seededStaffIds.push(member.id);
  return member;
}

/** Create a compensation entry through the admin API (test setup only). */
async function seedEntry(
  page: Page,
  input: {
    staffMemberId: string;
    workDate: string;
    salaryCents: number;
    commissionCents: number;
  },
): Promise<EntryPayload> {
  const response = await page.request.post(
    `${API_BASE_URL}/compensation/entries`,
    { data: input },
  );
  expect(
    response.ok(),
    `seeding entry ${input.workDate} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as EntryPayload;
}

// ---- page objects -----------------------------------------------------------

async function gotoCompensation(page: Page): Promise<void> {
  await page.goto('/compensation');
  await expect(
    page.getByRole('heading', { name: 'Compensation', level: 1 }),
  ).toBeVisible();
}

function recordsTab(page: Page) {
  return page.getByRole('button', { name: 'Daily records' });
}

function payslipsTab(page: Page) {
  return page.getByRole('button', { name: 'Payslips' });
}

const filters = (page: Page) =>
  page.locator('form[aria-label="Filter compensation records"]');

/** Scope the records list to one member and an explicit inclusive range. */
async function applyFilters(
  page: Page,
  options: { staffName?: string; from?: string; to?: string },
): Promise<void> {
  const form = filters(page);
  if (options.staffName) {
    await form.locator('select').selectOption({ label: options.staffName });
  }
  await form
    .locator('input[type="date"]')
    .first()
    .fill(options.from ?? '');
  await form
    .locator('input[type="date"]')
    .nth(1)
    .fill(options.to ?? '');
}

/** The one list row for a member's work date, located by its ISO-dated action. */
function recordRow(page: Page, staffName: string, workDate: string) {
  return page.locator('.compensation-table tbody tr').filter({
    has: page.getByRole('button', {
      name: `Edit ${staffName}'s ${workDate} record`,
    }),
  });
}

function editorDialog(page: Page) {
  return page.getByRole('dialog', { name: /daily record/i });
}

async function openAddDialog(page: Page): Promise<void> {
  await page
    .locator('.catalog-page-head')
    .getByRole('button', { name: 'Add daily record' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Add daily record' }),
  ).toBeVisible();
}

/** Fill the add dialog. `undefined` leaves a field alone; `''` clears it. */
async function fillDraft(
  page: Page,
  values: {
    staffName?: string;
    workDate?: string;
    salary?: string;
    commission?: string;
  },
): Promise<void> {
  const dialog = editorDialog(page);
  if (values.staffName !== undefined) {
    await dialog
      .locator('#compensation-staffMemberId')
      .selectOption({ label: values.staffName });
  }
  if (values.workDate !== undefined) {
    await dialog.locator('#compensation-workDate').fill(values.workDate);
  }
  if (values.salary !== undefined) {
    await dialog.locator('#compensation-salary').fill(values.salary);
  }
  if (values.commission !== undefined) {
    await dialog.locator('#compensation-commission').fill(values.commission);
  }
}

async function generatePayslip(
  page: Page,
  options: { staffName?: string; from: string; to: string },
): Promise<void> {
  const form = page.locator('.payslip-filter form');
  if (options.staffName) {
    await form.locator('select').selectOption({ label: options.staffName });
  }
  await form.locator('input[type="date"]').first().fill(options.from);
  await form.locator('input[type="date"]').nth(1).fill(options.to);
  await page.getByRole('button', { name: 'Generate payslip' }).click();
}

const payslipResult = (page: Page) => page.locator('.payslip-result');
const payslipRows = (page: Page) => page.locator('.payslip-table tbody tr');
const payslipTotal = (page: Page, label: string) =>
  page.locator('.payslip-totals .report-metric').filter({
    has: page.getByText(label, { exact: true }),
  });

test.afterAll(() => {
  deleteStoredEntriesForStaff(seededStaffIds);
});

// ---- AC: access -------------------------------------------------------------

test.describe('Access to compensation (story #309)', () => {
  test('an administrator can reach the compensation records and payslip surfaces', async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // The nav entry exists…
    await page
      .getByRole('link', { name: 'Compensation', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/compensation$/);

    // …and both sections render for an ADMIN. This is the control for the
    // staff test below: a blanket route failure would fail here too, so it
    // cannot masquerade as a passing authorization test.
    await expect(
      page.getByRole('heading', { name: 'Compensation', level: 1 }),
    ).toBeVisible();
    await expect(page.locator('.compensation-table')).toBeVisible();
    await payslipsTab(page).click();
    await expect(
      page.getByRole('heading', { name: 'Generate payslip' }),
    ).toBeVisible();
  });

  test('a staff user cannot reach the compensation route directly and sees no compensation data', async ({
    page,
  }) => {
    await page.goto('/staff/sign-in');
    await page
      .getByRole('button', { name: 'Use Username and Password' })
      .click();
    await expect(page.locator('#staff-username')).toBeVisible();
    await page.locator('#staff-username').fill(STAFF_USERNAME);
    await page.locator('#staff-password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/pos(\/order)?$/);

    // Direct navigation, not a hidden link: the route itself must not serve
    // compensation to a STAFF session.
    await page.goto('/compensation');
    await expect(page).not.toHaveURL(/\/compensation$/);
    await expect(page.locator('.compensation-table')).toHaveCount(0);
    await expect(page.locator('.payslip-view')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Compensation', level: 1 }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Compensation', exact: true }),
    ).toHaveCount(0);
  });

  test('the API refuses every compensation operation for a staff session', async ({
    page,
  }) => {
    // The API is the real boundary (ADR 0013 §6) — a client-side redirect is
    // not authorization, so each verb is checked with a STAFF cookie.
    await page.goto('/staff/sign-in');
    const login = await page.request.post(
      `${API_BASE_URL}/auth/staff/login`,
      {
        data: {
          username: STAFF_USERNAME,
          password: STAFF_PASSWORD,
          deviceId: `qa316-${RUN}`,
        },
      },
    );
    expect(login.ok(), await login.text()).toBeTruthy();

    const someUuid = '00000000-0000-4000-8000-000000000000';
    const reads = [
      await page.request.get(`${API_BASE_URL}/compensation/entries`),
      await page.request.get(
        `${API_BASE_URL}/compensation/payslip?staffMemberId=${someUuid}&from=${daysAgo(7)}&to=${TODAY}`,
      ),
    ];
    const writes = [
      await page.request.post(`${API_BASE_URL}/compensation/entries`, {
        data: {
          staffMemberId: someUuid,
          workDate: daysAgo(1),
          salaryCents: 100,
          commissionCents: 0,
        },
      }),
      await page.request.patch(
        `${API_BASE_URL}/compensation/entries/${someUuid}`,
        { data: { salaryCents: 100, commissionCents: 0 } },
      ),
      await page.request.delete(
        `${API_BASE_URL}/compensation/entries/${someUuid}`,
      ),
    ];

    for (const response of [...reads, ...writes]) {
      expect(
        response.status(),
        `${response.url()} should be forbidden for a staff session`,
      ).toBe(403);
    }
  });
});

// ---- AC: daily records list, add, derived total -----------------------------

test.describe('Daily compensation records (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('an added record shows staff member, work date, salary, commission and a derived daily total, stored in exact cents', async ({
    page,
  }) => {
    const name = newName('Add');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);

    await gotoCompensation(page);
    await openAddDialog(page);
    // 1,234.56 and 0.07 are the integer-cents canaries: a float pipeline
    // rounds one of them, whole pesos would hide it.
    await fillDraft(page, {
      staffName: name,
      workDate,
      salary: '1234.56',
      commission: '0.07',
    });

    // The daily total is derived, never typed — there is no total input.
    await expect(
      editorDialog(page).locator('.compensation-total .num'),
    ).toHaveText(peso(123463));
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    const row = recordRow(page, name, workDate);
    await expect(row).toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toHaveText(name);
    await expect(cells.nth(1)).toHaveText(longDate(workDate));
    await expect(cells.nth(2)).toHaveText(peso(123456));
    await expect(cells.nth(3)).toHaveText(peso(7));
    await expect(cells.nth(4)).toHaveText(peso(123463));

    // The stored columns, not the read model: 123456 exactly, no float drift.
    const stored = readStoredEntriesForStaff(member.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      workDate,
      salaryCents: 123456,
      commissionCents: 7,
    });
  });

  test('records are listed newest work date first, then by staff member name', async ({
    page,
  }) => {
    const older = newName('Zulu');
    const newerA = newName('Alpha');
    const newerB = newName('Bravo');
    const [olderMember, memberA, memberB] = await Promise.all([
      seedStaffMember(page, older),
      seedStaffMember(page, newerA),
      seedStaffMember(page, newerB),
    ]);
    const oldDay = daysAgo(4);
    const newDay = daysAgo(2);
    await seedEntry(page, {
      staffMemberId: olderMember!.id,
      workDate: oldDay,
      salaryCents: 1000,
      commissionCents: 0,
    });
    // Seeded out of alphabetical order so a stable-sort accident cannot pass.
    await seedEntry(page, {
      staffMemberId: memberB!.id,
      workDate: newDay,
      salaryCents: 2000,
      commissionCents: 0,
    });
    await seedEntry(page, {
      staffMemberId: memberA!.id,
      workDate: newDay,
      salaryCents: 3000,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    await applyFilters(page, { from: oldDay, to: newDay });
    const names = page.locator('.compensation-table tbody tr td:first-child');
    const listed = (await names.allInnerTexts()).filter((value) =>
      value.startsWith('QA316'),
    );
    expect(listed.filter((value) => [newerA, newerB, older].includes(value)))
      .toEqual([newerA, newerB, older]);
  });

  test('an edit updates the amounts and the derived daily total without a page refresh', async ({
    page,
  }) => {
    const name = newName('Edit');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);
    const entry = await seedEntry(page, {
      staffMemberId: member.id,
      workDate,
      salaryCents: 50000,
      commissionCents: 2500,
    });

    await gotoCompensation(page);
    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    await page
      .getByRole('button', { name: `Edit ${name}'s ${workDate} record` })
      .click();

    // Only the amounts are editable — the member and the work date are shown
    // as fixed context, so an edit cannot collide its way past the unique pair.
    await expect(
      editorDialog(page).locator('#compensation-staffMemberId'),
    ).toHaveCount(0);
    await expect(
      editorDialog(page).locator('#compensation-workDate'),
    ).toHaveCount(0);
    await expect(
      editorDialog(page).locator('.compensation-fixed-context'),
    ).toContainText(name);

    await fillDraft(page, { salary: '600.50', commission: '99.99' });
    await editorDialog(page)
      .getByRole('button', { name: 'Save changes' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    // Same page, no reload.
    const cells = recordRow(page, name, workDate).locator('td');
    await expect(cells.nth(2)).toHaveText(peso(60050));
    await expect(cells.nth(3)).toHaveText(peso(9999));
    await expect(cells.nth(4)).toHaveText(peso(70049));

    expect(readStoredEntry(entry.id)).toMatchObject({
      workDate,
      salaryCents: 60050,
      commissionCents: 9999,
    });
  });

  test('an edit cannot move a record onto another staff member or date', async ({
    page,
  }) => {
    const nameA = newName('CollideA');
    const nameB = newName('CollideB');
    const [memberA, memberB] = await Promise.all([
      seedStaffMember(page, nameA),
      seedStaffMember(page, nameB),
    ]);
    const day = daysAgo(3);
    await seedEntry(page, {
      staffMemberId: memberA!.id,
      workDate: day,
      salaryCents: 1000,
      commissionCents: 0,
    });
    const moveable = await seedEntry(page, {
      staffMemberId: memberB!.id,
      workDate: day,
      salaryCents: 2000,
      commissionCents: 0,
    });

    // The dialog offers no way to do this, so the attempt is made straight at
    // the API — the constraint has to hold there, not only in the form.
    const response = await page.request.patch(
      `${API_BASE_URL}/compensation/entries/${moveable.id}`,
      {
        data: {
          salaryCents: 2000,
          commissionCents: 0,
          staffMemberId: memberA!.id,
          workDate: day,
        },
      },
    );
    expect(response.ok()).toBeFalsy();
    expect(readStoredEntry(moveable.id)).toMatchObject({
      staffMemberId: memberB!.id,
      workDate: day,
      salaryCents: 2000,
    });
  });
});

// ---- AC: amount and required-field validation -------------------------------

test.describe('Compensation amount validation (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  const refusals: {
    label: string;
    values: Parameters<typeof fillDraft>[1];
    errorId: string;
    message: string;
  }[] = [
    {
      label: 'a missing salary',
      values: { salary: '', commission: '10.00' },
      errorId: '#compensation-salary-error',
      message: 'Enter a salary amount. Zero is allowed.',
    },
    {
      label: 'a missing commission',
      values: { salary: '10.00', commission: '' },
      errorId: '#compensation-commission-error',
      message: 'Enter a commission amount. Zero is allowed.',
    },
    {
      label: 'a negative salary',
      values: { salary: '-1.00', commission: '0' },
      errorId: '#compensation-salary-error',
      message: 'Salary cannot be negative.',
    },
    {
      label: 'a negative commission',
      values: { salary: '0', commission: '-0.01' },
      errorId: '#compensation-commission-error',
      message: 'Commission cannot be negative.',
    },
    {
      label: 'a non-numeric salary',
      values: { salary: 'abc', commission: '0' },
      errorId: '#compensation-salary-error',
      message: 'Salary must be a number.',
    },
    {
      label: 'a sub-cent salary',
      values: { salary: '10.005', commission: '0' },
      errorId: '#compensation-salary-error',
      message: 'Salary cannot have more than 2 decimal places.',
    },
    {
      label: 'a sub-cent commission',
      values: { salary: '0', commission: '0.001' },
      errorId: '#compensation-commission-error',
      message: 'Commission cannot have more than 2 decimal places.',
    },
  ];

  for (const refusal of refusals) {
    test(`${refusal.label} is refused with a clear explanation and nothing is stored`, async ({
      page,
    }) => {
      const name = newName('Invalid');
      const member = await seedStaffMember(page, name);
      const workDate = daysAgo(2);

      await gotoCompensation(page);
      await openAddDialog(page);
      await fillDraft(page, { staffName: name, workDate, ...refusal.values });
      await editorDialog(page)
        .getByRole('button', { name: 'Add record' })
        .click();

      await expect(page.locator(refusal.errorId)).toHaveText(refusal.message);
      // The dialog stays open — nothing was accepted.
      await expect(editorDialog(page)).toBeVisible();
      // And nothing silently rounded into a stored amount.
      expect(countStoredEntriesForStaff(member.id)).toBe(0);
    });
  }

  test('a missing staff member and a missing work date are each refused and nothing is stored', async ({
    page,
  }) => {
    const name = newName('Required');
    const member = await seedStaffMember(page, name);

    await gotoCompensation(page);
    await openAddDialog(page);
    await fillDraft(page, { workDate: '', salary: '10.00', commission: '0' });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(page.locator('#compensation-staff-error')).toHaveText(
      'Choose an active staff member.',
    );
    await expect(page.locator('#compensation-date-error')).toHaveText(
      'Choose a work date.',
    );

    // Supplying only the member still leaves the date missing.
    await fillDraft(page, { staffName: name });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(page.locator('#compensation-staff-error')).toHaveCount(0);
    await expect(page.locator('#compensation-date-error')).toHaveText(
      'Choose a work date.',
    );

    await expect(editorDialog(page)).toBeVisible();
    expect(countStoredEntriesForStaff(member.id)).toBe(0);
  });

  test('zero salary and zero commission are valid and the derived total is zero', async ({
    page,
  }) => {
    const name = newName('Zero');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(2);

    await gotoCompensation(page);
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: name,
      workDate,
      salary: '0',
      commission: '0',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    await expect(recordRow(page, name, workDate).locator('td').nth(4)).toHaveText(
      peso(0),
    );
    expect(readStoredEntriesForStaff(member.id)[0]).toMatchObject({
      salaryCents: 0,
      commissionCents: 0,
    });
  });

  test('a future work date is refused with a clear explanation and nothing is stored', async ({
    page,
  }) => {
    const name = newName('Future');
    const member = await seedStaffMember(page, name);
    const tomorrow = isoShift(TODAY, 1);

    await gotoCompensation(page);
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: name,
      workDate: tomorrow,
      salary: '10.00',
      commission: '0',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();

    await expect(page.locator('#compensation-date-error')).toHaveText(
      'Choose today or an earlier date.',
    );
    await expect(editorDialog(page)).toBeVisible();
    expect(countStoredEntriesForStaff(member.id)).toBe(0);
  });
});

// ---- AC: deactivated members keep their history -----------------------------

test.describe('Deactivated staff members (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('deactivating a member keeps their records listed and payslip-able, but they can no longer be given new daily records', async ({
    page,
  }) => {
    const name = newName('Deactivated');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate,
      salaryCents: 40000,
      commissionCents: 1000,
    });

    const deactivate = await page.request.patch(
      `${API_BASE_URL}/staff/${member.id}`,
      { data: { isActive: false } },
    );
    expect(deactivate.ok(), await deactivate.text()).toBeTruthy();

    await gotoCompensation(page);
    // Both filter lists mark a deactivated member rather than dropping them.
    await applyFilters(page, {
      staffName: `${name} (inactive)`,
      from: workDate,
      to: workDate,
    });

    // The existing record is neither removed nor hidden, and stays maintainable.
    const row = recordRow(page, name, workDate);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(4)).toHaveText(peso(41000));
    await expect(
      row.getByRole('button', { name: /^Edit / }),
    ).toBeVisible();
    await expect(
      row.getByRole('button', { name: /^Delete / }),
    ).toBeVisible();

    // But no new record can be assigned to them: the add dialog only offers
    // active members.
    await openAddDialog(page);
    await expect(
      editorDialog(page).locator(
        `#compensation-staffMemberId option:text-is("${name}")`,
      ),
    ).toHaveCount(0);
    await editorDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(editorDialog(page)).toHaveCount(0);

    // A payslip can still be generated for them.
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: `${name} (inactive)`,
      from: workDate,
      to: workDate,
    });
    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(41000),
    );
  });
});

// ---- AC: one record per staff member per date -------------------------------

test.describe('Duplicate daily records (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('a second record for the same staff member and date is refused and the existing record is unchanged', async ({
    page,
  }) => {
    const name = newName('Dup');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);
    const existing = await seedEntry(page, {
      staffMemberId: member.id,
      workDate,
      salaryCents: 45000,
      commissionCents: 500,
    });

    await gotoCompensation(page);
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: name,
      workDate,
      salary: '1.00',
      commission: '2.00',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();

    await expect(page.locator('.compensation-conflict')).toContainText(
      'A record already exists',
    );

    // Re-read the row rather than trusting the message: the first entry's
    // amounts must be exactly what they were.
    expect(readStoredEntry(existing.id)).toMatchObject({
      workDate,
      salaryCents: 45000,
      commissionCents: 500,
    });
    expect(countStoredEntriesForStaff(member.id)).toBe(1);
  });

  test('the same date for a different staff member and a different date for the same staff member are both allowed', async ({
    page,
  }) => {
    const nameA = newName('PairA');
    const nameB = newName('PairB');
    const [memberA, memberB] = await Promise.all([
      seedStaffMember(page, nameA),
      seedStaffMember(page, nameB),
    ]);
    const day = daysAgo(3);
    const otherDay = daysAgo(2);
    await seedEntry(page, {
      staffMemberId: memberA!.id,
      workDate: day,
      salaryCents: 10000,
      commissionCents: 0,
    });

    await gotoCompensation(page);

    // Same date, different member.
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: nameB,
      workDate: day,
      salary: '20.00',
      commission: '0',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    // Different date, same member.
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: nameA,
      workDate: otherDay,
      salary: '30.00',
      commission: '0',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    expect(readStoredEntriesForStaff(memberA!.id)).toHaveLength(2);
    expect(readStoredEntriesForStaff(memberB!.id)).toHaveLength(1);
  });
});

// ---- AC: delete after confirming --------------------------------------------

test.describe('Deleting a daily record (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('cancelling the confirmation leaves the record in place and issues no delete request', async ({
    page,
  }) => {
    const name = newName('KeepMe');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);
    const entry = await seedEntry(page, {
      staffMemberId: member.id,
      workDate,
      salaryCents: 12300,
      commissionCents: 45,
    });

    const deleteCalls: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'DELETE' &&
        request.url().includes('/compensation/entries')
      ) {
        deleteCalls.push(request.url());
      }
    });

    await gotoCompensation(page);
    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    await page
      .getByRole('button', { name: `Delete ${name}'s ${workDate} record` })
      .click();
    const confirm = page.getByRole('dialog', {
      name: 'Delete daily record?',
    });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('This cannot be undone.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);

    await expect(recordRow(page, name, workDate)).toHaveCount(1);
    expect(deleteCalls, 'cancelling must not call the delete endpoint').toEqual(
      [],
    );
    expect(readStoredEntry(entry.id)).toMatchObject({ salaryCents: 12300 });
  });

  test('confirming removes the record and it does not come back after a reload', async ({
    page,
  }) => {
    const name = newName('DeleteMe');
    const member = await seedStaffMember(page, name);
    const workDate = daysAgo(3);
    const entry = await seedEntry(page, {
      staffMemberId: member.id,
      workDate,
      salaryCents: 9900,
      commissionCents: 100,
    });

    await gotoCompensation(page);
    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    await page
      .getByRole('button', { name: `Delete ${name}'s ${workDate} record` })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete daily record?' })
      .getByRole('button', { name: 'Delete record' })
      .click();

    // Gone from the list without a manual refresh…
    await expect(recordRow(page, name, workDate)).toHaveCount(0);
    expect(readStoredEntry(entry.id)).toBeNull();

    // …and still gone after one (a hard delete, no undo — ADR 0013 §4).
    await page.reload();
    await applyFilters(page, { staffName: name, from: workDate, to: workDate });
    await expect(recordRow(page, name, workDate)).toHaveCount(0);
    expect(countStoredEntriesForStaff(member.id)).toBe(0);
  });

  test('a deleted record is no longer counted by a regenerated payslip', async ({
    page,
  }) => {
    const name = newName('DeletePayslip');
    const member = await seedStaffMember(page, name);
    const keptDay = daysAgo(4);
    const deletedDay = daysAgo(3);
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: keptDay,
      salaryCents: 10000,
      commissionCents: 0,
    });
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: deletedDay,
      salaryCents: 25000,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: keptDay,
      to: deletedDay,
    });
    await expect(payslipRows(page)).toHaveCount(2);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(35000),
    );

    await recordsTab(page).click();
    await applyFilters(page, {
      staffName: name,
      from: keptDay,
      to: deletedDay,
    });
    await page
      .getByRole('button', { name: `Delete ${name}'s ${deletedDay} record` })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete daily record?' })
      .getByRole('button', { name: 'Delete record' })
      .click();
    await expect(recordRow(page, name, deletedDay)).toHaveCount(0);

    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: keptDay,
      to: deletedDay,
    });
    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(10000),
    );
  });
});

// ---- AC: payslip generation over an inclusive range -------------------------

test.describe('Payslip generation (story #309)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  const RANGE = {
    before: daysAgo(10),
    start: daysAgo(9),
    middle: daysAgo(7),
    end: daysAgo(5),
    after: daysAgo(4),
  };

  /**
   * One member with an entry on each boundary and one day outside each end.
   * Every amount is distinct so a row can be identified by its money alone —
   * no coupling to how the UI formats a date.
   */
  async function seedBoundaryScenario(page: Page) {
    const name = newName('Payslip');
    const member = await seedStaffMember(page, name);
    const amounts = {
      before: { salaryCents: 90000, commissionCents: 0 },
      start: { salaryCents: 11111, commissionCents: 101 },
      middle: { salaryCents: 22222, commissionCents: 202 },
      end: { salaryCents: 33333, commissionCents: 303 },
      after: { salaryCents: 80000, commissionCents: 0 },
    };
    for (const key of ['before', 'start', 'middle', 'end', 'after'] as const) {
      await seedEntry(page, {
        staffMemberId: member.id,
        workDate: RANGE[key],
        ...amounts[key],
      });
    }
    return { name, member, amounts };
  }

  test('the payslip includes the start and end dates and excludes the days either side, with totals computed from the included entries', async ({
    page,
  }) => {
    const { name, amounts } = await seedBoundaryScenario(page);

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.start,
      to: RANGE.end,
    });

    await expect(payslipResult(page)).toBeVisible();
    await expect(
      payslipResult(page).getByRole('heading', { level: 2 }),
    ).toContainText(name);
    await expect(payslipResult(page)).toContainText(
      `${longDate(RANGE.start)} to ${longDate(RANGE.end)}`,
    );

    // Inclusive at both ends: exactly the three in-range entries.
    await expect(payslipRows(page)).toHaveCount(3);
    for (const key of ['start', 'middle', 'end'] as const) {
      await expect(payslipResult(page)).toContainText(
        peso(amounts[key].salaryCents),
      );
      await expect(payslipResult(page)).toContainText(longDate(RANGE[key]));
    }
    // An off-by-one at either end silently underpays or overpays someone.
    await expect(payslipResult(page)).not.toContainText(peso(90000));
    await expect(payslipResult(page)).not.toContainText(peso(80000));
    await expect(payslipResult(page)).not.toContainText(longDate(RANGE.before));
    await expect(payslipResult(page)).not.toContainText(longDate(RANGE.after));

    // Totals, from independently summed integer cents.
    const included = [amounts.start, amounts.middle, amounts.end];
    const salaryTotal = included.reduce((sum, a) => sum + a.salaryCents, 0);
    const commissionTotal = included.reduce(
      (sum, a) => sum + a.commissionCents,
      0,
    );
    expect(salaryTotal).toBe(66666);
    expect(commissionTotal).toBe(606);
    await expect(payslipTotal(page, 'Salary total')).toContainText(
      peso(salaryTotal),
    );
    await expect(payslipTotal(page, 'Commission total')).toContainText(
      peso(commissionTotal),
    );
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(salaryTotal + commissionTotal),
    );
  });

  test('mutation check: changing one in-range amount moves the payslip totals', async ({
    page,
  }) => {
    // Guards the test above. If the totals assertion could pass for the wrong
    // reason (a hard-coded string, a stale render), changing one seeded amount
    // by a known delta would not be visible here.
    const { name, member, amounts } = await seedBoundaryScenario(page);
    const originalGrand = 66666 + 606;

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.start,
      to: RANGE.end,
    });
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(originalGrand),
    );

    const middle = readStoredEntriesForStaff(member.id).find(
      (entry) => entry.workDate === RANGE.middle,
    );
    expect(middle).toBeDefined();
    const response = await page.request.patch(
      `${API_BASE_URL}/compensation/entries/${middle!.id}`,
      { data: { salaryCents: 99999, commissionCents: 202 } },
    );
    expect(response.ok(), await response.text()).toBeTruthy();

    const mutatedGrand =
      originalGrand - amounts.middle.salaryCents + 99999;
    expect(mutatedGrand).not.toBe(originalGrand);

    await generatePayslip(page, {
      staffName: name,
      from: RANGE.start,
      to: RANGE.end,
    });
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(mutatedGrand),
    );
    await expect(payslipTotal(page, 'Overall gross total')).not.toContainText(
      peso(originalGrand),
    );
  });

  test('a single-day range returns exactly the entry on that day', async ({
    page,
  }) => {
    const { name, amounts } = await seedBoundaryScenario(page);

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.middle,
      to: RANGE.middle,
    });

    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipResult(page)).toContainText(
      peso(amounts.middle.salaryCents),
    );
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(amounts.middle.salaryCents + amounts.middle.commissionCents),
    );
  });

  test("another staff member's entries in the same range are excluded", async ({
    page,
  }) => {
    const { name } = await seedBoundaryScenario(page);
    const otherName = newName('Bystander');
    const other = await seedStaffMember(page, otherName);
    await seedEntry(page, {
      staffMemberId: other.id,
      workDate: RANGE.middle,
      salaryCents: 77777,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.start,
      to: RANGE.end,
    });

    await expect(payslipRows(page)).toHaveCount(3);
    await expect(payslipResult(page)).not.toContainText(peso(77777));
    await expect(payslipResult(page)).not.toContainText(otherName);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(67272),
    );
  });

  test('an end date earlier than the start date is refused, no payslip renders, and the dates are not swapped', async ({
    page,
  }) => {
    const { name } = await seedBoundaryScenario(page);

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.end,
      to: RANGE.start,
    });

    await expect(page.locator('#payslip-range-error')).toBeVisible();
    await expect(page.locator('#payslip-range-error')).toContainText(
      'End date must be on or after the start date',
    );
    await expect(payslipResult(page)).toHaveCount(0);
    await expect(page.locator('.payslip-empty')).toHaveCount(0);

    // Silently swapping the dates would produce a plausible-looking payslip.
    const form = page.locator('.payslip-filter form');
    await expect(form.locator('input[type="date"]').first()).toHaveValue(
      RANGE.end,
    );
    await expect(form.locator('input[type="date"]').nth(1)).toHaveValue(
      RANGE.start,
    );
  });

  test('a valid range with no records shows an explicit no-records result and no zero-peso earnings totals', async ({
    page,
  }) => {
    const { name } = await seedBoundaryScenario(page);
    // A range that is valid and entirely clear of every seeded entry.
    const emptyFrom = daysAgo(40);
    const emptyTo = daysAgo(35);

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: emptyFrom,
      to: emptyTo,
    });

    const empty = page.locator('.payslip-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No records in this range');
    await expect(empty).toContainText(name);

    // The point of this criterion: no ₱0.00 payslip that reads like earnings.
    await expect(payslipResult(page)).toHaveCount(0);
    await expect(page.locator('.payslip-totals')).toHaveCount(0);
    await expect(page.locator('.payslip-table')).toHaveCount(0);
    await expect(page.locator('.payslip-view')).not.toContainText(peso(0));
  });

  test('a payslip generated after an add and an edit reflects the current records', async ({
    page,
  }) => {
    const name = newName('Fresh');
    const member = await seedStaffMember(page, name);
    const first = daysAgo(6);
    const added = daysAgo(5);
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: first,
      salaryCents: 20000,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, { staffName: name, from: first, to: added });
    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(20000),
    );

    // Add a record inside the range, then regenerate.
    await recordsTab(page).click();
    await openAddDialog(page);
    await fillDraft(page, {
      staffName: name,
      workDate: added,
      salary: '150.25',
      commission: '0.75',
    });
    await editorDialog(page)
      .getByRole('button', { name: 'Add record' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    await payslipsTab(page).click();
    await generatePayslip(page, { staffName: name, from: first, to: added });
    await expect(payslipRows(page)).toHaveCount(2);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(20000 + 15025 + 75),
    );

    // Edit that record, then regenerate again.
    await recordsTab(page).click();
    await applyFilters(page, { staffName: name, from: first, to: added });
    await page
      .getByRole('button', { name: `Edit ${name}'s ${added} record` })
      .click();
    await fillDraft(page, { salary: '10.00', commission: '0.00' });
    await editorDialog(page)
      .getByRole('button', { name: 'Save changes' })
      .click();
    await expect(editorDialog(page)).toHaveCount(0);

    await payslipsTab(page).click();
    await generatePayslip(page, { staffName: name, from: first, to: added });
    await expect(payslipRows(page)).toHaveCount(2);
    await expect(payslipTotal(page, 'Overall gross total')).toContainText(
      peso(20000 + 1000),
    );
  });

  test('the payslip stays inside v1 scope: gross totals only, with no print, export, email or payment affordance', async ({
    page,
  }) => {
    // Scope Notes on #309 + ADR 0013 §5. Anything here is scope the PO did not
    // accept, so it is asserted absent rather than left to review.
    const { name } = await seedBoundaryScenario(page);

    await gotoCompensation(page);
    await payslipsTab(page).click();
    await generatePayslip(page, {
      staffName: name,
      from: RANGE.start,
      to: RANGE.end,
    });
    await expect(payslipResult(page)).toBeVisible();

    const view = page.locator('.payslip-view');
    for (const forbidden of [
      /print/i,
      /download/i,
      /\bpdf\b/i,
      /\bcsv\b/i,
      /export/i,
      /e-?mail/i,
      /mark as paid/i,
      /\bpay (now|slip as paid)\b/i,
    ]) {
      await expect(
        view.getByRole('button', { name: forbidden }),
        `no ${forbidden} control belongs on the v1 payslip`,
      ).toHaveCount(0);
      await expect(
        view.getByRole('link', { name: forbidden }),
        `no ${forbidden} link belongs on the v1 payslip`,
      ).toHaveCount(0);
    }

    // Exactly three totals, all gross. No deduction, tax or net-pay figure is
    // computed — the only mention of them is the explicit disclaimer.
    await expect(page.locator('.payslip-totals dt')).toHaveText([
      'Salary total',
      'Commission total',
      'Overall gross total',
    ]);
    await expect(payslipResult(page)).toContainText(
      'No taxes, deductions, or net pay included.',
    );
  });
});
