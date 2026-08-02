import 'reflect-metadata';
import {
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { CatalogService } from './catalog.service';
import { ProductsController } from './products.controller';

function contextFor(
  handler: (...args: never[]) => unknown,
  role: Role,
): ExecutionContext {
  const request: AuthenticatedRequest = {
    headers: {},
    user: { id: 'user-id', username: 'catalog-user', role },
  };

  return {
    getHandler: () => handler,
    getClass: () => ProductsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ProductsController', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a STAFF session to use the product list override', () => {
    expect(
      guard.canActivate(
        contextFor(ProductsController.prototype.list, Role.STAFF),
      ),
    ).toBe(true);
  });

  it('keeps product creation ADMIN-only', () => {
    expect(() =>
      guard.canActivate(
        contextFor(ProductsController.prototype.create, Role.STAFF),
      ),
    ).toThrow(ForbiddenException);
  });

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
