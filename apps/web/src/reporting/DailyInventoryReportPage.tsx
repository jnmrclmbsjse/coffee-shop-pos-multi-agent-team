import { useEffect, useState } from 'react';
import type { DailyInventoryReport } from '@coffee-shop/shared';
import { Link } from 'react-router-dom';
import { getDailyInventoryReport } from './api';
import {
  PackagingReconciliationTable,
  ReportingLoading,
  ReportingNotice,
  ReportTypeNavigation,
  RestockNeedsPanel,
} from './components';
import { formatBusinessDate, formatLocation, shopDate } from './format';

export function DailyInventoryReportPage() {
  const [requestedDate, setRequestedDate] = useState(() => shopDate());
  const [report, setReport] = useState<DailyInventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    document.title = 'Daily Inventory Report · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    let current = true;
    if (!requestedDate) {
      setLoading(false);
      setPageError('Choose a business date.');
      return () => {
        current = false;
      };
    }
    setLoading(true);
    setPageError('');

    void getDailyInventoryReport(requestedDate)
      .then((result) => {
        if (current) setReport(result);
      })
      .catch(() => {
        if (current) {
          setPageError(
            `Daily inventory data for ${formatBusinessDate(requestedDate)} could not be loaded. Try another date.`,
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [requestedDate]);

  const loadedDate = report?.businessDate ?? requestedDate;
  const location = formatLocation(report?.locationId ?? null);

  return (
    <main className="reporting-page daily-inventory-report-page">
      <ReportTypeNavigation />
      <header className="reporting-page-head">
        <div>
          <p className="reporting-context">
            Business date: {formatBusinessDate(loadedDate)}<br />
            Location: {location}
          </p>
          <h1>Daily inventory report</h1>
          <p>Reconcile packaging counts and review restock needs for one business day.</p>
        </div>
        <span className="read-only-label">Read-only</span>
      </header>

      <section className="report-filter daily-inventory-filter" aria-labelledby="business-date-title">
        <div className="report-filter-copy">
          <h2 id="business-date-title">Select report day</h2>
          <p>Choose one day. The report refreshes automatically.</p>
        </div>
        <label>
          <span>Business date</span>
          <input
            type="date"
            value={requestedDate}
            onChange={(event) => setRequestedDate(event.target.value)}
          />
        </label>
      </section>

      {pageError && <ReportingNotice>{pageError}</ReportingNotice>}
      {loading && !report && (
        <ReportingLoading label={`Loading ${formatBusinessDate(requestedDate)}…`} />
      )}
      {loading && report && (
        <div className="daily-inventory-loading-status" role="status" aria-live="polite">
          Loading {formatBusinessDate(requestedDate)} for {location}…
        </div>
      )}

      {report && (
        <div
          className={`reporting-content${loading ? ' reporting-refreshing' : ''}`}
          aria-busy={loading}
        >
          <p className="applied-range" aria-live="polite">
            <span>Showing</span>
            <strong>{formatBusinessDate(report.businessDate)} · {location}</strong>
          </p>

          {!report.hasInventoryInformation ? (
            <section className="report-panel" aria-labelledby="no-inventory-title">
              <div className="report-empty">
                <strong id="no-inventory-title">No inventory information for this day</strong>
                <span>
                  There are no reportable counts, movements, or completed-sale
                  packaging usage for {formatBusinessDate(report.businessDate)} at {location}.
                </span>
              </div>
              <div className="report-scope-footer">
                This report is read-only. To manage item configuration, use{' '}
                <Link to="/inventory">Inventory settings</Link>.
              </div>
            </section>
          ) : (
            <>
              <PackagingReconciliationTable
                rows={report.reconciliation}
                businessDate={report.businessDate}
                location={location}
              />
              <RestockNeedsPanel
                restock={report.restock}
                businessDate={report.businessDate}
                location={location}
              />
              <p className="report-read-only-note">
                This report is read-only. To manage item configuration, use{' '}
                <Link to="/inventory">Inventory settings</Link>.
              </p>
            </>
          )}
        </div>
      )}
    </main>
  );
}
