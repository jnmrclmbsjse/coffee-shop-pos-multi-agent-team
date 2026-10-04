import {
  cents,
  JournalSuggestionKind,
  type JournalDeposit,
  type JournalLedgerBalance,
} from '@coffee-shop/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JournalPage } from './JournalPage';
import { JournalApiError, type JournalLedgerDetail } from './api';

const api = vi.hoisted(() => ({
  createDeposit: vi.fn(),
  createLedger: vi.fn(),
  createWithdrawal: vi.fn(),
  deleteDeposit: vi.fn(),
  deleteWithdrawal: vi.fn(),
  getLedger: vi.fn(),
  listLedgers: vi.fn(),
  updateDeposit: vi.fn(),
  updateWithdrawal: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    createJournalDeposit: api.createDeposit,
    createJournalLedger: api.createLedger,
    createJournalWithdrawal: api.createWithdrawal,
    deleteJournalDeposit: api.deleteDeposit,
    deleteJournalWithdrawal: api.deleteWithdrawal,
    getJournalLedger: api.getLedger,
    listJournalLedgers: api.listLedgers,
    updateJournalDeposit: api.updateDeposit,
    updateJournalWithdrawal: api.updateWithdrawal,
  };
});

const rent: JournalLedgerBalance = {
  id: 'ledger-rent',
  name: 'Rent',
  startDate: '2026-09-01',
  startingBalanceCents: cents(10_000),
  balanceCents: cents(-5_000),
  suggestionKind: JournalSuggestionKind.RENT_PERCENT_OF_ROUNDED_GROSS,
  isBuiltIn: true,
  locationId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const zeroDeposit: JournalDeposit = {
  id: 'deposit-zero',
  ledgerId: rent.id,
  businessDate: '2026-10-01',
  amountCents: cents(0),
  note: null,
  locationId: null,
  recordedByUserId: 'admin-1',
  recordedAt: '2026-10-01T10:00:00.000Z',
  updatedByUserId: 'admin-1',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const detail: JournalLedgerDetail = {
  ...rent,
  deposits: [zeroDeposit],
  withdrawals: [
    {
      id: 'withdrawal-1',
      ledgerId: rent.id,
      withdrawnOn: '2026-09-30',
      amountCents: cents(15_000),
      note: 'September rent transfer',
      locationId: null,
      recordedByUserId: 'admin-1',
      recordedAt: '2026-09-30T10:00:00.000Z',
      updatedByUserId: 'admin-1',
      updatedAt: '2026-09-30T10:00:00.000Z',
    },
  ],
};

function renderPage() {
  api.listLedgers.mockResolvedValue([rent]);
  api.getLedger.mockResolvedValue(detail);
  return render(<JournalPage />);
}

describe('JournalPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it('shows the server balance as negative and keeps a saved zero deposit visible', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.getAllByText('₱-50.00')).toHaveLength(2);
    expect(screen.getByText('Negative balance')).toBeInTheDocument();
    expect(screen.getByText('₱0.00')).toBeInTheDocument();
    expect(screen.getByText('Saved ₱0.00 deposit')).toBeInTheDocument();
    expect(screen.getByText('No note')).toBeInTheDocument();
  });

  it('records a zero deposit without treating the amount field as empty', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rent' });
    api.createDeposit.mockResolvedValue({ ...zeroDeposit, id: 'deposit-new' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));
    const dialog = screen.getByRole('dialog', { name: 'Record deposit' });
    fireEvent.change(within(dialog).getByLabelText(/Business day/), {
      target: { value: '2026-10-02' },
    });
    await user.type(within(dialog).getByLabelText(/Amount/), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save deposit' }));

    await waitFor(() => {
      expect(api.createDeposit).toHaveBeenCalledWith('ledger-rent', {
        businessDate: '2026-10-02',
        amountCents: cents(0),
        note: null,
      });
    });
    expect(await screen.findByText('Deposit ₱0.00 was recorded.')).toBeInTheDocument();
    expect(api.listLedgers).toHaveBeenCalledTimes(2);
    expect(api.getLedger).toHaveBeenCalledTimes(2);
  });

  it('surfaces a duplicate-day conflict without closing the editor', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rent' });
    api.createDeposit.mockRejectedValue(
      new JournalApiError(
        409,
        ['A deposit is already recorded for 2026-10-01'],
        'businessDate',
        'DUPLICATE_JOURNAL_DEPOSIT',
      ),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));
    const dialog = screen.getByRole('dialog', { name: 'Record deposit' });
    fireEvent.change(within(dialog).getByLabelText(/Business day/), {
      target: { value: '2026-10-01' },
    });
    await user.type(within(dialog).getByLabelText(/Amount/), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save deposit' }));

    expect(
      await within(dialog).findByText(
        'Rent already has a deposit for October 1, 2026. The existing deposit was not changed.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Record deposit' })).toBeInTheDocument();
  });

  it('retries a selected ledger after its detail request fails', async () => {
    api.listLedgers.mockResolvedValue([rent]);
    api.getLedger
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(detail);
    render(<JournalPage />);

    expect(await screen.findByText('Ledger could not be loaded')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Rent' })).toBeInTheDocument();
    expect(api.getLedger).toHaveBeenCalledTimes(2);
  });

  it('explains that deleting a deposit makes its day un-recorded and refetches', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rent' });
    api.deleteDeposit.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Delete deposit from October 1, 2026' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete deposit?' });
    expect(
      within(dialog).getByText(
        'Deleting this deposit makes October 1, 2026 un-recorded again.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete deposit' }));

    await waitFor(() => expect(api.deleteDeposit).toHaveBeenCalledWith('deposit-zero'));
    expect(await screen.findByText('Deposit was deleted.')).toBeInTheDocument();
    expect(api.listLedgers).toHaveBeenCalledTimes(2);
    expect(api.getLedger).toHaveBeenCalledTimes(2);
  });
});
