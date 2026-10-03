import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  deleteStoredAdjustmentsForStaff,
  deleteStoredEntriesForStaff,
} from './fixtures/compensation';
import { shopToday, shortDate } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #413 — "Default compensation dates to the
 * current pay cutoff with previous and next cutoff shortcuts" (QA task #418).
 *
 * Everything runs through the real browser → web app → NestJS API → PostgreSQL
 * path as the seeded `admin` (ADMIN) user. All three surfaces are admin-only
 * sections of `/compensation` (ADR 0013 §6), so every test signs in as admin.
 *
 * Four conventions run through this file.
 *
 * - **The calendar oracle is written here, independently.** Criterion 2 is
 *   stated relative to *today's shop date*, which moves under the suite, so a
 *   spec that hard-codes "October 1–15" only passes in October. Pinning the
 *   clock was rejected: the `test.use({ reducedMotion })` precedent in this
 *   suite is a fixture that silently never reached the page and produced a
 *   false green, and a clock fixture that misses the app would do the same
 *   while looking stricter. Instead `cutoffOf()` below re-derives the
 *   semi-monthly rule from an explicit month-length table and an explicit leap
 *   rule — the product derives it from `Date.UTC(y, m, 0)`, so a bug in one
 *   cannot be mirrored into the other. Month-length and year boundaries that
 *   today's date cannot reach (a 29-day February, a December→January step) are
 *   then reached deliberately by *typing* a date there and stepping, which is
 *   the same code path with no clock involved.
 * - **Stepping is asserted on all three views.** The stepper is one shared
 *   component, but each view owns its own `from` / `to` state, so a wiring
 *   mistake in one view is invisible from the others. The view-independent
 *   criteria are therefore driven by a table of all three surfaces.
 * - **Locators are role + accessible name.** The acceptance criteria name the
 *   two actions ("Previous cutoff" / "Next cutoff"); the glyphs and the class
 *   names are Design Task #416's to change. The readout is the `<output>`
 *   element, addressed by its `status` role inside the stepper's group.
 * - **An empty table passes vacuously.** Stepping is only meaningful if it
 *   changes which rows are listed, so the data tests seed records either side
 *   of a real cutoff boundary and assert that the list and the adjustments
 *   "Showing N adjustments from … to …" line follow the step.
 *
 * `page.reload()` is never used to assert persistence: the range is component
 * state, not a URL parameter, so a reload legitimately snaps back to the
 * default. Reload appears here only where re-reading the default is the point.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// Same host the web app calls: the session cookie is host-scoped, so the
// request-context seeding below only carries it when it hits the same origin.
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-test tag that is also a unique, selectable display name. */
function newName(label: string): string {
  seq += 1;
  return `QA418 ${label} ${RUN}-${seq}`;
}

/** Roster members created by this file; their rows are removed at the end. */
const seededStaffIds: string[] = [];

// ---- the calendar oracle ----------------------------------------------------
//
// Deliberately NOT imported from the product. Month lengths are a literal
// table and the leap rule is spelled out, so this oracle shares no arithmetic
// with `apps/web/src/compensation/domain.ts`.

interface Range {
  from: string;
  to: string;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The real last day of a month: 28, 29, 30 or 31, never a hard-coded guess. */
function lastDayOfMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1]!;
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parts(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split('-').map(Number);
  return [year!, month!, day!];
}

/** The semi-monthly cutoff containing `isoDate`: 1–15, or 16–end of month. */
function cutoffOf(isoDate: string): Range {
  const [year, month, day] = parts(isoDate);
  return day <= 15
    ? { from: iso(year, month, 1), to: iso(year, month, 15) }
    : { from: iso(year, month, 16), to: iso(year, month, lastDayOfMonth(year, month)) };
}

/** The cutoff before the one containing `isoDate`. */
function previousCutoffOf(isoDate: string): Range {
  const [year, month, day] = parts(isoDate);
  if (day > 15) return cutoffOf(iso(year, month, 1));
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return cutoffOf(iso(previousYear, previousMonth, 16));
}

/** The cutoff after the one containing `isoDate`. */
function nextCutoffOf(isoDate: string): Range {
  const [year, month, day] = parts(isoDate);
  if (day <= 15) return cutoffOf(iso(year, month, 16));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return cutoffOf(iso(nextYear, nextMonth, 1));
}

