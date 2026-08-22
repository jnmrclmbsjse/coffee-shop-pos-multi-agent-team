import {
  CompensationAdjustmentKind,
  type StaffCompensationAdjustment,
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
import {
  CompensationApiError,
  createCompensationAdjustment,
  deleteCompensationAdjustment,
  listCompensationAdjustments,
  updateCompensationAdjustment,
} from './api';
import {
  adjustmentDescriptionPresets,
  adjustmentKindLabel,
  signedAdjustmentAmount,
  sortAdjustments,
} from './domain';
import { adjustmentAmountToCents, amountForInput } from './money';

interface AdjustmentDraft {
  id?: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  kind: CompensationAdjustmentKind;
  effectiveDate: string;
  description: string;
  amount: string;
}

type DraftField = 'staffMemberId' | 'effectiveDate' | 'description' | 'amount';
type DraftErrors = Partial<Record<DraftField, string>>;

interface AdjustmentsViewProps {
  staff: StaffMember[];
  initialRange: { from: string; to: string };
}

const EMPTY_DRAFT: AdjustmentDraft = {
  staffMemberId: '',
  staffMemberDisplayName: '',
  kind: CompensationAdjustmentKind.ALLOWANCE,
  effectiveDate: '',
  description: '',
  amount: '',
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof CompensationApiError ? error.messages.join(' ') : fallback;
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
  ));
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

function serverValidationErrors(error: CompensationApiError): DraftErrors {
  if (error.status !== 400) return {};
  const messages = error.messages.join(' ').toLowerCase();
  const next: DraftErrors = {};
  if (error.field === 'staffMemberId' || messages.includes('staffmemberid')) {
    next.staffMemberId = 'Choose a valid staff member.';
  }
  if (error.field === 'effectiveDate' || messages.includes('effectivedate')) {
    next.effectiveDate = 'Choose a valid effective date.';
  }
  if (error.field === 'description' || messages.includes('description')) {
    next.description = messages.includes('120')
      ? 'Description must be 120 characters or fewer.'
      : 'Enter a description. Spaces alone are not accepted.';
  }
  if (error.field === 'amountCents' || messages.includes('amountcents')) {
    next.amount = 'Enter a valid positive amount with no more than two decimal places.';
  }
  return next;
}

function isInScope(
  adjustment: StaffCompensationAdjustment,
  staffMemberId: string,
  from: string,
  to: string,
): boolean {
  return (!staffMemberId || adjustment.staffMemberId === staffMemberId)
    && (!from || adjustment.effectiveDate >= from)
    && (!to || adjustment.effectiveDate <= to);
}

