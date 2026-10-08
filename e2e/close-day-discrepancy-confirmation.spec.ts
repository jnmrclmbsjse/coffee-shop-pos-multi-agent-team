import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BALANCED_QTY,
  OPENING_FLOAT_CENTS,
  clearCloseFixtures,
  openCloseDay,
  readDayClosings,
  readTradingDayStatuses,
  resetCloseWorld,
  seedBalancedCounts,
  seedCloseItems,
  seedCloseStaff,
  type CountShape,
  type SeededRow,
} from './fixtures/close-discrepancy';

/**
 * End-to-end coverage for story #410 — "Confirm cup / lid and cash
 * discrepancies before closing the day" (QA task #431).
 *
 * The observable surface is the staff close screen (`/pos/close`). What this
 * story adds is a client-side gate inside the close form's submit handler: when
 * the form is otherwise valid and at least one discrepancy exists, a modal
 * confirmation lists every discrepancy and the close only happens if the staff
 * member chooses "Close day anyway".
 *
 * Two assertion habits run through the whole file, both aimed at the ways this
 * feature can pass by accident:
 *
 *  - **Absence is asserted, not just presence.** A gate that opens the dialog
 *     on every close, and a dialog that lists every reconciled item, would
 *     satisfy every presence-only assertion while breaking the two criteria
 *     that actually matter (only discrepancies are listed; no discrepancy means
 *     no dialog). So the balanced control item's name is asserted *missing*
 *     from the dialog, and the fully balanced day asserts the dialog never
 *     appears at all.
 *  - **"Did not close" is read from the database, not from the screen.** "Go
 *     back leaves the day open" and "retrying must not duplicate the close"
 *     are claims about stored rows. A screen that merely fails to show a
 *     success banner proves neither, so `readDayClosings()` and
 *     `readTradingDayStatuses()` are the witnesses.
 *
 * Closing a day is not undoable and there is at most one open day per
 * location, so each scenario resets the trading-day world and opens its own
 * day on its own business date; the file is serial for the same reason. See
 * `fixtures/close-discrepancy.ts` for why every reconciled item in the
 * database — not just this run's — has to be counted.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD =
  process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';

const TAG = `qa410-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Expected cash on a day with no sales, movements or expenses. */
const EXPECTED_CASH = '₱1,000.00';
/** Actual-cash entries relative to that expectation. */
const CASH_BALANCED = '1000';
const CASH_OVER = '1005';
const CASH_SHORT = '995';

/**
 * The message the stubbed failure returns. The screen surfaces the API's own
 * message when it has one (`apiMessages`), so asserting a distinctive string
 * proves the existing close error is what the staff member sees — a generic
 * fallback assertion would also pass if the message were dropped.
 */
const CLOSE_FAILURE_MESSAGE = 'The close could not be recorded right now.';

const ITEM_KEYS = ['Cup', 'Lid', 'Steady', 'SpareA', 'SpareB', 'SpareC'];

let items: Record<string, SeededRow>;
let closer: SeededRow;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  closer = seedCloseStaff(`QA Close Closer ${TAG}`);
  items = seedCloseItems(TAG, ITEM_KEYS);
});

test.beforeEach(() => {
  resetCloseWorld();
});

