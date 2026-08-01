import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCashier, SelectableStaffMember } from '@coffee-shop/shared';
import { getDeviceId } from '../auth/device';
import {
  CashierApiError,
  clearActiveCashier,
  getActiveCashier,
  listSelectableCashiers,
  selectActiveCashier,
} from './api';
import { CashierControl } from './CashierControl';

vi.mock('../auth/device', () => ({ getDeviceId: vi.fn() }));
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    clearActiveCashier: vi.fn(),
    getActiveCashier: vi.fn(),
    listSelectableCashiers: vi.fn(),
    selectActiveCashier: vi.fn(),
  };
});

const previous: ActiveCashier = {
  id: 'staff-previous',
  displayName: 'Maya Santos',
};
const noPin: SelectableStaffMember = {
  id: 'staff-no-pin',
  displayName: 'Mara Villanueva',
  requiresPin: false,
};
const pinGated: SelectableStaffMember = {
  id: 'staff-pin',
  displayName: 'Alex Rivera',
  requiresPin: true,
};

describe('CashierControl', () => {
  beforeEach(() => {
    vi.mocked(getDeviceId).mockReturnValue('register-1');
    vi.mocked(getActiveCashier).mockReset();
    vi.mocked(listSelectableCashiers).mockReset();
    vi.mocked(selectActiveCashier).mockReset();
    vi.mocked(clearActiveCashier).mockReset();
  });

  it('selects a non-gated member immediately and refreshes server state', async () => {
    vi.mocked(getActiveCashier)
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(noPin);
    vi.mocked(listSelectableCashiers).mockResolvedValue([noPin, pinGated]);
    vi.mocked(selectActiveCashier).mockResolvedValue(noPin);
    const user = userEvent.setup();
    render(<CashierControl />);

    await screen.findByText(previous.displayName);
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    await user.click(
      await screen.findByRole('button', { name: /Mara Villanueva/ }),
    );

    expect(selectActiveCashier).toHaveBeenCalledWith(
      'register-1',
      noPin.id,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(noPin.displayName)).toBeInTheDocument();
    expect(getActiveCashier).toHaveBeenCalledTimes(2);
  });

  it('uses the keypad for a PIN-gated member and activates only after success', async () => {
    vi.mocked(getActiveCashier)
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce({ id: pinGated.id, displayName: pinGated.displayName });
    vi.mocked(listSelectableCashiers).mockResolvedValue([pinGated]);
    vi.mocked(selectActiveCashier).mockResolvedValue({
      id: pinGated.id,
      displayName: pinGated.displayName,
    });
    const user = userEvent.setup();
    render(<CashierControl />);

    await screen.findByText(previous.displayName);
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    await user.click(
      await screen.findByRole('button', { name: /Alex Rivera/ }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Cashier PIN' });
    expect(within(dialog).getByText('The signed-in POS user will not change.'))
      .toBeInTheDocument();

    for (const digit of ['1', '2', '3', '4']) {
      await user.click(within(dialog).getByRole('button', { name: digit }));
    }
    expect(
      within(dialog).getByRole('img', {
        name: '4 of 4 PIN digits entered',
      }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm PIN' }));

    expect(selectActiveCashier).toHaveBeenCalledWith(
      'register-1',
      pinGated.id,
      '1234',
    );
    expect(await screen.findByText(pinGated.displayName)).toBeInTheDocument();
  });

  it('keeps the prior cashier for incomplete, wrong, and cancelled PIN attempts', async () => {
    const genericFailure = 'Unable to authorize cashier.';
    vi.mocked(getActiveCashier).mockResolvedValue(previous);
    vi.mocked(listSelectableCashiers).mockResolvedValue([pinGated]);
    vi.mocked(selectActiveCashier).mockRejectedValue(
      new CashierApiError(401, genericFailure),
    );
    const user = userEvent.setup();
    render(<CashierControl />);

    await screen.findByText(previous.displayName);
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    await user.click(
      await screen.findByRole('button', { name: /Alex Rivera/ }),
    );
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Confirm PIN' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(genericFailure);
    expect(selectActiveCashier).toHaveBeenLastCalledWith(
      'register-1',
      pinGated.id,
      '12',
    );
    expect(screen.getAllByText(previous.displayName)).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: /Alex Rivera/ }));
    for (const digit of ['9', '9', '9', '9']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }
    await user.click(screen.getByRole('button', { name: 'Confirm PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(genericFailure);
    expect(selectActiveCashier).toHaveBeenLastCalledWith(
      'register-1',
      pinGated.id,
      '9999',
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: /Alex Rivera/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Select cashier' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(selectActiveCashier).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(previous.displayName)).not.toHaveLength(0);
  });

  it('clears without a PIN and shows the supported no-cashier state', async () => {
    vi.mocked(getActiveCashier)
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(null);
    vi.mocked(clearActiveCashier).mockResolvedValue(null);
    const user = userEvent.setup();
    render(<CashierControl />);

    await screen.findByText(previous.displayName);
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(clearActiveCashier).toHaveBeenCalledWith('register-1');
    expect(await screen.findByText('No cashier selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps loading, empty, and error picker states dismissible', async () => {
    vi.mocked(getActiveCashier).mockResolvedValue(null);
    let rejectLoad: ((reason?: unknown) => void) | undefined;
    vi.mocked(listSelectableCashiers).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    const user = userEvent.setup();
    render(<CashierControl />);

    await screen.findByText('No cashier selected');
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    expect(screen.getByLabelText('Loading selectable cashiers'))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rejectLoad?.(new Error('offline'));
    vi.mocked(listSelectableCashiers).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    expect(await screen.findByText('Cashiers could not be loaded'))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    vi.mocked(listSelectableCashiers).mockResolvedValueOnce([]);
    await user.click(screen.getByRole('button', { name: /Active cashier/ }));
    expect(await screen.findByText('No selectable staff members'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear selection' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
