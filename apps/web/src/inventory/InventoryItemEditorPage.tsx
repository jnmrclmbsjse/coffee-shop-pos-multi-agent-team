import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { CountMethod, DayType, type InventoryItem } from '@coffee-shop/shared';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, Notice, Switch } from '../catalog/components';
import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItem,
  InventoryApiError,
  listStockCategories,
  saveParLevel,
  updateInventoryItem,
  type InventoryItemInput,
  type ParLevelInput,
} from './api';

interface ParDraft {
  parQty: string;
  lowThreshold: string;
  urgentThreshold: string;
}

interface ItemDraft {
  categoryId: string;
  name: string;
  unit: string;
  size: string;
  countMethod: CountMethod;
  critical: boolean;
  reconciled: boolean;
  active: boolean;
  normal: ParDraft;
  peak: ParDraft;
}

interface FormErrors {
  summary?: string;
  categoryId?: string;
  name?: string;
  unit?: string;
  normal?: Partial<Record<keyof ParDraft, string>>;
  peak?: Partial<Record<keyof ParDraft, string>>;
}

const EMPTY_PAR: ParDraft = {
  parQty: '0',
  lowThreshold: '',
  urgentThreshold: '',
};

const EMPTY_ITEM: ItemDraft = {
  categoryId: '',
  name: '',
  unit: 'pcs',
  size: '',
  countMethod: CountMethod.QUANTITY,
  critical: false,
  reconciled: false,
  active: true,
  normal: { ...EMPTY_PAR },
  peak: { ...EMPTY_PAR },
};

function parFromItem(item: InventoryItem, dayType: DayType): ParDraft {
  const par = item.parLevels.find((level) => level.dayType === dayType);
  return par
    ? {
        parQty: String(par.parQty),
        lowThreshold: par.lowThreshold === null ? '' : String(par.lowThreshold),
        urgentThreshold:
          par.urgentThreshold === null ? '' : String(par.urgentThreshold),
      }
    : { ...EMPTY_PAR };
}

function draftFromItem(item: InventoryItem): ItemDraft {
  return {
    categoryId: item.categoryId,
    name: item.name,
    unit: item.unit,
    size: item.size ?? '',
    countMethod: item.countMethod,
    critical: item.critical,
    reconciled: item.reconciled,
    active: item.active,
    normal: parFromItem(item, DayType.NORMAL),
    peak: parFromItem(item, DayType.PEAK),
  };
}

function parseWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

