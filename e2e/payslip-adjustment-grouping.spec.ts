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
import { isoShift, longDate, shopToday, shortDate } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #412 — "Group payslip allowances, bonuses, and
 * advances by description" (QA task #456).
 *
 * This is a sibling of `compensation-adjustments-payslip-export.spec.ts`
 * (story #346) rather than an extension of it. #412 deliberately REPLACES
 * #346's "a generated payslip itemizes every in-range allowance and bonus"
 * criterion for display purposes, so the two files assert different things
 * about the same table and keeping them apart keeps that handover legible.
 * Everything runs through the real browser → web app → NestJS API →
 * PostgreSQL path as the seeded `admin` (ADMIN) user.
 *
 * Conventions, inherited from the #346 suite:
 *
 * - **Every test owns its roster members.** A payslip is scoped to one member,
 *   so a freshly tagged member per test makes the artifact contain that test's
 *   rows and nothing else. The roster has no delete surface (ADR 0003) and both
 *   compensation tables are `ON DELETE RESTRICT` on the member, so teardown
 *   deletes the adjustments and entries and leaves the tagged members behind.
 * - **Money is computed in integer cents**, and `peso()` formats expectations
 *   from cents with its own grouping so a float bug in the product cannot be
 *   mirrored into the expectation.
 * - **Adjustments are created through the real API, never straight into the
 *   table.** Per `e2e-seeded-sale-lines-hide-snapshot-bugs`, column defaults
 *   must not stand in for values the product computes — and `createdAt` is a
 *   grouping tie-breaker here, so the order the rows were really recorded in
 *   has to be the order the HTTP calls went out in.
 * - **Derived arithmetic is mutation-tested.** A totals assertion only proves
 *   something if changing an input provably moves the output, so the totals
 *   test edits one item inside a group and asserts both the group line and
 *   every total move by exactly the delta.
 *
 * Two decisions that look like bugs if you do not know them, and are asserted
 * here as correct behaviour:
 *
 * - **Internal whitespace is significant.** `Load allowance` and
 *   `Load  allowance` (two spaces) are different groups. Only LEADING and
 *   TRAILING whitespace is removed, and that happens at record/edit time
 *   (ADR 0014 §2), not at grouping time.
 * - **Duplicates still persist.** `staff_compensation_adjustments` has no
 *   unique constraint (ADR 0014 §1). Grouping is a display concern only; two
 *   identical allowances remain two rows in the table.
 *
 * The date treatment asserted below comes from the Design Reference for #412
 * (`docs/design/mockups/issue-412/DESIGN.md`): a metadata span of
 * `kind · item count (only when >1) · one date entry per item, ascending`,
 * short dates for multi-item groups, the shipped long date for singletons, and
 * long dates throughout when the payslip range crosses a calendar year.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// Same host the web app itself calls: the session cookie is host-scoped, so the
// request-context calls below only carry it when they hit the same origin.
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-test tag that is also a unique, selectable display name. */
function newName(label: string): string {
  seq += 1;
  return `QA456 ${label} ${RUN}-${seq}`;
}

const TODAY = shopToday();
/** `n` whole days before the current shop date. Always a legal effective date. */
const daysAgo = (n: number) => isoShift(TODAY, -n);

/** Roster members created by this file; their rows are cleaned up at the end. */
const seededStaffIds: string[] = [];

type AdjustmentKind = 'ADVANCE' | 'ALLOWANCE' | 'BONUS';

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
}

interface AdjustmentPayload {
  id: string;
  staffMemberId: string;
  kind: AdjustmentKind;
  effectiveDate: string;
  amountCents: number;
  description: string;
}

interface AdjustmentGroupPayload {
  kind: AdjustmentKind;
  description: string;
  totalCents: number;
  effectiveDates: string[];
  itemCount: number;
  adjustmentIds: string[];
}

