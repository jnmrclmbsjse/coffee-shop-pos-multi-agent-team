import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * End-to-end coverage for story #165 — "Select the active cashier for order
 * attribution" (QA Task #171).
 *
 * The picker, the PIN gate, the active-cashier indicator, switching, clearing,
 * persistence and device scoping are exercised through the real
 * browser → web app → NestJS API → PostgreSQL path (no stubbing).
 *
 * Fixtures
 * --------
 * - The seeded `staff` user (apps/api/prisma/seed.ts) is linked to the roster
 *   member "Coffee Shop Staff" and owns a 4-digit PIN, so that member is the
 *   PIN-gated one (ADR 0007 §2: "requires a PIN" = linked `User` with a
 *   non-null `pinHash`).
 * - PIN-free members are created per test through the admin roster API, tagged
 *   with a unique suffix. The roster has no delete surface (ADR 0003,
 *   deactivate-not-delete), so rows from earlier runs persist by design and
 *   every assertion is scoped to this run's tag.
 *
 * Device scoping
 * --------------
 * The active cashier is server-side state keyed on the client `deviceId`
 * (ADR 0007 §4), and the device id lives in localStorage. Each Playwright test
 * gets a fresh browser context, hence a fresh device — which is also what keeps
 * the PIN throttle (keyed device+user) from leaking between tests.
 *
 * Deferred criteria
 * -----------------
 * The story's order-integration criteria (an order started after a cashier
 * becomes active is attributed to that cashier; changes affect subsequent
 * orders only; earlier orders keep their snapshot) are NOT covered here: there
 * is no order-creation endpoint yet, so nothing writes
 * `Sale.cashierStaffMemberId` / `cashierNameSnapshot`. ADR 0007 §6 makes that a
 * forward obligation of the order-taking story, and #171 explicitly defers them
 * out of this story's scope.
 *
 * One edge case identified in preparation is likewise not reachable end to end:
 * a roster member linked to a *deactivated* `User` must still require a PIN and
 * fail generically (ADR 0007 §2). Linking a roster member to an account and
 * deactivating an account are both seed/migration-only in v1 — there is no API
 * surface for either — so the case cannot be set up through the product. It is
 * covered by the API unit tests (`apps/api/src/auth/auth.service.spec.ts`,
 * `!user.isActive` branch) and is flagged on the QA task.
 */

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const STAFF_PIN = process.env.E2E_STAFF_PIN ?? '0000';
/** The seeded roster member linked to the `staff` account, i.e. the PIN-gated one. */
const PIN_CASHIER = process.env.E2E_STAFF_DISPLAY_NAME ?? 'Coffee Shop Staff';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// Must be the origin the web app itself calls: the session cookie is
// host-scoped. Vite reads env files from apps/web, so the repo-root
// VITE_API_URL is not picked up and the app falls back to localhost:3000.
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

/** The single non-identifying failure the API returns for any refused PIN. */
const GENERIC_PIN_FAILURE = 'Unable to authorize cashier.';
const NO_CASHIER_LABEL = 'No cashier selected';

// ADR 0002 throttle policy, reused by cashier authorization (ADR 0007 §3).
const THROTTLE_MAX_FAILURES = Number(
  process.env.E2E_AUTH_THROTTLE_MAX_FAILURES ?? 5,
);
const THROTTLE_COOLDOWN_SECONDS = Number(
  process.env.E2E_AUTH_THROTTLE_COOLDOWN_SECONDS ?? 30,
);

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-test tag that is also a unique, searchable substring. */
function newTag(): string {
  seq += 1;
  return `qa171-${RUN}-${seq}`;
}

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
}

let admin: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  admin = await playwright.request.newContext({ baseURL: API_BASE_URL });
  const response = await admin.post('/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(
    response.ok(),
    `admin sign-in failed (${response.status()}): ${await response.text()}`,
  ).toBe(true);
});

test.afterAll(async () => {
  await admin.dispose();
});

