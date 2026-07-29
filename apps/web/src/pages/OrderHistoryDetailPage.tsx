import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type {
  LineDiscountKind,
  OrderHistoryDetail,
  OrderHistoryStatus,
} from '@coffee-shop/shared';
import {
  getOrderHistoryDetail,
  ReportingApiError,
} from '../reporting/api';
import { ReportingLoading, ReportingNotice } from '../reporting/components';
import {
  formatOrderHistoryPaymentMethod,
  formatServiceType,
  formatTimestamp,
} from '../reporting/orderHistoryFormat';
import { formatBusinessDate, formatMoney } from '../reporting/format';

function StatusBadge({ status }: { status: OrderHistoryStatus }) {
  return (
    <span className={`order-status order-status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

function DetailValue({
  children,
  unavailable = false,
}: {
  children: React.ReactNode;
  unavailable?: boolean;
}) {
  return unavailable ? (
    <span className="order-unavailable">—</span>
  ) : (
    <>{children}</>
  );
}

function MoneyValue({
  cents,
  unavailable = false,
}: {
  cents: number | null;
  unavailable?: boolean;
}) {
  return (
    <DetailValue unavailable={unavailable || cents === null}>
      {cents === null ? '' : formatMoney(cents)}
    </DetailValue>
  );
}

function discountLabel(kind: LineDiscountKind): string {
  return kind === 'SENIOR' ? 'Senior' : 'None';
}

export function OrderHistoryDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState<OrderHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    void getOrderHistoryDetail(id)
      .then((result) => {
        if (active) {
          setOrder(result);
          document.title = `Order ${result.dayOrderNumber} · UCM Coffee Studio`;
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(
            error instanceof ReportingApiError && error.status === 404
              ? 'This sales order could not be found.'
              : 'Order details could not be loaded. Try again.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const backTo = `/order-history${location.search}`;
  const isParked = order?.status === 'Parked';

  return (
    <main className="reporting-page order-history-page">
      <Link className="order-back-link" to={backTo}>
        Back to Order History
      </Link>

      {pageError && <ReportingNotice>{pageError}</ReportingNotice>}
      {loading && !order && <ReportingLoading label="Loading order details…" />}

      {order && (
        <article aria-busy={loading}>
          <header className="order-detail-head">
            <div>
              <p className="reporting-context">Order History</p>
              <h1>Order {order.dayOrderNumber}</h1>
              <p>
                Business day {formatBusinessDate(order.businessDay, 'long')}
              </p>
            </div>
            <StatusBadge status={order.status} />
          </header>

          <dl className="order-detail-meta" aria-label="Order summary">
            <div>
              <dt>Customer</dt>
              <dd>{order.customerName ?? 'Walk-in'}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{formatServiceType(order.serviceType)}</dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>{formatOrderHistoryPaymentMethod(order.paymentMethod)}</dd>
            </div>
          </dl>

          <div className="order-detail-grid">
            <section className="order-detail-section" aria-labelledby="items-title">
              <h2 id="items-title">Items</h2>
              <div
                className="report-table-region"
                tabIndex={0}
                aria-label="Order item details, horizontally scrollable"
              >
                <table className="report-table order-items-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Size</th>
                      <th scope="col" className="num">Quantity</th>
                      <th scope="col">Discount</th>
                      <th scope="col" className="num">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="order-items-empty">
                          No order items
                        </td>
                      </tr>
                    ) : (
                      order.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="order-customer">{line.productName}</td>
                          <td>{line.size}</td>
                          <td className="num">{line.quantity}</td>
                          <td>
                            {discountLabel(line.discountKind)}
                            {line.discountKind === 'SENIOR' && (
                              <small className="order-line-note">
                                Included in Total discount
                              </small>
                            )}
                          </td>
                          <td className="num">{formatMoney(line.lineTotalCents)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="order-detail-section"
              aria-labelledby="payment-summary-title"
            >
              <h2 id="payment-summary-title">Payment summary</h2>
              <dl className="order-payment-summary">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatMoney(order.subtotalCents)}</dd>
                </div>
                <div>
                  <dt>Total discount</dt>
                  <dd>{formatMoney(order.totalDiscountCents)}</dd>
                </div>
                <div className="is-total">
                  <dt>Total</dt>
                  <dd>{formatMoney(order.totalCents)}</dd>
                </div>
                <div className="is-group-start">
                  <dt>Cash portion</dt>
                  <dd>
                    <MoneyValue
                      cents={order.cashPortionCents}
                      unavailable={isParked}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Online portion</dt>
                  <dd>
                    <MoneyValue
                      cents={order.onlinePortionCents}
                      unavailable={isParked}
                    />
                  </dd>
                </div>
                <div className="is-group-start">
                  <dt>Tip</dt>
                  <dd>
                    <MoneyValue cents={order.tipCents} unavailable={isParked} />
                  </dd>
                </div>
                <div>
                  <dt>Cash received</dt>
                  <dd>
                    <MoneyValue
                      cents={order.cashReceivedCents}
                      unavailable={isParked}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Change owed</dt>
                  <dd>
                    <MoneyValue
                      cents={order.changeOwedCents}
                      unavailable={isParked}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Change settled</dt>
                  <dd>
                    <DetailValue
                      unavailable={isParked || !order.changeSettledAt}
                    >
                      {formatTimestamp(order.changeSettledAt)}
                    </DetailValue>
                  </dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    <DetailValue
                      unavailable={
                        order.status !== 'Completed' || !order.completedAt
                      }
                    >
                      {formatTimestamp(order.completedAt)}
                    </DetailValue>
                  </dd>
                </div>
              </dl>
              {order.paymentMethod === 'Split' && (
                <p className="order-split-note">
                  Cash and online portions exclude tip and together equal Total.
                </p>
              )}
              {order.voidReason && (
                <div className="order-void-reason">
                  <h3>Void reason</h3>
                  <p>{order.voidReason}</p>
                </div>
              )}
            </section>
          </div>
        </article>
      )}
    </main>
  );
}