test.afterAll(() => {
  // Leave the dev database the way it was found: no reconciled items of ours
  // (an uncounted one is a standing discrepancy for every other suite that
  // closes a day) and one open day with nothing recorded against it.
  resetCloseWorld();
  clearCloseFixtures();
  openCloseDay({
    businessDate: businessDate(0),
    openedByStaffMemberId: closer.id,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A business date this suite owns. 2027-07 is clear of the 2027-06 block the
 * packaging suite uses, and each test takes its own offset so a leaked row is
 * obvious rather than silently reused.
 */
function businessDate(offset: number): string {
  const base = Date.UTC(2027, 6, 1); // 2027-07-01
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form autofocuses its first field on the next animation frame; waiting
  // for that stops it stealing focus mid-fill and routing the password into the
  // username box.
  await expect(page.locator('#staff-username')).toBeFocused();
  await page.locator('#staff-username').fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

/**
 * Seed one scenario's world and land on its close screen, signed in.
 *
 * The rendered Expected cash figure is asserted here rather than assumed. Every
 * cash case below is expressed as an exact peso string relative to it, so if the
 * expected-cash formula or the opening float ever changes, this fails loudly
 * instead of silently turning a "balanced" case into a discrepant one.
 */
async function arrange(
  page: Page,
  offset: number,
  shape: CountShape = {},
): Promise<void> {
  const date = businessDate(offset);
  openCloseDay({ businessDate: date, openedByStaffMemberId: closer.id });
  seedBalancedCounts({ businessDate: date, submittedBy: closer, ...shape });

  await signInAsStaff(page);
  await page.goto('/pos/close');
  await expect(page.locator('.staff-inventory-screen')).toBeVisible();
  await expect(page.locator('.staff-inventory-loading')).toHaveCount(0);
  await expect(page.locator('.staff-close-day-form')).toBeVisible();
  expect(
    (await page.locator('.staff-cash-summary .total dd').innerText()).trim(),
    'expected cash on a day with no sales is the opening float',
  ).toBe(EXPECTED_CASH);
}

function actualCashInput(page: Page): Locator {
  return page.locator('#actualCash');
}

function reasonInput(page: Page): Locator {
  return page.locator('#varianceReason');
}

function closedBySelect(page: Page): Locator {
  return page.locator('#closedBy');
}

function closeDayButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Close day', exact: true });
}

function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

function dialogEntry(page: Page, name: string): Locator {
  return page
    .locator('.close-confirm-list > li')
    .filter({ hasText: name });
}

/** Every entry name the dialog lists, in render order. */
async function dialogEntryNames(page: Page): Promise<string[]> {
  return (await page.locator('.close-confirm-entry-name').allInnerTexts()).map(
    (text) => text.trim(),
  );
}

/**
 * One dialog entry's figures, keyed by their own label.
 *
 * Reading the labels rather than indexing positionally matters because cash has
 * only a Balance while an item has Expected, Actual and Balance — a positional
 * read would quietly compare a cash balance against an item's expected
 * quantity.
 */
async function dialogFigures(
  page: Page,
  name: string,
): Promise<Record<string, string>> {
  const groups = dialogEntry(page, name).locator(
    '.close-confirm-entry-figures > div',
  );
  const count = await groups.count();
  expect(count, `figure groups for "${name}"`).toBeGreaterThan(0);
  const figures: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    const label = (await group.locator('dt').innerText()).trim();
    figures[label] = (await group.locator('dd').innerText()).trim();
  }
  return figures;
}

/** Fill the close form, leaving the reason blank unless one is given. */
async function fillCloseForm(
  page: Page,
  input: { actualCash: string; reason?: string },
): Promise<void> {
  await actualCashInput(page).fill(input.actualCash);
  if (input.reason !== undefined) await reasonInput(page).fill(input.reason);
  await closedBySelect(page).selectOption({ label: closer.name });
}

/** Assert nothing has been closed: no closing record and the day still OPEN. */
function expectStillOpen(offset: number): void {
  expect(readDayClosings(), 'no day-closing record').toEqual([]);
  expect(readTradingDayStatuses(), 'the day is still open').toEqual([
    { businessDate: businessDate(offset), status: 'OPEN' },
  ]);
}

// ---------------------------------------------------------------------------
// No discrepancy — the dialog must not appear at all
// ---------------------------------------------------------------------------

test('a fully balanced day closes directly, with no confirmation dialog', async ({
  page,
}) => {
  await arrange(page, 1);
  await fillCloseForm(page, { actualCash: CASH_BALANCED });

  // Balanced cash is the case a falsiness check on the variance gets wrong: a
  // zero discrepancy is not "no discrepancy available", it is "no discrepancy".
  await expect(page.locator('.staff-discrepancy strong')).toHaveText(
    '₱0.00 Balanced',
  );

  await closeDayButton(page).click();

  // The gate is synchronous — it runs before the close request is issued — so a
  // dialog that was going to appear is already in the DOM here, and nothing but
  // one of its own buttons can dismiss it.
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  await expect(dialog(page)).toHaveCount(0);

  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  expect(closings[0]!.actualCashCents).toBe(OPENING_FLOAT_CENTS);
  expect(closings[0]!.varianceCents).toBe(0);
  expect(readTradingDayStatuses()).toEqual([
    { businessDate: businessDate(1), status: 'CLOSED' },
  ]);
});

// ---------------------------------------------------------------------------
// Cash discrepancies
// ---------------------------------------------------------------------------

test('cash over opens the dialog, lists only the cash discrepancy, and does not close the day', async ({
  page,
}) => {
  await arrange(page, 2);
  await fillCloseForm(page, { actualCash: CASH_OVER });
  await closeDayButton(page).click();

  const panel = dialog(page);
  await expect(panel).toBeVisible();

  // The day is still open at this point — the whole purpose of the step.
  expectStillOpen(2);

  // Accessibility: a modal dialog with an accessible name, and focus inside the
  // panel on open rather than left behind on the Close day button.
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  await expect(panel).toHaveAccessibleName(
    'Close the day with these discrepancies?',
  );
  await expect(panel.getByRole('button', { name: 'Go back' })).toBeFocused();

  // The dialog states that administrators will see the discrepancies.
  await expect(panel).toContainText('visible to administrators');

  // Cash only: every reconciled item on this day is balanced, so no item may
  // appear. This is the assertion a dialog that lists all rows fails.
  expect(await dialogEntryNames(page)).toEqual(['Cash in drawer']);
  expect(await dialogFigures(page, 'Cash in drawer')).toEqual({
    Balance: '▴ Over ₱5.00',
  });

  // The dialog requires no reason and carries no reason field of its own.
  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel.locator('input')).toHaveCount(0);
});

test('cash short opens the dialog with the short direction', async ({
  page,
}) => {
  await arrange(page, 3);
  await fillCloseForm(page, { actualCash: CASH_SHORT });
  await closeDayButton(page).click();

  await expect(dialog(page)).toBeVisible();
  expect(await dialogEntryNames(page)).toEqual(['Cash in drawer']);
  expect(await dialogFigures(page, 'Cash in drawer')).toEqual({
    Balance: '▾ Short ₱5.00',
  });
  expectStillOpen(3);
});

// ---------------------------------------------------------------------------
// Cup / lid discrepancies
// ---------------------------------------------------------------------------

test('an item over and an item short open the dialog on their own, and the balanced item is not listed', async ({
  page,
}) => {
  // Cash balances and only the packaging side is wrong, so this also proves the
  // two gates are not accidentally ANDed together.
  await arrange(page, 4, {
    closingOverrides: {
      [items.Cup!.id]: BALANCED_QTY - 5,
      [items.Lid!.id]: BALANCED_QTY + 5,
    },
  });
  await fillCloseForm(page, { actualCash: CASH_BALANCED });
  await closeDayButton(page).click();

  await expect(dialog(page)).toBeVisible();

  const names = await dialogEntryNames(page);
  expect(names.sort()).toEqual([items.Cup!.name, items.Lid!.name].sort());
  // Balanced cash is absent, and so is the balanced control item.
  expect(names).not.toContain('Cash in drawer');
  expect(names).not.toContain(items.Steady!.name);

  expect(await dialogFigures(page, items.Cup!.name)).toEqual({
    Expected: '50',
    Actual: '45',
    Balance: '▾ Short 5',
  });
  expect(await dialogFigures(page, items.Lid!.name)).toEqual({
    Expected: '50',
    Actual: '55',
    Balance: '▴ Over 5',
  });

  expectStillOpen(4);
});

test('an item with no closing count submitted is a discrepancy, shown as unknown rather than zero', async ({
  page,
}) => {
  // No closing count at all: every item's actual quantity is unknown. The
  // distinction this asserts is unknown-versus-zero — a null variance rendered
  // as a balanced 0, or as "Short 0", is the regression.
  await arrange(page, 5, { noClosingCount: true });
  await fillCloseForm(page, { actualCash: CASH_BALANCED });
  await closeDayButton(page).click();

  await expect(dialog(page)).toBeVisible();
  const names = await dialogEntryNames(page);
  expect(names).not.toContain('Cash in drawer');
  for (const key of ITEM_KEYS) {
    expect(names, `${key} is listed as unknown`).toContain(items[key]!.name);
  }

  const figures = await dialogFigures(page, items.Cup!.name);
  expect(figures).toEqual({
    Expected: '50',
    Actual: '— no closing count',
    Balance: '— needs closing count',
  });
  expect(figures.Balance).not.toMatch(/Short|Over|Balanced/);

  expectStillOpen(5);
});

test('missing opening, missing closing and missing-both counts each render as unknown', async ({
  page,
}) => {
  // A closing count exists here, so an item left out of it reads "— not in
  // count" rather than "— no closing count". The screen separates the two and
  // the dialog must not collapse them.
  await arrange(page, 6, {
    omitFromClosing: [items.Cup!.id],
    omitFromOpening: [items.Lid!.id],
  });
  await fillCloseForm(page, { actualCash: CASH_BALANCED });
  await closeDayButton(page).click();

  await expect(dialog(page)).toBeVisible();
  const names = await dialogEntryNames(page);
  expect(names.sort()).toEqual([items.Cup!.name, items.Lid!.name].sort());
  expect(names).not.toContain(items.Steady!.name);

  expect(await dialogFigures(page, items.Cup!.name)).toEqual({
    Expected: '50',
    Actual: '— not in count',
    Balance: '— needs closing count',
  });
  expect(await dialogFigures(page, items.Lid!.name)).toEqual({
    Expected: '— no opening count',
    Actual: '50',
    Balance: '— needs opening count',
  });

  expectStillOpen(6);
});

test('an item missing from both counts shows both quantities as unknown', async ({
  page,
}) => {
  await arrange(page, 7, {
    omitFromOpening: [items.Cup!.id],
    omitFromClosing: [items.Cup!.id],
  });
  await fillCloseForm(page, { actualCash: CASH_BALANCED });
  await closeDayButton(page).click();

  await expect(dialog(page)).toBeVisible();
  expect(await dialogEntryNames(page)).toEqual([items.Cup!.name]);
  expect(await dialogFigures(page, items.Cup!.name)).toEqual({
    Expected: '— no opening count',
    Actual: '— not in count',
    Balance: '— needs both counts',
  });

  expectStillOpen(7);
});

// ---------------------------------------------------------------------------
// Go back, and closing anyway
// ---------------------------------------------------------------------------

test('Go back keeps every entered value and the day open, and a changed reason is what the close records', async ({
  page,
}) => {
  await arrange(page, 8, {
    closingOverrides: { [items.Cup!.id]: BALANCED_QTY - 2 },
  });
  await fillCloseForm(page, { actualCash: CASH_SHORT, reason: 'first note' });

  const closeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/trading-day/close')) {
      closeRequests.push(request.url());
    }
  });

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(dialog(page)).toHaveCount(0);

  // Nothing was sent and nothing was stored.
  expect(closeRequests, 'Go back must not send the close').toEqual([]);
  expectStillOpen(8);

  // Everything already entered survives the dismissal.
  await expect(actualCashInput(page)).toHaveValue(CASH_SHORT);
  await expect(reasonInput(page)).toHaveValue('first note');
  await expect(closedBySelect(page)).toHaveValue(closer.id);
  // Focus returns to the control that opened the dialog.
  await expect(closeDayButton(page)).toBeFocused();

  // The reason can be changed, and Close day chosen again.
  await reasonInput(page).fill('second note');
  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  // The dialog is re-evaluated against current values, not a stale snapshot.
  expect(await dialogEntryNames(page)).toContain('Cash in drawer');
  await page.getByRole('button', { name: 'Close day anyway' }).click();

  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );

  // Exactly one closing record, carrying the CHANGED reason. A Go back /
  // Close day anyway cycle that minted a second attempt id would show up here
  // as two rows.
  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  expect(closings[0]!.varianceReason).toBe('second note');
  expect(closings[0]!.actualCashCents).toBe(OPENING_FLOAT_CENTS - 500);
  expect(closings[0]!.varianceCents).toBe(-500);
  expect(closings[0]!.closedByNameSnapshot).toBe(closer.name);
  expect(readTradingDayStatuses()).toEqual([
    { businessDate: businessDate(8), status: 'CLOSED' },
  ]);
  expect(closeRequests).toHaveLength(1);

  // And the stored record is what the screen reads back.
  const panel = page.locator('[aria-labelledby="last-closing-title"]');
  await expect(panel).toContainText('second note');
  await expect(panel).toContainText('▾ Short ₱5.00');
});

