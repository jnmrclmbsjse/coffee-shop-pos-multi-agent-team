import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  cents,
  LineDiscountKind,
  OrderStatus,
  ServiceType,
  type CurrentOpenBusinessDay,
  type LineItem,
  type Order,
  type Product,
} from '@coffee-shop/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TakeOrderPage } from './TakeOrderPage';

const mocks = vi.hoisted(() => ({
  businessDay: {
    isOpen: true,
    businessDate: '2026-08-02',
    dayType: 'NORMAL',
    openingFloatCents: 10_000,
    openedByDisplayName: 'Shift Lead',
    openedAt: '2026-08-02T00:00:00.000Z',
  } as CurrentOpenBusinessDay,
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  updateProductAvailability: vi.fn(),
  createOrder: vi.fn(),
  listParkedOrders: vi.fn(),
  updateOrder: vi.fn(),
  addOrderLine: vi.fn(),
  updateOrderLine: vi.fn(),
  incrementOrderLine: vi.fn(),
  decrementOrderLine: vi.fn(),
  removeOrderLine: vi.fn(),
}));

vi.mock('../staff/StaffWorkspace', () => ({
  useStaffWorkspaceBusinessDay: () => ({
    businessDay: mocks.businessDay,
    businessDayLoadError: false,
    retryBusinessDay: vi.fn(),
  }),
}));

vi.mock('../auth/device', () => ({ getDeviceId: () => 'test-device' }));

vi.mock('../catalog/api', async () => {
  const actual = await vi.importActual<typeof import('../catalog/api')>(
    '../catalog/api',
  );
  return {
    ...actual,
    listCategories: mocks.listCategories,
    listProducts: mocks.listProducts,
    updateProductAvailability: mocks.updateProductAvailability,
  };
});

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    createOrder: mocks.createOrder,
    listParkedOrders: mocks.listParkedOrders,
    updateOrder: mocks.updateOrder,
    addOrderLine: mocks.addOrderLine,
    updateOrderLine: mocks.updateOrderLine,
    incrementOrderLine: mocks.incrementOrderLine,
    decrementOrderLine: mocks.decrementOrderLine,
    removeOrderLine: mocks.removeOrderLine,
  };
});

const category = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Coffee',
  sortWeight: 10,
  active: true,
  freeUpsizeEligible: true,
  productCount: 2,
};

function product(
  id: string,
  name: string,
  available = true,
  freeUpsizeEligible = true,
): Product {
  return {
    id,
    sku: name.toUpperCase().replaceAll(' ', '-'),
    name,
    categoryId: category.id,
    category: { ...category, freeUpsizeEligible },
    active: true,
    available,
    variants: [
      {
        id: `${id.slice(0, -1)}9`,
        name: 'M',
        priceCents: cents(15_000),
        sortWeight: 10,
        active: true,
        cupInventoryItemId: null,
        lidInventoryItemId: null,
      },
    ],
  };
}

const latte = product(
  '20000000-0000-4000-8000-000000000001',
  'Signature Latte',
);
const mocha = product(
  '20000000-0000-4000-8000-000000000002',
  'Mocha',
);

function line(
  id: string,
  name: string,
  overrides: Partial<LineItem> = {},
): LineItem {
  const quantity = overrides.quantity ?? 1;
  const unitPriceCents = overrides.unitPriceCents ?? cents(15_000);
  return {
    id,
    productVariantId: `${id.slice(0, -1)}9`,
    quantity,
    unitPriceCents,
    lineGrossCents: cents(unitPriceCents * quantity),
    discountKind: LineDiscountKind.NONE,
    discountCents: cents(0),
    preferences: [],
    preferenceNote: null,
    freeUpsizeCount: 0,
    freeUpsizeCents: cents(0),
    freeUpsizeEligible: true,
    lineTotalCents: cents(unitPriceCents * quantity),
    productNameSnapshot: name,
    variantNameSnapshot: 'M',
    ...overrides,
  };
}

