import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { Response } from 'express';
import { of } from 'rxjs';
import type { AuthenticatedRequest } from './auth.types';
import { NoStoreInterceptor } from './no-store.interceptor';

function contextFor(
  request: AuthenticatedRequest,
  response: Pick<Response, 'setHeader'>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('NoStoreInterceptor', () => {
  const interceptor = new NoStoreInterceptor();
  const handle = jest.fn(() => of('response'));
  const next = { handle } as CallHandler;
  const setHeader = jest.fn();
  const response = { setHeader };

  beforeEach(() => {
    handle.mockClear();
    setHeader.mockClear();
  });

  it('prevents caching when a guard authenticated the request', () => {
    const result = interceptor.intercept(
      contextFor(
        {
          headers: {},
          user: {
            id: 'user-id',
            username: 'admin',
            role: Role.ADMIN,
          },
        },
        response,
      ),
      next,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('does not change cache headers on public responses', () => {
    interceptor.intercept(contextFor({ headers: {} }, response), next);

    expect(setHeader).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
