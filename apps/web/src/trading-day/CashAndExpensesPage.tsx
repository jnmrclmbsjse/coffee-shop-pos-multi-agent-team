import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  CashMovementKind,
  cents,
  type CashMovement,
  type CreateCashMovementInput,
  type CurrentOpenBusinessDay,
  type InventoryStaffOption,
  type MoneyCents,
} from '@coffee-shop/shared';
import { formatMoney } from '../reporting/format';
import { StaffPageHeading } from '../staff/StaffPageHeading';
import { useStaffWorkspaceBusinessDay } from '../staff/StaffWorkspace';
import {
  TradingDayApiError,
  getCurrentBusinessDay,
  getCurrentCashMovements,
  listActiveTradingDayStaff,
  recordCashMovement,
} from './api';

const MAX_AMOUNT_CENTS = 2_147_483_647;

interface FieldErrors {
  amount?: string;
  reason?: string;
  category?: string;
  recordedBy?: string;
}

interface RetryIdentity {
  signature: string;
  id: string;
}

const KIND_OPTIONS = [
  {
    value: CashMovementKind.CASH_IN,
    label: 'Cash in',
    description: 'Adds to drawer',
  },
  {
    value: CashMovementKind.CASH_OUT,
    label: 'Cash out',
    description: 'Reduces drawer',
  },
  {
    value: CashMovementKind.EXPENSE,
    label: 'Expense',
    description: 'Reduces drawer',
  },
] as const;

export function parseCashAmount(value: string): MoneyCents | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;

  const wholeCents = Number(match[1]) * 100;
  const fractionalCents = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const amountCents = wholeCents + fractionalCents;
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < 1 ||
    amountCents > MAX_AMOUNT_CENTS
  ) {
    return null;
  }
  return cents(amountCents);
}

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
}

function dayTypeLabel(day: CurrentOpenBusinessDay): string {
  return day.dayType === 'PEAK' ? 'Peak day' : 'Normal day';
}

function movementLabel(kind: CashMovementKind): string {
  if (kind === CashMovementKind.CASH_IN) return 'Cash in';
  if (kind === CashMovementKind.CASH_OUT) return 'Cash out';
  return 'Expense';
}

function recordedTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function serverFieldErrors(messages: string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const message of messages) {
    if (message.includes('amountCents')) {
      errors.amount = 'Enter an amount from ₱0.01 to ₱21,474,836.47 with up to two decimal places.';
    } else if (message.includes('description')) {
      errors.reason = 'Enter a reason containing at least one non-space character.';
    } else if (message.includes('category')) {
      errors.category = message;
    } else if (message.toLowerCase().includes('staff')) {
      errors.recordedBy = message;
    }
  }
  return errors;
}

function fieldErrorId(name: keyof FieldErrors): string {
  return `cash-${name}-error`;
}

function focusFirstError(form: HTMLFormElement, errors: FieldErrors) {
  const firstName = (['amount', 'reason', 'category', 'recordedBy'] as const)
    .find((name) => errors[name]);
  const field = firstName ? form.elements.namedItem(firstName) : null;
  if (field instanceof HTMLElement) field.focus();
}

export function CashMovementDetail({ movement }: { movement: CashMovement }) {
  if (movement.kind === CashMovementKind.EXPENSE && movement.category) {
    return <span>{movement.category} / {movement.description}</span>;
  }
  return <span>{movement.description}</span>;
}

