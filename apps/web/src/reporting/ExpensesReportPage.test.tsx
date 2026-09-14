import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cents, type ExpenseReport } from '@coffee-shop/shared';
import { ExpensesReportPage } from './ExpensesReportPage';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const report: ExpenseReport = {
  from: '2026-07-13',
  to: '2026-07-26',
  totalCents: cents(15_500),
  byCategory: [
    { category: 'Supplies', entryCount: 1, totalCents: cents(12_500) },
    { category: null, entryCount: 1, totalCents: cents(3_000) },
  ],
  items: [
    {
      id: 'amended-expense',
      businessDate: '2026-07-25',
      dayStatus: 'open',
      recordedAt: '2026-07-25T09:30:00.000Z',
      category: 'Supplies',
      description: 'Corrected paper cups',
      amountCents: cents(12_500),
      recordedByName: 'Mika Reyes',
      amended: true,
    },
    {
      id: 'uncategorized-expense',
      businessDate: '2026-07-24',
      dayStatus: 'closed',
      recordedAt: '2026-07-24T08:00:00.000Z',
      category: null,
      description: 'Courier fee',
      amountCents: cents(3_000),
      recordedByName: null,
      amended: false,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports/expenses']}>
      <ExpensesReportPage />
    </MemoryRouter>,
  );
}

describe('ExpensesReportPage', () => {
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

  it('renders totals, category groups, item details, open status and amendment marker', async () => {
    fetchMock.mockResolvedValue(response(report));
    renderPage();

    expect(await screen.findByText('₱155.00')).toBeInTheDocument();
    const categories = screen.getByRole('table', {
      name: 'Expenses by category',
    });
    expect(within(categories).getByText('Supplies')).toBeInTheDocument();
    expect(within(categories).getByText('Uncategorized')).toBeInTheDocument();
    const entries = screen.getByRole('table', { name: 'Expense entries' });
    expect(within(entries).getByText('Corrected paper cups')).toBeInTheDocument();
    expect(within(entries).getByText('Amended')).toBeInTheDocument();
    expect(within(entries).getByText('Open')).toBeInTheDocument();
    expect(within(entries).getByText('Closed')).toBeInTheDocument();
    expect(within(entries).getByText('Mika Reyes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows one empty state without zero-value tables', async () => {
    fetchMock.mockResolvedValue(
      response({ ...report, totalCents: 0, byCategory: [], items: [] }),
    );
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'No expenses in this range' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('₱0.00')).not.toBeInTheDocument();
  });

  it('keeps the last report and makes no request for an invalid range', async () => {
    fetchMock.mockResolvedValue(response(report));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('Expense entries');

    await user.clear(screen.getByLabelText('From'));

    expect(
      screen.getByText('Choose both a From date and a To date.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Expense entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests a new inclusive range', async () => {
    fetchMock.mockResolvedValue(response(report));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('Expense entries');

    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2026-06-01');
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2026-06-02');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/reporting/expenses?from=2026-06-01&to=2026-06-02',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
  });
});
