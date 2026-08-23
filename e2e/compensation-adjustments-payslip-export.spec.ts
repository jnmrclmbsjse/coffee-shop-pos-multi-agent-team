import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countStoredAdjustmentsForStaff,
  deleteStoredAdjustmentsForStaff,
  deleteStoredEntriesForStaff,
  readStoredAdjustmentsForStaff,
} from './fixtures/compensation';
import { isoShift, longDate, shopToday } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #346 — "Add salary advances, allowances,
 * bonuses, and PNG payslip downloads" (QA task #358).
 *
 * Everything runs through the real browser → web app → NestJS API → PostgreSQL
 * path against the `admin` (ADMIN) and `staff` (STAFF) users from
 * apps/api/prisma/seed.ts, extending the #309 suite in
 * `staff-compensation-payslips.spec.ts` rather than forking it.
 *
 * Four conventions, three of them inherited from #309 and one new to this file.
 *
 * - **Every test owns its roster members.** Each creates freshly tagged staff,
 *   so no test can see another's rows. The roster has no delete surface
 *   (ADR 0003) and both compensation tables are `ON DELETE RESTRICT` on the
 *   member, so teardown deletes the *adjustments and entries* and leaves the
 *   tagged members behind.
 * - **Refusals assert the negative.** ADR 0014 §1 deliberately gives
 *   `staff_compensation_adjustments` no unique constraint, so "both duplicates
 *   persisted" and "nothing was saved" are decided by counting rows through
 *   `e2e/fixtures/compensation.ts`, never by reading a toast.
 * - **Money is computed in integer cents.** `peso()` formats expectations from
 *   cents with its own grouping so a float bug in the product cannot be
 *   mirrored into the expectation, and amounts like `0.07` and `1,234.56` are
 *   used deliberately.
 * - **Derived arithmetic is created through the real API and mutation-tested.**
 *   Per `e2e-seeded-sale-lines-hide-snapshot-bugs`, a net-payable assertion
 *   only proves something if changing an input provably moves the output, so
 *   the advance-subtraction test edits the advance and asserts the net moves by
 *   exactly the delta.
 *
 * ADR 0014 decisions that look like bugs if you do not know them, and are
 * asserted here as correct behaviour: duplicates persist (§1), descriptions are
 * stored verbatim after trimming (§2), `netPayableCents` may be negative and is
 * never clamped (§3), `grandTotalCents` still means salary + commission only
 * (§3), and the PNG is an export with no endpoint of its own (§5).
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
  return `QA358 ${label} ${RUN}-${seq}`;
}

const TODAY = shopToday();
/** `n` whole days before the current shop date. Always a legal effective date. */
const daysAgo = (n: number) => isoShift(TODAY, -n);

/** The five starter descriptions, ADR 0014 §2 (packages/shared constants). */
const ALLOWANCE_PRESETS = [
  'Load allowance',
  'Transportation allowance',
  'Calamity allowance',
] as const;
const BONUS_PRESETS = ['Performance bonus', 'Spot bonus'] as const;

/** Roster members created by this file; their rows are cleaned up at the end. */
const seededStaffIds: string[] = [];

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
}

interface AdjustmentPayload {
  id: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  kind: 'ADVANCE' | 'ALLOWANCE' | 'BONUS';
  effectiveDate: string;
  amountCents: number;
  description: string;
}

