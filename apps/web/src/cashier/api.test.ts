import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CashierApiError,
  clearActiveCashier,
  getActiveCashier,
  listSelectableCashiers,
  selectActiveCashier,
} from './api';
import { setUnauthorizedHandler } from '../auth/session-fetch';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cashier API', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the staff session and device id for server-authoritative reads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, [
          { id: 'staff-1', displayName: 'Mara', requiresPin: false },
        ]),
      )
      .mockResolvedValueOnce(
        response(200, { cashier: { id: 'staff-1', displayName: 'Mara' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listSelectableCashiers()).resolves.toHaveLength(1);
    await expect(getActiveCashier('register / one')).resolves.toEqual({
      id: 'staff-1',
      displayName: 'Mara',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/staff/selectable',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/sales/active-cashier?deviceId=register+%2F+one',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends incomplete PINs to the server without changing the staff session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(200, { id: 'staff-1', displayName: 'Mara' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await selectActiveCashier('register-1', 'staff-1', '12');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sales/active-cashier',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          deviceId: 'register-1',
          staffMemberId: 'staff-1',
          pin: '12',
        }),
      }),
    );
  });

  it('preserves the API failure message and cooldown without redirecting', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response(429, {
        message: 'Unable to authorize cashier.',
        retryAfterSeconds: 9,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      selectActiveCashier('register-1', 'staff-1', '9999'),
    ).rejects.toEqual(
      new CashierApiError(429, 'Unable to authorize cashier.', 9),
    );
  });

  it('keeps a cashier PIN 401 local while reporting protected read 401s', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(401, { message: 'Unable to authorize cashier.' }),
      )
      .mockResolvedValueOnce(response(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      selectActiveCashier('register-1', 'staff-1', '9999'),
    ).rejects.toEqual(
      new CashierApiError(401, 'Unable to authorize cashier.'),
    );
    expect(onUnauthorized).not.toHaveBeenCalled();

    await expect(getActiveCashier('register-1')).rejects.toEqual(
      new CashierApiError(
        401,
        'Cashier selection could not be completed. Try again.',
      ),
    );
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('clears through the append-only server endpoint with no PIN', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(200, { cashier: null }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(clearActiveCashier('register-1')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sales/active-cashier',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ deviceId: 'register-1' }),
      }),
    );
  });
});
