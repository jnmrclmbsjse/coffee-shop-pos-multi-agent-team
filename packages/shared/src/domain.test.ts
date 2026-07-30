import { describe, expect, it } from 'vitest';

import { MovementType, StockLevel } from './domain.js';

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
