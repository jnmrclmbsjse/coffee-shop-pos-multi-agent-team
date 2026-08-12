import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  countMembersLinkedToAccount,
  countSelections,
  readAccountsByUsername,
  readLatestSelection,
  readSaleAttributions,
  readStaffMemberLink,
  unlinkStaffAccount,
} from './fixtures/staff-accounts';
import {
  openOrderDay,
  resetOrderWorld,
  seedOrderCatalog,
  type SeededOrderCatalog,
} from './fixtures/take-order';
import { shopToday } from './fixtures/reporting-seed';

/**
 * End-to-end coverage for story #287 — "Create staff login accounts and default
 * the signed-in cashier" (QA Task #299).
 *
 * Two halves, both exercised through the real browser → web app → NestJS API →
 * PostgreSQL path:
 *
 *  1. **Provisioning.** An administrator creates a login account for an active
 *     roster member from the staff page, and every refusal in ADR 0012 §2 is
 *     checked as a *negative*: the message on screen is asserted, and then the
 *     database is asked whether anything was created or changed. A refusal that
 *     leaves an orphan `User` behind would still show the right message.
 *  2. **Default cashier at sign-in.** ADR 0012 §4 makes the sign-in write a
 *     server fact — one appended `CashierSelection` row — so the assertions
 *     check both what the POS shows and what `GET /sales/active-cashier`
 *     reports for the device.
 *
 * Device identity
 * ---------------
 * The default cashier is keyed on the client `deviceId` in localStorage
 * (ADR 0007 §4), so a Playwright context *is* a device. Fresh contexts are the
 * default; the no-inheritance tests deliberately reuse one context across a
 * sign-out so that the device carries the previous session's cashier into the
 * next sign-in — that inheritance is exactly what the cleared-row branch of
 * ADR 0012 §4 has to prevent.
 *
 * Fixtures
 * --------
 * Roster members and accounts are created through the real admin API/UI and
 * tagged per run. Neither the roster (ADR 0003, deactivate-not-delete) nor the
 * account table has a delete surface, so rows from earlier runs persist by
 * design and every assertion is scoped to this run's tag. Usernames are unique
 * per run for the same reason.
 *
 * The seeded `staff` account (linked to "Coffee Shop Staff", with a PIN) is the
 * stand-in for "another member who requires a PIN" when switching cashiers.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

/** The seeded roster member linked to the `staff` account — the PIN-gated one. */
const PIN_CASHIER = process.env.E2E_STAFF_DISPLAY_NAME ?? 'Coffee Shop Staff';

// Must be the origin the web app itself calls: the session cookie is
// host-scoped. Vite reads env files from apps/web, so the repo-root
// VITE_API_URL is not picked up and the app falls back to localhost:3000.
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const DEVICE_ID_KEY = 'ucm.staff-auth.device-id.v1';
const NO_CASHIER_LABEL = 'No cashier selected';
const GENERIC_SIGN_IN_FAILURE =
  'We could not sign you in. Check your details and try again.';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
/** A per-run unique, searchable tag. */
function newTag(): string {
  seq += 1;
  return `qa299-${RUN}-${seq}`;
}

