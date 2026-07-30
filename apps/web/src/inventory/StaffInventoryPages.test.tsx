import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CountMethod,
  DayType,
  MovementType,
  StockLevel,
  type CountSheet,
  type CurrentOpenBusinessDay,
  type RestockStatusResult,
  type StockMovementList,
} from '@coffee-shop/shared';
import {
  ClosingCountPage,
  OpeningCountPage,
  RestockStatusPage,
  StockMovementsPage,
} from './StaffInventoryPages';

const quantityItem = {
  id: '31d7904f-7d96-44e5-a87a-c6fe9191cc23',
  name: 'Cup',
  size: '16 oz',
  unit: 'pcs',
  countMethod: CountMethod.QUANTITY,
  critical: true,
};

const levelItem = {
  id: 'b4d5169f-3747-44a0-a011-1b22cadf26eb',
  name: 'Coffee beans',
  size: null,
  unit: 'bag',
  countMethod: CountMethod.LEVEL,
  critical: true,
};

const nonCriticalItem = {
  id: 'fdd09371-e3d0-4acb-a2c2-0df5cfa9686d',
  name: 'Napkins',
  size: null,
  unit: 'pack',
  countMethod: CountMethod.QUANTITY,
  critical: false,
};

const openDay = {
  isOpen: true,
  businessDate: '2026-07-30',
  dayType: DayType.NORMAL,
};

const noOpenDay = {
  isOpen: false,
  businessDate: null,
  dayType: null,
};

const activeStaff = [
  {
    id: '8ce77958-342f-4c1a-a8dd-bc3fcd71a96a',
    displayName: 'Maya Santos',
  },
];

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sheet(
  phase: 'open' | 'close',
  items = [quantityItem, levelItem],
  businessDay: CurrentOpenBusinessDay = openDay,
  submittedCount: CountSheet['submittedCount'] = null,
): CountSheet {
  return { phase, businessDay, items, submittedCount };
}

function installCountFetch(nextSheet: CountSheet) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/inventory/counts/staff') {
      return response(200, activeStaff);
    }
    if (path.endsWith('-sheet')) return response(200, nextSheet);
    return response(500);
  });
}

