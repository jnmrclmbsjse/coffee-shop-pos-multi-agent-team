import {
  StaffCustomFieldType,
  type StaffCustomFieldDefinition,
} from '@coffee-shop/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createStaffCustomField,
  listStaffCustomFields,
  reorderStaffCustomFields,
  updateStaffCustomField,
} from './api';

type FieldDraft = {
  label: string;
  fieldType: StaffCustomFieldType;
  choices: string;
};

const emptyDraft = (): FieldDraft => ({
  label: '',
  fieldType: StaffCustomFieldType.TEXT,
  choices: '',
});

export function CustomFieldsDialog({ onClose }: { onClose: () => void }) {
  const [fields, setFields] = useState<StaffCustomFieldDefinition[]>([]);
  const [draft, setDraft] = useState<FieldDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listStaffCustomFields(true)
      .then(setFields)
      .catch(() => setError('Employment fields could not be loaded.'));
    requestAnimationFrame(() => labelRef.current?.focus());
  }, []);

  function edit(field: StaffCustomFieldDefinition) {
    setEditingId(field.id);
    setDraft({
      label: field.label,
      fieldType: field.fieldType,
      choices: field.choices.join('\n'),
    });
    setError('');
    requestAnimationFrame(() => labelRef.current?.focus());
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const input = {
      label: draft.label,
      fieldType: draft.fieldType,
      choices:
        draft.fieldType === StaffCustomFieldType.CHOICE
          ? draft.choices.split('\n')
          : undefined,
    };
    try {
      const saved = editingId
        ? await updateStaffCustomField(editingId, input)
        : await createStaffCustomField(input);
      setFields((current) =>
        editingId
          ? current.map((field) => (field.id === saved.id ? saved : field))
          : [...current, saved],
      );
      resetForm();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Field could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function move(index: number, delta: number) {
    const next = [...fields];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setFields(next);
    try {
      await reorderStaffCustomFields(next.map((field) => field.id));
    } catch {
      setFields(fields);
      setError('The field order could not be saved.');
    }
  }

  async function toggleArchive(field: StaffCustomFieldDefinition) {
    try {
      const saved = await updateStaffCustomField(field.id, {
        isArchived: !field.isArchived,
      });
      setFields((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch {
      setError('The field could not be updated.');
    }
  }

  const editing = fields.find((field) => field.id === editingId);
  return (
    <div className="inventory-modal-backdrop">
      <section
        className="inventory-modal staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fields-title"
      >
        <header className="inventory-modal-head">
          <div>
            <h2 id="fields-title">Employment fields</h2>
            <p>Define extra fields shown for every staff member.</p>
          </div>
          <button className="catalog-button small" onClick={onClose}>
            Close
          </button>
        </header>

        {error && (
          <p
            id="custom-field-error"
            className="catalog-field-error"
            role="alert"
          >
            {error}
          </p>
        )}

        <ul className="employment-field-list">
          {fields.map((field, index) => (
            <li key={field.id}>
              <span>
                <strong>{field.label}</strong> · {field.fieldType.toLowerCase()}
                {field.isArchived ? ' · Archived' : ''}
              </span>
              <span className="employment-field-actions">
                <button
                  className="catalog-button small"
                  onClick={() => void move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${field.label} up`}
                >
                  Up
                </button>
                <button
                  className="catalog-button small"
                  onClick={() => void move(index, 1)}
                  disabled={index === fields.length - 1}
                  aria-label={`Move ${field.label} down`}
                >
                  Down
                </button>
                <button
                  className="catalog-button small"
                  onClick={() => edit(field)}
                >
                  Edit
                </button>
                <button
                  className="catalog-button small"
                  onClick={() => void toggleArchive(field)}
                >
                  {field.isArchived ? 'Restore' : 'Archive'}
                </button>
              </span>
            </li>
          ))}
        </ul>

        <form
          onSubmit={submit}
          aria-describedby={error ? 'custom-field-error' : undefined}
        >
          <h3>{editingId ? 'Edit field' : 'Add field'}</h3>
          <div className="inventory-modal-grid">
            <label className="catalog-field">
              <span>Label</span>
              <input
                ref={labelRef}
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                required
                maxLength={60}
              />
            </label>
            <label className="catalog-field">
              <span>Type</span>
              <select
                value={draft.fieldType}
                disabled={Boolean(editing?.hasValues)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    fieldType: event.target.value as StaffCustomFieldType,
                  }))
                }
              >
                {Object.values(StaffCustomFieldType).map((value) => (
                  <option key={value} value={value}>
                    {value.toLowerCase()}
                  </option>
                ))}
              </select>
              {editing?.hasValues && (
                <small>Type is locked after values are saved.</small>
              )}
            </label>
            {draft.fieldType === StaffCustomFieldType.CHOICE && (
              <label className="catalog-field">
                <span>Options, one per line</span>
                <textarea
                  value={draft.choices}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      choices: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            )}
          </div>
          <div className="staff-modal-actions">
            {editingId && (
              <button
                className="catalog-button"
                type="button"
                onClick={resetForm}
              >
                Cancel edit
              </button>
            )}
            <button className="catalog-button primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save field' : 'Add field'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
