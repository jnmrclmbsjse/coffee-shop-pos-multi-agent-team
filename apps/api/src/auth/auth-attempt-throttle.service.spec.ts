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

  it('rejects invalid throttle configuration', () => {
    expect(
      () =>
        new AuthAttemptThrottleService(
          config({ AUTH_THROTTLE_MAX_FAILURES: '0' }),
        ),
    ).toThrow('AUTH_THROTTLE_MAX_FAILURES must be a positive integer');
  });
});
