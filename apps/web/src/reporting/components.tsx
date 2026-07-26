import type {
  DailyReconciliation,
  ProductSales,
  SalesReportTotals,
} from '@coffee-shop/shared';
import { formatBusinessDate, formatMoney, formatQuantity } from './format';

export function ReportingNotice({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="reporting-notice" role="alert">
      <strong>{children}</strong>
    </div>
  );
}

export function ReportingLoading({ label }: { label: string }) {
  return (
    <div className="reporting-loading" role="status">
      <span className="spinner spinner-dark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: 'open' | 'closed' }) {
  return (
    <span className={`report-status report-status-${status}`}>
      {status === 'open' ? 'Open' : 'Closed'}
    </span>
  );
}

export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="report-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <span>{note}</span>}
    </div>
  );
}

export function ReportTotals({ totals }: { totals: SalesReportTotals }) {
  return (
    <dl className="report-totals" aria-label="Report totals">
      <Metric label="Gross sales" value={formatMoney(totals.grossSalesCents)} />
      <Metric label="Cash sales" value={formatMoney(totals.cashSalesCents)} />
      <Metric
        label="Online sales"
        value={formatMoney(totals.onlineSalesCents)}
      />
      <Metric label="Cash tips" value={formatMoney(totals.tipsCents)} />
    </dl>
  );
}

function Variance({ value }: { value: number | null }) {
  if (value === null) {
    return <span aria-label="Variance not available">—</span>;
  }
  if (value === 0) {
    return <span className="variance variance-even">{formatMoney(value)}</span>;
  }
  const state = value > 0 ? 'Over' : 'Short';
  return (
    <span
      className={`variance ${value > 0 ? 'variance-over' : 'variance-short'}`}
    >
      <small>{state}</small>
      {formatMoney(value)}
    </span>
  );
}

export function ReconciliationTable({
  rows,
}: {
  rows: DailyReconciliation[];
}) {
  return (
    <section className="report-panel" aria-labelledby="reconciliation-title">
      <header className="report-panel-head">
        <div>
          <h2 id="reconciliation-title">Daily reconciliation</h2>
          <p>Trading days are ordered from oldest to newest.</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="report-empty">No days in this range.</p>
      ) : (
        <>
          <p className="report-scroll-hint">
            Scroll horizontally to inspect all reconciliation columns.
          </p>
          <div
            className="report-table-region"
            tabIndex={0}
            aria-label="Daily reconciliation table, horizontally scrollable"
          >
            <table
              className="report-table reconciliation-table"
              aria-label="Daily reconciliation"
            >
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Cash sales</th>
                  <th scope="col" className="num">Online sales</th>
                  <th scope="col" className="num">Gross</th>
                  <th scope="col" className="num">Tips</th>
                  <th scope="col" className="num">Expected cash</th>
                  <th scope="col" className="num">Actual cash</th>
                  <th scope="col" className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date}>
                    <td className="num">{row.date}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="num">{formatMoney(row.cashSalesCents)}</td>
                    <td className="num">{formatMoney(row.onlineSalesCents)}</td>
                    <td className="num">{formatMoney(row.grossSalesCents)}</td>
                    <td className="num">{formatMoney(row.tipsCents)}</td>
                    <td className="num">{formatMoney(row.expectedCashCents)}</td>
                    <td className="num">
                      {row.actualCashCents === null ? (
                        <span aria-label="Actual cash not recorded">—</span>
                      ) : (
                        formatMoney(row.actualCashCents)
                      )}
                    </td>
                    <td className="num">
                      <Variance value={row.varianceCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function ProductSalesTable({ products }: { products: ProductSales[] }) {
  return (
    <section className="report-panel" aria-labelledby="product-sales-title">
      <header className="report-panel-head">
        <div>
          <h2 id="product-sales-title">Product sales</h2>
          <p>Base products, with all variants combined.</p>
        </div>
      </header>
      {products.length === 0 ? (
        <p className="report-empty">No sales in this range.</p>
      ) : (
        <div className="report-table-region">
          <table
            className="report-table product-sales-table"
            aria-label="Product sales"
          >
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">Qty sold</th>
                <th scope="col" className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.productId}>
                  <td>{product.productName}</td>
                  <td className="num">{formatQuantity(product.quantitySold)}</td>
                  <td className="num">{formatMoney(product.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function DateRangeLabel({ from, to }: { from: string; to: string }) {
  return (
    <span>
      {formatBusinessDate(from, 'short')} to {formatBusinessDate(to, 'short')}
    </span>
  );
}
