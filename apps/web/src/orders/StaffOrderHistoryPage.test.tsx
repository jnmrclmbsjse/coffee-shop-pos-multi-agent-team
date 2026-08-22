import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LineDiscountKind,
  TradingDayStatus,
  cents,
  type BusinessDayList,
  type StaffOrderLedger,
  type StaffOrderLedgerOrder,
} from '@coffee-shop/shared';
import { StaffOrderHistoryPage } from './StaffOrderHistoryPage';

const businessDays: BusinessDayList = {
  items: [
    {
      id: 'day-open',
      businessDate: '2026-07-31',
      status: TradingDayStatus.OPEN,
    },
    {
      id: 'day-closed',
      businessDate: '2026-07-30',
      status: TradingDayStatus.CLOSED,
    },
  ],
  currentOpenBusinessDayId: 'day-open',
};

function order(
  input: Partial<StaffOrderLedgerOrder> &
    Pick<StaffOrderLedgerOrder, 'id' | 'dayOrderNumber' | 'status'>,
): StaffOrderLedgerOrder {
  return {
    clientGeneratedId: `${input.id}-client`,
    customerName: 'Test Customer',
    cashierName: 'Mika Reyes',
    paymentMethod: 'Cash',
    completedAt: '2026-07-31T12:00:00.000Z',
    totalCents: cents(15_000),
    lines: [
      {
        id: `${input.id}-line`,
        productName: 'Spanish Latte',
        size: 'Large',
        quantity: 1,
        discountKind: LineDiscountKind.NONE,
        discountCents: cents(0),
        lineTotalCents: cents(15_000),
      },
    ],
    cashPortionCents: cents(15_000),
    onlinePortionCents: null,
    cashReceivedCents: cents(15_000),
    expectedChangeCents: cents(0),
    voidReason: null,
    changeOwedCents: cents(0),
    changeSettled: false,
    changeSettledAt: null,
    ...input,
  };
}

