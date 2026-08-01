import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineDiscountKind,
  type BusinessDayList,
  type BusinessDayListItem,
  type OrderHistoryPaymentMethod,
  type OrderHistoryStatus,
  type StaffOrderLedger,
  type StaffOrderLedgerOrder,
  type StaffOrderLedgerQuery,
} from '@coffee-shop/shared';
import {
  formatOrderHistoryPaymentMethod,
  formatTimestamp,
} from '../reporting/orderHistoryFormat';
import { formatBusinessDate, formatMoney } from '../reporting/format';
import { StaffPageHeading } from '../staff/StaffPageHeading';
import { getStaffOrderLedger, listBusinessDays } from './api';

const STATUSES: OrderHistoryStatus[] = ['Completed', 'Parked', 'Void'];
const PAYMENT_METHODS: OrderHistoryPaymentMethod[] = [
  'Cash',
  'Online',
  'Split',
];

interface LedgerFilters {
  status: OrderHistoryStatus | '';
  paymentMethod: OrderHistoryPaymentMethod | '';
  search: string;
}

function filtersFromParams(params: URLSearchParams): LedgerFilters {
  const status = params.get('status');
  const paymentMethod = params.get('payment');
  return {
    status: STATUSES.includes(status as OrderHistoryStatus)
      ? (status as OrderHistoryStatus)
      : '',
    paymentMethod: PAYMENT_METHODS.includes(
      paymentMethod as OrderHistoryPaymentMethod,
    )
      ? (paymentMethod as OrderHistoryPaymentMethod)
      : '',
    search: params.get('search') ?? '',
  };
}

function ledgerQuery(filters: LedgerFilters): StaffOrderLedgerQuery {
  const search = filters.search.trim();
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.paymentMethod
      ? { paymentMethod: filters.paymentMethod }
      : {}),
    ...(search ? { search } : {}),
  };
}

function defaultBusinessDay(days: BusinessDayList): string {
  return days.currentOpenBusinessDayId ?? days.items[0]?.id ?? '';
}

function businessDayLabel(day: BusinessDayListItem): string {
  const status = day.status === 'OPEN' ? 'Open' : 'Closed';
  return `${formatBusinessDate(day.businessDate)} (${status})`;
}

function completionLabel(value: string | null): string {
  return value ? formatTimestamp(value) : 'Not completed';
}

function discountLabel(kind: LineDiscountKind): string {
  return kind === LineDiscountKind.SENIOR ? 'Senior discount' : '';
}

function PaymentBreakdown({ order }: { order: StaffOrderLedgerOrder }) {
  if (!order.paymentMethod) return null;

  if (order.paymentMethod === 'Split') {
    return (
      <div className="staff-order-payment" aria-label="Split payment">
        <div>
          <span>Cash</span>
          <strong>{formatMoney(order.cashPortionCents ?? 0)}</strong>
        </div>
        <div>
          <span>Online</span>
          <strong>{formatMoney(order.onlinePortionCents ?? 0)}</strong>
        </div>
      </div>
    );
  }

  const portion =
    order.paymentMethod === 'Cash'
      ? order.cashPortionCents
      : order.onlinePortionCents;
  return (
    <div className="staff-order-payment">
      <div>
        <span>{order.paymentMethod}</span>
        <strong>{formatMoney(portion ?? order.totalCents)}</strong>
      </div>
    </div>
  );
}

