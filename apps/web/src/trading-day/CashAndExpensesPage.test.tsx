import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SignedInAs } from '../auth/session-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CashMovementKind,
  DayType,
  cents,
  type CashMovement,
  type CurrentOpenBusinessDay,
} from '@coffee-shop/shared';
import {
  CashAndExpensesPage,
  parseCashAmount,
} from './CashAndExpensesPage';

const staff = [
  { id: '8ce77958-342f-4c1a-a8dd-bc3fcd71a96a', displayName: 'Maya Santos' },
  { id: '061c7a67-e01e-4b20-b2fb-d83f2ce6997e', displayName: 'Leo Cruz' },
];

const openDay: CurrentOpenBusinessDay = {
  isOpen: true,
  businessDate: '2026-07-31',
  dayType: DayType.PEAK,
  openingFloatCents: cents(50000),
  openedByDisplayName: 'Maya Santos',
  openedAt: '2026-07-31T00:00:00.000Z',
};

const noOpenDay: CurrentOpenBusinessDay = {
  isOpen: false,
  businessDate: null,
  dayType: null,
  openingFloatCents: null,
  openedByDisplayName: null,
  openedAt: null,
};

const closingSummary = {
  isOpen: true,
  businessDate: openDay.businessDate,
  openingFloatCents: cents(50000),
  cashSalesCents: cents(0),
  onlineSalesCents: cents(0),
  grossSalesCents: cents(0),
  cashTipsCents: cents(0),
  cashInCents: cents(0),
  cashOutCents: cents(0),
  cashExpensesCents: cents(0),
  outstandingChangeCents: cents(0),
  expectedCashCents: cents(50000),
  packaging: [],
  hasClosingStockCount: false,
};

function movement(
  overrides: Partial<CashMovement> = {},
): CashMovement {
  return {
    id: 'movement-1',
    tradingDayId: 'day-1',
    amendsCashMovementId: null,
    supersededByCashMovementId: null,
    kind: CashMovementKind.CASH_IN,
    amountCents: cents(1234),
    description: 'Change fund top-up',
    category: null,
    recordedByStaffMemberId: staff[0]!.id,
    recordedByNameSnapshot: 'Maya Santos',
    recordedAt: '2026-07-31T08:30:00.000Z',
    ...overrides,
  };
}

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openPageFetch(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  movements: CashMovement[] = [],
) {
  fetchMock.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/trading-day/current') return response(200, openDay);
    if (path === '/trading-day/current/cash-movements') {
      return response(200, { businessDay: openDay, movements });
    }
    if (path === '/trading-day/current/closing-summary') {
      return response(200, closingSummary);
    }
    if (path === '/inventory/counts/staff') return response(200, staff);
    return response(500);
  });
}

function renderPage(signedInStaffMemberId: string | null = null) {
  return render(
    <SignedInAs staffMemberId={signedInStaffMemberId}>
      <MemoryRouter>
        <CashAndExpensesPage />
      </MemoryRouter>
    </SignedInAs>,
  );
}

async function fillRequiredFields(amount = '12.34', reason = 'Test reason') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Amount/), amount);
  await user.type(screen.getByLabelText(/^Reason/), reason);
  return user;
}

