import { render, screen, waitFor, within } from '@testing-library/react';
import { cents, type SalesRangeReport } from '@coffee-shop/shared';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
      cupsSold: 143,
      revenueCents: 5982000,
    },
  ],
};

const report: SalesRangeReport = {
  from: '2026-07-13',
  to: '2026-07-26',
  totals: {
    grossSalesCents: cents(3024000),
    cashSalesCents: cents(1856000),
    onlineSalesCents: cents(1168000),
    tipsCents: cents(142000),
  },
  dailyReconciliation: [
    {
      tradingDayId: 'day-2026-07-25',
      date: '2026-07-25',
      status: 'open',
      openingFloatCents: cents(50000),
      cashSalesCents: cents(1856000),
      onlineSalesCents: cents(1168000),
      grossSalesCents: cents(3024000),
      tipsCents: cents(142000),
      cashInCents: cents(0),
      cashOutCents: cents(0),
      cashExpensesCents: cents(60000),
      outstandingChangeCents: cents(0),
      expectedCashCents: cents(1938000),
      actualCashCents: null,
      varianceCents: null,
      varianceReason: null,
    },
    {
      tradingDayId: 'day-2026-07-24',
      date: '2026-07-24',
      status: 'closed',
      openingFloatCents: cents(75000),
      cashSalesCents: cents(1975000),
      onlineSalesCents: cents(1342000),
      grossSalesCents: cents(3317000),
      tipsCents: cents(134000),
      cashInCents: cents(25000),
      cashOutCents: cents(15000),
      cashExpensesCents: cents(82000),
      outstandingChangeCents: cents(10000),
      expectedCashCents: cents(2047000),
      actualCashCents: cents(0),
      varianceCents: cents(-2047000),
      varianceReason: 'Drawer left at the till overnight',
    },
  ],
  topProducts: [
    {
      productId: 'latte',
      productName: 'Latte',
      quantitySold: 143,
      cupsSold: 143,
      revenueCents: cents(5982000),
    },
  ],
};

function reportWithDayCount(count: number): SalesRangeReport {
  return {
    ...report,
    dailyReconciliation: Array.from({ length: count }, (_, index) => ({
      ...report.dailyReconciliation[0]!,
      tradingDayId: `trading-day-${index + 1}`,
      date: `2026-07-${String(25 - index).padStart(2, '0')}`,
    })),
  };
}

