import 'reflect-metadata';
import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Role } from '@coffee-shop/shared';
import { DEVICE_ID_REQUIRED_MESSAGE } from '../auth/auth.constants';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

describe('SalesController', () => {
  let app: INestApplication;
  let baseUrl: string;

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

  beforeAll(async () => {
    const jwtGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest<AuthenticatedRequest>().user =
          request.user;
        return true;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        {
          provide: SalesService,
          useValue: {
            activeCashier: jest.fn().mockResolvedValue(null),
            selectCashier: jest.fn(),
            clearCashier: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

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

      await expect(controller.getActiveCashier(deviceId)).rejects.toEqual(
        new BadRequestException(DEVICE_ID_REQUIRED_MESSAGE),
      );
      expect(salesService.activeCashier).not.toHaveBeenCalled();
    },
  );

  it('serializes an explicit null cashier for a device with no selection', async () => {
    const response = await fetch(
      `${baseUrl}/sales/active-cashier?deviceId=till-1`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ cashier: null });
  });

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

  it('serializes an explicit null cashier after clearing', async () => {
    const response = await fetch(`${baseUrl}/sales/active-cashier`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'till-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ cashier: null });
  });
});
