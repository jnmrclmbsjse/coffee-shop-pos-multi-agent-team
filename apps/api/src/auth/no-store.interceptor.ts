import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    if (request.user) {
      http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    }

    return next.handle();
  }
}