/** Create a roster member through the admin API (test setup only). */
async function createMember(
  displayName: string,
  isActive = true,
): Promise<StaffMemberPayload> {
  const response = await admin.post('/staff', { data: { displayName, isActive } });
  expect(
    response.ok(),
    `seeding "${displayName}" failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as StaffMemberPayload;
}

async function updateMember(
  id: string,
  data: { displayName?: string; isActive?: boolean },
): Promise<void> {
  const response = await admin.patch(`/staff/${id}`, { data });
  expect(
    response.ok(),
    `updating ${id} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

// ---- page object helpers ---------------------------------------------------

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  // The form focuses its first field on the next animation frame
  // (StaffSignIn.tsx `showView`). Typing before that lands can be re-routed to
  // the username box, so wait for the focus to settle first.
  const username = page.locator('#staff-username');
  const password = page.locator('#staff-password');
  await expect(username).toBeFocused();
  await username.fill(STAFF_USERNAME);
  await password.fill(STAFF_PASSWORD);
  await expect(username).toHaveValue(STAFF_USERNAME);
  await expect(password).toHaveValue(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(indicator(page)).toBeVisible();
}

/** The always-visible active-cashier indicator in the POS shell. */
function indicator(page: Page): Locator {
  return page.locator('.cashier-indicator');
}

/** The name the indicator currently shows ("No cashier selected" when none). */
function indicatorName(page: Page): Locator {
  return indicator(page).locator('strong');
}

function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

function card(page: Page, displayName: string): Locator {
  return page.locator('.cashier-card').filter({ hasText: displayName });
}

/** The shell-level "Clear" button, shown only while a cashier is active. */
function shellClear(page: Page): Locator {
  return page.locator('.cashier-shell-clear');
}

function keypad(page: Page): Locator {
  return page.locator('.cashier-keypad');
}

function failure(page: Page): Locator {
  return dialog(page).locator('.cashier-failure');
}

async function openPicker(page: Page): Promise<void> {
  await indicator(page).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Select cashier' }),
  ).toBeVisible();
  // The roster load is asynchronous; wait for it to settle before asserting on
  // membership so an empty grid is never mistaken for "not offered".
  await expect(page.locator('.cashier-card-skeleton')).toHaveCount(0);
}

/** Tap PIN digits on the on-screen keypad (no physical keyboard). */
async function tapPin(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    await keypad(page).getByRole('button', { name: digit, exact: true }).click();
  }
}

async function confirmPin(page: Page): Promise<void> {
  await dialog(page).getByRole('button', { name: 'Confirm PIN' }).click();
}

/** Open the picker and select a PIN-free member; the dialog closes on success. */
async function selectPinFree(page: Page, displayName: string): Promise<void> {
  await openPicker(page);
  await card(page, displayName).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(displayName);
}

/** Open the picker, choose the PIN-gated member and enter `pin`. */
async function attemptPinCashier(page: Page, pin: string): Promise<void> {
  await openPicker(page);
  await card(page, PIN_CASHIER).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Cashier PIN' }),
  ).toBeVisible();
  await tapPin(page, pin);
  await confirmPin(page);
}

/** Simulate sign-out: drop the session cookie, keep localStorage (the device). */
async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/** The server's view of the selection for this browser's device. */
async function serverActiveCashier(
  page: Page,
): Promise<{ id: string; displayName: string } | null> {
  const deviceId = await page.evaluate(() =>
    window.localStorage.getItem('ucm.staff-auth.device-id.v1'),
  );
  expect(deviceId, 'the POS should have a device id').toBeTruthy();
  const response = await page.request.get(
    `${API_BASE_URL}/sales/active-cashier?deviceId=${encodeURIComponent(deviceId!)}`,
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { cashier: { id: string; displayName: string } | null })
    .cashier;
}

/**
 * A message is "non-identifying" when it neither names the person being
 * selected nor says which part of the attempt was wrong (ADR 0007 §3).
 */
function expectNonIdentifying(message: string, displayName: string): void {
  expect(message).not.toContain(displayName);
  expect(message.toLowerCase()).not.toMatch(
    /incorrect|wrong|invalid pin|unknown|no such|not found|incomplete|too short|digits|deactivat|inactive|locked/,
  );
}

