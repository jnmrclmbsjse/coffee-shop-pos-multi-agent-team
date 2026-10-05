import { cents, type JournalMissingDay } from '@coffee-shop/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkAddPanel } from './BulkAddPanel';

const api = vi.hoisted(() => ({ saveBulk: vi.fn() }));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, createJournalDepositsBulk: api.saveBulk };
});

const october1: JournalMissingDay = {
  businessDate: '2026-10-01',
  grossSalesCents: cents(760_000),
  suggestedAmountCents: cents(70_000),
};

const october2: JournalMissingDay = {
  businessDate: '2026-10-02',
  grossSalesCents: cents(780_000),
  suggestedAmountCents: cents(80_000),
};

const october3: JournalMissingDay = {
  businessDate: '2026-10-03',
  grossSalesCents: cents(500_000),
  suggestedAmountCents: null,
};

function renderPanel(days: JournalMissingDay[] | null) {
  const onRefresh = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <BulkAddPanel
      ledgerId="ledger-rent"
      ledgerName="Rent"
      startDate="2026-09-01"
      days={days}
      loading={false}
      loadError=""
      onRefresh={onRefresh}
      onSaved={onSaved}
    />,
  );
  return { ...view, onRefresh, onSaved };
}

describe('BulkAddPanel', () => {
  beforeEach(() => {
    api.saveBulk.mockReset();
  });

  it('leaves a day with no suggestion unticked and its field empty', () => {
    renderPanel([october1, october3]);

    expect(
      screen.getByRole('checkbox', { name: 'Include October 1, 2026' }),
    ).toBeChecked();
    // `null` is "no suggestion at all", so nothing is prefilled and nothing is
    // ticked on the administrator's behalf.
    expect(
      screen.getByRole('checkbox', { name: 'Include October 3, 2026' }),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Deposit amount for October 3, 2026'),
    ).toHaveValue('');
    expect(screen.getByText('No suggestion available')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });

  it('keeps typed amounts on the right day when the list is refetched', async () => {
    const { rerender, onRefresh, onSaved } = renderPanel([october1, october2]);

    const user = userEvent.setup();
    const october2Amount = screen.getByLabelText(
      'Deposit amount for October 2, 2026',
    );
    await user.clear(october2Amount);
    await user.type(october2Amount, '900');
    expect(
      screen.getByText('Your amount replaces the ₱800.00 suggestion'),
    ).toBeInTheDocument();

    // October 1 was recorded elsewhere, so the refetched list is shorter. Row
    // state is keyed by business date, so October 2 keeps the typed figure
    // instead of inheriting the dropped row's.
    rerender(
      <BulkAddPanel
        ledgerId="ledger-rent"
        ledgerName="Rent"
        startDate="2026-09-01"
        days={[october2]}
        loading={false}
        loadError=""
        onRefresh={onRefresh}
        onSaved={onSaved}
      />,
    );

    expect(
      screen.getByLabelText('Deposit amount for October 2, 2026'),
    ).toHaveValue('900');
    expect(screen.getByText('1 of 1 selected')).toBeInTheDocument();
  });

  it('restores the server suggestion when asked', async () => {
    renderPanel([october2]);

    const user = userEvent.setup();
    const amount = screen.getByLabelText('Deposit amount for October 2, 2026');
    await user.clear(amount);
    await user.type(amount, '1');
    await user.click(screen.getByRole('button', { name: 'Use suggestion' }));

    expect(
      screen.getByLabelText('Deposit amount for October 2, 2026'),
    ).toHaveValue('800.00');
    expect(
      screen.getByText('₱800.00 suggested, not saved'),
    ).toBeInTheDocument();
  });

  it('refuses to save a ticked row with no amount, and sends nothing', async () => {
    renderPanel([october3]);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('checkbox', { name: 'Include October 3, 2026' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Save selected deposits' }),
    );

    expect(
      await screen.findByText('Enter a deposit amount.'),
    ).toBeInTheDocument();
    expect(api.saveBulk).not.toHaveBeenCalled();
  });

  it('reports the saved count once the batch is written', async () => {
    api.saveBulk.mockResolvedValue([]);
    const { onSaved } = renderPanel([october1, october2]);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Save selected deposits' }),
    );

    await waitFor(() =>
      expect(api.saveBulk).toHaveBeenCalledWith('ledger-rent', {
        deposits: [
          { businessDate: '2026-10-01', amountCents: cents(70_000) },
          { businessDate: '2026-10-02', amountCents: cents(80_000) },
        ],
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(2);
  });

  it('selects and clears every row from the header checkbox', async () => {
    renderPanel([october1, october2, october3]);

    const user = userEvent.setup();
    const selectAll = screen.getByRole('checkbox', { name: 'Select all' });
    expect(selectAll).not.toBeChecked();
    expect(selectAll).toHaveProperty('indeterminate', true);

    await user.click(selectAll);
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();

    await user.click(selectAll);
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save selected deposits' }),
    ).toBeDisabled();
  });
});
