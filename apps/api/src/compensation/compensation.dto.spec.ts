import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CompensationAdjustmentListQueryDto,
  CompensationEntryListQueryDto,
  CreateCompensationAdjustmentDto,
  CreateCompensationEntryDto,
  PayslipQueryDto,
  UpdateCompensationAdjustmentDto,
  UpdateCompensationEntryDto,
} from './compensation.dto';
import { CompensationAdjustmentKind } from '@coffee-shop/shared';

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

  const validAdjustment = {
    staffMemberId: validCreate.staffMemberId,
    kind: CompensationAdjustmentKind.ALLOWANCE,
    effectiveDate: '2026-08-15',
    amountCents: 100,
    description: 'Transportation allowance',
  };

  async function transformAdjustment(input: Record<string, unknown>) {
    return pipe.transform(input, {
      type: 'body',
      metatype: CreateCompensationAdjustmentDto,
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

  it('requires a valid staff member and two valid payslip dates', async () => {
    const valid = plainToInstance(PayslipQueryDto, {
      staffMemberId: validCreate.staffMemberId,
      from: '2026-08-01',
      to: '2026-08-15',
    });
    const invalid = plainToInstance(PayslipQueryDto, {
      staffMemberId: 'not-a-uuid',
      from: '08/01/2026',
      to: '2026-02-30',
    });

    await expect(validate(valid)).resolves.toEqual([]);
    await expect(validate(invalid)).resolves.toHaveLength(3);
  });

  it('returns field-level messages for missing payslip query fields', async () => {
    const errors = await validate(plainToInstance(PayslipQueryDto, {}));

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['staffMemberId', 'from', 'to']),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: expect.objectContaining({
            isNotEmpty: 'staffMemberId is required',
          }),
        }),
      ]),
    );
  });

  it('accepts every adjustment kind and trims only surrounding description whitespace', async () => {
    for (const kind of Object.values(CompensationAdjustmentKind)) {
      await expect(
        transformAdjustment({
          ...validAdjustment,
          kind,
          description: '  MiXeD  café bonus  ',
        }),
      ).resolves.toMatchObject({
        kind,
        description: 'MiXeD  café bonus',
      });
    }
  });

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['non-numeric', '100'],
  ])('returns 400 for a %s adjustment amount', async (_case, amountCents) => {
    await expect(
      transformAdjustment({ ...validAdjustment, amountCents }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['over 120 characters', 'x'.repeat(121)],
  ])('returns 400 for an %s adjustment description', async (_case, description) => {
    await expect(
      transformAdjustment({ ...validAdjustment, description }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.arrayContaining([
          expect.stringContaining('description'),
        ]),
      }),
    });
  });

  it('rejects unknown kinds and malformed adjustment dates', async () => {
    await expect(
      transformAdjustment({
        ...validAdjustment,
        kind: 'REPAYMENT',
        effectiveDate: '2026-02-30',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.arrayContaining([
          expect.stringContaining('kind'),
          'effectiveDate must be a valid date',
        ]),
      }),
    });
  });

  it('requires every editable adjustment field and does not expose kind or staffMemberId', async () => {
    const errors = await validate(
      plainToInstance(UpdateCompensationAdjustmentDto, {
        effectiveDate: '2026-08-16',
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['amountCents', 'description']),
    );
    expect(
      Object.getOwnPropertyNames(UpdateCompensationAdjustmentDto.prototype),
    ).not.toEqual(expect.arrayContaining(['kind', 'staffMemberId']));
  });

  it('accepts optional adjustment filters and rejects malformed ones', async () => {
    const valid = plainToInstance(CompensationAdjustmentListQueryDto, {
      staffMemberId: validCreate.staffMemberId,
      from: '2026-08-01',
      to: '2026-08-15',
    });
    const invalid = plainToInstance(CompensationAdjustmentListQueryDto, {
      staffMemberId: 'not-a-uuid',
      from: '08/01/2026',
      to: '2026-02-30',
    });

    await expect(validate(valid)).resolves.toEqual([]);
    await expect(validate(invalid)).resolves.toHaveLength(3);
  });
});
