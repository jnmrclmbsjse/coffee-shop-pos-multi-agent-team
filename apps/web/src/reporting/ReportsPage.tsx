import { useEffect, useState, type FormEvent } from 'react';
import type { SalesRangeReport } from '@coffee-shop/shared';
import {
  DateRangeLabel,
  ProductSalesTable,
  ReconciliationTable,
  ReportTotals,
  ReportingLoading,
  ReportingNotice,
} from './components';
import { downloadReportCsv, getReport } from './api';
import { rangeError, reportingDefaultRange } from './format';

export function ReportsPage() {
  const [initialRange] = useState(reportingDefaultRange);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [report, setReport] = useState<SalesRangeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [exporting, setExporting] = useState(false);
  const validationMessage = rangeError(from, to);

  async function loadReport(nextFrom: string, nextTo: string) {
    setLoading(true);
    setPageError('');
    try {
      setReport(await getReport(nextFrom, nextTo));
    } catch {
      setPageError('Report data could not be loaded. Try the range again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = 'Reports · UCM Coffee Studio';
    void loadReport(initialRange.from, initialRange.to);
  }, []);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validationMessage) {
      void loadReport(from, to);
    }
  }

  async function exportCsv() {
    if (validationMessage || exporting) return;
    setExporting(true);
    setPageError('');
    try {
      await downloadReportCsv(from, to);
    } catch {
      setPageError('The CSV could not be downloaded. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="reporting-page">
      <header className="reporting-page-head">
        <div>
          <p className="reporting-context">Sales and cash review</p>
          <h1>Reports</h1>
          <p>Review a date range, reconcile trading days, and export the results.</p>
        </div>
        <span className="read-only-label">Read-only</span>
      </header>

      <section className="report-filter" aria-labelledby="range-title">
        <div className="report-filter-copy">
          <h2 id="range-title">Report range</h2>
          <p>Both boundary dates are included.</p>
        </div>
        <form noValidate onSubmit={applyRange}>
          <label>
            <span>From</span>
            <input
              type="date"
              value={from}
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={validationMessage ? 'range-error' : undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={to}
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={validationMessage ? 'range-error' : undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            className="report-button report-button-primary"
            type="submit"
            disabled={Boolean(validationMessage) || loading}
          >
            Apply range
          </button>
          <button
            className="report-button"
            type="button"
            disabled={Boolean(validationMessage) || exporting}
            onClick={() => void exportCsv()}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </form>
        {validationMessage && (
          <p className="report-range-error" id="range-error" role="alert">
            {validationMessage}
          </p>
        )}
      </section>

      {pageError && <ReportingNotice>{pageError}</ReportingNotice>}
      {loading && !report && <ReportingLoading label="Loading report…" />}

      {report && (
        <div className="reporting-content" aria-busy={loading}>
          <div className="applied-range">
            <span>Showing</span>
            <strong><DateRangeLabel from={report.from} to={report.to} /></strong>
            {loading && <span>Updating…</span>}
          </div>
          <ReportTotals totals={report.totals} />
          <ReconciliationTable rows={report.dailyReconciliation} />
          <ProductSalesTable products={report.topProducts} />
        </div>
      )}
    </main>
  );
}
