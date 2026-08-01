import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { ActiveCashier, SelectableStaffMember } from '@coffee-shop/shared';
import { getDeviceId } from '../auth/device';
import {
  CashierApiError,
  clearActiveCashier,
  getActiveCashier,
  listSelectableCashiers,
  selectActiveCashier,
} from './api';

type PickerStatus = 'loading' | 'ready' | 'error';
type DialogView = 'picker' | 'pin';

const PIN_LENGTH = 4;
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

function messageFor(error: unknown): string {
  return error instanceof CashierApiError
    ? error.message
    : 'Cashier selection could not be completed. Try again.';
}

function focusableControls(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not(:disabled)')];
}

export function CashierControl() {
  const deviceIdRef = useRef<string | null>(null);
  const indicatorRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeCashier, setActiveCashier] = useState<ActiveCashier | null>(null);
  const [activeLoadError, setActiveLoadError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<DialogView>('picker');
  const [pickerStatus, setPickerStatus] = useState<PickerStatus>('loading');
  const [cashiers, setCashiers] = useState<SelectableStaffMember[]>([]);
  const [pendingCashier, setPendingCashier] =
    useState<SelectableStaffMember | null>(null);
  const [pin, setPin] = useState('');
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  if (deviceIdRef.current === null) {
    deviceIdRef.current = getDeviceId();
  }
  const deviceId = deviceIdRef.current;

  const refreshActiveCashier = useCallback(async () => {
    try {
      const cashier = await getActiveCashier(deviceId);
      setActiveCashier(cashier);
      setActiveLoadError(false);
      return cashier;
    } catch {
      setActiveLoadError(true);
      return undefined;
    }
  }, [deviceId]);

  const loadCashiers = useCallback(async () => {
    setPickerStatus('loading');
    setFailureMessage(null);
    try {
      const selectable = await listSelectableCashiers();
      setCashiers(selectable);
      setPickerStatus('ready');
    } catch {
      setCashiers([]);
      setPickerStatus('error');
    }
  }, []);

  useEffect(() => {
    void refreshActiveCashier();
  }, [refreshActiveCashier]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() => {
      if (dialogRef.current) focusableControls(dialogRef.current)[0]?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, view, pickerStatus]);

  useEffect(() => {
    if (cooldownUntil === null) {
      setCooldownSeconds(0);
      return;
    }

    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownUntil - Date.now()) / 1000),
      );
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const resetAttempt = () => {
    setPendingCashier(null);
    setPin('');
    setFailureMessage(null);
    setCooldownUntil(null);
    setIsSubmitting(false);
  };

  const closeDialog = () => {
    setIsOpen(false);
    setView('picker');
    resetAttempt();
    queueMicrotask(() => indicatorRef.current?.focus());
  };

  const openPicker = () => {
    setIsOpen(true);
    setView('picker');
    resetAttempt();
    void loadCashiers();
  };

  const returnToPicker = () => {
    setView('picker');
    resetAttempt();
  };

  const chooseCashier = async (cashier: SelectableStaffMember) => {
    if (cashier.requiresPin) {
      setPendingCashier(cashier);
      setPin('');
      setFailureMessage(null);
      setView('pin');
      return;
    }

    setIsSubmitting(true);
    setFailureMessage(null);
    try {
      const selected = await selectActiveCashier(deviceId, cashier.id);
      setActiveCashier(selected);
      await refreshActiveCashier();
      setAnnouncement(`${selected.displayName} is now the active cashier.`);
      closeDialog();
    } catch (error) {
      const message = messageFor(error);
      setFailureMessage(message);
      setAnnouncement(message);
      setIsSubmitting(false);
    }
  };

  const submitPin = async () => {
    if (!pendingCashier || cooldownSeconds > 0 || isSubmitting) return;

    setIsSubmitting(true);
    setFailureMessage(null);
    try {
      const selected = await selectActiveCashier(
        deviceId,
        pendingCashier.id,
        pin,
      );
      setPin('');
      setActiveCashier(selected);
      await refreshActiveCashier();
      setAnnouncement(`${selected.displayName} is now the active cashier.`);
      closeDialog();
    } catch (error) {
      setPin('');
      const message = messageFor(error);
      setFailureMessage(message);
      setAnnouncement(message);
      if (
        error instanceof CashierApiError &&
        error.retryAfterSeconds !== null
      ) {
        setCooldownUntil(Date.now() + error.retryAfterSeconds * 1000);
      }
      setIsSubmitting(false);
    }
  };

  const clearCashier = async (closeAfter: boolean) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFailureMessage(null);
    try {
      await clearActiveCashier(deviceId);
      setActiveCashier(null);
      await refreshActiveCashier();
      setAnnouncement('Cashier selection cleared.');
      if (closeAfter) closeDialog();
      else setIsSubmitting(false);
    } catch (error) {
      const message = messageFor(error);
      setFailureMessage(message);
      setAnnouncement(message);
      setIsSubmitting(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const controls = focusableControls(dialogRef.current);
    if (controls.length === 0) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeDialog();
  };

  const activeName = activeCashier?.displayName ?? 'No cashier selected';

  return (
    <>
      <div className="cashier-shell-control">
        <button
          ref={indicatorRef}
          className="cashier-indicator"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={openPicker}
        >
          <span className="cashier-indicator-label">Active cashier</span>
          <strong>{activeName}</strong>
          <span className="cashier-indicator-action">Change</span>
        </button>
        {activeCashier !== null && (
          <button
            className="cashier-shell-clear"
            type="button"
            disabled={isSubmitting}
            onClick={() => void clearCashier(false)}
          >
            Clear
          </button>
        )}
        {activeLoadError && (
          <button
            className="cashier-refresh"
            type="button"
            onClick={() => void refreshActiveCashier()}
          >
            Refresh cashier
          </button>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      {isOpen &&
        createPortal(
          <div
            className="cashier-dialog-backdrop"
            onMouseDown={handleBackdropClick}
          >
            <div
              ref={dialogRef}
              className="cashier-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cashier-dialog-title"
              aria-describedby="cashier-dialog-description"
              onKeyDown={handleDialogKeyDown}
            >
              <header className="cashier-dialog-header">
                <div>
                  <h2 id="cashier-dialog-title">
                    {view === 'picker' ? 'Select cashier' : 'Cashier PIN'}
                  </h2>
                  <p id="cashier-dialog-description">
                    {view === 'picker'
                      ? 'Choose who should be attributed to new orders on this register.'
                      : 'The signed-in POS user will not change.'}
                  </p>
                </div>
                <button
                  className="cashier-dialog-close"
                  type="button"
                  aria-label="Close cashier selection"
                  onClick={closeDialog}
                >
                  ×
                </button>
              </header>

              {view === 'picker' ? (
                <div className="cashier-dialog-body">
                  <div className="cashier-current-summary">
                    <span>Current selection</span>
                    <strong>{activeName}</strong>
                  </div>

                  {pickerStatus === 'loading' && (
                    <div
                      className="cashier-card-grid"
                      aria-label="Loading selectable cashiers"
                    >
                      <span className="cashier-card-skeleton" />
                      <span className="cashier-card-skeleton" />
                    </div>
                  )}

                  {pickerStatus === 'error' && (
                    <div className="cashier-picker-state" role="status">
                      <strong>Cashiers could not be loaded</strong>
                      <span>Check the connection, then try again.</span>
                      <button type="button" onClick={() => void loadCashiers()}>
                        Try again
                      </button>
                    </div>
                  )}

                  {pickerStatus === 'ready' && cashiers.length === 0 && (
                    <div className="cashier-picker-state" role="status">
                      <strong>No selectable staff members</strong>
                      <span>You can continue with no cashier selected.</span>
                    </div>
                  )}

                  {pickerStatus === 'ready' && cashiers.length > 0 && (
                    <div className="cashier-card-grid">
                      {cashiers.map((cashier) => {
                        const isActive = activeCashier?.id === cashier.id;
                        return (
                          <button
                            key={cashier.id}
                            className="cashier-card"
                            type="button"
                            aria-current={isActive ? 'true' : undefined}
                            disabled={isSubmitting}
                            onClick={() => void chooseCashier(cashier)}
                          >
                            <span>
                              <strong>{cashier.displayName}</strong>
                              {isActive && <small>Currently active</small>}
                            </span>
                            <small>
                              {cashier.requiresPin ? 'PIN required' : 'Selects now'}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {failureMessage && (
                    <div className="cashier-failure" role="alert">
                      {failureMessage}
                    </div>
                  )}

                  <div className="cashier-dialog-actions">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void clearCashier(true)}
                    >
                      Clear selection
                    </button>
                    <button type="button" onClick={closeDialog}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cashier-dialog-body cashier-pin-layout">
                  <div className="cashier-pin-copy">
                    <h3>Enter PIN for {pendingCashier?.displayName}</h3>
                    <p>Use the keypad to enter the 4-digit PIN.</p>
                    <div
                      className="cashier-pin-slots"
                      role="img"
                      aria-label={`${pin.length} of ${PIN_LENGTH} PIN digits entered`}
                    >
                      {Array.from({ length: PIN_LENGTH }, (_, index) => (
                        <span
                          key={index}
                          className={index < pin.length ? 'is-filled' : undefined}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                    <span className="sr-only">PIN digits are masked.</span>
                    {failureMessage && (
                      <div className="cashier-failure" role="alert">
                        {failureMessage}
                      </div>
                    )}
                    {cooldownSeconds > 0 && (
                      <p className="cashier-cooldown" aria-live="polite">
                        Keypad unavailable for {cooldownSeconds} seconds.
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="cashier-keypad" aria-label="PIN keypad">
                      {KEYPAD_DIGITS.map((digit) => (
                        <button
                          key={digit}
                          type="button"
                          disabled={
                            cooldownSeconds > 0 ||
                            isSubmitting ||
                            pin.length === PIN_LENGTH
                          }
                          onClick={() => {
                            setPin((value) => `${value}${digit}`);
                            setFailureMessage(null);
                          }}
                        >
                          {digit}
                        </button>
                      ))}
                      <button type="button" onClick={returnToPicker}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={
                          cooldownSeconds > 0 ||
                          isSubmitting ||
                          pin.length === PIN_LENGTH
                        }
                        onClick={() => {
                          setPin((value) => `${value}0`);
                          setFailureMessage(null);
                        }}
                      >
                        0
                      </button>
                      <button
                        type="button"
                        aria-label="Delete last PIN digit"
                        disabled={
                          cooldownSeconds > 0 || isSubmitting || pin.length === 0
                        }
                        onClick={() => {
                          setPin((value) => value.slice(0, -1));
                          setFailureMessage(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="cashier-dialog-actions cashier-pin-actions">
                      <button type="button" onClick={returnToPicker}>
                        Back
                      </button>
                      <button
                        className="is-primary"
                        type="button"
                        disabled={cooldownSeconds > 0 || isSubmitting}
                        onClick={() => void submitPin()}
                      >
                        {isSubmitting ? 'Checking…' : 'Confirm PIN'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
