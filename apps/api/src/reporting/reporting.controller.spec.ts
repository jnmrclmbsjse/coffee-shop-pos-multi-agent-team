import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportingController } from './reporting.controller';

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