/** Usernames are globally unique forever (no delete surface), so tag them. */
function newUsername(prefix = 'user'): string {
  return `qa299${prefix}${RUN}${(seq += 1)}`.toLowerCase();
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

// ---- admin-side setup helpers ---------------------------------------------

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

async function setMemberActive(id: string, isActive: boolean): Promise<void> {
  const response = await admin.patch(`/staff/${id}`, { data: { isActive } });
  expect(
    response.ok(),
    `updating ${id} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

/** Call the real provisioning endpoint without asserting the outcome. */
function createAccountRequest(
  staffMemberId: string,
  body: Record<string, unknown>,
) {
  return admin.post(`/staff/${staffMemberId}/account`, { data: body });
}

async function createAccount(
  staffMemberId: string,
  body: { username: string; password: string; pin?: string; displayName?: string },
): Promise<void> {
  const response = await createAccountRequest(staffMemberId, body);
  expect(
    response.ok(),
    `creating "${body.username}" failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

// ---- sign-in helpers -------------------------------------------------------

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Fill and submit the staff username + password form.
 *
 * The form focuses its first field on the next animation frame
 * (StaffSignIn.tsx `showView`); typing before that lands is re-routed into the
 * username box, so the focus is awaited before anything is typed.
 */
async function submitStaffPassword(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  const usernameField = page.locator('#staff-username');
  const passwordField = page.locator('#staff-password');
  await expect(usernameField).toBeFocused();
  await usernameField.fill(username);
  await passwordField.fill(password);
  await expect(usernameField).toHaveValue(username);
  await expect(passwordField).toHaveValue(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function staffSignIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await submitStaffPassword(page, username, password);
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await expect(indicator(page)).toBeVisible();
}

/** Sign in with the device-remembered PIN path (ADR 0002). */
async function staffPinSignIn(
  page: Page,
  displayName: string,
  pin: string,
): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: new RegExp(displayName) }).click();
  await expect(page.getByText('Enter your 4-digit staff PIN.')).toBeVisible();
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.locator('.staff-pin-cell.is-filled')).toHaveCount(4);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

/** Drop the session cookie but keep localStorage — i.e. the same device. */
async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

// ---- POS locators ----------------------------------------------------------

function indicator(page: Page): Locator {
  return page.locator('.cashier-indicator');
}

function indicatorName(page: Page): Locator {
  return indicator(page).locator('strong');
}

function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

function cashierCard(page: Page, displayName: string): Locator {
  return page.locator('.cashier-card').filter({ hasText: displayName });
}

function shellClear(page: Page): Locator {
  return page.locator('.cashier-shell-clear');
}

function keypad(page: Page): Locator {
  return page.locator('.cashier-keypad');
}

async function openPicker(page: Page): Promise<void> {
  await indicator(page).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Select cashier' }),
  ).toBeVisible();
  await expect(page.locator('.cashier-card-skeleton')).toHaveCount(0);
}

async function deviceId(page: Page): Promise<string> {
  const id = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    DEVICE_ID_KEY,
  );
  expect(id, 'the POS should have a device id').toBeTruthy();
  return id!;
}

/** The server's view of the selection for this browser's device. */
async function serverActiveCashier(
  page: Page,
): Promise<{ id: string; displayName: string } | null> {
  const id = await deviceId(page);
  const response = await page.request.get(
    `${API_BASE_URL}/sales/active-cashier?deviceId=${encodeURIComponent(id)}`,
  );
  expect(response.ok()).toBe(true);
  return (
    (await response.json()) as {
      cashier: { id: string; displayName: string } | null;
    }
  ).cashier;
}

/** Assert the POS *and* the server agree on who the cashier is. */
async function expectActiveCashier(
  page: Page,
  member: { id: string; displayName: string },
): Promise<void> {
  await expect(indicatorName(page)).toHaveText(member.displayName);
  expect(await serverActiveCashier(page)).toEqual({
    id: member.id,
    displayName: member.displayName,
  });
}

async function expectNoActiveCashier(page: Page): Promise<void> {
  await expect(indicatorName(page)).toHaveText(NO_CASHIER_LABEL);
  expect(await serverActiveCashier(page)).toBeNull();
}

/** Who the POS shell says is signed in — the account, not the cashier. */
function signedInAs(page: Page, displayName: string): Locator {
  return page.getByText(`Signed in as ${displayName}`);
}

// ---- admin staff-page helpers ---------------------------------------------

async function gotoStaffRow(page: Page, member: StaffMemberPayload): Promise<void> {
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
  await page.getByPlaceholder('Search by name').fill(member.displayName);
  await expect(
    page.locator('.staff-table tbody tr').filter({ hasText: member.displayName }),
  ).toHaveCount(1);
}

