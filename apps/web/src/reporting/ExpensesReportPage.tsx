import { useEffect, useState, type FormEvent } from 'react';
import type { ExpenseReport } from '@coffee-shop/shared';
import {
  DateRangeLabel,
  ReportTypeNavigation,
  ReportingLoading,
  ReportingNotice,
  StatusBadge,
} from './components';
import { MoneyValue } from './MoneyValue';
import { getExpenseReport } from './api';
import { formatTimestamp } from './orderHistoryFormat';
import {
  formatBusinessDate,
  rangeError,
  reportingDefaultRange,
} from './format';

function categoryLabel(category: string | null): string {
  return category ?? 'Uncategorized';
}

export function ExpensesReportPage() {
  const [initialRange] = useState(reportingDefaultRange);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const validationMessage = rangeError(from, to);

  async function loadReport(nextFrom: string, nextTo: string) {
    setLoading(true);
    setPageError('');
    try {
      setReport(await getExpenseReport(nextFrom, nextTo));
    } catch {
      setPageError('Expense data could not be loaded. Try the range again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = 'Expenses Report · UCM Coffee Studio';
    void loadReport(initialRange.from, initialRange.to);
  }, []);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validationMessage) void loadReport(from, to);
  }

  return (
    <main className="reporting-page">
      <ReportTypeNavigation />
      <header className="reporting-page-head">
        <div>
          <p className="reporting-context">Cash expense review</p>
          <h1>Expenses</h1>
          <p>Review effective drawer expenses by category and entry.</p>
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
        </form>
        {validationMessage && (
          <p className="report-range-error" id="range-error" role="alert">
            {validationMessage}
          </p>
        )}
      </section>

      {pageError && <ReportingNotice>{pageError}</ReportingNotice>}
      {loading && !report && <ReportingLoading label="Loading expenses…" />}

      {report && (
        <div className="reporting-content" aria-busy={loading}>
          <div className="applied-range">
            <span>Showing</span>
            <strong>
              <DateRangeLabel from={report.from} to={report.to} />
            </strong>
            {loading && <span>Updating…</span>}
          </div>

          {report.items.length === 0 ? (
            <section className="report-panel" aria-labelledby="expenses-empty-title">
              <h2 id="expenses-empty-title">No expenses in this range</h2>
              <p className="report-empty">
                Choose another range to review recorded expenses.
              </p>
            </section>
          ) : (
            <>
              <dl className="report-totals" aria-label="Expense totals">
                <div className="report-metric">
                  <dt>Total expenses</dt>
                  <dd><MoneyValue cents={report.totalCents} /></dd>
                </div>
              </dl>

              <section className="report-panel" aria-labelledby="expense-category-title">
                <header className="report-panel-head">
                  <div>
                    <h2 id="expense-category-title">By category</h2>
                    <p>Largest expense total first.</p>
                  </div>
                </header>
                <div className="report-table-region">
                  <table className="report-table" aria-label="Expenses by category">
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col" className="num">Entries</th>
                        <th scope="col" className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byCategory.map((group) => (
                        <tr key={group.category ?? '__uncategorized'}>
                          <td>{categoryLabel(group.category)}</td>
                          <td className="num">{group.entryCount}</td>
                          <td className="num"><MoneyValue cents={group.totalCents} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="report-panel" aria-labelledby="expense-items-title">
                <header className="report-panel-head">
                  <div>
                    <h2 id="expense-items-title">Expense entries</h2>
                    <p>Newest business date and recording time first.</p>
                  </div>
                </header>
                <div className="report-table-region" tabIndex={0}>
                  <table className="report-table" aria-label="Expense entries">
                    <thead>
                      <tr>
                        <th scope="col">Business date</th>
                        <th scope="col">Recorded</th>
                        <th scope="col">Category</th>
                        <th scope="col">Description</th>
                        <th scope="col">Recorded by</th>
                        <th scope="col" className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {formatBusinessDate(item.businessDate, 'short')}{' '}
                            <StatusBadge status={item.dayStatus} />
                          </td>
                          <td>{formatTimestamp(item.recordedAt)}</td>
                          <td>{categoryLabel(item.category)}</td>
                          <td>
                            {item.description}
                            {item.amended && (
                              <small className="order-line-note">Amended</small>
                            )}
                          </td>
                          <td>{item.recordedByName ?? '—'}</td>
                          <td className="num"><MoneyValue cents={item.amountCents} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
