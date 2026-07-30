import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  CountMethod,
  DayType,
  MovementType,
  StockLevel,
  type CountSheet,
  type CountSheetItem,
  type CurrentOpenBusinessDay,
  type InventoryStaffOption,
  type RestockStatus,
  type RestockStatusResult,
  type StockCountPhase,
  type StockMovementList,
  type SubmitStockCountLineInput,
  type SubmittedStockCount,
} from '@coffee-shop/shared';
import { useAuth } from '../auth/AuthContext';
import {
  InventoryApiError,
  createStockMovement,
  getClosingCountSheet,
  getOpeningCountSheet,
  getRestockStatus,
  listActiveInventoryStaff,
  listStockMovements,
  submitStockCount,
} from './api';

const LEVEL_OPTIONS = [
  [StockLevel.EMPTY, 'Empty'],
  [StockLevel.LOW, 'Low'],
  [StockLevel.QUARTER, 'Quarter'],
  [StockLevel.ONE_THIRD, 'One-third'],
  [StockLevel.HALF, 'Half'],
  [StockLevel.TWO_THIRDS, 'Two-thirds'],
  [StockLevel.THREE_QUARTERS, 'Three-quarters'],
  [StockLevel.FULL, 'Full'],
] as const;

const LEVEL_LABELS = Object.fromEntries(LEVEL_OPTIONS) as Record<
  StockLevel,
  string
>;

const STATUS_LABELS: Record<RestockStatus, string> = {
  URGENT: 'Urgent',
  LOW: 'Low',
  BELOW_PAR: 'Below par',
  ENOUGH: 'Enough',
};

const MOVEMENT_OPTIONS: ReadonlyArray<readonly [MovementType, string]> = [
  [MovementType.DELIVERY, 'Delivery'],
  [MovementType.WASTAGE, 'Wastage'],
];

type CountDraft = Record<string, string>;

interface CountFieldErrors {
  submittedBy?: string;
  shiftLead?: string;
  lines?: string;
}

function formatBusinessDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`));
}

function formatRecordedAt(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function dayTypeLabel(dayType: DayType | null): string {
  if (dayType === DayType.PEAK) return 'Peak day';
  if (dayType === DayType.NORMAL) return 'Normal day';
  return '';
}

function itemMeta(item: Pick<CountSheetItem, 'size' | 'unit'>): string {
  return [item.size, item.unit].filter(Boolean).join(' · ');
}

function itemSelectLabel(item: CountSheetItem): string {
  return item.size ? `${item.name} · ${item.size}` : item.name;
}

function errorMessages(error: unknown, fallback: string): string[] {
  if (error instanceof InventoryApiError && error.messages.length > 0) {
    return error.messages;
  }
  return [fallback];
}

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · UCM Coffee Studio`;
  }, [title]);
}

