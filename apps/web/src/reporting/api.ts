import type {
  OrderHistoryDetail,
  OrderHistoryList,
  OrderHistoryListQuery,
  ReportingDashboard,
  SalesRangeReport,
} from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';

export class ReportingApiError extends Error {
  constructor(readonly status: number) {
    super('Reporting request failed');
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await sessionFetch(path, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new ReportingApiError(response.status);
  }

  return (await response.json()) as T;
}

function rangeQuery(from: string, to: string): string {
  const params = new URLSearchParams({ from, to });
  return params.toString();
}

export function getDashboard(): Promise<ReportingDashboard> {
  return request('/reporting/dashboard');
}

export function getReport(from: string, to: string): Promise<SalesRangeReport> {
  return request(`/reporting/report?${rangeQuery(from, to)}`);
}

export function getOrderHistory(
  query: OrderHistoryListQuery,
): Promise<OrderHistoryList> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.paymentMethod) {
    params.set('paymentMethod', query.paymentMethod);
  }
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const queryString = params.toString();
  return request(
    `/reporting/order-history${queryString ? `?${queryString}` : ''}`,
  );
}

export function getOrderHistoryDetail(
  id: string,
): Promise<OrderHistoryDetail> {
  return request(`/reporting/order-history/${encodeURIComponent(id)}`);
}

export async function downloadReportCsv(
  from: string,
  to: string,
): Promise<void> {
  const response = await sessionFetch(
    `/reporting/report.csv?${rangeQuery(from, to)}`,
    {
      headers: { Accept: 'text/csv' },
    },
  );

  if (!response.ok) {
    throw new ReportingApiError(response.status);
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `ucm-report-${from}_to_${to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
