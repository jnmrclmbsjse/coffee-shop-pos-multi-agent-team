import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrementOrderLine, removeOrderLine } from './api';

describe('order capture API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps an empty successful decrement response to a discarded order', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      decrementOrderLine('order/id', 'line/id'),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/orders/order%2Fid/lines/line%2Fid/decrement',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('maps an empty successful remove response to a discarded order', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(removeOrderLine('order/id', 'line/id')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/orders/order%2Fid/lines/line%2Fid',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });

  it('continues to parse a returned order after decrementing a larger line', async () => {
    const returnedOrder = { id: 'order-1', lines: [{ quantity: 1 }] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(returnedOrder), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(decrementOrderLine('order-1', 'line-1')).resolves.toEqual(
      returnedOrder,
    );
  });
});