export function AdjustmentsView({ staff, initialRange }: AdjustmentsViewProps) {
  const [adjustments, setAdjustments] = useState<StaffCompensationAdjustment[]>([]);
  const [allAdjustments, setAllAdjustments] = useState<StaffCompensationAdjustment[] | null>(null);
  const [staffMemberId, setStaffMemberId] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<AdjustmentDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffCompensationAdjustment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const editDateRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void listCompensationAdjustments({})
      .then(setAllAdjustments)
      .catch((error: unknown) => {
        if (error instanceof CompensationApiError && error.status === 403) setAccessDenied(true);
      });
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setPageError('');
    setAccessDenied(false);
    void listCompensationAdjustments({
      staffMemberId: staffMemberId || undefined,
      from: from || undefined,
      to: to || undefined,
    }).then((result) => {
      if (current) setAdjustments(result);
    }).catch((error: unknown) => {
      if (!current) return;
      if (error instanceof CompensationApiError && error.status === 403) setAccessDenied(true);
      else setPageError('Compensation adjustments could not be loaded. Try again.');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [from, staffMemberId, to]);

  useEffect(() => {
    if (!draft) return;
    requestAnimationFrame(() => (draft.id ? editDateRef.current : firstFieldRef.current)?.focus());
  }, [draft !== null, draft?.id]);

  useEffect(() => {
    if (deleteTarget) requestAnimationFrame(() => deleteCancelRef.current?.focus());
  }, [deleteTarget]);

  const activeStaff = useMemo(() => staff.filter((member) => member.isActive), [staff]);
  const amountResult = adjustmentAmountToCents(draft?.amount ?? '');
  const presets = draft ? adjustmentDescriptionPresets(draft.kind) : [];
  const noAdjustmentsAtAll = !loading && adjustments.length === 0 && allAdjustments?.length === 0;
  const noMatches = !loading && adjustments.length === 0 && Boolean(allAdjustments?.length);

  function rememberFocus() {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : addButtonRef.current;
  }

  function openAdd() {
    rememberFocus();
    setDraft({ ...EMPTY_DRAFT, effectiveDate: shopDate() });
    setErrors({});
    setModalError('');
    setNotice('');
  }

  function openEdit(adjustment: StaffCompensationAdjustment) {
    rememberFocus();
    setDraft({
      id: adjustment.id,
      staffMemberId: adjustment.staffMemberId,
      staffMemberDisplayName: adjustment.staffMemberDisplayName,
      kind: adjustment.kind,
      effectiveDate: adjustment.effectiveDate,
      description: adjustment.description,
      amount: amountForInput(adjustment.amountCents),
    });
    setErrors({});
    setModalError('');
    setNotice('');
  }

  function closeEditor() {
    if (saving) return;
    setDraft(null);
    setErrors({});
    setModalError('');
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  function changeDraft(field: keyof AdjustmentDraft, value: string) {
    if (!draft) return;
    const selected = field === 'staffMemberId'
      ? staff.find((member) => member.id === value)
      : undefined;
    setDraft({
      ...draft,
      [field]: value,
      ...(selected ? { staffMemberDisplayName: selected.displayName } : {}),
    });
    if (field === 'staffMemberId' || field === 'effectiveDate' || field === 'description' || field === 'amount') {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
    setModalError('');
  }

  function changeKind(kind: CompensationAdjustmentKind) {
    if (!draft || draft.id) return;
    setDraft({ ...draft, kind });
  }

  function validateDraft(): DraftErrors {
    if (!draft) return {};
    const next: DraftErrors = {};
    if (!draft.id && !draft.staffMemberId) next.staffMemberId = 'Choose an active staff member.';
    if (!draft.effectiveDate) next.effectiveDate = 'Choose an effective date.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveDate)) {
      next.effectiveDate = 'Choose a valid effective date.';
    }
    if (!draft.description.trim()) {
      next.description = 'Enter a description. Spaces alone are not accepted.';
    } else if (draft.description.trim().length > 120) {
      next.description = 'Description must be 120 characters or fewer.';
    }
    if (amountResult.error) next.amount = amountResult.error;
    return next;
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const nextErrors = validateDraft();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        const first = (['staffMemberId', 'effectiveDate', 'description', 'amount'] as const)
          .find((field) => nextErrors[field]);
        if (first) document.getElementById(`adjustment-${first}`)?.focus();
      });
      return;
    }

    setSaving(true);
    setModalError('');
    setNotice('');
    try {
      const editable = {
        effectiveDate: draft.effectiveDate,
        amountCents: amountResult.cents!,
        description: draft.description.trim(),
      };
      const saved = draft.id
        ? await updateCompensationAdjustment(draft.id, editable)
        : await createCompensationAdjustment({
            staffMemberId: draft.staffMemberId,
            kind: draft.kind,
            ...editable,
          });
      setAdjustments((current) => sortAdjustments([
        ...current.filter((adjustment) => adjustment.id !== saved.id),
        ...(isInScope(saved, staffMemberId, from, to) ? [saved] : []),
      ]));
      setAllAdjustments((current) => sortAdjustments([
        ...(current ?? []).filter((adjustment) => adjustment.id !== saved.id),
        saved,
      ]));
      setDraft(null);
      setNotice(`${adjustmentKindLabel(saved.kind)} “${saved.description}” was ${draft.id ? 'updated' : 'added'} for ${saved.staffMemberDisplayName}.`);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      if (error instanceof CompensationApiError && error.status === 403) {
        setDraft(null);
        setAccessDenied(true);
      } else if (error instanceof CompensationApiError) {
        const serverErrors = serverValidationErrors(error);
        if (Object.keys(serverErrors).length) setErrors(serverErrors);
        else setModalError(errorText(error, 'The adjustment could not be saved. Try again.'));
      } else {
        setModalError('The adjustment could not be saved. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setPageError('');
    try {
      await deleteCompensationAdjustment(deleteTarget.id);
      setAdjustments((current) => current.filter((adjustment) => adjustment.id !== deleteTarget.id));
      setAllAdjustments((current) =>
        (current ?? []).filter((adjustment) => adjustment.id !== deleteTarget.id),
      );
      setNotice(`${adjustmentKindLabel(deleteTarget.kind)} “${deleteTarget.description}” was permanently deleted.`);
      setDeleteTarget(null);
      requestAnimationFrame(() => previousFocusRef.current?.focus());
    } catch (error) {
      setDeleteTarget(null);
      if (error instanceof CompensationApiError && error.status === 403) setAccessDenied(true);
      else setPageError(errorText(error, 'The adjustment could not be deleted. Try again.'));
    } finally {
      setDeleting(false);
    }
  }

  function clearFilters() {
    setStaffMemberId('');
    setFrom('');
    setTo('');
  }

  if (accessDenied) {
    return <Notice tone="danger" title="Access denied"><p>You do not have permission to view staff compensation adjustments.</p></Notice>;
  }

  return (
    <>
      {notice && <Notice tone="success" title="Compensation adjustments updated"><p>{notice}</p></Notice>}
      {pageError && <Notice tone="danger" title="Compensation unavailable"><p>{pageError}</p></Notice>}
      <section className="catalog-panel" aria-labelledby="adjustments-heading">
        <div className="compensation-panel-head">
          <div>
            <h2 id="adjustments-heading">Adjustments</h2>
            <p>Standalone allowances, bonuses, and advances.</p>
          </div>
          <button ref={addButtonRef} className="catalog-button primary" type="button" onClick={openAdd}>
            <Icon name="plus" /> Add adjustment
          </button>
        </div>
        <form className="compensation-filters" aria-label="Filter compensation adjustments" onSubmit={(event) => event.preventDefault()}>
          <label><span>Staff member</span><select value={staffMemberId} onChange={(event) => setStaffMemberId(event.target.value)}><option value="">All staff</option>{staff.map((member) => <option value={member.id} key={member.id}>{member.displayName}{member.isActive ? '' : ' (inactive)'}</option>)}</select></label>
          <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="inventory-clear-filters" type="button" onClick={clearFilters}>Clear filters</button>
        </form>
        <p className="results-meta">
          {loading
            ? 'Loading compensation adjustments…'
            : `Showing ${adjustments.length} ${adjustments.length === 1 ? 'adjustment' : 'adjustments'}${from && to ? ` from ${formatBusinessDate(from, 'short')} to ${formatBusinessDate(to, 'short')}` : ''}`}
        </p>
        <div className="catalog-table-wrap compensation-table-wrap" tabIndex={0} role="region" aria-label="Compensation adjustments table, scroll horizontally to view all columns">
          <table className="catalog-table compensation-table adjustment-table">
            <caption className="sr-only">Compensation adjustments ordered by effective date newest first</caption>
            <thead><tr><th scope="col">Staff member</th><th scope="col">Effective date</th><th scope="col">Kind</th><th scope="col">Description</th><th className="num" scope="col">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {loading ? <LoadingRows columns={6} /> : noAdjustmentsAtAll || noMatches ? (
                <tr><td colSpan={6}><div className="catalog-empty compensation-empty"><Icon name={noAdjustmentsAtAll ? 'document' : 'search'} /><h3>{noAdjustmentsAtAll ? 'No adjustments recorded yet' : 'No adjustments match these filters'}</h3><p>{noAdjustmentsAtAll ? 'Add the first standalone allowance, bonus, or advance for a staff member.' : 'Try another staff member or date range.'}</p>{noAdjustmentsAtAll ? <button className="catalog-button" type="button" onClick={openAdd}>Add adjustment</button> : <button className="catalog-button" type="button" onClick={clearFilters}>Clear filters</button>}</div></td></tr>
              ) : adjustments.map((adjustment) => (
                <tr key={adjustment.id}>
                  <td><strong>{adjustment.staffMemberDisplayName}</strong></td>
                  <td>{formatBusinessDate(adjustment.effectiveDate)}</td>
                  <td><span className={`adjustment-kind ${adjustment.kind.toLowerCase()}`}>{adjustmentKindLabel(adjustment.kind)}</span></td>
                  <td className="adjustment-description">{adjustment.description}</td>
                  <td className={`num adjustment-amount ${adjustment.kind === CompensationAdjustmentKind.ADVANCE ? 'deduction' : 'earning'}`}><strong>{formatMoney(signedAdjustmentAmount(adjustment))}</strong></td>
                  <td className="table-action"><div className="compensation-row-actions"><button className="catalog-button small" type="button" aria-label={`Edit ${adjustment.description} for ${adjustment.staffMemberDisplayName}`} onClick={() => openEdit(adjustment)}>Edit</button><button className="catalog-button small danger" type="button" aria-label={`Delete ${adjustment.description} for ${adjustment.staffMemberDisplayName}`} onClick={() => { rememberFocus(); setDeleteTarget(adjustment); setNotice(''); }}>Delete</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {draft && <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="inventory-modal staff-modal compensation-modal adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') closeEditor(); else trapDialogFocus(event); }}>
        <header className="inventory-modal-head"><div><h2 id="adjustment-dialog-title">{draft.id ? 'Edit adjustment' : 'Add adjustment'}</h2><p>{draft.id ? 'Update this standalone dated item.' : 'Record a standalone dated compensation item.'}</p></div><button className="catalog-button small" type="button" aria-label="Close adjustment editor" disabled={saving} onClick={closeEditor}>Close</button></header>
        <form noValidate onSubmit={saveAdjustment}>
          {Object.keys(errors).length > 0 && <div className="staff-account-error-list" role="alert" aria-labelledby="adjustment-errors-title"><strong id="adjustment-errors-title">Fix the following</strong><ul>{Object.entries(errors).map(([field, message]) => <li key={field}><a href={`#adjustment-${field}`}>{message}</a></li>)}</ul></div>}
          {modalError && <Notice tone="danger" title="Adjustment not saved"><p>{modalError}</p></Notice>}
          {draft.id ? <dl className="compensation-fixed-context"><div><dt>Staff member</dt><dd>{draft.staffMemberDisplayName}</dd></div><div><dt>Kind</dt><dd>{adjustmentKindLabel(draft.kind)}</dd></div></dl> : <div className="inventory-modal-grid">
            <label className="catalog-field"><span className="catalog-field-label">Staff member</span><select ref={firstFieldRef} id="adjustment-staffMemberId" value={draft.staffMemberId} aria-invalid={Boolean(errors.staffMemberId)} aria-describedby={errors.staffMemberId ? 'adjustment-staffMemberId-error' : undefined} onChange={(event) => changeDraft('staffMemberId', event.target.value)}><option value="">Choose active staff</option>{activeStaff.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select>{errors.staffMemberId && <span className="catalog-field-error" id="adjustment-staffMemberId-error">{errors.staffMemberId}</span>}</label>
            <fieldset className="adjustment-kind-field"><legend>Kind</legend><div className="adjustment-kind-control">{Object.values(CompensationAdjustmentKind).map((kind) => <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => changeKind(kind)}>{adjustmentKindLabel(kind)}</button>)}</div></fieldset>
          </div>}
          <div className="inventory-modal-grid">
            <label className="catalog-field"><span className="catalog-field-label">Effective date</span><input ref={editDateRef} id="adjustment-effectiveDate" type="date" value={draft.effectiveDate} aria-invalid={Boolean(errors.effectiveDate)} aria-describedby={errors.effectiveDate ? 'adjustment-effectiveDate-error' : undefined} onChange={(event) => changeDraft('effectiveDate', event.target.value)} />{errors.effectiveDate && <span className="catalog-field-error" id="adjustment-effectiveDate-error">{errors.effectiveDate}</span>}</label>
            <div className="catalog-field"><label className="catalog-field-label" htmlFor="adjustment-amount">Amount</label><span className="adjustment-amount-input"><span aria-hidden="true">₱</span><input id="adjustment-amount" inputMode="decimal" type="text" value={draft.amount} aria-invalid={Boolean(errors.amount)} aria-describedby={`adjustment-amount-help${errors.amount ? ' adjustment-amount-error' : ''}`} onChange={(event) => changeDraft('amount', event.target.value)} /></span><span className="catalog-field-help" id="adjustment-amount-help">Positive pesos, up to two decimal places. Minimum ₱0.01.</span>{errors.amount && <span className="catalog-field-error" id="adjustment-amount-error">{errors.amount}</span>}</div>
          </div>
          <div className="adjustment-presets"><span className="catalog-field-label">Start from</span>{presets.length ? <div>{presets.map((preset) => <button className="adjustment-preset" key={preset} type="button" aria-pressed={draft.description === preset} onClick={() => changeDraft('description', preset)}>{preset}</button>)}</div> : <p>No presets for advances. Type a description.</p>}<span className="catalog-field-help">{presets.length ? 'Choosing a preset fills the editable description field.' : 'Descriptions are required for every adjustment.'}</span></div>
          <div className="catalog-field adjustment-description-field"><label className="catalog-field-label" htmlFor="adjustment-description">Description</label><input id="adjustment-description" type="text" value={draft.description} aria-invalid={Boolean(errors.description)} aria-describedby={`adjustment-description-help adjustment-description-count${errors.description ? ' adjustment-description-error' : ''}`} onChange={(event) => changeDraft('description', event.target.value)} /><span className={`adjustment-character-count ${draft.description.trim().length > 120 ? 'over' : ''}`} id="adjustment-description-count">{draft.description.trim().length} / 120</span><span className="catalog-field-help" id="adjustment-description-help">Required. Surrounding spaces are removed when saved.</span>{errors.description && <span className="catalog-field-error" id="adjustment-description-error">{errors.description}</span>}</div>
          <div className="staff-modal-actions"><button className="catalog-button" type="button" disabled={saving} onClick={closeEditor}>Cancel</button><button className="catalog-button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add adjustment'}</button></div>
        </form>
      </section></div>}

      {deleteTarget && <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}><section className="inventory-modal staff-modal compensation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-adjustment-title" onKeyDown={(event) => { if (event.key === 'Escape') closeDelete(); else trapDialogFocus(event); }}>
        <header className="inventory-modal-head"><div><h2 id="delete-adjustment-title">Delete adjustment?</h2><p>This permanently deletes the item. There is no undo.</p></div><button className="catalog-button small" type="button" aria-label="Close delete confirmation" disabled={deleting} onClick={closeDelete}>Close</button></header>
        <div className="compensation-delete-body"><dl className="adjustment-delete-details"><div><dt>Staff member</dt><dd>{deleteTarget.staffMemberDisplayName}</dd></div><div><dt>Effective date</dt><dd>{formatBusinessDate(deleteTarget.effectiveDate)}</dd></div><div><dt>Kind</dt><dd>{adjustmentKindLabel(deleteTarget.kind)}</dd></div><div><dt>Description</dt><dd>{deleteTarget.description}</dd></div><div><dt>Amount</dt><dd>{formatMoney(signedAdjustmentAmount(deleteTarget))}</dd></div></dl><div className="staff-modal-actions"><button ref={deleteCancelRef} className="catalog-button" type="button" disabled={deleting} onClick={closeDelete}>Cancel</button><button className="catalog-button danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete permanently'}</button></div></div>
      </section></div>}
    </>
  );
}
