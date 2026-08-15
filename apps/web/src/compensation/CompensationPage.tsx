import {
  addMoney,
  cents,
  type MoneyCents,
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
  listCompensationEntries,
  updateCompensationEntry,
} from './api';

interface EntryDraft {
  id?: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  workDate: string;
  salary: string;
  commission: string;
}

type DraftField = 'staffMemberId' | 'workDate' | 'salary' | 'commission';
type DraftErrors = Partial<Record<DraftField, string>>;
interface AmountResult { cents?: MoneyCents; error?: string }

const MAX_AMOUNT_CENTS = 2_147_483_647;
const EMPTY_DRAFT: EntryDraft = {
  staffMemberId: '',
  staffMemberDisplayName: '',
  workDate: '',
  salary: '',
  commission: '',
};

export function currencyToCents(value: string, label = 'Amount'): AmountResult {
  const trimmed = value.trim();
  if (!trimmed) return { error: `Enter a ${label.toLowerCase()} amount. Zero is allowed.` };
  if (trimmed.startsWith('-')) return { error: `${label} cannot be negative.` };
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { error: `${label} must be a number.` };
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > 2) return { error: `${label} cannot have more than 2 decimal places.` };
  const centavos = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (centavos > BigInt(MAX_AMOUNT_CENTS)) return { error: `${label} is too large.` };
  return { cents: cents(Number(centavos)) };
}

export function compensationDefaultRange(now = new Date()): { from: string; to: string } {
  const today = shopDate(now);
  const [year, month] = today.split('-').map(Number);
  const finalDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return { from: `${prefix}-01`, to: `${prefix}-${finalDay}` };
}

function amountForInput(value: MoneyCents): string {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;
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
  return next;
}

