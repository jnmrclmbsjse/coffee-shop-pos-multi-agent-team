import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LineDiscountKind,
  ServiceType,
  cents,
  type OrderHistoryDetail,
} from '@coffee-shop/shared';
import { OrderHistoryPage } from './OrderHistoryPage';
import { OrderHistoryDetailPage } from './OrderHistoryDetailPage';

const completedId = 'f82df0bd-a75b-4e8d-9f93-54dc8bc24446';
const parkedId = 'b3ac6b77-6207-47c0-9277-c1d0d7cbefba';
const voidId = '27df3ef7-5f1b-4e1f-b9bb-e2135ff27750';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const orderList = {
  items: [
    {
      id: completedId,
      businessDay: '2026-07-28',
      dayOrderNumber: 3,
      customerName: null,
      status: 'Completed',
      paymentMethod: 'Split',
      totalCents: 24000,
      tipCents: 0,
      changeOwedCents: 5000,
      changeSettled: false,
      completedAt: '2026-07-28T06:15:00.000Z',
    },
    {
      id: parkedId,
      businessDay: '2026-07-28',
      dayOrderNumber: 2,
      customerName: 'Miguel Santos',
      status: 'Parked',
      paymentMethod: null,
      totalCents: 18000,
      tipCents: 0,
      changeOwedCents: 0,
      changeSettled: null,
      completedAt: null,
    },
    {
      id: voidId,
      businessDay: '2026-07-27',
      dayOrderNumber: 1,
      customerName: 'Lea Mendoza',
      status: 'Void',
      paymentMethod: 'Cash',
      totalCents: 25000,
      tipCents: 2000,
      changeOwedCents: 3000,
      changeSettled: true,
      completedAt: '2026-07-27T04:10:00.000Z',
    },
  ],
  page: 1,
  pageSize: 10,
  totalItems: 23,
  totalPages: 3,
};

const splitDetail: OrderHistoryDetail = {
  id: completedId,
  businessDay: '2026-07-28',
  dayOrderNumber: 3,
  customerName: null,
  status: 'Completed',
  serviceType: ServiceType.DINE_IN,
  paymentMethod: 'Split',
  lines: [
    {
      id: 'line-1',
      productName: 'Café Latte',
      size: 'Large',
      quantity: 2,
      discountKind: LineDiscountKind.SENIOR,
      discountCents: cents(6000),
      lineTotalCents: cents(24000),
    },
  ],
  subtotalCents: cents(30000),
  totalDiscountCents: cents(6000),
  totalCents: cents(24000),
  cashPortionCents: cents(12000),
  onlinePortionCents: cents(12000),
  tipCents: cents(1000),
  cashReceivedCents: cents(15000),
  changeOwedCents: cents(3000),
  changeSettledAt: '2026-07-28T06:16:00.000Z',
  completedAt: '2026-07-28T06:15:00.000Z',
  voidReason: null,
};

function renderList(path = '/order-history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/order-history" element={<OrderHistoryPage />} />
        <Route
          path="/order-history/:id"
          element={<OrderHistoryDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderDetail(
  detail: OrderHistoryDetail,
  path = `/order-history/${completedId}`,
) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(detail));
  vi.stubGlobal('fetch', fetchMock);
  renderList(path);
  return fetchMock;
}