function order(lines: LineItem[] = [line('30000000-0000-4000-8000-000000000001', 'Signature Latte')]): Order {
  const subtotalCents = lines.reduce((sum, item) => sum + item.lineGrossCents, 0);
  const discountCents = lines.reduce((sum, item) => sum + item.discountCents, 0);
  const freeUpsizeCents = lines.reduce((sum, item) => sum + item.freeUpsizeCents, 0);
  return {
    id: '40000000-0000-4000-8000-000000000001',
    clientGeneratedId: '50000000-0000-4000-8000-000000000001',
    locationId: null,
    tradingDayId: '60000000-0000-4000-8000-000000000001',
    cashierStaffMemberId: null,
    cashierNameSnapshot: null,
    kind: 'PURCHASE',
    correctsSaleId: null,
    dayOrderNumber: 12,
    status: OrderStatus.PARKED,
    customerName: null,
    serviceType: ServiceType.DINE_IN,
    subtotalCents: cents(subtotalCents),
    discountCents: cents(discountCents),
    freeUpsizeCents: cents(freeUpsizeCents),
    taxCents: cents(0),
    totalCents: cents(subtotalCents - discountCents - freeUpsizeCents),
    cashTipCents: cents(0),
    cashReceivedCents: null,
    changeOwedCents: cents(0),
    changeSettledAt: null,
    completedAt: null,
    voidReason: null,
    recordedAt: '2026-08-02T01:00:00.000Z',
    payments: [],
    lines,
  };
}

function recalculate(nextLines: LineItem[]): Order {
  return order(nextLines);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pos/order']}>
      <TakeOrderPage />
    </MemoryRouter>,
  );
}

async function startOrder(nextOrder = order()) {
  mocks.createOrder.mockResolvedValueOnce(nextOrder);
  renderPage();
  await screen.findByRole('heading', { name: 'Signature Latte' });
  const productCard = screen
    .getByRole('heading', { name: 'Signature Latte' })
    .closest('article')!;
  await userEvent.click(within(productCard).getByRole('button', { name: /M.*₱150\.00/ }));
  await screen.findByRole('heading', { name: 'Order #12' });
  return nextOrder;
}

beforeEach(() => {
  mocks.businessDay = {
    isOpen: true,
    businessDate: '2026-08-02',
    dayType: 'NORMAL',
    openingFloatCents: 10_000,
    openedByDisplayName: 'Shift Lead',
    openedAt: '2026-08-02T00:00:00.000Z',
  } as CurrentOpenBusinessDay;
  vi.clearAllMocks();
  mocks.listCategories.mockResolvedValue([category]);
  mocks.listProducts.mockResolvedValue([latte, mocha]);
  mocks.listParkedOrders.mockResolvedValue([]);
  mocks.updateOrder.mockImplementation(
    async (_id: string, input: Partial<Order>) => ({ ...order(), ...input }),
  );
  mocks.updateProductAvailability.mockImplementation(
    async (id: string, available: boolean) => ({
      ...[latte, mocha].find((item) => item.id === id)!,
      available,
    }),
  );
});