test('Close day anyway with a blank reason closes the day, recording no reason', async ({
  page,
}) => {
  await arrange(page, 9, {
    closingOverrides: { [items.Cup!.id]: BALANCED_QTY + 3 },
  });
  // Reason deliberately left untouched — the optional field stays optional and
  // the dialog must not start requiring it.
  await fillCloseForm(page, { actualCash: CASH_BALANCED });
  await expect(reasonInput(page)).toHaveValue('');

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close day anyway' }).click();

  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  const closings = readDayClosings();
  expect(closings).toHaveLength(1);
  expect(closings[0]!.varianceReason).toBeNull();
  await expect(
    page.locator('[aria-labelledby="last-closing-title"]'),
  ).toContainText('—');
});

// ---------------------------------------------------------------------------
// Modality: Escape and the backdrop behave as Go back
// ---------------------------------------------------------------------------

test('Escape and the backdrop dismiss the dialog without closing the day, and the form behind it is inert', async ({
  page,
}) => {
  await arrange(page, 10, {
    closingOverrides: { [items.Lid!.id]: BALANCED_QTY - 1 },
  });
  await fillCloseForm(page, { actualCash: CASH_OVER, reason: 'kept' });

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();

  // While the dialog is open the form behind it cannot be used: the backdrop
  // takes the pointer. `trial` runs the actionability checks — including the
  // hit-target test — without ever dispatching the click, so this cannot
  // accidentally confirm anything.
  let formWasInert = false;
  try {
    await closeDayButton(page).click({ trial: true, timeout: 2_000 });
  } catch {
    formWasInert = true;
  }
  expect(formWasInert, 'the backdrop must intercept clicks on the form').toBe(
    true,
  );

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expectStillOpen(10);
  await expect(actualCashInput(page)).toHaveValue(CASH_OVER);
  await expect(reasonInput(page)).toHaveValue('kept');

  // Re-open, then dismiss by the backdrop. The click is placed in a corner so
  // it lands on the backdrop rather than on the centred panel.
  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page
    .locator('.logout-dialog-backdrop')
    .click({ position: { x: 4, y: 4 } });
  await expect(dialog(page)).toHaveCount(0);
  expectStillOpen(10);
});

