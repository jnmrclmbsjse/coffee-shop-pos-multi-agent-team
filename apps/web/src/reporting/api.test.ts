import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadReportCsv,
  getDailyInventoryReport,
  getDashboard,
  getOrderHistory,
  getOrderHistoryDetail,
  getReport,
} from './api';

describe('reporting API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses credentialed GET requests for reporting read models', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({
            summary: null,
            salesTrend: [],
            topProducts: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await getDashboard();
    await getReport('2026-07-13', '2026-07-26');
    await getDailyInventoryReport('2026-07-26');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/reporting/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/reporting/report?from=2026-07-13&to=2026-07-26',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3000/reporting/daily-inventory?date=2026-07-26',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('uses only credentialed GET requests for order history list and detail', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await getOrderHistory({
      status: 'Completed',
      paymentMethod: 'Split',
      search: '  Ana  ',
      sort: 'total',
      direction: 'desc',
      page: 2,
      pageSize: 25,
    });
    await getOrderHistoryDetail('f82df0bd-a75b-4e8d-9f93-54dc8bc24446');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/reporting/order-history?status=Completed&paymentMethod=Split&search=Ana&sort=total&direction=desc&page=2&pageSize=25',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/reporting/order-history/f82df0bd-a75b-4e8d-9f93-54dc8bc24446',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('downloads the API CSV with the range in its filename', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('Date,Status\\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        }),
      );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    await downloadReportCsv('2026-07-13', '2026-07-26');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/reporting/report.csv?from=2026-07-13&to=2026-07-26',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
