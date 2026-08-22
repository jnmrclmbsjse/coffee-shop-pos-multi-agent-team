import 'reflect-metadata';
import {
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CompensationController } from './compensation.controller';

describe('CompensationController', () => {
  it('restricts the entire compensation API to administrators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CompensationController)).toEqual([
      Role.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CompensationController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it.each([
    'payslip',
    'list',
    'create',
    'update',
    'remove',
    'listAdjustments',
    'createAdjustment',
    'updateAdjustment',
    'removeAdjustment',
  ] as const)(
    'refuses a STAFF user on %s',
    (handlerName) => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => CompensationController.prototype[handlerName],
        getClass: () => CompensationController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              id: 'staff-user-id',
              username: 'staff',
              role: Role.STAFF,
            },
          }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it('delegates payslip generation with the requested staff member and range', async () => {
    const service = {
      getPayslip: jest.fn().mockResolvedValue({ entries: [] }),
    };
    const controller = new CompensationController(service as never);
    const query = {
      staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
      from: '2026-08-01',
      to: '2026-08-15',
    };

    await expect(controller.payslip(query)).resolves.toEqual({ entries: [] });
    expect(service.getPayslip).toHaveBeenCalledWith(query);
  });

  it('attributes creates and updates to the authenticated administrator', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'created' }),
      update: jest.fn().mockResolvedValue({ id: 'updated' }),
    };
    const controller = new CompensationController(service as never);
    const request = {
      headers: {},
      user: {
        id: 'admin-user-id',
        username: 'admin',
        role: Role.ADMIN,
      },
    };
    const createInput = {
      staffMemberId: 'staff-id',
      workDate: '2026-08-15',
      salaryCents: 100,
      commissionCents: 25,
    } as never;
    const updateInput = {
      salaryCents: 200,
      commissionCents: 50,
    } as never;

    await controller.create(createInput, request);
    await controller.update('entry-id', updateInput, request);

    expect(service.create).toHaveBeenCalledWith(
      createInput,
      'admin-user-id',
    );
    expect(service.update).toHaveBeenCalledWith(
      'entry-id',
      updateInput,
      'admin-user-id',
    );
  });

  it('delegates adjustment CRUD and attributes writes to the administrator', async () => {
    const service = {
      listAdjustments: jest.fn().mockResolvedValue([]),
      createAdjustment: jest.fn().mockResolvedValue({ id: 'created' }),
      updateAdjustment: jest.fn().mockResolvedValue({ id: 'updated' }),
      removeAdjustment: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new CompensationController(service as never);
    const request = {
      headers: {},
      user: {
        id: 'admin-user-id',
        username: 'admin',
        role: Role.ADMIN,
      },
    };
    const query = { staffMemberId: 'staff-id' } as never;
    const createInput = { kind: 'BONUS' } as never;
    const updateInput = { amountCents: 250 } as never;

    await controller.listAdjustments(query);
    await controller.createAdjustment(createInput, request);
    await controller.updateAdjustment('adjustment-id', updateInput, request);
    await controller.removeAdjustment('adjustment-id');

    expect(service.listAdjustments).toHaveBeenCalledWith(query);
    expect(service.createAdjustment).toHaveBeenCalledWith(
      createInput,
      'admin-user-id',
    );
    expect(service.updateAdjustment).toHaveBeenCalledWith(
      'adjustment-id',
      updateInput,
      'admin-user-id',
    );
    expect(service.removeAdjustment).toHaveBeenCalledWith('adjustment-id');
  });
});
