import 'reflect-metadata';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

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

describe('OrdersController void', () => {
  it.each([Role.ADMIN, Role.STAFF])(
    'passes the %s caller role to the service so it can scope the void',
    async (role) => {
      const voidOrder = jest.fn().mockResolvedValue({ id: 'correction' });
      const controller = new OrdersController({
        void: voidOrder,
      } as unknown as OrdersService);
      const input = {
        clientGeneratedId: '7e48933b-cc0d-4398-9dfd-af494d58f704',
        deviceId: 'register-1',
        voidReason: 'Charged twice',
      };

      await controller.void('original-id', input, {
        headers: {},
        user: { id: 'user-id', username: 'orders-user', role },
      });

      expect(voidOrder).toHaveBeenCalledWith('original-id', input, role);
    },
  );
});
