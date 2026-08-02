import 'reflect-metadata';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { OrdersController } from './orders.controller';

function contextFor(role: Role): ExecutionContext {
  const request: AuthenticatedRequest = {
    headers: {},
    user: { id: 'user-id', username: 'orders-user', role },
  };
  return {
    getHandler: () => OrdersController.prototype.create,
    getClass: () => OrdersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OrdersController access', () => {
  const guard = new RolesGuard(new Reflector());

  it.each([Role.ADMIN, Role.STAFF])('allows %s on capture routes', (role) => {
    expect(guard.canActivate(contextFor(role))).toBe(true);
  });
});