// ---------------------------------------------------------------------------
// Validation runs first
// ---------------------------------------------------------------------------

test('field validation is shown before the dialog, which appears only once the form is valid', async ({
  page,
}) => {
  await arrange(page, 11, {
    closingOverrides: { [items.Cup!.id]: BALANCED_QTY - 7 },
  });

  // Actual cash empty on a day that definitely has a discrepancy.
  await closedBySelect(page).selectOption({ label: closer.name });
  await actualCashInput(page).fill('');
  await closeDayButton(page).click();
  await expect(page.locator('#actualCash-error')).toHaveText(
    'Enter the actual cash counted.',
  );
  await expect(dialog(page)).toHaveCount(0);

  // Cash filled, Closed by cleared: the other blocking field, same ordering.
  await actualCashInput(page).fill(CASH_SHORT);
  await closedBySelect(page).selectOption('');
  await closeDayButton(page).click();
  await expect(page.locator('#closedBy-error')).toHaveText(
    'Choose the staff member closing the day.',
  );
  await expect(dialog(page)).toHaveCount(0);
  expectStillOpen(11);

  // Now the form is otherwise valid — and only now does the dialog appear.
  await closedBySelect(page).selectOption({ label: closer.name });
  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(await dialogEntryNames(page)).toContain(items.Cup!.name);
  expectStillOpen(11);
});