interface PayslipPayload {
  staffMember: { id: string; displayName: string };
  from: string;
  to: string;
  entries: { id: string; workDate: string }[];
  adjustments: AdjustmentPayload[];
  salaryTotalCents: number;
  commissionTotalCents: number;
  grandTotalCents: number;
  allowanceTotalCents: number;
  bonusTotalCents: number;
  advanceTotalCents: number;
  earningsTotalCents: number;
  netPayableCents: number;
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

/** `-₱1.00` / `−₱1.00` — the deduction prefix is a typographic minus in the UI. */
function negatedPeso(totalCents: number): RegExp {
  return new RegExp(`^[-−]${escapeRegExp(peso(totalCents))}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** Create a daily compensation entry through the admin API (test setup only). */
async function seedEntry(
  page: Page,
  input: {
    staffMemberId: string;
    workDate: string;
    salaryCents: number;
    commissionCents: number;
  },
): Promise<void> {
  const response = await page.request.post(
    `${API_BASE_URL}/compensation/entries`,
    { data: input },
  );
  expect(
    response.ok(),
    `seeding entry ${input.workDate} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}

/**
 * Create an adjustment through the real admin API — never straight into the
 * table. Column defaults must not stand in for values the product computes.
 */
async function seedAdjustment(
  page: Page,
  input: {
    staffMemberId: string;
    kind: 'ADVANCE' | 'ALLOWANCE' | 'BONUS';
    effectiveDate: string;
    amountCents: number;
    description: string;
  },
): Promise<AdjustmentPayload> {
  const response = await page.request.post(
    `${API_BASE_URL}/compensation/adjustments`,
    { data: input },
  );
  expect(
    response.ok(),
    `seeding ${input.kind} ${input.effectiveDate} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as AdjustmentPayload;
}

/** The payslip read model straight from the API, for the arithmetic contract. */
async function fetchPayslip(
  page: Page,
  staffMemberId: string,
  from: string,
  to: string,
): Promise<PayslipPayload> {
  const response = await page.request.get(
    `${API_BASE_URL}/compensation/payslip?staffMemberId=${staffMemberId}&from=${from}&to=${to}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as PayslipPayload;
}

// ---- page objects -----------------------------------------------------------

async function gotoAdjustments(page: Page): Promise<void> {
  await page.goto('/compensation');
  await expect(
    page.getByRole('heading', { name: 'Compensation', level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Adjustments', level: 2 }),
  ).toBeVisible();
}

async function gotoPayslips(page: Page): Promise<void> {
  await page.goto('/compensation');
  await expect(
    page.getByRole('heading', { name: 'Compensation', level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Payslips', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Generate payslip' }),
  ).toBeVisible();
}

const adjustmentFilters = (page: Page) =>
  page.locator('form[aria-label="Filter compensation adjustments"]');

/** Scope the adjustments list to one member and an explicit inclusive range. */
async function applyAdjustmentFilters(
  page: Page,
  options: { staffName?: string; from?: string; to?: string },
): Promise<void> {
  const form = adjustmentFilters(page);
  if (options.staffName) {
    await form.locator('select').selectOption({ label: options.staffName });
  }
  await form.locator('input[type="date"]').first().fill(options.from ?? '');
  await form.locator('input[type="date"]').nth(1).fill(options.to ?? '');
}

const adjustmentRows = (page: Page) =>
  page.locator('.adjustment-table tbody tr');

/** The one list row for an adjustment, located by its description-bearing action. */
function adjustmentRow(page: Page, staffName: string, description: string) {
  return adjustmentRows(page).filter({
    has: page.getByRole('button', {
      name: `Edit ${description} for ${staffName}`,
      exact: true,
    }),
  });
}

const adjustmentDialog = (page: Page) =>
  page.getByRole('dialog', { name: /adjustment/i });

async function openAddAdjustment(page: Page): Promise<void> {
  await page
    .locator('.compensation-panel-head')
    .getByRole('button', { name: 'Add adjustment' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Add adjustment', level: 2 }),
  ).toBeVisible();
}

/** Fill the adjustment dialog. `undefined` leaves a field alone; `''` clears it. */
async function fillAdjustmentDraft(
  page: Page,
  values: {
    staffName?: string;
    kind?: 'Advance' | 'Allowance' | 'Bonus';
    effectiveDate?: string;
    preset?: string;
    description?: string;
    amount?: string;
  },
): Promise<void> {
  const dialog = adjustmentDialog(page);
  if (values.staffName !== undefined) {
    await dialog
      .locator('#adjustment-staffMemberId')
      .selectOption({ label: values.staffName });
  }
  if (values.kind !== undefined) {
    await dialog
      .getByRole('button', { name: values.kind, exact: true })
      .click();
  }
  if (values.effectiveDate !== undefined) {
    await dialog.locator('#adjustment-effectiveDate').fill(values.effectiveDate);
  }
  if (values.amount !== undefined) {
    await dialog.locator('#adjustment-amount').fill(values.amount);
  }
  if (values.preset !== undefined) {
    await dialog
      .locator('.adjustment-presets')
      .getByRole('button', { name: values.preset, exact: true })
      .click();
  }
  if (values.description !== undefined) {
    await dialog.locator('#adjustment-description').fill(values.description);
  }
}

async function submitAdjustment(
  page: Page,
  label: 'Add adjustment' | 'Save changes',
): Promise<void> {
  await adjustmentDialog(page).getByRole('button', { name: label }).click();
}

const fieldError = (page: Page, field: string) =>
  page.locator(`#adjustment-${field}-error`);

async function generatePayslip(
  page: Page,
  options: { staffName: string; from: string; to: string },
): Promise<void> {
  const form = page.locator('.payslip-filter form');
  const staffSelect = form.locator('select');
  // The view preselects the first selectable member from an effect that runs
  // once the roster request resolves. Choosing before that effect lands lets it
  // overwrite the choice with the first member, and the payslip is then
  // generated for the wrong person. Wait for the default to arrive first, and
  // assert afterwards that the choice actually stuck.
  await expect(staffSelect).not.toHaveValue('');
  await staffSelect.selectOption({ label: options.staffName });
  await expect(staffSelect.locator('option:checked')).toHaveText(
    options.staffName,
  );
  await form.locator('input[type="date"]').first().fill(options.from);
  await form.locator('input[type="date"]').nth(1).fill(options.to);
  await expect(staffSelect.locator('option:checked')).toHaveText(
    options.staffName,
  );
  await page.getByRole('button', { name: 'Generate payslip' }).click();
}

/** The node that is actually rasterized into the PNG (ADR 0014 §5). */
const payslipArtifact = (page: Page) => page.locator('#payslip-capture-node');

/** One `<dt>/<dd>` total inside the payslip artifact, located by its exact label. */
function payslipTotal(page: Page, label: string): Locator {
  return payslipArtifact(page)
    .locator('.payslip-category-totals > div')
    .filter({
      has: page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }),
    })
    .locator('dd');
}

const payslipNet = (page: Page) => page.locator('.payslip-net-value');
const earningsRows = (page: Page) =>
  payslipArtifact(page)
    .locator('.payslip-artifact-table:not(.payslip-advance-table) tbody tr');
const advanceRows = (page: Page) =>
  payslipArtifact(page).locator('.payslip-advance-table tbody tr');
const downloadButton = (page: Page) =>
  page.getByRole('button', { name: /Download PNG|Preparing image/ });

test.afterAll(() => {
  deleteStoredAdjustmentsForStaff(seededStaffIds);
  deleteStoredEntriesForStaff(seededStaffIds);
});

// ---- AC 1-7: recording advances, allowances and bonuses ---------------------

test.describe('Recording compensation adjustments (story #346)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('an administrator records an advance, an allowance and a bonus, each stored in exact cents with its description', async ({
    page,
  }) => {
    const name = newName('Record');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(10);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, {
      staffName: name,
      from: date,
      to: date,
    });

    // Advance — criterion 1. 1,234.56 is the integer-cents canary: a float
    // pipeline rounds it, whole pesos would hide the bug.
    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Advance',
      effectiveDate: date,
      amount: '1234.56',
      description: 'Mid-month cash advance',
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    // Allowance from a starter choice — criteria 2 and 3.
    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Allowance',
      effectiveDate: date,
      amount: '0.07',
      preset: 'Transportation allowance',
    });
    await expect(
      adjustmentDialog(page).locator('#adjustment-description'),
    ).toHaveValue('Transportation allowance');
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    // Bonus from a starter choice — criteria 4 and 5.
    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Bonus',
      effectiveDate: date,
      amount: '500',
      preset: 'Performance bonus',
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    // On screen: three items, the advance shown as a deduction.
    await expect(adjustmentRows(page)).toHaveCount(3);
    await expect(
      adjustmentRow(page, name, 'Mid-month cash advance').locator('td').nth(2),
    ).toHaveText('Advance');
    // The list signs the number itself (`₱-1,234.56`); the payslip prefixes a
    // typographic minus to a positive figure. Both are the same money.
    await expect(
      adjustmentRow(page, name, 'Mid-month cash advance').locator('td').nth(4),
    ).toHaveText(peso(-123456));
    await expect(
      adjustmentRow(page, name, 'Transportation allowance').locator('td').nth(4),
    ).toHaveText(peso(7));
    await expect(
      adjustmentRow(page, name, 'Performance bonus').locator('td').nth(4),
    ).toHaveText(peso(50000));

