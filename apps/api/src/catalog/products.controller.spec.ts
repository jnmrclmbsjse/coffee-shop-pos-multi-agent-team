import 'reflect-metadata';
import { Role } from '@coffee-shop/shared';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { CatalogService } from './catalog.service';
import { ProductsController } from './products.controller';

describe('ProductsController', () => {
  it('allows both administrators and staff to update availability', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ProductsController.prototype.updateAvailability,
    );

    expect(roles).toEqual([Role.ADMIN, Role.STAFF]);
  });

  it('delegates availability changes to the single catalog service state', async () => {
    const updateAvailability = jest
      .fn()
      .mockResolvedValue({ id: 'product-id', available: false });
    const controller = new ProductsController({
      updateAvailability,
    } as unknown as CatalogService);

    await controller.updateAvailability('product-id', {
      available: false,
    });

    expect(updateAvailability).toHaveBeenCalledWith('product-id', false);
  });
});