async function openAccountDialog(
  page: Page,
  member: StaffMemberPayload,
): Promise<void> {
  await page
    .getByRole('button', {
      name: `Create login account for ${member.displayName}`,
    })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Create login account' }),
  ).toBeVisible();
  // The dialog focuses the username field on the next animation frame.
  await expect(page.locator('#staff-account-username')).toBeFocused();
}

async function fillAccountForm(
  page: Page,
  values: { username?: string; password?: string; pin?: string; displayName?: string },
): Promise<void> {
  if (values.username !== undefined) {
    await page.locator('#staff-account-username').fill(values.username);
  }
  if (values.displayName !== undefined) {
    await page.locator('#staff-account-displayName').fill(values.displayName);
  }
  if (values.password !== undefined) {
    await page.locator('#staff-account-password').fill(values.password);
  }
  if (values.pin !== undefined) {
    await page.locator('#staff-account-pin').fill(values.pin);
  }
}

function submitAccountForm(page: Page): Promise<void> {
  return page.getByRole('button', { name: 'Create account' }).click();
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

test('provisioning: an admin creates an account from the staff page and the new credentials sign in', async ({
  page,
  browser,
}) => {
  const tag = newTag();
  const member = await createMember(`Barista ${tag}`);
  const username = newUsername('new');
  const password = 'a strong  pass Word';
  const pin = '4821';

  await signInAsAdmin(page);
  await gotoStaffRow(page, member);
  await openAccountDialog(page, member);

  // The display name is prefilled from the roster member (ADR 0012 §1).
  await expect(page.locator('#staff-account-displayName')).toHaveValue(
    member.displayName,
  );
  await fillAccountForm(page, { username, password, pin });
  await submitAccountForm(page);

  await expect(
    dialog(page).getByRole('heading', { name: 'Login account created' }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(username);
  await expect(dialog(page)).toContainText(member.displayName);

  // The submitted secrets are not echoed back into the interface.
  const dialogHtml = await dialog(page).innerHTML();
  expect(dialogHtml).not.toContain(password);
  expect(dialogHtml).not.toContain(pin);
  const pageHtml = await page.content();
  expect(pageHtml).not.toContain(password);
  expect(pageHtml).not.toContain(pin);

  await dialog(page).getByRole('button', { name: 'Done' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText(`${member.displayName}'s login account was created.`),
  ).toBeVisible();

  // Stored as a STAFF account, linked 1:1 to this roster member.
  const accounts = readAccountsByUsername(username);
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({
    username,
    role: 'STAFF',
    isActive: true,
    hasPin: true,
    linkedStaffMemberId: member.id,
  });
  expect(readStaffMemberLink(member.id).userId).toBe(accounts[0]!.id);
  expect(countMembersLinkedToAccount(accounts[0]!.id)).toBe(1);

  // The credentials work in the existing staff sign-in experience, on a device
  // that has never seen this account.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await staffSignIn(staffPage, username, password);
  await expect(signedInAs(staffPage, member.displayName)).toBeVisible();
  await staffContext.close();
});

test('provisioning: a missing password is refused with a field explanation and creates nothing', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`NoPassword ${tag}`);
  const username = newUsername('nopass');

  await signInAsAdmin(page);
  await gotoStaffRow(page, member);
  await openAccountDialog(page, member);
  await fillAccountForm(page, { username, password: '' });
  await submitAccountForm(page);

  await expect(page.locator('#staff-account-password-error')).toHaveText(
    'Enter a password.',
  );
  await expect(
    dialog(page).getByRole('heading', { name: 'Login account created' }),
  ).toHaveCount(0);

  expect(readAccountsByUsername(username)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();

  // The same refusal at the API, where an empty password cannot be typed away.
  const response = await createAccountRequest(member.id, { username, password: '' });
  expect(response.status()).toBe(400);
  expect(JSON.stringify(await response.json()).toLowerCase()).toContain('password');
  expect(readAccountsByUsername(username)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();
});

test('provisioning: a missing or blank username is refused and creates nothing', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`NoUsername ${tag}`);

  await signInAsAdmin(page);
  await gotoStaffRow(page, member);
  await openAccountDialog(page, member);
  await fillAccountForm(page, { username: '', password: 'whatever-password' });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-username-error')).toHaveText(
    'Enter a username.',
  );

  // An all-space username is a distinct case: it is non-empty until trimmed.
  await fillAccountForm(page, { username: '   ' });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-username-error')).toHaveText(
    'Enter a username that is not only spaces.',
  );
  await expect(
    dialog(page).getByRole('heading', { name: 'Login account created' }),
  ).toHaveCount(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();

  // The API refuses both shapes too, so the rule is not merely client-side.
  for (const username of ['', '   ']) {
    const response = await createAccountRequest(member.id, {
      username,
      password: 'whatever-password',
    });
    expect(
      response.status(),
      `username ${JSON.stringify(username)} should be refused`,
    ).toBe(400);
    expect(readStaffMemberLink(member.id).userId).toBeNull();
  }
});

test('provisioning: a PIN that is not exactly 4 digits is refused and creates nothing', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`BadPin ${tag}`);
  const username = newUsername('badpin');

  await signInAsAdmin(page);
  await gotoStaffRow(page, member);
  await openAccountDialog(page, member);

  await fillAccountForm(page, { username, password: 'pin-test-password', pin: '123' });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-pin-error')).toHaveText(
    'Enter exactly 4 digits, or leave the PIN blank.',
  );

  await fillAccountForm(page, { pin: '12345' });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-pin-error')).toHaveText(
    'Enter exactly 4 digits, or leave the PIN blank.',
  );

  await fillAccountForm(page, { pin: '12a4' });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-pin-error')).toHaveText(
    'Use digits only, or leave the PIN blank.',
  );

  expect(readAccountsByUsername(username)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();

  for (const pin of ['123', '12345', '12a4', '1 23']) {
    const response = await createAccountRequest(member.id, {
      username,
      password: 'pin-test-password',
      pin,
    });
    expect(response.status(), `pin ${JSON.stringify(pin)} should be refused`).toBe(
      400,
    );
    expect(JSON.stringify(await response.json()).toLowerCase()).toContain('pin');
  }
  expect(readAccountsByUsername(username)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();

  // An account with no PIN at all is valid — the PIN is optional (ADR 0012 §1).
  await fillAccountForm(page, { pin: '' });
  await submitAccountForm(page);
  await expect(
    dialog(page).getByRole('heading', { name: 'Login account created' }),
  ).toBeVisible();
  await expect(
    dialog(page).locator('.staff-account-success dl > div').filter({
      hasText: 'PIN set',
    }),
  ).toContainText('No');
  expect(readAccountsByUsername(username)[0]).toMatchObject({
    hasPin: false,
    linkedStaffMemberId: member.id,
  });
});