describe('Order History pages', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders presentation-only labels without changing stored money', async () => {
    fetchMock.mockResolvedValue(jsonResponse(orderList));
    renderList();

    const table = await screen.findByRole('table', {
      name: 'Read-only order history across business days',
    });
    expect(within(table).getByText('Walk-in')).toBeInTheDocument();
    expect(within(table).getByText('Split (Cash + Online)')).toBeInTheDocument();
    expect(within(table).getByText('Outstanding')).toBeInTheDocument();
    expect(within(table).getByText('Settled')).toBeInTheDocument();
    expect(within(table).getByText('₱240.00')).toBeInTheDocument();
    expect(within(table).getByText('₱0.00')).toBeInTheDocument();

    const parkedRow = within(table).getByText('Parked').closest('tr');
    expect(parkedRow).not.toBeNull();
    expect(within(parkedRow!).getByLabelText('Tip not available')).toHaveTextContent(
      '—',
    );
    expect(
      within(parkedRow!).getByLabelText('Change owed not available'),
    ).toHaveTextContent('—');

    const voidRow = within(table).getByText('Void').closest('tr');
    expect(voidRow).not.toBeNull();
    expect(
      within(voidRow!).getByLabelText('Completed time not available'),
    ).toHaveTextContent('—');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/reporting/order-history?sort=businessDay&direction=desc&page=1&pageSize=10',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends search, filters, sort, page size, and paging to the API', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(orderList));
    const user = userEvent.setup();
    renderList('/order-history?page=2');
    await screen.findByRole('table', {
      name: 'Read-only order history across business days',
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'Completed');
    await user.selectOptions(screen.getByLabelText('Payment'), 'Split');
    await user.type(screen.getByLabelText('Customer'), 'Ana');
    await user.selectOptions(screen.getByLabelText('Rows per page'), '25');
    await user.click(
      screen.getByRole('button', { name: 'Order total, not sorted' }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/reporting/order-history?status=Completed&paymentMethod=Split&search=Ana&sort=total&direction=asc&page=1&pageSize=25',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining('page=2'),
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
  });

  it('shows the exact empty state and preserves controls after an API error', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [],
          page: 1,
          pageSize: 10,
          totalItems: 0,
          totalPages: 0,
        }),
      )
      .mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('No sales orders')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'Void');
    expect(
      await screen.findByText('Order history could not be loaded. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('Void');
  });

  it('opens a read-only split and Senior detail while retaining list URL state', async () => {
    const detailFetch = renderDetail(
      splitDetail,
      `/order-history/${completedId}?status=Completed&page=2`,
    );

    expect(
      await screen.findByRole('heading', { name: 'Order 3' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    expect(screen.getByText('Dine-in')).toBeInTheDocument();
    expect(screen.getByText('Split (Cash + Online)')).toBeInTheDocument();
    expect(screen.getByText('Senior')).toBeInTheDocument();
    expect(screen.getByText('Included in Total discount')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cash and online portions exclude tip and together equal Total.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Order History' })).toHaveAttribute(
      'href',
      '/order-history?status=Completed&page=2',
    );
    expect(
      screen.queryByRole('button', { name: /create|edit|delete|void|reopen/i }),
    ).not.toBeInTheDocument();
    expect(detailFetch).toHaveBeenCalledWith(
      `http://localhost:3000/reporting/order-history/${completedId}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('shows parked values and a void completion as unavailable', async () => {
    const parkedDetail: OrderHistoryDetail = {
      ...splitDetail,
      id: parkedId,
      status: 'Parked',
      paymentMethod: null,
      cashPortionCents: null,
      onlinePortionCents: null,
      cashReceivedCents: null,
      changeSettledAt: null,
      completedAt: null,
    };
    renderDetail(parkedDetail, `/order-history/${parkedId}`);

    await screen.findByRole('heading', { name: 'Order 3' });
    const summary = screen.getByRole('heading', {
      name: 'Payment summary',
    }).parentElement;
    expect(summary).not.toBeNull();
    expect(within(summary!).getAllByText('—').length).toBeGreaterThanOrEqual(7);

    cleanup();
    vi.unstubAllGlobals();
    const voidDetail: OrderHistoryDetail = {
      ...splitDetail,
      id: voidId,
      status: 'Void',
      paymentMethod: 'Cash',
      voidReason: 'Duplicate order entered at the counter.',
    };
    renderDetail(voidDetail, `/order-history/${voidId}`);

    await screen.findByText('Duplicate order entered at the counter.');
    const completedTerm = screen.getAllByText('Completed', {
      selector: 'dt',
    }).at(-1);
    expect(completedTerm?.parentElement).toHaveTextContent('—');
  });
});
