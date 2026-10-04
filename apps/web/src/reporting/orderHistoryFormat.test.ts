import { describe, expect, it } from 'vitest';
import { ServiceType } from '@coffee-shop/shared';
import {
  formatOrderHistoryPaymentMethod,
  formatServiceType,
  formatTimestamp,
  parseOrderHistoryQuery,
} from './orderHistoryFormat';

describe('order history formatting', () => {
  it('parses supported URL state and rejects invalid values', () => {
    expect(
      parseOrderHistoryQuery(
        new URLSearchParams(
          'status=Completed&paymentMethod=Split&serviceType=TAKE_OUT&search=%20Ana%20&sort=total&direction=asc&page=3&pageSize=25',
        ),
      ),
    ).toEqual({
      status: 'Completed',
      paymentMethod: 'Split',
      serviceType: ServiceType.TAKE_OUT,
      search: 'Ana',
      sort: 'total',
      direction: 'asc',
      page: 3,
      pageSize: 25,
    });

    expect(
      parseOrderHistoryQuery(
        new URLSearchParams(
          'status=Unknown&serviceType=CURBSIDE&sort=bad&direction=sideways&page=0&pageSize=7',
        ),
      ),
    ).toEqual({
      sort: 'businessDay',
      direction: 'desc',
      page: 1,
      pageSize: 10,
    });
  });

  it.each([ServiceType.DINE_IN, ServiceType.TAKE_OUT])(
    'parses the supported %s service type',
    (serviceType) => {
      expect(
        parseOrderHistoryQuery(
          new URLSearchParams({ serviceType }),
        ).serviceType,
      ).toBe(serviceType);
    },
  );

  it('uses approved payment, service, and timestamp labels', () => {
    expect(formatOrderHistoryPaymentMethod('Split')).toBe(
      'Split (Cash + Online)',
    );
    expect(formatOrderHistoryPaymentMethod(null)).toBe('—');
    expect(formatServiceType(ServiceType.DINE_IN)).toBe('Dine-in');
    expect(formatServiceType(ServiceType.TAKE_OUT)).toBe('Take-out');
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp('2026-07-28T06:15:00.000Z')).toContain(
      'Jul 28, 2026',
    );
  });
});
