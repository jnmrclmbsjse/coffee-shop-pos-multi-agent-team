import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cents,
  DayType,
  type CurrentOpenBusinessDay,
  type TradingDayClosingSummary,
} from '@coffee-shop/shared';
import { SignedInAs } from '../auth/session-test-utils';
import {
  CloseBusinessDayPage,
  OpenBusinessDayPage,
} from './StaffTradingDayPages';

const activeStaff = [
  {
    id: '8ce77958-342f-4c1a-a8dd-bc3fcd71a96a',
    displayName: 'Maya Santos',
  },
  {
    id: '061c7a67-e01e-4b20-b2fb-d83f2ce6997e',
    displayName: 'Leo Cruz',
  },
];

const openDay: CurrentOpenBusinessDay = {
  isOpen: true,
  businessDate: '2026-07-30',
  dayType: DayType.NORMAL,
  openingFloatCents: cents(50000),
  openedByDisplayName: 'Maya Santos',
  openedAt: '2026-07-30T23:00:00.000Z',
};

const noOpenDay: CurrentOpenBusinessDay = {
  isOpen: false,
  businessDate: null,
  dayType: null,
  openingFloatCents: null,
  openedByDisplayName: null,
  openedAt: null,
};

function closingSummary(
  overrides: Partial<TradingDayClosingSummary> = {},
): TradingDayClosingSummary {
  return {
    isOpen: true,
    businessDate: '2026-07-30',
    openingFloatCents: cents(50000),
    cashSalesCents: cents(12500),
    onlineSalesCents: cents(8000),
    grossSalesCents: cents(20500),
    cashTipsCents: cents(500),
    cashInCents: cents(0),
    cashOutCents: cents(0),
    cashExpensesCents: cents(0),
    outstandingChangeCents: cents(100),
    expectedCashCents: cents(63100),
    packaging: [],
    hasClosingStockCount: true,
    ...overrides,
  };
}

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderOpenPage(signedInStaffMemberId: string | null = null) {
  return render(
    <SignedInAs staffMemberId={signedInStaffMemberId}>
      <MemoryRouter>
        <OpenBusinessDayPage />
      </MemoryRouter>
    </SignedInAs>,
  );
}

function renderClosePage(signedInStaffMemberId: string | null = null) {
  return render(
    <SignedInAs staffMemberId={signedInStaffMemberId}>
      <MemoryRouter>
        <CloseBusinessDayPage />
      </MemoryRouter>
    </SignedInAs>,
  );
}

