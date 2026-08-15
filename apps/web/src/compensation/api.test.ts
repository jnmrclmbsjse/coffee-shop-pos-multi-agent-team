import { cents } from '@coffee-shop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CompensationApiError,
  createCompensationEntry,
  deleteCompensationEntry,
  listCompensationEntries,
} from './api';

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('compensation API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes optional list filters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, []));
    vi.stubGlobal('fetch', fetchMock);

    await listCompensationEntries({
      staffMemberId: 'staff/member',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/compensation/entries?staffMemberId=staff%2Fmember&from=2026-08-01&to=2026-08-31',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends only normalized integer-cent create fields', async () => {
    const returned = { id: 'entry-1' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(201, returned));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCompensationEntry({
      staffMemberId: 'staff-1',
      workDate: '2026-08-15',
      salaryCents: cents(7),
      commissionCents: cents(100),
    })).resolves.toEqual(returned);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/compensation/entries',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          staffMemberId: 'staff-1',
          workDate: '2026-08-15',
          salaryCents: 7,
          commissionCents: 100,
        }),
      }),
    );
  });

  it('preserves message arrays on conflicts and accepts an empty delete response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(409, { message: ['Duplicate staff member', 'Duplicate work date'] }))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCompensationEntry({
      staffMemberId: 'staff-1',
      workDate: '2026-08-15',
      salaryCents: cents(7),
      commissionCents: cents(100),
    })).rejects.toEqual(new CompensationApiError(409, ['Duplicate staff member', 'Duplicate work date']));
    await expect(deleteCompensationEntry('entry/id')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/compensation/entries/entry%2Fid',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });
});