test('provisioning: a username differing only by case is refused, and the one account still resolves', async ({
  page,
  browser,
}) => {
  const tag = newTag();
  const jane = await createMember(`Jane ${tag}`);
  const other = await createMember(`Other ${tag}`);
  const username = newUsername('jane');
  const password = 'jane-password';

  // `jane` exists first, created through the real endpoint.
  await createAccount(jane.id, { username, password });
  const original = readAccountsByUsername(username);
  expect(original).toHaveLength(1);

  // ADR 0012 §3: `Jane` must be refused at the API, where the raw casing
  // survives the client's own lower-casing.
  const apiResponse = await createAccountRequest(other.id, {
    username: username.toUpperCase(),
    password: 'someone-else',
  });
  expect(apiResponse.status()).toBe(409);
  const apiBody = (await apiResponse.json()) as Record<string, unknown>;
  expect(JSON.stringify(apiBody).toLowerCase()).toContain('username');

  // Leading/trailing spaces are likewise not a different username.
  const spacedResponse = await createAccountRequest(other.id, {
    username: `  ${username}  `,
    password: 'someone-else',
  });
  expect(spacedResponse.status()).toBe(409);

  // And the administrator sees a clear explanation in the interface.
  await signInAsAdmin(page);
  await gotoStaffRow(page, other);
  await openAccountDialog(page, other);
  await fillAccountForm(page, {
    username: username.toUpperCase(),
    password: 'someone-else',
  });
  await submitAccountForm(page);
  await expect(page.locator('#staff-account-username-error')).toContainText(
    'already in use',
  );
  await expect(
    dialog(page).getByRole('heading', { name: 'Login account created' }),
  ).toHaveCount(0);

  // Neither record changed: still exactly one account, still linked to Jane,
  // and the other member still has none.
  const after = readAccountsByUsername(username);
  expect(after).toHaveLength(1);
  expect(after[0]).toEqual(original[0]);
  expect(readStaffMemberLink(other.id).userId).toBeNull();
  expect(readStaffMemberLink(jane.id).userId).toBe(original[0]!.id);

  // The regression this ADR exists to prevent: sign-in is unambiguous. An
  // all-caps username resolves to the single stored account.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await staffSignIn(staffPage, username.toUpperCase(), password);
  await expect(signedInAs(staffPage, jane.displayName)).toBeVisible();
  await expectActiveCashier(staffPage, jane);
  await staffContext.close();
});

