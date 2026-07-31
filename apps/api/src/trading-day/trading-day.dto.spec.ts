import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CashMovementKind,
} from '@coffee-shop/shared';
import {
  CloseBusinessDayDto,
  CreateCashMovementDto,
  OpenBusinessDayDto,
} from './trading-day.dto';

describe('trading day DTOs', () => {
  const validOpen = {
    businessDate: '2026-07-23',
    dayType: 'NORMAL',
    openingFloatCents: 50000,
    openedByStaffMemberId:
      '10000000-0000-4000-8000-000000000001',
  };
  const validClose = {
    clientGeneratedId:
      '20000000-0000-4000-8000-000000000001',
    actualCashCents: 51000,
    closedByStaffMemberId:
      '30000000-0000-4000-8000-000000000001',
  };
  const validMovement = {
    clientGeneratedId:
      '40000000-0000-4000-8000-000000000001',
    kind: CashMovementKind.EXPENSE,
    amountCents: 250,
    description: '  Cleaning supplies  ',
    category: '  Supplies  ',
    recordedByStaffMemberId:
      '50000000-0000-4000-8000-000000000001',
  };

  async function messages(
    dto: new () => object,
    value: Record<string, unknown>,
  ): Promise<string[]> {
    const errors = await validate(plainToInstance(dto, value));
    return errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
  }

  it('accepts valid open input', async () => {
    await expect(messages(OpenBusinessDayDto, validOpen)).resolves.toEqual(
      [],
    );
  });

  it.each([
    [{ ...validOpen, businessDate: undefined }, 'businessDate'],
    [{ ...validOpen, businessDate: '07/23/2026' }, 'businessDate'],
    [{ ...validOpen, businessDate: '2026-02-30' }, 'businessDate'],
    [{ ...validOpen, dayType: undefined }, 'dayType'],
    [{ ...validOpen, dayType: 'HOLIDAY' }, 'dayType'],
    [
      { ...validOpen, openingFloatCents: undefined },
      'openingFloatCents',
    ],
    [{ ...validOpen, openingFloatCents: -1 }, 'openingFloatCents'],
    [{ ...validOpen, openingFloatCents: 1.5 }, 'openingFloatCents'],
    [
      { ...validOpen, openedByStaffMemberId: undefined },
      'openedByStaffMemberId',
    ],
    [
      { ...validOpen, openedByStaffMemberId: 'missing' },
      'openedByStaffMemberId',
    ],
  ])('rejects invalid open request %#', async (value, field) => {
    const result = await messages(OpenBusinessDayDto, value);
    expect(result.join(' ')).toContain(field);
  });

  it('accepts close input and normalizes an empty optional reason', async () => {
    const instance = plainToInstance(CloseBusinessDayDto, {
      ...validClose,
      varianceReason: '   ',
    });

    await expect(validate(instance)).resolves.toEqual([]);
    expect(instance.varianceReason).toBeNull();
  });

  it.each([
    [
      { ...validClose, clientGeneratedId: undefined },
      'clientGeneratedId',
    ],
    [
      { ...validClose, clientGeneratedId: 'not-a-uuid' },
      'clientGeneratedId',
    ],
    [
      { ...validClose, actualCashCents: undefined },
      'actualCashCents',
    ],
    [{ ...validClose, actualCashCents: -1 }, 'actualCashCents'],
    [{ ...validClose, actualCashCents: 1.5 }, 'actualCashCents'],
    [
      { ...validClose, closedByStaffMemberId: undefined },
      'closedByStaffMemberId',
    ],
    [
      { ...validClose, closedByStaffMemberId: 'missing' },
      'closedByStaffMemberId',
    ],
  ])('rejects invalid close request %#', async (value, field) => {
    const result = await messages(CloseBusinessDayDto, value);
    expect(result.join(' ')).toContain(field);
  });

  it('accepts and trims a valid expense movement', async () => {
    const instance = plainToInstance(
      CreateCashMovementDto,
      validMovement,
    );

    await expect(validate(instance)).resolves.toEqual([]);
    expect(instance.description).toBe('Cleaning supplies');
    expect(instance.category).toBe('Supplies');
  });

  it.each([
    CashMovementKind.CASH_IN,
    CashMovementKind.CASH_OUT,
    CashMovementKind.EXPENSE,
  ])('accepts kind %s without a category', async (kind) => {
    const instance = plainToInstance(CreateCashMovementDto, {
      ...validMovement,
      kind,
      category: '   ',
    });

    await expect(validate(instance)).resolves.toEqual([]);
    expect(instance.category).toBeNull();
  });

  it.each([CashMovementKind.CASH_IN, CashMovementKind.CASH_OUT])(
    'rejects a category for %s',
    async (kind) => {
      const result = await messages(CreateCashMovementDto, {
        ...validMovement,
        kind,
      });

      expect(result).toContain('category is only allowed for EXPENSE');
    },
  );

  it.each([
    [{ ...validMovement, clientGeneratedId: undefined }, 'clientGeneratedId'],
    [{ ...validMovement, clientGeneratedId: 'not-a-uuid' }, 'clientGeneratedId'],
    [{ ...validMovement, kind: undefined }, 'kind'],
    [{ ...validMovement, kind: 'TRANSFER' }, 'kind'],
    [{ ...validMovement, amountCents: undefined }, 'amountCents'],
    [{ ...validMovement, amountCents: 0 }, 'amountCents'],
    [{ ...validMovement, amountCents: -1 }, 'amountCents'],
    [{ ...validMovement, amountCents: 1.5 }, 'amountCents'],
    [{ ...validMovement, amountCents: 2_147_483_648 }, 'amountCents'],
    [{ ...validMovement, description: undefined }, 'description'],
    [{ ...validMovement, description: '   ' }, 'description'],
    [
      { ...validMovement, recordedByStaffMemberId: 'not-a-uuid' },
      'recordedByStaffMemberId',
    ],
  ])('rejects invalid cash movement request %#', async (value, field) => {
    const result = await messages(CreateCashMovementDto, value);
    expect(result.join(' ')).toContain(field);
  });
});
