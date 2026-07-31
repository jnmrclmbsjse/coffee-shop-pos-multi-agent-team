import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  cents,
  DayType,
  type CurrentOpenBusinessDay,
  type InventoryStaffOption,
  type MoneyCents,
  type PackagingReconciliationRow,
  type TradingDayClosingSummary,
} from '@coffee-shop/shared';
import { formatMoney } from '../reporting/format';
import {
  TradingDayApiError,
  closeBusinessDay,
  getClosingSummary,
  getCurrentBusinessDay,
  listActiveTradingDayStaff,
  openBusinessDay,
} from './api';

interface OpenFieldErrors {
  businessDate?: string;
  dayType?: string;
  openingFloat?: string;
  openedBy?: string;
}

interface CloseFieldErrors {
  actualCash?: string;
  closedBy?: string;
}

const EMPTY_CLOSING_SUMMARY: TradingDayClosingSummary = {
  isOpen: false,
  businessDate: null,
  openingFloatCents: null,
  cashSalesCents: null,
  onlineSalesCents: null,
  grossSalesCents: null,
  cashTipsCents: null,
  cashInCents: null,
  cashOutCents: null,
  cashExpensesCents: null,
  outstandingChangeCents: null,
  expectedCashCents: null,
  packaging: [],
  hasClosingStockCount: false,
};

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · UCM Coffee Studio`;
  }, [title]);
}

function apiMessages(error: unknown, fallback: string): string[] {
  if (error instanceof TradingDayApiError && error.messages.length > 0) {
    return error.messages;
  }
  return [fallback];
}

function isValidBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1]!;
}

function parsePesosToCents(value: string): MoneyCents | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const pesos = Number(match[1]);
  const centavos = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const total = pesos * 100 + centavos;
  return Number.isSafeInteger(total) ? cents(total) : null;
}

function fullBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(Date.UTC(year!, month! - 1, day)));
}

function openedTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function dayTypeLabel(value: DayType): string {
  return value === DayType.PEAK ? 'Peak day' : 'Normal day';
}

function PageHeading({
  title,
  description,
  businessDate,
}: {
  title: string;
  description: string;
  businessDate?: string | null;
}) {
  return (
    <header className="staff-inventory-page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {businessDate && (
        <div className="staff-business-context" aria-label="Business day context">
          <span>{fullBusinessDate(businessDate)}</span>
        </div>
      )}
    </header>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="staff-inventory-loading" aria-live="polite">
      <span>{label}</span>
      <div aria-hidden="true" />
      <div aria-hidden="true" />
      <div aria-hidden="true" />
    </div>
  );
}

function LoadError({
  messages,
  onRetry,
}: {
  messages: string[];
  onRetry: () => void;
}) {
  return (
    <div className="staff-inventory-blocking" role="alert">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      <button
        className="staff-inventory-button secondary"
        type="button"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="staff-inventory-field">
      <label htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="staff-inventory-helper"> (optional)</span>
        ) : (
          <span className="staff-inventory-required" aria-hidden="true">
            {' '}*
          </span>
        )}
      </label>
      {children}
      {error && (
        <p className="staff-inventory-field-error" id={`${htmlFor}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function FormMessages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="staff-inventory-message error" role="alert">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

function focusField(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLElement) {
    field.focus();
  } else if (field instanceof RadioNodeList) {
    const firstOption = field.item(0);
    if (firstOption instanceof HTMLElement) firstOption.focus();
  }
}