test('provisioning: an inactive roster member cannot be given an account', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Inactive ${tag}`, false);
  const username = newUsername('inactive');

  await signInAsAdmin(page);
  await gotoStaffRow(page, member);

  // The affordance is replaced by an explanation rather than silently missing.
  // Scoped to this member's row — the roster keeps every inactive member every
  // run of this suite ever created, so the message is on the page many times.
  const row = page
    .locator('.staff-table tbody tr')
    .filter({ hasText: member.displayName });
  await expect(
    row.getByRole('button', {
      name: `Create login account for ${member.displayName}`,
    }),
  ).toHaveCount(0);
  await expect(row.getByText('Activate staff to create an account')).toBeVisible();

  // The rule is enforced by the server, not only by the hidden button.
  const response = await createAccountRequest(member.id, {
    username,
    password: 'inactive-password',
  });
  expect(response.status()).toBe(409);
  expect(JSON.stringify(await response.json()).toLowerCase()).toContain('inactive');
  expect(readAccountsByUsername(username)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBeNull();

  // A member that does not exist at all is a 404, and creates nothing.
  const missing = await createAccountRequest(randomUUID(), {
    username,
    password: 'inactive-password',
  });
  expect(missing.status()).toBe(404);
  expect(readAccountsByUsername(username)).toHaveLength(0);
});

test('provisioning: a roster member with an account cannot be given a second one', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Twice ${tag}`);
  const first = newUsername('first');
  const second = newUsername('second');

  await createAccount(member.id, { username: first, password: 'first-password' });
  const firstAccount = readAccountsByUsername(first)[0]!;

  // A different, free username is still refused: the member is the constraint.
  const response = await createAccountRequest(member.id, {
    username: second,
    password: 'second-password',
  });
  expect(response.status()).toBe(409);
  expect(JSON.stringify(await response.json()).toLowerCase()).toContain(
    'already has a login account',
  );
  expect(readAccountsByUsername(second)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBe(firstAccount.id);
  expect(countMembersLinkedToAccount(firstAccount.id)).toBe(1);

  // The administrator sees the same refusal in the dialog, which stays open
  // and states that nothing was created.
  await signInAsAdmin(page);
  await gotoStaffRow(page, member);
  await openAccountDialog(page, member);
  await fillAccountForm(page, { username: second, password: 'second-password' });
  await submitAccountForm(page);
  await expect(dialog(page)).toContainText('No account was created.');
  await expect(dialog(page)).toContainText('already has a login account');
  expect(readAccountsByUsername(second)).toHaveLength(0);
  expect(readStaffMemberLink(member.id).userId).toBe(firstAccount.id);
  expect(countMembersLinkedToAccount(firstAccount.id)).toBe(1);
});

