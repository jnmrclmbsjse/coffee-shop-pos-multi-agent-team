import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  OrderHistoryListQueryDto,
  ReportingRangeQueryDto,
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