export function validateParDraft(
  draft: ParDraft,
  label: string,
): { input?: ParLevelInput; errors: Partial<Record<keyof ParDraft, string>> } {
  const errors: Partial<Record<keyof ParDraft, string>> = {};
  const parQty = parseWholeNumber(draft.parQty);
  const lowThreshold =
    draft.lowThreshold.trim() === ''
      ? null
      : parseWholeNumber(draft.lowThreshold);
  const urgentThreshold =
    draft.urgentThreshold.trim() === ''
      ? null
      : parseWholeNumber(draft.urgentThreshold);

  if (parQty === null) {
    errors.parQty = `${label} par must be a non-negative whole number.`;
  }
  if (draft.lowThreshold.trim() !== '' && lowThreshold === null) {
    errors.lowThreshold = `${label} Low must be a non-negative whole number.`;
  }
  if (draft.urgentThreshold.trim() !== '' && urgentThreshold === null) {
    errors.urgentThreshold = `${label} Urgent must be a non-negative whole number.`;
  }
  if (urgentThreshold !== null && draft.lowThreshold.trim() === '') {
    errors.urgentThreshold = `Enter ${label} Low before adding Urgent.`;
  }
  if (
    parQty !== null &&
    lowThreshold !== null &&
    lowThreshold > parQty
  ) {
    errors.lowThreshold = `${label} Low must be less than or equal to Par.`;
  }
  if (
    lowThreshold !== null &&
    urgentThreshold !== null &&
    urgentThreshold > lowThreshold
  ) {
    errors.urgentThreshold = `${label} Urgent must be less than or equal to Low.`;
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : {
        input: {
          parQty: parQty!,
          lowThreshold,
          urgentThreshold,
        },
        errors,
      };
}

export function InventoryItemEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [categories, setCategories] = useState<
    Awaited<ReturnType<typeof listStockCategories>>
  >([]);
  const [original, setOriginal] = useState<InventoryItem | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pageError, setPageError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const validationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listStockCategories(),
      id ? getInventoryItem(id) : Promise.resolve(null),
    ])
      .then(([categoryResult, item]) => {
        if (!active) return;
        setCategories(categoryResult);
        if (item) {
          setOriginal(item);
          setDraft(draftFromItem(item));
          document.title = `Edit ${item.name} · UCM Coffee Studio`;
        } else {
          setDraft(EMPTY_ITEM);
          document.title = 'Add stock item · UCM Coffee Studio';
        }
      })
      .catch(() => {
        if (active) {
          setPageError(
            'The stock item editor could not be loaded. Return to Inventory and try again.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  function setField<K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, summary: undefined }));
    setPageError('');
    setDeleteError('');
  }

  function setParField(
    day: 'normal' | 'peak',
    field: keyof ParDraft,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      [day]: { ...current[day], [field]: value },
    }));
    setErrors((current) => ({
      ...current,
      [day]: { ...current[day], [field]: undefined },
      summary: undefined,
    }));
  }

  function validate(): {
    item: InventoryItemInput;
    normal: ParLevelInput;
    peak: ParLevelInput;
  } | null {
    const nextErrors: FormErrors = {};
    const name = draft.name.trim();
    const unit = draft.unit.trim();
    if (!draft.categoryId) nextErrors.categoryId = 'Choose a stock category.';
    if (!name) nextErrors.name = 'Enter a stock item name.';
    if (!unit) nextErrors.unit = 'Enter the unit used when counting this item.';
    if (draft.reconciled && draft.countMethod !== CountMethod.QUANTITY) {
      nextErrors.summary =
        'Reconciled items must use Quantity as their count method.';
    }

    const normal = validateParDraft(draft.normal, 'Normal day');
    const peak = validateParDraft(draft.peak, 'Peak day');
    if (Object.keys(normal.errors).length > 0) nextErrors.normal = normal.errors;
    if (Object.keys(peak.errors).length > 0) nextErrors.peak = peak.errors;

    if (
      nextErrors.categoryId ||
      nextErrors.name ||
      nextErrors.unit ||
      nextErrors.summary ||
      nextErrors.normal ||
      nextErrors.peak
    ) {
      nextErrors.summary ??=
        'Review the highlighted item and par-level fields before saving.';
      setErrors(nextErrors);
      requestAnimationFrame(() => validationRef.current?.focus());
      return null;
    }

    setErrors({});
    return {
      item: {
        categoryId: draft.categoryId,
        name,
        unit,
        size: draft.size.trim() || null,
        countMethod: draft.countMethod,
        critical: draft.critical,
        reconciled: draft.reconciled,
        active: draft.active,
      },
      normal: normal.input!,
      peak: peak.input!,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = validate();
    if (!input) return;

    setSaving(true);
    setPageError('');
    setDeleteError('');
    try {
      const saved =
        id && original
          ? await updateInventoryItem(id, input.item)
          : await createInventoryItem(input.item);
      await Promise.all([
        saveParLevel(saved.id, DayType.NORMAL, input.normal),
        saveParLevel(saved.id, DayType.PEAK, input.peak),
      ]);
      navigate('/inventory', { replace: true });
    } catch (error) {
      const message =
        error instanceof InventoryApiError
          ? error.messages.join(' ')
          : 'The stock item could not be saved. Try again.';
      setPageError(message);
      requestAnimationFrame(() => validationRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  async function removeItem() {
    if (!id || deleting) return;
    setDeleting(true);
    setDeleteError('');
    setPageError('');
    try {
      await deleteInventoryItem(id);
      navigate('/inventory', { replace: true });
    } catch (error) {
      setDeleteError(
        error instanceof InventoryApiError
          ? error.messages.join(' ')
          : 'The stock item could not be deleted. Try again.',
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="catalog-page">
        <div className="editor-loading" role="status">
          <span className="catalog-spinner" aria-hidden="true" />
          Loading stock item editor…
        </div>
      </main>
    );
  }

  return (
    <main className="catalog-page inventory-editor-page">
      <div className="catalog-page-head">
        <div>
          <div className="breadcrumbs">
            <Link to="/inventory">Inventory</Link>
            <Icon name="chevron" />
            <span>{isEditing ? 'Edit stock item' : 'Add stock item'}</span>
          </div>
          <h1>
            {isEditing
              ? `Edit ${original?.name ?? 'stock item'}`
              : 'Add stock item'}
          </h1>
          <p>Define how the item is counted and when it needs attention.</p>
        </div>
        <div className="catalog-head-actions">
          <Link className="catalog-button" to="/inventory">Cancel</Link>
          <button
            className="catalog-button primary"
            type="submit"
            form="inventory-item-form"
            disabled={saving || Boolean(pageError && !original && isEditing)}
          >
            {saving ? 'Saving…' : 'Save stock item'}
          </button>
        </div>
      </div>

      {pageError && (
        <div ref={validationRef} tabIndex={-1}>
          <Notice tone="danger" title={pageError} />
        </div>
      )}
      {errors.summary && (
        <div ref={validationRef} tabIndex={-1}>
          <Notice tone="danger" title={errors.summary} />
        </div>
      )}

      <form
        className="catalog-panel inventory-item-form"
        id="inventory-item-form"
        noValidate
        onSubmit={submit}
      >
        <section className="form-section" aria-labelledby="item-details-heading">
          <div className="section-heading">
            <h2 id="item-details-heading">Item details</h2>
            <p>Category, name, and unit are required.</p>
          </div>
          <div className="inventory-detail-grid">
            <div className="catalog-field">
              <label htmlFor="inventory-item-category">
                Category <span aria-hidden="true">*</span>
              </label>
              <select
                id="inventory-item-category"
                value={draft.categoryId}
                aria-invalid={Boolean(errors.categoryId)}
                onChange={(event) => setField('categoryId', event.target.value)}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.active ? '' : ' (Inactive)'}
                  </option>
                ))}
              </select>
              {errors.categoryId && <p className="catalog-field-error">{errors.categoryId}</p>}
            </div>
            <div className="catalog-field inventory-name-field">
              <label htmlFor="inventory-item-name">
                Item name <span aria-hidden="true">*</span>
              </label>
              <input
                id="inventory-item-name"
                value={draft.name}
                aria-invalid={Boolean(errors.name)}
                onChange={(event) => setField('name', event.target.value)}
              />
              {errors.name && <p className="catalog-field-error">{errors.name}</p>}
            </div>
            <div className="catalog-field">
              <label htmlFor="inventory-item-unit">
                Unit <span aria-hidden="true">*</span>
              </label>
              <input
                id="inventory-item-unit"
                value={draft.unit}
                aria-invalid={Boolean(errors.unit)}
                onChange={(event) => setField('unit', event.target.value)}
              />
              {errors.unit ? (
                <p className="catalog-field-error">{errors.unit}</p>
              ) : (
                <p className="catalog-field-help">Examples: pcs, ml, bottle, carton</p>
              )}
            </div>
            <div className="catalog-field">
              <label htmlFor="inventory-item-size">Size</label>
              <input
                id="inventory-item-size"
                placeholder="For example, 16oz"
                value={draft.size}
                onChange={(event) => setField('size', event.target.value)}
              />
            </div>
            <fieldset className="inventory-count-method">
              <legend>Count method</legend>
              <label>
                <input
                  type="radio"
                  name="count-method"
                  checked={draft.countMethod === CountMethod.QUANTITY}
                  onChange={() => setField('countMethod', CountMethod.QUANTITY)}
                />
                <span><strong>Quantity</strong><small>Count exact whole units.</small></span>
              </label>
              <label className={draft.reconciled ? 'is-disabled' : ''}>
                <input
                  type="radio"
                  name="count-method"
                  checked={draft.countMethod === CountMethod.LEVEL}
                  disabled={draft.reconciled}
                  onChange={() => setField('countMethod', CountMethod.LEVEL)}
                />
                <span><strong>Level</strong><small>Record an estimated stock level.</small></span>
              </label>
              {draft.reconciled && (
                <p>Reconciled items always use Quantity.</p>
              )}
            </fieldset>
          </div>
        </section>

        <section className="form-section" aria-labelledby="item-settings-heading">
          <div className="section-heading">
            <h2 id="item-settings-heading">Item settings</h2>
            <p>These states are saved independently.</p>
          </div>
          <div className="inventory-settings">
            <Setting
              title="Reconciled"
              description="Use for cup and lid reconciliation."
              checked={draft.reconciled}
              onChange={(checked) => {
                setDraft((current) => ({
                  ...current,
                  reconciled: checked,
                  countMethod: checked
                    ? CountMethod.QUANTITY
                    : current.countMethod,
                }));
                setErrors((current) => ({ ...current, summary: undefined }));
              }}
            />
            <Setting
              title="Critical"
              description="Include in critical-item filters."
              checked={draft.critical}
              onChange={(checked) => setField('critical', checked)}
            />
            <Setting
              title="Active"
              description="Available for current inventory setup."
              checked={draft.active}
              onChange={(checked) => setField('active', checked)}
            />
          </div>
        </section>

        <section className="form-section" aria-labelledby="par-levels-heading">
          <div className="section-heading">
            <h2 id="par-levels-heading">Par levels</h2>
            <p>Set independent targets for normal and peak days. Zero is valid.</p>
          </div>
          <div className="par-level-grid">
            <ParFields
              idPrefix="normal"
              title="Normal day"
              draft={draft.normal}
              errors={errors.normal}
              onChange={(field, value) => setParField('normal', field, value)}
            />
            <ParFields
              idPrefix="peak"
              title="Peak day"
              draft={draft.peak}
              errors={errors.peak}
              onChange={(field, value) => setParField('peak', field, value)}
            />
          </div>
        </section>

        {isEditing && (
          <section className="form-section inventory-danger-zone" aria-labelledby="delete-item-heading">
            <div>
              <h2 id="delete-item-heading">Delete stock item</h2>
              <p>Referenced Cup or Lid items cannot be deleted.</p>
            </div>
            <button
              className="catalog-button danger"
              type="button"
              disabled={deleting}
              onClick={() => void removeItem()}
            >
              <Icon name="trash" />
              {deleting ? 'Deleting…' : 'Delete stock item'}
            </button>
            {deleteError && (
              <div className="inventory-delete-error">
                <Notice tone="danger" title={deleteError} />
              </div>
            )}
          </section>
        )}
      </form>
    </main>
  );
}