// ---------------------------------------------------------------------------
// Many entries, and the in-flight / failure paths
// ---------------------------------------------------------------------------

test('a long discrepancy list still lists every entry and leaves both actions clickable', async ({
  page,
}) => {
  // Six discrepant items plus cash: enough for the dialog's entry list to need
  // its own scroll area while the actions stay reachable.
  const overrides = Object.fromEntries(
    ITEM_KEYS.map((key, index) => [items[key]!.id, BALANCED_QTY + index + 1]),
  );
  await arrange(page, 12, { closingOverrides: overrides });
  await fillCloseForm(page, { actualCash: CASH_SHORT });

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();

  const names = await dialogEntryNames(page);
  expect(names).toHaveLength(ITEM_KEYS.length + 1);
  expect(names[0]).toBe('Cash in drawer');
  for (const key of ITEM_KEYS) expect(names).toContain(items[key]!.name);

  // Clicked, not merely asserted visible — an action button that exists but is
  // covered by the scrolling list is a false pass.
  await page.getByRole('button', { name: 'Close day anyway' }).click();
  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  expect(readDayClosings()).toHaveLength(1);
});

test('while the close is in flight neither dialog action can be used again', async ({
  page,
}) => {
  await arrange(page, 13, {
    closingOverrides: { [items.Cup!.id]: BALANCED_QTY - 4 },
  });
  await fillCloseForm(page, { actualCash: CASH_OVER });

  let closeAttempts = 0;
  await page.route('**/trading-day/close', async (route) => {
    closeAttempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();

  // Scoped to the dialog: while the close is in flight the form's own submit
  // button relabels to "Closing day…" too, so an unscoped name match is
  // ambiguous.
  const confirm = dialog(page).getByRole('button', {
    name: /Close day anyway|Closing day/,
  });
  await confirm.click();

  // Both actions are disabled while the request is outstanding, so a second
  // click cannot mint a second close.
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  await expect(dialog(page).getByRole('button', { name: 'Go back' })).toBeDisabled();

  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  expect(closeAttempts, 'exactly one close request').toBe(1);
  expect(readDayClosings()).toHaveLength(1);
});

test('a failed close leaves the day open with the error and the entered values, and the retry closes it exactly once', async ({
  page,
}) => {
  await arrange(page, 14, {
    closingOverrides: { [items.Lid!.id]: BALANCED_QTY + 6 },
  });
  await fillCloseForm(page, { actualCash: CASH_SHORT, reason: 'kept across failure' });

  let failNext = true;
  await page.route('**/trading-day/close', async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: CLOSE_FAILURE_MESSAGE }),
      });
      return;
    }
    await route.continue();
  });

  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close day anyway' }).click();

  // The dialog gives way to the form's existing error, the day stays open, and
  // nothing entered is lost.
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.staff-close-day-form')).toContainText(
    CLOSE_FAILURE_MESSAGE,
  );
  expectStillOpen(14);
  await expect(actualCashInput(page)).toHaveValue(CASH_SHORT);
  await expect(reasonInput(page)).toHaveValue('kept across failure');
  await expect(closedBySelect(page)).toHaveValue(closer.id);

  // Retrying re-evaluates the current values, shows the dialog again, and
  // records the close once — not twice.
  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(await dialogEntryNames(page)).toContain(items.Lid!.name);
  await page.getByRole('button', { name: 'Close day anyway' }).click();

  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  expect(readDayClosings()).toHaveLength(1);
  expect(readTradingDayStatuses()).toEqual([
    { businessDate: businessDate(14), status: 'CLOSED' },
  ]);
});