function renderReportsPage() {
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <ReportsPage />
    </MemoryRouter>,
  );
}

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
    renderReportsPage();

    const table = await screen.findByRole('table', {
      name: /Daily reconciliation/,
    });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('₱500.00')).toBeInTheDocument();
    expect(
      within(rows[1]!).getByLabelText('Actual cash not recorded'),
    ).toHaveTextContent('—');
    expect(
      within(rows[1]!).getByLabelText('Variance not available'),
    ).toHaveTextContent('—');
    expect(within(rows[2]!).getByText('₱0.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('₱750.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Short')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('₱250.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('₱150.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('₱100.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('₱-20,470.00')).toBeInTheDocument();
    expect(
      screen.getByText(/Trading days are ordered from newest to oldest/),
    ).toBeInTheDocument();
  });

  it('shows the variance reason staff recorded at close', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(report));
    renderReportsPage();

    const table = await screen.findByRole('table', {
      name: /Daily reconciliation/,
    });
    expect(
      within(table).getByRole('columnheader', { name: 'Variance reason' }),
    ).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(
      within(rows[1]!).getByText('No reason recorded'),
    ).toBeInTheDocument();
    expect(
      within(rows[2]!).getByText('Drawer left at the till overnight'),
    ).toBeInTheDocument();
  });

  it('pages reconciliation rows by 15 and resets on a same-range reload', async () => {
    const pagedReport = reportWithDayCount(16);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(pagedReport))
      .mockResolvedValueOnce(jsonResponse(pagedReport));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderReportsPage();

    const pagination = await screen.findByRole('navigation', {
      name: 'Daily reconciliation pages',
    });
    expect(within(pagination).getByText(/Page 1 of 2/)).toHaveTextContent(
      'Trading days 1–15 of 16',
    );
    expect(screen.getByText('2026-07-25')).toBeInTheDocument();
    expect(screen.queryByText('2026-07-10')).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Report totals')).getByText('₱30,240.00'),
    ).toBeInTheDocument();

    await user.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(within(pagination).getByText(/Page 2 of 2/)).toHaveTextContent(
      'Trading days 16–16 of 16',
    );
    expect(screen.getByText('2026-07-10')).toBeInTheDocument();
    expect(screen.queryByText('2026-07-25')).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Report totals')).getByText('₱30,240.00'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(await within(pagination).findByText(/Page 1 of 2/)).toHaveTextContent(
      'Trading days 1–15 of 16',
    );
  });

  it('sorts product sales descending and caches the all-time result', async () => {
    const rangeReport: SalesRangeReport = {
      ...report,
      topProducts: [
        {
          productId: 'mocha',
          productName: 'Mocha',
          quantitySold: 2,
          cupsSold: 6,
          revenueCents: cents(60000),
        },
        {
          productId: 'americano',
          productName: 'Americano',
          quantitySold: 4,
          cupsSold: 4,
          revenueCents: cents(60000),
        },
      ],
    };
    const allTimeProducts = [
      {
        productId: 'latte',
        productName: 'Latte',
        quantitySold: 20,
        cupsSold: 24,
        revenueCents: 200000,
      },
      {
        productId: 'americano',
        productName: 'Americano',
        quantitySold: 30,
        cupsSold: 30,
        revenueCents: 150000,
      },
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(rangeReport))
      .mockResolvedValueOnce(jsonResponse(allTimeProducts));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderReportsPage();

    const table = await screen.findByRole('table', { name: 'Product sales' });
    let rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Americano')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Mocha')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Revenue/ }),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(
      screen.getByRole('columnheader', { name: /Cups/ }),
    ).toHaveAttribute('aria-sort', 'none');

    const rangeFooter = within(table.querySelector('tfoot') as HTMLElement);
    expect(rangeFooter.getByText('Total')).toBeInTheDocument();
    expect(rangeFooter.getByText('6')).toBeInTheDocument();
    expect(rangeFooter.getByText('10')).toBeInTheDocument();
    expect(rangeFooter.getByText('₱1,200.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cups, not sorted' }));
    rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Mocha')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Cups/ }),
    ).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: 'Qty sold, not sorted' }));
    rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Americano')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Qty sold/ }),
    ).toHaveAttribute('aria-sort', 'descending');

    const allTimeToggle = screen.getByRole('checkbox', { name: 'Show all time' });
    await user.click(allTimeToggle);
    expect(await screen.findByText('All time')).toBeInTheDocument();
    expect(
      screen.getByText(/The totals, Daily reconciliation and the CSV export/),
    ).toBeInTheDocument();
    rows = within(screen.getByRole('table', { name: 'Product sales' })).getAllByRole(
      'row',
    );
    expect(within(rows[1]!).getByText('Americano')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Latte')).toBeInTheDocument();
    const allTimeFooter = within(
      screen.getByRole('table', { name: 'Product sales' }).querySelector('tfoot') as HTMLElement,
    );
    expect(allTimeFooter.getByText('50')).toBeInTheDocument();
    expect(allTimeFooter.getByText('54')).toBeInTheDocument();
    expect(allTimeFooter.getByText('₱3,500.00')).toBeInTheDocument();

    await user.click(allTimeToggle);
    await user.click(allTimeToggle);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/reporting/product-sales/all-time',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('keeps an all-time load failure inside the product-sales panel', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderReportsPage();
    await screen.findByRole('table', { name: 'Product sales' });

    await user.click(screen.getByRole('checkbox', { name: 'Show all time' }));

    const productPanel = screen
      .getByRole('heading', { name: 'Product sales' })
      .closest('section')!;
    expect(
      await within(productPanel).findByRole('alert'),
    ).toHaveTextContent('All-time product sales could not be loaded.');
    expect(
      within(screen.getByLabelText('Report totals')).getByText('₱30,240.00'),
    ).toBeInTheDocument();
  });

  it('keeps the last valid results and makes no request for an invalid range', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(report));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderReportsPage();

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
    renderReportsPage();
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
    expect(
      screen.queryByRole('navigation', { name: 'Daily reconciliation pages' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/reporting/report?from=2026-06-01&to=2026-06-02',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
  });
});