    // Stored: exact integer cents, positive magnitudes, verbatim descriptions.
    const stored = readStoredAdjustmentsForStaff(member.id);
    expect(
      stored.map((row) => [row.kind, row.amountCents, row.description]),
    ).toEqual(
      expect.arrayContaining([
        ['ADVANCE', 123456, 'Mid-month cash advance'],
        ['ALLOWANCE', 7, 'Transportation allowance'],
        ['BONUS', 50000, 'Performance bonus'],
      ]),
    );
    expect(stored).toHaveLength(3);
    for (const row of stored) {
      expect(row.effectiveDate).toBe(date);
      expect(Number.isInteger(row.amountCents)).toBeTruthy();
    }
  });

  test('every starter description is offered for its kind and none for an advance', async ({
    page,
  }) => {
    const name = newName('Presets');
    await seedStaffMember(page, name);

    await gotoAdjustments(page);
    await openAddAdjustment(page);
    const presets = adjustmentDialog(page).locator('.adjustment-preset');

    // Allowance is the default kind — criterion 3.
    await expect(presets).toHaveText([...ALLOWANCE_PRESETS]);

    // Criterion 5.
    await fillAdjustmentDraft(page, { kind: 'Bonus' });
    await expect(presets).toHaveText([...BONUS_PRESETS]);

    // ADR 0014 §2: advances have no starter list, only free text.
    await fillAdjustmentDraft(page, { kind: 'Advance' });
    await expect(presets).toHaveCount(0);
    await expect(
      adjustmentDialog(page).getByText('No presets for advances. Type a description.'),
    ).toBeVisible();
  });

  test('a starter choice and the identical hand-typed description are stored byte-identically', async ({
    page,
  }) => {
    // ADR 0014 §2 — the server cannot and must not tell a preset apart from
    // typing the same words.
    const name = newName('Byte');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(11);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from: date, to: date });

    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Allowance',
      effectiveDate: date,
      amount: '250',
      preset: 'Calamity allowance',
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Allowance',
      effectiveDate: date,
      amount: '250',
      description: 'Calamity allowance',
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    const stored = readStoredAdjustmentsForStaff(member.id);
    expect(stored).toHaveLength(2);
    expect(stored[0]!.description).toBe('Calamity allowance');
    expect(stored[1]!.description).toBe(stored[0]!.description);
  });

  test('a custom description is kept exactly — case, internal spacing and non-ASCII survive, surrounding spaces do not', async ({
    page,
  }) => {
    // Criterion 6 / ADR 0014 §2: verbatim apart from trimming.
    const name = newName('Custom');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(12);
    const typed = '  Café  MERIENDA allowance — ñ  ';
    const expected = 'Café  MERIENDA allowance — ñ';

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from: date, to: date });

    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Allowance',
      effectiveDate: date,
      amount: '75.50',
      description: typed,
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    const stored = readStoredAdjustmentsForStaff(member.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.description).toBe(expected);

    // …and shown again unchanged when the item is viewed for editing.
    const row = adjustmentRow(page, name, expected);
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /^Edit / }).click();
    await expect(
      adjustmentDialog(page).locator('#adjustment-description'),
    ).toHaveValue(expected);
  });

  test('two identical adjustments on the same staff member and date both persist', async ({
    page,
  }) => {
    // ADR 0014 §1: no unique constraint, deliberately. This is the inverse of
    // the daily-entry duplicate 409 rule the #309 suite asserts — a conflict
    // notice here would be the bug.
    const name = newName('Twin');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(13);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from: date, to: date });

    for (const attempt of [1, 2]) {
      await openAddAdjustment(page);
      await fillAdjustmentDraft(page, {
        staffName: name,
        kind: 'Allowance',
        effectiveDate: date,
        amount: '200',
        preset: 'Transportation allowance',
      });
      await submitAdjustment(page, 'Add adjustment');
      await expect(
        adjustmentDialog(page),
        `attempt ${attempt} was refused`,
      ).toHaveCount(0);
    }

    await expect(adjustmentRows(page)).toHaveCount(2);
    const stored = readStoredAdjustmentsForStaff(member.id);
    expect(stored).toHaveLength(2);
    expect(stored[0]!.id).not.toBe(stored[1]!.id);
    for (const row of stored) {
      expect(row.amountCents).toBe(20000);
      expect(row.description).toBe('Transportation allowance');
    }

    // Each contributes separately to its category total.
    const payslip = await fetchPayslip(page, member.id, date, date);
    expect(payslip.allowanceTotalCents).toBe(40000);
  });

  test('a description that is blank or over 120 characters is refused, and 120 characters is accepted', async ({
    page,
  }) => {
    const name = newName('Desc');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(14);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from: date, to: date });
    await openAddAdjustment(page);
    await fillAdjustmentDraft(page, {
      staffName: name,
      kind: 'Bonus',
      effectiveDate: date,
      amount: '100',
      description: '     ',
    });
    await submitAdjustment(page, 'Add adjustment');
    await expect(fieldError(page, 'description')).toBeVisible();
    await expect(fieldError(page, 'description')).toContainText(/description/i);
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);

    await fillAdjustmentDraft(page, { description: 'B'.repeat(121) });
    await submitAdjustment(page, 'Add adjustment');
    await expect(fieldError(page, 'description')).toContainText('120');
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(0);

    const atLimit = 'B'.repeat(120);
    await fillAdjustmentDraft(page, { description: atLimit });
    await submitAdjustment(page, 'Add adjustment');
    await expect(adjustmentDialog(page)).toHaveCount(0);
    const stored = readStoredAdjustmentsForStaff(member.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.description).toBe(atLimit);
  });

  test('negative, zero, sub-centavo, missing and non-numeric amounts are all refused and nothing is saved', async ({
    page,
  }) => {
    // Criterion 7 / ADR 0014 §3: no coercion, no rounding, field-level message.
    const name = newName('Amount');
    const member = await seedStaffMember(page, name);
    const date = daysAgo(15);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from: date, to: date });

    for (const kind of ['Advance', 'Allowance', 'Bonus'] as const) {
      await openAddAdjustment(page);
      await fillAdjustmentDraft(page, {
        staffName: name,
        kind,
        effectiveDate: date,
        description: `${kind} amount check`,
      });

      for (const amount of ['-1', '0', '10.005', '', 'abc']) {
        await fillAdjustmentDraft(page, { amount });
        await submitAdjustment(page, 'Add adjustment');
        await expect(
          fieldError(page, 'amount'),
          `${kind} amount "${amount}" should be refused`,
        ).toBeVisible();
        await expect(adjustmentDialog(page)).toHaveCount(1);
        expect(
          countStoredAdjustmentsForStaff(member.id),
          `${kind} amount "${amount}" must not be saved`,
        ).toBe(0);
      }

      // The same dialog accepts the smallest legal amount, so the refusals
      // above cannot be a dialog that was simply broken.
      await fillAdjustmentDraft(page, { amount: '0.01' });
      await submitAdjustment(page, 'Add adjustment');
      await expect(adjustmentDialog(page)).toHaveCount(0);
      const stored = readStoredAdjustmentsForStaff(member.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.amountCents).toBe(1);

      // Reset for the next kind: this test owns every row for this member.
      const remove = await page.request.delete(
        `${API_BASE_URL}/compensation/adjustments/${stored[0]!.id}`,
      );
      expect(remove.ok(), await remove.text()).toBeTruthy();
    }
  });
});

