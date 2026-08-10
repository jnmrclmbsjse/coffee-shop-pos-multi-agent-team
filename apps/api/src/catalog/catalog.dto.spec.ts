import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './catalog.dto';

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
      freeUpsizeEligible: false,
    });

    expect(await validate(category)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'name' }),
      ]),
    );
  });

  it('accepts a boolean free-upsize choice on category create and update', async () => {
    const create = plainToInstance(CreateCategoryDto, {
      name: 'Coffee',
      sortWeight: 0,
      active: true,
      freeUpsizeEligible: true,
    });
    const update = plainToInstance(UpdateCategoryDto, {
      freeUpsizeEligible: false,
    });

    expect(await validate(create)).toHaveLength(0);
    expect(await validate(update)).toHaveLength(0);
  });

  it('rejects a non-boolean free-upsize choice', async () => {
    const category = plainToInstance(CreateCategoryDto, {
      name: 'Coffee',
      sortWeight: 0,
      active: true,
      freeUpsizeEligible: 'yes',
    });

    expect(await validate(category)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'freeUpsizeEligible' }),
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

  it('accepts an omitted or positive whole-number packaging servings value', async () => {
    const defaultedCreate = plainToInstance(CreateProductDto, validProduct);
    const explicitCreate = plainToInstance(CreateProductDto, {
      ...validProduct,
      packagingServings: 2,
    });
    const update = plainToInstance(UpdateProductDto, {
      packagingServings: 3,
    });

    await expect(validate(defaultedCreate)).resolves.toHaveLength(0);
    await expect(validate(explicitCreate)).resolves.toHaveLength(0);
    await expect(validate(update)).resolves.toHaveLength(0);
  });

  it.each([0, -1, 1.5, '', null])(
    'rejects an invalid packaging servings value: %s',
    async (packagingServings) => {
      const product = plainToInstance(CreateProductDto, {
        ...validProduct,
        packagingServings,
      });

      const errors = await validate(product);

      const servingsError = errors.find(
        ({ property }) => property === 'packagingServings',
      );
      expect(servingsError).toBeDefined();
      expect(Object.values(servingsError?.constraints ?? {})).toContain(
        'packagingServings must be a whole number of 1 or greater',
      );
    },
  );

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
