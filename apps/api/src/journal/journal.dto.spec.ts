import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateJournalDepositDto,
  CreateJournalLedgerDto,
  CreateJournalWithdrawalDto,
  UpdateJournalDepositDto,
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