// ---------------------------------------------------------------------------
// AC 1 — the picker opens from the POS and offers touch-sized cards
// ---------------------------------------------------------------------------

test('AC1: the POS opens a cashier picker whose cards are at least 44x44', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Picker ${tag}`);
  await signInAsStaff(page);

  await openPicker(page);
  await expect(
    dialog(page).getByText(
      'Choose who should be attributed to new orders on this register.',
    ),
  ).toBeVisible();

  const memberCard = card(page, member.displayName);
  await expect(memberCard).toHaveCount(1);
  await memberCard.scrollIntoViewIfNeeded();
  const box = await memberCard.boundingBox();
  expect(box, 'the card must be rendered').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // The PIN-gated seeded member is offered too, marked as gated by the server's
  // `requiresPin` projection rather than by anything the client decides.
  await expect(card(page, PIN_CASHIER)).toContainText('PIN required');
  await expect(memberCard).toContainText('Selects now');
});

// ---------------------------------------------------------------------------
// AC 2 — only active roster members are offered
// ---------------------------------------------------------------------------

test('AC2: only active roster members are offered as choices', async ({ page }) => {
  const tag = newTag();
  const active = await createMember(`Active ${tag}`);
  const inactive = await createMember(`Inactive ${tag}`, false);
  await signInAsStaff(page);

  await openPicker(page);
  await expect(card(page, active.displayName)).toHaveCount(1);
  await expect(card(page, inactive.displayName)).toHaveCount(0);

  // Deactivating a member removes them from the choices on the next open.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await updateMember(active.id, { isActive: false });

  await openPicker(page);
  await expect(card(page, active.displayName)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// AC 3 — the POS always states who is active, or that nobody is
// ---------------------------------------------------------------------------

test('AC3: the POS shows the active cashier by name, or that none is selected', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Indicator ${tag}`);
  await signInAsStaff(page);

  await expect(indicator(page)).toContainText('Active cashier');
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);

  await selectPinFree(page, member.displayName);
  await expect(indicatorName(page)).toHaveText(member.displayName);

  // The indicator is part of the POS shell, so it is consistent across screens.
  await page.getByRole('link', { name: 'Order History' }).click();
  await expect(page).toHaveURL(/\/pos\/orders(?:\?|$)/);
  await expect(indicatorName(page)).toHaveText(member.displayName);
});

// ---------------------------------------------------------------------------
// AC 4 — a member with no PIN configured activates with no PIN prompt
// ---------------------------------------------------------------------------

test('AC4: selecting a member without a PIN activates them with no PIN prompt', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`NoPin ${tag}`);
  await signInAsStaff(page);

  await openPicker(page);
  await card(page, member.displayName).click();

  // No keypad is ever shown, and the selection is immediately server-side.
  await expect(keypad(page)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(member.displayName);
  expect(await serverActiveCashier(page)).toEqual({
    id: member.id,
    displayName: member.displayName,
  });
});

// ---------------------------------------------------------------------------
// AC 5 + AC 6 — a PIN-gated member is prompted, and the correct PIN activates
// without changing who is signed in
// ---------------------------------------------------------------------------