describe('Take Order workspace', () => {
  it('keeps a sold-out product visible and prevents adding its size', async () => {
    mocks.listProducts.mockResolvedValueOnce([{ ...latte, available: false }]);
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'Signature Latte' });
    const card = heading.closest('article')!;
    expect(within(card).getByText('Sold out · Unbuyable')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /M.*₱150\.00/ })).toBeDisabled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('changes availability from the product card and shows the returned state', async () => {
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'Signature Latte' })).closest('article')!;

    await userEvent.click(within(card).getByRole('button', { name: 'Mark sold out' }));

    expect(mocks.updateProductAvailability).toHaveBeenCalledWith(latte.id, false);
    expect(await within(card).findByText('Sold out · Unbuyable')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /M.*₱150\.00/ })).toBeDisabled();
  });

  it('increases, decreases, and removes a line using server-returned orders', async () => {
    const initial = await startOrder();
    mocks.incrementOrderLine.mockResolvedValueOnce(
      recalculate([{ ...initial.lines[0]!, quantity: 2, lineGrossCents: cents(30_000), lineTotalCents: cents(30_000) }]),
    );
    mocks.decrementOrderLine.mockResolvedValueOnce(initial);
    mocks.removeOrderLine.mockResolvedValueOnce(null);

    await userEvent.click(screen.getByRole('button', { name: 'Increase Signature Latte quantity' }));
    expect(await screen.findByLabelText('Quantity 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Decrease Signature Latte quantity' }));
    expect(await screen.findByLabelText('Quantity 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Signature Latte' }));
    expect(await screen.findByText('Order is empty')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New order' })).toBeInTheDocument();
    expect(screen.getByText('Empty order discarded.')).toBeInTheDocument();

    const firstClientId = mocks.createOrder.mock.calls[0]![0].clientGeneratedId;
    mocks.createOrder.mockResolvedValueOnce({ ...order(), dayOrderNumber: 13 });
    const productCard = screen
      .getByRole('heading', { name: 'Signature Latte' })
      .closest('article')!;
    await userEvent.click(within(productCard).getByRole('button', { name: /M.*₱150\.00/ }));
    expect(await screen.findByRole('heading', { name: 'Order #13' })).toBeInTheDocument();
    expect(mocks.createOrder.mock.calls[1]![0].clientGeneratedId).toBe(firstClientId);
  });

  it('saves preferences only on the selected line', async () => {
    const first = line('30000000-0000-4000-8000-000000000001', 'Signature Latte');
    const second = line('30000000-0000-4000-8000-000000000002', 'Mocha');
    await startOrder(order([first, second]));
    mocks.updateOrderLine.mockImplementationOnce(async (_orderId, lineId, input) =>
      order([
        lineId === first.id ? { ...first, ...input } : first,
        lineId === second.id ? { ...second, ...input } : second,
      ]),
    );

    const firstLine = screen.getAllByRole('heading', { name: 'Signature Latte' }).at(-1)!.closest('article')!;
    await userEvent.click(within(firstLine).getByRole('button', { name: 'Preferences' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sweeter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(within(firstLine).getByText('Sweeter')).toBeInTheDocument());
    const secondLine = screen.getAllByRole('heading', { name: 'Mocha' }).at(-1)!.closest('article')!;
    expect(within(secondLine).queryByText('Sweeter')).not.toBeInTheDocument();
  });

  it('applies a discount only to the selected line', async () => {
    const first = line('30000000-0000-4000-8000-000000000001', 'Signature Latte');
    const second = line('30000000-0000-4000-8000-000000000002', 'Mocha');
    await startOrder(order([first, second]));
    mocks.updateOrderLine.mockImplementationOnce(async (_orderId, lineId, input) => {
      const discounted = { ...first, ...input, discountCents: cents(3_000), lineTotalCents: cents(12_000) };
      return order([lineId === first.id ? discounted : first, second]);
    });

    const firstLine = screen.getAllByRole('heading', { name: 'Signature Latte' }).at(-1)!.closest('article')!;
    await userEvent.click(within(firstLine).getByRole('button', { name: 'Discount' }));
    await userEvent.click(screen.getByRole('radio', { name: 'PWD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(within(firstLine).getByText(/PWD/)).toBeInTheDocument());
    const secondLine = screen.getAllByRole('heading', { name: 'Mocha' }).at(-1)!.closest('article')!;
    expect(within(secondLine).queryByText(/PWD/)).not.toBeInTheDocument();
  });

  it('keeps free upsize unavailable when the order has no eligible line', async () => {
    const ineligible = line('30000000-0000-4000-8000-000000000001', 'Milk Chocolate', {
      freeUpsizeEligible: false,
    });
    await startOrder(order([ineligible]));

    expect(screen.getByRole('button', { name: 'Free upsize' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders server totals in the required deduction order without a negative zero', async () => {
    const pricedLine = line('30000000-0000-4000-8000-000000000001', 'Signature Latte', {
      lineGrossCents: cents(15_000),
      freeUpsizeCount: 1,
      freeUpsizeCents: cents(3_000),
      discountKind: LineDiscountKind.SENIOR,
      discountCents: cents(2_400),
      lineTotalCents: cents(9_600),
    });
    await startOrder(order([pricedLine]));

    const totals = screen.getByText('Pre-discount subtotal').closest('dl')!;
    expect([...totals.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
      'Pre-discount subtotal',
      'Free upsize',
      'Line discounts',
      'Amount due',
    ]);
    expect(totals).toHaveTextContent('₱150.00');
    expect(totals).toHaveTextContent('−₱30.00');
    expect(totals).toHaveTextContent('−₱24.00');
    expect(totals).toHaveTextContent('₱96.00');
    expect(totals).not.toHaveTextContent('−₱0.00');
  });

  it('explains that an order cannot start when no business day is open', async () => {
    mocks.businessDay = {
      isOpen: false,
      businessDate: null,
      dayType: null,
      openingFloatCents: null,
      openedByDisplayName: null,
      openedAt: null,
    };
    renderPage();

    expect(await screen.findByRole('heading', { name: 'No business day is open' })).toBeInTheDocument();
    expect(screen.getByText(/An order cannot be started/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open business day' })).toHaveAttribute('href', '/pos/open');
    expect(mocks.listProducts).not.toHaveBeenCalled();
  });

  it('shows no cashier as a supported order attribution', async () => {
    await startOrder(order());

    const cashier = screen.getByText('Cashier').closest('p')!;
    expect(cashier).toHaveTextContent('No cashier');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
