import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionFetch, setUnauthorizedHandler } from './session-fetch';

describe('sessionFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it('includes browser credentials and reports a protected 401 centrally', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await sessionFetch('/catalog/products', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/catalog/products',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('allows authentication endpoints to keep 401 handling local', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await sessionFetch(
      '/auth/login',
      { method: 'POST' },
      { handleUnauthorized: false },
    );

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