// ---- AC 8-11: the payslip ---------------------------------------------------

test.describe('Payslips with adjustments (story #346)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('a payslip itemizes allowances and bonuses, shows advances separately, and totals to earnings less advances', async ({
    page,
  }) => {
    // Criteria 8, 9 and 10 in one generated payslip.
    const name = newName('Slip');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(20);
    const to = daysAgo(16);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(19),
      salaryCents: 123456,
      commissionCents: 7,
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: daysAgo(18),
      amountCents: 20000,
      description: 'Transportation allowance',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'BONUS',
      effectiveDate: daysAgo(17),
      amountCents: 50000,
      description: 'Kapé month bonus',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ADVANCE',
      effectiveDate: daysAgo(16),
      amountCents: 30000,
      description: 'Payday advance',
    });

    const salary = 123456;
    const commission = 7;
    const allowance = 20000;
    const bonus = 50000;
    const advance = 30000;
    const earnings = salary + commission + allowance + bonus;

    // The API contract first: ADR 0014 §3 keeps `grandTotalCents` meaning
    // salary + commission only. A regression there would be invisible on screen.
    const summary = await fetchPayslip(page, member.id, from, to);
    expect(summary.salaryTotalCents).toBe(salary);
    expect(summary.commissionTotalCents).toBe(commission);
    expect(summary.allowanceTotalCents).toBe(allowance);
    expect(summary.bonusTotalCents).toBe(bonus);
    expect(summary.advanceTotalCents).toBe(advance);
    expect(summary.grandTotalCents).toBe(salary + commission);
    expect(summary.earningsTotalCents).toBe(earnings);
    expect(summary.netPayableCents).toBe(earnings - advance);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipArtifact(page)).toBeVisible();

    // Criterion 9: every allowance and bonus is identified by its description.
    await expect(earningsRows(page)).toHaveCount(4);
    await expect(earningsRows(page).nth(0)).toContainText('Salary');
    await expect(earningsRows(page).nth(0)).toContainText(peso(salary));
    await expect(earningsRows(page).nth(1)).toContainText('Commission');
    await expect(earningsRows(page).nth(2)).toContainText(
      'Transportation allowance',
    );
    await expect(earningsRows(page).nth(2)).toContainText(peso(allowance));
    await expect(earningsRows(page).nth(3)).toContainText('Kapé month bonus');
    await expect(earningsRows(page).nth(3)).toContainText(peso(bonus));

    // Criterion 10: advances are shown apart from earnings, never inside them.
    await expect(
      payslipArtifact(page).locator(
        '.payslip-artifact-table:not(.payslip-advance-table)',
      ),
    ).not.toContainText('Payday advance');
    await expect(advanceRows(page)).toHaveCount(1);
    await expect(advanceRows(page).nth(0)).toContainText('Payday advance');
    await expect(advanceRows(page).nth(0)).toContainText(peso(advance));

    await expect(payslipTotal(page, 'Salary total')).toHaveText(peso(salary));
    await expect(payslipTotal(page, 'Commission total')).toHaveText(
      peso(commission),
    );
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(
      peso(allowance),
    );
    await expect(payslipTotal(page, 'Bonus total')).toHaveText(peso(bonus));
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(
      peso(earnings),
    );
    await expect(payslipTotal(page, 'Advance total')).toHaveText(
      negatedPeso(advance),
    );
    await expect(payslipNet(page)).toHaveText(peso(earnings - advance));
  });

  test('inclusive range boundaries include items dated exactly on either end and exclude the day outside', async ({
    page,
  }) => {
    const name = newName('Bounds');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(25);
    const to = daysAgo(21);

    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: from,
      amountCents: 100,
      description: 'On the from boundary',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: to,
      amountCents: 200,
      description: 'On the to boundary',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: isoShift(from, -1),
      amountCents: 400,
      description: 'One day before the range',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: isoShift(to, 1),
      amountCents: 800,
      description: 'One day after the range',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipArtifact(page)).toBeVisible();

    await expect(earningsRows(page)).toHaveCount(2);
    await expect(payslipArtifact(page)).toContainText('On the from boundary');
    await expect(payslipArtifact(page)).toContainText('On the to boundary');
    await expect(payslipArtifact(page)).not.toContainText(
      'One day before the range',
    );
    await expect(payslipArtifact(page)).not.toContainText(
      'One day after the range',
    );
    // 300, not 700 or 1500 — the sum is the assertion that no boundary leaked.
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(300));
    await expect(payslipNet(page)).toHaveText(peso(300));
  });

  test('advances beyond earnings produce a negative net payable that is never clamped, and the subtraction moves with the advance', async ({
    page,
  }) => {
    // ADR 0014 §3. The second half is the mutation test: without it, a net that
    // merely *looks* right proves nothing about the subtraction.
    const name = newName('Negative');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(30);
    const to = daysAgo(26);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(29),
      salaryCents: 50000,
      commissionCents: 0,
    });
    const advance = await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ADVANCE',
      effectiveDate: daysAgo(28),
      amountCents: 175025,
      description: 'Emergency advance',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipArtifact(page)).toBeVisible();

    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(50000));
    await expect(payslipNet(page)).toHaveText(peso(-125025));
    await expect(page.locator('.payslip-net')).toHaveClass(/negative/);
    // Not clamped, not hidden, not restated as a balance owed.
    await expect(payslipNet(page)).not.toHaveText(peso(0));

    const before = await fetchPayslip(page, member.id, from, to);
    expect(before.netPayableCents).toBe(-125025);

    // Mutate one input by a known delta; the net must move by exactly that much
    // and the earnings must not move at all.
    const patch = await page.request.patch(
      `${API_BASE_URL}/compensation/adjustments/${advance.id}`,
      {
        data: {
          effectiveDate: advance.effectiveDate,
          amountCents: 175025 - 10000,
          description: advance.description,
        },
      },
    );
    expect(patch.ok(), await patch.text()).toBeTruthy();

    const after = await fetchPayslip(page, member.id, from, to);
    expect(after.earningsTotalCents).toBe(before.earningsTotalCents);
    expect(after.netPayableCents - before.netPayableCents).toBe(10000);

    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipNet(page)).toHaveText(peso(-115025));
  });

  test('a range holding only adjustments and no daily records still produces a downloadable payslip', async ({
    page,
  }) => {
    const name = newName('OnlyAdj');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(35);
    const to = daysAgo(31);

    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'BONUS',
      effectiveDate: daysAgo(33),
      amountCents: 99999,
      description: 'Spot bonus',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(page.locator('.payslip-empty')).toHaveCount(0);
    await expect(payslipArtifact(page)).toBeVisible();
    await expect(payslipArtifact(page)).toContainText('Spot bonus');
    await expect(payslipTotal(page, 'Salary total')).toHaveText(peso(0));
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(99999));
    await expect(payslipNet(page)).toHaveText(peso(99999));
    await expect(downloadButton(page)).toBeVisible();
  });

  test('a range with no records at all shows the empty result and offers no download', async ({
    page,
  }) => {
    // ADR 0014 §5: the empty case must not offer a PNG of an empty payslip.
    const name = newName('Empty');
    await seedStaffMember(page, name);
    const from = daysAgo(40);
    const to = daysAgo(36);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(page.locator('.payslip-empty')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'No records in this range' }),
    ).toBeVisible();
    await expect(payslipArtifact(page)).toHaveCount(0);
    await expect(downloadButton(page)).toHaveCount(0);
  });

  test('a newly generated payslip reflects an edited and a deleted adjustment', async ({
    page,
  }) => {
    // Criterion 11, driven entirely through the admin screens.
    const name = newName('Restate');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(45);
    const to = daysAgo(41);
    const date = daysAgo(43);

    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: date,
      amountCents: 10000,
      description: 'Load allowance',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'BONUS',
      effectiveDate: date,
      amountCents: 25000,
      description: 'Spot bonus',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(35000));

    // Edit the allowance: new amount and a new description.
    await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
    await applyAdjustmentFilters(page, { staffName: name, from, to });
    await adjustmentRow(page, name, 'Load allowance')
      .getByRole('button', { name: /^Edit / })
      .click();
    await fillAdjustmentDraft(page, {
      amount: '150.25',
      description: 'Load allowance (revised)',
    });
    await submitAdjustment(page, 'Save changes');
    await expect(adjustmentDialog(page)).toHaveCount(0);

    // Delete the bonus outright — ADR 0014 §4, hard delete, no undo.
    await adjustmentRow(page, name, 'Spot bonus')
      .getByRole('button', { name: /^Delete / })
      .click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(adjustmentRow(page, name, 'Spot bonus')).toHaveCount(0);
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(1);

    await page.getByRole('button', { name: 'Payslips', exact: true }).click();
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipArtifact(page)).toContainText(
      'Load allowance (revised)',
    );
    await expect(payslipArtifact(page)).not.toContainText('Spot bonus');
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(15025));
    await expect(payslipTotal(page, 'Bonus total')).toHaveText(peso(0));
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(15025));
    await expect(payslipNet(page)).toHaveText(peso(15025));
  });
});

