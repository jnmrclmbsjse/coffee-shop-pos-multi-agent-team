import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { shopToday } from './fixtures/reporting-seed';
import {
  openOrderDay,
  resetOrderWorld,
  seedOrderCatalog,
  seedOrderStaff,
  type SeededOrderCatalog,
  type SeededOrderDay,
  type SeededOrderStaff,
} from './fixtures/take-order';
import {
  readSettlementSnapshot,
  seedLegacyCashSale,
} from './fixtures/staff-order-cash-change';

/**
 * End-to-end coverage for story #340 (QA task #344) — Cash received and
 * Expected change on the staff order-history card.
 *
 * The substance of this story is the zero-vs-unavailable-vs-negative
 * distinction, so nothing here asserts merely "a value is shown". Every money
 * assertion pins the exact rendered string, every unavailable assertion pins
 * the accessible name *and* asserts no money is rendered in that field, and the
 * fixture amounts are chosen so a wrong derivation lands on a different number
 * than the right one:
 *
 *  - split: received 90 − cash 50 = 40; subtracting the total gives −30 and
 *    subtracting the online portion gives 20, so neither passes as 40;
 *  - tipped: received 250 − cash 180 = 70; folding the 20 tip in gives 50;
 *  - change owed: expected change 80 against change owed 30, so a card that
 *    reused one for the other is visible.
 *
 * Orders are built through the real capture API (`POST /orders` →
 * `/complete`, `/void`) rather than by inserting sale rows, because
 * `expectedChangeCents` is derived from the settlement snapshot and a
 * hand-written row would supply its own inputs. The two rows the capture path
 * refuses — cash received below the cash portion, and cash received with no
 * CASH tender row — are seeded; see the fixture for why.
 */

test.describe.configure({ mode: 'serial' });

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'staff';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'replace-before-seeding';
const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;
const DEVICE_ID = `qa-344-${RUN}`;

/** Order numbers the capture path assigns, in the order the fixture builds them. */
const ORDER = {
  cashChange: 1,
  exactCash: 2,
  split: 3,
  onlineOnly: 4,
  tipped: 5,
  changeOwed: 6,
  parked: 7,
  voided: 8,
  // 9 is the VOID correction record, which the ledger never renders as a card.
  underTendered: 10,
  cashWithoutCashTender: 11,
} as const;

const CUSTOMER = {
  cashChange: `Cash Change Guest ${RUN}`,
  exactCash: `Exact Cash Guest ${RUN}`,
  split: `Split Guest ${RUN}`,
  onlineOnly: `Online Only Guest ${RUN}`,
  tipped: `Tipped Cash Guest ${RUN}`,
  changeOwed: `Change Owed Guest ${RUN}`,
  parked: `Parked Guest ${RUN}`,
  voided: `Voided Guest ${RUN}`,
  underTendered: `Under Tendered Guest ${RUN}`,
  cashWithoutCashTender: `Legacy Import Guest ${RUN}`,
} as const;

const UNAVAILABLE_CASH_RECEIVED = 'Cash received not recorded';
const UNAVAILABLE_EXPECTED_CHANGE = 'Expected change not available';
const MONEY_PATTERN = /^₱-?\d{1,3}(?:,\d{3})*\.\d{2}$/;

let catalog: SeededOrderCatalog;
let staffMember: SeededOrderStaff;
let day: SeededOrderDay;

// ---- capture helpers --------------------------------------------------------

interface Payment {
  method: 'CASH' | 'ONLINE';
  amountCents: number;
}

