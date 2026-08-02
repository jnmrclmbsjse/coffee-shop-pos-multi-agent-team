import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  cents,
  LineDiscountKind,
  OrderStatus,
  PaymentMethod,
  ServiceType,
  type CurrentOpenBusinessDay,
  type LineItem,
  type Order,
  type Product,
} from '@coffee-shop/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TakeOrderPage } from './TakeOrderPage';
import { OrderCaptureApiError } from './api';

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
  completeOrder: vi.fn(),
  voidOrder: vi.fn(),
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
    completeOrder: mocks.completeOrder,
    voidOrder: mocks.voidOrder,
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

function completedOrder(
  overrides: Partial<Order> = {},
): Order {
  return {
    ...order(),
    status: OrderStatus.COMPLETED,
    cashReceivedCents: cents(15_000),
    completedAt: '2026-08-02T02:00:00.000Z',
    payments: [
      {
        id: '70000000-0000-4000-8000-000000000001',
        saleId: '40000000-0000-4000-8000-000000000001',
        method: PaymentMethod.CASH,
        amountCents: cents(15_000),
      },
    ],
    ...overrides,
  };
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
  mocks.completeOrder.mockReset();
  mocks.voidOrder.mockReset();
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

  it('treats blank cash received as exact and shows the completed breakdown', async () => {
    const completed = completedOrder();
    await startOrder();
    mocks.completeOrder.mockResolvedValueOnce(completed);

    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    expect(screen.getByRole('textbox', { name: 'Cash received (optional)' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Complete cash payment' }));

    await screen.findByRole('heading', { name: 'Order #12 completed' });
    expect(mocks.completeOrder).toHaveBeenCalledWith(
      order().clientGeneratedId,
      expect.objectContaining({
        payments: [{ method: PaymentMethod.CASH, amountCents: cents(15_000) }],
        cashReceivedCents: null,
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Amount due₱150.00');
    expect(dialog).toHaveTextContent('Cash payment₱150.00');
  });

  it('renders the server rejection when cash received is below tender', async () => {
    await startOrder();
    mocks.completeOrder.mockRejectedValueOnce(
      new OrderCaptureApiError(400, [
        'Cash received must be at least the cash tender amount',
      ]),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Cash received (optional)' }),
      '100.00',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Complete cash payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cash received must be at least the cash tender amount',
    );
  });

  it('hides cash fields for Online and keeps the cash tip separate from amount due', async () => {
    const completed = completedOrder({
      cashTipCents: cents(2_000),
      cashReceivedCents: null,
      payments: [
        {
          id: '70000000-0000-4000-8000-000000000002',
          saleId: '40000000-0000-4000-8000-000000000001',
          method: PaymentMethod.ONLINE,
          amountCents: cents(15_000),
        },
      ],
    });
    await startOrder();
    mocks.completeOrder.mockResolvedValueOnce(completed);

    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Online' }));
    expect(screen.queryByRole('textbox', { name: 'Cash received (optional)' })).not.toBeInTheDocument();
    expect(screen.queryByText('Change due')).not.toBeInTheDocument();
    const tip = screen.getByRole('textbox', { name: 'Tip amount' });
    await userEvent.clear(tip);
    await userEvent.type(tip, '20.00');
    await userEvent.click(screen.getByRole('button', { name: 'Complete online payment' }));

    expect(mocks.completeOrder).toHaveBeenCalledWith(
      order().clientGeneratedId,
      {
        payments: [{ method: PaymentMethod.ONLINE, amountCents: cents(15_000) }],
        cashTipCents: cents(2_000),
        changeOwedCents: cents(0),
      },
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Amount due₱150.00');
    expect(dialog).toHaveTextContent('Cash tip (separate)₱20.00');
  });

  it('rejects split portions that are negative or do not match the amount due', async () => {
    await startOrder();
    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Split' }));
    const cash = screen.getByRole('textbox', { name: 'Cash portion' });
    const online = screen.getByRole('textbox', { name: 'Online portion' });

    await userEvent.type(cash, '-1.00');
    await userEvent.type(online, '151.00');
    await userEvent.click(screen.getByRole('button', { name: 'Complete split payment' }));
    expect(screen.getByText('Cash and Online portions cannot be negative.')).toBeInTheDocument();
    expect(mocks.completeOrder).not.toHaveBeenCalled();

    await userEvent.clear(cash);
    await userEvent.type(cash, '50.00');
    await userEvent.clear(online);
    await userEvent.type(online, '50.00');
    await userEvent.click(screen.getByRole('button', { name: 'Complete split payment' }));
    expect(screen.getByText('₱50.00 remains to allocate.')).toBeInTheDocument();
    expect(mocks.completeOrder).not.toHaveBeenCalled();

    mocks.completeOrder.mockResolvedValueOnce(
      completedOrder({
        cashReceivedCents: cents(5_000),
        payments: [
          {
            id: '70000000-0000-4000-8000-000000000003',
            saleId: '40000000-0000-4000-8000-000000000001',
            method: PaymentMethod.CASH,
            amountCents: cents(5_000),
          },
          {
            id: '70000000-0000-4000-8000-000000000004',
            saleId: '40000000-0000-4000-8000-000000000001',
            method: PaymentMethod.ONLINE,
            amountCents: cents(10_000),
          },
        ],
      }),
    );
    await userEvent.clear(online);
    await userEvent.type(online, '100.00');
    await userEvent.click(screen.getByRole('button', { name: 'Complete split payment' }));
    const completedDialog = await screen.findByRole('dialog');
    expect(completedDialog).toHaveTextContent('Cash payment₱50.00');
    expect(completedDialog).toHaveTextContent('Online payment₱100.00');
  });

  it('records change owed deliberately and keeps it visible in completion', async () => {
    const completed = completedOrder({
      cashReceivedCents: cents(20_000),
      changeOwedCents: cents(3_000),
    });
    await startOrder();
    mocks.completeOrder.mockResolvedValueOnce(completed);

    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Cash received (optional)' }),
      '200.00',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Record change still owed/ }));
    const owed = screen.getByRole('textbox', { name: /Amount still owed/ });
    await userEvent.clear(owed);
    await userEvent.type(owed, '30.00');
    await userEvent.click(screen.getByRole('button', { name: 'Complete cash payment' }));

    expect(mocks.completeOrder).toHaveBeenCalledWith(
      order().clientGeneratedId,
      expect.objectContaining({ changeOwedCents: cents(3_000) }),
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Change still owed₱30.00',
    );
  });

  it('requires a void reason and sends a stable idempotency id', async () => {
    const completed = completedOrder();
    const correction = completedOrder({
      id: '80000000-0000-4000-8000-000000000001',
      clientGeneratedId: '90000000-0000-4000-8000-000000000001',
      kind: 'VOID',
      correctsSaleId: completed.id,
      dayOrderNumber: 13,
      voidReason: 'Wrong drink',
    });
    await startOrder();
    mocks.completeOrder.mockResolvedValueOnce(completed);
    mocks.voidOrder.mockResolvedValueOnce(correction);
    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Complete cash payment' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Void order' }));

    await userEvent.click(screen.getByRole('button', { name: 'Void completed order' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
    expect(mocks.voidOrder).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason for void' }), ' Wrong drink ');
    await userEvent.click(screen.getByRole('button', { name: 'Void completed order' }));
    expect(mocks.voidOrder).toHaveBeenCalledWith(
      completed.clientGeneratedId,
      expect.objectContaining({ voidReason: 'Wrong drink' }),
    );
    expect(await screen.findByRole('heading', { name: 'Order #12 is void' })).toBeInTheDocument();
    expect(screen.getByText(/original remains visible as void/i)).toBeInTheDocument();
  });

  it('reuses the same client-generated order id when completion is retried', async () => {
    await startOrder();
    mocks.completeOrder
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(completedOrder());
    await userEvent.click(screen.getByRole('button', { name: 'Charge ₱150.00' }));
    const completeButton = screen.getByRole('button', { name: 'Complete cash payment' });
    await userEvent.click(completeButton);
    await screen.findByText('The order change could not be saved. Try again.');
    await userEvent.click(completeButton);
    await screen.findByRole('heading', { name: 'Order #12 completed' });

    expect(mocks.completeOrder).toHaveBeenCalledTimes(2);
    expect(mocks.completeOrder.mock.calls[0]![0]).toBe(order().clientGeneratedId);
    expect(mocks.completeOrder.mock.calls[1]![0]).toBe(order().clientGeneratedId);
  });
});
