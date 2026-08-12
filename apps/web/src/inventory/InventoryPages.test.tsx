import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountMethod, DayType, StockLevel } from '@coffee-shop/shared';
import { InventoryItemEditorPage, validateParDraft } from './InventoryItemEditorPage';
import { InventoryPage } from './InventoryPage';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const category = {
  id: '6d229ad5-11b5-4f66-8ad8-e792dbf83470',
  name: 'Cups',
  sortWeight: 10,
  active: true,
  itemCount: 1,
};

const item = {
  id: '31d7904f-7d96-44e5-a87a-c6fe9191cc23',
  sku: '16OZ-PET-CUP',
  name: '16oz PET Cup',
  categoryId: category.id,
  category,
  unit: 'pcs',
  size: '16oz',
  countMethod: CountMethod.QUANTITY,
  critical: true,
  reconciled: true,
  active: true,
  parLevels: [
    {
      id: '6661de19-bd4f-4684-ac46-9df9bc651af4',
      inventoryItemId: '31d7904f-7d96-44e5-a87a-c6fe9191cc23',
      dayType: DayType.NORMAL,
      parQty: 100,
      parLevel: null,
      lowThreshold: 40,
      urgentThreshold: 20,
    },
    {
      id: '438422c5-90fb-458c-80ca-ef9bbb97f198',
      inventoryItemId: '31d7904f-7d96-44e5-a87a-c6fe9191cc23',
      dayType: DayType.PEAK,
      parQty: 180,
      parLevel: null,
      lowThreshold: 70,
      urgentThreshold: 30,
    },
  ],
};

const editableQuantityItem = { ...item, reconciled: false };

const levelItem = {
  ...item,
  name: 'Vanilla Syrup',
  unit: 'bottle',
  countMethod: CountMethod.LEVEL,
  reconciled: false,
  parLevels: [
    {
      ...item.parLevels[0],
      parQty: null,
      parLevel: StockLevel.HALF,
      lowThreshold: null,
      urgentThreshold: null,
    },
    {
      ...item.parLevels[1],
      parQty: null,
      parLevel: StockLevel.THREE_QUARTERS,
      lowThreshold: null,
      urgentThreshold: null,
    },
  ],
};