function renderPage(page: React.ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('staff inventory screens', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the opening sheet from the critical-only API response', async () => {
    installCountFetch(sheet('open', [levelItem, quantityItem]));

    renderPage(<OpeningCountPage />);

    expect(await screen.findByText('Coffee beans')).toBeInTheDocument();
    expect(screen.getByText('Cup')).toBeInTheDocument();
    expect(screen.queryByText('Napkins')).not.toBeInTheDocument();
  });

  it('keeps the closing sheet ordering returned by the API', async () => {
    installCountFetch(
      sheet('close', [levelItem, quantityItem, nonCriticalItem]),
    );

    renderPage(<ClosingCountPage />);

    await screen.findByText('Coffee beans');
    const rows = document.querySelectorAll('.staff-count-row');
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining('Coffee beans'),
      expect.stringContaining('Cup'),
      expect.stringContaining('Napkins'),
    ]);
  });

  it('uses only active staff returned by the API in count and movement selects', async () => {
    installCountFetch(sheet('open'));
    const opening = renderPage(<OpeningCountPage />);

    await screen.findByRole('heading', { name: 'Opening count' });
    expect(screen.getByLabelText(/Submitted by/)).toHaveTextContent('Maya Santos');
    expect(screen.getByLabelText(/Shift lead/)).toHaveTextContent(
      'Maya Santos',
    );
    expect(screen.queryByText('Inactive Person')).not.toBeInTheDocument();
    opening.unmount();

    const movements: StockMovementList = {
      businessDay: openDay,
      movements: [],
    };
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/movements') return response(200, movements);
      if (path === '/inventory/counts/closing-sheet') {
        return response(200, sheet('close'));
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    renderPage(<StockMovementsPage />);

    expect(await screen.findByLabelText(/Recorded by/)).toHaveTextContent(
      'Maya Santos',
    );
    expect(screen.queryByText('Inactive Person')).not.toBeInTheDocument();
  });

  it('starts every level choice unset and floors quantity counts at zero', async () => {
    installCountFetch(sheet('open'));
    renderPage(<OpeningCountPage />);

    await screen.findByText('Coffee beans');
    for (const label of [
      'Empty',
      'Low',
      'Quarter',
      'One-third',
      'Half',
      'Two-thirds',
      'Three-quarters',
      'Full',
    ]) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    }

    const quantity = screen.getByLabelText(/Quantity for Cup/);
    fireEvent.change(quantity, { target: { value: '-4' } });
    expect(quantity).toHaveValue(0);
  });

  it('keeps count submission disabled without a submitter and while in flight', async () => {
    let resolveSubmit!: (value: Response) => void;
    const pendingSubmit = new Promise<Response>((resolve) => {
      resolveSubmit = resolve;
    });
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/counts/staff') {
        return response(200, activeStaff);
      }
      if (path === '/inventory/counts/opening-sheet') {
        return response(200, sheet('open'));
      }
      if (path === '/inventory/counts' && init?.method === 'POST') {
        return pendingSubmit;
      }
      return response(500);
    });
    renderPage(<OpeningCountPage />);

    const user = userEvent.setup();
    const submit = await screen.findByRole('button', {
      name: 'Submit opening count',
    });
    await user.type(screen.getByLabelText(/Quantity for Cup/), '4');
    expect(submit).toBeDisabled();
    expect(
      screen.getByText('Choose Submitted by to enable submission.'),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Submitted by/), activeStaff[0]!.id);
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(
      screen.getByRole('button', { name: 'Submitting count…' }),
    ).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          new URL(String(url)).pathname === '/inventory/counts' &&
          init?.method === 'POST',
      ),
    ).toHaveLength(1);

    resolveSubmit(
      response(201, {
        id: 'count-id',
        locationId: null,
        businessDate: '2026-07-30',
        phase: 'open',
        submittedByStaffMemberId: activeStaff[0]!.id,
        submittedByNameSnapshot: 'Maya Santos',
        shiftLeadStaffMemberId: null,
        shiftLeadNameSnapshot: null,
        recordedAt: '2026-07-30T08:00:00.000Z',
        lines: [],
      }),
    );
    expect(await screen.findByText('Count submitted')).toBeInTheDocument();
  });

  it('shows submitted counts read-only with no edit or delete affordance', async () => {
    installCountFetch(
      sheet('open', [quantityItem, levelItem], openDay, {
        id: 'count-id',
        locationId: null,
        businessDate: '2026-07-30',
        phase: 'open',
        submittedByStaffMemberId: activeStaff[0]!.id,
        submittedByNameSnapshot: 'Maya Santos',
        shiftLeadStaffMemberId: null,
        shiftLeadNameSnapshot: null,
        recordedAt: '2026-07-30T08:00:00.000Z',
        lines: [
          {
            inventoryItemId: quantityItem.id,
            itemName: quantityItem.name,
            quantity: 12,
            level: null,
          },
        ],
      }),
    );

    renderPage(<OpeningCountPage />);

    expect(await screen.findByText('Count submitted')).toBeInTheDocument();
    expect(screen.getByText('12 pcs')).toBeInTheDocument();
    expect(screen.getByText('Not counted')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record another opening count' }),
    ).toBeInTheDocument();
  });

  it('defaults movement type to Delivery, switches to Wastage, and resets after save', async () => {
    const movements: StockMovementList = {
      businessDay: openDay,
      movements: [],
    };
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/movements' && init?.method === 'POST') {
        return response(201, {
          id: 'movement-id',
          locationId: null,
          businessDate: '2026-07-30',
          inventoryItemId: quantityItem.id,
          itemName: quantityItem.name,
          type: MovementType.WASTAGE,
          quantity: 2,
          recordedByStaffMemberId: null,
          recordedByNameSnapshot: null,
          reason: null,
          recordedAt: '2026-07-30T09:00:00.000Z',
        });
      }
      if (path === '/inventory/movements') return response(200, movements);
      if (path === '/inventory/counts/closing-sheet') {
        return response(200, sheet('close'));
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const user = userEvent.setup();
    renderPage(<StockMovementsPage />);

    const delivery = await screen.findByRole('radio', { name: 'Delivery' });
    const wastage = screen.getByRole('radio', { name: 'Wastage' });
    expect(delivery).toBeChecked();
    await user.click(wastage);
    expect(wastage).toBeChecked();
    await user.selectOptions(screen.getByLabelText(/^Item/), quantityItem.id);
    await user.type(screen.getByLabelText(/^Quantity/), '2');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Movement recorded.');
    expect(delivery).toBeChecked();
    expect(screen.getByLabelText(/^Item/)).toHaveValue('');
    expect(screen.getByText('Cup')).toBeInTheDocument();
  });

  it('renders the movement and restock empty states', async () => {
    const movements: StockMovementList = {
      businessDay: openDay,
      movements: [],
    };
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/movements') return response(200, movements);
      if (path === '/inventory/counts/closing-sheet') {
        return response(200, sheet('close'));
      }
      if (path === '/inventory/counts/staff') return response(200, activeStaff);
      return response(500);
    });
    const movementView = renderPage(<StockMovementsPage />);
    expect(
      await screen.findByText('No movements recorded today.'),
    ).toBeInTheDocument();
    movementView.unmount();

    const restock: RestockStatusResult = {
      businessDay: openDay,
      hasCount: false,
      selectedPhase: null,
      selectedCountId: null,
      selectedCountRecordedAt: null,
      rows: [],
    };
    fetchMock.mockResolvedValue(response(200, restock));
    renderPage(<RestockStatusPage />);
    expect(
      await screen.findByText('No count has been submitted for this day yet.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['open', 'Using opening count submitted at'],
    ['close', 'Using closing count submitted at'],
  ] as const)('names the %s count selected by the restock API', async (phase, label) => {
    const restock: RestockStatusResult = {
      businessDay: openDay,
      hasCount: true,
      selectedPhase: phase,
      selectedCountId: 'count-id',
      selectedCountRecordedAt: '2026-07-30T08:00:00.000Z',
      rows: [
        {
          inventoryItemId: levelItem.id,
          itemName: levelItem.name,
          critical: true,
          countMethod: CountMethod.LEVEL,
          quantity: null,
          level: StockLevel.HALF,
          par: null,
          status: 'BELOW_PAR',
        },
      ],
    };
    fetchMock.mockResolvedValue(response(200, restock));
    renderPage(<RestockStatusPage />);

    expect(await screen.findByText(new RegExp(label))).toBeInTheDocument();
    const row = screen.getByText('Coffee beans').closest('tr')!;
    expect(within(row).getByText('Half')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('uses the shared no-open-day blocking state instead of a form', async () => {
    installCountFetch(sheet('open', [quantityItem], noOpenDay));
    renderPage(<OpeningCountPage />);

    expect(
      await screen.findByText('No business day is open.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit opening count' }),
    ).not.toBeInTheDocument();
  });
});
