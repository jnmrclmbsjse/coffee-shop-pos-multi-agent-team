import {
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  Link,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import type {
  OrderHistoryList,
  OrderHistoryListItem,
  OrderHistoryListQuery,
  OrderHistoryListSort,
  OrderHistoryStatus,
  SortDirection,
} from '@coffee-shop/shared';
import { getOrderHistory } from '../reporting/api';
import { ReportingLoading, ReportingNotice } from '../reporting/components';
import {
  DEFAULT_ORDER_HISTORY_QUERY,
  formatOrderHistoryPaymentMethod,
  formatTimestamp,
  parseOrderHistoryQuery,
} from '../reporting/orderHistoryFormat';
import {
  formatBusinessDate,
  formatMoney,
} from '../reporting/format';

const PAGE_SIZES = [5, 10, 25, 50] as const;

function StatusBadge({ status }: { status: OrderHistoryStatus }) {
  return (
    <span className={`order-status order-status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

function Unavailable({ label }: { label: string }) {
  return <span aria-label={label} className="order-unavailable">—</span>;
}

function Money({
  cents,
  subdued = false,
}: {
  cents: number;
  subdued?: boolean;
}) {
  return (
    <span className={`order-money${subdued ? ' order-money-subdued' : ''}`}>
      {formatMoney(cents)}
    </span>
  );
}

function ChangeOwed({ order }: { order: OrderHistoryListItem }) {
  if (order.status === 'Parked') {
    return <Unavailable label="Change owed not available" />;
  }

  const hasSettlementState =
    order.changeOwedCents > 0 && order.changeSettled !== null;
  return (
    <span className="order-change">
      <Money
        cents={order.changeOwedCents}
        subdued={order.changeOwedCents === 0}
      />
      {hasSettlementState && (
        <small className={order.changeSettled ? '' : 'is-outstanding'}>
          {order.changeSettled ? 'Settled' : 'Outstanding'}
        </small>
      )}
    </span>
  );
}

function SortHeader({
  label,
  sort,
  activeSort,
  direction,
  numeric = false,
  onSort,
}: {
  label: string;
  sort: OrderHistoryListSort;
  activeSort: OrderHistoryListSort;
  direction: SortDirection;
  numeric?: boolean;
  onSort: (sort: OrderHistoryListSort) => void;
}) {
  const active = sort === activeSort;
  const ariaSort = active
    ? direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';
  return (
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={ariaSort}>
      <button
        className={`order-sort${numeric ? ' order-sort-numeric' : ''}`}
        type="button"
        aria-label={`${label}, ${
          active ? `sorted ${ariaSort}` : 'not sorted'
        }`}
        onClick={() => onSort(sort)}
      >
        {label}
        <span aria-hidden="true">
          {active ? (direction === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
}

function PageButton({
  page,
  currentPage,
  onPage,
}: {
  page: number;
  currentPage: number;
  onPage: (page: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Page ${page}`}
      aria-current={page === currentPage ? 'page' : undefined}
      onClick={() => onPage(page)}
    >
      {page}
    </button>
  );
}

function pageWindow(currentPage: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function TableCellUnavailable({ children }: { children?: ReactNode }) {
  return children ?? <Unavailable label="Not available" />;
}

export function OrderHistoryPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseOrderHistoryQuery(searchParams);
  const queryKey = searchParams.toString();
  const [orders, setOrders] = useState<OrderHistoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    document.title = 'Order History · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    void getOrderHistory(query)
      .then((result) => {
        if (active) setOrders(result);
      })
      .catch(() => {
        if (active) {
          setPageError('Order history could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryKey]);

  function updateQuery(
    changes: Record<string, string | number | undefined>,
    resetPage = true,
  ) {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    if (resetPage) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  function updateFilter(
    key: 'status' | 'paymentMethod',
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    updateQuery({ [key]: event.target.value || undefined });
  }

  function sortBy(sort: OrderHistoryListSort) {
    const nextDirection =
      query.sort === sort
        ? query.direction === 'asc'
          ? 'desc'
          : 'asc'
        : 'asc';
    updateQuery({
      sort:
        sort === DEFAULT_ORDER_HISTORY_QUERY.sort
          ? undefined
          : sort,
      direction:
        sort === DEFAULT_ORDER_HISTORY_QUERY.sort &&
        nextDirection === DEFAULT_ORDER_HISTORY_QUERY.direction
          ? undefined
          : nextDirection,
    });
  }

  function setPage(page: number) {
    updateQuery(
      {
        page: page === DEFAULT_ORDER_HISTORY_QUERY.page ? undefined : page,
      },
      false,
    );
  }

  const firstItem = orders
    ? (orders.page - 1) * orders.pageSize + 1
    : 0;
  const lastItem = orders
    ? Math.min(orders.page * orders.pageSize, orders.totalItems)
    : 0;

  return (
    <main className="reporting-page order-history-page">
      <header className="reporting-page-head">
        <div>
          <p className="reporting-context">Sales and order review</p>
          <h1>Order History</h1>
          <p>Review sales orders across available business days.</p>
        </div>
        <span className="read-only-label">Read-only</span>
      </header>

      <section className="order-history-filters" aria-labelledby="filters-title">
        <h2 className="sr-only" id="filters-title">Filter order history</h2>
        <label>
          <span>Customer</span>
          <input
            type="search"
            autoComplete="off"
            placeholder="Search customer name"
            value={query.search ?? ''}
            onChange={(event) =>
              updateQuery({ search: event.target.value || undefined })
            }
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={query.status ?? ''}
            onChange={(event) => updateFilter('status', event)}
          >
            <option value="">All</option>
            <option value="Parked">Parked</option>
            <option value="Completed">Completed</option>
            <option value="Void">Void</option>
          </select>
        </label>
        <label>
          <span>Payment</span>
          <select
            value={query.paymentMethod ?? ''}
            onChange={(event) => updateFilter('paymentMethod', event)}
          >
            <option value="">All</option>
            <option value="Cash">Cash</option>
            <option value="Online">Online</option>
            <option value="Split">Split</option>
          </select>
        </label>
        <label>
          <span>Rows per page</span>
          <select
            value={query.pageSize}
            onChange={(event) => {
              const pageSize = Number(event.target.value) as
                OrderHistoryListQuery['pageSize'];
              updateQuery({
                pageSize:
                  pageSize === DEFAULT_ORDER_HISTORY_QUERY.pageSize
                    ? undefined
                    : pageSize,
              });
            }}
          >
            {PAGE_SIZES.map((pageSize) => (
              <option key={pageSize} value={pageSize}>{pageSize}</option>
            ))}
          </select>
        </label>
      </section>

      {pageError && <ReportingNotice>{pageError}</ReportingNotice>}
      {loading && !orders && (
        <ReportingLoading label="Loading order history…" />
      )}

      {orders && (
        <section aria-busy={loading}>
          <div className="order-results-toolbar">
            <p aria-live="polite">
              {orders.totalItems === 0
                ? '0 orders'
                : `Showing ${firstItem}-${lastItem} of ${orders.totalItems} orders`}
            </p>
            {loading && <span>Updating…</span>}
          </div>

          {orders.items.length === 0 ? (
            <div className="order-empty">
              <h2>No sales orders</h2>
              <p>
                Clear the current filters or search to see available orders.
              </p>
            </div>
          ) : (
            <>
              <p className="report-scroll-hint">
                Swipe horizontally to see all order fields.
              </p>
              <div
                className="report-table-region order-table-region"
                tabIndex={0}
                aria-label="Order history table, horizontally scrollable"
              >
                <table className="report-table order-history-table">
                  <caption className="sr-only">
                    Read-only order history across business days
                  </caption>
                  <thead>
                    <tr>
                      <SortHeader
                        label="Business day"
                        sort="businessDay"
                        activeSort={query.sort!}
                        direction={query.direction!}
                        onSort={sortBy}
                      />
                      <SortHeader
                        label="Order no."
                        sort="orderNumber"
                        activeSort={query.sort!}
                        direction={query.direction!}
                        onSort={sortBy}
                      />
                      <th scope="col">Customer</th>
                      <SortHeader
                        label="Status"
                        sort="status"
                        activeSort={query.sort!}
                        direction={query.direction!}
                        onSort={sortBy}
                      />
                      <th scope="col">Payment method</th>
                      <SortHeader
                        label="Order total"
                        sort="total"
                        activeSort={query.sort!}
                        direction={query.direction!}
                        numeric
                        onSort={sortBy}
                      />
                      <th scope="col" className="num">Tip</th>
                      <th scope="col" className="num">Change owed</th>
                      <SortHeader
                        label="Completed"
                        sort="completedAt"
                        activeSort={query.sort!}
                        direction={query.direction!}
                        onSort={sortBy}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.items.map((order) => {
                      const businessDay = formatBusinessDate(
                        order.businessDay,
                        'short',
                      );
                      const unavailablePayment =
                        order.paymentMethod === null;
                      const completedAt =
                        order.status === 'Completed'
                          ? formatTimestamp(order.completedAt)
                          : '—';
                      return (
                        <tr key={order.id}>
                          <td className="num">{businessDay}</td>
                          <td className="num">
                            <Link
                              className="order-number-link"
                              to={{
                                pathname: `/order-history/${order.id}`,
                                search: location.search,
                              }}
                              aria-label={`Open order ${order.dayOrderNumber} for business day ${businessDay}`}
                            >
                              {order.dayOrderNumber}
                            </Link>
                          </td>
                          <td className="order-customer">
                            {order.customerName ?? 'Walk-in'}
                          </td>
                          <td><StatusBadge status={order.status} /></td>
                          <td>
                            <TableCellUnavailable>
                              {unavailablePayment
                                ? undefined
                                : formatOrderHistoryPaymentMethod(
                                    order.paymentMethod,
                                  )}
                            </TableCellUnavailable>
                          </td>
                          <td className="num">
                            <Money cents={order.totalCents} />
                          </td>
                          <td className="num">
                            {order.status === 'Parked' ? (
                              <Unavailable label="Tip not available" />
                            ) : (
                              <Money
                                cents={order.tipCents}
                                subdued={order.tipCents === 0}
                              />
                            )}
                          </td>
                          <td className="num">
                            <ChangeOwed order={order} />
                          </td>
                          <td className="num">
                            {completedAt === '—' ? (
                              <Unavailable label="Completed time not available" />
                            ) : (
                              completedAt
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <nav className="order-pagination" aria-label="Order history pages">
                <button
                  type="button"
                  disabled={orders.page <= 1}
                  onClick={() => setPage(orders.page - 1)}
                >
                  Previous
                </button>
                {pageWindow(orders.page, orders.totalPages).map((page) => (
                  <PageButton
                    key={page}
                    page={page}
                    currentPage={orders.page}
                    onPage={setPage}
                  />
                ))}
                <button
                  type="button"
                  disabled={orders.page >= orders.totalPages}
                  onClick={() => setPage(orders.page + 1)}
                >
                  Next
                </button>
              </nav>
            </>
          )}
        </section>
      )}
    </main>
  );
}