export function StaffWorkspaceLayout() {
  const auth = useAuth();

  return (
    <div className="staff-inventory-shell">
      <a className="staff-skip-link" href="#staff-main">
        Skip to inventory workspace
      </a>
      <header className="staff-workspace-header">
        <div className="staff-workspace-header-inner">
          <div className="staff-workspace-brand">
            <div>
              <strong>UCM Coffee Studio</strong>
              <span>Staff</span>
            </div>
            <small>
              Signed in as {auth.user?.displayName ?? auth.user?.username}
            </small>
          </div>
          <nav className="staff-inventory-nav" aria-label="Staff workspace">
            <NavLink to="/pos/opening">Opening</NavLink>
            <NavLink to="/pos/closing">Closing</NavLink>
            <NavLink to="/pos/restock">Restock</NavLink>
            <NavLink to="/pos/movements">Deliveries &amp; Wastage</NavLink>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

function PageHeading({
  headingId,
  title,
  description,
  businessDay,
  context,
}: {
  headingId?: string;
  title: string;
  description: string;
  businessDay?: CurrentOpenBusinessDay;
  context?: string;
}) {
  return (
    <header className="staff-inventory-page-heading">
      <div>
        <h1 id={headingId}>{title}</h1>
        <p>{description}</p>
      </div>
      {businessDay?.isOpen && (
        <div className="staff-business-context" aria-label="Business day context">
          <span>{formatBusinessDate(businessDay.businessDate)}</span>
          {context && <span>{context}</span>}
        </div>
      )}
    </header>
  );
}

function LoadingState() {
  return (
    <div className="staff-inventory-loading" aria-live="polite">
      <span>Loading inventory workspace…</span>
      <div aria-hidden="true" />
      <div aria-hidden="true" />
      <div aria-hidden="true" />
    </div>
  );
}

function LoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="staff-inventory-blocking" role="alert">
      <p>{message}</p>
      <button type="button" className="staff-inventory-button secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function NoOpenDay() {
  return (
    <div className="staff-inventory-blocking" role="status">
      <p>No business day is open.</p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
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
        <p className="staff-inventory-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function toCountLines(
  items: CountSheetItem[],
  values: CountDraft,
): SubmitStockCountLineInput[] {
  const lines: SubmitStockCountLineInput[] = [];
  for (const item of items) {
    const value = values[item.id];
    if (value === undefined || value === '') continue;
    lines.push(
      item.countMethod === CountMethod.QUANTITY
        ? { inventoryItemId: item.id, quantity: Number(value) }
        : { inventoryItemId: item.id, level: value as StockLevel },
    );
  }
  return lines;
}

function countServerErrors(messages: string[]): CountFieldErrors {
  const joined = messages.join(' ');
  if (/submittedBy|submitting staff|submitter/i.test(joined)) {
    return { submittedBy: joined };
  }
  if (/shiftLead|shift lead/i.test(joined)) {
    return { shiftLead: joined };
  }
  return { lines: joined };
}

function ReadOnlyCount({
  sheet,
  submitted,
  onRecordAnother,
}: {
  sheet: CountSheet;
  submitted: SubmittedStockCount;
  onRecordAnother: () => void;
}) {
  const lines = new Map(
    submitted.lines.map((line) => [line.inventoryItemId, line]),
  );

  return (
    <div className="staff-inventory-panel">
      <div className="staff-submitted-banner">
        <div>
          <strong>Count submitted</strong>
          <span>
            {formatRecordedAt(submitted.recordedAt)} by{' '}
            {submitted.submittedByNameSnapshot}
          </span>
        </div>
        <button
          className="staff-inventory-button secondary"
          type="button"
          onClick={onRecordAnother}
        >
          Record another {sheet.phase === 'open' ? 'opening' : 'closing'} count
        </button>
      </div>
      <div className="staff-count-list">
        {sheet.items.map((item) => {
          const line = lines.get(item.id);
          let value = 'Not counted';
          if (line?.quantity !== null && line?.quantity !== undefined) {
            value = `${line.quantity} ${item.unit}`;
          } else if (line?.level) {
            value = LEVEL_LABELS[line.level];
          }
          return (
            <div className="staff-count-row" key={item.id}>
              <CountItemIdentity item={item} />
              <div
                className={`staff-readonly-count${line ? '' : ' not-counted'}`}
              >
                {value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CountItemIdentity({ item }: { item: CountSheetItem }) {
  return (
    <div>
      <div className="staff-count-item-name">
        {item.name}
        {item.critical && <span>Critical</span>}
      </div>
      <div className="staff-count-item-meta">{itemMeta(item)}</div>
    </div>
  );
}

export function CountSheetPage({ phase }: { phase: StockCountPhase }) {
  const pageName = phase === 'open' ? 'Opening count' : 'Closing count';
  useDocumentTitle(pageName);
  const [sheet, setSheet] = useState<CountSheet | null>(null);
  const [staff, setStaff] = useState<InventoryStaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [shiftLead, setShiftLead] = useState('');
  const [values, setValues] = useState<CountDraft>({});
  const [fieldErrors, setFieldErrors] = useState<CountFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingAnother, setRecordingAnother] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const loadSheet =
      phase === 'open' ? getOpeningCountSheet : getClosingCountSheet;
    Promise.all([loadSheet(), listActiveInventoryStaff()])
      .then(([nextSheet, nextStaff]) => {
        if (cancelled) return;
        setSheet(nextSheet);
        setStaff(nextStaff);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('The count sheet could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, loadVersion]);

  const lines = useMemo(
    () => (sheet ? toCountLines(sheet.items, values) : []),
    [sheet, values],
  );
  const canSubmit = Boolean(submittedBy) && lines.length > 0 && !isSubmitting;

  function resetDraft() {
    setSubmittedBy('');
    setShiftLead('');
    setValues({});
    setFieldErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sheet || isSubmitting) return;

    const nextErrors: CountFieldErrors = {};
    if (!submittedBy) {
      nextErrors.submittedBy = 'Choose the staff member submitting this count.';
    }
    if (lines.length === 0) {
      nextErrors.lines = 'Count at least one item before submitting.';
    } else if (
      lines.some(
        (line) =>
          line.quantity !== undefined &&
          (!Number.isInteger(line.quantity) || line.quantity < 0),
      )
    ) {
      nextErrors.lines = 'Quantities must be whole numbers at or above zero.';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const submitted = await submitStockCount({
        phase,
        submittedByStaffMemberId: submittedBy,
        shiftLeadStaffMemberId: shiftLead || null,
        lines,
      });
      setSheet({ ...sheet, submittedCount: submitted });
      setRecordingAnother(false);
      resetDraft();
    } catch (error) {
      setFieldErrors(
        countServerErrors(
          errorMessages(
            error,
            'No count was recorded. Check the sheet and try again.',
          ),
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <LoadingState />
      </main>
    );
  }
  if (loadError || !sheet) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <PageHeading title={pageName} description="Record the physical stock on hand." />
        <LoadError
          message={loadError}
          retry={() => setLoadVersion((version) => version + 1)}
        />
      </main>
    );
  }

  const submitted = !recordingAnother ? sheet.submittedCount : null;
  const isEmptyOpening = phase === 'open' && sheet.items.length === 0;

  return (
    <main id="staff-main" className="staff-inventory-workspace">
      <section className="staff-inventory-screen" aria-labelledby={`${phase}-title`}>
        <PageHeading
          headingId={`${phase}-title`}
          title={pageName}
          description={
            phase === 'open'
              ? 'Count the active Critical items before service begins.'
              : 'Record the physical count for every active stock item.'
          }
          businessDay={sheet.businessDay}
          context={dayTypeLabel(sheet.businessDay.dayType)}
        />
        {!sheet.businessDay.isOpen ? (
          <NoOpenDay />
        ) : isEmptyOpening ? (
          <div className="staff-inventory-blocking" role="status">
            <p>No active Critical items.</p>
          </div>
        ) : submitted ? (
          <ReadOnlyCount
            sheet={sheet}
            submitted={submitted}
            onRecordAnother={() => {
              resetDraft();
              setRecordingAnother(true);
            }}
          />
        ) : (
          <form
            className="staff-inventory-panel"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="staff-count-selectors">
              <Field
                label="Submitted by"
                htmlFor={`${phase}-submitted-by`}
                error={fieldErrors.submittedBy}
              >
                <select
                  id={`${phase}-submitted-by`}
                  required
                  value={submittedBy}
                  aria-invalid={Boolean(fieldErrors.submittedBy)}
                  aria-describedby={
                    fieldErrors.submittedBy
                      ? `${phase}-submitted-by-error`
                      : undefined
                  }
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setSubmittedBy(event.target.value);
                    setFieldErrors((current) => ({
                      ...current,
                      submittedBy: undefined,
                    }));
                  }}
                >
                  <option value="">Select active staff</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Shift lead"
                htmlFor={`${phase}-shift-lead`}
                optional
                error={fieldErrors.shiftLead}
              >
                <select
                  id={`${phase}-shift-lead`}
                  value={shiftLead}
                  aria-invalid={Boolean(fieldErrors.shiftLead)}
                  aria-describedby={
                    fieldErrors.shiftLead
                      ? `${phase}-shift-lead-error`
                      : undefined
                  }
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setShiftLead(event.target.value);
                    setFieldErrors((current) => ({
                      ...current,
                      shiftLead: undefined,
                    }));
                  }}
                >
                  <option value="">None</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="staff-count-list">
              {sheet.items.map((item) => (
                <div className="staff-count-row" key={item.id}>
                  <CountItemIdentity item={item} />
                  {item.countMethod === CountMethod.QUANTITY ? (
                    <Field
                      label={`Quantity for ${item.name}`}
                      htmlFor={`${phase}-${item.id}`}
                    >
                      <input
                        className="staff-quantity-input"
                        id={`${phase}-${item.id}`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={values[item.id] ?? ''}
                        disabled={isSubmitting}
                        onChange={(event) => {
                          const next =
                            Number(event.target.value) < 0
                              ? '0'
                              : event.target.value;
                          setValues((current) => ({
                            ...current,
                            [item.id]: next,
                          }));
                          setFieldErrors((current) => ({
                            ...current,
                            lines: undefined,
                          }));
                        }}
                      />
                    </Field>
                  ) : (
                    <fieldset className="staff-level-fieldset">
                      <legend className="sr-only">
                        Level for {item.name}
                      </legend>
                      <div className="staff-level-options">
                        {LEVEL_OPTIONS.map(([level, label]) => {
                          const id = `${phase}-${item.id}-${level}`;
                          return (
                            <div className="staff-radio-option" key={level}>
                              <input
                                id={id}
                                type="radio"
                                name={`${phase}-${item.id}`}
                                value={level}
                                checked={values[item.id] === level}
                                disabled={isSubmitting}
                                onChange={() => {
                                  setValues((current) => ({
                                    ...current,
                                    [item.id]: level,
                                  }));
                                  setFieldErrors((current) => ({
                                    ...current,
                                    lines: undefined,
                                  }));
                                }}
                              />
                              <label htmlFor={id}>{label}</label>
                            </div>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                </div>
              ))}
            </div>
            {fieldErrors.lines && (
              <p className="staff-inventory-message error" role="alert">
                {fieldErrors.lines}
              </p>
            )}
            <div className="staff-inventory-actions">
              <button
                className="staff-inventory-button primary"
                type="submit"
                disabled={!canSubmit}
                aria-busy={isSubmitting}
              >
                {isSubmitting
                  ? 'Submitting count…'
                  : `Submit ${phase === 'open' ? 'opening' : 'closing'} count`}
              </button>
              {!submittedBy && (
                <span>Choose Submitted by to enable submission.</span>
              )}
              {submittedBy && lines.length === 0 && (
                <span>Count at least one item to enable submission.</span>
              )}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export function OpeningCountPage() {
  return <CountSheetPage phase="open" />;
}

export function ClosingCountPage() {
  return <CountSheetPage phase="close" />;
}

export function RestockStatusPage() {
  useDocumentTitle('Restock status');
  const [result, setResult] = useState<RestockStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getRestockStatus()
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Restock status could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  if (loading) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <LoadingState />
      </main>
    );
  }

  if (loadError || !result) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <PageHeading title="Restock status" description="Review the most urgent items first." />
        <LoadError
          message={loadError}
          retry={() => setLoadVersion((version) => version + 1)}
        />
      </main>
    );
  }

  const source = result.selectedPhase
    ? `${result.selectedPhase === 'close' ? 'Closing' : 'Opening'} count`
    : '';

  return (
    <main id="staff-main" className="staff-inventory-workspace">
      <section className="staff-inventory-screen" aria-labelledby="restock-title">
        <PageHeading
          headingId="restock-title"
          title="Restock status"
          description="Review stock status from the latest count for this business day."
          businessDay={result.businessDay}
          context={source}
        />
        {!result.businessDay.isOpen ? (
          <NoOpenDay />
        ) : !result.hasCount ? (
          <div className="staff-inventory-blocking" role="status">
            <p>No count has been submitted for this day yet.</p>
          </div>
        ) : (
          <>
            <p className="staff-restock-source">
              Using {result.selectedPhase === 'close' ? 'closing' : 'opening'}{' '}
              count submitted at{' '}
              {formatRecordedAt(result.selectedCountRecordedAt!)}
            </p>
            <div className="staff-inventory-table-wrap">
              <table>
                <caption>
                  Restock status for{' '}
                  {formatBusinessDate(result.businessDay.businessDate)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Counted</th>
                    <th scope="col">Par</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.inventoryItemId}>
                      <td>
                        <strong>{row.itemName}</strong>
                        {row.critical && <small>Critical</small>}
                      </td>
                      <td className="staff-number-cell">
                        {row.countMethod === CountMethod.LEVEL ? (
                          <span className="staff-counted-level">
                            <strong>{LEVEL_LABELS[row.level!]}</strong>
                            <small>Level</small>
                          </span>
                        ) : (
                          row.quantity
                        )}
                      </td>
                      <td className="staff-number-cell">
                        {row.countMethod === CountMethod.LEVEL || row.par === null
                          ? '—'
                          : row.par}
                      </td>
                      <td>
                        <span
                          className={`staff-restock-status ${row.status
                            .toLowerCase()
                            .replace('_', '-')}`}
                        >
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="staff-table-scroll-hint">
              Swipe table sideways to compare all columns.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

interface MovementDraft {
  itemId: string;
  type: MovementType;
  quantity: string;
  recordedBy: string;
  reason: string;
}

const EMPTY_MOVEMENT_DRAFT: MovementDraft = {
  itemId: '',
  type: MovementType.DELIVERY,
  quantity: '',
  recordedBy: '',
  reason: '',
};

export function StockMovementsPage() {
  useDocumentTitle('Deliveries & wastage');
  const [data, setData] = useState<StockMovementList | null>(null);
  const [items, setItems] = useState<CountSheetItem[]>([]);
  const [staff, setStaff] = useState<InventoryStaffOption[]>([]);
  const [draft, setDraft] = useState<MovementDraft>(EMPTY_MOVEMENT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([
      listStockMovements(),
      getClosingCountSheet(),
      listActiveInventoryStaff(),
    ])
      .then(([nextData, sheet, nextStaff]) => {
        if (cancelled) return;
        setData(nextData);
        setItems(
          [...sheet.items].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setStaff(nextStaff);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Deliveries and wastage could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  function updateDraft(patch: Partial<MovementDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError('');
    setNotice('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || isSubmitting) return;
    if (!draft.itemId) {
      setFormError('No movement was recorded. Select an item and try again.');
      return;
    }
    if (draft.quantity === '') {
      setFormError('No movement was recorded. Enter a quantity and try again.');
      return;
    }
    const quantity = Number(draft.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setFormError(
        'No movement was recorded. Quantity must be a whole number at or above zero.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const movement = await createStockMovement({
        inventoryItemId: draft.itemId,
        type: draft.type,
        quantity,
        recordedByStaffMemberId: draft.recordedBy || null,
        reason: draft.reason.trim() || null,
      });
      setData({
        ...data,
        movements: [movement, ...data.movements],
      });
      setDraft(EMPTY_MOVEMENT_DRAFT);
      setNotice('Movement recorded. The form is ready for another entry.');
    } catch (error) {
      setFormError(
        errorMessages(
          error,
          'No movement was recorded. Check the form and try again.',
        ).join(' '),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <LoadingState />
      </main>
    );
  }

  if (loadError || !data) {
    return (
      <main id="staff-main" className="staff-inventory-workspace">
        <PageHeading
          headingId="movements-title"
          title="Deliveries & wastage"
          description="Record stock changes between physical counts."
        />
        <LoadError
          message={loadError}
          retry={() => setLoadVersion((version) => version + 1)}
        />
      </main>
    );
  }

  return (
    <main id="staff-main" className="staff-inventory-workspace">
      <section className="staff-inventory-screen" aria-labelledby="movements-title">
        <PageHeading
          headingId="movements-title"
          title="Deliveries & wastage"
          description="Record stock changes between physical counts."
          businessDay={data.businessDay}
          context={dayTypeLabel(data.businessDay.dayType)}
        />
        {!data.businessDay.isOpen ? (
          <NoOpenDay />
        ) : (
          <>
            <form
              className="staff-inventory-panel"
              noValidate
              onSubmit={handleSubmit}
            >
              <p className="staff-permanence-warning">
                Each entry is permanent. Check the item, type, and quantity
                before recording.
              </p>
              <div className="staff-movement-form">
                <Field label="Item" htmlFor="movement-item">
                  <select
                    id="movement-item"
                    required
                    value={draft.itemId}
                    disabled={isSubmitting}
                    onChange={(event) => updateDraft({ itemId: event.target.value })}
                  >
                    <option value="">Select item</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemSelectLabel(item)}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset className="staff-movement-type">
                  <legend>
                    Type
                    <span className="staff-inventory-required" aria-hidden="true">
                      {' '}*
                    </span>
                  </legend>
                  <div className="staff-type-options">
                    {MOVEMENT_OPTIONS.map(([type, label]) => {
                      const id = `movement-${type.toLowerCase()}`;
                      return (
                        <div className="staff-radio-option" key={type}>
                          <input
                            id={id}
                            type="radio"
                            name="movement-type"
                            value={type}
                            checked={draft.type === type}
                            disabled={isSubmitting}
                            onChange={() => updateDraft({ type })}
                          />
                          <label htmlFor={id}>{label}</label>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
                <Field label="Quantity" htmlFor="movement-quantity">
                  <input
                    id="movement-quantity"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    required
                    placeholder="Whole units"
                    value={draft.quantity}
                    disabled={isSubmitting}
                    onChange={(event) =>
                      updateDraft({ quantity: event.target.value })
                    }
                  />
                </Field>
                <Field label="Recorded by" htmlFor="movement-recorded-by" optional>
                  <select
                    id="movement-recorded-by"
                    value={draft.recordedBy}
                    disabled={isSubmitting}
                    onChange={(event) =>
                      updateDraft({ recordedBy: event.target.value })
                    }
                  >
                    <option value="">—</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reason" htmlFor="movement-reason" optional>
                  <input
                    id="movement-reason"
                    type="text"
                    maxLength={120}
                    placeholder="e.g. AM delivery, dropped tray"
                    value={draft.reason}
                    disabled={isSubmitting}
                    onChange={(event) => updateDraft({ reason: event.target.value })}
                  />
                </Field>
              </div>
              <div className="staff-inventory-actions">
                <button
                  className="staff-inventory-button primary"
                  type="submit"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? 'Recording movement…' : 'Record movement'}
                </button>
              </div>
              {formError && (
                <p className="staff-inventory-message error" role="alert">
                  {formError}
                </p>
              )}
              {notice && (
                <p className="staff-inventory-message success" role="status">
                  {notice}
                </p>
              )}
            </form>
            <section
              className="staff-movement-table-section"
              aria-labelledby="today-movements"
            >
              <h2 id="today-movements">Today&apos;s entries</h2>
              {data.movements.length === 0 ? (
                <div className="staff-inventory-blocking" role="status">
                  <p>No movements recorded today.</p>
                </div>
              ) : (
                <>
                  <div className="staff-inventory-table-wrap" aria-live="polite">
                    <table>
                      <caption>
                        Movements recorded on{' '}
                        {formatBusinessDate(data.businessDay.businessDate)},
                        newest first
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col">Type</th>
                          <th scope="col">Quantity</th>
                          <th scope="col">Reason</th>
                          <th scope="col">Who</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.movements.map((movement) => (
                          <tr key={movement.id}>
                            <td><strong>{movement.itemName}</strong></td>
                            <td>
                              {movement.type === MovementType.DELIVERY
                                ? 'Delivery'
                                : 'Wastage'}
                            </td>
                            <td className="staff-number-cell">
                              {movement.quantity}
                            </td>
                            <td>{movement.reason || '—'}</td>
                            <td>{movement.recordedByNameSnapshot || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="staff-table-scroll-hint">
                    Swipe table sideways to review every field.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