function CashMovementLedger({ movements }: { movements: CashMovement[] }) {
  return (
    <section className="staff-cash-ledger" aria-labelledby="cash-ledger-title">
      <div className="staff-cash-ledger-heading">
        <div>
          <h2 id="cash-ledger-title">Today&apos;s entries</h2>
          <p>Newest recorded entry first. Entries are read only.</p>
        </div>
        <span>{movements.length} {movements.length === 1 ? 'entry' : 'entries'}</span>
      </div>
      {movements.length === 0 ? (
        <div className="staff-cash-empty" role="status">
          <h3>No cash entries yet</h3>
          <p>Cash movements and expenses recorded for this business day will appear here.</p>
        </div>
      ) : (
        <div
          className="staff-cash-table-wrap"
          role="region"
          aria-label="Current business day cash entries"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Amount</th>
                <th scope="col">Detail</th>
                <th scope="col">By</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td>
                    <span className="staff-cash-kind" data-kind={movement.kind}>
                      <span aria-hidden="true">
                        {movement.kind === CashMovementKind.CASH_IN ? '+' : '−'}
                      </span>
                      {movementLabel(movement.kind)}
                    </span>
                  </td>
                  <td className="staff-cash-amount">{formatMoney(movement.amountCents)}</td>
                  <td className="staff-cash-detail">
                    <CashMovementDetail movement={movement} />
                  </td>
                  <td>{movement.recordedByNameSnapshot ?? 'Unattributed'}</td>
                  <td>{recordedTime(movement.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NoOpenDay({ closedDuringSubmit }: { closedDuringSubmit: boolean }) {
  return (
    <section className="staff-inventory-blocking staff-cash-no-day" role="status">
      <h2>No business day is open</h2>
      <p>
        {closedDuringSubmit
          ? 'The business day closed before the entry was recorded. No entry was saved.'
          : 'Open a business day before recording cash movements or expenses.'}
      </p>
      <Link className="staff-inventory-button primary" to="/pos/open">
        Open business day
      </Link>
    </section>
  );
}

export function CashAndExpensesPage() {
  const { setBusinessDay: setWorkspaceBusinessDay } =
    useStaffWorkspaceBusinessDay();
  const [businessDay, setBusinessDay] = useState<CurrentOpenBusinessDay | null>(null);
  const [staff, setStaff] = useState<InventoryStaffOption[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [kind, setKind] = useState(CashMovementKind.CASH_IN);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('');
  const [recordedBy, setRecordedBy] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [closedDuringSubmit, setClosedDuringSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const retryIdentity = useRef<RetryIdentity | null>(null);

  useEffect(() => {
    document.title = 'Cash & Expenses · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    void getCurrentBusinessDay()
      .then(async (day) => {
        if (!active) return;
        setBusinessDay(day);
        setWorkspaceBusinessDay(day);
        if (!day.isOpen) {
          setMovements([]);
          setStaff([]);
          return;
        }
        const [ledger, activeStaff] = await Promise.all([
          getCurrentCashMovements(),
          listActiveTradingDayStaff(),
        ]);
        if (!active) return;
        setBusinessDay(ledger.businessDay);
        setWorkspaceBusinessDay(ledger.businessDay);
        setMovements(ledger.movements);
        setStaff(activeStaff);
      })
      .catch(() => {
        if (active) setLoadError('Cash and expenses could not be loaded. Try again.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, setWorkspaceBusinessDay]);

  function changeKind(nextKind: CashMovementKind) {
    setKind(nextKind);
    if (nextKind !== CashMovementKind.EXPENSE) {
      setCategory('');
      setFieldErrors((current) => ({ ...current, category: undefined }));
    }
    setFormMessage('');
    setSuccessMessage('');
    retryIdentity.current = null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current) return;
    const form = event.currentTarget;

    const amountCents = parseCashAmount(amount);
    const trimmedReason = reason.trim();
    const trimmedCategory = category.trim();
    const nextErrors: FieldErrors = {};
    if (amountCents === null) {
      nextErrors.amount = 'Enter an amount from ₱0.01 to ₱21,474,836.47 with up to two decimal places.';
    }
    if (!trimmedReason) {
      nextErrors.reason = 'Enter a reason containing at least one non-space character.';
    }
    setFieldErrors(nextErrors);
    setFormMessage('');
    setSuccessMessage('');
    if (Object.keys(nextErrors).length > 0 || amountCents === null) {
      focusFirstError(form, nextErrors);
      return;
    }

    const payloadWithoutId = {
      kind,
      amountCents,
      description: trimmedReason,
      ...(kind === CashMovementKind.EXPENSE && trimmedCategory
        ? { category: trimmedCategory }
        : {}),
      ...(recordedBy ? { recordedByStaffMemberId: recordedBy } : {}),
    };
    const signature = JSON.stringify(payloadWithoutId);
    if (retryIdentity.current?.signature !== signature) {
      retryIdentity.current = { signature, id: crypto.randomUUID() };
    }
    const payload: CreateCashMovementInput = {
      clientGeneratedId: retryIdentity.current.id,
      ...payloadWithoutId,
    };

    submitInFlight.current = true;
    setIsSubmitting(true);
    try {
      const movement = await recordCashMovement(payload);
      setMovements((current) => [
        movement,
        ...current.filter((entry) => entry.id !== movement.id),
      ]);
      setAmount('');
      setReason('');
      setCategory('');
      setRecordedBy('');
      retryIdentity.current = null;
      setSuccessMessage('Entry recorded. It is now the first row in today\'s ledger.');
    } catch (error) {
      if (error instanceof TradingDayApiError) {
        const mappedErrors = serverFieldErrors(error.messages);
        if (Object.keys(mappedErrors).length > 0) {
          setFieldErrors(mappedErrors);
          requestAnimationFrame(() => focusFirstError(form, mappedErrors));
        } else if (
          error.status === 409 ||
          error.messages.some((message) => message.toLowerCase().includes('no business day'))
        ) {
          setFormMessage('The business day closed before this entry was recorded. No entry was saved.');
          setClosedDuringSubmit(true);
          setLoadAttempt((attempt) => attempt + 1);
        } else {
          setFormMessage(error.messages.join(' '));
        }
      } else {
        setFormMessage('The entry could not be recorded. Try again.');
      }
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  const categoryVisible = kind === CashMovementKind.EXPENSE;

  return (
    <main id="staff-main" className="staff-inventory-workspace staff-inventory-screen staff-cash-page">
      <StaffPageHeading
        title="Cash & Expenses"
        description="Record permanent drawer movements, then review the current business day ledger."
      />

      {loadError ? (
        <div className="staff-inventory-blocking" role="alert">
          <p>{loadError}</p>
          <button className="staff-inventory-button secondary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Try again
          </button>
        </div>
      ) : isLoading || businessDay === null ? (
        <div className="staff-inventory-loading" aria-live="polite">
          <span>Loading cash and expenses…</span>
          <div aria-hidden="true" />
          <div aria-hidden="true" />
          <div aria-hidden="true" />
        </div>
      ) : !businessDay.isOpen ? (
        <NoOpenDay closedDuringSubmit={closedDuringSubmit} />
      ) : (
        <>
          <section className="staff-cash-day-context" aria-labelledby="cash-day-context-title">
            <div>
              <span id="cash-day-context-title">This entry will be written to</span>
              <strong>{formatBusinessDate(businessDay.businessDate!)}</strong>
            </div>
            <span>{dayTypeLabel(businessDay)}</span>
          </section>

          <div className="staff-cash-layout">
            <section className="staff-inventory-panel staff-cash-entry-panel" aria-labelledby="cash-entry-title">
              <header>
                <h2 id="cash-entry-title">Record an entry</h2>
                <p>Entries are permanent.</p>
              </header>
              <form noValidate onSubmit={handleSubmit}>
                <fieldset className="staff-cash-type">
                  <legend>Type <span aria-hidden="true">*</span></legend>
                  <div className="staff-cash-type-options">
                    {KIND_OPTIONS.map((option) => (
                      <label key={option.value}>
                        <input
                          type="radio"
                          name="kind"
                          value={option.value}
                          checked={kind === option.value}
                          disabled={isSubmitting}
                          onChange={() => changeKind(option.value)}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                          {kind === option.value && <em>Selected</em>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="staff-inventory-field">
                  <label htmlFor="cash-amount">Amount <span className="staff-inventory-required" aria-hidden="true">*</span></label>
                  <div className="staff-cash-amount-input">
                    <span aria-hidden="true">₱</span>
                    <input
                      id="cash-amount"
                      name="amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      required
                      aria-required="true"
                      aria-invalid={Boolean(fieldErrors.amount)}
                      aria-describedby={fieldErrors.amount ? fieldErrorId('amount') : 'cash-amount-help'}
                      placeholder="0.00"
                      value={amount}
                      disabled={isSubmitting}
                      onChange={(changeEvent) => {
                        setAmount(changeEvent.target.value);
                        setFieldErrors((current) => ({ ...current, amount: undefined }));
                        setFormMessage('');
                        setSuccessMessage('');
                      }}
                    />
                  </div>
                  <p className="staff-cash-field-help" id="cash-amount-help">Pesos, up to two decimal places.</p>
                  {fieldErrors.amount && <p className="staff-inventory-field-error" id={fieldErrorId('amount')}>{fieldErrors.amount}</p>}
                </div>

                <div className="staff-inventory-field">
                  <label htmlFor="cash-reason">Reason <span className="staff-inventory-required" aria-hidden="true">*</span></label>
                  <textarea
                    id="cash-reason"
                    name="reason"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(fieldErrors.reason)}
                    aria-describedby={fieldErrors.reason ? fieldErrorId('reason') : undefined}
                    placeholder="What was this entry for?"
                    value={reason}
                    disabled={isSubmitting}
                    onChange={(changeEvent) => {
                      setReason(changeEvent.target.value);
                      setFieldErrors((current) => ({ ...current, reason: undefined }));
                      setFormMessage('');
                      setSuccessMessage('');
                    }}
                  />
                  {fieldErrors.reason && <p className="staff-inventory-field-error" id={fieldErrorId('reason')}>{fieldErrors.reason}</p>}
                </div>

                <div className={`staff-cash-category-slot${categoryVisible ? ' is-visible' : ''}`} aria-hidden={!categoryVisible}>
                  <div className="staff-inventory-field">
                    <label htmlFor="cash-category">Category <span className="staff-inventory-helper">(optional)</span></label>
                    <input
                      id="cash-category"
                      name="category"
                      type="text"
                      disabled={!categoryVisible || isSubmitting}
                      tabIndex={categoryVisible ? 0 : -1}
                      aria-invalid={Boolean(fieldErrors.category)}
                      aria-describedby={fieldErrors.category ? fieldErrorId('category') : undefined}
                      placeholder="e.g. Supplies"
                      value={category}
                      onChange={(changeEvent) => {
                        setCategory(changeEvent.target.value);
                        setFieldErrors((current) => ({ ...current, category: undefined }));
                        setFormMessage('');
                        setSuccessMessage('');
                      }}
                    />
                    {fieldErrors.category && <p className="staff-inventory-field-error" id={fieldErrorId('category')}>{fieldErrors.category}</p>}
                  </div>
                </div>

                <div className="staff-inventory-field">
                  <label htmlFor="cash-recorded-by">Recorded by <span className="staff-inventory-helper">(optional)</span></label>
                  <select
                    id="cash-recorded-by"
                    name="recordedBy"
                    value={recordedBy}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(fieldErrors.recordedBy)}
                    aria-describedby={fieldErrors.recordedBy ? fieldErrorId('recordedBy') : undefined}
                    onChange={(changeEvent) => {
                      setRecordedBy(changeEvent.target.value);
                      setFieldErrors((current) => ({ ...current, recordedBy: undefined }));
                      setFormMessage('');
                      setSuccessMessage('');
                    }}
                  >
                    <option value="">No one (Unattributed)</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                  </select>
                  {fieldErrors.recordedBy && <p className="staff-inventory-field-error" id={fieldErrorId('recordedBy')}>{fieldErrors.recordedBy}</p>}
                </div>

                <p className="staff-cash-permanence"><strong>Permanent record.</strong> Check the amount and reason before recording. Entries cannot be edited, deleted, or undone.</p>
                {formMessage && <div className="staff-inventory-message error" role="alert"><p>{formMessage}</p></div>}
                {successMessage && <div className="staff-inventory-message success" role="status"><p>{successMessage}</p></div>}
                <div className="staff-inventory-actions">
                  <button className="staff-inventory-button primary" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Recording…' : 'Record entry'}
                  </button>
                  {isSubmitting && <span role="status">Recording one entry. The form is locked to prevent duplicates.</span>}
                </div>
              </form>
            </section>
            <CashMovementLedger movements={movements} />
          </div>
        </>
      )}
    </main>
  );
}
