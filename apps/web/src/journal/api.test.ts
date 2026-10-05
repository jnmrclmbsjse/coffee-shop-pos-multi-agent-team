import { cents } from '@coffee-shop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JournalApiError,
  createJournalDeposit,
  createJournalDepositsBulk,
  createJournalLedger,
  deleteJournalWithdrawal,
  getJournalLedger,
  getJournalSuggestionRate,
  listJournalLedgers,
  listJournalMissingDays,
  updateJournalDeposit,
  updateJournalSuggestionRate,
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

  it('sends the suggestion, bulk and rate requests on their own paths', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listJournalMissingDays('ledger / one');
    await createJournalDepositsBulk('ledger / one', {
      deposits: [
        { businessDate: '2026-10-01', amountCents: cents(0) },
        { businessDate: '2026-10-02', amountCents: cents(80_000) },
      ],
    });
    await updateJournalSuggestionRate('ledger / one', {
      rentPercentBasisPoints: 1250,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:3000/journal/ledgers/ledger%20%2F%20one/missing-days',
      'http://localhost:3000/journal/ledgers/ledger%20%2F%20one/deposits/bulk',
      'http://localhost:3000/journal/ledgers/ledger%20%2F%20one/rate',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      // A ticked ₱0 row is sent; unticked days never reach the client at all.
      body: JSON.stringify({
        deposits: [
          { businessDate: '2026-10-01', amountCents: 0 },
          { businessDate: '2026-10-02', amountCents: 80000 },
        ],
      }),
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'PUT' });
  });

  it('reads an empty rate response as no rate rather than failing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 })),
    );

    await expect(getJournalSuggestionRate('ledger-1')).resolves.toBeNull();
  });
});