async function signInApi(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/auth/staff/login`, {
    data: {
      username: STAFF_USERNAME,
      password: STAFF_PASSWORD,
      deviceId: DEVICE_ID,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Build one order through the capture API and, unless `complete` is null,
 * settle it. Returns the client-generated id so a caller can void it.
 */
async function captureOrder(
  request: APIRequestContext,
  input: {
    customerName: string;
    productVariantId: string;
    quantity?: number;
    complete: {
      payments: Payment[];
      cashReceivedCents?: number;
      cashTipCents?: number;
      changeOwedCents?: number;
    } | null;
  },
): Promise<string> {
  const clientGeneratedId = randomUUID();
  const created = await request.post(`${API_BASE_URL}/orders`, {
    data: {
      clientGeneratedId,
      deviceId: DEVICE_ID,
      productVariantId: input.productVariantId,
      quantity: input.quantity ?? 1,
      customerName: input.customerName,
      serviceType: 'TAKE_OUT',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  if (input.complete !== null) {
    const completed = await request.post(
      `${API_BASE_URL}/orders/${clientGeneratedId}/complete`,
      { data: input.complete },
    );
    expect(completed.ok(), await completed.text()).toBe(true);
  }

  return clientGeneratedId;
}

async function voidOrder(
  request: APIRequestContext,
  clientGeneratedId: string,
  voidReason: string,
): Promise<void> {
  const response = await request.post(
    `${API_BASE_URL}/orders/${clientGeneratedId}/void`,
    {
      data: {
        clientGeneratedId: randomUUID(),
        deviceId: DEVICE_ID,
        voidReason,
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

// ---- page objects -----------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function orderCard(page: Page, number: number, customer: string): Locator {
  const title = page.getByRole('heading', {
    name: new RegExp(
      `(?:Order\\s*)?#?${number}\\b.*${escapeRegExp(customer)}`,
      'i',
    ),
  });
  return page.getByRole('article').filter({ has: title });
}

function factRow(card: Locator, label: 'Cash received' | 'Expected change') {
  return card.locator('.staff-order-fact-row').filter({ hasText: label });
}

/** Assert a fact renders exactly this money string and no unavailable marker. */
async function expectFact(
  card: Locator,
  label: 'Cash received' | 'Expected change',
  money: string,
): Promise<void> {
  const row = factRow(card, label);
  await expect(row).toHaveCount(1);
  await expect(row.locator('.staff-order-fact-value')).toHaveText(money);
  await expect(row.getByLabel(UNAVAILABLE_CASH_RECEIVED)).toHaveCount(0);
  await expect(row.getByLabel(UNAVAILABLE_EXPECTED_CHANGE)).toHaveCount(0);
}

/**
 * Assert a fact renders the unavailable treatment — by accessible name, not by
 * the em dash, which is a styling detail — and renders no money at all. The
 * second half is what separates "unavailable" from a zero rendered in a
 * dashed style.
 */
async function expectFactUnavailable(
  card: Locator,
  label: 'Cash received' | 'Expected change',
  accessibleName: string,
): Promise<void> {
  const row = factRow(card, label);
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel(accessibleName)).toBeVisible();
  await expect(row.locator('.staff-order-fact-value')).toHaveCount(0);
  await expect(row).not.toContainText('₱');
}

async function signInAsStaff(page: Page): Promise<void> {
  await page.goto('/staff/sign-in');
  await page.getByRole('button', { name: 'Use Username and Password' }).click();
  const username = page.locator('#staff-username');
  await expect(username).toBeVisible();
  // The form autofocuses on a requestAnimationFrame; clicking pins focus so the
  // password fill cannot be re-routed into the username box.
  await username.click();
  await username.fill(STAFF_USERNAME);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pos(\/order)?$/);
}

function trackMutatingRequests(page: Page): {
  requests: string[];
  stop: () => void;
} {
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  };
  page.on('request', listener);
  return { requests, stop: () => page.off('request', listener) };
}

// ---- fixture ----------------------------------------------------------------

