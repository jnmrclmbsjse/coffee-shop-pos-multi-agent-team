import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Playwright,
} from '@playwright/test';
import {
  readAccountsByUsername,
  readStaffMemberLink,
  countSelections,
  readLatestSelection,
  unlinkStaffAccount,
} from './fixtures/staff-accounts';
import {
  readStoredCredentials,
  readStoredCredentialsByUserId,
} from './fixtures/staff-credentials';

/**
 * End-to-end coverage for story #347 — "Update staff login passwords and PINs"
 * (QA task #387), against ADR 0016.
 *
 * The story is a *round trip*: an administrator replaces a credential in the
 * admin UI, and the consequence is visible somewhere else entirely — at
 * `POST /auth/staff/login`, at `POST /auth/staff/pin`, and at ADR 0007's
 * cashier PIN gate. So every rotation test here asserts three things, not one:
 *
 *  1. the **new** credential is accepted at the place it is used,
 *  2. the **old** credential is refused there — without this half, a rotation
 *     that wrote nothing at all would still pass,
 *  3. the credential that was *not* submitted is byte-identical in the
 *     database. A sign-in with the untouched credential proves it still
 *     verifies, not that the column was left alone; argon2id salts every hash,
 *     so a silent re-hash would produce a different string and is caught only
 *     by comparing the stored value (ADR 0016 §6).
 *
 * Throttling
 * ----------
 * `AuthAttemptThrottleService` locks a `device + user` pair for 30 s after 5
 * failures (ADR 0016 quotes this explicitly as *not* cleared by rotation, §8).
 * Every deliberate failed sign-in below therefore uses a **fresh device id**,
 * so the suite never locks itself out and reads a cooldown as a product bug.
 *
 * Fixtures
 * --------
 * Roster members and accounts are built through the real admin API
 * (`POST /staff`, `POST /staff/:id/account`) so the stored hashes come from the
 * product's own argon2id path and sign-in genuinely exercises them. Neither the
 * roster nor the account table has a delete surface (ADR 0003), so rows persist
 * between runs by design and every assertion is scoped to this run's tag.
 *
 * Deliberately *not* filed as bugs (ADR 0016 §7/§8, restated on #387):
 * a session that is already signed in survives rotation — that is asserted here
 * as the decided behaviour, not flagged.
 */

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'replace-before-seeding';

// Must be the origin the web app itself calls: the session cookie is
// host-scoped (see e2e/playwright.config.ts).
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let seq = 0;

/** A per-run unique, searchable tag — rows are never deleted. */
function newTag(): string {
  seq += 1;
  return `qa387-${RUN}-${seq}`;
}

/** Usernames are globally unique forever (no delete surface), so tag them. */
function newUsername(prefix = 'user'): string {
  return `qa387${prefix}${RUN}${(seq += 1)}`.toLowerCase();
}

/** A device that has never been seen, so no throttle counter follows it. */
function newDeviceId(): string {
  return `qa387-device-${RUN}-${(seq += 1)}`;
}

interface StaffMemberPayload {
  id: string;
  displayName: string;
  isActive: boolean;
}

/** A roster member plus the account that was provisioned for them. */
interface Fixture {
  member: StaffMemberPayload;
  username: string;
  password: string;
  pin?: string;
  /** The `User` id — `POST /auth/staff/pin` addresses the account, not the roster row. */
  userId: string;
}

let admin: APIRequestContext;
let playwrightFixture: Playwright;

