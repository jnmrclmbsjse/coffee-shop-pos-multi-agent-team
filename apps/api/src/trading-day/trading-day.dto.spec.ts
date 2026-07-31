import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CloseBusinessDayDto,
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
});
