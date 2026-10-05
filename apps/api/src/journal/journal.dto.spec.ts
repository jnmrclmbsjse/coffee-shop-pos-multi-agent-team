import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  BulkCreateJournalDepositsDto,
  CreateJournalDepositDto,
  CreateJournalLedgerDto,
  CreateJournalWithdrawalDto,
  UpdateJournalDepositDto,
  UpdateJournalLedgerDto,
  UpdateJournalSuggestionRateDto,
  UpdateJournalWithdrawalDto,
} from './journal.dto';

describe('Journal DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  async function transform(
    metatype: new () => object,
    input: Record<string, unknown>,
  ): Promise<object> {
    return pipe.transform(input, { type: 'body', metatype });
  }

  it('accepts a signed starting balance and trims the ledger name', async () => {
    await expect(
      transform(CreateJournalLedgerDto, {
        name: '  Equipment fund  ',
        startDate: '2026-10-01',
        startingBalanceCents: -500,
      }),
    ).resolves.toMatchObject({
      name: 'Equipment fund',
      startDate: '2026-10-01',
      startingBalanceCents: -500,
    });
  });

  it('does not accept suggestion or rate fields when creating a ledger', async () => {
    await expect(
      transform(CreateJournalLedgerDto, {
        name: 'Equipment fund',
        startDate: '2026-10-01',
        suggestionKind: 'CHAIR_FLAT_ABOVE_THRESHOLD',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['empty name', CreateJournalLedgerDto, { name: '  ', startDate: '2026-10-01' }],
    ['invalid start date', CreateJournalLedgerDto, { name: 'Fund', startDate: '2026-02-30' }],
    ['fractional balance', CreateJournalLedgerDto, { name: 'Fund', startDate: '2026-10-01', startingBalanceCents: 1.5 }],
    ['negative deposit', CreateJournalDepositDto, { businessDate: '2026-10-01', amountCents: -1 }],
    ['zero withdrawal', CreateJournalWithdrawalDto, { withdrawnOn: '2026-10-01', amountCents: 0 }],
    ['malformed deposit date', UpdateJournalDepositDto, { businessDate: '10/01/2026', amountCents: 1 }],
    ['invalid withdrawal date', UpdateJournalWithdrawalDto, { withdrawnOn: '2026-02-30', amountCents: 1 }],
  ] as const)('rejects %s', async (_case, metatype, input) => {
    await expect(transform(metatype, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires both start date and starting balance on a ledger update, and nothing else', async () => {
    await expect(
      transform(UpdateJournalLedgerDto, {
        startDate: '2026-10-06',
        startingBalanceCents: 0,
      }),
    ).resolves.toMatchObject({ startDate: '2026-10-06', startingBalanceCents: 0 });
    await expect(
      transform(UpdateJournalLedgerDto, { startDate: '2026-10-06' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform(UpdateJournalLedgerDto, {
        startDate: '2026-10-06',
        startingBalanceCents: 0,
        name: 'Renamed',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves an explicit zero deposit and accepts a nullable note', async () => {
    await expect(
      transform(CreateJournalDepositDto, {
        businessDate: '2026-10-01',
        amountCents: 0,
        note: null,
      }),
    ).resolves.toMatchObject({ amountCents: 0, note: null });
  });

  it('requires every field on edits', async () => {
    await expect(
      transform(UpdateJournalDepositDto, {
        businessDate: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform(UpdateJournalWithdrawalDto, {
        amountCents: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Journal rate and bulk DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  async function transform(
    metatype: new () => object,
    input: Record<string, unknown>,
  ): Promise<object> {
    return pipe.transform(input, { type: 'body', metatype });
  }

  it('does not accept an effectiveFrom on a rate change', async () => {
    await expect(
      transform(UpdateJournalSuggestionRateDto, {
        rentPercentBasisPoints: 1_500,
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts basis points in range and refuses a float or an over-100% rate', async () => {
    await expect(
      transform(UpdateJournalSuggestionRateDto, {
        rentPercentBasisPoints: 10_000,
      }),
    ).resolves.toEqual({ rentPercentBasisPoints: 10_000 });

    for (const rentPercentBasisPoints of [10_001, -1, 10.5]) {
      await expect(
        transform(UpdateJournalSuggestionRateDto, { rentPercentBasisPoints }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a negative Chair amount or threshold', async () => {
    await expect(
      transform(UpdateJournalSuggestionRateDto, {
        chairAmountCents: -1,
        chairThresholdCents: 300_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform(UpdateJournalSuggestionRateDto, {
        chairAmountCents: 10_000,
        chairThresholdCents: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a bulk batch of selected days and keeps a zero amount', async () => {
    await expect(
      transform(BulkCreateJournalDepositsDto, {
        deposits: [
          { businessDate: '2026-10-02', amountCents: 0, note: '  ' },
          { businessDate: '2026-10-03', amountCents: 70_000 },
        ],
      }),
    ).resolves.toEqual({
      deposits: [
        { businessDate: '2026-10-02', amountCents: 0, note: '' },
        { businessDate: '2026-10-03', amountCents: 70_000 },
      ],
    });
  });

  it('refuses an empty batch and a batch row with an invalid day or amount', async () => {
    await expect(
      transform(BulkCreateJournalDepositsDto, { deposits: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform(BulkCreateJournalDepositsDto, {
        deposits: [{ businessDate: '2026-10-02', amountCents: -1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform(BulkCreateJournalDepositsDto, {
        deposits: [{ businessDate: '02/10/2026', amountCents: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