function Setting({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="state-setting">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="state-setting-control">
        <span>{checked ? 'On' : 'Off'}</span>
        <Switch checked={checked} label={title} onChange={onChange} />
      </div>
    </div>
  );
}

function ParFields({
  idPrefix,
  title,
  draft,
  errors = {},
  onChange,
}: {
  idPrefix: string;
  title: string;
  draft: ParDraft;
  errors?: Partial<Record<keyof ParDraft, string>>;
  onChange: (field: keyof ParDraft, value: string) => void;
}) {
  return (
    <fieldset className="par-level-group">
      <legend>{title}</legend>
      <div className="catalog-field">
        <label htmlFor={`${idPrefix}-par`}>Par quantity <span aria-hidden="true">*</span></label>
        <input
          id={`${idPrefix}-par`}
          inputMode="numeric"
          value={draft.parQty}
          aria-invalid={Boolean(errors.parQty)}
          onChange={(event) => onChange('parQty', event.target.value)}
        />
        {errors.parQty && <p className="catalog-field-error">{errors.parQty}</p>}
      </div>
      <div className="catalog-field">
        <label htmlFor={`${idPrefix}-low`}>Low threshold</label>
        <input
          id={`${idPrefix}-low`}
          inputMode="numeric"
          placeholder="Optional"
          value={draft.lowThreshold}
          aria-invalid={Boolean(errors.lowThreshold)}
          onChange={(event) => onChange('lowThreshold', event.target.value)}
        />
        {errors.lowThreshold && <p className="catalog-field-error">{errors.lowThreshold}</p>}
      </div>
      <div className="catalog-field">
        <label htmlFor={`${idPrefix}-urgent`}>Urgent threshold</label>
        <input
          id={`${idPrefix}-urgent`}
          inputMode="numeric"
          placeholder="Optional"
          value={draft.urgentThreshold}
          aria-invalid={Boolean(errors.urgentThreshold)}
          onChange={(event) => onChange('urgentThreshold', event.target.value)}
        />
        {errors.urgentThreshold && <p className="catalog-field-error">{errors.urgentThreshold}</p>}
      </div>
    </fieldset>
  );
}
