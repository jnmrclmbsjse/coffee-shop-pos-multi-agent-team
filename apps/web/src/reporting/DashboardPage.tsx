import { useEffect, useState } from 'react';
import type {
  DashboardSalesTrend,
  ProductSales,
  ReportingDashboard,
} from '@coffee-shop/shared';
import {
  Metric,
  ReportingLoading,
  ReportingNotice,
  StatusBadge,
} from './components';
import { getDashboard } from './api';
import { formatBusinessDate, formatMoney, formatQuantity } from './format';

function SalesTrend({ trend }: { trend: DashboardSalesTrend[] }) {
  const maximum = Math.max(
    1,
    ...trend.map((day) => day.cashSalesCents + day.onlineSalesCents),
  );

  return (
    <section className="report-panel sales-trend-panel" aria-labelledby="trend-title">
      <header className="report-panel-head chart-head">
        <div>
          <h2 id="trend-title">Sales trend</h2>
          <p>Cash and online takings for trading days in the last 14 dates.</p>
        </div>
        <div className="chart-legend" aria-label="Sales trend legend">
          <span><i className="cash-swatch" />Cash</span>
          <span><i className="online-swatch" />Online</span>
        </div>
      </header>
      {trend.length === 0 ? (
        <p className="report-empty">No sales trend data yet.</p>
      ) : (
        <>
          <div className="sales-bars" aria-hidden="true">
            {trend.map((day) => {
              const cashHeight = (day.cashSalesCents / maximum) * 100;
              const onlineHeight = (day.onlineSalesCents / maximum) * 100;
              return (
                <div className="sales-bar-day" key={day.date}>
                  <div className="sales-bar-column">
                    <span
                      className="sales-bar-online"
                      style={{ height: `${onlineHeight}%` }}
                    />
                    <span
                      className="sales-bar-cash"
                      style={{ height: `${cashHeight}%` }}
                    />
                  </div>
                  <span>{formatBusinessDate(day.date, 'short').replace(/\D/g, '')}</span>
                </div>
              );
            })}
          </div>
          <details className="chart-data">
            <summary>Read sales values</summary>
            <div className="report-table-region">
              <table className="report-table" aria-label="Sales trend values">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="num">Cash</th>
                    <th scope="col" className="num">Online</th>
                    <th scope="col" className="num">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((day) => (
                    <tr key={day.date}>
                      <td>{formatBusinessDate(day.date, 'short')}</td>
                      <td className="num">{formatMoney(day.cashSalesCents)}</td>
                      <td className="num">{formatMoney(day.onlineSalesCents)}</td>
                      <td className="num">
                        {formatMoney(
                          day.cashSalesCents + day.onlineSalesCents,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function TopProducts({ products }: { products: ProductSales[] }) {
  const maximum = Math.max(1, ...products.map((product) => product.revenueCents));
  return (
    <section className="report-panel" aria-labelledby="top-products-title">
      <header className="report-panel-head">
        <div>
          <h2 id="top-products-title">Top base products</h2>
          <p>Revenue and quantity sold, with variants combined.</p>
        </div>
      </header>
      {products.length === 0 ? (
        <p className="report-empty">No sales in this range.</p>
      ) : (
        <ol className="product-bars">
          {products.map((product) => (
            <li key={product.productId}>
              <span className="product-bar-label">
                <strong>{product.productName}</strong>
                <small>{formatQuantity(product.quantitySold)} sold</small>
              </span>
              <strong className="num">{formatMoney(product.revenueCents)}</strong>
              <span className="product-bar-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(0, product.revenueCents / maximum) * 100}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<ReportingDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Dashboard · UCM Coffee Studio';
    let active = true;
    void getDashboard()
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch(() => {
        if (active) {
          setError('Dashboard data could not be loaded. Refresh the page to try again.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="reporting-page">
      <header className="reporting-page-head">
        <div>
          <p className="reporting-context">Business overview</p>
          <h1>Dashboard</h1>
          <p>Review the current trading day and recent sales performance.</p>
        </div>
        <span className="read-only-label">Read-only</span>
      </header>

      {error && <ReportingNotice>{error}</ReportingNotice>}
      {!dashboard && !error && <ReportingLoading label="Loading dashboard…" />}

      {dashboard && (
        <div className="reporting-content">
          {dashboard.summary ? (
            <section className="trading-summary" aria-labelledby="summary-title">
              <header>
                <div>
                  <div className="summary-title">
                    <h2 id="summary-title">
                      {dashboard.summary.status === 'open'
                        ? 'Current trading day'
                        : 'Latest closed trading day'}
                    </h2>
                    <StatusBadge status={dashboard.summary.status} />
                  </div>
                  <p>
                    Business date{' '}
                    <strong>{formatBusinessDate(dashboard.summary.date)}</strong>
                  </p>
                </div>
              </header>
              <dl className="summary-metrics">
                <Metric
                  label="Completed orders"
                  value={formatQuantity(dashboard.summary.orderCount)}
                  note="Paid orders"
                />
                <Metric
                  label="Gross sales"
                  value={formatMoney(dashboard.summary.grossSalesCents)}
                  note="Cash and online"
                />
                <Metric
                  label="Cash sales"
                  value={formatMoney(dashboard.summary.cashSalesCents)}
                />
                <Metric
                  label="Online sales"
                  value={formatMoney(dashboard.summary.onlineSalesCents)}
                />
                <Metric
                  label="Average order value"
                  value={formatMoney(dashboard.summary.averageOrderValueCents)}
                />
                <Metric
                  label="Cash tips"
                  value={formatMoney(dashboard.summary.cashTipsCents)}
                />
              </dl>
            </section>
          ) : (
            <section className="report-panel">
              <div className="report-empty">
                <strong>No trading day data yet.</strong>
                <span>
                  The dashboard will show a summary after the first trading day
                  is opened.
                </span>
              </div>
            </section>
          )}
          <div className="dashboard-panels">
            <SalesTrend trend={dashboard.salesTrend} />
            <TopProducts products={dashboard.topProducts} />
          </div>
        </div>
      )}
    </main>
  );
}
