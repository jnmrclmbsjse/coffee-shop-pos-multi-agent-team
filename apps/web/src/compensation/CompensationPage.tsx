import {
  addMoney,
  ALLOWANCE_DESCRIPTION_PRESETS,
  CompensationAdjustmentKind,
  type DailyGrossSalesSuggestion,
  type StaffCompensationEntry,
  type StaffMember,
} from '@coffee-shop/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon, LoadingRows, Notice } from '../catalog/components';
import { formatBusinessDate, formatMoney, shopDate } from '../reporting/format';
import { listStaffMembers } from '../staff/api';
import {
  CompensationApiError,
  createCompensationEntry,
  deleteCompensationEntry,
  getDailyGrossSuggestion,
  listCompensationAdjustments,
  listCompensationEntries,
  updateCompensationEntry,
} from './api';
import { AdjustmentsView } from './AdjustmentsView';
import { CutoffStepper } from './CutoffStepper';
import { cutoffContaining } from './domain';
import { PayslipView } from './PayslipView';
import {
  adjustmentAmountToCents,
  amountForInput,
  currencyToCents,
} from './money';

export { currencyToCents } from './money';

interface EntryDraft {
  id?: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  workDate: string;
  salary: string;
  commission: string;
  includeLoadAllowance: boolean;
  loadAllowanceAmount: string;
}

type DraftField =
  | 'staffMemberId'
  | 'workDate'
  | 'salary'
  | 'commission'
  | 'loadAllowanceAmount';
type DraftErrors = Partial<Record<DraftField, string>>;
type GrossState =
  | { status: 'loading' }
  | { status: 'ready'; suggestion: DailyGrossSalesSuggestion }
  | { status: 'error' };
type SuggestionFlags = { salary: boolean; commission: boolean };
const EMPTY_DRAFT: EntryDraft = {
  staffMemberId: '',
  staffMemberDisplayName: '',
  workDate: '',
  salary: '',
  commission: '',
  includeLoadAllowance: false,
  loadAllowanceAmount: '',
};

export function compensationDefaultRange(now = new Date()): { from: string; to: string } {
  return cutoffContaining(shopDate(now));
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'));
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof CompensationApiError ? error.messages.join(' ') : fallback;
}

function serverValidationErrors(error: CompensationApiError): DraftErrors {
  if (error.status !== 400) return {};
  const messages = error.messages.join(' ').toLowerCase();
  const next: DraftErrors = {};
  if (error.field === 'staffMemberId' || messages.includes('staffmemberid')) {
    next.staffMemberId = 'Choose a valid staff member.';
  }
  if (error.field === 'workDate' || messages.includes('workdate')) {
    next.workDate = 'Choose a valid work date.';
  }
  if (error.field === 'salaryCents' || messages.includes('salarycents')) {
    next.salary = 'Enter a valid, non-negative salary amount.';
  }
  if (error.field === 'commissionCents' || messages.includes('commissioncents')) {
    next.commission = 'Enter a valid, non-negative commission amount.';
  }
  if (
    error.field === 'loadAllowance.amountCents' ||
    messages.includes('loadallowance.amountcents')
  ) {
    next.loadAllowanceAmount = 'Enter a valid load allowance amount.';
  }
  return next;
}

