import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, readSession } from './api';

describe('readSession', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps an explicit unauthorized response to no session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(readSession()).resolves.toBeNull();
  });

  it('propagates a server failure instead of treating it as signed out', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(readSession()).rejects.toMatchObject({
      status: 503,
    } satisfies Partial<AuthenticationError>);
  });

  it('propagates a network failure instead of treating it as signed out', async () => {
    const failure = new TypeError('network unavailable');
    fetchMock.mockRejectedValue(failure);

    await expect(readSession()).rejects.toBe(failure);
  });
});
