import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CountMethod, StockLevel } from '@coffee-shop/shared';
import {
  CreateInventoryItemDto,
  UpsertParLevelDto,
} from './inventory.dto';

describe('Inventory DTO validation', () => {
  const categoryId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';

  it('defaults a new item to pcs, Quantity, active, and false flags', async () => {
    const item = plainToInstance(CreateInventoryItemDto, {
      categoryId,
      name: 'Milk',
    });

    expect(await validate(item)).toHaveLength(0);
    expect(item).toMatchObject({
      unit: 'pcs',
      countMethod: CountMethod.QUANTITY,
      critical: false,
      reconciled: false,
      active: true,
    });
  });

  it('trims item fields and converts a blank optional size to null', async () => {
    const item = plainToInstance(CreateInventoryItemDto, {
      categoryId,
      name: '  Milk  ',
      unit: ' carton ',
      size: '   ',
    });

    expect(await validate(item)).toHaveLength(0);
    expect(item).toMatchObject({
      name: 'Milk',
      unit: 'carton',
      size: null,
    });
  });

  it.each([
    { parQty: -1 },
    { parQty: 1.5 },
    { parQty: 10, lowThreshold: -1 },
    { parQty: 10, lowThreshold: 2.5 },
    { parQty: 10, lowThreshold: 5, urgentThreshold: -1 },
    { parQty: 10, lowThreshold: 5, urgentThreshold: 1.5 },
  ])('rejects negative or non-whole par input: %j', async (input) => {
    const parLevel = plainToInstance(UpsertParLevelDto, input);

    expect(await validate(parLevel)).not.toHaveLength(0);
  });

  it.each([
    { parQty: 10, lowThreshold: 5, urgentThreshold: 2 },
    { parLevel: StockLevel.HALF },
  ])('accepts a valid par payload shape: %j', async (input) => {
    const parLevel = plainToInstance(UpsertParLevelDto, input);

    expect(await validate(parLevel)).toHaveLength(0);
  });

  it('rejects a level outside the StockLevel vocabulary', async () => {
    const parLevel = plainToInstance(UpsertParLevelDto, {
      parLevel: 'ALMOST_FULL',
    });

    expect(await validate(parLevel)).not.toHaveLength(0);
  });
});
