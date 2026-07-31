import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { ReportsPage } from './ReportsPage';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const dashboard = {
  summary: {
    date: '2026-07-25',
    status: 'open',
    orderCount: 39,
    grossSalesCents: 3024000,
    cashSalesCents: 1856000,
    onlineSalesCents: 1168000,
    averageOrderValueCents: 77538,
    cashTipsCents: 142000,
  },
  salesTrend: [
    {
      date: '2026-07-24',
      cashSalesCents: 1975000,
      onlineSalesCents: 1342000,
    },
    {
      date: '2026-07-25',
      cashSalesCents: 1856000,
      onlineSalesCents: 1168000,
    },
  ],
  topProducts: [
    {
      productId: 'latte',
      productName: 'Latte',
      quantitySold: 143,
      revenueCents: 5982000,
    },
  ],
};

const report = {
  from: '2026-07-13',
  to: '2026-07-26',
  totals: {
    grossSalesCents: 3024000,
    cashSalesCents: 1856000,
    onlineSalesCents: 1168000,
    tipsCents: 142000,
  },
  dailyReconciliation: [
    {
      date: '2026-07-24',
      status: 'closed',
      cashSalesCents: 1975000,
      onlineSalesCents: 1342000,
      grossSalesCents: 3317000,
      tipsCents: 134000,
      cashInCents: 25000,
      cashOutCents: 15000,
      cashExpensesCents: 82000,
      outstandingChangeCents: 10000,
      expectedCashCents: 2047000,
      actualCashCents: 0,
      varianceCents: -2047000,
    },
    {
      date: '2026-07-25',
      status: 'open',
      cashSalesCents: 1856000,
      onlineSalesCents: 1168000,
      grossSalesCents: 3024000,
      tipsCents: 142000,
      cashInCents: 0,
      cashOutCents: 0,
      cashExpensesCents: 60000,
      outstandingChangeCents: 0,
      expectedCashCents: 1938000,
      actualCashCents: null,
      varianceCents: null,
    },
  ],
  topProducts: dashboard.topProducts,
};

describe('reporting pages', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-25T16:00:00.000Z'));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the open business date and readable chart values', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(dashboard));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DashboardPage />);

    expect(
      await screen.findByRole('heading', { name: 'Current trading day' }),
    ).toBeInTheDocument();
    expect(screen.getByText('July 25, 2026')).toBeInTheDocument();
    expect(screen.getAllByText('₱30,240.00')).not.toHaveLength(0);
    expect(screen.getByText('143 sold')).toBeInTheDocument();

    await user.click(screen.getByText('Read sales values'));
    const values = screen.getByRole('table', { name: 'Sales trend values' });
    expect(within(values).getByText('₱19,750.00')).toBeInTheDocument();
    expect(within(values).getByText('₱13,420.00')).toBeInTheDocument();
  });

  it('shows the explicit dashboard state when no trading day exists', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ summary: null, salesTrend: [], topProducts: [] }),
    );
    render(<DashboardPage />);

    expect(
      await screen.findByText('No trading day data yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No sales trend data yet.')).toBeInTheDocument();
    expect(screen.getByText('No sales in this range.')).toBeInTheDocument();
  });

  it('renders null cash as unavailable and a recorded zero as money', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(report));
    render(<ReportsPage />);

    const table = await screen.findByRole('table', {
      name: /Daily reconciliation/,
    });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('₱0.00')).toBeInTheDocument();
    expect(
      within(rows[2]!).getByLabelText('Actual cash not recorded'),
    ).toHaveTextContent('—');
    expect(
      within(rows[2]!).getByLabelText('Variance not available'),
    ).toHaveTextContent('—');
    expect(within(rows[1]!).getByText('Short')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('₱250.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('₱150.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('₱100.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('₱-20,470.00')).toBeInTheDocument();
  });

  it('keeps the last valid results and makes no request for an invalid range', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(report));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ReportsPage />);

    await screen.findByText('Daily reconciliation');
    await user.clear(screen.getByLabelText('From'));

    expect(
      screen.getByText('Choose both a From date and a To date.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Daily reconciliation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-queries a valid inclusive range and shows both empty states', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(
        jsonResponse({
          from: '2026-06-01',
          to: '2026-06-02',
          totals: {
            grossSalesCents: 0,
            cashSalesCents: 0,
            onlineSalesCents: 0,
            tipsCents: 0,
          },
          dailyReconciliation: [],
          topProducts: [],
        }),
      );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ReportsPage />);
    await screen.findByText('Daily reconciliation');

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.clear(from);
    await user.type(from, '2026-06-01');
    await user.clear(to);
    await user.type(to, '2026-06-02');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    expect(await screen.findByText('No days in this range.')).toBeInTheDocument();
    expect(screen.getByText('No sales in this range.')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/reporting/report?from=2026-06-01&to=2026-06-02',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
  });
});