function renderEditor(path = '/inventory/items/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inventory/items/new" element={<InventoryItemEditorPage />} />
        <Route path="/inventory/items/:id/edit" element={<InventoryItemEditorPage />} />
        <Route path="/inventory" element={<div>Inventory list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('inventory management pages', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('combines item search and every selected filter in one request', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/inventory/categories')) {
        return response(200, [category]);
      }
      return response(200, [item]);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );

    await screen.findByText('16oz PET Cup');
    await user.type(screen.getByLabelText('Search stock items'), 'cup');
    await user.selectOptions(screen.getByLabelText('Category'), category.id);
    await user.selectOptions(screen.getByLabelText('Count method'), CountMethod.QUANTITY);
    await user.selectOptions(screen.getByLabelText('Reconciled'), 'true');
    await user.selectOptions(screen.getByLabelText('Critical'), 'true');
    await user.selectOptions(screen.getByLabelText('Status'), 'true');

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const parsed = new URL(String(url));
          return (
            parsed.pathname === '/inventory/items' &&
            parsed.searchParams.get('search') === 'cup' &&
            parsed.searchParams.get('categoryId') === category.id &&
            parsed.searchParams.get('countMethod') === CountMethod.QUANTITY &&
            parsed.searchParams.get('reconciled') === 'true' &&
            parsed.searchParams.get('critical') === 'true' &&
            parsed.searchParams.get('active') === 'true'
          );
        }),
      ).toBe(true);
    });
  });

  it('forces Quantity and disables Level when Reconciled is enabled', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === '/inventory/items' && init?.method === 'POST') {
        return response(201, { ...item, name: 'Test Lid', parLevels: [] });
      }
      if (path.includes('/par-levels/')) {
        return response(200, {});
      }
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor();

    await screen.findByRole('heading', { name: 'Add stock item' });
    await user.selectOptions(screen.getByLabelText(/Category/), category.id);
    await user.type(screen.getByLabelText(/Item name/), 'Test Lid');
    await user.click(screen.getByRole('radio', { name: /Level/ }));
    await user.click(screen.getByRole('switch', { name: 'Reconciled' }));

    expect(screen.getByRole('radio', { name: /Quantity/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Level/ })).toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Save stock item' })[0]!);
    await screen.findByText('Inventory list');

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === '/inventory/items' &&
        init?.method === 'POST',
    );
    expect(
      JSON.parse(String(createCall?.[1]?.body)),
    ).toMatchObject({
      name: 'Test Lid',
      unit: 'pcs',
      reconciled: true,
      countMethod: CountMethod.QUANTITY,
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/par-levels/')),
    ).toHaveLength(2);
  });

  it('shows a referenced-item delete explanation and keeps the editor open', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}` && init?.method === 'DELETE') {
        return response(409, {
          message: 'This stock item is referenced by a catalog product size.',
        });
      }
      if (path === `/inventory/items/${item.id}`) return response(200, item);
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit 16oz PET Cup' });
    await user.click(screen.getByRole('button', { name: 'Delete stock item' }));

    expect(
      await screen.findByText(
        'This stock item is referenced by a catalog product size.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Edit 16oz PET Cup' }),
    ).toBeInTheDocument();
  });

  it('renders saved level targets as independent level controls', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}`) return response(200, levelItem);
      return response(200, []);
    });
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit Vanilla Syrup' });
    const normal = screen.getByRole('group', { name: 'Normal day' });
    const peak = screen.getByRole('group', { name: 'Peak day' });
    expect(within(normal).getAllByRole('radio')).toHaveLength(8);
    expect(within(normal).getByRole('radio', { name: 'Half' })).toBeChecked();
    expect(
      within(peak).getByRole('radio', { name: 'Three-quarters' }),
    ).toBeChecked();
    expect(screen.queryByLabelText(/Par quantity/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Low threshold')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Urgent threshold')).not.toBeInTheDocument();
  });

  it('keeps quantity par fields unchanged for quantity-counted items', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}`) {
        return response(200, editableQuantityItem);
      }
      return response(200, []);
    });
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit 16oz PET Cup' });
    expect(screen.getAllByLabelText(/Par quantity/)).toHaveLength(2);
    expect(screen.getAllByLabelText('Low threshold')).toHaveLength(2);
    expect(screen.getAllByLabelText('Urgent threshold')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: 'Half' })).not.toBeInTheDocument();
  });

  it('re-presents the selected count method before save and restores draft values', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}`) {
        return response(200, editableQuantityItem);
      }
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit 16oz PET Cup' });
    const normalPar = screen.getAllByLabelText(/Par quantity/)[0]!;
    await user.clear(normalPar);
    await user.type(normalPar, '125');
    await user.click(screen.getByRole('radio', { name: /Level/ }));

    expect(screen.queryByLabelText(/Par quantity/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: 'Half' })).toHaveLength(2);
    expect(screen.getByText(/No quantity values were converted/)).toBeVisible();

    await user.click(screen.getByRole('radio', { name: /Quantity/ }));
    expect(screen.getAllByLabelText(/Par quantity/)[0]).toHaveValue('125');
    expect(screen.getByText(/quantity entries.*are restored/i)).toBeVisible();
  });

  it('saves distinct Normal and Peak level targets without quantity fields', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}` && init?.method === 'PATCH') {
        return response(200, levelItem);
      }
      if (path === `/inventory/items/${item.id}`) return response(200, levelItem);
      if (path.includes('/par-levels/')) return response(200, {});
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit Vanilla Syrup' });
    const normal = screen.getByRole('group', { name: 'Normal day' });
    const peak = screen.getByRole('group', { name: 'Peak day' });
    await user.click(within(normal).getByRole('radio', { name: 'Low' }));
    await user.click(within(peak).getByRole('radio', { name: 'Full' }));
    expect(within(normal).getByRole('radio', { name: 'Low' })).toBeChecked();
    expect(within(peak).getByRole('radio', { name: 'Full' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Save stock item' }));
    await screen.findByText('Inventory list');
    const parCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/par-levels/'),
    );
    expect(JSON.parse(String(parCalls[0]?.[1]?.body))).toEqual({
      parLevel: StockLevel.LOW,
    });
    expect(JSON.parse(String(parCalls[1]?.[1]?.body))).toEqual({
      parLevel: StockLevel.FULL,
    });
  });

  it('blocks save and identifies an unset level day without clearing selections', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}`) {
        return response(200, editableQuantityItem);
      }
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit 16oz PET Cup' });
    await user.click(screen.getByRole('radio', { name: /Level/ }));
    const normal = screen.getByRole('group', { name: 'Normal day' });
    const peak = screen.getByRole('group', { name: 'Peak day' });
    await user.click(within(normal).getByRole('radio', { name: 'Quarter' }));
    await user.click(screen.getByRole('button', { name: 'Save stock item' }));

    expect(await screen.findByText('Choose a level for Peak day.')).toBeVisible();
    expect(peak).toHaveAttribute('aria-invalid', 'true');
    expect(within(normal).getByRole('radio', { name: 'Quarter' })).toBeChecked();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH'),
    ).toBe(false);
  });

  it('maps a rejected par write to the affected day control and keeps the form populated', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/inventory/categories') return response(200, [category]);
      if (path === `/inventory/items/${item.id}` && init?.method === 'PATCH') {
        return response(200, levelItem);
      }
      if (path === `/inventory/items/${item.id}`) return response(200, levelItem);
      if (path.endsWith(`/par-levels/${DayType.NORMAL}`)) {
        return response(400, {
          message: 'Level-counted items require a level target',
          field: 'parLevel',
          reason: 'PAR_VALUE_REQUIRED',
        });
      }
      if (path.includes('/par-levels/')) return response(200, {});
      return response(200, []);
    });
    const user = userEvent.setup();
    renderEditor(`/inventory/items/${item.id}/edit`);

    await screen.findByRole('heading', { name: 'Edit Vanilla Syrup' });
    await user.click(screen.getByRole('button', { name: 'Save stock item' }));

    expect(
      await screen.findByText(
        'Normal day: Level-counted items require a level target',
      ),
    ).toBeVisible();
    const normal = screen.getByRole('group', { name: 'Normal day' });
    expect(normal).toHaveAttribute('aria-invalid', 'true');
    expect(within(normal).getByRole('radio', { name: 'Half' })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Edit Vanilla Syrup' })).toBeVisible();
  });
});