function stepRange(range: Range, direction: 'previous' | 'next', times = 1): Range {
  let current = range;
  for (let index = 0; index < times; index += 1) {
    current = direction === 'previous'
      ? previousCutoffOf(current.from)
      : nextCutoffOf(current.from);
  }
  return current;
}

/** `Mon D, YYYY`, the product's long form for one date in the readout. */
function readoutDate(isoDate: string): string {
  const [year, month, day] = parts(isoDate);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/**
 * The readout the stepper must show. An exact cutoff reads bare; anything else
 * is prefixed `Custom range: ` so the control never claims a cutoff it has not
 * actually selected.
 */
function readoutFor(range: Range): string {
  const [fromYear, fromMonth, fromDay] = parts(range.from);
  const [toYear, toMonth, toDay] = parts(range.to);
  const exact = cutoffOf(range.from);
  const prefix = range.from === exact.from && range.to === exact.to ? '' : 'Custom range: ';
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${prefix}${MONTH_NAMES[fromMonth - 1]} ${fromDay} – ${toDay}, ${toYear}`;
  }
  return `${prefix}${readoutDate(range.from)} – ${readoutDate(range.to)}`;
}

const TODAY = shopToday();
const TODAY_CUTOFF = cutoffOf(TODAY);

// ---- page objects -----------------------------------------------------------

interface CutoffSurface {
  /** How the story names the view. */
  label: string;
  /** The compensation section tab that reveals it. */
  tab: string;
  /** The filter form that owns this view's date controls and stepper. */
  form: (page: Page) => Locator;
  /** Whether the view offers `Clear filters` (the payslip form does not). */
  clearable: boolean;
}

const SURFACES: CutoffSurface[] = [
  {
    label: 'daily records',
    tab: 'Daily records',
    form: (page) => page.locator('form[aria-label="Filter compensation records"]'),
    clearable: true,
  },
  {
    label: 'adjustments',
    tab: 'Adjustments',
    form: (page) => page.locator('form[aria-label="Filter compensation adjustments"]'),
    clearable: true,
  },
  {
    label: 'payslip',
    tab: 'Payslips',
    form: (page) => page.locator('.payslip-filter form'),
    clearable: false,
  },
];

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function gotoCompensation(page: Page): Promise<void> {
  await page.goto('/compensation');
  await expect(
    page.getByRole('heading', { name: 'Compensation', level: 1 }),
  ).toBeVisible();
}

/** Open one of the three sections and return its filter form. */
async function openSurface(page: Page, surface: CutoffSurface): Promise<Locator> {
  await page
    .locator('nav[aria-label="Compensation sections"]')
    .getByRole('button', { name: surface.tab, exact: true })
    .click();
  const form = surface.form(page);
  await expect(form).toBeVisible();
  return form;
}

const fromInput = (form: Locator) => form.locator('input[type="date"]').first();
const toInput = (form: Locator) => form.locator('input[type="date"]').nth(1);
const stepper = (form: Locator) =>
  form.getByRole('group', { name: 'Pay cutoff navigation' });
const previousButton = (form: Locator) =>
  form.getByRole('button', { name: 'Previous cutoff' });
const nextButton = (form: Locator) =>
  form.getByRole('button', { name: 'Next cutoff' });
// The readout is an `<output aria-live="polite">`, whose implicit role is
// `status`. Addressed by role rather than by `.cutoff-readout` so the design
// treatment from #416 can rename the class without breaking the spec.
const readout = (form: Locator) => stepper(form).getByRole('status');

/** Assert the two date inputs and the readout all agree on one range. */
async function expectRange(form: Locator, range: Range): Promise<void> {
  await expect(fromInput(form)).toHaveValue(range.from);
  await expect(toInput(form)).toHaveValue(range.to);
  await expect(readout(form)).toHaveText(readoutFor(range));
}

/** Type a range by hand, exactly as an administrator still may (criterion 6). */
async function typeRange(form: Locator, range: Range): Promise<void> {
  await fromInput(form).fill(range.from);
  await toInput(form).fill(range.to);
  await expect(fromInput(form)).toHaveValue(range.from);
  await expect(toInput(form)).toHaveValue(range.to);
}

// ---- seeding ----------------------------------------------------------------

interface StaffMemberPayload {
  id: string;
  displayName: string;
}

async function seedStaffMember(page: Page, displayName: string): Promise<StaffMemberPayload> {
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
    kind: 'ADVANCE' | 'ALLOWANCE' | 'BONUS';
    effectiveDate: string;
    amountCents: number;
    description: string;
  },
): Promise<void> {
  const response = await page.request.post(
    `${API_BASE_URL}/compensation/adjustments`,
    { data: input },
  );
  expect(
    response.ok(),
    `seeding ${input.kind} ${input.effectiveDate} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}

/**
 * Format integer cents the way the UI does, derived independently of
 * `formatMoney` so a float bug in the product cannot be mirrored here.
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

test.afterAll(() => {
  deleteStoredAdjustmentsForStaff(seededStaffIds);
  deleteStoredEntriesForStaff(seededStaffIds);
});

// ---- AC 1 & 2: the cutoff rule and the default on open ----------------------

test.describe('Cutoff defaults on open (story #413, criteria 1–2)', () => {
  test('all three views open on the cutoff containing today\'s shop date', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);

    // Criterion 1, asserted against the shape of the default rather than
    // against the product's own helper: the first half ends on the 15th, the
    // second half ends on the month's real last day.
    const [year, month, day] = parts(TODAY);
    if (day <= 15) {
      expect(TODAY_CUTOFF).toEqual({ from: iso(year, month, 1), to: iso(year, month, 15) });
    } else {
      expect(TODAY_CUTOFF).toEqual({
        from: iso(year, month, 16),
        to: iso(year, month, lastDayOfMonth(year, month)),
      });
    }
    expect([28, 29, 30, 31, 15]).toContain(parts(TODAY_CUTOFF.to)[2]);

    for (const surface of SURFACES) {
      const form = await openSurface(page, surface);
      await expectRange(form, TODAY_CUTOFF);
      // The readout must claim an exact cutoff, not "Custom range: …".
      await expect(readout(form)).not.toContainText('Custom range');
    }
  });

  test('every view exposes enabled Previous and Next cutoff actions by accessible name', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);

    for (const surface of SURFACES) {
      const form = await openSurface(page, surface);
      await expect(
        previousButton(form),
        `${surface.label}: exactly one "Previous cutoff" action`,
      ).toHaveCount(1);
      await expect(
        nextButton(form),
        `${surface.label}: exactly one "Next cutoff" action`,
      ).toHaveCount(1);
      // Criterion 4: stepping is unbounded, so neither control is ever
      // disabled — not at the default, and not after stepping either way.
      await expect(previousButton(form)).toBeEnabled();
      await expect(nextButton(form)).toBeEnabled();
      await previousButton(form).click();
      await expect(previousButton(form)).toBeEnabled();
      await expect(nextButton(form)).toBeEnabled();
      await nextButton(form).click();
      await nextButton(form).click();
      await expect(previousButton(form)).toBeEnabled();
      await expect(nextButton(form)).toBeEnabled();
    }
  });
});

// ---- AC 3 & 4: stepping on every view ---------------------------------------

test.describe('Previous / Next cutoff stepping (story #413, criteria 3–4)', () => {
  for (const surface of SURFACES) {
    test(`the ${surface.label} view steps back and forward one cutoff at a time`, async ({
      page,
    }) => {
      await signInAsAdmin(page);
      await gotoCompensation(page);
      const form = await openSurface(page, surface);
      await expectRange(form, TODAY_CUTOFF);

      await previousButton(form).click();
      await expectRange(form, stepRange(TODAY_CUTOFF, 'previous'));

      await nextButton(form).click();
      await expectRange(form, TODAY_CUTOFF);

      await nextButton(form).click();
      await expectRange(form, stepRange(TODAY_CUTOFF, 'next'));
    });
  }

  test('repeated stepping walks cutoffs monotonically and round-trips exactly', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    // Six steps back crosses at least three month boundaries from any start
    // date, so a stepper that sticks at a month edge cannot survive this.
    const seen: string[] = [`${TODAY_CUTOFF.from}..${TODAY_CUTOFF.to}`];
    for (let step = 1; step <= 6; step += 1) {
      await previousButton(form).click();
      const expected = stepRange(TODAY_CUTOFF, 'previous', step);
      await expectRange(form, expected);
      seen.push(`${expected.from}..${expected.to}`);
    }
    // Strictly decreasing, no repeats, no drift.
    expect(new Set(seen).size).toBe(seen.length);
    const starts = seen.map((value) => value.split('..')[0]!);
    expect([...starts].sort().reverse()).toEqual(starts);

    for (let step = 5; step >= 0; step -= 1) {
      await nextButton(form).click();
      await expectRange(
        form,
        step === 0 ? TODAY_CUTOFF : stepRange(TODAY_CUTOFF, 'previous', step),
      );
    }
    // Previous-then-Next returned to exactly the range we started from.
    await expectRange(form, TODAY_CUTOFF);
  });

  test('Next cutoff steps into future cutoffs without a guard', async ({ page }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    for (let step = 1; step <= 5; step += 1) {
      await nextButton(form).click();
      await expectRange(form, stepRange(TODAY_CUTOFF, 'next', step));
      await expect(nextButton(form)).toBeEnabled();
    }
    // Five steps forward is at least two months past today's cutoff.
    const reached = stepRange(TODAY_CUTOFF, 'next', 5);
    expect(reached.from > TODAY).toBeTruthy();
  });
});

// ---- Calendar edges the clock cannot reach ----------------------------------

test.describe('Month-length and year boundaries (story #413, criteria 1, 3, 4)', () => {
  // Each case types a date into the hand-editable `From` control and steps, so
  // the boundary is reached through the real UI with no clock manipulation.
  const CASES: Array<{
    name: string;
    typed: Range;
    direction: 'previous' | 'next';
    expected: Range;
  }> = [
    {
      name: '28-day February: Mar 1–15, 2027 → Previous → Feb 16–28, 2027',
      typed: { from: '2027-03-01', to: '2027-03-15' },
      direction: 'previous',
      expected: { from: '2027-02-16', to: '2027-02-28' },
    },
    {
      name: '29-day February: Mar 1–15, 2028 → Previous → Feb 16–29, 2028',
      typed: { from: '2028-03-01', to: '2028-03-15' },
      direction: 'previous',
      expected: { from: '2028-02-16', to: '2028-02-29' },
    },
    {
      name: '29-day February: Feb 1–15, 2028 → Next → Feb 16–29, 2028',
      typed: { from: '2028-02-01', to: '2028-02-15' },
      direction: 'next',
      expected: { from: '2028-02-16', to: '2028-02-29' },
    },
    {
      name: '30-day month: Jul 1–15, 2026 → Previous → Jun 16–30, 2026',
      typed: { from: '2026-07-01', to: '2026-07-15' },
      direction: 'previous',
      expected: { from: '2026-06-16', to: '2026-06-30' },
    },
    {
      name: '31-day month: Jun 1–15, 2026 → Previous → May 16–31, 2026',
      typed: { from: '2026-06-01', to: '2026-06-15' },
      direction: 'previous',
      expected: { from: '2026-05-16', to: '2026-05-31' },
    },
    {
      name: 'year boundary back: Jan 1–15, 2027 → Previous → Dec 16–31, 2026',
      typed: { from: '2027-01-01', to: '2027-01-15' },
      direction: 'previous',
      expected: { from: '2026-12-16', to: '2026-12-31' },
    },
    {
      name: 'year boundary forward: Dec 16–31, 2026 → Next → Jan 1–15, 2027',
      typed: { from: '2026-12-16', to: '2026-12-31' },
      direction: 'next',
      expected: { from: '2027-01-01', to: '2027-01-15' },
    },
  ];

  for (const scenario of CASES) {
    test(scenario.name, async ({ page }) => {
      await signInAsAdmin(page);
      await gotoCompensation(page);
      const form = await openSurface(page, SURFACES[0]!);

      await typeRange(form, scenario.typed);
      // The typed range is itself an exact cutoff, so the readout must not
      // call it a custom range before we step.
      await expectRange(form, scenario.typed);

      const button = scenario.direction === 'previous'
        ? previousButton(form)
        : nextButton(form);
      await button.click();
      await expectRange(form, scenario.expected);

      // And back again: the two actions are exact inverses at this boundary.
      const inverse = scenario.direction === 'previous'
        ? nextButton(form)
        : previousButton(form);
      await inverse.click();
      await expectRange(form, scenario.typed);
    });
  }

  test('the second cutoff always ends on the real last day of its month', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    // Walk a whole year of second-half cutoffs from a leap-year February.
    await typeRange(form, { from: '2028-02-16', to: '2028-02-29' });
    for (let month = 2; month <= 12; month += 1) {
      await expectRange(form, {
        from: iso(2028, month, 16),
        to: iso(2028, month, lastDayOfMonth(2028, month)),
      });
      // Two Next steps move from the 16th of one month to the 16th of the next.
      await nextButton(form).click();
      await nextButton(form).click();
    }
    await expectRange(form, { from: '2029-01-16', to: '2029-01-31' });
  });
});

// ---- AC 5 & 6: hand-typed ranges --------------------------------------------

test.describe('Hand-typed ranges (story #413, criteria 5–6)', () => {
  for (const surface of SURFACES) {
    test(`the ${surface.label} view still accepts manually typed dates`, async ({
      page,
    }) => {
      await signInAsAdmin(page);
      await gotoCompensation(page);
      const form = await openSurface(page, surface);

      const typed = { from: '2026-10-07', to: '2026-11-03' };
      await typeRange(form, typed);
      // Criterion 6: the typed dates stand, untouched by the cutoff default.
      await expectRange(form, typed);
      // …and the readout says so honestly rather than naming a cutoff.
      await expect(readout(form)).toContainText('Custom range');
    });
  }

  test('Previous moves relative to the cutoff containing the typed From date', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    // Oct 7 → Nov 3 spans two cutoffs. Previous must land on the cutoff before
    // the one containing Oct 7 (Sep 16–30), NOT before the one containing
    // Nov 3 (which would be Oct 16–31).
    await typeRange(form, { from: '2026-10-07', to: '2026-11-03' });
    await previousButton(form).click();
    await expectRange(form, { from: '2026-09-16', to: '2026-09-30' });
  });

  test('Next moves relative to the cutoff containing the typed From date', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    await typeRange(form, { from: '2026-10-07', to: '2026-11-03' });
    await nextButton(form).click();
    await expectRange(form, { from: '2026-10-16', to: '2026-10-31' });
  });

  test('a blank end date still steps from the cutoff containing the From date', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);

    await fromInput(form).fill('2026-10-07');
    await toInput(form).fill('');
    await expect(toInput(form)).toHaveValue('');
    await expect(readout(form)).toContainText('Custom range');
    await expect(readout(form)).not.toContainText('Invalid Date');

    await previousButton(form).click();
    await expectRange(form, { from: '2026-09-16', to: '2026-09-30' });
  });
});

// ---- Cleared filters ---------------------------------------------------------

test.describe('Stepping from an empty range (story #413, criterion 5)', () => {
  for (const surface of SURFACES.filter((candidate) => candidate.clearable)) {
    test(`the ${surface.label} view steps relative to today after Clear filters`, async ({
      page,
    }) => {
      await signInAsAdmin(page);
      await gotoCompensation(page);
      const form = await openSurface(page, surface);

      await form.getByRole('button', { name: 'Clear filters' }).click();
      await expect(fromInput(form)).toHaveValue('');
      await expect(toInput(form)).toHaveValue('');
      // The readout degrades honestly rather than rendering a blank or a
      // half-built range.
      await expect(readout(form)).toHaveText('No range selected');
      await expect(readout(form)).not.toContainText('Invalid Date');
      await expect(readout(form)).not.toContainText('NaN');

      await previousButton(form).click();
      await expectRange(form, stepRange(TODAY_CUTOFF, 'previous'));

      // And the same from empty in the other direction.
      await form.getByRole('button', { name: 'Clear filters' }).click();
      await expect(readout(form)).toHaveText('No range selected');
      await nextButton(form).click();
      await expectRange(form, stepRange(TODAY_CUTOFF, 'next'));
    });
  }
});

// ---- The listed data follows the stepped range ------------------------------

test.describe('Stepping changes what is listed (story #413, criteria 3–4)', () => {
  test('the daily records list follows the stepped cutoff', async ({ page }) => {
    await signInAsAdmin(page);
    const name = newName('Records');
    const member = await seedStaffMember(page, name);

    const previous = stepRange(TODAY_CUTOFF, 'previous');
    // One record inside today's cutoff and one inside the previous cutoff,
    // both in the past so the work date is always legal.
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: TODAY,
      salaryCents: 123456,
      commissionCents: 7,
    });
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: previous.to,
      salaryCents: 50000,
      commissionCents: 25,
    });

    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[0]!);
    await form.locator('select').selectOption({ label: name });

    const rows = page.locator('.compensation-table tbody tr');
    const results = page.locator('.results-meta');

    // The default cutoff shows only the record inside it.
    await expect(results).toHaveText('Showing 1 record');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(peso(123456 + 7));

    // Stepping back swaps which record is listed — an empty table would pass
    // vacuously, so the surviving row's total is asserted both times.
    await previousButton(form).click();
    await expectRange(form, previous);
    await expect(results).toHaveText('Showing 1 record');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(peso(50000 + 25));

    // Two cutoffs back there is nothing at all.
    await previousButton(form).click();
    await expectRange(form, stepRange(TODAY_CUTOFF, 'previous', 2));
    await expect(results).toHaveText('Showing 0 records');

    await nextButton(form).click();
    await nextButton(form).click();
    await expect(results).toHaveText('Showing 1 record');
    await expect(rows.first()).toContainText(peso(123456 + 7));
  });

  test('the adjustments "Showing …" line follows the stepped cutoff', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const name = newName('Adjustments');
    const member = await seedStaffMember(page, name);

    const previous = stepRange(TODAY_CUTOFF, 'previous');
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'ALLOWANCE',
      effectiveDate: TODAY,
      amountCents: 1234,
      description: 'Current cutoff allowance',
    });
    await seedAdjustment(page, {
      staffMemberId: member.id,
      kind: 'BONUS',
      effectiveDate: previous.to,
      amountCents: 7,
      description: 'Previous cutoff bonus',
    });

    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[1]!);
    await form.locator('select').selectOption({ label: name });

    const results = page.locator('.results-meta');
    const rows = page.locator('.compensation-table tbody tr');

    await expect(results).toHaveText(
      `Showing 1 adjustment from ${shortDate(TODAY_CUTOFF.from)} to ${shortDate(TODAY_CUTOFF.to)}`,
    );
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Current cutoff allowance');

    await previousButton(form).click();
    await expectRange(form, previous);
    await expect(results).toHaveText(
      `Showing 1 adjustment from ${shortDate(previous.from)} to ${shortDate(previous.to)}`,
    );
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Previous cutoff bonus');
    await expect(rows.first()).toContainText(peso(7));

    // Stepping forward again restores the original listing and its line.
    await nextButton(form).click();
    await expect(results).toHaveText(
      `Showing 1 adjustment from ${shortDate(TODAY_CUTOFF.from)} to ${shortDate(TODAY_CUTOFF.to)}`,
    );
    await expect(rows.first()).toContainText('Current cutoff allowance');
  });

  test('stepping preserves the selected staff filter on the list views', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const name = newName('Filter');
    const member = await seedStaffMember(page, name);
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: TODAY,
      salaryCents: 1000,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    for (const surface of [SURFACES[0]!, SURFACES[1]!]) {
      const form = await openSurface(page, surface);
      const select = form.locator('select').first();
      await select.selectOption({ label: name });
      await expect(select.locator('option:checked')).toHaveText(name);

      await previousButton(form).click();
      await expect(select.locator('option:checked')).toHaveText(name);
      await nextButton(form).click();
      await nextButton(form).click();
      await expect(select.locator('option:checked')).toHaveText(name);
    }
  });
});

// ---- AC 7: the payslip view -------------------------------------------------

test.describe('Payslip view isolation (story #413, criterion 7)', () => {
  test('stepping updates the range only, and generating still works for the stepped cutoff', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const name = newName('Payslip');
    const other = newName('Payslip other');
    const member = await seedStaffMember(page, name);
    await seedStaffMember(page, other);

    const previous = stepRange(TODAY_CUTOFF, 'previous');
    // Two records in the previous cutoff and one in today's. Only the first
    // two may appear once we step back — so the totals prove the range moved,
    // not merely the input values.
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: previous.from,
      salaryCents: 123456,
      commissionCents: 7,
    });
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: previous.to,
      salaryCents: 50000,
      commissionCents: 25,
    });
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: TODAY,
      salaryCents: 999999,
      commissionCents: 99,
    });

    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[2]!);
    const staffSelect = form.locator('select');

    // The view preselects the first selectable member from an effect that runs
    // once the roster request resolves. Choosing before that effect lands lets
    // it overwrite the choice and the payslip is generated for the wrong
    // person — so wait for the default, choose, then assert the choice stuck.
    await expect(staffSelect).not.toHaveValue('');
    await staffSelect.selectOption({ label: name });
    await expect(staffSelect.locator('option:checked')).toHaveText(name);
    await expectRange(form, TODAY_CUTOFF);

    await previousButton(form).click();
    await expectRange(form, previous);
    // Criterion 7: stepping updates the range only.
    await expect(staffSelect.locator('option:checked')).toHaveText(name);
    await expect(page.locator('#payslip-capture-node')).toHaveCount(0);

    await page.getByRole('button', { name: 'Generate payslip' }).click();
    const payslip = page.locator('#payslip-capture-node');
    await expect(payslip).toBeVisible();
    await expect(payslip).toContainText(name);
    // Exactly the two records inside the stepped cutoff, and their money.
    await expect(page.locator('.payslip-daily-table tbody tr')).toHaveCount(2);
    const earningsTotal = page
      .locator('.payslip-category-totals > div')
      .filter({ has: page.locator('dt').filter({ hasText: /^Earnings total$/ }) })
      .locator('dd');
    await expect(earningsTotal).toHaveText(peso(123456 + 7 + 50000 + 25));
    // The out-of-range record is excluded, so its amount cannot appear.
    await expect(payslip).not.toContainText(peso(999999 + 99));

    // The staff member survived generation, and the range is still the one we
    // stepped to.
    await expect(staffSelect.locator('option:checked')).toHaveText(name);
    await expectRange(form, previous);
  });

  test('stepping does not auto-generate a payslip', async ({ page }) => {
    await signInAsAdmin(page);
    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[2]!);
    const staffSelect = form.locator('select');
    await expect(staffSelect).not.toHaveValue('');

    for (let step = 0; step < 3; step += 1) {
      await previousButton(form).click();
      await expect(page.locator('#payslip-capture-node')).toHaveCount(0);
    }
    for (let step = 0; step < 4; step += 1) {
      await nextButton(form).click();
      await expect(page.locator('#payslip-capture-node')).toHaveCount(0);
    }
    await expectRange(form, stepRange(TODAY_CUTOFF, 'next'));
  });

  test('a generated payslip is not re-generated by a later step', async ({ page }) => {
    await signInAsAdmin(page);
    const name = newName('Payslip stale');
    const member = await seedStaffMember(page, name);
    await seedEntry(page, {
      staffMemberId: member.id,
      workDate: TODAY,
      salaryCents: 2500,
      commissionCents: 0,
    });

    await gotoCompensation(page);
    const form = await openSurface(page, SURFACES[2]!);
    const staffSelect = form.locator('select');
    await expect(staffSelect).not.toHaveValue('');
    await staffSelect.selectOption({ label: name });
    await expect(staffSelect.locator('option:checked')).toHaveText(name);

    await page.getByRole('button', { name: 'Generate payslip' }).click();
    const payslip = page.locator('#payslip-capture-node');
    await expect(payslip).toBeVisible();
    await expect(payslip).toContainText(peso(2500));

    // Stepping is a range edit, not a regeneration: the already-rendered
    // payslip must keep showing what was generated, and the controls must
    // have moved to the new cutoff.
    await previousButton(form).click();
    await expectRange(form, stepRange(TODAY_CUTOFF, 'previous'));
    await expect(staffSelect.locator('option:checked')).toHaveText(name);
    await expect(payslip).toContainText(peso(2500));
  });
});