describe('staff business-day pages', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the opening form when no day is open and reports every missing field', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderOpenPage();

    await user.click(await screen.findByRole('button', { name: 'Open day' }));

    expect(screen.getByText('Choose a business date.')).toBeInTheDocument();
    expect(
      screen.getByText('Choose Normal day or Peak day.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Enter the opening cash float.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Choose the staff member opening the day.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Business date *')).toHaveFocus();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('defaults Opened by to the signed-in staff member', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderOpenPage(activeStaff[1]!.id);

    const openedBy = await screen.findByLabelText('Opened by *');
    expect(openedBy).toHaveValue(activeStaff[1]!.id);
  });

  it('keeps Opened by unselected when the signed-in user is not on the roster', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderOpenPage('4a2a2f4e-0f2a-4a1e-9a0d-6d7c2c0e0000');

    expect(await screen.findByLabelText('Opened by *')).toHaveValue('');
  });

  it('lets the signed-in default be changed to another staff member', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderOpenPage(activeStaff[1]!.id);

    const openedBy = await screen.findByLabelText('Opened by *');
    await user.selectOptions(openedBy, activeStaff[0]!.id);

    expect(openedBy).toHaveValue(activeStaff[0]!.id);
  });

  it.each([
    ['-0.01', 'Opening cash float cannot be negative.'],
    ['12.345', 'Enter a valid amount in pesos with up to two centavos digits.'],
  ])('rejects an opening float of %s', async (value, message) => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderOpenPage();

    fireEvent.change(await screen.findByLabelText('Business date *'), {
      target: { value: '2026-07-31' },
    });
    await user.click(screen.getByRole('radio', { name: 'Normal day' }));
    await user.type(screen.getByLabelText('Opening cash float *'), value);
    await user.selectOptions(
      screen.getByLabelText('Opened by *'),
      activeStaff[0]!.id,
    );
    await user.click(screen.getByRole('button', { name: 'Open day' }));

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('submits integer cents once and disables opening while the request is in flight', async () => {
    let finishOpen: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current') return response(200, noOpenDay);
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      if (path === '/trading-day/open' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          finishOpen = resolve;
        });
      }
      return response(500);
    });
    const user = userEvent.setup();

    renderOpenPage();

    fireEvent.change(await screen.findByLabelText('Business date *'), {
      target: { value: '2026-07-31' },
    });
    await user.click(screen.getByRole('radio', { name: 'Peak day' }));
    await user.type(screen.getByLabelText('Opening cash float *'), '500.25');
    await user.selectOptions(
      screen.getByLabelText('Opened by *'),
      activeStaff[0]!.id,
    );
    await user.click(screen.getByRole('button', { name: 'Open day' }));

    expect(
      screen.getByRole('button', { name: 'Opening day…' }),
    ).toBeDisabled();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/trading-day/open',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          businessDate: '2026-07-31',
          dayType: DayType.PEAK,
          openingFloatCents: 50025,
          openedByStaffMemberId: activeStaff[0]!.id,
        }),
      }),
    );

    finishOpen?.(response(201, { ...openDay, dayType: DayType.PEAK }));
    expect(
      await screen.findByRole('heading', { name: 'Thursday, Jul 30, 2026' }),
    ).toBeInTheDocument();
  });

  it('shows all open-day summary fields and no opening control when a day is open', async () => {
    fetchMock.mockResolvedValueOnce(response(200, openDay));

    renderOpenPage();

    expect(
      await screen.findByRole('heading', { name: 'Thursday, Jul 30, 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Normal day')).toBeInTheDocument();
    expect(screen.getByText('₱500.00')).toBeInTheDocument();
    expect(screen.getByText('Maya Santos')).toBeInTheDocument();
    expect(screen.getByText('7:00 AM')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /open day/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Business date *')).not.toBeInTheDocument();
  });

  it('shows the advisory link without blocking close when no closing count exists', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(
          200,
          closingSummary({
            hasClosingStockCount: false,
            packaging: [
              {
                inventoryItemId: 'cup-id',
                itemName: '16 oz Cup',
                openingQty: 0,
                deliveriesQty: 0,
                wastageQty: 0,
                soldQty: 0,
                expectedQty: 0,
                actualQty: null,
                varianceQty: null,
              },
            ],
          }),
        );
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderClosePage();

    const link = await screen.findByRole('link', {
      name: 'Do the closing count.',
    });
    expect(link).toHaveAttribute('href', '/pos/closing');
    expect(screen.getByText('— no closing count')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close day' })).toBeEnabled();
  });

  it('distinguishes unknown packaging quantities from a genuine zero', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(
          200,
          closingSummary({
            packaging: [
              {
                inventoryItemId: 'unknown-opening',
                itemName: '12 oz Cup',
                openingQty: null,
                deliveriesQty: 0,
                wastageQty: 0,
                soldQty: 0,
                expectedQty: null,
                actualQty: 4,
                varianceQty: null,
              },
              {
                inventoryItemId: 'genuine-zero',
                itemName: '12 oz Lid',
                openingQty: 0,
                deliveriesQty: 0,
                wastageQty: 0,
                soldQty: 0,
                expectedQty: 0,
                actualQty: 0,
                varianceQty: 0,
              },
              {
                inventoryItemId: 'unknown-actual',
                itemName: '16 oz Cup',
                openingQty: 8,
                deliveriesQty: 0,
                wastageQty: 0,
                soldQty: 0,
                expectedQty: 8,
                actualQty: null,
                varianceQty: null,
              },
            ],
          }),
        );
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderClosePage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('— no opening count')).toBeInTheDocument();
    expect(within(table).getByText('— not in count')).toBeInTheDocument();
    expect(within(table).getByText('0 Balanced')).toBeInTheDocument();
    const zeroRow = within(table)
      .getByRole('rowheader', { name: '12 oz Lid' })
      .closest('tr');
    expect(zeroRow).not.toBeNull();
    expect(within(zeroRow!).getAllByText('0')).toHaveLength(2);
    expect(
      screen.queryByText('No closing count submitted yet.'),
    ).not.toBeInTheDocument();
  });

  it('defaults Closed by to the signed-in staff member', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderClosePage(activeStaff[1]!.id);

    expect(await screen.findByLabelText('Closed by *')).toHaveValue(
      activeStaff[1]!.id,
    );
  });

  it('keeps Closed by unselected when the signed-in user is not on the roster', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderClosePage('4a2a2f4e-0f2a-4a1e-9a0d-6d7c2c0e0000');

    expect(await screen.findByLabelText('Closed by *')).toHaveValue('');
  });

  it('lets the signed-in Closed by default be changed', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderClosePage(activeStaff[1]!.id);

    const closedBy = await screen.findByLabelText('Closed by *');
    await user.selectOptions(closedBy, activeStaff[0]!.id);

    expect(closedBy).toHaveValue(activeStaff[0]!.id);
  });

  it('renders every cash-summary term, including excluded online sales and zeroes', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });

    renderClosePage();

    await screen.findByRole('heading', { name: 'Cash summary' });
    for (const label of [
      'Cash float',
      'Cash sales',
      'Online sales (excluded)',
      'Cash tips',
      'Cash in',
      'Cash out',
      'Expenses (cash)',
      'Change owed (still in drawer)',
      'Expected cash',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByText('Does not contribute to expected cash.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('+₱0.00')).toHaveLength(1);
    expect(screen.getAllByText('−₱0.00')).toHaveLength(2);
  });

  it('updates discrepancy live for balanced, short, and over counts', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary({ expectedCashCents: cents(10000) }));
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderClosePage();

    const input = await screen.findByLabelText('Actual cash counted *');
    await user.type(input, '100.00');
    expect(screen.getByText('₱0.00 Balanced')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '95.50');
    expect(screen.getByText('▾ Short ₱4.50')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '104.50');
    expect(screen.getByText('▴ Over ₱4.50')).toBeInTheDocument();
  });

  it('rejects missing close fields without submitting', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderClosePage();

    await user.click(await screen.findByRole('button', { name: 'Close day' }));

    expect(screen.getByText('Enter the actual cash counted.')).toBeInTheDocument();
    expect(
      screen.getByText('Choose the staff member closing the day.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Actual cash counted *')).toHaveFocus();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          new URL(String(url)).pathname === '/trading-day/close' &&
          init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it.each([
    ['-1.00', 'Actual cash counted cannot be negative.'],
    ['1.001', 'Enter a valid amount in pesos with up to two centavos digits.'],
  ])('rejects an actual cash count of %s', async (value, message) => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();

    renderClosePage();

    await user.type(await screen.findByLabelText('Actual cash counted *'), value);
    await user.selectOptions(
      screen.getByLabelText('Closed by *'),
      activeStaff[0]!.id,
    );
    await user.click(screen.getByRole('button', { name: 'Close day' }));

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('submits close in cents and makes the action unavailable in flight', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/trading-day/current/closing-summary') {
        return response(200, closingSummary());
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      if (path === '/trading-day/close' && init?.method === 'POST') {
        return new Promise<Response>(() => undefined);
      }
      return response(500);
    });
    const user = userEvent.setup();

    renderClosePage();

    await user.type(await screen.findByLabelText('Actual cash counted *'), '631.00');
    await user.type(screen.getByLabelText('Discrepancy reason (optional)'), ' Balanced ');
    await user.selectOptions(
      screen.getByLabelText('Closed by *'),
      activeStaff[1]!.id,
    );
    await user.click(screen.getByRole('button', { name: 'Close day' }));

    expect(
      screen.getByRole('button', { name: 'Closing day…' }),
    ).toBeDisabled();
    const closeCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === '/trading-day/close' &&
        init?.method === 'POST',
    );
    expect(closeCall).toBeDefined();
    expect(JSON.parse(String(closeCall?.[1]?.body))).toEqual({
      clientGeneratedId: expect.any(String),
      actualCashCents: 63100,
      varianceReason: 'Balanced',
      closedByStaffMemberId: activeStaff[1]!.id,
    });
  });

  it('explains that there is no day to close and offers no submission', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        ...closingSummary(),
        isOpen: false,
        businessDate: null,
      }),
    );

    renderClosePage();

    expect(
      await screen.findByText('No business day is open to close.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close day' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Actual cash counted *')).not.toBeInTheDocument();
  });
});