interface PayslipPayload {
  staffMember: { id: string; displayName: string };
  from: string;
  to: string;
  entries: { id: string; workDate: string }[];
  adjustments: AdjustmentPayload[];
  adjustmentGroups: AdjustmentGroupPayload[];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `-₱1.00` / `−₱1.00` — the deduction prefix is a typographic minus in the UI. */
function negatedPeso(totalCents: number): RegExp {
  return new RegExp(`^[-−]${escapeRegExp(peso(totalCents))}$`);
}

// ---- expected grouped-line text --------------------------------------------

function crossesCalendarYear(from: string, to: string): boolean {
  return from.slice(0, 4) !== to.slice(0, 4);
}

/**
 * The date list a grouped line is expected to show: one entry per item, in the
 * order given, short for a multi-item group and long for a singleton or when
 * the payslip range crosses a calendar year. Derived from the range rather than
 * hard-coded so the expectations hold whenever in the year the suite runs — the
 * cross-year treatment itself is pinned by its own test below.
 */
function groupDateList(dates: string[], from: string, to: string): string {
  const useLong = dates.length === 1 || crossesCalendarYear(from, to);
  return dates.map((date) => (useLong ? longDate(date) : shortDate(date))).join(', ');
}

/** The expected metadata span under an earnings (allowance/bonus) group line. */
function earningsMetadata(
  kind: 'Allowance' | 'Bonus',
  dates: string[],
  from: string,
  to: string,
): string {
  const list = groupDateList(dates, from, to);
  return dates.length === 1
    ? `${kind}, ${list}`
    : `${kind} · ${dates.length} items · ${list}`;
}

/** The expected metadata span under a salary-advance group line. */
function advanceMetadata(dates: string[], from: string, to: string): string {
  const list = groupDateList(dates, from, to);
  return dates.length === 1 ? list : `${dates.length} items · ${list}`;
}

// ---- setup helpers ----------------------------------------------------------

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

async function seedAdjustment(
  page: Page,
  input: {
    staffMemberId: string;
    kind: AdjustmentKind;
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

/**
 * Seed adjustments ONE AT A TIME, in order. `createdAt` breaks two of this
 * story's ties (which description a same-date group shows, and how two groups
 * with the same earliest date are ordered), so these must not be fired in
 * parallel — `Promise.all` would make the recorded order non-deterministic and
 * the tie-break tests would pass or fail by luck.
 */
async function seedAdjustmentsInOrder(
  page: Page,
  inputs: {
    staffMemberId: string;
    kind: AdjustmentKind;
    effectiveDate: string;
    amountCents: number;
    description: string;
  }[],
): Promise<AdjustmentPayload[]> {
  const created: AdjustmentPayload[] = [];
  for (const input of inputs) {
    created.push(await seedAdjustment(page, input));
  }
  return created;
}

async function patchAdjustment(
  page: Page,
  id: string,
  input: { effectiveDate: string; amountCents: number; description: string },
): Promise<void> {
  const response = await page.request.patch(
    `${API_BASE_URL}/compensation/adjustments/${id}`,
    { data: input },
  );
  expect(
    response.ok(),
    `editing adjustment ${id} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
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

async function generatePayslip(
  page: Page,
  options: { staffName: string; from: string; to: string },
): Promise<void> {
  const form = page.locator('.payslip-filter form');
  const staffSelect = form.locator('select');
  // The view preselects the first selectable member from an effect that runs
  // once the roster request resolves. Choosing before that effect lands lets it
  // overwrite the choice with the first member, and the payslip is then
  // generated for the wrong person (`e2e-payslip-default-staff-selection-race`).
  // Wait for the default to arrive first, and assert afterwards that the choice
  // actually stuck.
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

/** The metadata `<span>` under a payslip line's description. */
const lineMetadata = (row: Locator) => row.locator('td').first().locator('span');
/** The amount cell of a payslip line. */
const lineAmount = (row: Locator) => row.locator('td').nth(1);

/**
 * The line's description EXACTLY as rendered — the text nodes of the first
 * cell, with the metadata `<span>` left out and no whitespace normalisation.
 * `toHaveText` collapses runs of spaces, which would quietly erase the
 * difference between `Load allowance` and `Load  allowance`; this is the only
 * way to see it from the DOM.
 */
function lineDescription(row: Locator): Promise<string> {
  return row.locator('td').first().evaluate((node: HTMLElement) =>
    Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? '')
      .join(''),
  );
}

// ---- adjustment-screen page objects (for the AC 8 regression) ---------------

const adjustmentFilters = (page: Page) =>
  page.locator('form[aria-label="Filter compensation adjustments"]');

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

async function fillAdjustmentDraft(
  page: Page,
  values: {
    staffName?: string;
    kind?: 'Advance' | 'Allowance' | 'Bonus';
    effectiveDate?: string;
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
    await dialog.getByRole('button', { name: values.kind, exact: true }).click();
  }
  if (values.effectiveDate !== undefined) {
    await dialog.locator('#adjustment-effectiveDate').fill(values.effectiveDate);
  }
  if (values.amount !== undefined) {
    await dialog.locator('#adjustment-amount').fill(values.amount);
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

test.afterAll(() => {
  deleteStoredAdjustmentsForStaff(seededStaffIds);
  deleteStoredEntriesForStaff(seededStaffIds);
});

// ---- AC 1, 3, 4, 5: the grouped line ---------------------------------------

test.describe('Grouped payslip lines (story #412)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('allowances and bonuses that share a description collapse into one line each, a lone description keeps its own line, and both groups carry a date per item', async ({
    page,
  }) => {
    // Criteria 1, 3, 4 and 5 together, plus the "two items on one date" edge
    // case: the repeated date must still be printed twice.
    const name = newName('Collapse');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(70);
    const to = daysAgo(60);

    await seedAdjustmentsInOrder(page, [
      // The group of three. Mixed casing and a trailing space, which is removed
      // at record time (ADR 0014 §2) — so these are one group, and the shown
      // description is the EARLIEST-DATED item's, verbatim.
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(68),
        amountCents: 10000,
        description: 'Load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(66),
        amountCents: 2500,
        description: 'LOAD ALLOWANCE',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(66),
        amountCents: 700,
        description: 'load allowance ',
      },
      // A separate kind with its own repeated description — bonuses group
      // independently of allowances.
      {
        staffMemberId: member.id,
        kind: 'BONUS',
        effectiveDate: daysAgo(67),
        amountCents: 50000,
        description: 'Performance bonus',
      },
      {
        staffMemberId: member.id,
        kind: 'BONUS',
        effectiveDate: daysAgo(65),
        amountCents: 1,
        description: 'performance bonus',
      },
      // Criterion 5: a description that appears once.
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(64),
        amountCents: 333,
        description: 'Calamity allowance',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    await expect(payslipArtifact(page)).toBeVisible();

    // Six items became three lines. No daily entries were seeded, so the
    // salary and commission rows are absent and every row here is a group.
    await expect(earningsRows(page)).toHaveCount(3);

    // Ordered by each group's earliest effective date: 68 days ago, then 67,
    // then 64.
    const load = earningsRows(page).nth(0);
    const bonus = earningsRows(page).nth(1);
    const calamity = earningsRows(page).nth(2);

    // Criterion 3: the description as written on the earliest-dated item —
    // `Load allowance`, not the uppercase variant and not the first created.
    expect(await lineDescription(load)).toBe('Load allowance');
    await expect(lineAmount(load)).toHaveText(peso(10000 + 2500 + 700));
    // Criterion 4: one date entry per item, ascending, and `daysAgo(66)`
    // printed TWICE because two items fall on it.
    await expect(lineMetadata(load)).toHaveText(
      earningsMetadata(
        'Allowance',
        [daysAgo(68), daysAgo(66), daysAgo(66)],
        from,
        to,
      ),
    );

    expect(await lineDescription(bonus)).toBe('Performance bonus');
    await expect(lineAmount(bonus)).toHaveText(peso(50001));
    await expect(lineMetadata(bonus)).toHaveText(
      earningsMetadata('Bonus', [daysAgo(67), daysAgo(65)], from, to),
    );

    // Criterion 5: a group of one reads exactly as a single item does today —
    // the long date, and no item count.
    expect(await lineDescription(calamity)).toBe('Calamity allowance');
    await expect(lineAmount(calamity)).toHaveText(peso(333));
    await expect(lineMetadata(calamity)).toHaveText(
      earningsMetadata('Allowance', [daysAgo(64)], from, to),
    );
    await expect(lineMetadata(calamity)).not.toContainText('items');

    // The individual amounts inside a group are no longer lines of their own.
    await expect(payslipArtifact(page)).not.toContainText(peso(2500));
    await expect(payslipArtifact(page)).not.toContainText(peso(700));

    // Criterion 6: the totals are the sum of the six ITEMS, not of the lines.
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(
      peso(10000 + 2500 + 700 + 333),
    );
    await expect(payslipTotal(page, 'Bonus total')).toHaveText(peso(50001));
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(63534));
    await expect(payslipNet(page)).toHaveText(peso(63534));

    // The table still holds six rows — grouping is display only (ADR 0014 §1).
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(6);
    expect(
      readStoredAdjustmentsForStaff(member.id).map((row) => row.description),
    ).toEqual([
      'Load allowance',
      'Performance bonus',
      'LOAD ALLOWANCE',
      'load allowance',
      'performance bonus',
      'Calamity allowance',
    ]);
  });

  test('salary advances that share a description collapse into one deduction line', async ({
    page,
  }) => {
    // Criterion 1 for the third kind, in the deductions table.
    const name = newName('Advances');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(90);
    const to = daysAgo(80);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(88),
      salaryCents: 200000,
      commissionCents: 0,
    });
    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(87),
        amountCents: 50000,
        description: 'Payday advance',
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(85),
        amountCents: 2500,
        description: 'PAYDAY ADVANCE',
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(83),
        amountCents: 7,
        description: 'Emergency advance',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(advanceRows(page)).toHaveCount(2);
    const payday = advanceRows(page).nth(0);
    const emergency = advanceRows(page).nth(1);

    expect(await lineDescription(payday)).toBe('Payday advance');
    await expect(lineAmount(payday)).toHaveText(negatedPeso(52500));
    // The advance line carries no kind label — the table is already headed
    // "Salary advance" — so the metadata is count + dates only.
    await expect(lineMetadata(payday)).toHaveText(
      advanceMetadata([daysAgo(87), daysAgo(85)], from, to),
    );

    expect(await lineDescription(emergency)).toBe('Emergency advance');
    await expect(lineAmount(emergency)).toHaveText(negatedPeso(7));
    await expect(lineMetadata(emergency)).toHaveText(
      advanceMetadata([daysAgo(83)], from, to),
    );

    // Criterion 6 across the deduction side.
    await expect(payslipTotal(page, 'Advance total')).toHaveText(
      negatedPeso(50000 + 2500 + 7),
    );
    await expect(payslipNet(page)).toHaveText(peso(200000 - 52507));
  });

  test('two kinds sharing one description stay two lines, one in earnings and one in deductions', async ({
    page,
  }) => {
    // The cross-kind collision edge case. Grouping keys on kind as well as
    // description, so an identical label can never merge across kinds.
    const name = newName('CrossKind');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(110);
    const to = daysAgo(100);
    const label = 'Rice subsidy';

    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(108),
        amountCents: 10000,
        description: label,
      },
      {
        staffMemberId: member.id,
        kind: 'BONUS',
        effectiveDate: daysAgo(106),
        amountCents: 20000,
        description: label.toUpperCase(),
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(104),
        amountCents: 3000,
        description: label.toLowerCase(),
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    // Two earnings lines with the same words, told apart by the kind label.
    await expect(earningsRows(page)).toHaveCount(2);
    await expect(lineMetadata(earningsRows(page).nth(0))).toHaveText(
      earningsMetadata('Allowance', [daysAgo(108)], from, to),
    );
    await expect(lineAmount(earningsRows(page).nth(0))).toHaveText(peso(10000));
    await expect(lineMetadata(earningsRows(page).nth(1))).toHaveText(
      earningsMetadata('Bonus', [daysAgo(106)], from, to),
    );
    await expect(lineAmount(earningsRows(page).nth(1))).toHaveText(peso(20000));

    // And one deduction line, never folded into either of them.
    await expect(advanceRows(page)).toHaveCount(1);
    await expect(lineAmount(advanceRows(page).nth(0))).toHaveText(
      negatedPeso(3000),
    );

    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(10000));
    await expect(payslipTotal(page, 'Bonus total')).toHaveText(peso(20000));
    await expect(payslipTotal(page, 'Advance total')).toHaveText(
      negatedPeso(3000),
    );
    await expect(payslipNet(page)).toHaveText(peso(30000 - 3000));
  });

  test('internal whitespace splits a group even though leading and trailing whitespace does not', async ({
    page,
  }) => {
    // Edge case asserted as a NEGATIVE on purpose. The story normalises case
    // and the ends of the string only; a test that merged `Load  allowance`
    // into `Load allowance` would enshrine behaviour nobody asked for.
    const name = newName('Whitespace');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(130);
    const to = daysAgo(120);

    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(128),
        amountCents: 10000,
        description: ' Load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(126),
        amountCents: 10000,
        description: 'Load allowance  ',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(124),
        amountCents: 555,
        description: 'Load  allowance',
      },
    ]);

    // Leading/trailing whitespace is gone from the stored rows; the two-space
    // description is stored exactly as typed.
    expect(
      readStoredAdjustmentsForStaff(member.id).map((row) => row.description),
    ).toEqual(['Load allowance', 'Load allowance', 'Load  allowance']);

    const payslip = await fetchPayslip(page, member.id, from, to);
    expect(payslip.adjustmentGroups.map((group) => group.itemCount)).toEqual([
      2, 1,
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(earningsRows(page)).toHaveCount(2);
    const trimmed = earningsRows(page).nth(0);
    const doubleSpaced = earningsRows(page).nth(1);

    expect(await lineDescription(trimmed)).toBe('Load allowance');
    await expect(lineAmount(trimmed)).toHaveText(peso(20000));
    await expect(lineMetadata(trimmed)).toContainText('2 items');

    // The second line is its own group of one, rendered verbatim with both
    // spaces intact.
    expect(await lineDescription(doubleSpaced)).toBe('Load  allowance');
    await expect(lineAmount(doubleSpaced)).toHaveText(peso(555));
    await expect(lineMetadata(doubleSpaced)).toHaveText(
      earningsMetadata('Allowance', [daysAgo(124)], from, to),
    );

    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(20555));
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(peso(20555));
  });

  test('when a group has two items on its earliest date, the earliest-recorded description is shown', async ({
    page,
  }) => {
    // Criterion 3's tie-break. Recording order decides, so the lowercase item
    // created FIRST wins over the uppercase one created second on the same day,
    // and the group ordering tie is broken the same way.
    const name = newName('Tie');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(150);
    const to = daysAgo(140);
    const sharedDate = daysAgo(148);

    await seedAdjustmentsInOrder(page, [
      // Group B's first item is recorded before group A's, and both groups'
      // earliest effective date is the same day — so B's line comes first.
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: sharedDate,
        amountCents: 1000,
        description: 'beta allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: sharedDate,
        amountCents: 2000,
        description: 'Alpha allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: sharedDate,
        amountCents: 300,
        description: 'BETA ALLOWANCE',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(146),
        amountCents: 400,
        description: 'ALPHA ALLOWANCE',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(earningsRows(page)).toHaveCount(2);
    const beta = earningsRows(page).nth(0);
    const alpha = earningsRows(page).nth(1);

    // Earliest-recorded wins the description, and the ordering is by recording
    // order — not alphabetical, which would have put Alpha first.
    expect(await lineDescription(beta)).toBe('beta allowance');
    expect(await lineDescription(alpha)).toBe('Alpha allowance');
    await expect(lineAmount(beta)).toHaveText(peso(1300));
    await expect(lineAmount(alpha)).toHaveText(peso(2400));
    await expect(lineMetadata(beta)).toHaveText(
      earningsMetadata('Allowance', [sharedDate, sharedDate], from, to),
    );
    await expect(lineMetadata(alpha)).toHaveText(
      earningsMetadata('Allowance', [sharedDate, daysAgo(146)], from, to),
    );
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(3700));
  });

  test('the shown description comes from the earliest effective date, not from the first item recorded', async ({
    page,
  }) => {
    // Separates the two rules that the tie-break test holds constant: here the
    // dates differ, and the LATER-recorded item is the earlier-dated one.
    const name = newName('Earliest');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(170);
    const to = daysAgo(160);

    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(164),
        amountCents: 100,
        description: 'LOAD ALLOWANCE',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(168),
        amountCents: 200,
        description: 'Load allowance',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(earningsRows(page)).toHaveCount(1);
    expect(await lineDescription(earningsRows(page).nth(0))).toBe(
      'Load allowance',
    );
    await expect(lineMetadata(earningsRows(page).nth(0))).toHaveText(
      earningsMetadata('Allowance', [daysAgo(168), daysAgo(164)], from, to),
    );
    await expect(lineAmount(earningsRows(page).nth(0))).toHaveText(peso(300));
  });

  test('a group never reaches past the payslip range or across staff members', async ({
    page,
  }) => {
    // Two edge cases in one fixture, because both are about what must NOT join
    // a group: an identically described item one day outside the range, and one
    // belonging to somebody else.
    const name = newName('Scoped');
    const other = newName('ScopedOther');
    const member = await seedStaffMember(page, name);
    const otherMember = await seedStaffMember(page, other);
    const from = daysAgo(200);
    const to = daysAgo(190);

    await seedAdjustmentsInOrder(page, [
      // One day before `from`, and one day after `to`.
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(201),
        amountCents: 99999,
        description: 'Load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(189),
        amountCents: 88888,
        description: 'Load allowance',
      },
      // Inside the range, inclusive on both ends.
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: from,
        amountCents: 1000,
        description: 'Load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: to,
        amountCents: 2000,
        description: 'LOAD ALLOWANCE',
      },
      // Same description, different person.
      {
        staffMemberId: otherMember.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(195),
        amountCents: 77777,
        description: 'Load allowance',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(earningsRows(page)).toHaveCount(1);
    const load = earningsRows(page).nth(0);
    // Exactly the two in-range items: the boundary dates are inclusive and the
    // out-of-range amounts are nowhere in the artifact.
    await expect(lineMetadata(load)).toHaveText(
      earningsMetadata('Allowance', [from, to], from, to),
    );
    await expect(lineAmount(load)).toHaveText(peso(3000));
    await expect(payslipArtifact(page)).not.toContainText(peso(99999));
    await expect(payslipArtifact(page)).not.toContainText(peso(88888));
    await expect(payslipArtifact(page)).not.toContainText(peso(77777));
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(3000));
    await expect(payslipNet(page)).toHaveText(peso(3000));

    // The other member's own payslip is unaffected in the same range.
    await generatePayslip(page, { staffName: other, from, to });
    await expect(earningsRows(page)).toHaveCount(1);
    await expect(lineAmount(earningsRows(page).nth(0))).toHaveText(peso(77777));
  });

  test('a payslip range whose items all fall outside it still shows the empty state and offers no download', async ({
    page,
  }) => {
    // Boundary: grouping must not invent a line, or a download, out of nothing.
    const name = newName('EmptyRange');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(230);
    const to = daysAgo(220);

    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: daysAgo(219),
      amountCents: 12345,
      description: 'Load allowance',
    });

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(page.locator('.payslip-empty')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'No records in this range' }),
    ).toBeVisible();
    await expect(payslipArtifact(page)).toHaveCount(0);
    await expect(downloadButton(page)).toHaveCount(0);
  });

  test('a payslip range that crosses a calendar year prints long dates in a grouped line', async ({
    page,
  }) => {
    // Design Reference for #412: the year must be readable when a group's dates
    // straddle 31 December, so the short format is dropped for the whole line.
    const name = newName('CrossYear');
    const member = await seedStaffMember(page, name);
    // The most recently completed year boundary, so every date is in the past
    // whenever in the year this suite runs.
    const thisYear = Number(TODAY.slice(0, 4));
    const endYear = TODAY >= `${thisYear}-02-01` ? thisYear : thisYear - 1;
    const from = `${endYear - 1}-12-20`;
    const to = `${endYear}-01-10`;
    const first = `${endYear - 1}-12-28`;
    const second = `${endYear}-01-05`;

    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: first,
        amountCents: 1000,
        description: 'Holiday allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: second,
        amountCents: 2000,
        description: 'holiday allowance',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(earningsRows(page)).toHaveCount(1);
    const line = earningsRows(page).nth(0);
    await expect(lineAmount(line)).toHaveText(peso(3000));
    await expect(lineMetadata(line)).toHaveText(
      `Allowance · 2 items · ${longDate(first)}, ${longDate(second)}`,
    );
    // Both years are spelled out — the whole point of the exception.
    await expect(lineMetadata(line)).toContainText(String(endYear - 1));
    await expect(lineMetadata(line)).toContainText(String(endYear));
  });
});

// ---- AC 6: totals are unchanged by grouping --------------------------------

test.describe('Totals are unaffected by grouping (story #412)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('every total equals the integer-cent sum of the individual items, and moves by exactly the delta when one item inside a group is edited', async ({
    page,
  }) => {
    // Criterion 6, mutation-tested. Asserting the totals against a fixture is
    // not enough on its own (`e2e-seeded-sale-lines-hide-snapshot-bugs`): the
    // amount of one item inside a three-item group is changed, and both the
    // group line and every total must move by exactly that difference.
    const name = newName('Totals');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(260);
    const to = daysAgo(250);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(258),
      salaryCents: 123456,
      commissionCents: 7,
    });

    const items: {
      kind: AdjustmentKind;
      effectiveDate: string;
      amountCents: number;
      description: string;
    }[] = [
      { kind: 'ALLOWANCE', effectiveDate: daysAgo(257), amountCents: 10000, description: 'Load allowance' },
      { kind: 'ALLOWANCE', effectiveDate: daysAgo(256), amountCents: 2501, description: 'LOAD ALLOWANCE' },
      { kind: 'ALLOWANCE', effectiveDate: daysAgo(256), amountCents: 7, description: 'load allowance' },
      { kind: 'ALLOWANCE', effectiveDate: daysAgo(255), amountCents: 33333, description: 'Calamity allowance' },
      { kind: 'BONUS', effectiveDate: daysAgo(254), amountCents: 50000, description: 'Spot bonus' },
      { kind: 'BONUS', effectiveDate: daysAgo(253), amountCents: 1, description: 'spot bonus' },
      { kind: 'ADVANCE', effectiveDate: daysAgo(252), amountCents: 20000, description: 'Payday advance' },
      { kind: 'ADVANCE', effectiveDate: daysAgo(251), amountCents: 13, description: 'PAYDAY ADVANCE' },
    ];
    const created = await seedAdjustmentsInOrder(
      page,
      items.map((item) => ({ staffMemberId: member.id, ...item })),
    );

    // Expectations summed over the RAW items, in integer cents, with no
    // reference to how the display groups them.
    const sumOf = (kind: AdjustmentKind) =>
      items
        .filter((item) => item.kind === kind)
        .reduce((total, item) => total + item.amountCents, 0);
    const allowance = sumOf('ALLOWANCE');
    const bonus = sumOf('BONUS');
    const advance = sumOf('ADVANCE');
    const salary = 123456;
    const commission = 7;
    const earnings = salary + commission + allowance + bonus;
    const net = earnings - advance;

    // The contract first, straight from the API: the group totals must add up
    // to the same money as the flat list, never replace it.
    const payslip = await fetchPayslip(page, member.id, from, to);
    expect(payslip.adjustments).toHaveLength(items.length);
    expect(payslip.allowanceTotalCents).toBe(allowance);
    expect(payslip.bonusTotalCents).toBe(bonus);
    expect(payslip.advanceTotalCents).toBe(advance);
    expect(payslip.earningsTotalCents).toBe(earnings);
    expect(payslip.netPayableCents).toBe(net);
    // ADR 0014 §3: `grandTotalCents` still means salary + commission only.
    expect(payslip.grandTotalCents).toBe(salary + commission);
    for (const kind of ['ALLOWANCE', 'BONUS', 'ADVANCE'] as AdjustmentKind[]) {
      const groups = payslip.adjustmentGroups.filter(
        (group) => group.kind === kind,
      );
      expect(
        groups.reduce((total, group) => total + group.totalCents, 0),
        `grouped ${kind} total must equal the itemised total`,
      ).toBe(sumOf(kind));
      expect(
        groups.reduce((total, group) => total + group.itemCount, 0),
      ).toBe(items.filter((item) => item.kind === kind).length);
      for (const group of groups) {
        expect(group.effectiveDates).toHaveLength(group.itemCount);
        expect(group.adjustmentIds).toHaveLength(group.itemCount);
      }
    }

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    // Eight items, five lines: salary, commission, and three groups.
    await expect(earningsRows(page)).toHaveCount(5);
    await expect(advanceRows(page)).toHaveCount(1);
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
    await expect(payslipNet(page)).toHaveText(peso(net));

    // Now move ONE item inside the three-strong allowance group.
    const grouped = created[1]!;
    const delta = 777;
    await patchAdjustment(page, grouped.id, {
      effectiveDate: grouped.effectiveDate,
      amountCents: grouped.amountCents + delta,
      description: grouped.description,
    });

    await generatePayslip(page, { staffName: name, from, to });
    await expect(earningsRows(page)).toHaveCount(5);
    const load = earningsRows(page).nth(2);
    expect(await lineDescription(load)).toBe('Load allowance');
    await expect(lineAmount(load)).toHaveText(peso(10000 + 2501 + 7 + delta));
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(
      peso(allowance + delta),
    );
    await expect(payslipTotal(page, 'Earnings total')).toHaveText(
      peso(earnings + delta),
    );
    await expect(payslipNet(page)).toHaveText(peso(net + delta));
    // Untouched totals must NOT move — the delta landed in one category only.
    await expect(payslipTotal(page, 'Bonus total')).toHaveText(peso(bonus));
    await expect(payslipTotal(page, 'Advance total')).toHaveText(
      negatedPeso(advance),
    );
  });

  test('grouped advances that exceed earnings still produce a negative net payable', async ({
    page,
  }) => {
    // ADR 0014 §3 — `netPayableCents` is never clamped, and grouping must not
    // touch the sign.
    const name = newName('Negative');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(290);
    const to = daysAgo(280);

    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: daysAgo(288),
      salaryCents: 10000,
      commissionCents: 0,
    });
    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(287),
        amountCents: 30000,
        description: 'Payday advance',
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(285),
        amountCents: 15000,
        description: 'payday advance ',
      },
    ]);

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });

    await expect(advanceRows(page)).toHaveCount(1);
    await expect(lineAmount(advanceRows(page).nth(0))).toHaveText(
      negatedPeso(45000),
    );
    await expect(lineMetadata(advanceRows(page).nth(0))).toHaveText(
      advanceMetadata([daysAgo(287), daysAgo(285)], from, to),
    );
    await expect(payslipTotal(page, 'Advance total')).toHaveText(
      negatedPeso(45000),
    );
    await expect(payslipNet(page)).toHaveText(peso(-35000));
    await expect(page.locator('.payslip-net.negative')).toBeVisible();
  });
});

// ---- AC 8: recording, editing and deleting are unchanged -------------------

test.describe('Individual adjustments are unchanged by grouping (story #412)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('two identical allowances still create two rows, and editing one out of the group splits the payslip line', async ({
    page,
  }) => {
    // Criterion 8, driven entirely through the admin screens. Grouping is a
    // display concern, so the list must still show both items and the table
    // must still hold both rows (ADR 0014 §1 — no duplicate suppression).
    const name = newName('Unchanged');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(320);
    const to = daysAgo(310);
    const date = daysAgo(315);

    await gotoAdjustments(page);
    await applyAdjustmentFilters(page, { staffName: name, from, to });

    for (const amount of ['100.50', '100.50']) {
      await openAddAdjustment(page);
      await fillAdjustmentDraft(page, {
        staffName: name,
        kind: 'Allowance',
        effectiveDate: date,
        amount,
        description: 'Load allowance',
      });
      await submitAdjustment(page, 'Add adjustment');
      await expect(adjustmentDialog(page)).toHaveCount(0);
    }

    // Both persisted, and both are still listed individually.
    await expect(adjustmentRows(page)).toHaveCount(2);
    await expect(adjustmentRow(page, name, 'Load allowance')).toHaveCount(2);
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(2);

    // One grouped line on the payslip, summing the two.
    await page.getByRole('button', { name: 'Payslips', exact: true }).click();
    await generatePayslip(page, { staffName: name, from, to });
    await expect(earningsRows(page)).toHaveCount(1);
    await expect(lineAmount(earningsRows(page).nth(0))).toHaveText(peso(20100));
    await expect(lineMetadata(earningsRows(page).nth(0))).toHaveText(
      earningsMetadata('Allowance', [date, date], from, to),
    );

    // Edit one item's description OUT of the group.
    await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
    await applyAdjustmentFilters(page, { staffName: name, from, to });
    await adjustmentRow(page, name, 'Load allowance')
      .first()
      .getByRole('button', { name: /^Edit / })
      .click();
    await fillAdjustmentDraft(page, { description: 'Load allowance (revised)' });
    await submitAdjustment(page, 'Save changes');
    await expect(adjustmentDialog(page)).toHaveCount(0);
    await expect(
      adjustmentRow(page, name, 'Load allowance (revised)'),
    ).toHaveCount(1);
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(2);

    // The next generation splits the line in two.
    await page.getByRole('button', { name: 'Payslips', exact: true }).click();
    await generatePayslip(page, { staffName: name, from, to });
    await expect(earningsRows(page)).toHaveCount(2);
    await expect(payslipArtifact(page)).toContainText(
      'Load allowance (revised)',
    );
    for (const index of [0, 1]) {
      await expect(lineAmount(earningsRows(page).nth(index))).toHaveText(
        peso(10050),
      );
      await expect(
        lineMetadata(earningsRows(page).nth(index)),
      ).not.toContainText('items');
    }
    // Criterion 6 holds across the split — the money did not change.
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(20100));

    // Delete one of them; the remaining line is a group of one.
    await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
    await applyAdjustmentFilters(page, { staffName: name, from, to });
    await adjustmentRow(page, name, 'Load allowance (revised)')
      .getByRole('button', { name: /^Delete / })
      .click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(
      adjustmentRow(page, name, 'Load allowance (revised)'),
    ).toHaveCount(0);
    expect(countStoredAdjustmentsForStaff(member.id)).toBe(1);

    await page.getByRole('button', { name: 'Payslips', exact: true }).click();
    await generatePayslip(page, { staffName: name, from, to });
    await expect(earningsRows(page)).toHaveCount(1);
    await expect(lineAmount(earningsRows(page).nth(0))).toHaveText(peso(10050));
    await expect(payslipTotal(page, 'Allowance total')).toHaveText(peso(10050));
    await expect(payslipNet(page)).toHaveText(peso(10050));
  });
});

// ---- AC 7: the downloaded PNG carries the same grouped lines ---------------

/**
 * ADR 0014 §5 accepts that client-side rasterization is fidelity-sensitive, so
 * this asserts on **content and native size**, never pixel equality:
 *
 * - the saved file is a real PNG (8-byte signature) whose IHDR dimensions match
 *   the rasterized node at its `pixelRatio: 2` scale, so a truncated capture
 *   cannot pass;
 * - the image carries ink — decoded **at its native size** and its non-white
 *   pixels counted. Per `e2e-canvas-image-compare-resampling`, drawing it onto
 *   a smaller canvas would measure Chromium's downscaler, not the artwork;
 * - every grouped line is asserted on `#payslip-capture-node`, the exact DOM
 *   subtree that was rasterized. No OCR is available in this suite, and the
 *   export path *is* the screen (ADR 0014 §5) — which is also why the design
 *   forbids collapsing a long date list behind an ellipsis or a disclosure:
 *   anything hidden on screen would be missing from the file.
 */
function readPngHeader(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(
    bytes.subarray(0, 8).equals(signature),
    'the downloaded file is not a PNG',
  ).toBeTruthy();
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function measurePng(
  page: Page,
  bytes: Buffer,
): Promise<{ width: number; height: number; darkRatio: number }> {
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

test.describe('The downloaded PNG shows the grouped lines (story #412)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('a payslip with grouped allowance, bonus and advance lines downloads as a complete PNG of exactly those lines', async ({
    page,
  }) => {
    // Criterion 7. The export rasterizes the same `<article>` the screen shows,
    // so the proof is: the grouped text is on that node, the file is a whole
    // PNG the size of that node, and it has ink.
    const name = newName('Png');
    const member = await seedStaffMember(page, name);
    const from = daysAgo(350);
    const to = daysAgo(340);

    await seedAdjustmentsInOrder(page, [
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(348),
        amountCents: 10000,
        description: 'Load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(346),
        amountCents: 2500,
        description: 'LOAD ALLOWANCE',
      },
      {
        staffMemberId: member.id,
        kind: 'ALLOWANCE',
        effectiveDate: daysAgo(346),
        amountCents: 700,
        description: 'load allowance',
      },
      {
        staffMemberId: member.id,
        kind: 'BONUS',
        effectiveDate: daysAgo(345),
        amountCents: 50000,
        description: 'Spot bonus',
      },
      {
        staffMemberId: member.id,
        kind: 'BONUS',
        effectiveDate: daysAgo(344),
        amountCents: 1,
        description: 'spot bonus',
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(343),
        amountCents: 30000,
        description: 'Payday advance',
      },
      {
        staffMemberId: member.id,
        kind: 'ADVANCE',
        effectiveDate: daysAgo(342),
        amountCents: 13,
        description: 'PAYDAY ADVANCE',
      },
    ]);
    const allowance = 10000 + 2500 + 700;
    const bonus = 50001;
    const advance = 30013;

    await gotoPayslips(page);
    await generatePayslip(page, { staffName: name, from, to });
    const artifact = payslipArtifact(page);
    await expect(artifact).toBeVisible();

    // Three lines, two in earnings and one deduction.
    await expect(earningsRows(page)).toHaveCount(2);
    await expect(advanceRows(page)).toHaveCount(1);

    // The grouped text, asserted on the node that gets rasterized.
    await expect(artifact).toContainText('Load allowance');
    await expect(artifact).toContainText(peso(allowance));
    await expect(artifact).toContainText(
      earningsMetadata(
        'Allowance',
        [daysAgo(348), daysAgo(346), daysAgo(346)],
        from,
        to,
      ),
    );
    await expect(artifact).toContainText('Spot bonus');
    await expect(artifact).toContainText(peso(bonus));
    await expect(artifact).toContainText('Payday advance');
    await expect(artifact).toContainText(
      advanceMetadata([daysAgo(343), daysAgo(342)], from, to),
    );
    await expect(payslipNet(page)).toHaveText(
      peso(allowance + bonus - advance),
    );
    // The members of a group are not also lines of their own in the picture.
    await expect(artifact).not.toContainText(peso(2500));
    await expect(artifact).not.toContainText(peso(700));

    const size = await artifact.evaluate((node: HTMLElement) => ({
      width: node.offsetWidth,
      height: node.offsetHeight,
    }));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton(page).click(),
    ]);
    const saved = join(tmpdir(), `qa456-${RUN}-${download.suggestedFilename()}`);
    await download.saveAs(saved);
    const bytes = readFileSync(saved);
    const header = readPngHeader(bytes);
    const facts = await measurePng(page, bytes);

    expect(facts.width).toBe(header.width);
    expect(facts.height).toBe(header.height);
    // `pixelRatio: 2`, so the picture is twice the node it was taken from. A
    // capture that clipped the wrapped date lists fails here rather than
    // passing quietly.
    expect(Math.abs(header.width - size.width * 2)).toBeLessThanOrEqual(4);
    expect(Math.abs(header.height - size.height * 2)).toBeLessThanOrEqual(4);
    expect(
      facts.darkRatio,
      'the PNG is blank — no payslip content was rasterized',
    ).toBeGreaterThan(0.005);
    await expect(page.locator('.payslip-download-status')).toContainText(
      download.suggestedFilename(),
    );

    // The date list must be laid out, not hidden: nothing inside the grouped
    // lines may be clipped or scrolled away, because the PNG is this DOM.
    const clipped = await artifact.evaluate((node: HTMLElement) =>
      Array.from(
        node.querySelectorAll<HTMLElement>('.payslip-artifact-table td span'),
      ).filter((span) => {
        const style = getComputedStyle(span);
        return (
          style.textOverflow === 'ellipsis' ||
          style.overflow === 'hidden' ||
          span.scrollHeight - span.clientHeight > 1 ||
          span.scrollWidth - span.clientWidth > 1
        );
      }).length,
    );
    expect(
      clipped,
      'a grouped line hides part of its date list, so the PNG cannot carry it',
    ).toBe(0);

    // The grouped lines are still on the rasterized node after the export.
    await expect(artifact).toContainText(peso(allowance));
    await expect(artifact).toContainText(peso(bonus));
  });
});
