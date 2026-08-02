import { BadRequestException } from '@nestjs/common';
import {
  LineDiscountKind,
  LinePreference,
  PaymentMethod,
} from '@prisma/client';
import type { CompleteOrderDto } from './orders.dto';
import {
  calculateLineAmounts,
  isPlainMergeableLine,
  normalizePreferences,
  validateTender,
} from './orders.service';

describe('orders money engine', () => {
  it('applies the free upsize before Senior discount in the ADR example', () => {
    expect(
      calculateLineAmounts({
        quantity: 1,
        unitPriceCents: 15_000,
        discountKind: LineDiscountKind.SENIOR,
        freeUpsizeCount: 1,
        freeUpsizeEligible: true,
      }),
    ).toEqual({
      lineGrossCents: 15_000,
      freeUpsizeCents: 3_000,
      discountCents: 2_400,
      lineTotalCents: 9_600,
    });
  });

  it('rounds the percentage term half-up once per line', () => {
    expect(
      calculateLineAmounts({
        quantity: 1,
        unitPriceCents: 3,
        discountKind: LineDiscountKind.PWD,
        freeUpsizeCount: 0,
        freeUpsizeEligible: false,
      }).discountCents,
    ).toBe(1);
  });

  it('keeps the sum of generated line totals equal to the order total', () => {
    let seed = 20_308;
    const random = (maximum: number): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed % maximum;
    };

    for (let setIndex = 0; setIndex < 500; setIndex += 1) {
      const lines = Array.from({ length: random(12) + 1 }, () => {
        const quantity = random(8) + 1;
        const unitPriceCents = random(20_000) + 3_000;
        const eligible = random(2) === 1;
        return calculateLineAmounts({
          quantity,
          unitPriceCents,
          discountKind: Object.values(LineDiscountKind)[random(3)]!,
          freeUpsizeCount: eligible ? random(quantity + 1) : 0,
          freeUpsizeEligible: eligible,
        });
      });
      const subtotal = lines.reduce(
        (sum, line) => sum + line.lineGrossCents,
        0,
      );
      const upsizes = lines.reduce(
        (sum, line) => sum + line.freeUpsizeCents,
        0,
      );
      const discounts = lines.reduce(
        (sum, line) => sum + line.discountCents,
        0,
      );
      expect(
        lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
      ).toBe(subtotal - upsizes - discounts);
    }
  });

  it.each([
    [
      {
        quantity: 1,
        unitPriceCents: 10_000,
        discountKind: LineDiscountKind.NONE,
        freeUpsizeCount: 2,
        freeUpsizeEligible: true,
      },
      'between zero and quantity',
    ],
    [
      {
        quantity: 1,
        unitPriceCents: 10_000,
        discountKind: LineDiscountKind.NONE,
        freeUpsizeCount: 1,
        freeUpsizeEligible: false,
      },
      'not eligible',
    ],
    [
      {
        quantity: 1,
        unitPriceCents: 2_999,
        discountKind: LineDiscountKind.NONE,
        freeUpsizeCount: 1,
        freeUpsizeEligible: true,
      },
      'cannot exceed',
    ],
  ])('rejects an invalid free-upsize bound %#', (line, message) => {
    expect(() => calculateLineAmounts(line)).toThrow(message);
  });
});

describe('orders line identity', () => {
  it('normalizes preferences to declaration order and accepts contradictions', () => {
    expect(
      normalizePreferences([
        LinePreference.LESS_ICE,
        LinePreference.LESS_SWEET,
        LinePreference.SWEETER,
      ]),
    ).toEqual([
      LinePreference.SWEETER,
      LinePreference.LESS_SWEET,
      LinePreference.LESS_ICE,
    ]);
  });

  it('merges only a plain undiscounted line', () => {
    const plain = {
      discountKind: LineDiscountKind.NONE,
      preferences: [] as LinePreference[],
      preferenceNote: null,
      freeUpsizeCount: 0,
    };
    expect(isPlainMergeableLine(plain)).toBe(true);
    expect(
      isPlainMergeableLine({
        ...plain,
        discountKind: LineDiscountKind.PWD,
      }),
    ).toBe(false);
    expect(
      isPlainMergeableLine({
        ...plain,
        preferences: [LinePreference.STRONGER],
      }),
    ).toBe(false);
    expect(isPlainMergeableLine({ ...plain, preferenceNote: 'hot' })).toBe(
      false,
    );
    expect(isPlainMergeableLine({ ...plain, freeUpsizeCount: 1 })).toBe(
      false,
    );
  });
});

describe('orders tender validation', () => {
  const input = (
    overrides: Partial<CompleteOrderDto> = {},
  ): CompleteOrderDto => ({
    payments: [{ method: PaymentMethod.CASH, amountCents: 10_000 }],
    cashTipCents: 0,
    changeOwedCents: 0,
    ...overrides,
  });

  it('records blank cash received as exact cash tender', () => {
    expect(validateTender(10_000, input())).toEqual({
      cashReceivedCents: 10_000,
    });
  });

  it('accepts an exact split and validates cash received against cash only', () => {
    expect(
      validateTender(
        10_000,
        input({
          payments: [
            { method: PaymentMethod.CASH, amountCents: 4_000 },
            { method: PaymentMethod.ONLINE, amountCents: 6_000 },
          ],
          cashReceivedCents: 5_000,
          changeOwedCents: 1_000,
        }),
      ),
    ).toEqual({ cashReceivedCents: 5_000 });
  });

  it('keeps online-only settlement free of cash fields', () => {
    expect(
      validateTender(
        10_000,
        input({
          payments: [
            { method: PaymentMethod.ONLINE, amountCents: 10_000 },
          ],
        }),
      ),
    ).toEqual({ cashReceivedCents: null });
  });

  it.each([
    [
      input({
        payments: [{ method: PaymentMethod.CASH, amountCents: 9_999 }],
      }),
      'must equal',
    ],
    [
      input({
        payments: [{ method: PaymentMethod.CASH, amountCents: -1 }],
      }),
      'non-negative',
    ],
    [input({ cashReceivedCents: 9_999 }), 'cannot be less'],
    [
      input({ cashReceivedCents: 10_100, changeOwedCents: 101 }),
      'cannot exceed',
    ],
    [
      input({
        payments: [
          { method: PaymentMethod.ONLINE, amountCents: 10_000 },
        ],
        cashReceivedCents: 10_000,
      }),
      'cannot record cash',
    ],
  ])('rejects invalid tender %#', (settlement, message) => {
    expect(() => validateTender(10_000, settlement)).toThrow(
      BadRequestException,
    );
    expect(() => validateTender(10_000, settlement)).toThrow(message);
  });
});