export function CompensationPage() {
  const [initialRange] = useState(compensationDefaultRange);
  const [section, setSection] = useState<'records' | 'adjustments' | 'payslips'>('records');
  const [entries, setEntries] = useState<StaffCompensationEntry[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffMemberId, setStaffMemberId] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [allEntries, setAllEntries] = useState<StaffCompensationEntry[] | null>(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [modalError, setModalError] = useState('');
  const [conflict, setConflict] = useState('');
  const [gross, setGross] = useState<GrossState | null>(null);
  const [suggestionDirty, setSuggestionDirty] = useState<SuggestionFlags>({
    salary: false,
    commission: false,
  });
  const [suggestionSource, setSuggestionSource] = useState<SuggestionFlags>({
    salary: false,
    commission: false,
  });
  const [duplicateLoadAllowance, setDuplicateLoadAllowance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffCompensationEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const editSalaryRef = useRef<HTMLInputElement>(null);
  const loadAllowanceCheckboxRef = useRef<HTMLInputElement>(null);
  const loadAllowanceAmountRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const suggestionDirtyRef = useRef<SuggestionFlags>({
    salary: false,
    commission: false,
  });

  useEffect(() => {
    document.title = 'Compensation · UCM Coffee Studio';
    void listStaffMembers({ sort: 'name', direction: 'asc' })
      .then(setStaff)
      .catch(() => setPageError('The staff list could not be loaded. Refresh the page to try again.'));
    void listCompensationEntries({})
      .then(setAllEntries)
      .catch(() => setPageError('Compensation records could not be loaded. Try again.'));
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setPageError('');
    void listCompensationEntries({
      staffMemberId: staffMemberId || undefined,
      from: from || undefined,
      to: to || undefined,
    }).then((result) => {
      if (!current) return;
      setEntries(result);
    }).catch(() => {
      if (current) setPageError('Compensation records could not be loaded. Try again.');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [from, staffMemberId, to]);

  useEffect(() => {
    if (!draft || draft.id || !/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate)) {
      setGross(null);
      return;
    }

    let current = true;
    const requestedWorkDate = draft.workDate;
    setGross({ status: 'loading' });
    setSuggestionSource((source) => ({ ...source, commission: false }));
    void getDailyGrossSuggestion(requestedWorkDate)
      .then((suggestion) => {
        if (!current) return;
        setGross({ status: 'ready', suggestion });
        if (!suggestionDirtyRef.current.commission) {
          setDraft((currentDraft) =>
            currentDraft &&
            !currentDraft.id &&
            currentDraft.workDate === requestedWorkDate
              ? {
                  ...currentDraft,
                  commission: amountForInput(
                    suggestion.suggestedCommissionCents,
                  ),
                }
              : currentDraft,
          );
          setSuggestionSource((source) => ({
            ...source,
            commission: true,
          }));
        }
      })
      .catch(() => {
        if (current) setGross({ status: 'error' });
      });

    return () => {
      current = false;
    };
  }, [draft?.id, draft?.workDate]);

  useEffect(() => {
    if (
      !draft ||
      draft.id ||
      !draft.includeLoadAllowance ||
      !draft.staffMemberId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate)
    ) {
      setDuplicateLoadAllowance(false);
      return;
    }

    let current = true;
    const loadAllowanceDescription = ALLOWANCE_DESCRIPTION_PRESETS[0]
      .trim()
      .toLocaleLowerCase('en-US');
    void listCompensationAdjustments({
      staffMemberId: draft.staffMemberId,
      from: draft.workDate,
      to: draft.workDate,
    })
      .then((adjustments) => {
        if (!current) return;
        setDuplicateLoadAllowance(
          adjustments.some(
            (adjustment) =>
              adjustment.kind === CompensationAdjustmentKind.ALLOWANCE &&
              adjustment.description.trim().toLocaleLowerCase('en-US') ===
                loadAllowanceDescription,
          ),
        );
      })
      .catch(() => {
        if (current) setDuplicateLoadAllowance(false);
      });

    return () => {
      current = false;
    };
  }, [
    draft?.id,
    draft?.includeLoadAllowance,
    draft?.staffMemberId,
    draft?.workDate,
  ]);

  useEffect(() => {
    if (!draft) return;
    requestAnimationFrame(() => (draft.id ? editSalaryRef.current : firstFieldRef.current)?.focus());
  }, [draft !== null, draft?.id]);
  useEffect(() => { if (conflict) requestAnimationFrame(() => conflictRef.current?.focus()); }, [conflict]);
  useEffect(() => { if (deleteTarget) requestAnimationFrame(() => deleteCancelRef.current?.focus()); }, [deleteTarget]);

  const activeStaff = useMemo(() => staff.filter((member) => member.isActive), [staff]);
  const salaryResult = currencyToCents(draft?.salary ?? '', 'Salary');
  const commissionResult = currencyToCents(draft?.commission ?? '', 'Commission');
  const previewTotal = salaryResult.cents !== undefined && commissionResult.cents !== undefined
    ? addMoney(salaryResult.cents, commissionResult.cents) : null;

  function rememberFocus() {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : addButtonRef.current;
  }

  function openAdd() {
    rememberFocus();
    suggestionDirtyRef.current = { salary: false, commission: false };
    setSuggestionDirty({ salary: false, commission: false });
    setSuggestionSource({ salary: false, commission: false });
    setDuplicateLoadAllowance(false);
    setDraft({ ...EMPTY_DRAFT, workDate: shopDate() });
    setErrors({}); setModalError(''); setConflict('');
  }

  function openEdit(entry: StaffCompensationEntry, preserveFocus = false) {
    if (!preserveFocus) rememberFocus();
    setDraft({
      id: entry.id,
      staffMemberId: entry.staffMemberId,
      staffMemberDisplayName: entry.staffMemberDisplayName,
      workDate: entry.workDate,
      salary: amountForInput(entry.salaryCents),
      commission: amountForInput(entry.commissionCents),
      includeLoadAllowance: false,
      loadAllowanceAmount: '',
    });
    suggestionDirtyRef.current = { salary: false, commission: false };
    setSuggestionDirty({ salary: false, commission: false });
    setSuggestionSource({ salary: false, commission: false });
    setDuplicateLoadAllowance(false);
    setErrors({}); setModalError(''); setConflict('');
  }

  function closeEditor() {
    if (saving) return;
    setDraft(null); setErrors({}); setModalError(''); setConflict('');
    setGross(null);
    setDuplicateLoadAllowance(false);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function changeDraft(field: DraftField, value: string) {
    if (!draft) return;
    if (field === 'staffMemberId') {
      const selected = staff.find((member) => member.id === value);
      const commissionSuggestion =
        gross?.status === 'ready'
          ? amountForInput(gross.suggestion.suggestedCommissionCents)
          : draft.commission;
      suggestionDirtyRef.current = { salary: false, commission: false };
      setSuggestionDirty({ salary: false, commission: false });
      setSuggestionSource({
        salary: selected !== undefined && selected.baseSalaryCents !== null,
        commission: gross?.status === 'ready',
      });
      setDraft({
        ...draft,
        staffMemberId: value,
        staffMemberDisplayName: selected?.displayName ?? '',
        salary:
          selected && selected.baseSalaryCents !== null
            ? amountForInput(selected.baseSalaryCents)
            : '',
        commission: commissionSuggestion,
      });
    } else if (field === 'workDate') {
      suggestionDirtyRef.current = { salary: false, commission: false };
      setSuggestionDirty({ salary: false, commission: false });
      setSuggestionSource((source) => ({ ...source, commission: false }));
      setDraft({ ...draft, workDate: value, commission: '' });
    } else {
      if (field === 'salary' || field === 'commission') {
        suggestionDirtyRef.current = {
          ...suggestionDirtyRef.current,
          [field]: true,
        };
        setSuggestionDirty((current) => ({ ...current, [field]: true }));
        setSuggestionSource((current) => ({ ...current, [field]: false }));
      }
      setDraft({ ...draft, [field]: value });
    }
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setModalError(''); setConflict('');
  }

  function toggleLoadAllowance(checked: boolean) {
    if (!draft || draft.id) return;
    setDraft({
      ...draft,
      includeLoadAllowance: checked,
      loadAllowanceAmount: checked ? draft.loadAllowanceAmount : '',
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.loadAllowanceAmount;
      return next;
    });
    setDuplicateLoadAllowance(false);
    setModalError('');
    setConflict('');
    requestAnimationFrame(() => {
      if (checked) loadAllowanceAmountRef.current?.focus();
      else loadAllowanceCheckboxRef.current?.focus();
    });
  }

  function validateDraft(): DraftErrors {
    if (!draft) return {};
    const next: DraftErrors = {};
    if (!draft.id && !draft.staffMemberId) next.staffMemberId = 'Choose an active staff member.';
    if (!draft.id && !draft.workDate) next.workDate = 'Choose a work date.';
    else if (!draft.id && !/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate)) next.workDate = 'Choose a valid work date.';
    else if (!draft.id && draft.workDate > shopDate()) next.workDate = 'Choose today or an earlier date.';
    if (salaryResult.error) next.salary = salaryResult.error;
    if (commissionResult.error) next.commission = commissionResult.error;
    if (!draft.id && draft.includeLoadAllowance) {
      const loadAllowanceResult = adjustmentAmountToCents(
        draft.loadAllowanceAmount,
      );
      if (loadAllowanceResult.error) {
        next.loadAllowanceAmount = loadAllowanceResult.error;
      }
    }
    return next;
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const nextErrors = validateDraft();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        const first = ([
          'staffMemberId',
          'workDate',
          'salary',
          'commission',
          'loadAllowanceAmount',
        ] as const).find((field) => nextErrors[field]);
        if (first) document.getElementById(`compensation-${first}`)?.focus();
      });
      return;
    }
    setSaving(true); setModalError(''); setConflict(''); setNotice('');
    try {
      const amounts = { salaryCents: salaryResult.cents!, commissionCents: commissionResult.cents! };
      const loadAllowanceResult = draft.includeLoadAllowance
        ? adjustmentAmountToCents(draft.loadAllowanceAmount)
        : undefined;
      const saved = draft.id
        ? await updateCompensationEntry(draft.id, amounts)
        : await createCompensationEntry({
            staffMemberId: draft.staffMemberId,
            workDate: draft.workDate,
            ...amounts,
            ...(loadAllowanceResult?.cents !== undefined
              ? { loadAllowance: { amountCents: loadAllowanceResult.cents } }
              : {}),
          });
      setEntries((current) => [...current.filter((entry) => entry.id !== saved.id), saved].sort(
        (left, right) => right.workDate.localeCompare(left.workDate) || left.staffMemberDisplayName.localeCompare(right.staffMemberDisplayName),
      ));
      setAllEntries((current) => [
        ...(current ?? []).filter((entry) => entry.id !== saved.id),
        saved,
      ]);
      setDraft(null);
      const allowanceNotice =
        !draft.id && loadAllowanceResult?.cents !== undefined
          ? ` A ${formatMoney(loadAllowanceResult.cents)} load allowance was also recorded.`
          : '';
      setNotice(`${saved.staffMemberDisplayName}'s ${formatBusinessDate(saved.workDate)} record was ${draft.id ? 'updated' : 'added'}. Daily total: ${formatMoney(saved.dailyTotalCents)}.${allowanceNotice}`);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      if (error instanceof CompensationApiError && error.status === 409) {
        setConflict(`Nothing was changed. ${draft.staffMemberDisplayName} already has a record for ${formatBusinessDate(draft.workDate)}.${draft.includeLoadAllowance ? ' No load allowance was recorded either.' : ''}`);
      } else if (error instanceof CompensationApiError) {
        const serverErrors = serverValidationErrors(error);
        if (Object.keys(serverErrors).length) setErrors(serverErrors);
        else setModalError(
          draft.includeLoadAllowance
            ? 'Nothing was recorded. The daily record and the load allowance are saved together, so neither was saved. Try again.'
            : errorText(
                error,
                'The daily record could not be saved. Try again.',
              ),
        );
      } else setModalError(draft.includeLoadAllowance
        ? 'Nothing was recorded. The daily record and the load allowance are saved together, so neither was saved. Try again.'
        : 'The daily record could not be saved. Try again.');
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setPageError('');
    try {
      await deleteCompensationEntry(deleteTarget.id);
      setEntries((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      setAllEntries((current) =>
        (current ?? []).filter((entry) => entry.id !== deleteTarget.id),
      );
      setNotice(`${deleteTarget.staffMemberDisplayName}'s ${formatBusinessDate(deleteTarget.workDate)} record was deleted.`);
      setDeleteTarget(null);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      setPageError(errorText(error, 'The daily record could not be deleted. Try again.'));
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  }

  function openDelete(entry: StaffCompensationEntry) { rememberFocus(); setDeleteTarget(entry); setNotice(''); }
  function clearFilters() { setStaffMemberId(''); setFrom(''); setTo(''); }

  const noRecordsAtAll = !loading && entries.length === 0 && allEntries?.length === 0;
  const noMatches = !loading && entries.length === 0 && Boolean(allEntries?.length);
  const staffMemberIdsWithEntries = useMemo(
    () => new Set((allEntries ?? []).map((entry) => entry.staffMemberId)),
    [allEntries],
  );
  const conflictingEntry = draft && conflict
    ? entries.find((entry) => entry.staffMemberId === draft.staffMemberId && entry.workDate === draft.workDate)
    : undefined;

  return (
    <main className="catalog-page compensation-page">
      <header className="catalog-page-head">
        <div>
          <h1>Compensation</h1>
          <p>
            {section === 'records'
              ? 'Daily salary and commission records'
              : section === 'adjustments'
                ? 'Manage standalone allowances, bonuses, and advances'
                : 'Review earnings, advances, and net payable'}
          </p>
        </div>
        {section === 'records' && (
          <button ref={addButtonRef} className="catalog-button primary" type="button" onClick={openAdd}><Icon name="plus" /> Add daily record</button>
        )}
      </header>
      <nav className="compensation-sections" aria-label="Compensation sections">
        <button
          type="button"
          aria-current={section === 'records' ? 'page' : undefined}
          onClick={() => setSection('records')}
        >
          Daily records
        </button>
        <button
          type="button"
          aria-current={section === 'adjustments' ? 'page' : undefined}
          onClick={() => setSection('adjustments')}
        >
          Adjustments
        </button>
        <button
          type="button"
          aria-current={section === 'payslips' ? 'page' : undefined}
          onClick={() => setSection('payslips')}
        >
          Payslips
        </button>
      </nav>
      {section === 'records' && notice && <Notice tone="success" title="Compensation records updated"><p>{notice}</p></Notice>}
      {pageError && <Notice tone="danger" title="Compensation unavailable"><p>{pageError}</p></Notice>}

      {section === 'records' ? <section className="catalog-panel" aria-labelledby="records-heading">
        <h2 className="sr-only" id="records-heading">Daily compensation records</h2>
        <form className="compensation-filters" aria-label="Filter compensation records" onSubmit={(event) => event.preventDefault()}>
          <label><span>Staff member</span><select value={staffMemberId} onChange={(event) => setStaffMemberId(event.target.value)}><option value="">All staff</option>{staff.map((member) => <option value={member.id} key={member.id}>{member.displayName}{member.isActive ? '' : ' (inactive)'}</option>)}</select></label>
          <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <CutoffStepper range={{ from, to }} onChange={(range) => { setFrom(range.from); setTo(range.to); }} />
          <button className="inventory-clear-filters" type="button" onClick={clearFilters}>Clear filters</button>
        </form>
        <p className="results-meta">{loading ? 'Loading compensation records…' : `Showing ${entries.length} ${entries.length === 1 ? 'record' : 'records'}`}</p>
        <div className="catalog-table-wrap compensation-table-wrap" tabIndex={0} role="region" aria-label="Daily compensation records table, scroll horizontally to view all columns">
          <table className="catalog-table compensation-table">
            <caption className="sr-only">Daily compensation records ordered by work date newest first, then staff member name</caption>
            <thead><tr><th scope="col">Staff member</th><th scope="col">Work date</th><th className="num" scope="col">Salary</th><th className="num" scope="col">Commission</th><th className="num" scope="col">Daily total</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{loading ? <LoadingRows columns={6} /> : noRecordsAtAll || noMatches ? <tr><td colSpan={6}><div className="catalog-empty compensation-empty"><Icon name={noRecordsAtAll ? 'document' : 'search'} /><h3>{noRecordsAtAll ? 'No compensation records yet' : 'No records match these filters'}</h3><p>{noRecordsAtAll ? 'Add the first daily record for a staff member. Salary and commission can each be zero.' : 'Try another staff member or date range.'}</p>{noRecordsAtAll ? <button className="catalog-button" type="button" onClick={openAdd}>Add daily record</button> : <button className="catalog-button" type="button" onClick={clearFilters}>Clear filters</button>}</div></td></tr> : entries.map((entry) => <tr key={entry.id}><td><strong>{entry.staffMemberDisplayName}</strong></td><td>{formatBusinessDate(entry.workDate)}</td><td className="num">{formatMoney(entry.salaryCents)}</td><td className="num">{formatMoney(entry.commissionCents)}</td><td className="num"><strong>{formatMoney(entry.dailyTotalCents)}</strong></td><td className="table-action"><div className="compensation-row-actions"><button className="catalog-button small" type="button" aria-label={`Edit ${entry.staffMemberDisplayName}'s ${entry.workDate} record`} onClick={() => openEdit(entry)}>Edit</button><button className="catalog-button small danger" type="button" aria-label={`Delete ${entry.staffMemberDisplayName}'s ${entry.workDate} record`} onClick={() => openDelete(entry)}>Delete</button></div></td></tr>)}</tbody>
          </table>
        </div>
      </section> : section === 'adjustments' ? (
        <AdjustmentsView staff={staff} initialRange={initialRange} />
      ) : (
        <PayslipView
          staff={staff}
          staffMemberIdsWithEntries={staffMemberIdsWithEntries}
          initialRange={initialRange}
        />
      )}

      {draft && (
        <div
          className="inventory-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            className="inventory-modal staff-modal compensation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compensation-dialog-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEditor();
              else trapDialogFocus(event);
            }}
          >
            <header className="inventory-modal-head">
              <div>
                <h2 id="compensation-dialog-title">
                  {draft.id ? 'Edit daily record' : 'Add daily record'}
                </h2>
                <p>
                  {draft.id
                    ? 'Update the amounts for this record.'
                    : 'Record salary and commission for one work date.'}
                </p>
              </div>
              <button
                className="catalog-button small"
                type="button"
                aria-label="Close daily record editor"
                disabled={saving}
                onClick={closeEditor}
              >
                Close
              </button>
            </header>
            <form noValidate onSubmit={saveEntry}>
              {Object.keys(errors).length > 0 && (
                <div
                  className="staff-account-error-list"
                  role="alert"
                  aria-labelledby="compensation-errors-title"
                >
                  <strong id="compensation-errors-title">
                    Fix the following
                  </strong>
                  <ul>
                    {Object.entries(errors).map(([field, message]) => (
                      <li key={field}>
                        <a href={`#compensation-${field}`}>{message}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {modalError && (
                <Notice tone="danger" title="Daily record not saved">
                  <p>{modalError}</p>
                </Notice>
              )}
              {conflict && (
                <div
                  ref={conflictRef}
                  className="catalog-notice danger compensation-conflict"
                  role="alert"
                  aria-live="assertive"
                  tabIndex={-1}
                >
                  <Icon name="alert" />
                  <div>
                    <strong>A record already exists</strong>
                    <p>{conflict}</p>
                    {conflictingEntry && (
                      <button
                        className="compensation-conflict-link"
                        type="button"
                        onClick={() => openEdit(conflictingEntry, true)}
                      >
                        Open the existing record
                      </button>
                    )}
                  </div>
                </div>
              )}
              {draft.id ? (
                <dl className="compensation-fixed-context">
                  <div>
                    <dt>Staff member</dt>
                    <dd>{draft.staffMemberDisplayName}</dd>
                  </div>
                  <div>
                    <dt>Work date</dt>
                    <dd>{formatBusinessDate(draft.workDate)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="inventory-modal-grid">
                  <div className="catalog-field">
                    <label htmlFor="compensation-staffMemberId">
                      Staff member <span aria-hidden="true">*</span>
                    </label>
                    <select
                      ref={firstFieldRef}
                      id="compensation-staffMemberId"
                      value={draft.staffMemberId}
                      disabled={saving}
                      aria-invalid={Boolean(errors.staffMemberId)}
                      aria-describedby={
                        errors.staffMemberId
                          ? 'compensation-staff-error'
                          : 'compensation-staff-help'
                      }
                      onChange={(event) =>
                        changeDraft('staffMemberId', event.target.value)
                      }
                    >
                      <option value="">Choose active staff</option>
                      {activeStaff.map((member) => (
                        <option value={member.id} key={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                    <p
                      className="catalog-field-help"
                      id="compensation-staff-help"
                    >
                      Only active staff members can be selected.
                    </p>
                    {errors.staffMemberId && (
                      <p
                        className="catalog-field-error"
                        id="compensation-staff-error"
                      >
                        {errors.staffMemberId}
                      </p>
                    )}
                  </div>
                  <div className="catalog-field">
                    <label htmlFor="compensation-workDate">
                      Work date <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="compensation-workDate"
                      type="date"
                      max={shopDate()}
                      value={draft.workDate}
                      disabled={saving}
                      aria-invalid={Boolean(errors.workDate)}
                      aria-describedby={
                        errors.workDate
                          ? 'compensation-date-help compensation-date-error'
                          : 'compensation-date-help'
                      }
                      onChange={(event) =>
                        changeDraft('workDate', event.target.value)
                      }
                    />
                    <p
                      className="catalog-field-help"
                      id="compensation-date-help"
                    >
                      Today or earlier.
                    </p>
                    {errors.workDate && (
                      <p
                        className="catalog-field-error"
                        id="compensation-date-error"
                      >
                        {errors.workDate}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!draft.id && gross && (
                <div
                  className="compensation-total compensation-gross"
                  role="status"
                  aria-live="polite"
                >
                  <div>
                    <strong>Gross sales for this date</strong>
                    <p>
                      All completed sales for this business date. Commission
                      suggestion: ₱50 for every full ₱1,000.
                    </p>
                    {gross.status === 'ready' &&
                      !gross.suggestion.hasBusinessDay && (
                        <p className="staff-permanence-warning compensation-gross-note">
                          No business day on this date
                        </p>
                      )}
                    {gross.status === 'error' && (
                      <Notice tone="danger" title="Gross sales unavailable">
                        <p>
                          Sales for this date could not be loaded. The
                          commission suggestion is unavailable. Enter the
                          commission by hand.
                        </p>
                      </Notice>
                    )}
                  </div>
                  <strong
                    className={`num${
                      gross.status === 'ready'
                        ? ''
                        : ' compensation-gross-status'
                    }`}
                  >
                    {gross.status === 'loading'
                      ? 'Checking…'
                      : gross.status === 'ready'
                        ? formatMoney(gross.suggestion.grossSalesCents)
                        : 'Unavailable'}
                  </strong>
                </div>
              )}

              <div className="inventory-modal-grid">
                <div className="catalog-field">
                  <label htmlFor="compensation-salary">
                    Salary amount <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={editSalaryRef}
                    id="compensation-salary"
                    type="text"
                    inputMode="decimal"
                    value={draft.salary}
                    disabled={saving}
                    aria-invalid={Boolean(errors.salary)}
                    aria-describedby={[
                      'compensation-salary-help',
                      !draft.id &&
                      suggestionSource.salary &&
                      !suggestionDirty.salary
                        ? 'compensation-salary-suggested'
                        : '',
                      errors.salary ? 'compensation-salary-error' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onChange={(event) =>
                      changeDraft('salary', event.target.value)
                    }
                  />
                  <p
                    className="catalog-field-help"
                    id="compensation-salary-help"
                  >
                    PHP, up to 2 decimal places. Zero is allowed.
                  </p>
                  {!draft.id &&
                    suggestionSource.salary &&
                    !suggestionDirty.salary && (
                      <p className="compensation-field-annotation">
                        <span
                          className="compensation-suggested"
                          id="compensation-salary-suggested"
                        >
                          From base salary
                        </span>
                      </p>
                    )}
                  {errors.salary && (
                    <p
                      className="catalog-field-error"
                      id="compensation-salary-error"
                    >
                      {errors.salary}
                    </p>
                  )}
                </div>
                <div className="catalog-field">
                  <label htmlFor="compensation-commission">
                    Commission amount <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="compensation-commission"
                    type="text"
                    inputMode="decimal"
                    value={draft.commission}
                    disabled={saving}
                    aria-invalid={Boolean(errors.commission)}
                    aria-describedby={[
                      'compensation-commission-help',
                      !draft.id &&
                      suggestionSource.commission &&
                      !suggestionDirty.commission
                        ? 'compensation-commission-suggested'
                        : '',
                      errors.commission
                        ? 'compensation-commission-error'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onChange={(event) =>
                      changeDraft('commission', event.target.value)
                    }
                  />
                  <p
                    className="catalog-field-help"
                    id="compensation-commission-help"
                  >
                    PHP, up to 2 decimal places. Zero is allowed.
                  </p>
                  {!draft.id &&
                    suggestionSource.commission &&
                    !suggestionDirty.commission && (
                      <p className="compensation-field-annotation">
                        <span
                          className="compensation-suggested"
                          id="compensation-commission-suggested"
                        >
                          Suggested from gross sales
                        </span>
                      </p>
                    )}
                  {errors.commission && (
                    <p
                      className="catalog-field-error"
                      id="compensation-commission-error"
                    >
                      {errors.commission}
                    </p>
                  )}
                </div>
              </div>
              <div className="compensation-total" aria-live="polite">
                <div>
                  <strong>Daily total</strong>
                  <p>Computed from salary + commission. Not editable.</p>
                </div>
                <strong className="num">
                  {previewTotal === null
                    ? 'Not available'
                    : formatMoney(previewTotal)}
                </strong>
              </div>

              {!draft.id && (
                <div className="compensation-load-allowance">
                  <label
                    className="compensation-load-allowance-choice"
                    htmlFor="compensation-loadAllowance"
                  >
                    <input
                      ref={loadAllowanceCheckboxRef}
                      id="compensation-loadAllowance"
                      type="checkbox"
                      checked={draft.includeLoadAllowance}
                      disabled={saving}
                      onChange={(event) =>
                        toggleLoadAllowance(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Include load allowance</strong>
                      <small>
                        Recorded as a separate allowance dated the work date.
                        Not included in the daily total.
                      </small>
                    </span>
                  </label>
                  {draft.includeLoadAllowance && (
                    <div className="catalog-field">
                      <label htmlFor="compensation-loadAllowanceAmount">
                        Load allowance amount
                      </label>
                      <span className="adjustment-amount-input">
                        <span aria-hidden="true">₱</span>
                        <input
                          ref={loadAllowanceAmountRef}
                          id="compensation-loadAllowanceAmount"
                          type="text"
                          inputMode="decimal"
                          value={draft.loadAllowanceAmount}
                          disabled={saving}
                          aria-invalid={Boolean(errors.loadAllowanceAmount)}
                          aria-describedby={
                            errors.loadAllowanceAmount
                              ? 'compensation-loadAllowance-help compensation-loadAllowance-error'
                              : 'compensation-loadAllowance-help'
                          }
                          onChange={(event) =>
                            changeDraft(
                              'loadAllowanceAmount',
                              event.target.value,
                            )
                          }
                        />
                      </span>
                      <p
                        className="catalog-field-help"
                        id="compensation-loadAllowance-help"
                      >
                        Positive pesos, up to two decimal places. Minimum ₱0.01.
                      </p>
                      {errors.loadAllowanceAmount && (
                        <p
                          className="catalog-field-error"
                          id="compensation-loadAllowance-error"
                        >
                          {errors.loadAllowanceAmount}
                        </p>
                      )}
                    </div>
                  )}
                  {draft.includeLoadAllowance && duplicateLoadAllowance && (
                    <p
                      className="compensation-duplicate-warning"
                      role="status"
                      aria-live="polite"
                    >
                      {draft.staffMemberDisplayName} already has a Load allowance
                      for {formatBusinessDate(draft.workDate)}. Saving adds a
                      second one.
                    </p>
                  )}
                </div>
              )}
              <div className="staff-modal-actions">
                <button
                  className="catalog-button"
                  type="button"
                  disabled={saving}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
                <button
                  className="catalog-button primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : draft.id
                      ? 'Save changes'
                      : 'Add record'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleteTarget && <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}><section className="inventory-modal compensation-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-compensation-title" onKeyDown={(event) => { if (event.key === 'Escape') closeDelete(); else trapDialogFocus(event); }}>
        <header className="inventory-modal-head"><h2 id="delete-compensation-title">Delete daily record?</h2></header><div className="compensation-delete-body"><p>This permanently deletes {deleteTarget.staffMemberDisplayName}&apos;s record for {formatBusinessDate(deleteTarget.workDate)} with a daily total of <strong className="num">{formatMoney(deleteTarget.dailyTotalCents)}</strong>.</p><Notice tone="danger" title="This cannot be undone." /><div className="staff-modal-actions"><button ref={deleteCancelRef} className="catalog-button" type="button" disabled={deleting} onClick={closeDelete}>Cancel</button><button className="catalog-button danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete record'}</button></div></div>
      </section></div>}
    </main>
  );
}
