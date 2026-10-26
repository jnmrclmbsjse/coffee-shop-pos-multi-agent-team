import {
  EmploymentType,
  SeparationReason,
  StaffCustomFieldType,
  type StaffEmploymentDetails,
  type StaffGovernmentIds,
  type StaffMember,
  type StaffCommissionRate,
} from '@coffee-shop/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { shopDate, formatBusinessDate } from '../reporting/format';
import { currencyToCents, formatCommissionRate } from '../compensation/money';
import {
  deleteStaffCommissionRate,
  listStaffCommissionRates,
  saveStaffCommissionRate,
} from '../compensation/api';
import { EMPLOYMENT_TYPE_LABELS } from './employmentLabels';
import {
  getStaffEmployment,
  revealStaffGovernmentIds,
  saveStaffCustomFieldValues,
  StaffApiError,
  updateStaffEmployment,
} from './api';

const EMPTY_IDS: StaffGovernmentIds = {
  sssNumber: null,
  philhealthNumber: null,
  pagibigNumber: null,
  tinNumber: null,
};
export function EmploymentDetailsDialog({
  member,
  onClose,
  onSaved,
}: {
  member: StaffMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [details, setDetails] = useState<StaffEmploymentDetails | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ids, setIds] = useState<StaffGovernmentIds>(EMPTY_IDS);
  const [revealed, setRevealed] = useState(false);
  const [changing, setChanging] = useState<Set<keyof StaffGovernmentIds>>(
    new Set(),
  );
  const [rates, setRates] = useState<StaffCommissionRate[]>([]);
  const [rateDate, setRateDate] = useState(shopDate());
  const [rateAmount, setRateAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLSelectElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    void Promise.all([
      getStaffEmployment(member.id),
      listStaffCommissionRates(member.id),
    ])
      .then(([value, rateRows]) => {
        setDetails(value);
        setRates(rateRows);
        const next: Record<string, string> = {};
        for (const [key, item] of Object.entries(value))
          if (typeof item === 'string' || item === null) next[key] = item ?? '';
        for (const field of value.customFields)
          next[`custom:${field.id}`] = field.value ?? '';
        setDraft(next);
        requestAnimationFrame(() => firstRef.current?.focus());
      })
      .catch(() => setError('Employment details could not be loaded.'));
  }, [member.id]);
  async function reveal() {
    try {
      const value = await revealStaffGovernmentIds(member.id);
      setIds(value);
      setRevealed(true);
    } catch {
      setError('Government IDs could not be revealed.');
    }
  }
  function change(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!details) return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const input: Record<string, unknown> = {};
      for (const key of [
        'startDate',
        'trainingEndDate',
        'probationEndDate',
        'thirdMonthReviewDate',
        'regularizationDate',
        'endDate',
        'birthDate',
        'contactNumber',
        'emergencyContactName',
        'emergencyContactNumber',
        'separationReason',
      ] as const)
        input[key] = draft[key] || null;
      input.employmentType = draft.employmentType || null;
      if (draft.employmentType !== (details.employmentType ?? ''))
        input.employmentTypeEffectiveDate =
          draft.employmentTypeEffectiveDate || shopDate();
      for (const key of changing) input[key] = ids[key];
      await updateStaffEmployment(member.id, input);
      await saveStaffCustomFieldValues(
        member.id,
        details.customFields.map((field) => ({
          definitionId: field.id,
          value: draft[`custom:${field.id}`] ?? '',
        })),
      );
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof StaffApiError && caught.field) {
        const key = details.customFields.some(
          (field) => field.id === caught.field,
        )
          ? `custom:${caught.field}`
          : caught.field;
        setFieldErrors({ [key]: caught.message });
      } else
        setError(
          caught instanceof Error
            ? caught.message
            : 'Employment details could not be saved.',
        );
    } finally {
      setSaving(false);
    }
  }
  async function addRate(event: FormEvent) {
    event.preventDefault();
    const parsed = currencyToCents(rateAmount, 'Rate');
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    try {
      const saved = await saveStaffCommissionRate(member.id, {
        effectiveFrom: rateDate,
        ratePerBandCents: parsed.cents!,
      });
      setRates((current) =>
        [
          ...current.filter(
            (rate) => rate.effectiveFrom !== saved.effectiveFrom,
          ),
          saved,
        ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
      );
      setRateAmount('');
    } catch {
      setError('The commission rate could not be saved.');
    }
  }
  async function removeRate(rate: StaffCommissionRate) {
    if (
      !window.confirm(
        `Remove the ${formatCommissionRate(rate.ratePerBandCents)} per ₱1,000 rate from ${formatBusinessDate(rate.effectiveFrom)}? Saved daily records do not change.`,
      )
    )
      return;
    try {
      await deleteStaffCommissionRate(rate.id);
      setRates((current) => current.filter((item) => item.id !== rate.id));
    } catch {
      setError('The commission rate could not be removed.');
    }
  }
  if (!details)
    return (
      <div className="inventory-modal-backdrop">
        <section
          className="inventory-modal staff-modal"
          role="dialog"
          aria-modal="true"
        >
          <p>{error || 'Loading employment details…'}</p>
          <button className="catalog-button" onClick={onClose}>
            Close
          </button>
        </section>
      </div>
    );
  const currentRate = [...rates]
    .filter((rate) => rate.effectiveFrom <= shopDate())
    .at(-1);
  const field = (key: string, label: string, type = 'date') => (
    <label className="catalog-field">
      <span>{label}</span>
      <input
        type={type}
        value={draft[key] ?? ''}
        aria-invalid={Boolean(fieldErrors[key])}
        aria-describedby={
          fieldErrors[key] ? `employment-${key}-error` : undefined
        }
        onChange={(event) => change(key, event.target.value)}
      />
      {fieldErrors[key] && (
        <span className="catalog-field-error" id={`employment-${key}-error`}>
          {fieldErrors[key]}
        </span>
      )}
    </label>
  );
  return (
    <div
      className="inventory-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="inventory-modal staff-modal employment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employment-title"
      >
        <header className="inventory-modal-head">
          <div>
            <h2 id="employment-title">Employment · {member.displayName}</h2>
            <p>
              Employment, personal details, IDs, custom fields and personal
              commission.
            </p>
          </div>
          <button
            className="catalog-button small"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </header>
        {error && (
          <p className="catalog-field-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={save}>
          <h3>Employment</h3>
          <div className="inventory-modal-grid">
            <label className="catalog-field">
              <span>Employment type</span>
              <select
                ref={firstRef}
                value={draft.employmentType ?? ''}
                aria-invalid={Boolean(fieldErrors.employmentType)}
                aria-describedby={
                  fieldErrors.employmentType
                    ? 'employment-employmentType-error'
                    : undefined
                }
                onChange={(event) =>
                  change('employmentType', event.target.value)
                }
              >
                <option value="">Not set</option>
                {Object.values(EmploymentType).map((type) => (
                  <option key={type} value={type}>
                    {EMPLOYMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {fieldErrors.employmentType && (
                <span
                  className="catalog-field-error"
                  id="employment-employmentType-error"
                >
                  {fieldErrors.employmentType}
                </span>
              )}
            </label>
            {draft.employmentType !== (details.employmentType ?? '') &&
              field('employmentTypeEffectiveDate', 'Type change date')}
            {field('startDate', 'Start date')}
            {field('trainingEndDate', 'End of training')}
            {field('probationEndDate', 'End of probation')}
            {field('thirdMonthReviewDate', '3rd month review')}
            {field('regularizationDate', 'Regularization')}
            {field('endDate', 'End date')}
            <label className="catalog-field">
              <span>Separation reason</span>
              <select
                value={draft.separationReason ?? ''}
                aria-invalid={Boolean(fieldErrors.separationReason)}
                aria-describedby={
                  fieldErrors.separationReason
                    ? 'employment-separationReason-error'
                    : undefined
                }
                onChange={(event) =>
                  change('separationReason', event.target.value)
                }
              >
                <option value="">Not set</option>
                <option value={SeparationReason.RESIGNED}>Resigned</option>
                <option value={SeparationReason.TERMINATED}>Terminated</option>
              </select>
              {fieldErrors.separationReason && (
                <span
                  className="catalog-field-error"
                  id="employment-separationReason-error"
                >
                  {fieldErrors.separationReason}
                </span>
              )}
            </label>
          </div>
          <h3>Personal</h3>
          <div className="inventory-modal-grid">
            {field('birthDate', 'Birthday')}
            {field('contactNumber', 'Contact number', 'text')}
            {field('emergencyContactName', 'Emergency contact name', 'text')}
            {field(
              'emergencyContactNumber',
              'Emergency contact number',
              'text',
            )}
          </div>
          <h3>Government IDs</h3>
          {(Object.keys(EMPTY_IDS) as Array<keyof StaffGovernmentIds>).map(
            (key) => (
              <label className="catalog-field" key={key}>
                <span>
                  {
                    (
                      {
                        sssNumber: 'SSS number',
                        philhealthNumber: 'PhilHealth number',
                        pagibigNumber: 'Pag-IBIG number',
                        tinNumber: 'TIN',
                      } as const
                    )[key]
                  }
                </span>
                {details.governmentIds[key].isSet &&
                !revealed &&
                !changing.has(key) ? (
                  <span>
                    <input
                      readOnly
                      value={`•••• ${details.governmentIds[key].last4}`}
                    />
                    <button
                      type="button"
                      className="catalog-button small"
                      onClick={reveal}
                    >
                      Show
                    </button>
                    <button
                      type="button"
                      className="catalog-button small"
                      onClick={() =>
                        setChanging((current) => new Set(current).add(key))
                      }
                    >
                      Change
                    </button>
                  </span>
                ) : (
                  <input
                    value={ids[key] ?? ''}
                    aria-invalid={Boolean(fieldErrors[key])}
                    aria-describedby={
                      fieldErrors[key] ? `employment-${key}-error` : undefined
                    }
                    onChange={(event) => {
                      setIds((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }));
                      setChanging((current) => new Set(current).add(key));
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next[key];
                        return next;
                      });
                    }}
                  />
                )}
                {fieldErrors[key] && (
                  <span
                    className="catalog-field-error"
                    id={`employment-${key}-error`}
                  >
                    {fieldErrors[key]}
                  </span>
                )}
              </label>
            ),
          )}
          <h3>Custom fields</h3>
          <div className="inventory-modal-grid">
            {details.customFields.map((item) => {
              const key = `custom:${item.id}`;
              return (
                <label className="catalog-field" key={item.id}>
                  <span>{item.label}</span>
                  {item.fieldType === StaffCustomFieldType.CHOICE ? (
                    <select
                      value={draft[key] ?? ''}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key]
                          ? `employment-${item.id}-error`
                          : undefined
                      }
                      onChange={(event) => change(key, event.target.value)}
                    >
                      <option value="">Not set</option>
                      {item.value && !item.choices.includes(item.value) && (
                        <option value={item.value}>
                          {item.value} (removed option)
                        </option>
                      )}
                      {item.choices.map((choice) => (
                        <option key={choice}>{choice}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        item.fieldType === StaffCustomFieldType.DATE
                          ? 'date'
                          : 'text'
                      }
                      inputMode={
                        item.fieldType === StaffCustomFieldType.NUMBER
                          ? 'decimal'
                          : undefined
                      }
                      value={draft[key] ?? ''}
                      aria-invalid={Boolean(fieldErrors[key])}
                      aria-describedby={
                        fieldErrors[key]
                          ? `employment-${item.id}-error`
                          : undefined
                      }
                      onChange={(event) => change(key, event.target.value)}
                    />
                  )}
                  {fieldErrors[key] && (
                    <span
                      className="catalog-field-error"
                      id={`employment-${item.id}-error`}
                    >
                      {fieldErrors[key]}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <h3>Type history</h3>
          {details.typeHistory.length ? (
            <ul>
              {details.typeHistory.map((change) => (
                <li key={change.id}>
                  {formatBusinessDate(change.effectiveDate)} ·{' '}
                  {EMPLOYMENT_TYPE_LABELS[change.employmentType]} · by{' '}
                  {change.changedBy.displayName || change.changedBy.username}
                </li>
              ))}
            </ul>
          ) : (
            <p>No type changes recorded.</p>
          )}
          <div className="staff-modal-actions">
            <button className="catalog-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="catalog-button primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save employment details'}
            </button>
          </div>
        </form>
        <section>
          <h3>Personal commission</h3>
          <p>
            Current rate:{' '}
            {currentRate
              ? `${formatCommissionRate(currentRate.ratePerBandCents)} per ₱1,000`
              : 'No personal rate'}
          </p>
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Start date</th>
                <th>Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id}>
                  <td>{formatBusinessDate(rate.effectiveFrom)}</td>
                  <td>
                    {formatCommissionRate(rate.ratePerBandCents)} per ₱1,000
                  </td>
                  <td>
                    <button
                      type="button"
                      className="catalog-button small danger"
                      onClick={() => void removeRate(rate)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="inventory-modal-grid" onSubmit={addRate}>
            <label className="catalog-field">
              <span>Start date</span>
              <input
                type="date"
                value={rateDate}
                onChange={(event) => setRateDate(event.target.value)}
              />
            </label>
            <label className="catalog-field">
              <span>Rate (PHP per ₱1,000)</span>
              <input
                inputMode="decimal"
                value={rateAmount}
                onChange={(event) => setRateAmount(event.target.value)}
              />
            </label>
            <button className="catalog-button" type="submit">
              Add rate
            </button>
          </form>
        </section>
      </section>
    </div>
  );
}