export function StaffOrderCard({ order }: { order: StaffOrderLedgerOrder }) {
  const customerName = order.customerName ?? 'Walk-in';
  const showsCompletionFacts = order.status !== 'Parked';

  return (
    <li className={`staff-order-card is-${order.status.toLowerCase()}`}>
      <article aria-labelledby={`staff-order-${order.id}`}>
        <header className="staff-order-card-head">
          <div className="staff-order-title-row">
            <h3 id={`staff-order-${order.id}`}>
              <span>Order #{order.dayOrderNumber}</span>
              {' · '}
              {customerName}
            </h3>
            <span
              className="staff-order-status"
              data-status={order.status.toLowerCase()}
            >
              {order.status}
            </span>
          </div>
          <dl className="staff-order-meta">
            {showsCompletionFacts && (
              <div>
                <dt>Payment</dt>
                <dd>
                  {order.paymentMethod
                    ? formatOrderHistoryPaymentMethod(order.paymentMethod)
                    : 'Not paid'}
                </dd>
              </div>
            )}
            {showsCompletionFacts && (
              <div>
                <dt>Completion</dt>
                <dd>{completionLabel(order.completedAt)}</dd>
              </div>
            )}
            {order.cashierName && (
              <div>
                <dt>Cashier</dt>
                <dd>{order.cashierName}</dd>
              </div>
            )}
            <div>
              <dt>Total</dt>
              <dd className="staff-order-total">
                {formatMoney(order.totalCents)}
              </dd>
            </div>
          </dl>
        </header>

        {showsCompletionFacts && <PaymentBreakdown order={order} />}

        <ul className="staff-order-lines" aria-label="Order lines">
          {order.lines.map((line) => (
            <li key={line.id}>
              <span className="staff-order-quantity">{line.quantity}×</span>
              <span className="staff-order-product">
                {line.productName}
                {line.discountKind !== LineDiscountKind.NONE && (
                  <small>{discountLabel(line.discountKind)}</small>
                )}
              </span>
              <span className="staff-order-size">{line.size}</span>
            </li>
          ))}
        </ul>

        {order.changeOwedCents > 0 && (
          <p
            className={`staff-order-change${
              order.changeSettled ? ' is-given' : ' is-owed'
            }`}
          >
            <span>
              {order.changeSettled ? 'Change given' : 'Change still owed'}
            </span>
            <strong>{formatMoney(order.changeOwedCents)}</strong>
          </p>
        )}

        {order.status === 'Void' && order.voidReason && (
          <p className="staff-order-void-reason">
            <strong>Void reason:</strong> {order.voidReason}
          </p>
        )}
      </article>
    </li>
  );
}

