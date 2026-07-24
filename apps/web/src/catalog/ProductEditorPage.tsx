import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  CatalogCategorySummary,
  InventoryItemOption,
  Product,
} from '@coffee-shop/shared';
import {
  CatalogApiError,
  createProduct,
  getProduct,
  listCategories,
  listInventoryItems,
  removeSize,
  reorderSizes,
  updateProduct,
  type ProductInput,
} from './api';
import { Icon, Notice, StateBadge, Switch } from './components';
import { formatCentsAsPesosInput, parsePesosToCents } from './money';

interface SizeDraft {
  key: string;
  id?: string;
  name: string;
  pricePesos: string;
  active: boolean;
  cupInventoryItemId: string;
  lidInventoryItemId: string;
}

interface ProductDraft {
  categoryId: string;
  name: string;
  active: boolean;
  available: boolean;
  sizes: SizeDraft[];
}

interface SizeErrors {
  name?: string;
  price?: string;
  mapping?: string;
  remove?: string;
}

interface FormErrors {
  categoryId?: string;
  name?: string;
  summary?: string;
  sizes: Record<string, SizeErrors>;
}

function emptySize(): SizeDraft {
  return {
    key: crypto.randomUUID(),
    name: '',
    pricePesos: '0.00',
    active: true,
    cupInventoryItemId: '',
    lidInventoryItemId: '',
  };
}

const emptyDraft = (): ProductDraft => ({
  categoryId: '',
  name: '',
  active: true,
  available: true,
  sizes: [emptySize()],
});

