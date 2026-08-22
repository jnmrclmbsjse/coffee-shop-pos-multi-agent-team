import { describe, expect, it } from 'vitest';

import {
  ALLOWANCE_DESCRIPTION_PRESETS,
  BONUS_DESCRIPTION_PRESETS,
  LineDiscountKind,
  LinePreference,
  MovementType,
  StockLevel,
} from './domain.js';

describe('inventory operation enums', () => {
  it('keeps stock levels in the count-sheet display order', () => {
    expect(Object.values(StockLevel)).toEqual([
      'EMPTY',
      'LOW',
      'QUARTER',
      'ONE_THIRD',
      'HALF',
      'TWO_THIRDS',
      'THREE_QUARTERS',
      'FULL',
    ]);
  });

  it('only exposes delivery and wastage movement types', () => {
    expect(Object.values(MovementType)).toEqual(['DELIVERY', 'WASTAGE']);
  });
});

describe('order capture enums', () => {
  it('exposes both statutory line discount kinds', () => {
    expect(Object.values(LineDiscountKind)).toEqual(['NONE', 'PWD', 'SENIOR']);
  });

  it('keeps line preferences in their canonical storage order', () => {
    expect(Object.values(LinePreference)).toEqual([
      'SWEETER',
      'STRONGER',
      'LESS_SWEET',
      'LESS_ICE',
    ]);
  });
});

describe('compensation adjustment description presets', () => {
  it('exports the approved allowance and bonus starter wording', () => {
    expect(ALLOWANCE_DESCRIPTION_PRESETS).toEqual([
      'Load allowance',
      'Transportation allowance',
      'Calamity allowance',
    ]);
    expect(BONUS_DESCRIPTION_PRESETS).toEqual([
      'Performance bonus',
      'Spot bonus',
    ]);
  });
});