// ---- AC 12-13: the PNG download ---------------------------------------------

/**
 * ADR 0014 §5 accepts that client-side rasterization is fidelity-sensitive, so
 * these tests assert on **content**, not pixel equality:
 *
 * - the saved file is a real PNG (8-byte signature) with IHDR dimensions that
 *   match the rasterized node at its `pixelRatio: 2` scale, so a truncated or
 *   partial capture cannot pass;
 * - the image carries ink — it is decoded **at its native size** and its
 *   non-white pixels counted. Per `e2e-canvas-image-compare-resampling`,
 *   drawing it onto a smaller canvas would measure Chromium's downscaler
 *   instead of the artwork;
 * - every mandatory string (name, inclusive range, each item description and
 *   amount, every total including net payable, and the "Generated <timestamp>"
 *   line) is asserted on `#payslip-capture-node` — the exact DOM subtree that
 *   was rasterized — because no OCR is available in this suite and the export
 *   path *is* the screen.
 */
interface PngFacts {
  width: number;
  height: number;
  darkRatio: number;
}

function readPngHeader(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(
    bytes.subarray(0, 8).equals(signature),
    'the downloaded file is not a PNG',
  ).toBeTruthy();
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Decode the PNG at native size in the browser and measure how much ink it has. */
async function measurePng(page: Page, bytes: Buffer): Promise<PngFacts> {
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  return page.evaluate(async (source) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('the PNG could not be decoded'));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index]! < 200 || data[index + 1]! < 200 || data[index + 2]! < 200) {
        dark += 1;
      }
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      darkRatio: dark / (data.length / 4),
    };
  }, dataUrl);
}