function ledger(
  orders: StaffOrderLedgerOrder[],
  businessDayId = 'day-open',
): StaffOrderLedger {
  return { businessDayId, orders };
}

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(initialEntry = '/pos/orders') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <StaffOrderHistoryPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('staff order history page', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to the open business day and loads that day with GET requests only', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/trading-day') {
        return response(200, businessDays);
      }
      if (parsed.pathname === '/reporting/staff-order-ledger/day-open') {
        return response(
          200,
          ledger([
            order({
              id: 'open-order',
              dayOrderNumber: 4,
              status: 'Completed',
              customerName: 'Open Day Guest',
            }),
          ]),
        );
      }
      return response(500);
    });

    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: 'Order #4 · Open Day Guest',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Business day' })).toHaveValue(
      'day-open',
    );
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/pos/orders?day=day-open',
      );
    });
    expect(
      fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET'),
    ).toBe(true);
  });

  it('sends the combined URL filters to the API and preserves them across a day switch', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/trading-day') {
        return response(200, businessDays);
      }
      if (parsed.pathname.startsWith('/reporting/staff-order-ledger/')) {
        return response(
          200,
          ledger([], parsed.pathname.endsWith('day-closed') ? 'day-closed' : 'day-open'),
        );
      }
      return response(500);
    });
    renderPage();

    await screen.findByText('No orders to show');
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'Completed' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Payment' }), {
      target: { value: 'Online' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Customer name' }), {
      target: { value: '  Senior  ' },
    });

    await waitFor(() => {
      const lastUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]));
      expect(lastUrl.pathname).toBe('/reporting/staff-order-ledger/day-open');
      expect(lastUrl.searchParams.get('status')).toBe('Completed');
      expect(lastUrl.searchParams.get('paymentMethod')).toBe('Online');
      expect(lastUrl.searchParams.get('search')).toBe('Senior');
    });
    expect(screen.getByTestId('location')).toHaveTextContent('status=Completed');
    expect(screen.getByTestId('location')).toHaveTextContent('payment=Online');
    expect(screen.getByTestId('location')).toHaveTextContent('search=++Senior++');

    fireEvent.change(screen.getByRole('combobox', { name: 'Business day' }), {
      target: { value: 'day-closed' },
    });

    await waitFor(() => {
      const lastUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]));
      expect(lastUrl.pathname).toBe('/reporting/staff-order-ledger/day-closed');
      expect(lastUrl.searchParams.get('status')).toBe('Completed');
      expect(lastUrl.searchParams.get('paymentMethod')).toBe('Online');
      expect(lastUrl.searchParams.get('search')).toBe('Senior');
    });
  });

  it('explains the no-business-day state without requesting a ledger', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { items: [], currentOpenBusinessDayId: null }),
    );

    renderPage();

    expect(await screen.findByText('No orders to show')).toBeInTheDocument();
    expect(screen.getByText('No business day has been opened yet.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Business day' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders Parked, Void and Split cards without inventing missing facts', async () => {
    const variants = [
      order({
        id: 'parked',
        dayOrderNumber: 7,
        status: 'Parked',
        customerName: null,
        cashierName: null,
        paymentMethod: null,
        completedAt: null,
        cashPortionCents: null,
        onlinePortionCents: null,
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
      order({
        id: 'split',
        dayOrderNumber: 6,
        status: 'Completed',
        customerName: 'Split Guest',
        paymentMethod: 'Split',
        cashPortionCents: cents(8_000),
        onlinePortionCents: cents(12_000),
        totalCents: cents(20_000),
        cashReceivedCents: cents(10_000),
        expectedChangeCents: cents(2_000),
      }),
      order({
        id: 'void',
        dayOrderNumber: 5,
        status: 'Void',
        customerName: 'Voided Guest',
        voidReason: 'Wrong milk selected',
      }),
      order({
        id: 'discounted',
        dayOrderNumber: 4,
        status: 'Completed',
        customerName: 'Senior Guest',
        paymentMethod: 'Online',
        cashPortionCents: null,
        onlinePortionCents: cents(24_000),
        totalCents: cents(24_000),
        cashReceivedCents: null,
        expectedChangeCents: null,
        lines: [
          {
            id: 'discount-line',
            productName: 'Cappuccino',
            size: 'Regular',
            quantity: 2,
            discountKind: LineDiscountKind.SENIOR,
            discountCents: cents(3_000),
            lineTotalCents: cents(21_000),
          },
        ],
      }),
    ];
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day') return response(200, businessDays);
      return response(200, ledger(variants));
    });

    renderPage();

    const parkedHeading = await screen.findByRole('heading', {
      name: 'Order #7 · Walk-in',
    });
    const parkedCard = parkedHeading.closest('article')!;
    expect(within(parkedCard).getByText('Parked')).toBeInTheDocument();
    expect(within(parkedCard).queryByText('Payment')).not.toBeInTheDocument();
    expect(within(parkedCard).queryByText('Completion')).not.toBeInTheDocument();
    expect(within(parkedCard).queryByText('Cashier')).not.toBeInTheDocument();
    expect(
      within(parkedCard).getByLabelText('Cash received not recorded'),
    ).toHaveTextContent('—');
    expect(
      within(parkedCard).getByLabelText('Expected change not available'),
    ).toHaveTextContent('—');
    expect(parkedCard).not.toHaveTextContent('null');

    const splitCard = screen
      .getByRole('heading', { name: 'Order #6 · Split Guest' })
      .closest('article')!;
    expect(within(splitCard).getByLabelText('Split payment')).toHaveTextContent(
      'Cash₱80.00Online₱120.00',
    );

    const voidCard = screen
      .getByRole('heading', { name: 'Order #5 · Voided Guest' })
      .closest('article')!;
    expect(voidCard).toHaveTextContent('Void reason: Wrong milk selected');
    expect(voidCard).toHaveTextContent('Original payment record');

    const discountCard = screen
      .getByRole('heading', { name: 'Order #4 · Senior Guest' })
      .closest('article')!;
    expect(discountCard).toHaveTextContent('2×');
    expect(discountCard).toHaveTextContent('Cappuccino');
    expect(discountCard).toHaveTextContent('Regular');
    expect(discountCard).toHaveTextContent('Senior discount');
  });

  it('shows independently nullable cash settlement facts without recomputing them', async () => {
    const variants = [
      order({
        id: 'exact-cash',
        dayOrderNumber: 18,
        status: 'Completed',
        customerName: 'Exact Cash',
        cashPortionCents: cents(15_000),
        cashReceivedCents: cents(15_000),
        expectedChangeCents: cents(0),
      }),
      order({
        id: 'cash-change',
        dayOrderNumber: 17,
        status: 'Completed',
        customerName: 'Cash Change',
        cashPortionCents: cents(15_000),
        cashReceivedCents: cents(20_000),
        expectedChangeCents: cents(5_000),
      }),
      order({
        id: 'online-only',
        dayOrderNumber: 16,
        status: 'Completed',
        customerName: 'Online Only',
        paymentMethod: 'Online',
        cashPortionCents: null,
        onlinePortionCents: cents(15_000),
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
      order({
        id: 'split-payment',
        dayOrderNumber: 15,
        status: 'Completed',
        customerName: 'Split Payment',
        paymentMethod: 'Split',
        cashPortionCents: cents(8_000),
        onlinePortionCents: cents(12_000),
        totalCents: cents(20_000),
        cashReceivedCents: cents(10_000),
        expectedChangeCents: cents(2_000),
      }),
      order({
        id: 'parked-order',
        dayOrderNumber: 14,
        status: 'Parked',
        customerName: 'Parked Order',
        paymentMethod: null,
        completedAt: null,
        cashPortionCents: null,
        onlinePortionCents: null,
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
      order({
        id: 'cash-not-recorded',
        dayOrderNumber: 13,
        status: 'Completed',
        customerName: 'Cash Not Recorded',
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
      order({
        id: 'received-without-cash',
        dayOrderNumber: 12,
        status: 'Completed',
        customerName: 'Received Without Cash',
        paymentMethod: 'Online',
        cashPortionCents: null,
        onlinePortionCents: cents(15_000),
        cashReceivedCents: cents(50_000),
        expectedChangeCents: null,
      }),
      order({
        id: 'negative-legacy',
        dayOrderNumber: 11,
        status: 'Completed',
        customerName: 'Negative Legacy',
        cashPortionCents: cents(10_000),
        totalCents: cents(10_000),
        cashReceivedCents: cents(9_000),
        expectedChangeCents: cents(-1_000),
      }),
    ];
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day') return response(200, businessDays);
      return response(200, ledger(variants));
    });

    renderPage();

    const card = async (name: string) =>
      (await screen.findByRole('heading', { name })).closest('article')!;
    const exactCash = await card('Order #18 · Exact Cash');
    const exactCashReceivedRow = within(exactCash)
      .getByText('Cash received')
      .closest<HTMLElement>('.staff-order-fact-row')!;
    expect(within(exactCashReceivedRow).getByText('₱150.00')).toBeInTheDocument();
    expect(within(exactCash).getByText('₱0.00')).toBeInTheDocument();
    expect(
      within(exactCash).queryByLabelText('Expected change not available'),
    ).not.toBeInTheDocument();

    const cashChange = await card('Order #17 · Cash Change');
    expect(within(cashChange).getByText('₱200.00')).toBeInTheDocument();
    expect(within(cashChange).getByText('₱50.00')).toBeInTheDocument();

    const onlineOnly = await card('Order #16 · Online Only');
    expect(
      within(onlineOnly).getByLabelText('Cash received not recorded'),
    ).toHaveTextContent('—');
    expect(
      within(onlineOnly).getByLabelText('Expected change not available'),
    ).toHaveTextContent('—');

    const split = await card('Order #15 · Split Payment');
    expect(within(split).getByLabelText('Split payment')).toHaveTextContent(
      'Cash₱80.00Online₱120.00',
    );
    expect(within(split).getByText('₱20.00')).toBeInTheDocument();

    const parked = await card('Order #14 · Parked Order');
    expect(parked).toHaveTextContent('No recorded payment');
    expect(
      within(parked).getByLabelText('Cash received not recorded'),
    ).toBeInTheDocument();
    expect(
      within(parked).getByLabelText('Expected change not available'),
    ).toBeInTheDocument();

    const notRecorded = await card('Order #13 · Cash Not Recorded');
    expect(
      within(notRecorded).getByLabelText('Cash received not recorded'),
    ).toBeInTheDocument();
    expect(
      within(notRecorded).getByLabelText('Expected change not available'),
    ).toBeInTheDocument();

    const independent = await card('Order #12 · Received Without Cash');
    expect(within(independent).getByText('₱500.00')).toBeInTheDocument();
    expect(
      within(independent).getByLabelText('Expected change not available'),
    ).toBeInTheDocument();
    expect(
      within(independent).queryByLabelText('Cash received not recorded'),
    ).not.toBeInTheDocument();

    const negative = await card('Order #11 · Negative Legacy');
    expect(within(negative).getByText('₱-10.00')).toBeInTheDocument();
    expect(within(negative).getByText('Recorded as-is')).toBeInTheDocument();
    expect(
      within(negative).queryByLabelText('Expected change not available'),
    ).not.toBeInTheDocument();

    expect(
      screen.getAllByText(
        'Expected change uses the Cash row only. Online payment and cash tips are not included.',
      ),
    ).toHaveLength(variants.length);
    expect(
      fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET'),
    ).toBe(true);
  });

  it('distinguishes change given from change still owed and omits a null cashier', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day') return response(200, businessDays);
      return response(
        200,
        ledger([
          order({
            id: 'given',
            dayOrderNumber: 2,
            status: 'Completed',
            customerName: 'Given Guest',
            changeOwedCents: cents(5_000),
            changeSettled: true,
          }),
          order({
            id: 'owed',
            dayOrderNumber: 1,
            status: 'Completed',
            customerName: 'Owed Guest',
            cashierName: null,
            changeOwedCents: cents(5_000),
            changeSettled: false,
          }),
        ]),
      );
    });

    renderPage();

    const given = (await screen.findByRole('heading', {
      name: 'Order #2 · Given Guest',
    })).closest('article')!;
    const owed = screen
      .getByRole('heading', { name: 'Order #1 · Owed Guest' })
      .closest('article')!;
    expect(given).toHaveTextContent('Change given₱50.00');
    expect(owed).toHaveTextContent('Change still owed₱50.00');
    expect(within(owed).queryByText('Cashier')).not.toBeInTheDocument();
    expect(owed).not.toHaveTextContent('null');
  });

  it('confirms change handover without changing the original amount owed', async () => {
    const owedOrder = order({
      id: '10000000-0000-4000-8000-000000000001',
      clientGeneratedId: '20000000-0000-4000-8000-000000000001',
      dayOrderNumber: 8,
      status: 'Completed',
      customerName: 'Change Guest',
      changeOwedCents: cents(5_000),
      changeSettled: false,
      changeSettledAt: null,
    });
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day') return response(200, businessDays);
      if (path === '/reporting/staff-order-ledger/day-open') {
        return response(200, ledger([owedOrder]));
      }
      if (
        path ===
          `/orders/${owedOrder.clientGeneratedId}/change-settlement` &&
        init?.method === 'POST'
      ) {
        return response(200, {
          ...owedOrder,
          changeSettledAt: '2026-07-31T12:30:00.000Z',
        });
      }
      return response(500);
    });

    renderPage();
    const card = (await screen.findByRole('heading', {
      name: 'Order #8 · Change Guest',
    })).closest('article')!;
    await userEvent.click(
      within(card).getByRole('button', { name: 'Confirm change handed over' }),
    );

    await waitFor(() => {
      expect(within(card).getByText('Change given')).toBeInTheDocument();
      expect(within(card).getByText('₱50.00')).toBeInTheDocument();
    });
    expect(card).toHaveTextContent('Handed over');
    expect(
      screen.getByText(/original ₱50\.00 owed remains on the order/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/orders/${owedOrder.clientGeneratedId}/change-settlement`,
      ),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('contains correction guidance but no order-mutating control', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day') return response(200, businessDays);
      return response(
        200,
        ledger([order({ id: 'read-only', dayOrderNumber: 1, status: 'Completed' })]),
      );
    });

    renderPage();

    await screen.findByRole('heading', { name: 'Order #1 · Test Customer' });
    const guidance = screen.getByTestId('correction-guidance');
    expect(guidance).toHaveTextContent(/voiding the original completed order/i);
    expect(guidance).toHaveTextContent(/entering the corrected order again/i);
    expect(guidance).toHaveTextContent(
      /confirming a change handover records its time without reducing the original amount owed/i,
    );
    expect(within(guidance).queryByRole('button')).not.toBeInTheDocument();
    expect(within(guidance).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('article').querySelectorAll('button, a')).toHaveLength(0);
    expect(
      screen.queryByRole('button', {
        name: /create|edit|resume|complete|void|delete|change order/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows a load error separately from empty results and retries', async () => {
    fetchMock
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, businessDays))
      .mockResolvedValueOnce(response(200, ledger([])));
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Order history could not be loaded. Try again.',
    );
    expect(screen.queryByText('No orders to show')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No orders to show')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
