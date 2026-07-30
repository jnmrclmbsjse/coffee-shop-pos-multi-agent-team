import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TradingDayController } from '../trading-day/trading-day.controller';
import { RestockController } from './restock.controller';
import { StockCountsController } from './stock-counts.controller';
import { StockMovementsController } from './stock-movements.controller';

describe('staff inventory operation controllers', () => {
  const controllers = [
    TradingDayController,
    StockCountsController,
    StockMovementsController,
    RestockController,
  ];

  it.each(controllers)(
    '%p allows admin and staff behind both auth guards',
    (controller) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([
        Role.ADMIN,
        Role.STAFF,
      ]);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    },
  );

  it('does not expose mutation handlers for counts or count lines', () => {
    expect(
      Object.getOwnPropertyNames(StockCountsController.prototype),
    ).toEqual(
      expect.arrayContaining([
        'constructor',
        'openingSheet',
        'closingSheet',
        'listActiveStaff',
        'submit',
      ]),
    );
    expect(
      Object.getOwnPropertyNames(StockCountsController.prototype),
    ).not.toEqual(expect.arrayContaining(['update', 'remove']));
  });

  it('does not expose update or delete handlers for movements', () => {
    expect(
      Object.getOwnPropertyNames(StockMovementsController.prototype),
    ).not.toEqual(expect.arrayContaining(['update', 'remove']));
  });
});