test.describe('Payslip PNG download (story #346)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('a generated payslip downloads as a named PNG whose picture matches the payslip it was taken from', async ({
    page,
  }) => {
    const name = newName('Png');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(50);
    const to = daysAgo(46);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(49),
      salaryCents: 123456,
      commissionCents: 7,
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: daysAgo(48),
      amountCents: 20000,
      description: 'Calamity allowance',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ADVANCE',
      effectiveDate: daysAgo(47),
      amountCents: 30000,
      description: 'Payday advance',
    });
    const earnings = 123456 + 7 + 20000;

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    const artifact = payslipArtifact(page);
    await expect(artifact).toBeVisible();

    // Criterion 13, on the exact node that gets rasterized.
    await expect(artifact).toContainText(name);
    await expect(artifact).toContainText(
      `Inclusive range: ${longDate(from)} to ${longDate(to)}`,
    );
    await expect(artifact).toContainText('Calamity allowance');
    await expect(artifact).toContainText(peso(20000));
    await expect(artifact).toContainText('Payday advance');
    await expect(artifact).toContainText(peso(30000));
    await expect(artifact).toContainText(peso(earnings));
    await expect(payslipNet(page)).toHaveText(peso(earnings - 30000));
    // ADR 0014 §4 makes the generation timestamp a hard requirement.
    await expect(page.locator('.payslip-generated-line')).toHaveText(
      /^Generated .*\d{4}.*(AM|PM)$/,
    );

    const size = await artifact.evaluate((node: HTMLElement) => ({
      width: node.offsetWidth,
      height: node.offsetHeight,
    }));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton(page).click(),
    ]);

    // Criterion 12 + ADR 0014 §5's deterministic filename.
    expect(download.suggestedFilename()).toBe(
      `payslip-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}-${to}.png`,
    );

    const saved = join(tmpdir(), `qa358-${RUN}-${download.suggestedFilename()}`);
    await download.saveAs(saved);
    const bytes = readFileSync(saved);
    const header = readPngHeader(bytes);
    const facts = await measurePng(page, bytes);

    expect(facts.width).toBe(header.width);
    expect(facts.height).toBe(header.height);
    // `pixelRatio: 2`, so the picture is twice the node it was taken from. A
    // clipped or empty capture fails here rather than passing quietly.
    expect(Math.abs(header.width - size.width * 2)).toBeLessThanOrEqual(4);
    expect(Math.abs(header.height - size.height * 2)).toBeLessThanOrEqual(4);
    expect(
      facts.darkRatio,
      'the PNG is blank — no payslip content was rasterized',
    ).toBeGreaterThan(0.005);

    await expect(
      page.locator('.payslip-download-status'),
    ).toContainText(download.suggestedFilename());

    // The download control itself is excluded from the picture (ADR 0014 §5's
    // export filter) — the artifact must not advertise its own button.
    await expect(
      artifact.locator('[data-payslip-export-exclude="true"]'),
    ).toHaveCount(1);
  });

  test('a negative net payable is carried into the downloaded PNG', async ({
    page,
  }) => {
    const name = newName('PngNeg');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(55);
    const to = daysAgo(51);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(54),
      salaryCents: 10000,
      commissionCents: 0,
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ADVANCE',
      effectiveDate: daysAgo(53),
      amountCents: 45000,
      description: 'Advance beyond earnings',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipNet(page)).toHaveText(peso(-35000));
    await expect(payslipArtifact(page)).toContainText(peso(-35000));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton(page).click(),
    ]);
    const saved = join(tmpdir(), `qa358-${RUN}-negative.png`);
    await download.saveAs(saved);
    const bytes = readFileSync(saved);
    readPngHeader(bytes);
    const facts = await measurePng(page, bytes);
    expect(facts.darkRatio).toBeGreaterThan(0.005);

    // The negative figure is still on the rasterized node after the export, so
    // the picture that was just taken carries it.
    await expect(payslipArtifact(page)).toContainText(peso(-35000));
  });
});

