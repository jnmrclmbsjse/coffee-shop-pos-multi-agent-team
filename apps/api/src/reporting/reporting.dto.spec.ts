import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  DailyInventoryQueryDto,
  OrderHistoryListQueryDto,
  ReportingRangeQueryDto,
  StaffOrderLedgerQueryDto,
} from './reporting.dto';

describe('ReportingRangeQueryDto', () => {
  async function messages(input: Partial<ReportingRangeQueryDto>) {
    const dto = Object.assign(new ReportingRangeQueryDto(), input);
    const errors = await validate(dto);
    return errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
  }

  it('accepts required ISO calendar dates', async () => {
    await expect(
      messages({ from: '2026-07-01', to: '2026-07-31' }),
    ).resolves.toEqual([]);
  });

  it('returns usable messages for missing and malformed values', async () => {
    await expect(messages({ to: '2026-07-31' })).resolves.toContain(
      'from is required',
    );
    await expect(
      messages({ from: 'not-a-date', to: '2026-07-31' }),
    ).resolves.toContain('from must be a valid date');
  });
});

describe('DailyInventoryQueryDto', () => {
  it('accepts one real date in the exact date-only format', async () => {
    const dto = Object.assign(new DailyInventoryQueryDto(), {
      date: '2026-08-15',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each(['', '2026-8-15', '2026-02-30'])(
    'rejects invalid date %j',
    async (date) => {
      const dto = Object.assign(new DailyInventoryQueryDto(), { date });
      await expect(validate(dto)).resolves.not.toEqual([]);
    },
  );
});

describe('StaffOrderLedgerQueryDto', () => {
  async function validateQuery(input: Record<string, unknown>) {
    const dto = plainToInstance(StaffOrderLedgerQueryDto, input);
    return { dto, errors: await validate(dto) };
  }

  it('trims search and accepts every supported filter', async () => {
    const { dto, errors } = await validateQuery({
      status: 'Parked',
      paymentMethod: 'Cash',
      search: '  Walk-in  ',
    });

    expect(errors).toEqual([]);
    expect(dto).toEqual({
      status: 'Parked',
      paymentMethod: 'Cash',
      search: 'Walk-in',
    });
  });

  it('rejects malformed status and payment filters', async () => {
    const { errors } = await validateQuery({
      status: 'ALL',
      paymentMethod: 'Card',
    });

    expect(errors.map((error) => error.property)).toEqual([
      'status',
      'paymentMethod',
    ]);
  });
});

describe('OrderHistoryListQueryDto', () => {
  async function validateQuery(input: Record<string, unknown>) {
    const dto = plainToInstance(OrderHistoryListQueryDto, input);
    return {
      dto,
      errors: await validate(dto),
    };
  }

  it('applies the first-page defaults and trims customer search', async () => {
    const { dto, errors } = await validateQuery({
      search: '  Mina  ',
    });

    expect(errors).toEqual([]);
    expect(dto).toEqual(
      expect.objectContaining({
        search: 'Mina',
        sort: 'businessDay',
        direction: 'desc',
        page: 1,
        pageSize: 10,
      }),
    );
  });

  it('accepts supported filters, sorts, directions, and page sizes', async () => {
    const { dto, errors } = await validateQuery({
      status: 'Void',
      paymentMethod: 'Split',
      sort: 'completedAt',
      direction: 'asc',
      page: '2',
      pageSize: '50',
    });

    expect(errors).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
  });

  it('rejects unsupported filters and page boundaries', async () => {
    const { errors } = await validateQuery({
      status: 'VOID',
      paymentMethod: 'Card',
      page: '0',
      pageSize: '100',
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'status',
        'paymentMethod',
        'page',
        'pageSize',
      ]),
    );
  });
});