describe('cash and expenses page', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows fixed open-day context, active staff, and the empty ledger state', async () => {
    openPageFetch(fetchMock);

    renderPage();

    expect(await screen.findByText('Friday, July 31, 2026')).toBeInTheDocument();
    expect(screen.getByText('Peak day')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /business day/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No one (Unattributed)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Maya Santos' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Leo Cruz' })).toBeInTheDocument();
    expect(screen.getByText('No cash entries yet')).toBeInTheDocument();
  });

  it('uses programmatic single-selection semantics and clears a stale expense category', async () => {
    openPageFetch(fetchMock);
    const user = userEvent.setup();

    renderPage();

    const cashIn = await screen.findByRole('radio', { name: /Cash in/ });
    const cashOut = screen.getByRole('radio', { name: /Cash out/ });
    const expense = screen.getByRole('radio', { name: /Expense/ });
    expect(cashIn).toBeChecked();
    expect(screen.getByLabelText(/^Category/)).toBeDisabled();

    await user.click(expense);
    expect(expense).toBeChecked();
    expect(cashIn).not.toBeChecked();
    const category = screen.getByLabelText(/^Category/);
    expect(category).toBeEnabled();
    await user.type(category, 'Supplies');

    await user.click(cashOut);
    expect(cashOut).toBeChecked();
    expect(category).toBeDisabled();
    expect(category).toHaveValue('');
  });

  it.each([
    {
      label: 'Cash in',
      kind: CashMovementKind.CASH_IN,
      category: undefined,
    },
    {
      label: 'Cash out',
      kind: CashMovementKind.CASH_OUT,
      category: undefined,
    },
    {
      label: 'Expense',
      kind: CashMovementKind.EXPENSE,
      category: 'Supplies',
    },
  ])('records $label in integer cents and prepends the returned row', async ({ label, kind, category }) => {
    openPageFetch(fetchMock);
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') {
        return response(200, { businessDay: openDay, movements: [] });
      }
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements' && init?.method === 'POST') {
        return response(201, movement({ id: `movement-${kind}`, kind, category: category ?? null, recordedByNameSnapshot: 'Maya Santos' }));
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: new RegExp(label) }));
    await user.type(screen.getByLabelText(/^Amount/), '12.34');
    await user.type(screen.getByLabelText(/^Reason/), '  Test reason  ');
    if (category) await user.type(screen.getByLabelText(/^Category/), `  ${category}  `);
    await user.selectOptions(screen.getByLabelText(/^Recorded by/), staff[0]!.id);
    await user.click(screen.getByRole('button', { name: 'Record entry' }));

    expect(await screen.findByText('Entry recorded. It is now the first row in today\'s ledger.')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    const body = JSON.parse(String(post![1]?.body));
    expect(body).toMatchObject({
      kind,
      amountCents: 1234,
      description: 'Test reason',
      recordedByStaffMemberId: staff[0]!.id,
    });
    expect(body.clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
    if (category) expect(body.category).toBe(category);
    else expect(body).not.toHaveProperty('category');
    expect(screen.getByRole('cell', { name: '₱12.34' })).toBeInTheDocument();
  });

  it('refreshes the effective cash summary after recording an entry', async () => {
    let summaryRequests = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') {
        return response(200, { businessDay: openDay, movements: [] });
      }
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/current/closing-summary') {
        summaryRequests += 1;
        return response(200, {
          ...closingSummary,
          cashOutCents: cents(summaryRequests === 1 ? 0 : 1000),
          expectedCashCents: cents(summaryRequests === 1 ? 50000 : 49000),
        });
      }
      if (path === '/trading-day/cash-movements' && init?.method === 'POST') {
        return response(201, movement({
          id: 'recorded-cash-out',
          kind: CashMovementKind.CASH_OUT,
          amountCents: cents(1000),
        }));
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: /Cash out/ }));
    await user.type(screen.getByLabelText(/^Amount/), '10.00');
    await user.type(screen.getByLabelText(/^Reason/), 'Petty cash');
    await user.click(screen.getByRole('button', { name: 'Record entry' }));

    expect(await screen.findByText(/Entry recorded/)).toBeInTheDocument();
    expect(summaryRequests).toBe(2);
    expect(screen.getByText('₱490.00')).toBeInTheDocument();
  });

  it('renders category and no-category expense details without invented placeholders and keeps snapshot names', async () => {
    openPageFetch(fetchMock, [
      movement({
        id: 'with-category',
        kind: CashMovementKind.EXPENSE,
        category: 'Supplies',
        description: 'Oat milk delivery',
        recordedByNameSnapshot: 'Rina Lopez',
      }),
      movement({
        id: 'without-category',
        kind: CashMovementKind.EXPENSE,
        category: null,
        description: 'Emergency ice purchase',
        recordedByStaffMemberId: null,
        recordedByNameSnapshot: null,
      }),
    ]);

    renderPage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Supplies / Oat milk delivery')).toBeInTheDocument();
    const noCategoryRow = within(table).getByText('Emergency ice purchase').closest('tr');
    expect(noCategoryRow).not.toBeNull();
    expect(within(noCategoryRow!).getByText('Emergency ice purchase')).toBeInTheDocument();
    expect(within(noCategoryRow!).getByText('Unattributed')).toBeInTheDocument();
    expect(noCategoryRow).not.toHaveTextContent('/ Emergency ice purchase');
    expect(within(table).getByText('Rina Lopez')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: /Amend Expense/ })).toHaveLength(2);
  });

  it('shows local amount and reason errors beside required fields and records nothing', async () => {
    openPageFetch(fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/^Amount/), '0');
    await user.type(screen.getByLabelText(/^Reason/), '   ');
    await user.click(screen.getByRole('button', { name: 'Record entry' }));

    expect(screen.getByText(/Enter an amount from ₱0.01/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a reason containing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Amount/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Reason/)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText(/^Amount/)).toHaveFocus());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('maps server validation to its field instead of a generic banner', async () => {
    openPageFetch(fetchMock);
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements' && init?.method === 'POST') {
        return response(400, { message: ['amountCents must be a positive integer'] });
      }
      return response(500);
    });
    renderPage();
    const user = await fillRequiredFields();

    await user.click(screen.getByRole('button', { name: 'Record entry' }));

    expect(await screen.findByText(/Enter an amount from ₱0.01/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Amount/)).toHaveFocus());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks duplicate submission and reuses the same idempotency ID for a retry', async () => {
    let postCount = 0;
    let finishSecondPost: ((value: Response) => void) | undefined;
    const requestBodies: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements' && init?.method === 'POST') {
        postCount += 1;
        requestBodies.push(JSON.parse(String(init.body)));
        if (postCount === 1) return response(500, { message: 'Temporary failure' });
        return new Promise<Response>((resolve) => {
          finishSecondPost = resolve;
        });
      }
      return response(500);
    });
    renderPage();
    const user = await fillRequiredFields();

    await user.click(screen.getByRole('button', { name: 'Record entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');
    const recordButton = screen.getByRole('button', { name: 'Record entry' });
    await user.dblClick(recordButton);

    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    expect(postCount).toBe(2);
    expect(requestBodies[1]!.clientGeneratedId).toBe(requestBodies[0]!.clientGeneratedId);

    finishSecondPost?.(response(201, movement()));
    expect(await screen.findByText(/Entry recorded/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('explains a business day closing during submission and records no entry', async () => {
    let currentDayRequests = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') {
        currentDayRequests += 1;
        return response(200, currentDayRequests === 1 ? openDay : noOpenDay);
      }
      if (path === '/trading-day/current/cash-movements') {
        return response(200, { businessDay: openDay, movements: [] });
      }
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements' && init?.method === 'POST') {
        return response(409, { message: 'No business day is open' });
      }
      return response(500);
    });
    renderPage();
    const user = await fillRequiredFields();

    await user.click(screen.getByRole('button', { name: 'Record entry' }));

    expect(await screen.findByRole('heading', { name: 'No business day is open' })).toBeInTheDocument();
    expect(screen.getByText('The business day closed before the entry was recorded. No entry was saved.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders linked amendment chains and only enables Amend on effective rows', async () => {
    const original = movement({
      id: 'original-entry',
      supersededByCashMovementId: 'correction-one',
      amountCents: cents(10000),
    });
    const firstCorrection = movement({
      id: 'correction-one',
      amendsCashMovementId: original.id,
      supersededByCashMovementId: 'correction-two',
      amountCents: cents(8000),
    });
    const finalCorrection = movement({
      id: 'correction-two',
      amendsCashMovementId: firstCorrection.id,
      amountCents: cents(7500),
    });
    openPageFetch(fetchMock, [finalCorrection, firstCorrection, original]);

    renderPage();

    const table = await screen.findByRole('table');
    const originalRow = within(table).getByText('Original').closest('tr');
    expect(originalRow).not.toBeNull();
    expect(within(originalRow!).getByText('Superseded')).toBeInTheDocument();
    expect(within(originalRow!).getByText(/Corrected by Entry correction-one to ₱80.00 Cash in/)).toBeInTheDocument();
    expect(within(originalRow!).getByRole('button', { name: 'Amend' })).toBeDisabled();
    expect(within(originalRow!).getByText('Already corrected by Entry correction-one.')).toBeInTheDocument();

    const middleRow = within(table).getByText('Correction 1 of 2').closest('tr');
    expect(middleRow).not.toBeNull();
    expect(middleRow).toHaveTextContent('Corrects Entry original-entry. Corrected again by Entry correction-two to ₱75.00 Cash in.');
    expect(within(middleRow!).getByRole('button', { name: 'Amend' })).toBeDisabled();

    const finalRow = within(table).getByText('Correction 2 of 2').closest('tr');
    expect(finalRow).not.toBeNull();
    expect(within(finalRow!).getByText('Effective')).toBeInTheDocument();
    expect(within(finalRow!).getByRole('button', { name: /Amend Cash in ₱75.00/ })).toBeEnabled();
  });

  it('prefills all correctable values, clears Expense category accessibly, and cancels without a request', async () => {
    openPageFetch(fetchMock, [movement({
      id: 'expense-entry',
      kind: CashMovementKind.EXPENSE,
      amountCents: cents(2450),
      description: 'Cleaning cloths',
      category: 'Supplies',
    })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Amend Expense ₱24.50/ }));
    expect(screen.getByRole('heading', { name: 'Amend entry' })).toHaveFocus();
    expect(screen.getByLabelText(/^Correct amount/)).toHaveValue('24.50');
    expect(screen.getByLabelText(/^Correct description/)).toHaveValue('Cleaning cloths');
    expect(screen.getByLabelText(/^Category/)).toHaveValue('Supplies');

    await user.click(screen.getByRole('radio', { name: /Cash out/ }));
    expect(screen.queryByLabelText(/^Category/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Category was cleared and is no longer available');
    await user.click(screen.getByRole('button', { name: 'Cancel, record nothing' }));

    expect(await screen.findByText('Correction cancelled. Nothing was recorded.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('validates amendment fields before review and cancelling review records nothing', async () => {
    openPageFetch(fetchMock, [movement()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.clear(screen.getByLabelText(/^Correct amount/));
    await user.type(screen.getByLabelText(/^Correct amount/), '0');
    await user.clear(screen.getByLabelText(/^Correct description/));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    expect(screen.getByText(/Enter an amount from ₱0.01/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a reason containing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Correct amount/)).toHaveFocus();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    await user.clear(screen.getByLabelText(/^Correct amount/));
    await user.type(screen.getByLabelText(/^Correct amount/), '10.00');
    await user.type(screen.getByLabelText(/^Correct description/), 'Correct float');
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    expect(screen.getByRole('heading', { name: 'Review correction' })).toHaveFocus();
    expect(screen.getByText('Nothing has been recorded yet. Compare both records before confirming.')).toBeInTheDocument();
    expect(screen.getByText('₱10.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel, record nothing' }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('reuses the review id for a retry and blocks double confirmation', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let postCount = 0;
    let finishRetry: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [movement()] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements/movement-1/amendments' && init?.method === 'POST') {
        postCount += 1;
        requestBodies.push(JSON.parse(String(init.body)));
        if (postCount === 1) return response(500, { message: 'Temporary failure' });
        return new Promise<Response>((resolve) => { finishRetry = resolve; });
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage(staff[0]!.id);
    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));

    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure No correction was recorded.');
    await user.dblClick(screen.getByRole('button', { name: 'Confirm correction' }));
    expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
    expect(postCount).toBe(2);
    expect(requestBodies[1]!.clientGeneratedId).toBe(requestBodies[0]!.clientGeneratedId);
    expect(requestBodies[1]).toMatchObject({
      kind: CashMovementKind.CASH_IN,
      amountCents: 1234,
      description: 'Change fund top-up',
      recordedByStaffMemberId: staff[0]!.id,
    });
    finishRetry?.(response(201, movement({ id: 'correction' })));
    expect(await screen.findByText(/Correction recorded once/)).toBeInTheDocument();
  });

  it('refreshes the full ledger after a successful amendment', async () => {
    const original = movement({ id: 'target-entry', amountCents: cents(10000) });
    const correction = movement({
      id: 'corrected-entry',
      amendsCashMovementId: original.id,
      amountCents: cents(8000),
      description: 'Correct float',
    });
    let ledgerRequests = 0;
    let summaryRequests = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/current/closing-summary') {
        summaryRequests += 1;
        return response(200, {
          ...closingSummary,
          cashInCents: cents(summaryRequests === 1 ? 10000 : 8000),
          expectedCashCents: cents(summaryRequests === 1 ? 60000 : 58000),
        });
      }
      if (path === '/trading-day/current/cash-movements') {
        ledgerRequests += 1;
        return response(200, {
          businessDay: openDay,
          movements: ledgerRequests === 1 ? [original] : [correction, { ...original, supersededByCashMovementId: correction.id }],
        });
      }
      if (path === '/trading-day/cash-movements/target-entry/amendments' && init?.method === 'POST') {
        return response(201, correction);
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Amend Cash in ₱100.00/ }));
    await user.clear(screen.getByLabelText(/^Correct amount/));
    await user.type(screen.getByLabelText(/^Correct amount/), '80.00');
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));

    expect(await screen.findByText(/Correction recorded once/)).toBeInTheDocument();
    expect(ledgerRequests).toBe(2);
    expect(summaryRequests).toBe(2);
    expect(screen.getByText('₱580.00')).toBeInTheDocument();
    expect(screen.getByText(/Corrected by Entry corrected-entry to ₱80.00 Cash in/)).toBeInTheDocument();
    expect(screen.getByText(/Effective amount: ₱80.00 Cash in/)).toBeInTheDocument();
  });

  it('handles an already-superseded conflict distinctly and refreshes from the supplied correction id', async () => {
    const original = movement({ id: 'race-target' });
    const winner = movement({ id: 'race-winner', amendsCashMovementId: original.id, amountCents: cents(1100) });
    let ledgerRequests = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/current/cash-movements') {
        ledgerRequests += 1;
        return response(200, { businessDay: openDay, movements: ledgerRequests === 1 ? [original] : [winner, { ...original, supersededByCashMovementId: winner.id }] });
      }
      if (path === '/trading-day/cash-movements/race-target/amendments' && init?.method === 'POST') {
        return response(409, { message: 'Cash movement was already superseded', supersededByCashMovementId: winner.id });
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));

    expect(await screen.findByText(/Entry race-target was already corrected by Entry race-winner/)).toBeInTheDocument();
    expect(ledgerRequests).toBe(2);
    expect(screen.getByText(/Corrected by Entry race-winner to ₱11.00 Cash in/)).toBeInTheDocument();
  });

  it('moves to the read-only closed-day state when the day closes before amendment confirmation', async () => {
    let currentDayRequests = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') {
        currentDayRequests += 1;
        return response(200, currentDayRequests === 1 ? openDay : noOpenDay);
      }
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [movement()] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements/movement-1/amendments' && init?.method === 'POST') {
        return response(409, { message: 'Trading day is closed' });
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));

    expect(await screen.findByRole('heading', { name: 'No business day is open' })).toBeInTheDocument();
    expect(screen.getByText('The business day closed before confirmation. No correction was recorded. The recorded close and totals did not change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Amend' })).not.toBeInTheDocument();
  });

  it('returns server validation to the amendment fields with a no-write explanation', async () => {
    openPageFetch(fetchMock, [movement()]);
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [movement()] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements/movement-1/amendments' && init?.method === 'POST') {
        return response(400, { message: ['description should not be empty'] });
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));

    expect(await screen.findByText('No correction was recorded. Correct the highlighted fields; the ledger and totals are unchanged.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Correct description/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Correct description/)).toHaveFocus();
  });

  it('surfaces a missing amendment target distinctly and offers a ledger refresh', async () => {
    openPageFetch(fetchMock, [movement()]);
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, openDay);
      if (path === '/trading-day/current/cash-movements') return response(200, { businessDay: openDay, movements: [movement()] });
      if (path === '/inventory/counts/staff') return response(200, staff);
      if (path === '/trading-day/cash-movements/movement-1/amendments' && init?.method === 'POST') {
        return response(404, { message: 'Cash movement not found' });
      }
      return response(500);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Amend Cash in/ }));
    await user.click(screen.getByRole('button', { name: 'Review correction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This entry could not be found. No correction was recorded');
    expect(screen.getByRole('button', { name: 'Refresh ledger' })).toBeEnabled();
  });

  it('defaults Recorded by to the signed-in staff member', async () => {
    openPageFetch(fetchMock);

    renderPage(staff[1]!.id);

    expect(await screen.findByLabelText(/^Recorded by/)).toHaveValue(
      staff[1]!.id,
    );
  });

  it('leaves Recorded by empty when the signed-in user has no roster member', async () => {
    openPageFetch(fetchMock);

    renderPage(null);

    expect(await screen.findByLabelText(/^Recorded by/)).toHaveValue('');
  });

  it('explains the no-open-day state and offers no entry form', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      return response(500);
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'No business day is open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open business day' })).toHaveAttribute('href', '/pos/open');
    expect(screen.queryByRole('button', { name: 'Record entry' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('cash amount parsing', () => {
  it.each([
    ['0.01', 1],
    ['0.1', 10],
    ['12.34', 1234],
    ['19.99', 1999],
    ['21474836.47', 2_147_483_647],
  ])('converts %s pesos to exact integer cents', (value, expected) => {
    expect(parseCashAmount(value)).toBe(expected);
  });

  it.each(['', 'words', '0', '-1', '12.345', '21474836.48'])('rejects invalid amount %s without rounding', (value) => {
    expect(parseCashAmount(value)).toBeNull();
  });
});