test.beforeAll(async ({ playwright }) => {
  resetOrderWorld();
  catalog = seedOrderCatalog(`c${RUN}`);
  staffMember = seedOrderStaff(`QA Cash Change Opener ${RUN}`);
  day = openOrderDay({
    businessDate: shopToday(),
    openedByStaffMemberId: staffMember.id,
  });

  const espresso = catalog.products.espresso!.variants;
  const latte = catalog.products.latte!.variants.regular!;
  const croissant = catalog.products.croissant!.variants.regular!;
  const roundUp = catalog.products.roundUp!.variants.regular!;
  const tiny = catalog.products.tiny!.variants.regular!;

  const request = await playwright.request.newContext();
  try {
    await signInApi(request);

    // #1 — cash with change, and the thousands separator for the currency
    // criterion: 9 × ₱150.00 = ₱1,350.00, ₱1,500.00 received, ₱150.00 change.
    await captureOrder(request, {
      customerName: CUSTOMER.cashChange,
      productVariantId: espresso.regular!.id,
      quantity: 9,
      complete: {
        payments: [{ method: 'CASH', amountCents: 135_000 }],
        cashReceivedCents: 150_000,
      },
    });

    // #2 — exact cash: received equals the cash portion, so ₱0.00, not blank.
    await captureOrder(request, {
      customerName: CUSTOMER.exactCash,
      productVariantId: latte.id,
      complete: {
        payments: [{ method: 'CASH', amountCents: 12_000 }],
        cashReceivedCents: 12_000,
      },
    });

    // #3 — split: ₱90.00 received − ₱50.00 cash = ₱40.00. Subtracting the
    // ₱120.00 total gives −₱30.00 and the ₱70.00 online portion gives ₱20.00.
    await captureOrder(request, {
      customerName: CUSTOMER.split,
      productVariantId: latte.id,
      complete: {
        payments: [
          { method: 'CASH', amountCents: 5_000 },
          { method: 'ONLINE', amountCents: 7_000 },
        ],
        cashReceivedCents: 9_000,
      },
    });

    // #4 — online only: no cash portion, no recorded cash received.
    await captureOrder(request, {
      customerName: CUSTOMER.onlineOnly,
      productVariantId: croissant.id,
      complete: { payments: [{ method: 'ONLINE', amountCents: 9_000 }] },
    });

    // #5 — cash with a separately recorded tip: ₱250.00 − ₱180.00 = ₱70.00.
    // The ₱20.00 tip is outside the cash portion and must not move it.
    await captureOrder(request, {
      customerName: CUSTOMER.tipped,
      productVariantId: espresso.large!.id,
      complete: {
        payments: [{ method: 'CASH', amountCents: 18_000 }],
        cashReceivedCents: 25_000,
        cashTipCents: 2_000,
      },
    });

    // #6 — change still owed (₱30.00) alongside an expected change of ₱80.00.
    await captureOrder(request, {
      customerName: CUSTOMER.changeOwed,
      productVariantId: latte.id,
      complete: {
        payments: [{ method: 'CASH', amountCents: 12_000 }],
        cashReceivedCents: 20_000,
        changeOwedCents: 3_000,
      },
    });

    // #7 — parked: never settled.
    await captureOrder(request, {
      customerName: CUSTOMER.parked,
      productVariantId: tiny.id,
      complete: null,
    });

    // #8 — completed, then voided: ₱150.00 − ₱100.03 = ₱49.97, and the
    // correction's −₱100.03 payment must not surface as the card's values.
    const voided = await captureOrder(request, {
      customerName: CUSTOMER.voided,
      productVariantId: roundUp.id,
      complete: {
        payments: [{ method: 'CASH', amountCents: 10_003 }],
        cashReceivedCents: 15_000,
      },
    });
    await voidOrder(request, voided, 'Wrong milk selected');
  } finally {
    await request.dispose();
  }

  // #10 — under-tendered legacy row: ₱90.00 received against a ₱100.00 cash
  // portion. ADR 0005 §5 requires the read model to show the negative result.
  seedLegacyCashSale({
    tradingDayId: day.id,
    dayOrderNumber: ORDER.underTendered,
    customerName: CUSTOMER.underTendered,
    productVariantId: tiny.id,
    productNameSnapshot: 'Legacy Under Tender',
    variantNameSnapshot: 'Regular',
    totalCents: 10_000,
    paymentMethod: 'CASH',
    cashReceivedCents: 9_000,
  });

  // #11 — cash received recorded with no CASH tender row: the two values are
  // gated independently, so Cash received still shows its amount.
  seedLegacyCashSale({
    tradingDayId: day.id,
    dayOrderNumber: ORDER.cashWithoutCashTender,
    customerName: CUSTOMER.cashWithoutCashTender,
    productVariantId: tiny.id,
    productNameSnapshot: 'Legacy Import',
    variantNameSnapshot: 'Regular',
    totalCents: 8_000,
    paymentMethod: 'ONLINE',
    cashReceivedCents: 5_000,
  });
});