test('AC5/AC6: a PIN-gated member is prompted, and the correct PIN activates them', async ({
  page,
}) => {
  await signInAsStaff(page);
  const sessionBefore = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect(sessionBefore.ok()).toBe(true);
  const signedInBefore = await sessionBefore.json();

  await openPicker(page);
  await card(page, PIN_CASHIER).click();

  await expect(
    dialog(page).getByRole('heading', { name: 'Cashier PIN' }),
  ).toBeVisible();
  await expect(keypad(page)).toBeVisible();
  await expect(
    dialog(page).getByText('The signed-in POS user will not change.'),
  ).toBeVisible();
  // Not activated by merely opening the prompt.
  expect(await serverActiveCashier(page)).toBeNull();

  // Entered digits are masked — the PIN itself never appears in the DOM.
  await tapPin(page, STAFF_PIN);
  await expect(page.locator('.cashier-pin-slots .is-filled')).toHaveCount(4);
  await expect(dialog(page)).not.toContainText(STAFF_PIN);

  await confirmPin(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(PIN_CASHIER);
  expect((await serverActiveCashier(page))?.displayName).toBe(PIN_CASHIER);

  // AC6 — the POS session is untouched: same signed-in user, still on the POS.
  await expect(page).toHaveURL(/\/pos$/);
  const sessionAfter = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect(sessionAfter.ok()).toBe(true);
  expect(await sessionAfter.json()).toEqual(signedInBefore);
});

// ---------------------------------------------------------------------------
// AC 7 — an incorrect or incomplete PIN is refused with the same message
// ---------------------------------------------------------------------------

test('AC7: incorrect and incomplete PINs are refused with one identical, non-identifying message', async ({
  page,
}) => {
  await signInAsStaff(page);

  await attemptPinCashier(page, '9999');
  await expect(failure(page)).toBeVisible();
  const wrongMessage = (await failure(page).textContent())?.trim() ?? '';
  expect(wrongMessage).toBe(GENERIC_PIN_FAILURE);
  // Still on the PIN view, nothing activated, and the entry is cleared.
  await expect(dialog(page).getByRole('heading', { name: 'Cashier PIN' })).toBeVisible();
  await expect(page.locator('.cashier-pin-slots .is-filled')).toHaveCount(0);
  expect(await serverActiveCashier(page)).toBeNull();

  // An incomplete PIN (3 digits submitted) is refused the same way — the client
  // does not short-circuit it with a different, cause-revealing message.
  await tapPin(page, STAFF_PIN.slice(0, 3));
  await confirmPin(page);
  await expect(failure(page)).toBeVisible();
  const incompleteMessage = (await failure(page).textContent())?.trim() ?? '';
  expect(incompleteMessage).toBe(wrongMessage);
  expect(await serverActiveCashier(page)).toBeNull();

  expectNonIdentifying(wrongMessage, PIN_CASHIER);
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
});

// ---------------------------------------------------------------------------
// AC 8 — cancelling closes the prompt with no error and activates nobody
// ---------------------------------------------------------------------------

test('AC8: cancelling PIN entry shows no unsuccessful-attempt error and activates nobody', async ({
  page,
}) => {
  await signInAsStaff(page);

  await openPicker(page);
  await card(page, PIN_CASHIER).click();
  await expect(keypad(page)).toBeVisible();
  await tapPin(page, '12');
  await keypad(page).getByRole('button', { name: 'Cancel' }).click();

  // Back on the picker, with no error anywhere in the dialog.
  await expect(dialog(page).getByRole('heading', { name: 'Select cashier' })).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  expect(await serverActiveCashier(page)).toBeNull();

  // Closing the whole dialog is equally free of an error state.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
});

// ---------------------------------------------------------------------------
// AC 9 — a failed or cancelled attempt leaves the previous cashier in place
// ---------------------------------------------------------------------------

test('AC9: a failed or cancelled attempt at another cashier leaves the previous one active', async ({
  page,
}) => {
  const tag = newTag();
  const first = await createMember(`Previous ${tag}`);
  await signInAsStaff(page);
  await selectPinFree(page, first.displayName);

  // Wrong PIN for a different cashier.
  await attemptPinCashier(page, '9999');
  await expect(failure(page)).toHaveText(GENERIC_PIN_FAILURE);
  await expect(dialog(page).getByRole('button', { name: 'Back' })).toBeVisible();

  // Incomplete PIN for the same different cashier.
  await tapPin(page, '12');
  await confirmPin(page);
  await expect(failure(page)).toHaveText(GENERIC_PIN_FAILURE);

  // Cancelled attempt.
  await keypad(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(indicatorName(page)).toHaveText(first.displayName);
  // The DOM could lie; the server state is what attribution will read.
  expect(await serverActiveCashier(page)).toEqual({
    id: first.id,
    displayName: first.displayName,
  });
  await page.reload();
  await expect(indicatorName(page)).toHaveText(first.displayName);
});

// ---------------------------------------------------------------------------
// Edge — a failed cashier PIN must not disturb the POS session
// ---------------------------------------------------------------------------

test('edge: a failed cashier PIN does not sign the till out', async ({ page }) => {
  await signInAsStaff(page);

  await attemptPinCashier(page, '9999');
  await expect(failure(page)).toHaveText(GENERIC_PIN_FAILURE);

  // Still signed in, still on the POS — not bounced to the staff sign-in screen.
  await expect(page).toHaveURL(/\/pos$/);
  await dialog(page).getByRole('button', { name: 'Back' }).click();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(indicator(page)).toBeVisible();
  const session = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect(session.ok()).toBe(true);
});

// ---------------------------------------------------------------------------
// AC 10 — repeated failures throttle, non-identifyingly, and recover
// ---------------------------------------------------------------------------

test('AC10: repeated failures throttle every attempt for the cooldown, then work again', async ({
  page,
}) => {
  test.setTimeout(120_000 + THROTTLE_COOLDOWN_SECONDS * 1000);
  await signInAsStaff(page);

  await attemptPinCashier(page, '9999');
  await expect(failure(page)).toHaveText(GENERIC_PIN_FAILURE);
  for (let attempt = 2; attempt <= THROTTLE_MAX_FAILURES; attempt += 1) {
    await tapPin(page, '9999');
    await confirmPin(page);
    await expect(failure(page)).toBeVisible();
  }

  // Past the threshold, even the correct PIN is refused for the cooldown.
  await tapPin(page, STAFF_PIN);
  await confirmPin(page);
  await expect(failure(page)).toBeVisible();
  const throttledMessage = (await failure(page).textContent())?.trim() ?? '';
  // The throttle message is time-boxed rather than the generic string (the same
  // posture story #18 established for sign-in), but it must still not identify
  // the person or say what was wrong with the attempt.
  expectNonIdentifying(throttledMessage, PIN_CASHIER);
  expect(await serverActiveCashier(page)).toBeNull();
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);

  // After the cooldown the correct PIN is accepted again.
  await expect(page.locator('.cashier-cooldown')).toBeHidden({
    timeout: (THROTTLE_COOLDOWN_SECONDS + 15) * 1000,
  });
  await tapPin(page, STAFF_PIN);
  await confirmPin(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(PIN_CASHIER);
});

// ---------------------------------------------------------------------------
// AC 11 — a successful selection replaces the previous cashier
// ---------------------------------------------------------------------------

test('AC11: successfully selecting another cashier replaces the previous one', async ({
  page,
}) => {
  const tag = newTag();
  const first = await createMember(`Switch A ${tag}`);
  const second = await createMember(`Switch B ${tag}`);
  await signInAsStaff(page);

  await selectPinFree(page, first.displayName);
  await selectPinFree(page, second.displayName);

  expect(await serverActiveCashier(page)).toEqual({
    id: second.id,
    displayName: second.displayName,
  });
  await openPicker(page);
  await expect(card(page, second.displayName)).toContainText('Currently active');
  await expect(card(page, first.displayName)).not.toContainText('Currently active');
});

// ---------------------------------------------------------------------------
// AC 12 — clearing is always available and never asks for a PIN
// ---------------------------------------------------------------------------

test('AC12: staff can clear the active cashier without entering a PIN', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Clearable ${tag}`);
  await signInAsStaff(page);
  await selectPinFree(page, member.displayName);

  // Clearing from the POS shell.
  await expect(shellClear(page)).toBeVisible();
  await shellClear(page).click();
  await expect(keypad(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
  expect(await serverActiveCashier(page)).toBeNull();

  // Clearing from inside the picker, while a PIN-GATED cashier is active — the
  // gate protects claiming attribution, never giving it up (ADR 0007 §5).
  await attemptPinCashier(page, STAFF_PIN);
  await expect(indicatorName(page)).toHaveText(PIN_CASHIER);

  await openPicker(page);
  await dialog(page).getByRole('button', { name: 'Clear selection' }).click();
  await expect(keypad(page)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
  expect(await serverActiveCashier(page)).toBeNull();

  // Service continues with nobody selected: the POS is still fully usable.
  await page.getByRole('link', { name: 'Order History' }).click();
  await expect(page).toHaveURL(/\/pos\/orders(?:\?|$)/);
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
});

// ---------------------------------------------------------------------------
// AC 13 — deactivating the active member does not clear the selection
// ---------------------------------------------------------------------------

test('AC13: the active cashier stays active after being deactivated, but is no longer offered', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Departing ${tag}`);
  await signInAsStaff(page);
  await selectPinFree(page, member.displayName);

  await updateMember(member.id, { isActive: false });
  await page.reload();

  await expect(indicatorName(page)).toHaveText(member.displayName);
  expect(await serverActiveCashier(page)).toEqual({
    id: member.id,
    displayName: member.displayName,
  });

  await openPicker(page);
  await expect(card(page, member.displayName)).toHaveCount(0);
  await expect(dialog(page).locator('.cashier-current-summary')).toContainText(
    member.displayName,
  );

  // Staff can still explicitly clear it.
  await dialog(page).getByRole('button', { name: 'Clear selection' }).click();
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
});

