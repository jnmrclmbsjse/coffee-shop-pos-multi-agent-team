import { cents } from '@coffee-shop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JournalApiError,
  createJournalDeposit,
  createJournalLedger,
  deleteJournalWithdrawal,
  getJournalLedger,
  listJournalLedgers,
  updateJournalDeposit,
} from './api';

describe('Journal API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the typed Journal endpoint paths and payloads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listJournalLedgers();
    await getJournalLedger('ledger / one');
    await createJournalLedger({
      name: 'Repairs',
      startDate: '2026-10-01',
      startingBalanceCents: cents(500),
    });
    await createJournalDeposit('ledger / one', {
      businessDate: '2026-10-01',
      amountCents: cents(0),
    });
    await updateJournalDeposit('deposit / one', {
      businessDate: '2026-10-02',
      amountCents: cents(100),
      note: null,
    });
    await deleteJournalWithdrawal('withdrawal / one');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:3000/journal/ledgers',
      'http://localhost:3000/journal/ledgers/ledger%20%2F%20one',
      'http://localhost:3000/journal/ledgers',
      'http://localhost:3000/journal/ledgers/ledger%20%2F%20one/deposits',
      'http://localhost:3000/journal/deposits/deposit%20%2F%20one',
      'http://localhost:3000/journal/withdrawals/withdrawal%20%2F%20one',
    ]);
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ businessDate: '2026-10-01', amountCents: 0 }),
    });
  });

  it('preserves conflict metadata from API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'A deposit is already recorded for 2026-10-01',
            field: 'businessDate',
            reason: 'DUPLICATE_JOURNAL_DEPOSIT',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      createJournalDeposit('ledger-1', {
        businessDate: '2026-10-01',
        amountCents: cents(0),
      }),
    ).rejects.toEqual(
      new JournalApiError(
        409,
        ['A deposit is already recorded for 2026-10-01'],
        'businessDate',
        'DUPLICATE_JOURNAL_DEPOSIT',
      ),
    );
  });
});
