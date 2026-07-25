import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffController } from './staff.controller';

describe('StaffController', () => {
  it('restricts the entire roster API to administrators', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, StaffController);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      StaffController,
    );

    expect(roles).toEqual([Role.ADMIN]);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('does not expose a hard-delete handler', () => {
    expect(
      Object.getOwnPropertyNames(StaffController.prototype),
    ).not.toContain('remove');
  });
});
