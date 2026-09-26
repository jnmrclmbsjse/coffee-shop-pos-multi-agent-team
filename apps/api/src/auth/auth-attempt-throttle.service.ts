import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AttemptBucket {
  failures: number;
  blockedUntil: number | null;
  expiresAt: number;
}

function positiveInteger(
  config: ConfigService,
  name: string,
  fallback: number,
): number {
  const configured = config.get<string>(name);
  if (configured === undefined) {
    return fallback;
  }

  const value = Number(configured);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

@Injectable()
export class AuthAttemptThrottleService {
  private readonly buckets = new Map<string, AttemptBucket>();
  private readonly maxFailures: number;
  private readonly cooldownMs: number;
  private readonly maxBuckets: number;

  constructor(config: ConfigService) {
    this.maxFailures = positiveInteger(
      config,
      'AUTH_THROTTLE_MAX_FAILURES',
      5,
    );
    this.cooldownMs =
      positiveInteger(config, 'AUTH_THROTTLE_COOLDOWN_SECONDS', 30) * 1000;
    this.maxBuckets = positiveInteger(
      config,
      'AUTH_THROTTLE_MAX_BUCKETS',
      10_000,
    );
  }

  keyForUser(deviceId: string, userId: string): string {
    return `device:${deviceId.trim()}|user:${userId}`;
  }

  keyForUnknown(
    deviceId: string,
    method: 'password' | 'pin',
    identifier: string,
  ): string {
    return `device:${deviceId.trim()}|${method}:${identifier.trim().toLocaleLowerCase('en-US')}`;
  }

  retryAfterSeconds(key: string): number | null {
    this.evictExpiredBuckets();
    const bucket = this.buckets.get(key);
    if (!bucket?.blockedUntil) {
      return null;
    }

    const remainingMs = bucket.blockedUntil - Date.now();
    if (remainingMs <= 0) {
      return null;
    }

    return Math.ceil(remainingMs / 1000);
  }

  recordFailure(key: string): void {
    if (this.retryAfterSeconds(key) !== null) {
      return;
    }

    const bucket = this.buckets.get(key) ?? {
      failures: 0,
      blockedUntil: null,
      expiresAt: Date.now() + this.cooldownMs,
    };
    bucket.failures += 1;
    bucket.expiresAt = Date.now() + this.cooldownMs;
    if (bucket.failures >= this.maxFailures) {
      bucket.blockedUntil = Date.now() + this.cooldownMs;
    }
    if (!this.buckets.has(key)) {
      this.makeRoomForBucket();
    }
    this.buckets.set(key, bucket);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private evictExpiredBuckets(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  private makeRoomForBucket(): void {
    while (this.buckets.size >= this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.buckets.delete(oldestKey);
    }
  }
}