test('privilege separation: a created staff account cannot reach an admin-only area by URL', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Guarded ${tag}`);
  const username = newUsername('guarded');
  const password = 'guarded-password';
  await createAccount(member.id, { username, password });

  await staffSignIn(page, username, password);

  // Navigating, not just checking that a nav link is hidden: a hidden link
  // over a reachable route is the failure worth catching.
  await page.goto('/staff');
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toHaveCount(0);
  await expect(page.locator('.staff-table')).toHaveCount(0);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await page.goto('/catalog/products');
  await expect(page).toHaveURL(/\/pos(\/order)?$/);

  // The API refuses the admin surfaces outright, and the session is still a
  // staff session afterwards.
  for (const path of ['/staff', '/staff/' + member.id + '/account']) {
    const response = await page.request.fetch(`${API_BASE_URL}${path}`, {
      method: path.endsWith('/account') ? 'POST' : 'GET',
      data: path.endsWith('/account')
        ? { username: newUsername('escalate'), password: 'escalation' }
        : undefined,
    });
    expect(response.status(), `${path} should be refused for STAFF`).toBe(403);
  }

  const session = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect(session.ok()).toBe(true);
  expect((await session.json()).user.role).toBe('STAFF');
  await expect(signedInAs(page, member.displayName)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Default cashier at sign-in
// ---------------------------------------------------------------------------

test('default cashier: a linked active member becomes the cashier at sign-in with no PIN prompt', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Default ${tag}`);
  const username = newUsername('default');
  const password = 'default-password';
  // A PIN is configured deliberately: ADR 0012 §5 says the cashier PIN gate
  // does not apply to the signed-in user's own member, so a prompt here is a
  // defect and its absence has to be asserted.
  await createAccount(member.id, { username, password, pin: '9137' });

  await staffSignIn(page, username, password);

  await expect(signedInAs(page, member.displayName)).toBeVisible();
  await expectActiveCashier(page, member);
  await expect(dialog(page)).toHaveCount(0);
  await expect(keypad(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cashier PIN' })).toHaveCount(0);
});

test('default cashier: survives a reload and a cold deep entry into the POS', async ({
  page,
  browser,
}) => {
  const tag = newTag();
  const member = await createMember(`Persist ${tag}`);
  const username = newUsername('persist');
  const password = 'persist-password';
  await createAccount(member.id, { username, password });

  await staffSignIn(page, username, password);
  await expectActiveCashier(page, member);

  await page.reload();
  await expectActiveCashier(page, member);

  // A cold deep entry: a brand new context carrying only the stored session and
  // device id, landing straight on a POS route rather than walking there from
  // the sign-in page.
  const state = await page.context().storageState();
  const coldContext = await browser.newContext({ storageState: state });
  const coldPage = await coldContext.newPage();
  await coldPage.goto('/pos/orders');
  await expect(coldPage).toHaveURL(/\/pos\/orders(?:\?|$)/);
  await expectActiveCashier(coldPage, member);
  await coldContext.close();
});

test('no inheritance: an unlinked account signing in on the same device selects no cashier', async ({
  page,
  context,
}) => {
  const tag = newTag();
  const linked = await createMember(`Handover ${tag}`);
  const unlinkedOwner = await createMember(`Unlinked ${tag}`);
  const linkedUser = newUsername('handover');
  const unlinkedUser = newUsername('unlinked');
  await createAccount(linked.id, { username: linkedUser, password: 'handover-pass' });
  await createAccount(unlinkedOwner.id, {
    username: unlinkedUser,
    password: 'unlinked-pass',
  });
  // Unlinking is out of scope of #287 (ADR 0012 §1), so the state is produced
  // by dropping the link after the real endpoint created the account.
  unlinkStaffAccount(unlinkedOwner.id);

  await staffSignIn(page, linkedUser, 'handover-pass');
  await expectActiveCashier(page, linked);

  // Same device (localStorage survives), new session.
  await signOut(context);
  await staffSignIn(page, unlinkedUser, 'unlinked-pass');

  await expectNoActiveCashier(page);
  await expect(indicatorName(page)).not.toHaveText(linked.displayName);
  // The picker is still available, so the till is one tap from correct.
  await openPicker(page);
  await expect(cashierCard(page, linked.displayName)).toHaveCount(1);
});