// ---- specification ----------------------------------------------------------

test.describe('cash received and expected change in staff order history (story #340, QA #344)', () => {
  test('every settlement shape renders the right cash facts without changing the order', async ({
    page,
  }) => {
    await signInAsStaff(page);
    const storedBefore = readSettlementSnapshot();
    const writes = trackMutatingRequests(page);

    await page.goto('/pos/orders');
    await expect(
      page.getByRole('heading', { name: 'Order History' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Business day' })).toHaveValue(
      day.id,
    );

    await test.step('AC1: every order carries both facts', async () => {
      const cards = page.getByRole('article');
      // Ten cards: eight captured orders plus two seeded rows. The VOID
      // correction record is not its own card.
      await expect(cards).toHaveCount(10);
      await expect(cards.locator('.staff-order-fact-row')).toHaveCount(20);
      for (const label of ['Cash received', 'Expected change'] as const) {
        await expect(
          page.getByRole('article').locator('.staff-order-fact-row', {
            hasText: label,
          }),
        ).toHaveCount(10);
      }
    });

    await test.step('AC2/AC3: a cash order shows the recorded amount and the difference', async () => {
      const card = orderCard(page, ORDER.cashChange, CUSTOMER.cashChange);
      await expectFact(card, 'Cash received', '₱1,500.00');
      await expectFact(card, 'Expected change', '₱150.00');
    });

    await test.step('AC5: exact cash shows a formatted zero, not the unavailable treatment', async () => {
      const card = orderCard(page, ORDER.exactCash, CUSTOMER.exactCash);
      await expectFact(card, 'Cash received', '₱120.00');
      await expectFact(card, 'Expected change', '₱0.00');
      await expect(card.getByLabel(UNAVAILABLE_EXPECTED_CHANGE)).toHaveCount(0);
    });

    await test.step('AC10: a split payment subtracts only the cash portion', async () => {
      const card = orderCard(page, ORDER.split, CUSTOMER.split);
      await expect(card).toContainText('Cash');
      await expect(card).toContainText('₱50.00');
      await expect(card).toContainText('Online');
      await expect(card).toContainText('₱70.00');
      await expectFact(card, 'Cash received', '₱90.00');
      await expectFact(card, 'Expected change', '₱40.00');
      // The two wrong derivations, pinned so neither can pass silently.
      const expectedChange = factRow(card, 'Expected change');
      await expect(expectedChange).not.toContainText('₱-30.00');
      await expect(expectedChange).not.toContainText('₱20.00');
    });

    await test.step('AC7: an online-only order shows both facts as unavailable', async () => {
      const card = orderCard(page, ORDER.onlineOnly, CUSTOMER.onlineOnly);
      await expectFactUnavailable(
        card,
        'Cash received',
        UNAVAILABLE_CASH_RECEIVED,
      );
      await expectFactUnavailable(
        card,
        'Expected change',
        UNAVAILABLE_EXPECTED_CHANGE,
      );
    });

    await test.step('AC4: a separately recorded cash tip does not move expected change', async () => {
      const card = orderCard(page, ORDER.tipped, CUSTOMER.tipped);
      await expectFact(card, 'Cash received', '₱250.00');
      await expectFact(card, 'Expected change', '₱70.00');
      // ₱250.00 − ₱180.00 − the ₱20.00 tip would be ₱50.00.
      await expect(factRow(card, 'Expected change')).not.toContainText('₱50.00');
    });

    await test.step('AC11: expected change sits beside, and does not replace, change still owed', async () => {
      const card = orderCard(page, ORDER.changeOwed, CUSTOMER.changeOwed);
      await expectFact(card, 'Cash received', '₱200.00');
      await expectFact(card, 'Expected change', '₱80.00');

      const changeBlock = card.locator('.staff-order-change');
      await expect(changeBlock).toHaveCount(1);
      await expect(changeBlock).toContainText('Change still owed');
      await expect(changeBlock.locator('strong')).toHaveText('₱30.00');
      await expect(
        changeBlock.getByRole('button', { name: 'Confirm change handed over' }),
      ).toBeVisible();
      // Distinguishable: the change block is outside the payment facts, and
      // neither value has leaked into the other.
      await expect(changeBlock.locator('.staff-order-fact-row')).toHaveCount(0);
      await expect(factRow(card, 'Expected change')).not.toContainText(
        'Change still owed',
      );
    });

    await test.step('AC8: a parked order shows both facts as unavailable', async () => {
      const card = orderCard(page, ORDER.parked, CUSTOMER.parked);
      await expect(card).toContainText('Parked');
      await expectFactUnavailable(
        card,
        'Cash received',
        UNAVAILABLE_CASH_RECEIVED,
      );
      await expectFactUnavailable(
        card,
        'Expected change',
        UNAVAILABLE_EXPECTED_CHANGE,
      );
    });

    await test.step('AC9: a voided order keeps the original recorded values', async () => {
      const card = orderCard(page, ORDER.voided, CUSTOMER.voided);
      await expect(card).toContainText('Void');
      await expect(card).toContainText('Wrong milk selected');
      await expectFact(card, 'Cash received', '₱150.00');
      await expectFact(card, 'Expected change', '₱49.97');
      // The correcting record's negative payment must not surface here.
      await expect(card).not.toContainText('₱-100.03');
      await expect(card).not.toContainText('₱-150.00');
    });

    await test.step('AC6: an under-tendered historical row shows the negative, unclamped', async () => {
      const card = orderCard(page, ORDER.underTendered, CUSTOMER.underTendered);
      await expectFact(card, 'Cash received', '₱90.00');
      await expectFact(card, 'Expected change', '₱-10.00');
      const expectedChange = factRow(card, 'Expected change');
      await expect(expectedChange).not.toContainText('₱0.00');
      await expect(
        expectedChange.getByLabel(UNAVAILABLE_EXPECTED_CHANGE),
      ).toHaveCount(0);
    });

    await test.step('AC7: cash received without a cash portion keeps its own amount', async () => {
      const card = orderCard(
        page,
        ORDER.cashWithoutCashTender,
        CUSTOMER.cashWithoutCashTender,
      );
      await expectFact(card, 'Cash received', '₱50.00');
      await expectFactUnavailable(
        card,
        'Expected change',
        UNAVAILABLE_EXPECTED_CHANGE,
      );
    });

    await test.step('AC12: both facts use the card’s own currency presentation', async () => {
      const card = orderCard(page, ORDER.cashChange, CUSTOMER.cashChange);
      const total = await card.locator('.staff-order-total').innerText();
      expect(total).toBe('₱1,350.00');
      for (const label of ['Cash received', 'Expected change'] as const) {
        const value = await factRow(card, label)
          .locator('.staff-order-fact-value')
          .innerText();
        expect(value, label).toMatch(MONEY_PATTERN);
        expect(value.startsWith('₱'), label).toBe(true);
      }
      const negative = await factRow(
        orderCard(page, ORDER.underTendered, CUSTOMER.underTendered),
        'Expected change',
      )
        .locator('.staff-order-fact-value')
        .innerText();
      expect(negative).toMatch(MONEY_PATTERN);
    });

    await test.step('AC13: reviewing the values changes nothing', async () => {
      // Re-fetch the ledger the same way a staff member would, then compare the
      // stored settlement record byte for byte.
      const response = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'GET' &&
          new URL(candidate.url()).pathname.startsWith(
            '/reporting/staff-order-ledger/',
          ),
      );
      await page.reload();
      expect((await response).ok()).toBe(true);
      await expect(
        orderCard(page, ORDER.cashChange, CUSTOMER.cashChange),
      ).toBeVisible();

      writes.stop();
      expect(writes.requests).toEqual([]);
      expect(readSettlementSnapshot()).toBe(storedBefore);
    });
  });
});
