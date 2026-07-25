import { Module } from '@nestjs/common';

/**
 * Cash & Trading Day bounded context.
 *
 * Issue #84 establishes its schema and shared arithmetic only. Capture and
 * reporting providers are deliberately deferred to their owning stories.
 */
@Module({})
export class TradingDayModule {}