export function CompensationPage() {
  const [initialRange] = useState(compensationDefaultRange);
  const [entries, setEntries] = useState<StaffCompensationEntry[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffMemberId, setStaffMemberId] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [allEntryIds, setAllEntryIds] = useState<Set<string> | null>(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [modalError, setModalError] = useState('');
  const [conflict, setConflict] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffCompensationEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const editSalaryRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.title = 'Compensation · UCM Coffee Studio';
    void listStaffMembers({ sort: 'name', direction: 'asc' })
      .then(setStaff)
      .catch(() => setPageError('The staff list could not be loaded. Refresh the page to try again.'));
    void listCompensationEntries({})
      .then((result) => setAllEntryIds(new Set(result.map((entry) => entry.id))))
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
    });
    setErrors({}); setModalError(''); setConflict('');
  }

  function closeEditor() {
    if (saving) return;
    setDraft(null); setErrors({}); setModalError(''); setConflict('');
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function changeDraft(field: DraftField, value: string) {
    if (!draft) return;
    const selected = field === 'staffMemberId' ? staff.find((member) => member.id === value) : undefined;
    setDraft({ ...draft, [field]: value, ...(selected ? { staffMemberDisplayName: selected.displayName } : {}) });
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setModalError(''); setConflict('');
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
    return next;
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const nextErrors = validateDraft();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        const first = (['staffMemberId', 'workDate', 'salary', 'commission'] as const).find((field) => nextErrors[field]);
        if (first) document.getElementById(`compensation-${first}`)?.focus();
      });
      return;
    }
    setSaving(true); setModalError(''); setConflict(''); setNotice('');
    try {
      const amounts = { salaryCents: salaryResult.cents!, commissionCents: commissionResult.cents! };
      const saved = draft.id
        ? await updateCompensationEntry(draft.id, amounts)
        : await createCompensationEntry({ staffMemberId: draft.staffMemberId, workDate: draft.workDate, ...amounts });
      setEntries((current) => [...current.filter((entry) => entry.id !== saved.id), saved].sort(
        (left, right) => right.workDate.localeCompare(left.workDate) || left.staffMemberDisplayName.localeCompare(right.staffMemberDisplayName),
      ));
      setAllEntryIds((current) => new Set([...(current ?? []), saved.id]));
      setDraft(null);
      setNotice(`${saved.staffMemberDisplayName}'s ${formatBusinessDate(saved.workDate)} record was ${draft.id ? 'updated' : 'added'}. Daily total: ${formatMoney(saved.dailyTotalCents)}.`);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      if (error instanceof CompensationApiError && error.status === 409) {
        setConflict(`Nothing was changed. ${draft.staffMemberDisplayName} already has a record for ${formatBusinessDate(draft.workDate)}.`);
      } else if (error instanceof CompensationApiError) {
        const serverErrors = serverValidationErrors(error);
        if (Object.keys(serverErrors).length) setErrors(serverErrors);
        else setModalError(errorText(error, 'The daily record could not be saved. Try again.'));
      } else setModalError('The daily record could not be saved. Try again.');
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setPageError('');
    try {
      await deleteCompensationEntry(deleteTarget.id);
      setEntries((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      setAllEntryIds((current) => {
        const next = new Set(current ?? []);
        next.delete(deleteTarget.id);
        return next;
      });
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

  const noRecordsAtAll = !loading && entries.length === 0 && allEntryIds?.size === 0;
  const noMatches = !loading && entries.length === 0 && Boolean(allEntryIds?.size);
  const conflictingEntry = draft && conflict
    ? entries.find((entry) => entry.staffMemberId === draft.staffMemberId && entry.workDate === draft.workDate)
    : undefined;

  return (
    <main className="catalog-page compensation-page">
      <header className="catalog-page-head">
        <div><h1>Compensation</h1><p>Daily salary and commission records</p></div>
        <button ref={addButtonRef} className="catalog-button primary" type="button" onClick={openAdd}><Icon name="plus" /> Add daily record</button>
      </header>
      <nav className="compensation-sections" aria-label="Compensation sections"><button type="button" aria-current="page">Daily records</button><span aria-disabled="true">Payslips</span></nav>
      {notice && <Notice tone="success" title="Compensation records updated"><p>{notice}</p></Notice>}
      {pageError && <Notice tone="danger" title="Compensation unavailable"><p>{pageError}</p></Notice>}

      <section className="catalog-panel" aria-labelledby="records-heading">
        <h2 className="sr-only" id="records-heading">Daily compensation records</h2>
        <form className="compensation-filters" aria-label="Filter compensation records" onSubmit={(event) => event.preventDefault()}>
          <label><span>Staff member</span><select value={staffMemberId} onChange={(event) => setStaffMemberId(event.target.value)}><option value="">All staff</option>{staff.map((member) => <option value={member.id} key={member.id}>{member.displayName}{member.isActive ? '' : ' (inactive)'}</option>)}</select></label>
          <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
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
      </section>

      {draft && <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="inventory-modal staff-modal compensation-modal" role="dialog" aria-modal="true" aria-labelledby="compensation-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') closeEditor(); else trapDialogFocus(event); }}>
        <header className="inventory-modal-head"><div><h2 id="compensation-dialog-title">{draft.id ? 'Edit daily record' : 'Add daily record'}</h2><p>{draft.id ? 'Update the amounts for this record.' : 'Record salary and commission for one work date.'}</p></div><button className="catalog-button small" type="button" aria-label="Close daily record editor" disabled={saving} onClick={closeEditor}>Close</button></header>
        <form noValidate onSubmit={saveEntry}>
          {Object.keys(errors).length > 0 && <div className="staff-account-error-list" role="alert" aria-labelledby="compensation-errors-title"><strong id="compensation-errors-title">Fix the following</strong><ul>{Object.entries(errors).map(([field, message]) => <li key={field}><a href={`#compensation-${field}`}>{message}</a></li>)}</ul></div>}
          {modalError && <Notice tone="danger" title="Daily record not saved"><p>{modalError}</p></Notice>}
          {conflict && <div ref={conflictRef} className="catalog-notice danger compensation-conflict" role="alert" aria-live="assertive" tabIndex={-1}><Icon name="alert" /><div><strong>A record already exists</strong><p>{conflict}</p>{conflictingEntry && <button className="compensation-conflict-link" type="button" onClick={() => openEdit(conflictingEntry, true)}>Open the existing record</button>}</div></div>}
          {draft.id ? <dl className="compensation-fixed-context"><div><dt>Staff member</dt><dd>{draft.staffMemberDisplayName}</dd></div><div><dt>Work date</dt><dd>{formatBusinessDate(draft.workDate)}</dd></div></dl> : <div className="inventory-modal-grid"><div className="catalog-field"><label htmlFor="compensation-staffMemberId">Staff member <span aria-hidden="true">*</span></label><select ref={firstFieldRef} id="compensation-staffMemberId" value={draft.staffMemberId} disabled={saving} aria-invalid={Boolean(errors.staffMemberId)} aria-describedby={errors.staffMemberId ? 'compensation-staff-error' : 'compensation-staff-help'} onChange={(event) => changeDraft('staffMemberId', event.target.value)}><option value="">Choose active staff</option>{activeStaff.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select><p className="catalog-field-help" id="compensation-staff-help">Only active staff members can be selected.</p>{errors.staffMemberId && <p className="catalog-field-error" id="compensation-staff-error">{errors.staffMemberId}</p>}</div><div className="catalog-field"><label htmlFor="compensation-workDate">Work date <span aria-hidden="true">*</span></label><input id="compensation-workDate" type="date" max={shopDate()} value={draft.workDate} disabled={saving} aria-invalid={Boolean(errors.workDate)} aria-describedby={errors.workDate ? 'compensation-date-help compensation-date-error' : 'compensation-date-help'} onChange={(event) => changeDraft('workDate', event.target.value)} /><p className="catalog-field-help" id="compensation-date-help">Today or earlier.</p>{errors.workDate && <p className="catalog-field-error" id="compensation-date-error">{errors.workDate}</p>}</div></div>}
          <div className="inventory-modal-grid"><div className="catalog-field"><label htmlFor="compensation-salary">Salary amount <span aria-hidden="true">*</span></label><input ref={editSalaryRef} id="compensation-salary" type="text" inputMode="decimal" value={draft.salary} disabled={saving} aria-invalid={Boolean(errors.salary)} aria-describedby={errors.salary ? 'compensation-salary-help compensation-salary-error' : 'compensation-salary-help'} onChange={(event) => changeDraft('salary', event.target.value)} /><p className="catalog-field-help" id="compensation-salary-help">PHP, up to 2 decimal places. Zero is allowed.</p>{errors.salary && <p className="catalog-field-error" id="compensation-salary-error">{errors.salary}</p>}</div><div className="catalog-field"><label htmlFor="compensation-commission">Commission amount <span aria-hidden="true">*</span></label><input id="compensation-commission" type="text" inputMode="decimal" value={draft.commission} disabled={saving} aria-invalid={Boolean(errors.commission)} aria-describedby={errors.commission ? 'compensation-commission-help compensation-commission-error' : 'compensation-commission-help'} onChange={(event) => changeDraft('commission', event.target.value)} /><p className="catalog-field-help" id="compensation-commission-help">PHP, up to 2 decimal places. Zero is allowed.</p>{errors.commission && <p className="catalog-field-error" id="compensation-commission-error">{errors.commission}</p>}</div></div>
          <div className="compensation-total" aria-live="polite"><div><strong>Daily total</strong><p>Computed from salary + commission. Not editable.</p></div><strong className="num">{previewTotal === null ? 'Not available' : formatMoney(previewTotal)}</strong></div>
          <div className="staff-modal-actions"><button className="catalog-button" type="button" disabled={saving} onClick={closeEditor}>Cancel</button><button className="catalog-button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add record'}</button></div>
        </form>
      </section></div>}

      {deleteTarget && <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}><section className="inventory-modal compensation-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-compensation-title" onKeyDown={(event) => { if (event.key === 'Escape') closeDelete(); else trapDialogFocus(event); }}>
        <header className="inventory-modal-head"><h2 id="delete-compensation-title">Delete daily record?</h2></header><div className="compensation-delete-body"><p>This permanently deletes {deleteTarget.staffMemberDisplayName}&apos;s record for {formatBusinessDate(deleteTarget.workDate)} with a daily total of <strong className="num">{formatMoney(deleteTarget.dailyTotalCents)}</strong>.</p><Notice tone="danger" title="This cannot be undone." /><div className="staff-modal-actions"><button ref={deleteCancelRef} className="catalog-button" type="button" disabled={deleting} onClick={closeDelete}>Cancel</button><button className="catalog-button danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete record'}</button></div></div>
      </section></div>}
    </main>
  );
}
