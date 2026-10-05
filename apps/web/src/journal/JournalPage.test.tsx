import {
  cents,
  JournalSuggestionKind,
  type JournalDeposit,
  type JournalLedgerBalance,
  type JournalMissingDay,
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
  getRate: vi.fn(),
  listLedgers: vi.fn(),
  listMissingDays: vi.fn(),
  saveBulk: vi.fn(),
  updateDeposit: vi.fn(),
  updateLedger: vi.fn(),
  updateRate: vi.fn(),
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
    createJournalDepositsBulk: api.saveBulk,
    getJournalLedger: api.getLedger,
    getJournalSuggestionRate: api.getRate,
    listJournalLedgers: api.listLedgers,
    listJournalMissingDays: api.listMissingDays,
    updateJournalDeposit: api.updateDeposit,
    updateJournalLedger: api.updateLedger,
    updateJournalSuggestionRate: api.updateRate,
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

const manual: JournalLedgerBalance = {
  id: 'ledger-manual',
  name: 'Staff meals',
  startDate: '2026-09-01',
  startingBalanceCents: cents(0),
  balanceCents: cents(0),
  suggestionKind: JournalSuggestionKind.NONE,
  isBuiltIn: false,
  locationId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

/** A real ₱0 suggestion — Chair below its gross threshold. */
const zeroSuggestionDay: JournalMissingDay = {
  businessDate: '2026-10-02',
  grossSalesCents: cents(79_900),
  suggestedAmountCents: cents(0),
};

const positiveSuggestionDay: JournalMissingDay = {
  businessDate: '2026-10-03',
  grossSalesCents: cents(780_000),
  suggestedAmountCents: cents(80_000),
};

/** No suggestion at all — a fully manual ledger. */
const noSuggestionDay: JournalMissingDay = {
  businessDate: '2026-10-04',
  grossSalesCents: cents(500_000),
  suggestedAmountCents: null,
};

function renderPage(
  options: {
    ledgers?: JournalLedgerBalance[];
    ledgerDetail?: JournalLedgerDetail;
    missingDays?: JournalMissingDay[];
  } = {},
) {
  api.listLedgers.mockResolvedValue(options.ledgers ?? [rent]);
  api.getLedger.mockResolvedValue(options.ledgerDetail ?? detail);
  api.listMissingDays.mockResolvedValue(options.missingDays ?? []);
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

  it('moves the start date forward so earlier closed days stop being outstanding', async () => {
    renderPage({ missingDays: [positiveSuggestionDay] });
    await screen.findByRole('heading', { name: 'Rent' });
    api.updateLedger.mockResolvedValue({
      ...rent,
      startDate: '2026-10-06',
      startingBalanceCents: cents(250_000),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change start date' }));
    const dialog = screen.getByRole('dialog', { name: 'Change Rent start date' });
    expect(within(dialog).queryByLabelText(/Ledger name/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Starting balance/)).toHaveValue('100.00');
    fireEvent.change(within(dialog).getByLabelText(/Start date/), {
      target: { value: '2026-10-06' },
    });
    await user.clear(within(dialog).getByLabelText(/Starting balance/));
    await user.type(within(dialog).getByLabelText(/Starting balance/), '2500');
    api.listMissingDays.mockResolvedValue([]);
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.updateLedger).toHaveBeenCalledWith('ledger-rent', {
        startDate: '2026-10-06',
        startingBalanceCents: cents(250_000),
      }),
    );
    expect(
      await screen.findByText(
        'Rent now starts October 6, 2026. Closed days before it are no longer outstanding.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listMissingDays).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the start-date dialog open when a deposit is recorded after the new date', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rent' });
    api.updateLedger.mockRejectedValue(
      new JournalApiError(
        400,
        ['startDate must be on or before the earliest recorded deposit (2026-10-01)'],
        'startDate',
        'START_DATE_AFTER_RECORDED_DEPOSIT',
        '2026-10-01',
      ),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change start date' }));
    const dialog = screen.getByRole('dialog', { name: 'Change Rent start date' });
    fireEvent.change(within(dialog).getByLabelText(/Start date/), {
      target: { value: '2026-10-06' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(
      await within(dialog).findByText(
        'A deposit is already recorded for October 1, 2026. Choose that date or earlier, or delete that deposit first.',
      ),
    ).toBeInTheDocument();
  });

  it('retries a selected ledger after its detail request fails', async () => {
    api.listLedgers.mockResolvedValue([rent]);
    api.getLedger
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(detail);
    api.listMissingDays.mockResolvedValue([]);
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

  it('renders a null suggestion differently from a real zero suggestion', async () => {
    renderPage({
      ledgers: [manual],
      ledgerDetail: { ...manual, deposits: [], withdrawals: [] },
      missingDays: [noSuggestionDay],
    });
    await screen.findByRole('heading', { name: 'Staff meals' });

    const manualRow = screen
      .getByRole('cell', { name: 'October 4, 2026' })
      .closest('tr')!;
    expect(
      within(manualRow).getByText('No suggestion available'),
    ).toBeInTheDocument();
    // The silent defect this guards: a `null` suggestion must never read as ₱0.00.
    expect(within(manualRow).queryByText(/₱0\.00 suggested/)).toBeNull();
    expect(within(manualRow).getByText('Not recorded')).toBeInTheDocument();

    api.getLedger.mockResolvedValue({ ...rent, deposits: [], withdrawals: [] });
    api.listLedgers.mockResolvedValue([rent]);
    api.listMissingDays.mockResolvedValue([zeroSuggestionDay]);
    render(<JournalPage />);

    const zeroRow = (await screen.findAllByRole('cell', { name: 'October 2, 2026' }))[0]!
      .closest('tr')!;
    expect(
      within(zeroRow).getByText('₱0.00 suggested, not saved'),
    ).toBeInTheDocument();
  });

  it('hides the suggestion settings affordance for a fully manual ledger', async () => {
    renderPage({
      ledgers: [manual],
      ledgerDetail: { ...manual, deposits: [], withdrawals: [] },
    });
    await screen.findByRole('heading', { name: 'Staff meals' });

    expect(
      screen.queryByRole('button', { name: 'Suggestion settings' }),
    ).toBeNull();
  });

  it('prefills and saves a real ₱0 suggestion from the deposit editor', async () => {
    renderPage({ missingDays: [zeroSuggestionDay] });
    await screen.findByRole('heading', { name: 'Rent' });
    api.createDeposit.mockResolvedValue({ ...zeroDeposit, id: 'deposit-new' });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Record deposit for October 2, 2026' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Record deposit' });
    expect(within(dialog).getByLabelText(/Business day/)).toHaveValue('2026-10-02');
    expect(within(dialog).getByLabelText('Amount *')).toHaveValue('0.00');
    expect(
      within(dialog).getByText('₱0.00 suggested, not saved'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: 'Use suggested amount' }),
    ).toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Save deposit' }));

    await waitFor(() =>
      expect(api.createDeposit).toHaveBeenCalledWith('ledger-rent', {
        businessDate: '2026-10-02',
        amountCents: cents(0),
        note: null,
      }),
    );
  });

  it('stops reading as the suggestion once the administrator overwrites it', async () => {
    renderPage({ missingDays: [positiveSuggestionDay] });
    await screen.findByRole('heading', { name: 'Rent' });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Record deposit for October 3, 2026' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Record deposit' });
    expect(
      within(dialog).getByText('₱800.00 suggested, not saved'),
    ).toBeInTheDocument();

    const amount = within(dialog).getByLabelText('Amount *');
    await user.clear(amount);
    await user.type(amount, '750');

    expect(within(dialog).queryByText('₱800.00 suggested, not saved')).toBeNull();
    expect(
      within(dialog).getByRole('radio', { name: 'Enter another amount' }),
    ).toBeChecked();

    // Going back to the suggestion restores it rather than leaving the override.
    await user.click(
      within(dialog).getByRole('radio', { name: 'Use suggested amount' }),
    );
    expect(within(dialog).getByLabelText('Amount *')).toHaveValue('800.00');
    expect(
      within(dialog).getByText('₱800.00 suggested, not saved'),
    ).toBeInTheDocument();
  });

  it('refetches missing days after a rate change and offers no effective date', async () => {
    renderPage({ missingDays: [positiveSuggestionDay] });
    await screen.findByRole('heading', { name: 'Rent' });
    api.getRate.mockResolvedValue({
      id: 'rate-1',
      ledgerId: rent.id,
      effectiveFrom: '2026-09-01',
      rentPercentBasisPoints: 1000,
      chairAmountCents: null,
      chairThresholdCents: null,
      locationId: null,
      createdByUserId: 'admin-1',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    api.updateRate.mockResolvedValue({});

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Suggestion settings' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Suggestion settings',
    });
    const percent = await within(dialog).findByLabelText(/Rent percentage/);
    expect(percent).toHaveValue('10');
    // Backdating is deliberately unavailable (ADR 0018 §4).
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
    expect(
      within(dialog).getByText(/Settings cannot be backdated/),
    ).toBeInTheDocument();
    // Chair fields belong to the Chair ledger only.
    expect(within(dialog).queryByLabelText(/Chair amount/)).toBeNull();

    await user.clear(percent);
    await user.type(percent, '12.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(api.updateRate).toHaveBeenCalledWith('ledger-rent', {
        rentPercentBasisPoints: 1250,
      }),
    );
    // Earlier days keep their old suggestion, so the list has to come back from
    // the server rather than being recomputed here.
    await waitFor(() => expect(api.listMissingDays).toHaveBeenCalledTimes(2));
  });

  it('sends only the ticked bulk rows, including a ₱0 one', async () => {
    renderPage({
      missingDays: [zeroSuggestionDay, positiveSuggestionDay],
    });
    await screen.findByRole('heading', { name: 'Rent' });
    api.saveBulk.mockResolvedValue([]);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bulk add' }));

    expect(await screen.findByText('2 of 2 selected')).toBeInTheDocument();
    await user.click(
      screen.getByRole('checkbox', { name: /Include October 3, 2026/ }),
    );
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Save selected deposits' }),
    );

    await waitFor(() =>
      expect(api.saveBulk).toHaveBeenCalledWith('ledger-rent', {
        // The unticked day is absent: the server has no concept of a skipped day.
        deposits: [{ businessDate: '2026-10-02', amountCents: cents(0) }],
      }),
    );
  });

  it('reports that a bulk conflict saved nothing and refetches the list', async () => {
    renderPage({ missingDays: [positiveSuggestionDay] });
    await screen.findByRole('heading', { name: 'Rent' });
    api.saveBulk.mockRejectedValue(
      new JournalApiError(
        409,
        [
          'A deposit is already recorded for one of the selected business days; no deposits were saved',
        ],
        'deposits',
        'DUPLICATE_JOURNAL_DEPOSIT',
      ),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bulk add' }));
    await user.click(
      await screen.findByRole('button', { name: 'Save selected deposits' }),
    );

    expect(await screen.findByText('Nothing was saved')).toBeInTheDocument();
    expect(
      screen.getByText(/nothing at all was saved/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listMissingDays).toHaveBeenCalledTimes(2));
    // No row-by-row retry: one failed transaction means one failed request.
    expect(api.saveBulk).toHaveBeenCalledTimes(1);
  });

  it('shows the empty bulk list when every eligible day is recorded', async () => {
    renderPage({ missingDays: [] });
    await screen.findByRole('heading', { name: 'Rent' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bulk add' }));

    expect(await screen.findByText('No deposits to add')).toBeInTheDocument();
    expect(
      screen.getByText('Every eligible closed business day has a recorded deposit.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save selected deposits' }),
    ).toBeNull();
  });
});
