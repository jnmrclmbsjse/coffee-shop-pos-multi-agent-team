import type {
  DailyInventoryReport,
  DailyReconciliation,
  PackagingReconciliationRow,
  ProductSales,
  RestockStatusRow,
  SalesReportTotals,
} from '@coffee-shop/shared';
import { CountMethod } from '@coffee-shop/shared';
import { NavLink } from 'react-router-dom';
import {
  formatBusinessDate,
  formatCount,
  formatMoney,
  formatOptionalCount,
  formatQuantity,
  formatRestockStatus,
  formatSignedCount,
  formatStockLevel,
  formatSubmissionTime,
} from './format';

export function ReportTypeNavigation() {
  return (
    <nav className="page-context-switch" aria-label="Report type">
      <NavLink end to="/reports">Sales</NavLink>
      <NavLink to="/reports/daily-inventory">Daily inventory</NavLink>
    </nav>
  );
}

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
                  <th scope="col" className="num">Cash in</th>
                  <th scope="col" className="num">Cash out</th>
                  <th scope="col" className="num">Cash expenses</th>
                  <th scope="col" className="num">Outstanding change</th>
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
                    <td className="num">{formatMoney(row.cashInCents)}</td>
                    <td className="num">{formatMoney(row.cashOutCents)}</td>
                    <td className="num">
                      {formatMoney(row.cashExpensesCents)}
                    </td>
                    <td className="num">
                      {formatMoney(row.outstandingChangeCents)}
                    </td>
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

function UnavailableCount({ reason }: { reason: string }) {
  return (
    <span
      className="unavailable"
      aria-label={`Unavailable: ${reason}. No count was taken; this is not a count of zero.`}
    >
      Unavailable
    </span>
  );
}

function OptionalCount({
  value,
  reason,
}: {
  value: number | null;
  reason: string;
}) {
  return value === null ? (
    <UnavailableCount reason={reason} />
  ) : (
    <span className="num">{formatOptionalCount(value)}</span>
  );
}

function PackagingVariance({ row }: { row: PackagingReconciliationRow }) {
  if (row.varianceQty === null) {
    return (
      <UnavailableCount reason="variance cannot be calculated without both opening and closing counts" />
    );
  }

  const state = row.varianceQty > 0
    ? { label: 'Surplus', className: 'variance-over' }
    : row.varianceQty < 0
      ? { label: 'Short', className: 'variance-short' }
      : { label: 'Even', className: 'variance-even' };

  return (
    <span className={`variance ${state.className}`}>
      <strong className="num">{formatSignedCount(row.varianceQty)}</strong>
      <small>{state.label}</small>
    </span>
  );
}

export function PackagingReconciliationTable({
  rows,
  businessDate,
  location,
}: {
  rows: PackagingReconciliationRow[];
  businessDate: string;
  location: string;
}) {
  return (
    <section className="report-panel" aria-labelledby="packaging-reconciliation-title">
      <header className="report-panel-head">
        <div>
          <h2 id="packaging-reconciliation-title">Cup and lid reconciliation</h2>
          <p>
            Physical item counts for the selected business day. Variance equals
            actual closing minus expected closing.
          </p>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="report-empty">
          <strong>No cup or lid activity</strong>
          <span>No reconciled packaging items participated on this day.</span>
        </div>
      ) : (
        <>
          <p className="report-scroll-hint">
            Swipe or scroll horizontally to review all columns.
          </p>
          <div
            className="report-table-region"
            tabIndex={0}
            role="region"
            aria-label="Cup and lid reconciliation table. Scroll horizontally for more columns."
          >
            <table className="report-table packaging-report-table">
              <caption>
                Cup and lid counts for {formatBusinessDate(businessDate)} at {location}.
                All values are physical item counts.
              </caption>
              <thead>
                <tr>
                  <th rowSpan={2} scope="col">Item</th>
                  <th colSpan={4} scope="colgroup">
                    Derivation: opening + deliveries - wastage - used
                  </th>
                  <th className="outcome-start" colSpan={3} scope="colgroup">Outcome</th>
                </tr>
                <tr>
                  <th scope="col" className="num">Opening</th>
                  <th scope="col" className="num">Deliveries</th>
                  <th scope="col" className="num">Wastage</th>
                  <th scope="col" className="num">Used by completed sales</th>
                  <th scope="col" className="num outcome-start">Expected closing</th>
                  <th scope="col" className="num outcome-cell">Actual closing</th>
                  <th scope="col" className="num outcome-cell">Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.inventoryItemId}>
                    <th scope="row">{row.itemName}</th>
                    <td className="num">
                      <OptionalCount
                        value={row.openingQty}
                        reason="opening count not submitted"
                      />
                    </td>
                    <td className="num">{formatCount(row.deliveriesQty)}</td>
                    <td className="num">{formatCount(row.wastageQty)}</td>
                    <td className="num">{formatCount(row.soldQty)}</td>
                    <td className="num outcome-start">
                      <OptionalCount
                        value={row.expectedQty}
                        reason="expected closing cannot be calculated without an opening count"
                      />
                    </td>
                    <td className="num outcome-cell">
                      <OptionalCount
                        value={row.actualQty}
                        reason="closing count not submitted"
                      />
                    </td>
                    <td className="num outcome-cell"><PackagingVariance row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="report-footnote">
            <strong>Unavailable</strong> means no count was taken. It is not the
            same as a count of zero. Expected closing and variance are also
            Unavailable when a required count is missing.
          </p>
        </>
      )}
    </section>
  );
}

