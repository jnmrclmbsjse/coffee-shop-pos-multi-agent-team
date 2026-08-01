import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { DEVICE_ID_REQUIRED_MESSAGE } from '../auth/auth.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SalesController } from './sales.controller';

describe('SalesController', () => {
  const request = {
    headers: { cookie: 'ucm_admin_session=unchanged-session-token' },
    user: {
      id: '09571f7f-3bc4-4211-b22f-1f165323f9de',
      username: 'staff',
      role: Role.STAFF,
    },
  };

  function createController() {
    const salesService = {
      activeCashier: jest.fn().mockResolvedValue(null),
      selectCashier: jest.fn().mockResolvedValue({
        id: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        displayName: 'Alex Rivera',
      }),
      clearCashier: jest.fn().mockResolvedValue(null),
    };
    return {
      controller: new SalesController(salesService as never),
      salesService,
    };
  }

  it('is guarded for STAFF sessions only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SalesController)).toEqual([
      Role.STAFF,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, SalesController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it.each([undefined, null, '', '   '])(
    'rejects missing or blank deviceId %p',
    async (deviceId) => {
      const { controller, salesService } = createController();

      expect(() => controller.getActiveCashier(deviceId)).toThrow(
        new BadRequestException(DEVICE_ID_REQUIRED_MESSAGE),
      );
      expect(salesService.activeCashier).not.toHaveBeenCalled();
    },
  );

  it('uses the authenticated session user and never accepts one from the body', async () => {
    const { controller, salesService } = createController();

    await controller.selectCashier(
      {
        deviceId: 'till-1',
        staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
        pin: '1234',
        selectedByUserId: 'attacker-controlled',
      } as never,
      request,
    );

    expect(salesService.selectCashier).toHaveBeenCalledWith(
      'till-1',
      '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
      '1234',
      request.user.id,
    );
    expect(request.headers.cookie).toBe(
      'ucm_admin_session=unchanged-session-token',
    );
  });

  it('clears without a PIN and attributes the append to the session user', async () => {
    const { controller, salesService } = createController();

    await controller.clearCashier({ deviceId: 'till-1' }, request);

    expect(salesService.clearCashier).toHaveBeenCalledWith(
      'till-1',
      request.user.id,
    );
    expect(request.headers.cookie).toBe(
      'ucm_admin_session=unchanged-session-token',
    );
  });
});
