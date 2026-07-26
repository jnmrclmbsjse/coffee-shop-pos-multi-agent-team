import type {
  ReportingDashboard,
  SalesRangeReport,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ReportingApiError extends Error {
  constructor(readonly status: number) {
    super('Reporting request failed');
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    credentials: 'include',
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

export async function downloadReportCsv(
  from: string,
  to: string,
): Promise<void> {
  const response = await fetch(
    `${API_ORIGIN}/reporting/report.csv?${rangeQuery(from, to)}`,
    {
      credentials: 'include',
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
