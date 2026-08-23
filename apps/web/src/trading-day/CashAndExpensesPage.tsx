import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import {
  CashMovementKind,
  cents,
  type AmendCashMovementInput,
  type CashMovement,
  type CreateCashMovementInput,
  type CurrentOpenBusinessDay,
  type InventoryStaffOption,
  type MoneyCents,
  type TradingDayClosingSummary,
} from '@coffee-shop/shared';
import {
  defaultStaffSelection,
  useSignedInStaffMemberId,
} from '../auth/signed-in-staff';
import { formatMoney } from '../reporting/format';
import { StaffPageHeading } from '../staff/StaffPageHeading';
import { useStaffWorkspaceBusinessDay } from '../staff/StaffWorkspace';
import {
  TradingDayApiError,
  amendCashMovement,
  getCurrentBusinessDay,
  getCurrentCashMovements,
  getClosingSummary,
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

interface AmendmentDraft {
  kind: CashMovementKind;
  amount: string;
  reason: string;
  category: string;
}

interface AmendmentReview {
  clientGeneratedId: string;
  amountCents: MoneyCents;
  kind: CashMovementKind;
  description: string;
  category: string | null;
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

function fieldErrorId(name: keyof FieldErrors, prefix = 'cash'): string {
  return `${prefix}-${name}-error`;
}

function focusFirstError(form: HTMLFormElement, errors: FieldErrors) {
  const firstName = (['amount', 'reason', 'category', 'recordedBy'] as const)
    .find((name) => errors[name]);
  const field = firstName ? form.elements.namedItem(firstName) : null;
  if (field instanceof HTMLElement) field.focus();
}

function validateMovementFields(amount: string, reason: string): {
  amountCents: MoneyCents | null;
  errors: FieldErrors;
} {
  const amountCents = parseCashAmount(amount);
  const errors: FieldErrors = {};
  if (amountCents === null) {
    errors.amount = 'Enter an amount from ₱0.01 to ₱21,474,836.47 with up to two decimal places.';
  }
  if (!reason.trim()) {
    errors.reason = 'Enter a reason containing at least one non-space character.';
  }
  return { amountCents, errors };
}

export function CashMovementDetail({ movement }: { movement: CashMovement }) {
  if (movement.kind === CashMovementKind.EXPENSE && movement.category) {
    return <span>{movement.category} / {movement.description}</span>;
  }
  return <span>{movement.description}</span>;
}

function entryReference(id: string): string {
  const compactId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
    ? `${id.slice(0, 8)}…${id.slice(-4)}`
    : id;
  return `Entry ${compactId}`;
}

function inputAmount(amountCents: MoneyCents): string {
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`;
}

function movementCategory(movement: CashMovement): string {
  if (movement.kind !== CashMovementKind.EXPENSE) return 'Not applicable';
  return movement.category || 'None';
}

function chainPosition(
  movement: CashMovement,
  movementsById: Map<string, CashMovement>,
): string | null {
  if (!movement.amendsCashMovementId && !movement.supersededByCashMovementId) {
    return null;
  }

  let position = 0;
  let current = movement;
  const visited = new Set([current.id]);
  while (current.amendsCashMovementId) {
    const previous = movementsById.get(current.amendsCashMovementId);
    if (!previous || visited.has(previous.id)) break;
    visited.add(previous.id);
    current = previous;
    position += 1;
  }

  let correctionCount = position;
  current = movement;
  while (current.supersededByCashMovementId) {
    const next = movementsById.get(current.supersededByCashMovementId);
    if (!next || visited.has(next.id)) break;
    visited.add(next.id);
    current = next;
    correctionCount += 1;
  }

  return position === 0
    ? 'Original'
    : `Correction ${position} of ${correctionCount}`;
}

function movementLinkCopy(
  movement: CashMovement,
  movementsById: Map<string, CashMovement>,
): string {
  const parts: string[] = [];
  if (movement.amendsCashMovementId) {
    parts.push(`Corrects ${entryReference(movement.amendsCashMovementId)}.`);
  }
  if (movement.supersededByCashMovementId) {
    const correction = movementsById.get(movement.supersededByCashMovementId);
    const correctionSummary = correction
      ? ` to ${formatMoney(correction.amountCents)} ${movementLabel(correction.kind)}`
      : '';
    parts.push(
      `${movement.amendsCashMovementId ? 'Corrected again by' : 'Corrected by'} ${entryReference(movement.supersededByCashMovementId)}${correctionSummary}.`,
    );
  } else if (movement.amendsCashMovementId) {
    parts.push(
      `Effective amount: ${formatMoney(movement.amountCents)} ${movementLabel(movement.kind)}.`,
    );
  }
  return parts.join(' ');
}

function CashMovementLedger({
  movements,
  selectedMovementId,
  onAmend,
}: {
  movements: CashMovement[];
  selectedMovementId: string | null;
  onAmend: (movement: CashMovement) => void;
}) {
  const movementsById = new Map(
    movements.map((movement) => [movement.id, movement]),
  );
  return (
    <section className="staff-cash-ledger" aria-labelledby="cash-ledger-title">
      <div className="staff-cash-ledger-heading">
        <div>
          <h2 id="cash-ledger-title">Today&apos;s entries</h2>
          <p>Newest recorded entry first. Every entry remains in the ledger.</p>
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
                <th scope="col">Record status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => {
                const isSuperseded = movement.supersededByCashMovementId !== null;
                const linkCopy = movementLinkCopy(movement, movementsById);
                const position = chainPosition(movement, movementsById);
                const actionNoteId = `cash-amend-note-${movement.id}`;
                const actionNote = isSuperseded
                  ? `Already corrected by ${entryReference(movement.supersededByCashMovementId!)}.`
                  : selectedMovementId === movement.id
                    ? 'Amendment in progress.'
                    : '';
                const rowLabel = `${movementLabel(movement.kind)} ${formatMoney(movement.amountCents)}. ${isSuperseded ? 'Superseded' : 'Effective'}. ${linkCopy}`;
                return (
                <tr
                  key={movement.id}
                  className={isSuperseded ? 'staff-cash-row-superseded' : movement.amendsCashMovementId ? 'staff-cash-row-correction' : undefined}
                >
                  <th scope="row" aria-label={rowLabel}>
                    <span className="staff-cash-kind" data-kind={movement.kind}>
                      <span aria-hidden="true">
                        {movement.kind === CashMovementKind.CASH_IN ? '+' : '−'}
                      </span>
                      {movementLabel(movement.kind)}
                    </span>
                    {position && <span className="staff-cash-chain-position">{position}</span>}
                  </th>
                  <td className="staff-cash-amount">{formatMoney(movement.amountCents)}</td>
                  <td className="staff-cash-detail">
                    <CashMovementDetail movement={movement} />
                  </td>
                  <td>{movement.recordedByNameSnapshot ?? 'Unattributed'}</td>
                  <td>{recordedTime(movement.recordedAt)}</td>
                  <td>
                    <span className={`staff-cash-status ${isSuperseded ? 'superseded' : 'effective'}`}>
                      {isSuperseded ? 'Superseded' : 'Effective'}
                    </span>
                    {linkCopy && <span className="staff-cash-link-copy">{linkCopy}</span>}
                  </td>
                  <td>
                    <button
                      className="staff-cash-row-action"
                      type="button"
                      disabled={Boolean(actionNote)}
                      aria-describedby={actionNote ? actionNoteId : undefined}
                      aria-label={actionNote ? undefined : `Amend ${movementLabel(movement.kind)} ${formatMoney(movement.amountCents)}, ${movement.description}`}
                      onClick={() => onAmend(movement)}
                    >
                      Amend
                    </button>
                    {actionNote && <span className="staff-cash-action-note" id={actionNoteId}>{actionNote}</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MovementValues({
  kind,
  amountCents,
  description,
  category,
}: {
  kind: CashMovementKind;
  amountCents: MoneyCents;
  description: string;
  category: string | null;
}) {
  return (
    <dl className="staff-cash-value-grid">
      <div><dt>Type</dt><dd>{movementLabel(kind)}</dd></div>
      <div><dt>Amount</dt><dd className="staff-cash-money-value">{formatMoney(amountCents)}</dd></div>
      <div><dt>Description</dt><dd>{description}</dd></div>
      <div><dt>Category</dt><dd>{kind === CashMovementKind.EXPENSE ? category || 'None' : 'Not applicable'}</dd></div>
    </dl>
  );
}

function AmendmentEditor({
  target,
  draft,
  fieldErrors,
  formRef,
  announcement,
  message,
  onDraftChange,
  onKindChange,
  onSubmit,
  onCancel,
}: {
  target: CashMovement;
  draft: AmendmentDraft;
  fieldErrors: FieldErrors;
  formRef: RefObject<HTMLFormElement | null>;
  announcement: string;
  message: string;
  onDraftChange: (changes: Partial<AmendmentDraft>) => void;
  onKindChange: (kind: CashMovementKind) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const categoryVisible = draft.kind === CashMovementKind.EXPENSE;
  return (
    <section className="staff-inventory-panel staff-cash-entry-panel" aria-labelledby="cash-amend-title">
      <header>
        <h2 id="cash-amend-title" tabIndex={-1}>Amend entry</h2>
        <p>Enter the corrected values in full.</p>
      </header>
      <div className="staff-cash-original" aria-labelledby="cash-original-title">
        <h3 id="cash-original-title">Original entry, {entryReference(target.id)}</h3>
        <MovementValues {...target} />
      </div>
      <form ref={formRef} noValidate onSubmit={onSubmit}>
        <fieldset className="staff-cash-type">
          <legend>Correct type <span aria-hidden="true">*</span></legend>
          <div className="staff-cash-type-options">
            {KIND_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={draft.kind === option.value}
                  onChange={() => onKindChange(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                  {draft.kind === option.value && <em>Selected</em>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="staff-inventory-field">
          <label htmlFor="cash-amend-amount">Correct amount <span className="staff-inventory-required" aria-hidden="true">*</span></label>
          <div className="staff-cash-amount-input">
            <span aria-hidden="true">₱</span>
            <input
              id="cash-amend-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              aria-required="true"
              aria-invalid={Boolean(fieldErrors.amount)}
              aria-describedby={fieldErrors.amount ? fieldErrorId('amount', 'cash-amend') : 'cash-amend-amount-help'}
              value={draft.amount}
              onChange={(event) => onDraftChange({ amount: event.target.value })}
            />
          </div>
          <p className="staff-cash-field-help" id="cash-amend-amount-help">Enter a positive peso amount. Direction comes from the type.</p>
          {fieldErrors.amount && <p className="staff-inventory-field-error" id={fieldErrorId('amount', 'cash-amend')}>{fieldErrors.amount}</p>}
        </div>

        <div className="staff-inventory-field">
          <label htmlFor="cash-amend-reason">Correct description <span className="staff-inventory-required" aria-hidden="true">*</span></label>
          <textarea
            id="cash-amend-reason"
            name="reason"
            required
            aria-required="true"
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={fieldErrors.reason ? fieldErrorId('reason', 'cash-amend') : undefined}
            value={draft.reason}
            onChange={(event) => onDraftChange({ reason: event.target.value })}
          />
          {fieldErrors.reason && <p className="staff-inventory-field-error" id={fieldErrorId('reason', 'cash-amend')}>{fieldErrors.reason}</p>}
        </div>

        <div className={`staff-cash-category-slot${categoryVisible ? ' is-visible' : ''}`} aria-hidden={!categoryVisible}>
          {categoryVisible ? (
            <div className="staff-inventory-field">
              <label htmlFor="cash-amend-category">Category <span className="staff-inventory-helper">(optional)</span></label>
              <input
                id="cash-amend-category"
                name="category"
                type="text"
                aria-invalid={Boolean(fieldErrors.category)}
                aria-describedby={fieldErrors.category ? fieldErrorId('category', 'cash-amend') : 'cash-amend-category-help'}
                placeholder="e.g. Supplies"
                value={draft.category}
                onChange={(event) => onDraftChange({ category: event.target.value })}
              />
              <p className="staff-cash-field-help" id="cash-amend-category-help">Category is accepted only for an expense.</p>
              {fieldErrors.category && <p className="staff-inventory-field-error" id={fieldErrorId('category', 'cash-amend')}>{fieldErrors.category}</p>}
            </div>
          ) : (
            <p className="staff-cash-category-note">Category is not available for {movementLabel(draft.kind)}.</p>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
        <p className="staff-cash-permanence"><strong>The original stays visible.</strong> This records one linked correction. It does not edit or delete {entryReference(target.id)}.</p>
        {message && <div className="staff-inventory-message error" role="alert"><p>{message}</p></div>}
        <div className="staff-inventory-actions">
          <button className="staff-inventory-button primary" type="submit">Review correction</button>
          <button className="staff-inventory-button secondary" type="button" onClick={onCancel}>Cancel, record nothing</button>
        </div>
      </form>
    </section>
  );
}

function ReviewValue({
  label,
  value,
  changed,
}: {
  label: string;
  value: string;
  changed?: boolean;
}) {
  return (
    <div className={changed ? 'changed' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <span>{changed === undefined ? 'Recorded value' : changed ? 'Changed' : 'Unchanged'}</span>
    </div>
  );
}

function AmendmentReviewPanel({
  target,
  review,
  isSubmitting,
  message,
  onConfirm,
  onEdit,
  onCancel,
  onRefresh,
}: {
  target: CashMovement;
  review: AmendmentReview;
  isSubmitting: boolean;
  message: string;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onRefresh: (() => void) | null;
}) {
  const originalCategory = movementCategory(target);
  const correctedCategory = review.kind === CashMovementKind.EXPENSE
    ? review.category || 'None'
    : 'Not applicable';
  return (
    <section className="staff-inventory-panel staff-cash-review" aria-labelledby="cash-review-title">
      <header>
        <h2 id="cash-review-title" tabIndex={-1}>Review correction</h2>
        <p role="status">Nothing has been recorded yet. Compare both records before confirming.</p>
      </header>
      <div className="staff-cash-compare-grid">
        <section aria-labelledby="cash-review-original-title">
          <h3 id="cash-review-original-title">Original, {entryReference(target.id)}</h3>
          <dl>
            <ReviewValue label="Type" value={movementLabel(target.kind)} />
            <ReviewValue label="Amount" value={formatMoney(target.amountCents)} />
            <ReviewValue label="Description" value={target.description} />
            <ReviewValue label="Category" value={originalCategory} />
          </dl>
        </section>
        <section className="proposed" aria-labelledby="cash-review-proposed-title">
          <h3 id="cash-review-proposed-title">Proposed correction</h3>
          <dl>
            <ReviewValue label="Type" value={movementLabel(review.kind)} changed={target.kind !== review.kind} />
            <ReviewValue label="Amount" value={formatMoney(review.amountCents)} changed={target.amountCents !== review.amountCents} />
            <ReviewValue label="Description" value={review.description} changed={target.description !== review.description} />
            <ReviewValue label="Category" value={correctedCategory} changed={originalCategory !== correctedCategory} />
          </dl>
        </section>
      </div>
      <p className="staff-cash-review-assurance"><strong>Confirm records one correction.</strong> The original stays in the ledger, and only the effective correction counts in totals.</p>
      {message && <div className="staff-inventory-message error" role="alert"><p>{message}</p>{onRefresh && <button className="staff-inventory-button secondary" type="button" onClick={onRefresh}>Refresh ledger</button>}</div>}
      <div className="staff-inventory-actions">
        <button className="staff-inventory-button primary" type="button" disabled={isSubmitting} onClick={onConfirm}>{isSubmitting ? 'Confirming…' : 'Confirm correction'}</button>
        <button className="staff-inventory-button secondary" type="button" disabled={isSubmitting} onClick={onEdit}>Edit corrected values</button>
        <button className="staff-inventory-button secondary" type="button" disabled={isSubmitting} onClick={onCancel}>Cancel, record nothing</button>
        {isSubmitting && <span role="status">Recording one correction. Confirmation is locked to prevent duplicates.</span>}
      </div>
    </section>
  );
}

function CashMovementSummary({
  summary,
  error,
}: {
  summary: TradingDayClosingSummary | null;
  error: boolean;
}) {
  if (error || !summary) {
    return (
      <section className="staff-cash-effective-summary is-unavailable" role="status">
        <h2>Cash summary unavailable</h2>
        <p>The ledger is still available. Refresh the page to load effective cash totals.</p>
      </section>
    );
  }
  const values = [
    ['Cash in', summary.cashInCents],
    ['Cash out', summary.cashOutCents],
    ['Expenses (cash)', summary.cashExpensesCents],
    ['Expected cash', summary.expectedCashCents],
  ] as const;
  return (
    <section className="staff-cash-effective-summary" aria-labelledby="cash-effective-summary-title">
      <div>
        <h2 id="cash-effective-summary-title">Effective cash summary</h2>
        <p>Server totals count only the latest effective entry in each correction chain.</p>
      </div>
      <dl>
        {values.map(([label, value]) => (
          <div className={label === 'Expected cash' ? 'total' : undefined} key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? 'Unavailable' : formatMoney(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function NoOpenDay({
  closedDuringSubmit,
  closedDuringAmendment,
}: {
  closedDuringSubmit: boolean;
  closedDuringAmendment: boolean;
}) {
  return (
    <section className="staff-inventory-blocking staff-cash-no-day" role="status">
      <h2>No business day is open</h2>
      <p>
        {closedDuringAmendment
          ? 'The business day closed before confirmation. No correction was recorded. The recorded close and totals did not change.'
          : closedDuringSubmit
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
  const [cashSummary, setCashSummary] = useState<TradingDayClosingSummary | null>(null);
  const [cashSummaryError, setCashSummaryError] = useState(false);
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
  const [closedDuringAmendment, setClosedDuringAmendment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amendTarget, setAmendTarget] = useState<CashMovement | null>(null);
  const [amendDraft, setAmendDraft] = useState<AmendmentDraft | null>(null);
  const [amendmentReview, setAmendmentReview] = useState<AmendmentReview | null>(null);
  const [amendAnnouncement, setAmendAnnouncement] = useState('');
  const [amendMessage, setAmendMessage] = useState('');
  const [canRefreshAmendment, setCanRefreshAmendment] = useState(false);
  const signedInStaffMemberId = useSignedInStaffMemberId();
  const submitInFlight = useRef(false);
  const retryIdentity = useRef<RetryIdentity | null>(null);
  const amendFormRef = useRef<HTMLFormElement>(null);
  const amendmentErrorFocus = useRef<FieldErrors | null>(null);

  useEffect(() => {
    document.title = 'Cash & Expenses · UCM Coffee Studio';
  }, []);

  useEffect(() => {
    if (amendmentReview) {
      document.getElementById('cash-review-title')?.focus();
    } else if (amendTarget) {
      if (amendmentErrorFocus.current && amendFormRef.current) {
        focusFirstError(amendFormRef.current, amendmentErrorFocus.current);
        amendmentErrorFocus.current = null;
      } else {
        document.getElementById('cash-amend-title')?.focus();
      }
    }
  }, [amendTarget, amendmentReview]);

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
          setRecordedBy('');
          setCashSummary(null);
          setCashSummaryError(false);
          return;
        }
        const [ledger, activeStaff, summaryResult] = await Promise.all([
          getCurrentCashMovements(),
          listActiveTradingDayStaff(),
          getClosingSummary()
            .then((summary) => ({ summary, error: false }))
            .catch(() => ({ summary: null, error: true })),
        ]);
        if (!active) return;
        setBusinessDay(ledger.businessDay);
        setWorkspaceBusinessDay(ledger.businessDay);
        setMovements(ledger.movements);
        setStaff(activeStaff);
        setCashSummary(summaryResult.summary);
        setCashSummaryError(summaryResult.error);
        setRecordedBy(
          defaultStaffSelection(activeStaff, signedInStaffMemberId),
        );
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
  }, [loadAttempt, setWorkspaceBusinessDay, signedInStaffMemberId]);

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

  function resetAmendment(message = '') {
    setAmendTarget(null);
    setAmendDraft(null);
    setAmendmentReview(null);
    setAmendAnnouncement('');
    setAmendMessage('');
    setCanRefreshAmendment(false);
    setFieldErrors({});
    if (message) setSuccessMessage(message);
  }

  function startAmendment(movement: CashMovement) {
    if (movement.supersededByCashMovementId) return;
    setAmendTarget(movement);
    setAmendDraft({
      kind: movement.kind,
      amount: inputAmount(movement.amountCents),
      reason: movement.description,
      category: movement.category ?? '',
    });
    setAmendmentReview(null);
    setFieldErrors({});
    setFormMessage('');
    setSuccessMessage('');
    setAmendMessage('');
    setCanRefreshAmendment(false);
  }

  function changeAmendmentDraft(changes: Partial<AmendmentDraft>) {
    setAmendDraft((current) => current ? { ...current, ...changes } : current);
    setFieldErrors((current) => ({
      ...current,
      ...(changes.amount !== undefined ? { amount: undefined } : {}),
      ...(changes.reason !== undefined ? { reason: undefined } : {}),
      ...(changes.category !== undefined ? { category: undefined } : {}),
    }));
    setAmendMessage('');
    setCanRefreshAmendment(false);
  }

  function changeAmendmentKind(nextKind: CashMovementKind) {
    const clearedCategory = amendDraft?.kind === CashMovementKind.EXPENSE &&
      nextKind !== CashMovementKind.EXPENSE && Boolean(amendDraft.category);
    setAmendDraft((current) => current ? {
      ...current,
      kind: nextKind,
      category: nextKind === CashMovementKind.EXPENSE ? current.category : '',
    } : current);
    setFieldErrors((current) => ({ ...current, category: undefined }));
    setAmendMessage('');
    setCanRefreshAmendment(false);
    setAmendAnnouncement(
      nextKind === CashMovementKind.EXPENSE
        ? 'Expense selected. Category is now available.'
        : `${movementLabel(nextKind)} selected. ${clearedCategory ? 'Category was cleared and is' : 'Category is'} no longer available.`,
    );
  }

  function reviewAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amendDraft) return;
    const { amountCents, errors } = validateMovementFields(
      amendDraft.amount,
      amendDraft.reason,
    );
    setFieldErrors(errors);
    setAmendMessage('');
    if (amountCents === null || Object.keys(errors).length > 0) {
      focusFirstError(event.currentTarget, errors);
      return;
    }
    const trimmedCategory = amendDraft.category.trim();
    setAmendmentReview({
      clientGeneratedId: globalThis.crypto.randomUUID(),
      amountCents,
      kind: amendDraft.kind,
      description: amendDraft.reason.trim(),
      category: amendDraft.kind === CashMovementKind.EXPENSE
        ? trimmedCategory || null
        : null,
    });
    setCanRefreshAmendment(false);
  }

  async function confirmAmendment() {
    if (!amendTarget || !amendmentReview || submitInFlight.current) return;
    const payload: AmendCashMovementInput = {
      clientGeneratedId: amendmentReview.clientGeneratedId,
      kind: amendmentReview.kind,
      amountCents: amendmentReview.amountCents,
      description: amendmentReview.description,
      ...(amendmentReview.kind === CashMovementKind.EXPENSE && amendmentReview.category
        ? { category: amendmentReview.category }
        : {}),
      ...(defaultStaffSelection(staff, signedInStaffMemberId)
        ? { recordedByStaffMemberId: defaultStaffSelection(staff, signedInStaffMemberId) }
        : {}),
    };
    submitInFlight.current = true;
    setIsSubmitting(true);
    setAmendMessage('');
    setCanRefreshAmendment(false);
    try {
      await amendCashMovement(amendTarget.id, payload);
      resetAmendment('Correction recorded once. The original remains visible and is now superseded.');
      setLoadAttempt((attempt) => attempt + 1);
    } catch (error) {
      if (error instanceof TradingDayApiError) {
        const mappedErrors = serverFieldErrors(error.messages);
        if (error.status === 400 && Object.keys(mappedErrors).length > 0) {
          amendmentErrorFocus.current = mappedErrors;
          setAmendmentReview(null);
          setFieldErrors(mappedErrors);
          setAmendMessage('No correction was recorded. Correct the highlighted fields; the ledger and totals are unchanged.');
        } else if (error.status === 409 && error.supersededByCashMovementId) {
          const supersedingEntry = entryReference(error.supersededByCashMovementId);
          resetAmendment(`${entryReference(amendTarget.id)} was already corrected by ${supersedingEntry}. No correction was recorded by this request. The ledger has been refreshed.`);
          setLoadAttempt((attempt) => attempt + 1);
        } else if (error.status === 409) {
          setClosedDuringSubmit(true);
          setClosedDuringAmendment(true);
          resetAmendment('The business day closed before confirmation. No correction was recorded; the recorded close and totals did not change.');
          setLoadAttempt((attempt) => attempt + 1);
        } else if (error.status === 404) {
          setAmendMessage('This entry could not be found. No correction was recorded, and the ledger and totals are unchanged.');
          setCanRefreshAmendment(true);
        } else {
          setAmendMessage(`${error.messages.join(' ')} No correction was recorded.`);
        }
      } else {
        setAmendMessage('The correction could not be recorded. Try again with the same reviewed correction.');
      }
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current) return;
    const form = event.currentTarget;

    const validation = validateMovementFields(amount, reason);
    const amountCents = validation.amountCents;
    const trimmedReason = reason.trim();
    const trimmedCategory = category.trim();
    const nextErrors = validation.errors;
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
      setRecordedBy(defaultStaffSelection(staff, signedInStaffMemberId));
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
          setClosedDuringAmendment(false);
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
        <NoOpenDay
          closedDuringSubmit={closedDuringSubmit}
          closedDuringAmendment={closedDuringAmendment}
        />
      ) : (
        <>
          <section className="staff-cash-day-context" aria-labelledby="cash-day-context-title">
            <div>
              <span id="cash-day-context-title">This entry will be written to</span>
              <strong>{formatBusinessDate(businessDay.businessDate!)}</strong>
            </div>
            <span>{dayTypeLabel(businessDay)}</span>
          </section>

          <CashMovementSummary
            summary={cashSummary}
            error={cashSummaryError}
          />

          <div className={`staff-cash-layout${amendmentReview ? ' is-reviewing' : ''}`}>
            {amendTarget && amendDraft ? (
              amendmentReview ? (
                <AmendmentReviewPanel
                  target={amendTarget}
                  review={amendmentReview}
                  isSubmitting={isSubmitting}
                  message={amendMessage}
                  onConfirm={() => void confirmAmendment()}
                  onEdit={() => {
                    setAmendmentReview(null);
                    setAmendMessage('');
                    setCanRefreshAmendment(false);
                  }}
                  onCancel={() => resetAmendment('Correction cancelled. Nothing was recorded.')}
                  onRefresh={canRefreshAmendment ? () => {
                    resetAmendment();
                    setLoadAttempt((attempt) => attempt + 1);
                  } : null}
                />
              ) : (
                <AmendmentEditor
                  target={amendTarget}
                  draft={amendDraft}
                  fieldErrors={fieldErrors}
                  formRef={amendFormRef}
                  announcement={amendAnnouncement}
                  message={amendMessage}
                  onDraftChange={changeAmendmentDraft}
                  onKindChange={changeAmendmentKind}
                  onSubmit={reviewAmendment}
                  onCancel={() => resetAmendment('Correction cancelled. Nothing was recorded.')}
                />
              )
            ) : (
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
            )}
            <CashMovementLedger
              movements={movements}
              selectedMovementId={amendTarget?.id ?? null}
              onAmend={startAmendment}
            />
          </div>
        </>
      )}
    </main>
  );
}