function RestockCount({ row }: { row: RestockStatusRow }) {
  if (row.countMethod === CountMethod.LEVEL) {
    return <>{formatStockLevel(row.level)}</>;
  }
  return row.quantity === null ? (
    <UnavailableCount reason="counted quantity not submitted" />
  ) : (
    <span className="num">{formatCount(row.quantity)}</span>
  );
}

function RestockTarget({ row }: { row: RestockStatusRow }) {
  if (row.countMethod === CountMethod.LEVEL || row.par === null) {
    return (
      <span className="unavailable" aria-label="Unavailable: no par target is configured for this item and day type.">
        Unavailable
      </span>
    );
  }
  return <span className="num">{formatCount(row.par)}</span>;
}

export function RestockNeedsPanel({
  restock,
  businessDate,
  location,
}: {
  restock: DailyInventoryReport['restock'];
  businessDate: string;
  location: string;
}) {
  const phase = restock.selectedPhase === 'close' ? 'closing' : 'opening';
  const submittedAt = restock.selectedCountRecordedAt
    ? formatSubmissionTime(restock.selectedCountRecordedAt)
    : '';

  return (
    <section className="report-panel" aria-labelledby="restock-needs-title">
      <header className="report-panel-head">
        <div>
          <h2 id="restock-needs-title">Restock needs</h2>
          <p>Read-only priorities for the selected business day.</p>
        </div>
      </header>
      {!restock.hasCount ? (
        <div className="report-empty">
          <strong>No count submitted for this day</strong>
          <span>
            No opening or closing count was submitted for{' '}
            {formatBusinessDate(businessDate)} at {location}, so a restock list
            cannot be prepared.
          </span>
        </div>
      ) : (
        <>
          <p className="restock-copy">
            This list uses the {phase} count submitted on {submittedAt}.
          </p>
          <p className="restock-copy restock-copy-secondary">
            Only Urgent, Low, and Below par items are shown. Items with Enough
            stock do not appear.
          </p>
          {restock.rows.length === 0 ? (
            <div className="report-empty report-empty-positive">
              <strong>Nothing needs restocking</strong>
              <span>
                The {phase} count for {formatBusinessDate(businessDate)} at{' '}
                {location} has no Urgent, Low, or Below par items.
              </span>
            </div>
          ) : (
            <>
              <p className="report-scroll-hint">
                Swipe or scroll horizontally to review all columns.
              </p>
              <div
                className="report-table-region"
                tabIndex={0}
                role="region"
                aria-label="Restock needs table. Scroll horizontally for more columns."
              >
                <table className="report-table restock-report-table">
                  <caption>
                    Items below their restock threshold, ordered by status,
                    Critical setting, then item name.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">Counted amount</th>
                      <th scope="col" className="num">Target (par)</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restock.rows.map((row) => (
                      <tr key={row.inventoryItemId}>
                        <th scope="row">
                          {row.itemName}
                          {row.critical && <span className="critical-marker">Critical</span>}
                        </th>
                        <td className="num"><RestockCount row={row} /></td>
                        <td className="num"><RestockTarget row={row} /></td>
                        <td>
                          <span
                            className={`staff-restock-status ${row.status.toLowerCase().replace('_', '-')}`}
                          >
                            {formatRestockStatus(row.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