describe('par-level validation', () => {
  it('accepts zero and equal Urgent, Low, and Par values', () => {
    expect(
      validateParDraft(
        { parQty: '0', parLevel: '', lowThreshold: '0', urgentThreshold: '0' },
        'Normal day',
        CountMethod.QUANTITY,
      ),
    ).toEqual({
      input: { parQty: 0, lowThreshold: 0, urgentThreshold: 0 },
      errors: {},
    });
  });

  it('rejects an Urgent threshold without Low and ordering violations', () => {
    expect(
      validateParDraft(
        { parQty: '10', parLevel: '', lowThreshold: '', urgentThreshold: '2' },
        'Peak day',
        CountMethod.QUANTITY,
      ).errors.urgentThreshold,
    ).toBe('Enter Peak day Low before adding Urgent.');
    expect(
      validateParDraft(
        { parQty: '10', parLevel: '', lowThreshold: '8', urgentThreshold: '9' },
        'Peak day',
        CountMethod.QUANTITY,
      ).errors.urgentThreshold,
    ).toBe('Peak day Urgent must be less than or equal to Low.');
  });

  it('requires a closed-stock-level value for level pars', () => {
    expect(
      validateParDraft(
        { parQty: '', parLevel: '', lowThreshold: '', urgentThreshold: '' },
        'Normal day',
        CountMethod.LEVEL,
      ),
    ).toEqual({
      errors: { parLevel: 'Choose a level for Normal day.' },
    });
    expect(
      validateParDraft(
        {
          parQty: '',
          parLevel: StockLevel.TWO_THIRDS,
          lowThreshold: '',
          urgentThreshold: '',
        },
        'Peak day',
        CountMethod.LEVEL,
      ),
    ).toEqual({
      input: { parLevel: StockLevel.TWO_THIRDS },
      errors: {},
    });
  });
});
