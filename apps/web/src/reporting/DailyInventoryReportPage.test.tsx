import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cents,
  CountMethod,
  DayType,
  StockLevel,
  type DailyInventoryReport,
} from '@coffee-shop/shared';
import { DailyInventoryReportPage } from './DailyInventoryReportPage';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports/daily-inventory']}>
      <DailyInventoryReportPage />
    </MemoryRouter>,
  );
}

function reconciliationRow(
  overrides: Partial<DailyInventoryReport['reconciliation'][number]> = {},
): DailyInventoryReport['reconciliation'][number] {
  return {
    inventoryItemId: 'cup-8',
    itemName: '8 oz hot cup',
    openingQty: 12,
    deliveriesQty: 3,
    wastageQty: 1,
    soldQty: 14,
    expectedQty: 0,
    actualQty: 0,
    varianceQty: 0,
    ...overrides,
  };
}

function dailyReport(
  overrides: Partial<DailyInventoryReport> = {},
): DailyInventoryReport {
  return {
    businessDate: '2026-07-26',
    locationId: null,
    hasInventoryInformation: true,
    reconciliation: [reconciliationRow()],
    restock: {
      businessDay: {
        isOpen: false,
        businessDate: '2026-07-26',
        dayType: DayType.NORMAL,
        openingFloatCents: cents(0),
        openedByDisplayName: 'Maya Santos',
        openedAt: '2026-07-26T00:00:00.000Z',
      },
      hasCount: true,
      selectedPhase: 'close',
      selectedCountId: 'closing-count',
      selectedCountRecordedAt: '2026-07-26T13:42:00.000Z',
      rows: [],
    },
    ...overrides,
  };
}

describe('daily inventory report page', () => {
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

  it('renders recorded zeroes separately from every unavailable count combination', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        dailyReport({
          reconciliation: [
            reconciliationRow(),
            reconciliationRow({
              inventoryItemId: 'missing-opening',
              itemName: 'Missing opening',
              openingQty: null,
              expectedQty: null,
              actualQty: 8,
              varianceQty: null,
            }),
            reconciliationRow({
              inventoryItemId: 'missing-closing',
              itemName: 'Missing closing',
              expectedQty: 4,
              actualQty: null,
              varianceQty: null,
            }),
            reconciliationRow({
              inventoryItemId: 'missing-both',
              itemName: 'Missing both',
              openingQty: null,
              expectedQty: null,
              actualQty: null,
              varianceQty: null,
            }),
          ],
        }),
      ),
    );
    renderPage();

    const table = await screen.findByRole('table', {
      name: /Cup and lid counts for July 26, 2026/,
    });
    const rows = within(table).getAllByRole('row');

    expect(within(rows[2]!).getAllByText('0')).toHaveLength(3);
    expect(within(rows[2]!).getByText('Even')).toBeInTheDocument();
    expect(
      within(rows[3]!).getByLabelText(/opening count not submitted/),
    ).toHaveTextContent('Unavailable');
    expect(
      within(rows[3]!).getByLabelText(/expected closing cannot be calculated/),
    ).toHaveTextContent('Unavailable');
    expect(
      within(rows[4]!).getByLabelText(/closing count not submitted/),
    ).toHaveTextContent('Unavailable');
    expect(
      within(rows[5]!).getAllByText('Unavailable'),
    ).toHaveLength(4);
    expect(within(rows[3]!).queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText(/It is not the same as a count of zero/)).toBeInTheDocument();
  });

  it('shows quantity, level, par-less, urgency, and count provenance restock states', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        dailyReport({
          restock: {
            ...dailyReport().restock,
            rows: [
              {
                inventoryItemId: 'oat-milk',
                itemName: 'Oat milk',
                critical: true,
                countMethod: CountMethod.QUANTITY,
                quantity: 2,
                level: null,
                par: null,
                status: 'URGENT',
              },
              {
                inventoryItemId: 'chocolate',
                itemName: 'Chocolate powder',
                critical: false,
                countMethod: CountMethod.LEVEL,
                quantity: null,
                level: StockLevel.HALF,
                par: null,
                status: 'BELOW_PAR',
              },
            ],
          },
        }),
      ),
    );
    renderPage();

    expect(
      await screen.findByText(/uses the closing count submitted on July 26, 2026 at 9:42 PM/),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Items below their restock threshold/ });
    const oatRow = within(table).getByRole('row', { name: /Oat milk/ });
    const levelRow = within(table).getByRole('row', { name: /Chocolate powder/ });
    expect(oatRow).toHaveTextContent('Oat milkCritical2UnavailableUrgent');
    expect(levelRow).toHaveTextContent('Chocolate powderHalfUnavailableBelow par');
    expect(within(levelRow).getByText('Half')).toHaveClass('restock-level');
    expect(within(table).getAllByText('Unavailable')).toHaveLength(2);
  });

  it('shows a positive empty state when a submitted count needs no restocking', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(dailyReport()));
    renderPage();

    expect(await screen.findByText('Nothing needs restocking')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Items below/ })).not.toBeInTheDocument();
  });

  it('shows a no-count restock state without a misleading restock table', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        dailyReport({
          restock: {
            ...dailyReport().restock,
            hasCount: false,
            selectedPhase: null,
            selectedCountId: null,
            selectedCountRecordedAt: null,
            rows: [],
          },
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText('No count submitted for this day')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Items below/ })).not.toBeInTheDocument();
  });

  it('shows the opened-day empty state when the day has no inventory activity', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        dailyReport({
          hasInventoryInformation: false,
          reconciliation: [],
          restock: {
            ...dailyReport().restock,
            hasCount: false,
            selectedPhase: null,
            selectedCountId: null,
            selectedCountRecordedAt: null,
            rows: [],
          },
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText('Nothing reportable for this opened day')).toBeInTheDocument();
    expect(screen.getByText(/was opened, but it has no counts/)).toHaveTextContent(
      'The business day for July 26, 2026 at UCM Coffee Studio was opened',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the not-opened empty state when no business day exists', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        dailyReport({
          hasInventoryInformation: false,
          reconciliation: [],
          restock: {
            ...dailyReport().restock,
            businessDay: {
              isOpen: false,
              businessDate: null,
              dayType: null,
              openingFloatCents: null,
              openedByDisplayName: null,
              openedAt: null,
            },
            hasCount: false,
            selectedPhase: null,
            selectedCountId: null,
            selectedCountRecordedAt: null,
            rows: [],
          },
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText('Business day not opened')).toBeInTheDocument();
    expect(screen.getByText(/No business day was opened/)).toHaveTextContent(
      'No business day was opened for July 26, 2026 at UCM Coffee Studio',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps the loaded report identity over dimmed content until a day change finishes', async () => {
    let resolveNext: ((response: Response) => void) | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(dailyReport()))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveNext = resolve; }),
      );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('Nothing needs restocking');

    const input = screen.getByLabelText('Business date');
    await user.clear(input);
    await user.type(input, '2026-07-27');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading July 27, 2026');
    expect(screen.getByText('July 26, 2026 · UCM Coffee Studio')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs restocking').closest('.reporting-content'))
      .toHaveAttribute('aria-busy', 'true');

    resolveNext?.(jsonResponse(dailyReport({ businessDate: '2026-07-27' })));
    await waitFor(() =>
      expect(screen.getByText('July 27, 2026 · UCM Coffee Studio')).toBeInTheDocument(),
    );
  });
});