function draftFromProduct(product: Product): ProductDraft {
  return {
    categoryId: product.categoryId,
    name: product.name,
    active: product.active,
    available: product.available,
    sizes: product.variants.map((size) => ({
      key: size.id,
      id: size.id,
      name: size.name,
      pricePesos: formatCentsAsPesosInput(size.priceCents),
      active: size.active,
      cupInventoryItemId: size.cupInventoryItemId ?? '',
      lidInventoryItemId: size.lidInventoryItemId ?? '',
    })),
  };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const moved = next[from]!;
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [original, setOriginal] = useState<Product | null>(null);
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [errors, setErrors] = useState<FormErrors>({ sizes: {} });
  const [pageError, setPageError] = useState('');
  const [orderNotice, setOrderNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState('');
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [liftedKey, setLiftedKey] = useState<string | null>(null);
  const validationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    void Promise.all([
      listCategories(),
      listInventoryItems(),
      id ? getProduct(id) : Promise.resolve(null),
    ])
      .then(([nextCategories, nextItems, product]) => {
        if (!active) return;
        setCategories(nextCategories);
        setInventoryItems(nextItems);
        if (product) {
          setOriginal(product);
          setDraft(draftFromProduct(product));
          document.title = `Edit ${product.name} · UCM Coffee Studio`;
        } else {
          document.title = 'Create product · UCM Coffee Studio';
        }
      })
      .catch(() => {
        if (active) {
          setPageError(
            'The product editor could not be loaded. Return to products and try again.',
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

  const inventoryIds = new Set(inventoryItems.map((item) => item.id));

  function updateSize(key: string, change: Partial<SizeDraft>) {
    setDraft((current) => ({
      ...current,
      sizes: current.sizes.map((size) =>
        size.key === key ? { ...size, ...change } : size,
      ),
    }));
    setErrors((current) => ({
      ...current,
      summary: undefined,
      sizes: { ...current.sizes, [key]: {} },
    }));
  }

  function validate(): ProductInput | null {
    const nextErrors: FormErrors = { sizes: {} };
    const name = draft.name.trim();
    if (!draft.categoryId) {
      nextErrors.categoryId = 'Choose a category.';
    }
    if (!name) {
      nextErrors.name = 'Enter a product name after trimming spaces.';
    }

    const sizes = draft.sizes.flatMap((size, index) => {
      const sizeErrors: SizeErrors = {};
      const sizeName = size.name.trim();
      const priceCents = parsePesosToCents(size.pricePesos);
      if (!sizeName) {
        sizeErrors.name = `Size ${index + 1}: enter a label.`;
      }
      if (priceCents === null) {
        sizeErrors.price = `${sizeName || `Size ${index + 1}`}: enter a price of ₱0.00 or more, with up to two decimal places.`;
      }
      const staleCup =
        size.cupInventoryItemId &&
        !inventoryIds.has(size.cupInventoryItemId);
      const staleLid =
        size.lidInventoryItemId &&
        !inventoryIds.has(size.lidInventoryItemId);
      if (staleCup || staleLid) {
        sizeErrors.mapping =
          'A saved Cup or Lid mapping is no longer selectable. Choose a current item or No mapping.';
      }
      if (Object.keys(sizeErrors).length > 0) {
        nextErrors.sizes[size.key] = sizeErrors;
        return [];
      }
      return [
        {
          ...(size.id ? { id: size.id } : {}),
          name: sizeName,
          priceCents: priceCents!,
          sortWeight: (index + 1) * 10,
          active: size.active,
          cupInventoryItemId: size.cupInventoryItemId || null,
          lidInventoryItemId: size.lidInventoryItemId || null,
        },
      ];
    });

    if (
      nextErrors.categoryId ||
      nextErrors.name ||
      Object.keys(nextErrors.sizes).length > 0
    ) {
      nextErrors.summary =
        'Review the highlighted product and size fields before saving.';
      setErrors(nextErrors);
      requestAnimationFrame(() => validationRef.current?.focus());
      return null;
    }

    setErrors({ sizes: {} });
    return {
      categoryId: draft.categoryId,
      name,
      active: draft.active,
      available: draft.available,
      sizes,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = validate();
    if (!input) return;

    setSaving(true);
    setPageError('');
    try {
      if (id) {
        await updateProduct(id, input);
      } else {
        await createProduct(input);
      }
      navigate('/catalog/products', { replace: true });
    } catch (error) {
      const message =
        error instanceof CatalogApiError
          ? error.messages.join(' ')
          : 'The product could not be saved. Try again.';
      const lowerMessage = message.toLocaleLowerCase('en-US');
      if (lowerMessage.includes('category')) {
        setErrors((current) => ({
          ...current,
          categoryId: message,
          summary: 'Review the highlighted product fields before saving.',
        }));
      } else if (
        lowerMessage.includes('size') ||
        lowerMessage.includes('price') ||
        lowerMessage.includes('cup') ||
        lowerMessage.includes('lid')
      ) {
        setErrors((current) => ({
          ...current,
          summary: message,
        }));
      } else {
        setPageError(message);
      }
      requestAnimationFrame(() => validationRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  async function deleteSize(size: SizeDraft) {
    if (draft.sizes.length === 1 || removingKey) return;
    setRemovingKey(size.key);
    setPageError('');
    setErrors((current) => ({
      ...current,
      sizes: { ...current.sizes, [size.key]: {} },
    }));
    try {
      if (id && size.id) {
        await removeSize(id, size.id);
      }
      setDraft((current) => ({
        ...current,
        sizes: current.sizes.filter((item) => item.key !== size.key),
      }));
      setOrderNotice(`${size.name || 'Size'} was removed.`);
    } catch (error) {
      const message =
        error instanceof CatalogApiError
          ? error.message
          : 'This size could not be removed.';
      setErrors((current) => ({
        ...current,
        sizes: {
          ...current.sizes,
          [size.key]: { ...current.sizes[size.key], remove: message },
        },
      }));
    } finally {
      setRemovingKey('');
    }
  }

  async function persistSizeOrder(next: SizeDraft[]) {
    const previous = draft.sizes;
    setDraft((current) => ({ ...current, sizes: next }));
    setOrderNotice('Size order updated. Save the product to keep this order.');
    if (!id || next.some((size) => !size.id)) return;
    try {
      await reorderSizes(
        id,
        next.map((size, index) => ({
          id: size.id,
          name: size.name,
          priceCents: parsePesosToCents(size.pricePesos) ?? 0,
          sortWeight: (index + 1) * 10,
          active: size.active,
          cupInventoryItemId: size.cupInventoryItemId || null,
          lidInventoryItemId: size.lidInventoryItemId || null,
        })),
      );
      setOrderNotice('Size order saved.');
    } catch {
      setDraft((current) => ({ ...current, sizes: previous }));
      setPageError('The new size order could not be saved. Try again.');
    }
  }

  function dropOn(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) return;
    const from = draft.sizes.findIndex(({ key }) => key === draggedKey);
    const to = draft.sizes.findIndex(({ key }) => key === targetKey);
    if (from >= 0 && to >= 0) {
      void persistSizeOrder(moveItem(draft.sizes, from, to));
    }
    setDraggedKey(null);
  }

  function handleKeyboardOrder(
    event: KeyboardEvent<HTMLButtonElement>,
    key: string,
  ) {
    if (event.key === ' ') {
      event.preventDefault();
      if (liftedKey === key) {
        setLiftedKey(null);
        setOrderNotice('Size dropped.');
      } else {
        setLiftedKey(key);
        setOrderNotice('Size lifted. Use Up and Down arrows, then Space to drop.');
      }
      return;
    }
    if (liftedKey !== key || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const from = draft.sizes.findIndex((size) => size.key === key);
    const to = event.key === 'ArrowUp' ? from - 1 : from + 1;
    if (to < 0 || to >= draft.sizes.length) return;
    void persistSizeOrder(moveItem(draft.sizes, from, to)).then(() => {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(`[data-size-handle="${key}"]`)
          ?.focus(),
      );
    });
  }

  const selectedCategory = categories.find(
    (category) => category.id === draft.categoryId,
  );

  if (loading) {
    return (
      <main className="catalog-page">
        <div className="editor-loading" role="status">
          <span className="catalog-spinner" aria-hidden="true" />
          Loading product editor…
        </div>
      </main>
    );
  }

  return (
    <main className="catalog-page">
      <div className="catalog-page-head">
        <div>
          <div className="breadcrumbs">
            <Link to="/catalog/products">Products</Link>
            <Icon name="chevron" />
            <span>{isEditing ? 'Edit product' : 'Create product'}</span>
          </div>
          <h1>{isEditing ? `Edit ${original?.name ?? 'product'}` : 'Create product'}</h1>
          <p>
            Catalog visibility and service availability are independent.
            Required text is trimmed when saved.
          </p>
        </div>
        <div className="catalog-head-actions">
          <Link className="catalog-button" to="/catalog/products">
            Cancel
          </Link>
          <button
            className="catalog-button primary"
            type="submit"
            form="product-form"
            disabled={saving || Boolean(pageError && !original && isEditing)}
          >
            {saving ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </div>

      {pageError && <Notice tone="danger" title={pageError} />}
      {orderNotice && !pageError && (
        <Notice tone="success" title={orderNotice} />
      )}

      <div className="product-editor-layout">
        <form
          className="catalog-panel product-form"
          id="product-form"
          noValidate
          onSubmit={submit}
        >
          <section className="form-section" aria-labelledby="details-heading">
            <div className="section-heading">
              <h2 id="details-heading">Product details</h2>
              <p>Used across the back office and point of sale.</p>
            </div>
            <div className="product-detail-grid">
              <div className="catalog-field">
                <label htmlFor="product-category">
                  Category <span aria-hidden="true">*</span>
                </label>
                <select
                  id="product-category"
                  value={draft.categoryId}
                  aria-invalid={Boolean(errors.categoryId)}
                  aria-describedby={
                    errors.categoryId ? 'product-category-error' : undefined
                  }
                  onChange={(event) => {
                    setDraft({ ...draft, categoryId: event.target.value });
                    setErrors((current) => ({
                      ...current,
                      categoryId: undefined,
                      summary: undefined,
                    }));
                  }}
                >
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && (
                  <p
                    className="catalog-field-error"
                    id="product-category-error"
                  >
                    {errors.categoryId}
                  </p>
                )}
              </div>
              <div className="catalog-field">
                <label htmlFor="product-name">
                  Product name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="product-name"
                  value={draft.name}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={
                    errors.name ? 'product-name-error' : 'product-name-help'
                  }
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                    setErrors((current) => ({
                      ...current,
                      name: undefined,
                      summary: undefined,
                    }));
                  }}
                />
                {errors.name ? (
                  <p className="catalog-field-error" id="product-name-error">
                    {errors.name}
                  </p>
                ) : (
                  <p className="catalog-field-help" id="product-name-help">
                    Leading and trailing spaces are removed on save.
                  </p>
                )}
              </div>
            </div>

            <div className="state-settings">
              <div className="state-setting">
                <div>
                  <strong>Catalog state</strong>
                  <p>Inactive products are hidden from the POS.</p>
                </div>
                <div className="state-setting-control">
                  <Switch
                    checked={draft.active}
                    label="Catalog active"
                    onChange={(active) => setDraft({ ...draft, active })}
                  />
                  <span>{draft.active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
              <div className="state-setting">
                <div>
                  <strong>Service availability</strong>
                  <p>Sold-out products remain visible but cannot be ordered.</p>
                </div>
                <div className="state-setting-control">
                  <Switch
                    checked={draft.available}
                    label="Currently available"
                    onChange={(available) => setDraft({ ...draft, available })}
                  />
                  <span>{draft.available ? 'Available' : 'Sold out'}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section" aria-labelledby="sizes-heading">
            <div className="section-heading with-action">
              <div>
                <h2 id="sizes-heading">Sizes and prices</h2>
                <p>Drag rows to set the authoritative size order.</p>
              </div>
              <button
                className="catalog-button small"
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    sizes: [...current.sizes, emptySize()],
                  }))
                }
              >
                <Icon name="plus" />
                Add size
              </button>
            </div>

            <div className="size-list">
              {draft.sizes.map((size, index) => {
                const sizeErrors = errors.sizes[size.key] ?? {};
                const staleCup =
                  size.cupInventoryItemId &&
                  !inventoryIds.has(size.cupInventoryItemId);
                const staleLid =
                  size.lidInventoryItemId &&
                  !inventoryIds.has(size.lidInventoryItemId);
                return (
                  <div
                    className={`size-row${draggedKey === size.key ? ' is-dragging' : ''}${Object.keys(sizeErrors).length ? ' has-error' : ''}`}
                    key={size.key}
                    onDragOver={(event: DragEvent) => event.preventDefault()}
                    onDrop={() => dropOn(size.key)}
                  >
                    <button
                      className={`drag-handle${liftedKey === size.key ? ' is-lifted' : ''}`}
                      type="button"
                      draggable
                      data-size-handle={size.key}
                      aria-label={`Reorder ${size.name || `size ${index + 1}`}. Press Space, then Arrow keys.`}
                      aria-pressed={liftedKey === size.key}
                      onDragStart={(event) => {
                        setDraggedKey(size.key);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDraggedKey(null)}
                      onKeyDown={(event) =>
                        handleKeyboardOrder(event, size.key)
                      }
                    >
                      <Icon name="grip" />
                    </button>
                    <div className="catalog-field">
                      <label htmlFor={`size-name-${size.key}`}>
                        Label <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`size-name-${size.key}`}
                        value={size.name}
                        aria-invalid={Boolean(sizeErrors.name)}
                        onChange={(event) =>
                          updateSize(size.key, { name: event.target.value })
                        }
                      />
                      {sizeErrors.name && (
                        <p className="catalog-field-error">{sizeErrors.name}</p>
                      )}
                    </div>
                    <div className="catalog-field">
                      <label htmlFor={`size-price-${size.key}`}>
                        Price <span aria-hidden="true">*</span>
                      </label>
                      <div className="peso-input">
                        <span aria-hidden="true">₱</span>
                        <input
                          id={`size-price-${size.key}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={size.pricePesos}
                          aria-invalid={Boolean(sizeErrors.price)}
                          onChange={(event) =>
                            updateSize(size.key, {
                              pricePesos: event.target.value,
                            })
                          }
                        />
                      </div>
                      {sizeErrors.price && (
                        <p className="catalog-field-error">{sizeErrors.price}</p>
                      )}
                    </div>
                    <div className="catalog-field">
                      <label htmlFor={`size-cup-${size.key}`}>
                        Cup stock item
                      </label>
                      <select
                        id={`size-cup-${size.key}`}
                        value={size.cupInventoryItemId}
                        aria-invalid={Boolean(staleCup)}
                        onChange={(event) =>
                          updateSize(size.key, {
                            cupInventoryItemId: event.target.value,
                          })
                        }
                      >
                        {staleCup && (
                          <option value={size.cupInventoryItemId}>
                            Unavailable saved mapping
                          </option>
                        )}
                        <option value="">No mapping</option>
                        {inventoryItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="catalog-field">
                      <label htmlFor={`size-lid-${size.key}`}>
                        Lid stock item
                      </label>
                      <select
                        id={`size-lid-${size.key}`}
                        value={size.lidInventoryItemId}
                        aria-invalid={Boolean(staleLid)}
                        onChange={(event) =>
                          updateSize(size.key, {
                            lidInventoryItemId: event.target.value,
                          })
                        }
                      >
                        {staleLid && (
                          <option value={size.lidInventoryItemId}>
                            Unavailable saved mapping
                          </option>
                        )}
                        <option value="">No mapping</option>
                        {inventoryItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="size-state">
                      <Switch
                        checked={size.active}
                        label={`${size.name || `Size ${index + 1}`} active`}
                        onChange={(active) => updateSize(size.key, { active })}
                      />
                      <span>{size.active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <button
                      className="catalog-button small danger remove-size"
                      type="button"
                      disabled={draft.sizes.length === 1 || removingKey === size.key}
                      title={
                        draft.sizes.length === 1
                          ? 'Every product must keep at least one size'
                          : `Remove ${size.name || `size ${index + 1}`}`
                      }
                      onClick={() => void deleteSize(size)}
                    >
                      <Icon name="trash" />
                      <span className="sr-only">
                        Remove {size.name || `size ${index + 1}`}
                      </span>
                    </button>
                    {(sizeErrors.mapping || sizeErrors.remove) && (
                      <p className="size-row-error" role="alert">
                        {sizeErrors.mapping ?? sizeErrors.remove}
                      </p>
                    )}
                    {inventoryItems.length === 0 && (
                      <p className="size-row-help">
                        No stock items are available yet. Cup and Lid may stay
                        set to No mapping.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {errors.summary && (
            <div ref={validationRef} tabIndex={-1}>
              <Notice tone="danger" title="Product cannot be saved yet">
                <p>{errors.summary}</p>
              </Notice>
            </div>
          )}
        </form>

        <aside className="catalog-panel editor-summary">
          <div className="catalog-panel-head">
            <h2>Record summary</h2>
          </div>
          <dl>
            <div>
              <dt>Category</dt>
              <dd>{selectedCategory?.name ?? 'Not selected'}</dd>
            </div>
            <div>
              <dt>Catalog</dt>
              <dd>
                <StateBadge
                  active={draft.active}
                  trueLabel="Active"
                  falseLabel="Inactive"
                />
              </dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>
                <StateBadge
                  active={draft.available}
                  trueLabel="Available"
                  falseLabel="Sold out"
                />
              </dd>
            </div>
            <div>
              <dt>Size order</dt>
              <dd>
                {draft.sizes
                  .map((size) => size.name.trim() || 'Untitled size')
                  .join(', ')}
              </dd>
            </div>
          </dl>
          <div className="summary-save">
            <button
              className="catalog-button primary"
              type="submit"
              form="product-form"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save product'}
            </button>
            <p>
              Prices display in pesos and are sent to the catalog as integer
              cents.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