function OpenDaySummary({ day }: { day: CurrentOpenBusinessDay }) {
  return (
    <section className="staff-day-open-summary" aria-labelledby="day-open-title">
      <div className="staff-day-open-banner">
        <span>Day open</span>
        <div>
          <h2 id="day-open-title">
            {day.businessDate
              ? fullBusinessDate(day.businessDate)
              : 'Business date unavailable'}
          </h2>
          <p>Take orders and record cash against this day; close it at end of shift.</p>
        </div>
      </div>
      <dl className="staff-day-summary-list">
        <div>
          <dt>Day type</dt>
          <dd>{day.dayType ? dayTypeLabel(day.dayType) : '— unavailable'}</dd>
        </div>
        <div>
          <dt>Cash float</dt>
          <dd>
            {day.openingFloatCents === null
              ? '— unavailable'
              : formatMoney(day.openingFloatCents)}
          </dd>
        </div>
        <div>
          <dt>Opened by</dt>
          <dd>{day.openedByDisplayName || '— unavailable'}</dd>
        </div>
        <div>
          <dt>Opened at</dt>
          <dd>{day.openedAt ? openedTime(day.openedAt) : '— unavailable'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function OpenBusinessDayPage() {
  useDocumentTitle('Open business day');
  const [day, setDay] = useState<CurrentOpenBusinessDay | null>(null);
  const [staff, setStaff] = useState<InventoryStaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadMessages, setLoadMessages] = useState<string[]>([]);
  const [businessDate, setBusinessDate] = useState('');
  const [dayType, setDayType] = useState<DayType | ''>('');
  const [openingFloat, setOpeningFloat] = useState('');
  const [openedBy, setOpenedBy] = useState('');
  const [fieldErrors, setFieldErrors] = useState<OpenFieldErrors>({});
  const [formMessages, setFormMessages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadMessages([]);

    async function load() {
      try {
        const currentDay = await getCurrentBusinessDay();
        const activeStaff = currentDay.isOpen
          ? []
          : await listActiveTradingDayStaff();
        if (!cancelled) {
          setDay(currentDay);
          setStaff(activeStaff);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadMessages(
            apiMessages(error, 'The opening screen could not be loaded. Try again.'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const parsedFloat = parsePesosToCents(openingFloat);
    const nextErrors: OpenFieldErrors = {};
    if (!businessDate) {
      nextErrors.businessDate = 'Choose a business date.';
    } else if (!isValidBusinessDate(businessDate)) {
      nextErrors.businessDate = 'Enter a valid business date.';
    }
    if (!dayType) nextErrors.dayType = 'Choose Normal day or Peak day.';
    if (!openingFloat.trim()) {
      nextErrors.openingFloat = 'Enter the opening cash float.';
    } else if (openingFloat.trim().startsWith('-')) {
      nextErrors.openingFloat = 'Opening cash float cannot be negative.';
    } else if (parsedFloat === null) {
      nextErrors.openingFloat =
        'Enter a valid amount in pesos with up to two centavos digits.';
    }
    if (!openedBy) {
      nextErrors.openedBy = 'Choose the staff member opening the day.';
    }

    setFieldErrors(nextErrors);
    setFormMessages([]);
    const firstError = (
      ['businessDate', 'dayType', 'openingFloat', 'openedBy'] as const
    ).find((name) => nextErrors[name]);
    if (firstError) {
      focusField(event.currentTarget, firstError);
      return;
    }
    if (!dayType || parsedFloat === null) return;

    setIsSubmitting(true);
    try {
      const openedDay = await openBusinessDay({
        businessDate,
        dayType,
        openingFloatCents: parsedFloat,
        openedByStaffMemberId: openedBy,
      });
      setDay(openedDay);
    } catch (error) {
      setFormMessages(
        apiMessages(error, 'The business day could not be opened. Try again.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main id="staff-main" className="staff-inventory-workspace staff-inventory-screen">
      <PageHeading
        title="Open business day"
        description="Start the day everything else anchors on: orders, cash, and counts."
        businessDate={day?.isOpen ? day.businessDate : null}
      />

      {loading ? (
        <LoadingState label="Loading the business day…" />
      ) : loadMessages.length > 0 ? (
        <LoadError
          messages={loadMessages}
          onRetry={() => setLoadVersion((version) => version + 1)}
        />
      ) : day?.isOpen ? (
        <OpenDaySummary day={day} />
      ) : (
        <form
          className="staff-inventory-panel staff-open-day-form"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="staff-day-form-grid">
            <Field
              label="Business date"
              htmlFor="businessDate"
              error={fieldErrors.businessDate}
            >
              <input
                id="businessDate"
                name="businessDate"
                type="date"
                required
                value={businessDate}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.businessDate)}
                aria-describedby={
                  fieldErrors.businessDate ? 'businessDate-error' : undefined
                }
                onChange={(event) => {
                  setBusinessDate(event.target.value);
                  setFieldErrors((errors) => ({
                    ...errors,
                    businessDate: undefined,
                  }));
                }}
              />
            </Field>

            <fieldset className="staff-day-type-fieldset">
              <legend>
                Day type
                <span className="staff-inventory-required" aria-hidden="true">
                  {' '}*
                </span>
              </legend>
              <div className="staff-day-type-options">
                {[
                  [DayType.NORMAL, 'Normal day'],
                  [DayType.PEAK, 'Peak day'],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="dayType"
                      value={value}
                      required
                      checked={dayType === value}
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.dayType)}
                      aria-describedby={
                        fieldErrors.dayType ? 'dayType-error' : undefined
                      }
                      onChange={() => {
                        setDayType(value as DayType);
                        setFieldErrors((errors) => ({
                          ...errors,
                          dayType: undefined,
                        }));
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {fieldErrors.dayType && (
                <p className="staff-inventory-field-error" id="dayType-error">
                  {fieldErrors.dayType}
                </p>
              )}
            </fieldset>

            <Field
              label="Opening cash float"
              htmlFor="openingFloat"
              error={fieldErrors.openingFloat}
            >
              <div className="staff-money-input">
                <span aria-hidden="true">₱</span>
                <input
                  id="openingFloat"
                  name="openingFloat"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  value={openingFloat}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.openingFloat)}
                  aria-describedby={
                    fieldErrors.openingFloat ? 'openingFloat-error' : undefined
                  }
                  onChange={(event) => {
                    setOpeningFloat(event.target.value);
                    setFieldErrors((errors) => ({
                      ...errors,
                      openingFloat: undefined,
                    }));
                  }}
                />
              </div>
            </Field>

            <Field
              label="Opened by"
              htmlFor="openedBy"
              error={fieldErrors.openedBy}
            >
              <select
                id="openedBy"
                name="openedBy"
                required
                value={openedBy}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.openedBy)}
                aria-describedby={
                  fieldErrors.openedBy ? 'openedBy-error' : undefined
                }
                onChange={(event) => {
                  setOpenedBy(event.target.value);
                  setFieldErrors((errors) => ({
                    ...errors,
                    openedBy: undefined,
                  }));
                }}
              >
                <option value="">Choose active staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <FormMessages messages={formMessages} />
          <div className="staff-inventory-actions">
            <button
              className="staff-inventory-button primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Opening day…' : 'Open day'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

function quantityText(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 0,
  }).format(value);
}

function packagingExpected(row: PackagingReconciliationRow): string {
  return row.expectedQty === null
    ? '— no opening count'
    : quantityText(row.expectedQty);
}

function packagingActual(
  row: PackagingReconciliationRow,
  hasClosingCount: boolean,
): string {
  if (row.actualQty !== null) return quantityText(row.actualQty);
  return hasClosingCount ? '— not in count' : '— no closing count';
}

function packagingVariance(row: PackagingReconciliationRow): string {
  if (row.varianceQty === null) {
    if (row.expectedQty === null && row.actualQty === null) {
      return '— needs both counts';
    }
    return row.expectedQty === null
      ? '— needs opening count'
      : '— needs closing count';
  }
  if (row.varianceQty === 0) return '0 Balanced';
  return row.varianceQty < 0
    ? `▾ Short ${quantityText(Math.abs(row.varianceQty))}`
    : `▴ Over ${quantityText(row.varianceQty)}`;
}

function moneyTerm(
  value: MoneyCents | null,
  direction?: 'plus' | 'minus',
): string {
  if (value === null) return '— unavailable';
  const sign = direction === 'plus' ? '+' : direction === 'minus' ? '−' : '';
  return `${sign}${formatMoney(value)}`;
}

function CashSummary({ summary }: { summary: TradingDayClosingSummary }) {
  const rows: Array<{
    label: string;
    value: MoneyCents | null;
    direction?: 'plus' | 'minus';
    note?: string;
    className?: string;
  }> = [
    { label: 'Cash float', value: summary.openingFloatCents },
    { label: 'Cash sales', value: summary.cashSalesCents },
    {
      label: 'Online sales (excluded)',
      value: summary.onlineSalesCents,
      note: 'Does not contribute to expected cash.',
      className: 'excluded',
    },
    { label: 'Cash tips', value: summary.cashTipsCents, direction: 'plus' },
    { label: 'Cash in', value: summary.cashInCents, direction: 'plus' },
    { label: 'Cash out', value: summary.cashOutCents, direction: 'minus' },
    {
      label: 'Expenses (cash)',
      value: summary.cashExpensesCents,
      direction: 'minus',
    },
    {
      label: 'Change owed (still in drawer)',
      value: summary.outstandingChangeCents,
      direction: 'plus',
      note: 'This money is still in the drawer and will be counted.',
      className: 'change-owed',
    },
  ];

  return (
    <section className="staff-close-section" aria-labelledby="cash-summary-title">
      <div className="staff-section-heading">
        <h2 id="cash-summary-title">Cash summary</h2>
        <p>Online sales are excluded from expected drawer cash.</p>
      </div>
      <dl className="staff-cash-summary">
        {rows.map((row) => (
          <div className={row.className} key={row.label}>
            <dt>
              {row.label}
              {row.note && <small>{row.note}</small>}
            </dt>
            <dd>{moneyTerm(row.value, row.direction)}</dd>
          </div>
        ))}
        <div className="total">
          <dt>Expected cash</dt>
          <dd>{moneyTerm(summary.expectedCashCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

function PackagingSummary({ summary }: { summary: TradingDayClosingSummary }) {
  return (
    <section className="staff-close-section" aria-labelledby="packaging-title">
      <div className="staff-section-heading">
        <h2 id="packaging-title">Cup / lid balance</h2>
        <p>Unknown counts are labelled separately from recorded zeroes.</p>
      </div>
      {summary.packaging.length === 0 ? (
        <div className="staff-packaging-empty">
          No cup or lid items are marked for reconciliation.
        </div>
      ) : (
        <>
          <div className="staff-inventory-table-wrap staff-packaging-table">
            <table>
              <caption className="sr-only">
                Expected and actual cup and lid balances
              </caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Var</th>
                </tr>
              </thead>
              <tbody>
                {summary.packaging.map((row) => (
                  <tr key={row.inventoryItemId}>
                    <th scope="row">{row.itemName}</th>
                    <td className={row.expectedQty === null ? 'unknown' : 'staff-number-cell'}>
                      {packagingExpected(row)}
                    </td>
                    <td className={row.actualQty === null ? 'unknown' : 'staff-number-cell'}>
                      {packagingActual(row, summary.hasClosingStockCount)}
                    </td>
                    <td
                      className={
                        row.varianceQty === null
                          ? 'unknown'
                          : row.varianceQty < 0
                            ? 'variance-short'
                            : row.varianceQty > 0
                              ? 'variance-over'
                              : 'variance-balanced'
                      }
                    >
                      {packagingVariance(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="staff-table-scroll-hint">
            Swipe sideways to review every balance column.
          </p>
        </>
      )}
    </section>
  );
}

function discrepancyText(value: MoneyCents | null, input: string): string {
  if (value === null) {
    return input.trim()
      ? '— enter a valid cash count'
      : '— enter actual cash count';
  }
  if (value === 0) return `${formatMoney(value)} Balanced`;
  return value < 0
    ? `▾ Short ${formatMoney(cents(Math.abs(value)))}`
    : `▴ Over ${formatMoney(value)}`;
}

export function CloseBusinessDayPage() {
  useDocumentTitle('Close business day');
  const [summary, setSummary] = useState<TradingDayClosingSummary | null>(null);
  const [staff, setStaff] = useState<InventoryStaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadMessages, setLoadMessages] = useState<string[]>([]);
  const [actualCash, setActualCash] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [closedBy, setClosedBy] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CloseFieldErrors>({});
  const [formMessages, setFormMessages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didClose, setDidClose] = useState(false);
  const clientGeneratedId = useRef<string | null>(null);

  const actualCashCents = useMemo(
    () => parsePesosToCents(actualCash),
    [actualCash],
  );
  const discrepancyCents = useMemo(() => {
    if (actualCashCents === null || summary?.expectedCashCents === null) {
      return null;
    }
    if (summary?.expectedCashCents === undefined) return null;
    return cents(actualCashCents - summary.expectedCashCents);
  }, [actualCashCents, summary?.expectedCashCents]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadMessages([]);

    async function load() {
      try {
        const closingSummary = await getClosingSummary();
        const activeStaff = closingSummary.isOpen
          ? await listActiveTradingDayStaff()
          : [];
        if (!cancelled) {
          setSummary(closingSummary);
          setStaff(activeStaff);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadMessages(
            apiMessages(error, 'The closing screen could not be loaded. Try again.'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  function resetAttemptId() {
    clientGeneratedId.current = null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors: CloseFieldErrors = {};
    if (!actualCash.trim()) {
      nextErrors.actualCash = 'Enter the actual cash counted.';
    } else if (actualCash.trim().startsWith('-')) {
      nextErrors.actualCash = 'Actual cash counted cannot be negative.';
    } else if (actualCashCents === null) {
      nextErrors.actualCash =
        'Enter a valid amount in pesos with up to two centavos digits.';
    }
    if (!closedBy) nextErrors.closedBy = 'Choose the staff member closing the day.';

    setFieldErrors(nextErrors);
    setFormMessages([]);
    const firstError = (['actualCash', 'closedBy'] as const).find(
      (name) => nextErrors[name],
    );
    if (firstError) {
      focusField(event.currentTarget, firstError);
      return;
    }
    if (actualCashCents === null) return;

    const attemptId =
      clientGeneratedId.current ?? globalThis.crypto.randomUUID();
    clientGeneratedId.current = attemptId;
    setIsSubmitting(true);
    try {
      await closeBusinessDay({
        clientGeneratedId: attemptId,
        actualCashCents,
        varianceReason: varianceReason.trim() || null,
        closedByStaffMemberId: closedBy,
      });
      setDidClose(true);
      setSummary(EMPTY_CLOSING_SUMMARY);
    } catch (error) {
      setFormMessages(
        apiMessages(error, 'The business day could not be closed. Try again.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main id="staff-main" className="staff-inventory-workspace staff-inventory-screen">
      <PageHeading
        title="Close business day"
        description="Review both reconciliations, count the drawer, then close."
        businessDate={summary?.isOpen ? summary.businessDate : null}
      />

      {loading ? (
        <LoadingState label="Loading the closing summary…" />
      ) : loadMessages.length > 0 ? (
        <LoadError
          messages={loadMessages}
          onRetry={() => setLoadVersion((version) => version + 1)}
        />
      ) : !summary?.isOpen ? (
        <div className="staff-inventory-blocking" role="status">
          {didClose && <strong className="staff-close-success">Business day closed.</strong>}
          <p>No business day is open to close.</p>
        </div>
      ) : (
        <>
          {!summary.hasClosingStockCount && (
            <aside className="staff-closing-advisory" aria-label="Closing count advisory">
              <strong>No closing count submitted yet.</strong>
              <span>
                Cup and lid variances cannot be finalized.{' '}
                <Link to="/pos/closing">Do the closing count.</Link>
              </span>
            </aside>
          )}

          <div className="staff-close-layout">
            <PackagingSummary summary={summary} />
            <CashSummary summary={summary} />
          </div>

          <form
            className="staff-inventory-panel staff-close-day-form"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="staff-section-heading">
              <h2>Count and close</h2>
              <p>Count the physical cash in the drawer before closing the day.</p>
            </div>
            <div className="staff-close-form-grid">
              <Field
                label="Actual cash counted"
                htmlFor="actualCash"
                error={fieldErrors.actualCash}
              >
                <div className="staff-money-input">
                  <span aria-hidden="true">₱</span>
                  <input
                    id="actualCash"
                    name="actualCash"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    value={actualCash}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(fieldErrors.actualCash)}
                    aria-describedby={
                      fieldErrors.actualCash ? 'actualCash-error' : undefined
                    }
                    onChange={(event) => {
                      setActualCash(event.target.value);
                      resetAttemptId();
                      setFieldErrors((errors) => ({
                        ...errors,
                        actualCash: undefined,
                      }));
                    }}
                  />
                </div>
              </Field>

              <div className="staff-discrepancy" aria-live="polite">
                <span>Discrepancy</span>
                <strong
                  className={
                    discrepancyCents === null
                      ? 'pending'
                      : discrepancyCents < 0
                        ? 'short'
                        : discrepancyCents > 0
                          ? 'over'
                          : 'balanced'
                  }
                >
                  {discrepancyText(discrepancyCents, actualCash)}
                </strong>
                <small>Physical cash counted minus expected cash.</small>
              </div>

              <Field
                label="Discrepancy reason"
                htmlFor="varianceReason"
                optional
              >
                <textarea
                  id="varianceReason"
                  name="varianceReason"
                  rows={3}
                  placeholder="e.g. short by change given, over from tips"
                  value={varianceReason}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setVarianceReason(event.target.value);
                    resetAttemptId();
                  }}
                />
              </Field>

              <Field
                label="Closed by"
                htmlFor="closedBy"
                error={fieldErrors.closedBy}
              >
                <select
                  id="closedBy"
                  name="closedBy"
                  required
                  value={closedBy}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.closedBy)}
                  aria-describedby={
                    fieldErrors.closedBy ? 'closedBy-error' : undefined
                  }
                  onChange={(event) => {
                    setClosedBy(event.target.value);
                    resetAttemptId();
                    setFieldErrors((errors) => ({
                      ...errors,
                      closedBy: undefined,
                    }));
                  }}
                >
                  <option value="">Choose active staff</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <FormMessages messages={formMessages} />
            <div className="staff-inventory-actions">
              <button
                className="staff-inventory-button primary"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Closing day…' : 'Close day'}
              </button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
