import type { ConfigService } from '@nestjs/config';
import { AuthAttemptThrottleService } from './auth-attempt-throttle.service';

function config(values: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

describe('AuthAttemptThrottleService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-24T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts a configurable cooldown after the configured failure count', () => {
    const service = new AuthAttemptThrottleService(
      config({
        AUTH_THROTTLE_MAX_FAILURES: '5',
        AUTH_THROTTLE_COOLDOWN_SECONDS: '30',
      }),
    );
    const key = service.keyForUser('device-1', 'staff-1');

    for (let attempt = 1; attempt < 5; attempt += 1) {
      service.recordFailure(key);
      expect(service.retryAfterSeconds(key)).toBeNull();
    }

    service.recordFailure(key);
    expect(service.retryAfterSeconds(key)).toBe(30);

    jest.advanceTimersByTime(29_001);
    expect(service.retryAfterSeconds(key)).toBe(1);

    jest.advanceTimersByTime(999);
    expect(service.retryAfterSeconds(key)).toBeNull();
  });

  it('uses the same per-device user key across authentication methods', () => {
    const service = new AuthAttemptThrottleService(config());

    expect(service.keyForUser(' device-1 ', 'staff-1')).toBe(
      service.keyForUser('device-1', 'staff-1'),
    );
  });

  it('resets consecutive failures after successful authentication', () => {
    const service = new AuthAttemptThrottleService(
      config({ AUTH_THROTTLE_MAX_FAILURES: '2' }),
    );
    const key = service.keyForUser('device-1', 'staff-1');

    service.recordFailure(key);
    service.reset(key);
    service.recordFailure(key);

    expect(service.retryAfterSeconds(key)).toBeNull();
  });

  it('proactively evicts failure buckets after the cooldown window', () => {
    const service = new AuthAttemptThrottleService(
      config({
        AUTH_THROTTLE_MAX_FAILURES: '2',
        AUTH_THROTTLE_COOLDOWN_SECONDS: '30',
      }),
    );
    const expiredKey = service.keyForUnknown('device-1', 'password', 'first');

    service.recordFailure(expiredKey);
    jest.advanceTimersByTime(30_000);
    service.recordFailure(
      service.keyForUnknown('device-2', 'password', 'second'),
    );
    service.recordFailure(expiredKey);

    expect(service.retryAfterSeconds(expiredKey)).toBeNull();
  });

  it('caps retained buckets and evicts the oldest bucket when full', () => {
    const service = new AuthAttemptThrottleService(
      config({
        AUTH_THROTTLE_MAX_FAILURES: '2',
        AUTH_THROTTLE_MAX_BUCKETS: '2',
      }),
    );
    const firstKey = service.keyForUnknown('device-1', 'password', 'first');
    const secondKey = service.keyForUnknown('device-1', 'password', 'second');
    const thirdKey = service.keyForUnknown('device-1', 'password', 'third');

    service.recordFailure(firstKey);
    service.recordFailure(secondKey);
    service.recordFailure(thirdKey);
    service.recordFailure(firstKey);

    expect(service.retryAfterSeconds(firstKey)).toBeNull();
  });

  it('rejects invalid throttle configuration', () => {
    expect(
      () =>
        new AuthAttemptThrottleService(
          config({ AUTH_THROTTLE_MAX_FAILURES: '0' }),
        ),
    ).toThrow('AUTH_THROTTLE_MAX_FAILURES must be a positive integer');

    expect(
      () =>
        new AuthAttemptThrottleService(
          config({ AUTH_THROTTLE_MAX_BUCKETS: '0' }),
        ),
    ).toThrow('AUTH_THROTTLE_MAX_BUCKETS must be a positive integer');
  });
});
