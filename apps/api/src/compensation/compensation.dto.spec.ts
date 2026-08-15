import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CompensationEntryListQueryDto,
  CreateCompensationEntryDto,
  UpdateCompensationEntryDto,
} from './compensation.dto';

describe('Compensation DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validCreate = {
    staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
    workDate: '2026-08-15',
    salaryCents: 10_000,
    commissionCents: 500,
  };

  async function transformCreate(input: Record<string, unknown>) {
    return pipe.transform(input, {
      type: 'body',
      metatype: CreateCompensationEntryDto,
    });
  }

  it('accepts integer cents, including an all-zero entry', async () => {
    await expect(
      transformCreate({
        ...validCreate,
        salaryCents: 0,
        commissionCents: 0,
      }),
    ).resolves.toMatchObject({ salaryCents: 0, commissionCents: 0 });
  });

  it.each([
    ['missing salary', { salaryCents: undefined }],
    ['missing commission', { commissionCents: undefined }],
    ['negative salary', { salaryCents: -1 }],
    ['negative commission', { commissionCents: -1 }],
    ['fractional salary', { salaryCents: 1.5 }],
    ['fractional commission', { commissionCents: 1.5 }],
    ['non-numeric salary', { salaryCents: '100' }],
    ['non-numeric commission', { commissionCents: '100' }],
  ])('returns 400 for %s', async (_case, override) => {
    await expect(
      transformCreate({ ...validCreate, ...override }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed calendar dates with a field-level message', async () => {
    await expect(
      transformCreate({ ...validCreate, workDate: '2026-02-30' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.arrayContaining([
          'workDate must be a valid date',
        ]),
      }),
    });
  });

  it('does not accept a client-supplied daily total', async () => {
    await expect(
      transformCreate({ ...validCreate, dailyTotalCents: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires both update amounts and exposes no key fields', async () => {
    const errors = await validate(
      plainToInstance(UpdateCompensationEntryDto, {
        salaryCents: 100,
      }),
    );

    expect(errors.map((error) => error.property)).toContain(
      'commissionCents',
    );
    expect(
      Object.getOwnPropertyNames(UpdateCompensationEntryDto.prototype),
    ).not.toEqual(expect.arrayContaining(['staffMemberId', 'workDate']));
  });

  it('accepts optional list filters and rejects malformed ones', async () => {
    const valid = plainToInstance(CompensationEntryListQueryDto, {
      staffMemberId: validCreate.staffMemberId,
      from: '2026-08-01',
      to: '2026-08-15',
    });
    const invalid = plainToInstance(CompensationEntryListQueryDto, {
      staffMemberId: 'not-a-uuid',
      from: '08/01/2026',
      to: '2026-02-30',
    });

    await expect(validate(valid)).resolves.toEqual([]);
    await expect(validate(invalid)).resolves.toHaveLength(3);
  });
});
