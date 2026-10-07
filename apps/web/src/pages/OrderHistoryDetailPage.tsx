import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { MoneyValue } from '../reporting/MoneyValue';
import {
  formatLinePreferences,
  formatOrderHistoryPaymentMethod,
  formatServiceType,
  formatTimestamp,
} from '../reporting/orderHistoryFormat';
import { formatBusinessDate, formatMoney } from '../reporting/format';
import { getDeviceId } from '../auth/device';
import { OrderCaptureApiError, voidOrder } from '../orders/api';
import { VoidOrderDialog } from '../orders/OrderSettlementDialogs';

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

function discountLabel(kind: LineDiscountKind): string {
  if (kind === 'SENIOR') return 'Senior';
  if (kind === 'PWD') return 'PWD';
  return 'None';
}

export function OrderHistoryDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState<OrderHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidMessage, setVoidMessage] = useState('');
  // Reused across retries so a void whose response was lost replays.
  const voidClientGeneratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    // The route can reuse this component for another order; a void ID carried
    // over would replay the previous order's void instead of voiding this one.
    voidClientGeneratedIdRef.current = null;
    setVoidDialogOpen(false);
    setVoidError(null);
    setVoidMessage('');
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

  const closeVoidDialog = useCallback(() => {
    setVoidError(null);
    setVoidDialogOpen(false);
  }, []);

  async function confirmVoid(reason: string) {
    if (!order || isVoiding) return;
    const voidClientGeneratedId =
      voidClientGeneratedIdRef.current ?? globalThis.crypto.randomUUID();
    voidClientGeneratedIdRef.current = voidClientGeneratedId;
    setIsVoiding(true);
    setVoidError(null);
    try {
      const correction = await voidOrder(order.clientGeneratedId, {
        clientGeneratedId: voidClientGeneratedId,
        deviceId: getDeviceId(),
        voidReason: reason,
      });
      setOrder((current) =>
        current && current.id === order.id
          ? {
              ...current,
              status: 'Void',
              voidReason: correction.voidReason ?? reason,
            }
          : current,
      );
      setVoidDialogOpen(false);
      setVoidMessage(
        `Order ${order.dayOrderNumber} marked void. Enter a new order for any correction.`,
      );
    } catch (error) {
      setVoidError(
        error instanceof OrderCaptureApiError
          ? error.message
          : 'The order could not be voided. Try again.',
      );
    } finally {
      setIsVoiding(false);
    }
  }

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
            <div className="order-detail-head-actions">
              <StatusBadge status={order.status} />
              {order.status === 'Completed' && (
                <button
                  type="button"
                  className="catalog-button danger"
                  onClick={() => {
                    setVoidError(null);
                    setVoidDialogOpen(true);
                  }}
                >
                  Void order
                </button>
              )}
            </div>
          </header>

          {voidMessage && (
            <p className="order-void-feedback" role="status">
              {voidMessage}
            </p>
          )}

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
                      <th scope="col">Preferences</th>
                      <th scope="col" className="num">Quantity</th>
                      <th scope="col">Discount</th>
                      <th scope="col" className="num">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="order-items-empty">
                          No order items
                        </td>
                      </tr>
                    ) : (
                      order.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="order-customer">{line.productName}</td>
                          <td>{line.size}</td>
                          <td>
                            {formatLinePreferences(
                              line.preferences,
                              line.preferenceNote,
                            ) ?? '—'}
                          </td>
                          <td className="num">{line.quantity}</td>
                          <td>
                            {discountLabel(line.discountKind)}
                            {line.discountKind !== 'NONE' && (
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

      {/* Portalled to body so no transformed ancestor can become the fixed
          backdrop's containing block and push the dialog off-screen. */}
      {order && voidDialogOpen &&
        createPortal(
          <VoidOrderDialog
            order={order}
            isSaving={isVoiding}
            serverError={voidError}
            note="The void is recorded on the business day that is open now."
            onClose={closeVoidDialog}
            onConfirm={confirmVoid}
          />,
          document.body,
        )}
    </main>
  );
}