// ---------------------------------------------------------------------------
// The administrator reads the reason back on Reports
// ---------------------------------------------------------------------------

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

test('the reason recorded at close is what the administrator sees on Reports and in the CSV', async ({
  page,
  browser,
}) => {
  // A comma makes the CSV assertion prove the field is quoted, not just present.
  const reason = 'Short ₱5, gave a regular the wrong change';
  const date = businessDate(15);
  await arrange(page, 15);
  await fillCloseForm(page, { actualCash: CASH_SHORT, reason });
  await closeDayButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close day anyway' }).click();
  await expect(page.locator('.staff-close-success')).toHaveText(
    'Business day closed.',
  );
  expect(readDayClosings().map((closing) => closing.varianceReason)).toEqual([
    reason,
  ]);

  // The administrator signs in on a separate session; the staff session above
  // is never reused for an admin route.
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await admin.goto('/sign-in');
    await admin.locator('#username').fill(ADMIN_USERNAME);
    await admin.locator('#password').fill(ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await expect(admin).toHaveURL(/\/dashboard$/);

    await admin.goto('/reports');
    await expect(admin.locator('.applied-range')).toBeVisible();
    const filter = admin.locator('.report-filter');
    await filter.locator('label', { hasText: 'From' }).locator('input').fill(date);
    await filter.locator('label', { hasText: 'To' }).locator('input').fill(date);
    await admin.getByRole('button', { name: 'Apply range' }).click();

    const table = admin.getByRole('table', { name: 'Daily reconciliation' });
    const row = table.locator('tbody tr', { hasText: date });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').last()).toHaveText(reason);
    await expect(
      table.getByRole('columnheader', { name: 'Variance reason' }),
    ).toBeVisible();

    const [download] = await Promise.all([
      admin.waitForEvent('download'),
      admin.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) {
      chunks.push(Buffer.from(chunk));
    }
    const lines = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/);
    expect(lines[0]!.endsWith(',Variance,Variance reason')).toBe(true);
    expect(lines.slice(1)).toEqual([
      `${date},closed,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,1000.00,995.00,-5.00,"${reason}"`,
    ]);
  } finally {
    await adminContext.close();
  }
});
