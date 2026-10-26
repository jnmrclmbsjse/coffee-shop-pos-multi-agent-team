import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SchedulingController } from './scheduling.controller';

describe('SchedulingController', () => {
  it('restricts the scheduling API to administrators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SchedulingController)).toEqual([
      Role.ADMIN,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, SchedulingController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it.each(['get', 'save'] as const)(
    'refuses a STAFF user on %s',
    (handlerName) => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => SchedulingController.prototype[handlerName],
        getClass: () => SchedulingController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'staff-user-id', username: 'staff', role: Role.STAFF },
          }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );
});
