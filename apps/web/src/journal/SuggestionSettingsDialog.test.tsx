import {
  cents,
  JournalSuggestionKind,
  type JournalLedgerBalance,
} from '@coffee-shop/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuggestionSettingsDialog } from './SuggestionSettingsDialog';
import { JournalApiError } from './api';

const api = vi.hoisted(() => ({ getRate: vi.fn(), updateRate: vi.fn() }));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    getJournalSuggestionRate: api.getRate,
    updateJournalSuggestionRate: api.updateRate,
  };
});

const chair: JournalLedgerBalance = {
  id: 'ledger-chair',
  name: 'Chair',
  startDate: '2026-09-01',
  startingBalanceCents: cents(0),
  balanceCents: cents(0),
  suggestionKind: JournalSuggestionKind.CHAIR_FLAT_ABOVE_THRESHOLD,
  isBuiltIn: true,
  locationId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

function renderDialog(ledger = chair) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <SuggestionSettingsDialog
      ledger={ledger}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved };
}

describe('SuggestionSettingsDialog', () => {
  beforeEach(() => {
    api.getRate.mockReset();
    api.updateRate.mockReset();
  });

  it('offers no effective date and states that the change is not backdated', async () => {
    api.getRate.mockResolvedValue({
      id: 'rate-1',
      ledgerId: chair.id,
      effectiveFrom: '2026-09-01',
      rentPercentBasisPoints: null,
      chairAmountCents: cents(10_000),
      chairThresholdCents: cents(300_000),
      locationId: null,
      createdByUserId: 'admin-1',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Suggestion settings' });
    expect(await within(dialog).findByLabelText(/Chair amount/)).toHaveValue(
      '100.00',
    );
    expect(within(dialog).getByLabelText(/Chair gross threshold/)).toHaveValue(
      '3000.00',
    );
    // ADR 0018 §4: the server stamps today and backdating is not available.
    expect(dialog.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(
      within(dialog).getByText(/Settings cannot be backdated/),
    ).toBeInTheDocument();
    // The Rent rounding rule is not configurable, so it is not a control here.
    expect(within(dialog).queryByLabelText(/rounding/i)).toBeNull();
  });

  it('sends the Chair amount and threshold in integer cents', async () => {
    api.getRate.mockResolvedValue(null);
    api.updateRate.mockResolvedValue({});
    const { onSaved } = renderDialog();

    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Chair amount/);
    await user.type(amount, '125.50');
    await user.type(screen.getByLabelText(/Chair gross threshold/), '2500');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(api.updateRate).toHaveBeenCalledWith('ledger-chair', {
        chairAmountCents: cents(12_550),
        chairThresholdCents: cents(250_000),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith('Chair');
  });

  it('keeps the dialog open and reports a refused save', async () => {
    api.getRate.mockResolvedValue(null);
    api.updateRate.mockRejectedValue(
      new JournalApiError(
        400,
        ['Staff meals is a fully manual ledger and has no suggestion rate'],
        'ledgerId',
        'LEDGER_HAS_NO_SUGGESTION_RATE',
      ),
    );
    const { onSaved } = renderDialog();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Chair amount/), '100');
    await user.type(screen.getByLabelText(/Chair gross threshold/), '3000');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(
      await screen.findByText(
        'Staff meals is a fully manual ledger and has no suggestion rate',
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Suggestion settings' }),
    ).toBeInTheDocument();
  });
});
