import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportingController } from './reporting.controller';
import { StaffOrderLedgerController } from './staff-order-ledger.controller';

describe('ReportingController', () => {
  it('restricts the entire reporting API to administrators', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ReportingController);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ReportingController,
    );

    expect(roles).toEqual([Role.ADMIN]);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('exposes no write handlers', () => {
    const handlers = Object.getOwnPropertyNames(
      ReportingController.prototype,
    );

    expect(handlers).toEqual(
      expect.arrayContaining([
        'constructor',
        'dashboard',
        'report',
        'reportCsv',
        'orderHistory',
        'orderHistoryDetail',
      ]),
    );
    expect(handlers).not.toEqual(
      expect.arrayContaining([
        'create',
        'update',
        'remove',
        'open',
        'close',
      ]),
    );
  });
});

describe('StaffOrderLedgerController', () => {
  it('is a separate staff-only read controller', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      StaffOrderLedgerController,
    );
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      StaffOrderLedgerController,
    );

    expect(roles).toEqual([Role.STAFF]);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ReportingController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('exposes only the day-scoped read handler', () => {
    expect(
      Object.getOwnPropertyNames(StaffOrderLedgerController.prototype),
    ).toEqual(['constructor', 'list']);
  });
});