test('no inheritance: an account linked to an inactive member selects no cashier', async ({
  page,
  context,
}) => {
  const tag = newTag();
  const first = await createMember(`Active ${tag}`);
  const deactivated = await createMember(`Deactivated ${tag}`);
  const firstUser = newUsername('activefirst');
  const deactivatedUser = newUsername('deactivated');
  await createAccount(first.id, { username: firstUser, password: 'active-pass' });
  await createAccount(deactivated.id, {
    username: deactivatedUser,
    password: 'deactivated-pass',
  });
  await setMemberActive(deactivated.id, false);

  await staffSignIn(page, firstUser, 'active-pass');
  await expectActiveCashier(page, first);

  await signOut(context);
  await staffSignIn(page, deactivatedUser, 'deactivated-pass');

  await expectNoActiveCashier(page);
  await expect(indicatorName(page)).not.toHaveText(first.displayName);
  // The account itself still works — only the cashier attribution is withheld.
  await expect(signedInAs(page, deactivated.displayName)).toBeVisible();
});

test('switching: staff can switch from the default cashier without changing the signed-in account', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Switcher ${tag}`);
  const colleague = await createMember(`Colleague ${tag}`);
  const username = newUsername('switch');
  await createAccount(member.id, { username, password: 'switch-pass' });

  await staffSignIn(page, username, 'switch-pass');
  await expectActiveCashier(page, member);

  await openPicker(page);
  await cashierCard(page, colleague.displayName).click();
  await expect(dialog(page)).toHaveCount(0);

  await expectActiveCashier(page, colleague);
  // The identity in the shell, not just the cashier chip: the switch must not
  // have changed who is signed in.
  await expect(signedInAs(page, member.displayName)).toBeVisible();
  const session = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect((await session.json()).user.username).toBe(username);
});

test('switching: a cancelled dialog and a failed PIN both leave the default cashier unchanged', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Unchanged ${tag}`);
  const username = newUsername('unchanged');
  await createAccount(member.id, { username, password: 'unchanged-pass' });

  await staffSignIn(page, username, 'unchanged-pass');
  await expectActiveCashier(page, member);

  // Cancelled.
  await openPicker(page);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectActiveCashier(page, member);

  // Failed PIN on a member that requires one (ADR 0007 §3 still applies to
  // claiming *another* identity from inside the session).
  await openPicker(page);
  await cashierCard(page, PIN_CASHIER).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Cashier PIN' }),
  ).toBeVisible();
  for (const digit of '1111') {
    await keypad(page).getByRole('button', { name: digit, exact: true }).click();
  }
  await dialog(page).getByRole('button', { name: 'Confirm PIN' }).click();
  await expect(dialog(page).locator('.cashier-failure')).toBeVisible();

  // The keypad's Cancel returns to the picker; a second Cancel closes it.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Select cashier' }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectActiveCashier(page, member);
});

test('clearing: the cashier can be cleared without signing the account out', async ({
  page,
}) => {
  const tag = newTag();
  const member = await createMember(`Clearer ${tag}`);
  const username = newUsername('clear');
  await createAccount(member.id, { username, password: 'clear-pass' });

  await staffSignIn(page, username, 'clear-pass');
  await expectActiveCashier(page, member);

  await shellClear(page).click();
  await expectNoActiveCashier(page);

  await expect(signedInAs(page, member.displayName)).toBeVisible();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  // The picker remains available after clearing.
  await openPicker(page);
  await expect(cashierCard(page, member.displayName)).toHaveCount(1);
});

