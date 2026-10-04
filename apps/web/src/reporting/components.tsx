import type {
  DailyInventoryReport,
  DailyReconciliation,
  PackagingReconciliationRow,
  ProductSales,
  RestockStatusRow,
  SalesReportTotals,
} from '@coffee-shop/shared';
import { useMemo, useRef, useState } from 'react';
import { addMoney, CountMethod } from '@coffee-shop/shared';
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
      <NavLink to="/reports/expenses">Expenses</NavLink>
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
  page,
  onPageChange,
}: {
  rows: DailyReconciliation[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(firstIndex, firstIndex + pageSize);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);

  function changePage(nextPage: number) {
    onPageChange(nextPage);
    if (nextPage === 1 || nextPage === totalPages) {
      paginationStatusRef.current?.focus();
    }
  }

  return (
    <section className="report-panel" aria-labelledby="reconciliation-title">
      <header className="report-panel-head">
        <div>
          <h2 id="reconciliation-title">Daily reconciliation</h2>
          <p>
            Trading days are ordered from newest to oldest. The CSV export
            keeps its original oldest-to-newest order.
          </p>
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
                  <th scope="col" className="num">Cash float</th>
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
                {visibleRows.map((row) => (
                  <tr key={row.tradingDayId}>
                    <td className="num">{row.date}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="num">{formatMoney(row.cashSalesCents)}</td>
                    <td className="num">{formatMoney(row.onlineSalesCents)}</td>
                    <td className="num">{formatMoney(row.grossSalesCents)}</td>
                    <td className="num">{formatMoney(row.tipsCents)}</td>
                    <td className="num">
                      {formatMoney(row.openingFloatCents)}
                    </td>
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
          {totalPages > 1 && (
            <nav
              className="order-pagination report-pagination"
              aria-label="Daily reconciliation pages"
            >
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => changePage(currentPage - 1)}
              >
                Previous
              </button>
              <p
                ref={paginationStatusRef}
                className="report-pagination-status"
                role="status"
                tabIndex={-1}
              >
                Page {currentPage} of {totalPages} · Trading days{' '}
                {firstIndex + 1}–{Math.min(firstIndex + pageSize, rows.length)} of{' '}
                {rows.length}
              </p>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => changePage(currentPage + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

type ProductSalesSort = 'quantity' | 'cups' | 'revenue';

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function ProductSalesSortHeader({
  label,
  sort,
  activeSort,
  onSort,
}: {
  label: string;
  sort: ProductSalesSort;
  activeSort: ProductSalesSort;
  onSort: (sort: ProductSalesSort) => void;
}) {
  const active = sort === activeSort;
  return (
    <th
      scope="col"
      className="num"
      aria-sort={active ? 'descending' : 'none'}
    >
      <button
        className="order-sort order-sort-numeric"
        type="button"
        aria-label={`${label}, ${active ? 'sorted descending' : 'not sorted'}`}
        onClick={() => onSort(sort)}
      >
        {label}
        <span aria-hidden="true">{active ? '↓' : ''}</span>
      </button>
    </th>
  );
}

export function ProductSalesTable({
  products,
  scope,
  allTimeLoading,
  allTimeError,
  onScopeChange,
}: {
  products: ProductSales[];
  scope: 'range' | 'allTime';
  allTimeLoading: boolean;
  allTimeError: string;
  onScopeChange: (scope: 'range' | 'allTime') => void;
}) {
  const [sort, setSort] = useState<ProductSalesSort>('revenue');
  const allTime = scope === 'allTime';
  const sortedProducts = useMemo(
    () =>
      [...products].sort((left, right) => {
        const valueDifference =
          sort === 'revenue'
            ? right.revenueCents - left.revenueCents
            : sort === 'cups'
              ? right.cupsSold - left.cupsSold
              : right.quantitySold - left.quantitySold;
        return (
          valueDifference ||
          compareText(left.productName, right.productName) ||
          compareText(left.productId, right.productId)
        );
      }),
    [products, sort],
  );
  const totals = useMemo(
    () => ({
      quantitySold: products.reduce(
        (total, product) => total + product.quantitySold,
        0,
      ),
      cupsSold: products.reduce(
        (total, product) => total + product.cupsSold,
        0,
      ),
      revenueCents: addMoney(...products.map((product) => product.revenueCents)),
    }),
    [products],
  );

  return (
    <section className="report-panel" aria-labelledby="product-sales-title">
      <header className="report-panel-head">
        <div>
          <h2 id="product-sales-title">Product sales</h2>
          <p>Base products, with all variants combined.</p>
        </div>
        {allTime && (
          <span className="state-badge promotion">
            <span aria-hidden="true" />
            All time
          </span>
        )}
      </header>
      <p
        className={`product-sales-scope${allTime ? ' is-all-time' : ''}`}
        role="status"
      >
        {allTime
          ? 'Showing all time — every recorded business day. The totals, Daily reconciliation and the CSV export still cover the selected report range.'
          : 'Showing the selected report range.'}
      </p>
      <div className="restock-scope-toggle">
        <label htmlFor="product-sales-all-time">
          <input
            id="product-sales-all-time"
            type="checkbox"
            checked={allTime}
            onChange={(event) =>
              onScopeChange(event.target.checked ? 'allTime' : 'range')
            }
          />
          <span>Show all time</span>
        </label>
      </div>
      {allTimeLoading ? (
        <ReportingLoading label="Loading all-time product sales…" />
      ) : allTimeError ? (
        <ReportingNotice>{allTimeError}</ReportingNotice>
      ) : sortedProducts.length === 0 ? (
        <p className="report-empty">
          {allTime
            ? 'No product sales have been recorded yet.'
            : 'No sales in this range.'}
        </p>
      ) : (
        <div className="report-table-region">
          <table
            className="report-table product-sales-table"
            aria-label="Product sales"
          >
            <thead>
              <tr>
                <th scope="col">Product</th>
                <ProductSalesSortHeader
                  label="Qty sold"
                  sort="quantity"
                  activeSort={sort}
                  onSort={setSort}
                />
                <ProductSalesSortHeader
                  label="Cups"
                  sort="cups"
                  activeSort={sort}
                  onSort={setSort}
                />
                <ProductSalesSortHeader
                  label="Revenue"
                  sort="revenue"
                  activeSort={sort}
                  onSort={setSort}
                />
              </tr>
            </thead>
            <tbody>
              {sortedProducts.map((product) => (
                <tr key={product.productId}>
                  <td>{product.productName}</td>
                  <td className="num">{formatQuantity(product.quantitySold)}</td>
                  <td className="num">{formatQuantity(product.cupsSold)}</td>
                  <td className="num">{formatMoney(product.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{formatQuantity(totals.quantitySold)}</td>
                <td className="num">{formatQuantity(totals.cupsSold)}</td>
                <td className="num">{formatMoney(totals.revenueCents)}</td>
              </tr>
            </tfoot>
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
    return <span className="restock-level">{formatStockLevel(row.level)}</span>;
  }
  return row.quantity === null ? (
    <UnavailableCount reason="counted quantity not submitted" />
  ) : (
    <span className="num">{formatCount(row.quantity)}</span>
  );
}

function RestockTarget({ row }: { row: RestockStatusRow }) {
  const target =
    row.countMethod === CountMethod.LEVEL ? row.parLevel : row.par;
  if (target === null) {
    return (
      <span className="unavailable" aria-label="Unavailable: no par target is configured for this item and day type.">
        Unavailable
      </span>
    );
  }
  return row.countMethod === CountMethod.LEVEL ? (
    <span className="restock-level">{formatStockLevel(row.parLevel)}</span>
  ) : (
    <span className="num">{formatCount(row.par!)}</span>
  );
}

export function CountNotesPanel({
  countNotes,
  tableCountId,
  businessDate,
  location,
}: {
  countNotes: DailyInventoryReport['countNotes'];
  // The count the Restock needs table is built from. Its item notes are shown
  // in that table's Notes column, so they are not repeated here.
  tableCountId: string | null;
  businessDate: string;
  location: string;
}) {
  // Item notes from any OTHER count (e.g. the opening count when the table
  // uses the closing one) have no table row to live in, so they stay here —
  // otherwise they would vanish from the report entirely.
  const visible = countNotes
    .map((note) => ({
      ...note,
      itemNotes: note.stockCountId === tableCountId ? [] : note.itemNotes,
    }))
    .filter((note) => note.notes !== null || note.itemNotes.length > 0);

  return (
    <section className="report-panel" aria-labelledby="count-notes-title">
      <header className="report-panel-head">
        <div>
          <h2 id="count-notes-title">Inventory session notes</h2>
          <p>
            Notes recorded by staff while counting, opening and closing. Item
            notes for the count used above appear in the Restock needs table.
          </p>
        </div>
      </header>
      {visible.length === 0 ? (
        <div className="report-empty">
          <strong>No session notes for this day</strong>
          <span>
            No opening or closing count for {formatBusinessDate(businessDate)} at{' '}
            {location} carried a session note. Item notes, if any, are in the
            Restock needs table. Notes are optional.
          </span>
        </div>
      ) : (
        <ul className="count-notes-list">
          {visible.map((note) => (
            <li className="count-note" key={note.stockCountId}>
              <div className="count-note-meta">
                <strong>{note.phase === 'open' ? 'Opening' : 'Closing'}</strong>
                <span>
                  {formatSubmissionTime(note.recordedAt)} ·{' '}
                  {note.submittedByNameSnapshot}
                </span>
                {/* Counts are append-only, so a day can carry an original note
                    and a later correction's note. Labelling the correction is
                    what stops the pair reading as a contradiction. */}
                {note.isCorrection && (
                  <span className="count-note-correction">Correction</span>
                )}
              </div>
              {note.notes && <p className="count-note-body">{note.notes}</p>}
              {note.itemNotes.length > 0 && (
                <div className="count-item-notes">
                  <p className="count-item-notes-label">
                    {note.itemNotes.length === 1
                      ? '1 item noted'
                      : `${note.itemNotes.length} items noted`}
                  </p>
                  <ul>
                    {note.itemNotes.map((item) => (
                      <li key={item.inventoryItemId}>
                        <strong>{item.itemName}</strong>
                        <span>{item.notes}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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
  // Defaults to restock-needs-only, which is what this panel has always shown.
  // The toggle reveals ENOUGH items so the same count can be read as a full
  // stock picture without leaving the report.
  const [showAll, setShowAll] = useState(false);
  const rows = showAll
    ? restock.rows
    : restock.rows.filter((row) => row.status !== 'ENOUGH');
  const enoughCount = restock.rows.length - restock.rows.filter(
    (row) => row.status !== 'ENOUGH',
  ).length;
  // A note is easy to lose behind the default filter, so say when one is hidden.
  const hiddenNotedCount = restock.rows.filter(
    (row) => row.status === 'ENOUGH' && row.notes !== null,
  ).length;

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
            {showAll
              ? `Showing all ${restock.rows.length} counted items, including those with Enough stock.`
              : `Showing Urgent, Low, and Below par items only.${
                  enoughCount > 0
                    ? ` ${enoughCount} item${enoughCount === 1 ? '' : 's'} with Enough stock ${enoughCount === 1 ? 'is' : 'are'} hidden${
                        hiddenNotedCount > 0
                          ? `, ${hiddenNotedCount} with a note`
                          : ''
                      }.`
                    : ''
                }`}
          </p>
          <div className="restock-scope-toggle">
            <label htmlFor="restock-show-all">
              <input
                id="restock-show-all"
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              <span>Show all counted items</span>
            </label>
          </div>
          {rows.length === 0 ? (
            <div className="report-empty report-empty-positive">
              <strong>
                {showAll ? 'No items counted' : 'Nothing needs restocking'}
              </strong>
              <span>
                {showAll
                  ? `The ${phase} count for ${formatBusinessDate(businessDate)} at ${location} recorded no items.`
                  : `The ${phase} count for ${formatBusinessDate(businessDate)} at ${location} has no Urgent, Low, or Below par items.`}
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
                    {showAll
                      ? 'All counted items, ordered by status, Critical setting, then item name.'
                      : 'Items below their restock threshold, ordered by status, Critical setting, then item name.'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">Counted amount</th>
                      <th scope="col" className="num">Target (par)</th>
                      <th scope="col">Status</th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
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
                        <td className="restock-note">
                          {row.notes ?? (
                            <span className="restock-note-empty">
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">No note</span>
                            </span>
                          )}
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