// ---------------------------------------------------------------------------
// AC 14 — the selection survives a reload and a sign-out/sign-in on the device
// ---------------------------------------------------------------------------

test('AC14: the selection survives a reload and signing out and back in on the same device', async ({
  page,
  context,
}) => {
  const tag = newTag();
  const member = await createMember(`Persistent ${tag}`);
  await signInAsStaff(page);
  await selectPinFree(page, member.displayName);

  await page.reload();
  await expect(indicatorName(page)).toHaveText(member.displayName);

  await signOut(context);
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/staff\/sign-in(?:\?|$)/);
  await signInAsStaff(page);
  await expect(indicatorName(page)).toHaveText(member.displayName);
});

// ---------------------------------------------------------------------------
// AC 15 — the selection is scoped per device
// ---------------------------------------------------------------------------

test('AC15: selecting on one device does not change the cashier on another', async ({
  page,
  browser,
}) => {
  const tag = newTag();
  const first = await createMember(`Till One ${tag}`);
  const second = await createMember(`Till Two ${tag}`);

  await signInAsStaff(page);
  await selectPinFree(page, first.displayName);

  // A second browser context is a second device: its own id, its own selection.
  const otherDevice = await browser.newContext();
  const otherPage = await otherDevice.newPage();
  try {
    await signInAsStaff(otherPage);
    await expect(indicatorName(otherPage)).toHaveText(NO_CASHIER_LABEL);

    await selectPinFree(otherPage, second.displayName);
    await expect(indicatorName(otherPage)).toHaveText(second.displayName);

    // The first till is untouched, including after a reload.
    await page.reload();
    await expect(indicatorName(page)).toHaveText(first.displayName);

    // Clearing on the second device likewise leaves the first alone.
    await shellClear(otherPage).click();
    await expect(indicatorName(otherPage)).toHaveText(NO_CASHIER_LABEL);
    await page.reload();
    await expect(indicatorName(page)).toHaveText(first.displayName);
  } finally {
    await otherDevice.close();
  }
});

// ---------------------------------------------------------------------------
// Edge — renaming the active member is reflected by the live roster read
// ---------------------------------------------------------------------------

test('edge: renaming the active roster member updates the indicator and the picker', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Before ${tag}`);
  await signInAsStaff(page);
  await selectPinFree(page, member.displayName);

  const renamed = `After ${tag}`;
  await updateMember(member.id, { displayName: renamed });
  await page.reload();

  await expect(indicatorName(page)).toHaveText(renamed);
  await openPicker(page);
  await expect(card(page, renamed)).toContainText('Currently active');
  await expect(card(page, member.displayName)).toHaveCount(0);
});