function LoadingState() {
  return (
    <div className="staff-order-loading" aria-live="polite">
      <span>Loading order history…</span>
      <div aria-hidden="true" />
      <div aria-hidden="true" />
    </div>
  );
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <div className="staff-order-load-error" role="alert">
      <p>Order history could not be loaded. Try again.</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

export function StaffOrderHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState<BusinessDayList | null>(null);
  const [ledger, setLedger] = useState<StaffOrderLedger | null>(null);
  const [loadedLedgerKey, setLoadedLedgerKey] = useState('');
  const [daysLoading, setDaysLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [daysError, setDaysError] = useState(false);
  const [ledgerError, setLedgerError] = useState(false);
  const [daysAttempt, setDaysAttempt] = useState(0);
  const [ledgerAttempt, setLedgerAttempt] = useState(0);
  const paramsKey = searchParams.toString();
  const filters = useMemo(
    () => filtersFromParams(searchParams),
    [paramsKey],
  );
  const requestedDayId = searchParams.get('day') ?? '';
  const selectedDayId = days
    ? days.items.some((day) => day.id === requestedDayId)
      ? requestedDayId
      : defaultBusinessDay(days)
    : '';
  const selectedDay = days?.items.find((day) => day.id === selectedDayId);
  const activeFilters = Boolean(
    filters.status || filters.paymentMethod || filters.search.trim(),
  );

  useEffect(() => {
    document.title = 'Order History · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    let active = true;
    setDaysLoading(true);
    setDaysError(false);
    void listBusinessDays()
      .then((result) => {
        if (!active) return;
        setDays(result);
        const nextDayId =
          result.items.some((day) => day.id === requestedDayId)
            ? requestedDayId
            : defaultBusinessDay(result);
        if (nextDayId !== requestedDayId) {
          const next = new URLSearchParams(searchParams);
          if (nextDayId) next.set('day', nextDayId);
          else next.delete('day');
          setSearchParams(next, { replace: true });
        }
      })
      .catch(() => {
        if (active) setDaysError(true);
      })
      .finally(() => {
        if (active) setDaysLoading(false);
      });
    return () => {
      active = false;
    };
  }, [daysAttempt]);

  const query = ledgerQuery(filters);
  const queryKey = JSON.stringify(query);
  const ledgerRequestKey = `${selectedDayId}:${queryKey}:${ledgerAttempt}`;
  const ledgerIsCurrent =
    ledger !== null && loadedLedgerKey === ledgerRequestKey;
  useEffect(() => {
    if (!selectedDayId) {
      setLedger(null);
      setLoadedLedgerKey('');
      setLedgerLoading(false);
      setLedgerError(false);
      return;
    }

    let active = true;
    setLedger(null);
    setLoadedLedgerKey('');
    setLedgerLoading(true);
    setLedgerError(false);
    void getStaffOrderLedger(selectedDayId, query)
      .then((result) => {
        if (active) {
          setLedger(result);
          setLoadedLedgerKey(ledgerRequestKey);
        }
      })
      .catch(() => {
        if (active) setLedgerError(true);
      })
      .finally(() => {
        if (active) setLedgerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledgerRequestKey]);

  function updateParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function updateSelect(
    key: 'day' | 'status' | 'payment',
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    updateParams({ [key]: event.target.value || undefined });
  }

  function clearFilters() {
    updateParams({ status: undefined, payment: undefined, search: undefined });
  }

  return (
    <main
      id="staff-main"
      className="staff-inventory-workspace staff-inventory-screen staff-order-history"
    >
      <StaffPageHeading
        title="Order History"
        description="Review recorded orders for one business day. This screen never changes an order."
        badge="Read only"
      />

      <section className="staff-order-filters" aria-labelledby="staff-order-filters-title">
        <div className="staff-order-filter-head">
          <h2 id="staff-order-filters-title">Find an order</h2>
          <button
            type="button"
            disabled={!activeFilters}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
        <div className="staff-order-filter-grid">
          <label>
            <span>Business day</span>
            <select
              value={selectedDayId}
              disabled={!days?.items.length}
              onChange={(event) => updateSelect('day', event)}
            >
              {!days?.items.length && (
                <option value="">No business days</option>
              )}
              {days?.items.map((day) => (
                <option key={day.id} value={day.id}>
                  {businessDayLabel(day)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateSelect('status', event)}
            >
              <option value="">All</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Payment</span>
            <select
              value={filters.paymentMethod}
              aria-describedby="staff-order-payment-help"
              onChange={(event) => updateSelect('payment', event)}
            >
              <option value="">Any payment</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Customer name</span>
            <input
              type="search"
              autoComplete="off"
              placeholder="Search name or Walk-in"
              value={filters.search}
              onChange={(event) =>
                updateParams({ search: event.target.value || undefined })
              }
            />
          </label>
        </div>
        <p id="staff-order-payment-help" className="staff-order-filter-help">
          Payment types are exclusive. Unpaid orders appear only under Any
          payment.
        </p>
        {ledgerIsCurrent && (
          <p className="staff-order-result-count" role="status" aria-live="polite" aria-atomic="true">
            {ledger.orders.length} {ledger.orders.length === 1 ? 'order' : 'orders'}
          </p>
        )}
      </section>

      <aside
        className="staff-order-guidance"
        aria-labelledby="staff-order-guidance-title"
        data-testid="correction-guidance"
      >
        <div>
          <h2 id="staff-order-guidance-title">About corrections</h2>
          <p>
            Corrections are made by voiding the original completed order and
            entering the corrected order again from the order screen. Reviewing
            or filtering history never changes an order.
          </p>
        </div>
        <span>History only</span>
      </aside>

      {daysError ? (
        <LoadError retry={() => setDaysAttempt((attempt) => attempt + 1)} />
      ) : daysLoading ||
        (selectedDayId &&
          (ledgerLoading || (!ledgerIsCurrent && !ledgerError))) ? (
        <LoadingState />
      ) : ledgerError ? (
        <LoadError retry={() => setLedgerAttempt((attempt) => attempt + 1)} />
      ) : (
        <section className="staff-order-ledger-region" aria-labelledby="staff-order-ledger-title">
          <div className="staff-order-ledger-head">
            <h2 id="staff-order-ledger-title">Orders</h2>
            {selectedDay && <p>{businessDayLabel(selectedDay)}</p>}
          </div>
          {ledgerIsCurrent && ledger.orders.length > 0 ? (
            <ol className="staff-order-ledger">
              {ledger.orders.map((order) => (
                <StaffOrderCard key={order.id} order={order} />
              ))}
            </ol>
          ) : (
            <div className="staff-order-empty" role="status">
              <h3>No orders to show</h3>
              <p>
                {!days?.items.length
                  ? 'No business day has been opened yet.'
                  : activeFilters
                    ? 'No orders match the selected day and current filters.'
                    : 'There are no recorded orders for this business day.'}
              </p>
              {activeFilters && (
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
