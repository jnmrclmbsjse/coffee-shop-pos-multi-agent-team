import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto, CreateProductDto } from './catalog.dto';

describe('Catalog DTO validation', () => {
  const validProduct = {
    categoryId: '56fe72cc-5c03-466c-bd87-7c5d2d732bbe',
    name: 'Latte',
    active: true,
    available: true,
    sizes: [
      {
        name: 'Regular',
        priceCents: 15000,
        sortWeight: 0,
        active: true,
        cupInventoryItemId: null,
        lidInventoryItemId: null,
      },
    ],
  };

  it('trims category names and rejects names that become blank', async () => {
    const category = plainToInstance(CreateCategoryDto, {
      name: '   ',
      sortWeight: 0,
      active: true,
    });

    expect(await validate(category)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'name' }),
      ]),
    );
  });

  it('accepts an integer size price of zero', async () => {
    const product = plainToInstance(CreateProductDto, {
      ...validProduct,
      sizes: [{ ...validProduct.sizes[0], priceCents: 0 }],
    });

    expect(await validate(product)).toHaveLength(0);
  });

  it.each([-1, 12.5, undefined])(
    'rejects an invalid required size price: %s',
    async (priceCents) => {
      const product = plainToInstance(CreateProductDto, {
        ...validProduct,
        sizes: [{ ...validProduct.sizes[0], priceCents }],
      });

      const errors = await validate(product);

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            property: 'sizes',
            children: expect.arrayContaining([
              expect.objectContaining({
                children: expect.arrayContaining([
                  expect.objectContaining({ property: 'priceCents' }),
                ]),
              }),
            ]),
          }),
        ]),
      );
    },
  );

  it('rejects a product with no sizes', async () => {
    const product = plainToInstance(CreateProductDto, {
      ...validProduct,
      sizes: [],
    });

    expect(await validate(product)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'sizes' }),
      ]),
    );
  });
});
