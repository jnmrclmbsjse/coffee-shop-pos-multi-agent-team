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

  it('delegates account creation for the route member', async () => {
    const createAccount = jest.fn().mockResolvedValue({
      username: 'jane',
      displayName: 'Jane Santos',
    });
    const controller = new StaffController({ createAccount } as never);
    const input = {
      username: 'jane',
      displayName: 'Jane Santos',
      password: 'secret',
      pin: '4826',
    };

    await expect(
      controller.createAccount(
        '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        input,
      ),
    ).resolves.toEqual({
      username: 'jane',
      displayName: 'Jane Santos',
    });
    expect(createAccount).toHaveBeenCalledWith(
      '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
      input,
    );
  });

  it('delegates credential rotation for the route member', async () => {
    const response = {
      staffMember: { id: 'staff-id' },
      passwordChanged: true,
      pinChanged: false,
      pinSet: true,
    };
    const updateCredentials = jest.fn().mockResolvedValue(response);
    const controller = new StaffController({ updateCredentials } as never);
    const input = { password: ' Exact Password ' };

    await expect(
      controller.updateCredentials(
        '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        input,
      ),
    ).resolves.toBe(response);
    expect(updateCredentials).toHaveBeenCalledWith(
      '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
      input,
    );
  });
});
