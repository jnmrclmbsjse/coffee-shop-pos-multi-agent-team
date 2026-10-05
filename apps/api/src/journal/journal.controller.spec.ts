import 'reflect-metadata';
import {
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JournalController } from './journal.controller';

describe('JournalController', () => {
  it('restricts the entire Journal API to administrators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JournalController)).toEqual([
      Role.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, JournalController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it.each([
    'listLedgers',
    'createLedger',
    'getLedger',
    'getRate',
    'updateRate',
    'getMissingDays',
    'createDepositsBulk',
    'createDeposit',
    'updateDeposit',
    'removeDeposit',
    'createWithdrawal',
    'updateWithdrawal',
    'removeWithdrawal',
  ] as const)('refuses a STAFF user on %s', (handlerName) => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => JournalController.prototype[handlerName],
      getClass: () => JournalController,
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
  });

  it('delegates every read and attributes every write to the administrator', async () => {
    const service = {
      listLedgers: jest.fn().mockResolvedValue([]),
      createLedger: jest.fn().mockResolvedValue({ id: 'ledger-id' }),
      getLedger: jest.fn().mockResolvedValue({ id: 'ledger-id' }),
      getRate: jest.fn().mockResolvedValue(null),
      updateRate: jest.fn().mockResolvedValue({ id: 'rate-id' }),
      getMissingDays: jest.fn().mockResolvedValue([]),
      createDepositsBulk: jest.fn().mockResolvedValue([]),
      createDeposit: jest.fn().mockResolvedValue({ id: 'deposit-id' }),
      updateDeposit: jest.fn().mockResolvedValue({ id: 'deposit-id' }),
      removeDeposit: jest.fn().mockResolvedValue(undefined),
      createWithdrawal: jest
        .fn()
        .mockResolvedValue({ id: 'withdrawal-id' }),
      updateWithdrawal: jest
        .fn()
        .mockResolvedValue({ id: 'withdrawal-id' }),
      removeWithdrawal: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new JournalController(service as never);
    const request = {
      headers: {},
      user: {
        id: 'admin-user-id',
        username: 'admin',
        role: Role.ADMIN,
      },
    };
    const ledgerInput = { name: 'Equipment', startDate: '2026-10-01' };
    const depositInput = { businessDate: '2026-10-02', amountCents: 0 };
    const withdrawalInput = { withdrawnOn: '2026-10-03', amountCents: 1 };
    const rateInput = { rentPercentBasisPoints: 1_500 };
    const bulkInput = { deposits: [depositInput] };

    await controller.listLedgers();
    await controller.createLedger(ledgerInput as never);
    await controller.getLedger('ledger-id');
    await controller.getRate('ledger-id');
    await controller.updateRate('ledger-id', rateInput as never, request);
    await controller.getMissingDays('ledger-id');
    await controller.createDepositsBulk(
      'ledger-id',
      bulkInput as never,
      request,
    );
    await controller.createDeposit('ledger-id', depositInput as never, request);
    await controller.updateDeposit('deposit-id', depositInput as never, request);
    await controller.removeDeposit('deposit-id');
    await controller.createWithdrawal(
      'ledger-id',
      withdrawalInput as never,
      request,
    );
    await controller.updateWithdrawal(
      'withdrawal-id',
      withdrawalInput as never,
      request,
    );
    await controller.removeWithdrawal('withdrawal-id');

    expect(service.listLedgers).toHaveBeenCalledWith();
    expect(service.createLedger).toHaveBeenCalledWith(ledgerInput);
    expect(service.getLedger).toHaveBeenCalledWith('ledger-id');
    expect(service.getRate).toHaveBeenCalledWith('ledger-id');
    expect(service.updateRate).toHaveBeenCalledWith(
      'ledger-id',
      rateInput,
      'admin-user-id',
    );
    expect(service.getMissingDays).toHaveBeenCalledWith('ledger-id');
    expect(service.createDepositsBulk).toHaveBeenCalledWith(
      'ledger-id',
      bulkInput,
      'admin-user-id',
    );
    expect(service.createDeposit).toHaveBeenCalledWith(
      'ledger-id',
      depositInput,
      'admin-user-id',
    );
    expect(service.updateDeposit).toHaveBeenCalledWith(
      'deposit-id',
      depositInput,
      'admin-user-id',
    );
    expect(service.removeDeposit).toHaveBeenCalledWith('deposit-id');
    expect(service.createWithdrawal).toHaveBeenCalledWith(
      'ledger-id',
      withdrawalInput,
      'admin-user-id',
    );
    expect(service.updateWithdrawal).toHaveBeenCalledWith(
      'withdrawal-id',
      withdrawalInput,
      'admin-user-id',
    );
    expect(service.removeWithdrawal).toHaveBeenCalledWith('withdrawal-id');
  });
});
