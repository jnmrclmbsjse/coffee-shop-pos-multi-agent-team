import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  cents,
  PaymentMethod,
  type CompleteOrderInput,
  type Order,
} from '@coffee-shop/shared';
import { formatPeso } from '../catalog/money';

type PaymentKind = 'cash' | 'online' | 'split';

interface ParsedMoney {
  cents: number | null;
  valid: boolean;
}

function parseMoney(value: string): ParsedMoney {
  const trimmed = value.trim();
  if (trimmed === '') return { cents: null, valid: true };
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(trimmed)) {
    return { cents: null, valid: false };
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [pesoPart, centPart = ''] = unsigned.split('.');
  const pesos = Number(pesoPart);
  const cents = Number(centPart.padEnd(2, '0'));
  const total = pesos * 100 + cents;
  return {
    cents: negative ? -total : total,
    valid: Number.isSafeInteger(total),
  };
}

function paymentPortions(order: Order) {
  return {
    cash:
      order.payments.find((payment) => payment.method === PaymentMethod.CASH)
        ?.amountCents ?? 0,
    online:
      order.payments.find((payment) => payment.method === PaymentMethod.ONLINE)
        ?.amountCents ?? 0,
  };
}

function useDialogLifecycle(
  dialogRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  closeDisabled: boolean,
) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    dialogRef.current
      ?.querySelector<HTMLElement>('button, input, textarea')
      ?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [closeDisabled, dialogRef, onClose]);
}

function DialogShell({
  children,
  titleId,
  dialogRef,
  className = '',
}: {
  children: ReactNode;
  titleId: string;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <div className="order-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className={`order-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>
  );
}