test('a later sign-in replaces a deliberate manual switch on that device (ADR 0012 §4)', async ({
  page,
  context,
}) => {
  const tag = newTag();
  const member = await createMember(`Override ${tag}`);
  const colleague = await createMember(`Overridden ${tag}`);
  const username = newUsername('override');
  const pin = '3096';
  await createAccount(member.id, { username, password: 'override-pass', pin });

  await staffSignIn(page, username, 'override-pass');
  await expectActiveCashier(page, member);

  // A deliberate manual switch away from the default.
  await openPicker(page);
  await cashierCard(page, colleague.displayName).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectActiveCashier(page, colleague);

  // Signing out alone does not clear the device's cashier.
  await signOut(context);
  await page.goto('/staff/sign-in');
  await expect(
    page.getByRole('button', { name: new RegExp(member.displayName) }),
  ).toBeVisible();

  // The next successful sign-in — here via the remembered-staff PIN path, which
  // ADR 0012 §4 covers as well — overrides the manual selection. That is the
  // intended till-handover behaviour, asserted so a change to it is caught.
  await staffPinSignIn(page, member.displayName, pin);
  await expectActiveCashier(page, member);
});

test('attribution: an existing order keeps its cashier when another account signs in on the device', async ({
  page,
  context,
}) => {
  const tag = newTag();
  resetOrderWorld();
  const catalog: SeededOrderCatalog = seedOrderCatalog(tag);
  const variantId = catalog.products.latte!.variants.regular!.id;

  const cashier = await createMember(`Attributed ${tag}`);
  const successor = await createMember(`Successor ${tag}`);
  const cashierUser = newUsername('attributed');
  const successorUser = newUsername('successor');
  await createAccount(cashier.id, { username: cashierUser, password: 'attributed-pass' });
  openOrderDay({ businessDate: shopToday(), openedByStaffMemberId: cashier.id });

  await staffSignIn(page, cashierUser, 'attributed-pass');
  await expectActiveCashier(page, cashier);

  // The order goes through the real capture endpoint, so the attribution is
  // resolved server-side from the device's selection rather than supplied by a
  // seeding script that would set the columns itself.
  const clientGeneratedId = randomUUID();
  const created = await page.request.post(`${API_BASE_URL}/orders`, {
    data: {
      clientGeneratedId,
      deviceId: await deviceId(page),
      productVariantId: variantId,
      quantity: 2,
      customerName: `Guest ${tag}`,
    },
  });
  expect(
    created.ok(),
    `placing the order failed: ${created.status()} ${await created.text()}`,
  ).toBe(true);

  const before = readSaleAttributions();
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({
    clientGeneratedId,
    cashierStaffMemberId: cashier.id,
    cashierNameSnapshot: cashier.displayName,
  });

  // A new account is created and signs in on the same device afterwards.
  await createAccount(successor.id, {
    username: successorUser,
    password: 'successor-pass',
  });
  await signOut(context);
  await staffSignIn(page, successorUser, 'successor-pass');
  await expectActiveCashier(page, successor);

  // The recorded attribution has not moved.
  const after = readSaleAttributions();
  expect(after).toEqual(before);
});

test('sign-in refusals: a wrong password for a created account changes nothing on the device', async ({
  page,
  context,
}) => {
  const tag = newTag();
  const member = await createMember(`Refused ${tag}`);
  const username = newUsername('refused');
  await createAccount(member.id, { username, password: 'right-password' });

  await staffSignIn(page, username, 'right-password');
  await expectActiveCashier(page, member);
  const device = await deviceId(page);

  const selectionsBefore = countSelections(device);

  await signOut(context);
  await submitStaffPassword(page, username, 'wrong-password');
  await expect(page.getByRole('alert')).toContainText(GENERIC_SIGN_IN_FAILURE);
  await expect(page).toHaveURL(/\/staff\/sign-in/);

  // A refused sign-in writes no selection: the device's cashier is untouched
  // and the append-only log did not grow. Read from the log rather than the
  // API, which needs the session the refusal denied.
  expect(readLatestSelection(device)).toEqual({
    staffMemberId: member.id,
    displayName: member.displayName,
  });
  expect(countSelections(device)).toBe(selectionsBefore);
});
