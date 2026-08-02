import 'reflect-metadata';
import {
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import type { CatalogService } from './catalog.service';
import { CategoriesController } from './categories.controller';

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
    getClass: () => CategoriesController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CategoriesController access', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a STAFF session to use the category list override', () => {
    expect(
      guard.canActivate(
        contextFor(CategoriesController.prototype.list, Role.STAFF),
      ),
    ).toBe(true);
  });

  it('keeps category creation ADMIN-only', () => {
    expect(() =>
      guard.canActivate(
        contextFor(CategoriesController.prototype.create, Role.STAFF),
      ),
    ).toThrow(ForbiddenException);
  });

  it('delegates category listing to the catalog service', async () => {
    const listCategories = jest.fn().mockResolvedValue([]);
    const controller = new CategoriesController({
      listCategories,
    } as unknown as CatalogService);

    await controller.list();

    expect(listCategories).toHaveBeenCalledTimes(1);
  });
});