export function ChargeSheet({
  order,
  isSaving,
  serverError,
  onClose,
  onComplete,
}: {
  order: Order;
  isSaving: boolean;
  serverError: string | null;
  onClose: () => void;
  onComplete: (input: CompleteOrderInput) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [method, setMethod] = useState<PaymentKind>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [cashPortion, setCashPortion] = useState('');
  const [onlinePortion, setOnlinePortion] = useState('');
  const [cashTip, setCashTip] = useState('0.00');
  const [recordChangeOwed, setRecordChangeOwed] = useState(false);
  const [changeOwed, setChangeOwed] = useState('0.00');
  const [showErrors, setShowErrors] = useState(false);
  useDialogLifecycle(dialogRef, onClose, isSaving);

  const parsedCashReceived = parseMoney(cashReceived);
  const parsedCashPortion = parseMoney(cashPortion);
  const parsedOnlinePortion = parseMoney(onlinePortion);
  const parsedTip = parseMoney(cashTip);
  const parsedChangeOwed = parseMoney(changeOwed);
  const cashPaymentCents =
    method === 'cash'
      ? order.totalCents
      : method === 'split'
        ? (parsedCashPortion.cents ?? 0)
        : 0;
  const onlinePaymentCents =
    method === 'online'
      ? order.totalCents
      : method === 'split'
        ? (parsedOnlinePortion.cents ?? 0)
        : 0;
  const effectiveCashReceived =
    parsedCashReceived.cents ?? cashPaymentCents;
  const changeDueCents = Math.max(
    0,
    effectiveCashReceived - cashPaymentCents,
  );
  const splitRemainderCents =
    order.totalCents - cashPaymentCents - onlinePaymentCents;
  const portionsAreNonNegative =
    cashPaymentCents >= 0 && onlinePaymentCents >= 0;
  const splitIsValid =
    method !== 'split' ||
    (parsedCashPortion.valid &&
      parsedOnlinePortion.valid &&
      portionsAreNonNegative &&
      splitRemainderCents === 0);
  const tipIsValid =
    parsedTip.valid && (parsedTip.cents ?? 0) >= 0;
  const changeOwedIsValid =
    !recordChangeOwed ||
    (parsedChangeOwed.valid &&
      (parsedChangeOwed.cents ?? 0) >= 0 &&
      (parsedChangeOwed.cents ?? 0) <= changeDueCents);
  const cashInputIsValid =
    method === 'online' || parsedCashReceived.valid;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (
      !splitIsValid ||
      !tipIsValid ||
      !changeOwedIsValid ||
      !cashInputIsValid
    ) {
      return;
    }

    const payments: CompleteOrderInput['payments'] = [];
    if (cashPaymentCents > 0 || method === 'cash' || method === 'split') {
      payments.push({
        method: PaymentMethod.CASH,
        amountCents: cents(cashPaymentCents),
      });
    }
    if (onlinePaymentCents > 0 || method === 'online' || method === 'split') {
      payments.push({
        method: PaymentMethod.ONLINE,
        amountCents: cents(onlinePaymentCents),
      });
    }

    void onComplete({
      payments,
      ...(method === 'online'
        ? {}
        : {
            cashReceivedCents:
              parsedCashReceived.cents === null
                ? null
                : cents(parsedCashReceived.cents),
          }),
      cashTipCents: cents(parsedTip.cents ?? 0),
      changeOwedCents: cents(
        recordChangeOwed ? (parsedChangeOwed.cents ?? 0) : 0,
      ),
    });
  };

  const chooseMethod = (nextMethod: PaymentKind) => {
    setMethod(nextMethod);
    setShowErrors(false);
    setRecordChangeOwed(false);
    setChangeOwed('0.00');
  };

  return (
    <DialogShell
      dialogRef={dialogRef}
      titleId="charge-sheet-title"
      className="charge-sheet"
    >
      <form onSubmit={submit} noValidate>
        <header className="order-dialog-header">
          <div>
            <span>Charge order #{order.dayOrderNumber}</span>
            <h2 id="charge-sheet-title">
              Amount due {formatPeso(order.totalCents)}
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </header>

        <div className="order-dialog-body charge-sheet-body">
          <div className="payment-tabs" role="tablist" aria-label="Payment method">
            {(['cash', 'online', 'split'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={method === option}
                aria-controls="payment-panel"
                onClick={() => chooseMethod(option)}
              >
                {option === 'cash'
                  ? 'Cash'
                  : option === 'online'
                    ? 'Online'
                    : 'Split'}
              </button>
            ))}
          </div>

          <section id="payment-panel" role="tabpanel" className="payment-panel">
            {method === 'online' ? (
              <div className="payment-online-summary">
                <span>Online payment</span>
                <strong>{formatPeso(order.totalCents)}</strong>
                <p>The full amount due will be recorded as Online.</p>
              </div>
            ) : (
              <>
                {method === 'split' && (
                  <div className="payment-split-grid">
                    <label className="order-field">
                      <span>Cash portion</span>
                      <input
                        inputMode="decimal"
                        value={cashPortion}
                        aria-invalid={showErrors && !splitIsValid}
                        aria-describedby="split-payment-status"
                        placeholder="0.00"
                        onChange={(event) => setCashPortion(event.target.value)}
                      />
                    </label>
                    <label className="order-field">
                      <span>Online portion</span>
                      <input
                        inputMode="decimal"
                        value={onlinePortion}
                        aria-invalid={showErrors && !splitIsValid}
                        aria-describedby="split-payment-status"
                        placeholder="0.00"
                        onChange={(event) => setOnlinePortion(event.target.value)}
                      />
                    </label>
                    <p
                      id="split-payment-status"
                      className={showErrors && !splitIsValid ? 'order-field-error' : 'payment-remainder'}
                      aria-live="polite"
                    >
                      {!portionsAreNonNegative
                        ? 'Cash and Online portions cannot be negative.'
                        : splitRemainderCents === 0
                          ? 'Portions match the amount due.'
                          : splitRemainderCents > 0
                            ? `${formatPeso(splitRemainderCents)} remains to allocate.`
                            : `${formatPeso(Math.abs(splitRemainderCents))} is over the amount due.`}
                    </p>
                  </div>
                )}

                <label className="order-field payment-cash-received">
                  <span>Cash received (optional)</span>
                  <input
                    inputMode="decimal"
                    value={cashReceived}
                    aria-invalid={showErrors && !cashInputIsValid}
                    aria-describedby="cash-received-help"
                    placeholder="Exact cash"
                    onChange={(event) => setCashReceived(event.target.value)}
                  />
                </label>
                <p id="cash-received-help" className="payment-help">
                  Leave blank when exact cash was received. The server will
                  explain if the entered tender is too low.
                </p>
                {showErrors && !cashInputIsValid && (
                  <p className="order-field-error" role="alert">
                    Enter cash received with no more than two decimal places.
                  </p>
                )}
                <dl className="payment-live-summary" aria-live="polite">
                  <div>
                    <dt>Cash portion</dt>
                    <dd>{formatPeso(cashPaymentCents)}</dd>
                  </div>
                  <div>
                    <dt>Change due</dt>
                    <dd>{formatPeso(changeDueCents)}</dd>
                  </div>
                </dl>
              </>
            )}
          </section>

          <section className="settlement-tip" aria-labelledby="cash-tip-title">
            <div>
              <h3 id="cash-tip-title">Cash tip</h3>
              <p>Separate from product payment and sales revenue.</p>
            </div>
            <label className="order-field">
              <span>Tip amount</span>
              <input
                inputMode="decimal"
                value={cashTip}
                aria-invalid={showErrors && !tipIsValid}
                onChange={(event) => setCashTip(event.target.value)}
              />
            </label>
          </section>
          {showErrors && !tipIsValid && (
            <p className="order-field-error" role="alert">
              Cash tip must be zero or more.
            </p>
          )}

          {method !== 'online' && changeDueCents > 0 && (
            <section className="change-owed-control">
              <label className="change-owed-choice">
                <input
                  type="checkbox"
                  checked={recordChangeOwed}
                  onChange={(event) => setRecordChangeOwed(event.target.checked)}
                />
                <span>
                  <strong>Record change still owed</strong>
                  <small>Choose this only when change cannot be handed over now.</small>
                </span>
              </label>
              {recordChangeOwed && (
                <label className="order-field">
                  <span>Amount still owed</span>
                  <input
                    inputMode="decimal"
                    value={changeOwed}
                    aria-invalid={showErrors && !changeOwedIsValid}
                    aria-describedby="change-owed-help"
                    onChange={(event) => setChangeOwed(event.target.value)}
                  />
                  <small id="change-owed-help">
                    Enter zero through {formatPeso(changeDueCents)}.
                  </small>
                </label>
              )}
            </section>
          )}
          {showErrors && !changeOwedIsValid && (
            <p className="order-field-error" role="alert">
              Change still owed must be between zero and the change due.
            </p>
          )}

          {serverError && (
            <p className="settlement-server-error" role="alert">
              {serverError}
            </p>
          )}
        </div>

        <footer className="order-dialog-actions">
          <button type="button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="is-primary" type="submit" disabled={isSaving}>
            {isSaving ? 'Completing…' : `Complete ${method === 'cash' ? 'cash' : method === 'online' ? 'online' : 'split'} payment`}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

export function CompletedOrderDialog({
  order,
  voidReason,
  onClose,
  onStartNewOrder,
  onVoid,
}: {
  order: Order;
  voidReason: string | null;
  onClose: () => void;
  onStartNewOrder: () => void;
  onVoid: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogLifecycle(dialogRef, onClose, false);
  const portions = paymentPortions(order);
  const isSplit = order.payments.some(
    (payment) => payment.method === PaymentMethod.CASH,
  ) && order.payments.some(
    (payment) => payment.method === PaymentMethod.ONLINE,
  );
  const changeDue = Math.max(0, (order.cashReceivedCents ?? portions.cash) - portions.cash);

  return (
    <DialogShell dialogRef={dialogRef} titleId="completed-order-title">
      <header className="order-dialog-header">
        <div>
          <span>{voidReason ? 'Void order' : 'Payment recorded'}</span>
          <h2 id="completed-order-title">
            Order #{order.dayOrderNumber} {voidReason ? 'is void' : 'completed'}
          </h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="order-dialog-body completed-order-summary">
        <dl>
          <div><dt>Amount due</dt><dd>{formatPeso(order.totalCents)}</dd></div>
          {(portions.cash > 0 || isSplit) && <div><dt>Cash payment</dt><dd>{formatPeso(portions.cash)}</dd></div>}
          {(portions.online > 0 || isSplit) && <div><dt>Online payment</dt><dd>{formatPeso(portions.online)}</dd></div>}
          <div className="is-tip"><dt>Cash tip (separate)</dt><dd>{formatPeso(order.cashTipCents)}</dd></div>
          {portions.cash > 0 && <div><dt>Change due</dt><dd>{formatPeso(changeDue)}</dd></div>}
          {order.changeOwedCents > 0 && (
            <div className="is-owed"><dt>Change still owed</dt><dd>{formatPeso(order.changeOwedCents)}</dd></div>
          )}
          <div><dt>Cashier</dt><dd>{order.cashierNameSnapshot ?? 'No cashier attribution'}</dd></div>
        </dl>
        {voidReason && (
          <div className="completed-void-note">
            <strong>Void reason</strong>
            <p>{voidReason}</p>
            <p>The original remains visible as void and does not count as revenue. Enter any corrected purchase as a new order.</p>
          </div>
        )}
      </div>
      <footer className="order-dialog-actions">
        {!voidReason && (
          <button className="is-danger" type="button" onClick={onVoid}>
            Void order
          </button>
        )}
        <button className="is-primary" type="button" onClick={onStartNewOrder}>
          Start new order
        </button>
      </footer>
    </DialogShell>
  );
}

export function VoidOrderDialog({
  order,
  isSaving,
  serverError,
  onClose,
  onConfirm,
}: {
  order: Order;
  isSaving: boolean;
  serverError: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  const [showError, setShowError] = useState(false);
  useDialogLifecycle(dialogRef, onClose, isSaving);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    setShowError(trimmed.length === 0);
    if (trimmed.length > 0) void onConfirm(trimmed);
  };

  return (
    <DialogShell dialogRef={dialogRef} titleId="void-order-title">
      <form onSubmit={submit} noValidate>
        <header className="order-dialog-header">
          <div>
            <span>Completed order #{order.dayOrderNumber}</span>
            <h2 id="void-order-title">Void this order?</h2>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving}>Close</button>
        </header>
        <div className="order-dialog-body">
          <p className="void-order-warning">
            The original order stays visible as void and will not count as revenue. A corrected purchase must be entered as a new order.
          </p>
          <label className="order-field">
            <span>Reason for void</span>
            <textarea
              rows={4}
              maxLength={255}
              value={reason}
              aria-invalid={showError}
              aria-describedby={showError ? 'void-reason-error' : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {showError && (
            <p id="void-reason-error" className="order-field-error" role="alert">
              Enter a reason before voiding the order.
            </p>
          )}
          {serverError && <p className="settlement-server-error" role="alert">{serverError}</p>}
        </div>
        <footer className="order-dialog-actions">
          <button type="button" onClick={onClose} disabled={isSaving}>Cancel</button>
          <button className="is-danger" type="submit" disabled={isSaving}>
            {isSaving ? 'Voiding…' : 'Void completed order'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}
