import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesPage } from './CategoriesPage';
import { ProductEditorPage } from './ProductEditorPage';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const categories = [
  {
    id: 'd84d2cc2-e80c-44ac-b5b7-803f44347f2e',
    name: 'Coffee',
    sortWeight: 10,
    active: true,
    productCount: 2,
  },
  {
    id: 'b07a6dc0-af49-427f-bbf1-9a2b861d94da',
    name: 'Pastries',
    sortWeight: 20,
    active: true,
    productCount: 1,
  },
];

const inventoryItems = [
  {
    id: '71158db2-faf1-40a3-8da8-77889c2fe138',
    name: 'Hot Cup 12oz',
  },
];

function renderEditor(path = '/catalog/products/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/catalog/products/new"
          element={<ProductEditorPage />}
        />
        <Route
          path="/catalog/products/:id/edit"
          element={<ProductEditorPage />}
        />
        <Route path="/catalog/products" element={<div>Product list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('catalog management pages', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists category order changed with the keyboard', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, categories))
      .mockResolvedValueOnce(response(204));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>,
    );

    const handle = await screen.findByRole('button', {
      name: /Reorder Coffee/,
    });
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/catalog/categories/reorder',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            items: [
              { id: categories[1]!.id, sortWeight: 10 },
              { id: categories[0]!.id, sortWeight: 20 },
            ],
          }),
        }),
      ),
    );
    expect(screen.getByText('Category order saved.')).toBeInTheDocument();
  });

  it('creates a product with a zero-price size sent as integer cents', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, categories))
      .mockResolvedValueOnce(response(200, inventoryItems))
      .mockResolvedValueOnce(
        response(201, {
          id: '21e1b424-10a8-4280-8ec0-ebf4ce30b5d0',
        }),
      );
    const user = userEvent.setup();

    renderEditor();

    await screen.findByRole('heading', { name: 'Create product' });
    await user.selectOptions(
      screen.getByLabelText(/Category/),
      categories[0]!.id,
    );
    await user.type(screen.getByLabelText(/Product name/), 'Espresso');
    await user.type(screen.getByLabelText(/^Label/), 'Solo');
    await user.click(screen.getAllByRole('button', { name: 'Save product' })[0]!);

    await screen.findByText('Product list');
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/catalog/products') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(
      JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body)),
    ).toMatchObject({
      categoryId: categories[0]!.id,
      name: 'Espresso',
      sizes: [
        {
          name: 'Solo',
          priceCents: 0,
          sortWeight: 10,
          cupInventoryItemId: null,
          lidInventoryItemId: null,
        },
      ],
    });
  });

  it('keeps a sale-referenced size and shows the API explanation', async () => {
    const productId = '9bbf25dd-dfe1-449a-b613-86662980f6b1';
    const product = {
      id: productId,
      sku: 'LATTE',
      name: 'Spanish Latte',
      categoryId: categories[0]!.id,
      category: categories[0]!,
      active: true,
      available: true,
      variants: [
        {
          id: '8d404c23-4b1f-41f5-9e60-eeed8510ac12',
          name: 'Regular',
          priceCents: 14500,
          sortWeight: 10,
          active: true,
          cupInventoryItemId: null,
          lidInventoryItemId: null,
        },
        {
          id: '4794b66f-fcee-47f6-8239-b6e131dbb3a7',
          name: 'Large',
          priceCents: 16500,
          sortWeight: 20,
          active: true,
          cupInventoryItemId: null,
          lidInventoryItemId: null,
        },
      ],
    };
    fetchMock
      .mockResolvedValueOnce(response(200, categories))
      .mockResolvedValueOnce(response(200, inventoryItems))
      .mockResolvedValueOnce(response(200, product))
      .mockResolvedValueOnce(
        response(409, {
          message:
            'This size cannot be removed because it is used by an existing sale',
        }),
      );
    const user = userEvent.setup();

    renderEditor(`/catalog/products/${productId}/edit`);

    await screen.findByRole('heading', { name: 'Edit Spanish Latte' });
    await user.click(screen.getByRole('button', { name: 'Remove Large' }));

    expect(
      await screen.findByText(
        'This size cannot be removed because it is used by an existing sale',
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Large')).toBeInTheDocument();
  });
});
