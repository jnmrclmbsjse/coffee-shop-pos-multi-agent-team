import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SelectableStaffController } from './selectable-staff.controller';

describe('SelectableStaffController', () => {
  it('is a distinct STAFF-only guarded projection', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SelectableStaffController)).toEqual([
      Role.STAFF,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SelectableStaffController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('delegates roster projection to the staff service', async () => {
    const selectable = [
      { id: 'staff-id', displayName: 'Alex Rivera', requiresPin: true },
    ];
    const staffService = {
      listSelectable: jest.fn().mockResolvedValue(selectable),
    };
    const controller = new SelectableStaffController(staffService as never);

    await expect(controller.list()).resolves.toEqual(selectable);
  });
});