// ---- AC 14: authorization ---------------------------------------------------

test.describe('Staff users and compensation information (story #346)', () => {
  test('the API refuses every adjustment and payslip operation for a staff session', async ({
    page,
  }) => {
    // ADR 0014 §6: the API is the boundary, not the hidden nav entry. A STAFF
    // token must be refused per verb. `/auth/login` 401s for staff — the staff
    // route needs a deviceId (see `e2e-staff-session-for-authz-tests`).
    await page.goto('/staff/sign-in');
    const login = await page.request.post(`${API_BASE_URL}/auth/staff/login`, {
      data: {
        username: STAFF_USERNAME,
        password: STAFF_PASSWORD,
        deviceId: `qa358-${RUN}`,
      },
    });
    expect(login.ok(), await login.text()).toBeTruthy();

    const someUuid = '00000000-0000-4000-8000-000000000000';
    const responses = [
      await page.request.get(`${API_BASE_URL}/compensation/adjustments`),
      await page.request.get(
        `${API_BASE_URL}/compensation/payslip?staffMemberId=${someUuid}&from=${daysAgo(7)}&to=${TODAY}`,
      ),
      await page.request.post(`${API_BASE_URL}/compensation/adjustments`, {
        data: {
          staffMemberId: someUuid,
          kind: 'ALLOWANCE',
          effectiveDate: daysAgo(1),
          amountCents: 100,
          description: 'Should never be stored',
        },
      }),
      await page.request.patch(
        `${API_BASE_URL}/compensation/adjustments/${someUuid}`,
        {
          data: {
            effectiveDate: daysAgo(1),
            amountCents: 100,
            description: 'Should never be stored',
          },
        },
      ),
      await page.request.delete(
        `${API_BASE_URL}/compensation/adjustments/${someUuid}`,
      ),
    ];

    for (const response of responses) {
      expect(
        response.status(),
        `${response.url()} should be forbidden for a staff session`,
      ).toBe(403);
    }
  });

  test('a staff user reaching the compensation route directly sees no adjustments and no payslip to download', async ({
    page,
  }) => {
    await page.goto('/staff/sign-in');
    await page
      .getByRole('button', { name: 'Use Username and Password' })
      .click();
    await expect(page.locator('#staff-username')).toBeVisible();
    // The username field takes focus in a rAF; filling the password before that
    // lands re-routes the keystrokes into the username box.
    await expect(page.locator('#staff-username')).toBeFocused();
    await page.locator('#staff-username').fill(STAFF_USERNAME);
    await page.locator('#staff-password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/pos(\/order)?$/);

    await page.goto('/compensation');
    await expect(page).not.toHaveURL(/\/compensation$/);
    await expect(page.locator('.adjustment-table')).toHaveCount(0);
    await expect(payslipArtifact(page)).toHaveCount(0);
    // The PNG has no endpoint of its own (ADR 0014 §5); never reaching a
    // rendered payslip is exactly what makes it unreachable.
    await expect(downloadButton(page)).toHaveCount(0);
  });
});