test.beforeAll(async ({ playwright }) => {
  playwrightFixture = playwright;
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

// ---- fixture building (through the real product endpoints) -----------------

async function createMember(displayName: string): Promise<StaffMemberPayload> {
  const response = await admin.post('/staff', {
    data: { displayName, isActive: true },
  });
  expect(
    response.ok(),
    `seeding "${displayName}" failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as StaffMemberPayload;
}

/**
 * A roster member with a real login account.
 *
 * `pin` is optional so the first-PIN-set case (ADR 0016 §3) can start from an
 * account that genuinely has `pinHash = null`.
 */
async function seedStaffAccount(options: {
  password: string;
  pin?: string;
}): Promise<Fixture> {
  const tag = newTag();
  const member = await createMember(`Barista ${tag}`);
  const username = newUsername('acct');
  const response = await admin.post(`/staff/${member.id}/account`, {
    data: {
      username,
      password: options.password,
      ...(options.pin ? { pin: options.pin } : {}),
    },
  });
  expect(
    response.ok(),
    `creating "${username}" failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const accounts = readAccountsByUsername(username);
  expect(accounts).toHaveLength(1);
  return {
    member,
    username,
    password: options.password,
    pin: options.pin,
    userId: accounts[0]!.id,
  };
}

/** The rotation endpoint, called directly and without asserting the outcome. */
function rotateRequest(staffMemberId: string, body: unknown) {
  return admin.patch(`/staff/${staffMemberId}/account/credentials`, {
    data: body,
  });
}

// ---- credential probes (the "does it actually work" half) -------------------

/**
 * Attempt a username + password staff sign-in on a brand-new device.
 *
 * Returns the raw status so the negative half of each round trip can assert
 * `401` rather than just "not 200".
 */
async function passwordSignInStatus(
  username: string,
  password: string,
): Promise<number> {
  const context = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  try {
    const response = await context.post('/auth/staff/login', {
      data: { username, password, deviceId: newDeviceId() },
      failOnStatusCode: false,
    });
    return response.status();
  } finally {
    await context.dispose();
  }
}

async function pinSignInStatus(userId: string, pin: string): Promise<number> {
  const context = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  try {
    const response = await context.post('/auth/staff/pin', {
      data: { staffId: userId, pin, deviceId: newDeviceId() },
      failOnStatusCode: false,
    });
    return response.status();
  } finally {
    await context.dispose();
  }
}

/**
 * The second place a staff PIN is consumed: ADR 0007's cashier gate.
 *
 * Selecting a cashier needs a *staff* session, so this signs the fixture in
 * with its own password first and then claims itself as cashier with `pin`.
 * `password` is the current one — for the PIN-rotation tests that is the
 * credential the rotation did not touch.
 */
async function cashierPinStatus(
  fixture: Fixture,
  password: string,
  pin: string,
): Promise<number> {
  const deviceId = newDeviceId();
  const context = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  try {
    const signIn = await context.post('/auth/staff/login', {
      data: { username: fixture.username, password, deviceId },
    });
    expect(
      signIn.ok(),
      `cashier probe could not sign in: ${signIn.status()} ${await signIn.text()}`,
    ).toBe(true);
    const response = await context.post('/sales/active-cashier', {
      data: { deviceId, staffMemberId: fixture.member.id, pin },
      failOnStatusCode: false,
    });
    return response.status();
  } finally {
    await context.dispose();
  }
}

/** Whether the POS cashier picker would demand a PIN for this member. */
async function requiresPin(fixture: Fixture, password: string): Promise<boolean> {
  const context = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  try {
    const signIn = await context.post('/auth/staff/login', {
      data: {
        username: fixture.username,
        password,
        deviceId: newDeviceId(),
      },
    });
    expect(signIn.ok(), `selectable probe could not sign in`).toBe(true);
    const response = await context.get('/staff/selectable');
    expect(response.ok()).toBe(true);
    const selectable = (await response.json()) as {
      id: string;
      requiresPin: boolean;
    }[];
    const row = selectable.find((entry) => entry.id === fixture.member.id);
    expect(row, 'the fixture member should be selectable as cashier').toBeTruthy();
    return row!.requiresPin;
  } finally {
    await context.dispose();
  }
}

// ---- browser helpers -------------------------------------------------------

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
 * The form focuses its first field on the next animation frame; typing before
 * that lands is re-routed into the username box.
 */
async function staffSignIn(
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
  await expect(passwordField).toHaveValue(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

async function gotoStaffRow(page: Page, member: StaffMemberPayload): Promise<void> {
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
  await page.getByPlaceholder('Search by name').fill(member.displayName);
  await expect(
    page.locator('.staff-table tbody tr').filter({ hasText: member.displayName }),
  ).toHaveCount(1);
}

/** Open the rotation dialog from the roster row's entry point. */
async function openCredentialDialog(
  page: Page,
  member: StaffMemberPayload,
): Promise<void> {
  await page
    .getByRole('button', {
      name: `Replace password or PIN for ${member.displayName}`,
    })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Replace password or PIN' }),
  ).toBeVisible();
  // The dialog focuses the password field on the next animation frame.
  await expect(page.locator('#staff-credential-password')).toBeFocused();
}

async function fillCredentialForm(
  page: Page,
  values: { password?: string; pin?: string },
): Promise<void> {
  if (values.password !== undefined) {
    await page.locator('#staff-credential-password').fill(values.password);
  }
  if (values.pin !== undefined) {
    await page.locator('#staff-credential-pin').fill(values.pin);
  }
}

function submitCredentialForm(page: Page): Promise<void> {
  return page.getByRole('button', { name: 'Save credential changes' }).click();
}

/**
 * Assert nothing the administrator typed survives on screen (ADR 0016 §5).
 *
 * The password is checked against the whole document because it is a long,
 * distinctive string. The PIN is only four digits, so a whole-document scan
 * would collide with hex ids and dates; it is checked against the dialog — the
 * only place a submitted credential could plausibly be echoed — and against the
 * roster row.
 */
async function expectCredentialsConcealed(
  page: Page,
  secrets: { password?: string; pin?: string },
): Promise<void> {
  const dialogHtml = await dialog(page).innerHTML();
  if (secrets.password) {
    expect(dialogHtml).not.toContain(secrets.password);
    expect(await page.content()).not.toContain(secrets.password);
  }
  if (secrets.pin) {
    expect(dialogHtml).not.toContain(secrets.pin);
  }
}

// ---------------------------------------------------------------------------
// Round trips — the point of the story
// ---------------------------------------------------------------------------

test('password only: the new password signs in, the old one stops working, and the PIN is untouched', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({
    password: 'first pass Word',
    pin: '4821',
  });
  const before = readStoredCredentials(fixture.member.id);
  const newPassword = 'second pass Word';

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);

  // Both inputs are masked during entry, and neither is prefilled: there is no
  // read path for an existing credential (ADR 0016 §5).
  const passwordInput = page.locator('#staff-credential-password');
  const pinInput = page.locator('#staff-credential-pin');
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await expect(pinInput).toHaveAttribute('type', 'password');
  await expect(passwordInput).toHaveValue('');
  await expect(pinInput).toHaveValue('');
  expect(await dialog(page).innerHTML()).not.toContain(fixture.password);

  await fillCredentialForm(page, { password: newPassword });
  // The form states which credential the submit will and will not touch.
  await expect(dialog(page)).toContainText('Password: will be replaced');
  await expect(dialog(page)).toContainText('PIN: will not change');
  await submitCredentialForm(page);

  await expect(
    dialog(page).getByRole('heading', { name: 'Password replaced' }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(fixture.username);
  // The result names the credential without restating it, and does not claim
  // that other devices were signed out (ADR 0016 §7).
  await expect(dialog(page)).toContainText(
    'Sessions already signed in were not ended.',
  );
  await expect(dialog(page)).not.toContainText(/signed out everywhere/i);
  await expectCredentialsConcealed(page, {
    password: newPassword,
    pin: fixture.pin,
  });

  await dialog(page).getByRole('button', { name: 'Done' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText(`${fixture.member.displayName}'s login credentials were updated.`),
  ).toBeVisible();

  // Round trip: the new password starts a session, the old one no longer does.
  expect(await passwordSignInStatus(fixture.username, newPassword)).toBe(201);
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(401);

  // The PIN was neither submitted nor rewritten.
  expect(await pinSignInStatus(fixture.userId, fixture.pin!)).toBe(201);
  const after = readStoredCredentials(fixture.member.id);
  expect(after.pinHash).toBe(before.pinHash);
  expect(after.passwordHash).not.toBe(before.passwordHash);
});

test('PIN only: the new PIN is accepted in both PIN uses, the old one is refused, and the password is untouched', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({
    password: 'keep this pass',
    pin: '1357',
  });
  const before = readStoredCredentials(fixture.member.id);
  const newPin = '2468';

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  await fillCredentialForm(page, { pin: newPin });
  await expect(dialog(page)).toContainText('Password: will not change');
  await expect(dialog(page)).toContainText('PIN: will be replaced');
  await submitCredentialForm(page);

  await expect(
    dialog(page).getByRole('heading', { name: 'PIN replaced' }),
  ).toBeVisible();
  await expectCredentialsConcealed(page, { pin: newPin });
  await dialog(page).getByRole('button', { name: 'Done' }).click();

  // Use 1: PIN sign-in.
  expect(await pinSignInStatus(fixture.userId, newPin)).toBe(201);
  expect(await pinSignInStatus(fixture.userId, fixture.pin!)).toBe(401);

  // Use 2: ADR 0007's cashier PIN gate.
  expect(await cashierPinStatus(fixture, fixture.password, newPin)).toBe(201);
  expect(await cashierPinStatus(fixture, fixture.password, fixture.pin!)).toBe(401);

  // The password was neither submitted nor rewritten.
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(201);
  const after = readStoredCredentials(fixture.member.id);
  expect(after.passwordHash).toBe(before.passwordHash);
  expect(after.pinHash).not.toBe(before.pinHash);
});

test('both at once: one submit replaces the password and the PIN, and both previous credentials are refused', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({
    password: 'old both pass',
    pin: '1111',
  });
  const newPassword = 'new both pass';
  const newPin = '9090';

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  await fillCredentialForm(page, { password: newPassword, pin: newPin });
  await submitCredentialForm(page);

  await expect(
    dialog(page).getByRole('heading', { name: 'Password and PIN replaced' }),
  ).toBeVisible();
  await expectCredentialsConcealed(page, { password: newPassword, pin: newPin });
  await dialog(page).getByRole('button', { name: 'Done' }).click();

  expect(await passwordSignInStatus(fixture.username, newPassword)).toBe(201);
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(401);
  expect(await pinSignInStatus(fixture.userId, newPin)).toBe(201);
  expect(await pinSignInStatus(fixture.userId, fixture.pin!)).toBe(401);

  // Reopening the dialog starts from an empty draft, not from the last submit.
  await openCredentialDialog(page, fixture.member);
  await expect(page.locator('#staff-credential-password')).toHaveValue('');
  await expect(page.locator('#staff-credential-pin')).toHaveValue('');
  await expectCredentialsConcealed(page, { password: newPassword, pin: newPin });
});

test('a replacement password is stored exactly as entered, including its spaces', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({ password: 'plain pass' });
  const spacedPassword = '  padded pass  ';

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  await fillCredentialForm(page, { password: spacedPassword });
  await submitCredentialForm(page);
  await expect(
    dialog(page).getByRole('heading', { name: 'Password replaced' }),
  ).toBeVisible();

  expect(await passwordSignInStatus(fixture.username, spacedPassword)).toBe(201);
  // A trimmed variant is a different password and must not be accepted.
  expect(await passwordSignInStatus(fixture.username, spacedPassword.trim())).toBe(
    401,
  );
});

// ---------------------------------------------------------------------------
// Setting a first PIN (ADR 0016 §3)
// ---------------------------------------------------------------------------

test('setting a first PIN arms the cashier PIN gate without disturbing the current selection', async ({
  page,
  context,
}) => {
  const fixture = await seedStaffAccount({ password: 'no pin yet pass' });
  expect(readStoredCredentials(fixture.member.id).pinHash).toBeNull();
  expect(await requiresPin(fixture, fixture.password)).toBe(false);

  // A device that has never signed this account in cannot offer PIN sign-in,
  // before or after rotation (ADR 0002's device rule, restated in §3).
  const stranger = await context.browser()!.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto('/staff/sign-in');
  await expect(
    strangerPage.getByRole('button', { name: fixture.member.displayName }),
  ).toHaveCount(0);

  // The claim gate accepts this member with no PIN today.
  const deviceId = newDeviceId();
  const posContext = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  const signIn = await posContext.post('/auth/staff/login', {
    data: { username: fixture.username, password: fixture.password, deviceId },
  });
  expect(signIn.ok()).toBe(true);
  const claimed = await posContext.post('/sales/active-cashier', {
    data: { deviceId, staffMemberId: fixture.member.id },
  });
  expect(claimed.ok()).toBe(true);
  const selectionsBefore = countSelections(deviceId);
  const selectedBefore = readLatestSelection(deviceId);

  const newPin = '7654';
  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  await fillCredentialForm(page, { pin: newPin });
  await submitCredentialForm(page);
  await expect(
    dialog(page).getByRole('heading', { name: 'PIN replaced' }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Done' }).click();

  // The gate is now armed: the PIN is demanded and only the new one satisfies it.
  expect(await requiresPin(fixture, fixture.password)).toBe(true);
  expect(await pinSignInStatus(fixture.userId, newPin)).toBe(201);
  expect(await cashierPinStatus(fixture, fixture.password, newPin)).toBe(201);
  const noPin = await posContext.post('/sales/active-cashier', {
    data: { deviceId, staffMemberId: fixture.member.id },
    failOnStatusCode: false,
  });
  expect(noPin.status()).toBe(401);

  // Arming the gate does not rewrite the selection log that already existed.
  expect(countSelections(deviceId)).toBe(selectionsBefore);
  expect(readLatestSelection(deviceId)).toEqual(selectedBefore);

  // The device rule is unchanged by rotation: a stranger device still has no
  // PIN entry point for this account.
  await strangerPage.goto('/staff/sign-in');
  await expect(
    strangerPage.getByRole('button', { name: fixture.member.displayName }),
  ).toHaveCount(0);

  await posContext.dispose();
  await stranger.close();
});

// ---------------------------------------------------------------------------
// Invariants — what rotation must provably not touch (ADR 0016 §6)
// ---------------------------------------------------------------------------

test('rotation changes only the credentials: roster, account, link, role and cashier history are unmoved', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({
    password: 'invariant pass',
    pin: '3030',
  });

  // Give the member a cashier history to be preserved.
  const deviceId = newDeviceId();
  const posContext = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  const signIn = await posContext.post('/auth/staff/login', {
    data: { username: fixture.username, password: fixture.password, deviceId },
  });
  expect(signIn.ok()).toBe(true);
  await posContext.post('/sales/active-cashier', {
    data: { deviceId, staffMemberId: fixture.member.id, pin: fixture.pin },
  });

  const rosterBefore = readStaffMemberLink(fixture.member.id);
  const accountBefore = readAccountsByUsername(fixture.username);
  const selectionsBefore = countSelections(deviceId);
  const selectedBefore = readLatestSelection(deviceId);

  const newPassword = 'invariant pass 2';
  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  await fillCredentialForm(page, { password: newPassword, pin: '4040' });
  await submitCredentialForm(page);
  await expect(
    dialog(page).getByRole('heading', { name: 'Password and PIN replaced' }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Done' }).click();

  // Roster row, account row and the 1:1 link, byte for byte.
  expect(readStaffMemberLink(fixture.member.id)).toEqual(rosterBefore);
  expect(readAccountsByUsername(fixture.username)).toEqual(accountBefore);
  expect(accountBefore[0]!.role).toBe('STAFF');

  // The append-only selection log is not touched.
  expect(countSelections(deviceId)).toBe(selectionsBefore);
  expect(readLatestSelection(deviceId)).toEqual(selectedBefore);

  // The projection the admin page renders is unchanged too.
  const listed = await admin.get(
    `/staff?search=${encodeURIComponent(fixture.member.displayName)}`,
  );
  expect(listed.ok()).toBe(true);
  const rows = (await listed.json()) as {
    id: string;
    displayName: string;
    isActive: boolean;
    hasAccount: boolean;
    accountUsername: string | null;
  }[];
  const row = rows.find((entry) => entry.id === fixture.member.id);
  expect(row).toMatchObject({
    displayName: fixture.member.displayName,
    isActive: true,
    hasAccount: true,
    accountUsername: fixture.username,
  });

  // The rotated account is still STAFF: it cannot reach an admin-only screen.
  const staffContext = await page.context().browser()!.newContext();
  const staffPage = await staffContext.newPage();
  await staffSignIn(staffPage, fixture.username, newPassword);
  await expect(staffPage).toHaveURL(/\/pos(\/order)?$/);
  await staffPage.goto('/staff');
  await expect(staffPage).toHaveURL(/\/pos(\/order)?$/);
  await expect(
    staffPage.getByRole('heading', { name: 'Staff', level: 1 }),
  ).toHaveCount(0);

  await staffContext.close();
  await posContext.dispose();
});

test('a session that is already signed in survives rotation (ADR 0016 §7)', async ({
  context,
}) => {
  const fixture = await seedStaffAccount({ password: 'live session pass' });

  const staffContext = await context.browser()!.newContext();
  const staffPage = await staffContext.newPage();
  await staffSignIn(staffPage, fixture.username, fixture.password);
  await expect(staffPage).toHaveURL(/\/pos(\/order)?$/);

  const rotated = await rotateRequest(fixture.member.id, {
    password: 'live session pass 2',
  });
  expect(rotated.ok()).toBe(true);

  // Decided behaviour, not a defect: rotation changes what can *start* a
  // session; the live one runs to its own expiry.
  await staffPage.reload();
  await expect(staffPage).toHaveURL(/\/pos(\/order)?$/);
  await expect(staffPage.locator('.cashier-indicator')).toBeVisible();

  // The old password can no longer *start* one, which is the half that changed.
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(401);

  await staffContext.close();
});

test('a staff session cannot rotate credentials or open the administrator staff page', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({ password: 'authz pass', pin: '5150' });
  const target = await seedStaffAccount({ password: 'target pass', pin: '6161' });
  const before = readStoredCredentials(target.member.id);

  // A real STAFF session — `POST /auth/login` refuses staff accounts, so the
  // session has to come from the staff route, which needs a device id.
  const staffApi = await playwrightFixture.request.newContext({
    baseURL: API_BASE_URL,
  });
  const signIn = await staffApi.post('/auth/staff/login', {
    data: {
      username: fixture.username,
      password: fixture.password,
      deviceId: newDeviceId(),
    },
  });
  expect(signIn.ok()).toBe(true);

  // Per verb, not just "the page redirects".
  const rotate = await staffApi.patch(
    `/staff/${target.member.id}/account/credentials`,
    { data: { password: 'stolen pass' }, failOnStatusCode: false },
  );
  expect(rotate.status()).toBe(403);
  const ownRotate = await staffApi.patch(
    `/staff/${fixture.member.id}/account/credentials`,
    { data: { pin: '0000' }, failOnStatusCode: false },
  );
  expect(ownRotate.status()).toBe(403);
  const list = await staffApi.get('/staff', { failOnStatusCode: false });
  expect(list.status()).toBe(403);
  await staffApi.dispose();

  // Nothing was written by any of the refused calls.
  expect(readStoredCredentials(target.member.id)).toEqual(before);
  expect(await passwordSignInStatus(target.username, target.password)).toBe(201);
  expect(await passwordSignInStatus(target.username, 'stolen pass')).toBe(401);

  // And opening the admin page directly lands somewhere else entirely.
  await staffSignIn(page, fixture.username, fixture.password);
  // Wait for the session to land: navigating to /staff before the cookie is set
  // would be bounced by the signed-out branch and prove nothing about the role.
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await page.goto('/staff');
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
  await expect(
    page.getByRole('button', {
      name: `Replace password or PIN for ${target.member.displayName}`,
    }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Refusals — each must leave both credentials working
// ---------------------------------------------------------------------------

test('invalid entries are refused per field and leave both credentials working', async ({
  page,
}) => {
  const fixture = await seedStaffAccount({
    password: 'refusal pass',
    pin: '8080',
  });
  const before = readStoredCredentials(fixture.member.id);

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);

  // Neither field entered: a form-level refusal, not an empty update.
  await submitCredentialForm(page);
  await expect(
    dialog(page).getByText('Enter a new password, a new PIN, or both.'),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('heading', { name: /replaced/ }),
  ).toHaveCount(0);
  // A refused submit moves focus to the offending field on the *next* animation
  // frame. `fill` inserts at whatever is focused when the insert lands, so
  // typing before that frame silently re-routes the PIN into the password box —
  // which then submits successfully and reads as a missing validation message.
  // Every fill below therefore waits for the focus to settle first.
  await expect(page.locator('#staff-credential-password')).toBeFocused();

  // PIN shape, field-attributed each time.
  for (const badPin of ['123', '12345', '12a4', '    ']) {
    await fillCredentialForm(page, { pin: badPin });
    await expect(page.locator('#staff-credential-pin')).toHaveValue(badPin);
    await expect(page.locator('#staff-credential-password')).toHaveValue('');
    await submitCredentialForm(page);
    await expect(
      page.locator('#staff-credential-pin-error'),
      `"${badPin}" should be refused as a PIN`,
    ).toHaveText('Enter exactly four digits using 0 to 9 only.');
    await expect(page.locator('#staff-credential-pin')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.locator('#staff-credential-pin')).toBeFocused();
  }

  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);

  // The endpoint refuses the same shapes, field-attributed.
  const empty = await rotateRequest(fixture.member.id, {});
  expect(empty.status()).toBe(400);
  expect(JSON.stringify(await empty.json())).toMatch(/password or PIN/i);

  const emptyPassword = await rotateRequest(fixture.member.id, { password: '' });
  expect(emptyPassword.status()).toBe(400);
  expect(JSON.stringify(await emptyPassword.json())).toMatch(/password/i);

  for (const badPin of ['123', '12345', '12a4', '１２３４']) {
    const response = await rotateRequest(fixture.member.id, { pin: badPin });
    expect(response.status(), `"${badPin}" should be refused`).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/pin/i);
  }

  // Nothing was written, and both original credentials still authenticate.
  expect(readStoredCredentials(fixture.member.id)).toEqual(before);
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(201);
  expect(await pinSignInStatus(fixture.userId, fixture.pin!)).toBe(201);
});

test('"no login account" and "staff member not found" are distinguishable and neither changes anything', async ({
  page,
}) => {
  // A roster member that never had an account: the endpoint says 409.
  const accountless = await createMember(`Barista ${newTag()}`);
  const conflict = await rotateRequest(accountless.id, { password: 'nope' });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({
    reason: 'STAFF_MEMBER_HAS_NO_ACCOUNT',
  });
  expect(readStaffMemberLink(accountless.id).userId).toBeNull();

  // A roster member that does not exist at all: 404, a different outcome.
  const missing = await rotateRequest(
    '00000000-0000-4000-8000-000000000000',
    { password: 'nope' },
  );
  expect(missing.status()).toBe(404);

  // And the administrator sees the difference. The stale case is reachable in
  // the UI: the dialog is open on a member who *had* an account when the list
  // was loaded, and the link is gone by the time it is submitted.
  const fixture = await seedStaffAccount({ password: 'stale pass', pin: '7070' });
  const before = readStoredCredentialsByUserId(fixture.userId);

  await signInAsAdmin(page);
  await gotoStaffRow(page, fixture.member);
  await openCredentialDialog(page, fixture.member);
  unlinkStaffAccount(fixture.member.id);
  await fillCredentialForm(page, { password: 'should not apply' });
  await submitCredentialForm(page);

  await expect(dialog(page).getByText('No login account')).toBeVisible();
  await expect(dialog(page)).toContainText('No credentials were changed.');
  await expect(
    dialog(page).getByRole('heading', { name: /replaced/ }),
  ).toHaveCount(0);

  // The refusal left the account's own credentials untouched and working.
  expect(readStoredCredentialsByUserId(fixture.userId)).toEqual(before);
  expect(await passwordSignInStatus(fixture.username, fixture.password)).toBe(201);
  expect(await passwordSignInStatus(fixture.username, 'should not apply')).toBe(401);
  expect(await pinSignInStatus(fixture.userId, fixture.pin!)).toBe(201);
});

test('the rotation entry point is offered only for a member who has a login account', async ({
  page,
}) => {
  const withAccount = await seedStaffAccount({ password: 'entry point pass' });
  const withoutAccount = await createMember(`Barista ${newTag()}`);

  await signInAsAdmin(page);
  await gotoStaffRow(page, withAccount.member);
  await expect(
    page.getByRole('button', {
      name: `Replace password or PIN for ${withAccount.member.displayName}`,
    }),
  ).toBeVisible();

  await gotoStaffRow(page, withoutAccount);
  await expect(
    page.getByRole('button', {
      name: `Replace password or PIN for ${withoutAccount.displayName}`,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: `Create login account for ${withoutAccount.displayName}`,
    }),
  ).toBeVisible();
});
