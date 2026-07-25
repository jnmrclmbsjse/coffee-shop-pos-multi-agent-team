import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { CountMethod, type StockCategorySummary } from '@coffee-shop/shared';
import { Link } from 'react-router-dom';
import { Icon, LoadingRows, Notice, StateBadge, Switch } from '../catalog/components';
import {
  createStockCategory,
  deleteStockCategory,
  InventoryApiError,
  listInventoryItems,
  listStockCategories,
  reorderStockCategories,
  updateStockCategory,
} from './api';

type BooleanFilter = 'all' | 'true' | 'false';
type InventoryTab = 'items' | 'categories';

interface CategoryDraft {
  id?: string;
  name: string;
  sortWeight: string;
  active: boolean;
  itemCount: number;
}

const EMPTY_CATEGORY: CategoryDraft = {
  name: '',
  sortWeight: '10',
  active: true,
  itemCount: 0,
};

function booleanValue(value: BooleanFilter): boolean | undefined {
  return value === 'all' ? undefined : value === 'true';
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

export function InventoryPage() {
  const [tab, setTab] = useState<InventoryTab>('items');
  const [categories, setCategories] = useState<StockCategorySummary[]>([]);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listInventoryItems>>>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [countMethod, setCountMethod] = useState('');
  const [reconciled, setReconciled] = useState<BooleanFilter>('all');
  const [critical, setCritical] = useState<BooleanFilter>('all');
  const [active, setActive] = useState<BooleanFilter>('all');
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState(false);
  const [updatingCategoryId, setUpdatingCategoryId] = useState('');
  const [draggedId, setDraggedId] = useState('');
  const categoryNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Inventory · UCM Coffee Studio';
    void loadCategories();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let activeRequest = true;
    setLoadingItems(true);
    setPageError('');
    void listInventoryItems({
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      countMethod: (countMethod || undefined) as CountMethod | undefined,
      reconciled: booleanValue(reconciled),
      critical: booleanValue(critical),
      active: booleanValue(active),
    })
      .then((result) => {
        if (activeRequest) setItems(result);
      })
      .catch(() => {
        if (activeRequest) {
          setPageError('Stock items could not be loaded. Refresh the page to try again.');
        }
      })
      .finally(() => {
        if (activeRequest) setLoadingItems(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [active, categoryId, countMethod, critical, debouncedSearch, reconciled]);

  useEffect(() => {
    if (!categoryDraft) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingCategory) setCategoryDraft(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    requestAnimationFrame(() => categoryNameRef.current?.focus());
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [categoryDraft, savingCategory]);

  async function loadCategories() {
    setLoadingCategories(true);
    try {
      setCategories(await listStockCategories());
    } catch {
      setPageError('Stock categories could not be loaded. Refresh the page to try again.');
    } finally {
      setLoadingCategories(false);
    }
  }

  function openCategory(category?: StockCategorySummary) {
    setCategoryErrors({});
    setPageError('');
    setCategoryDraft(
      category
        ? {
            id: category.id,
            name: category.name,
            sortWeight: String(category.sortWeight),
            active: category.active,
            itemCount: category.itemCount,
          }
        : {
            ...EMPTY_CATEGORY,
            sortWeight: String((categories.length + 1) * 10),
          },
    );
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryDraft || savingCategory) return;
    const errors: Record<string, string> = {};
    const name = categoryDraft.name.trim();
    const sortWeight = Number(categoryDraft.sortWeight);
    if (!name) errors.name = 'Enter a category name.';
    if (!Number.isInteger(sortWeight)) {
      errors.sortWeight = 'Enter a whole-number sort weight.';
    }
    setCategoryErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSavingCategory(true);
    setPageError('');
    try {
      const input = { name, sortWeight, active: categoryDraft.active };
      const saved = categoryDraft.id
        ? await updateStockCategory(categoryDraft.id, input)
        : await createStockCategory(input);
      await loadCategories();
      setCategoryDraft(null);
      setNotice(`${saved.name} was ${categoryDraft.id ? 'updated' : 'created'}.`);
    } catch (error) {
      const message =
        error instanceof InventoryApiError
          ? error.messages.join(' ')
          : 'The category could not be saved. Try again.';
      if (message.toLocaleLowerCase('en-US').includes('name')) {
        setCategoryErrors({ name: message });
      } else {
        setPageError(message);
      }
    } finally {
      setSavingCategory(false);
    }
  }

  async function removeCategory() {
    if (!categoryDraft?.id || savingCategory) return;
    setSavingCategory(true);
    setPageError('');
    try {
      await deleteStockCategory(categoryDraft.id);
      setCategoryDraft(null);
      setNotice(`${categoryDraft.name} was deleted.`);
      await loadCategories();
    } catch (error) {
      setCategoryErrors({
        delete:
          error instanceof InventoryApiError
            ? error.messages.join(' ')
            : 'The category could not be deleted. Try again.',
      });
    } finally {
      setSavingCategory(false);
    }
  }

  async function toggleCategory(category: StockCategorySummary) {
    setUpdatingCategoryId(category.id);
    setPageError('');
    try {
      const updated = await updateStockCategory(category.id, {
        active: !category.active,
      });
      setCategories((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(`${updated.name} is now ${updated.active ? 'active' : 'inactive'}.`);
    } catch (error) {
      setPageError(
        error instanceof InventoryApiError
          ? error.message
          : 'The category state could not be changed.',
      );
    } finally {
      setUpdatingCategoryId('');
    }
  }

  async function persistCategoryOrder(next: StockCategorySummary[]) {
    const previous = categories;
    const weighted = next.map((category, index) => ({
      ...category,
      sortWeight: (index + 1) * 10,
    }));
    setCategories(weighted);
    setPageError('');
    try {
      await reorderStockCategories(weighted);
      setNotice('Category order saved.');
    } catch {
      setCategories(previous);
      setPageError('The category order could not be saved. Try again.');
    }
  }

  function dropCategory(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const from = categories.findIndex(({ id }) => id === draggedId);
    const to = categories.findIndex(({ id }) => id === targetId);
    if (from >= 0 && to >= 0) void persistCategoryOrder(moveItem(categories, from, to));
    setDraggedId('');
  }

  function moveCategory(id: string, direction: -1 | 1) {
    const from = categories.findIndex((category) => category.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= categories.length) return;
    void persistCategoryOrder(moveItem(categories, from, to));
  }

  const hasFilters = Boolean(
    search || categoryId || countMethod || reconciled !== 'all' || critical !== 'all' || active !== 'all',
  );

  function clearFilters() {
    setSearch('');
    setCategoryId('');
    setCountMethod('');
    setReconciled('all');
    setCritical('all');
    setActive('all');
  }

  return (
    <main className="catalog-page inventory-page">
      <div className="catalog-page-head">
        <div>
          <h1>Inventory</h1>
          <p>Manage stock definitions, counting rules, and restock thresholds.</p>
        </div>
        {tab === 'items' ? (
          <Link className="catalog-button primary" to="/inventory/items/new">
            <Icon name="plus" />
            Add stock item
          </Link>
        ) : (
          <button className="catalog-button primary" onClick={() => openCategory()}>
            <Icon name="plus" />
            Create category
          </button>
        )}
      </div>

      <div className="inventory-tabs" role="tablist" aria-label="Inventory sections">
        <button
          role="tab"
          aria-selected={tab === 'items'}
          onClick={() => setTab('items')}
        >
          Stock items
        </button>
        <button
          role="tab"
          aria-selected={tab === 'categories'}
          onClick={() => setTab('categories')}
        >
          Categories
        </button>
      </div>

      {pageError && <Notice tone="danger" title={pageError} />}
      {notice && !pageError && <Notice tone="success" title={notice} />}

      {tab === 'items' ? (
        <section className="catalog-panel" aria-labelledby="stock-items-heading">
          <div className="inventory-filters">
            <div className="search-control">
              <label className="sr-only" htmlFor="inventory-search">Search stock items</label>
              <Icon name="search" />
              <input
                id="inventory-search"
                placeholder="Search by item name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <label>
              <span>Category</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Count method</span>
              <select value={countMethod} onChange={(event) => setCountMethod(event.target.value)}>
                <option value="">All methods</option>
                <option value={CountMethod.QUANTITY}>Quantity</option>
                <option value={CountMethod.LEVEL}>Level</option>
              </select>
            </label>
            <FilterSelect label="Reconciled" value={reconciled} onChange={setReconciled} />
            <FilterSelect label="Critical" value={critical} onChange={setCritical} />
            <FilterSelect
              label="Status"
              value={active}
              trueLabel="Active"
              falseLabel="Inactive"
              onChange={setActive}
            />
          </div>
          <div className="results-meta">
            <span>
              {loadingItems ? 'Loading stock items' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            </span>
            {hasFilters && (
              <button className="inventory-clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
          <div className="catalog-table-wrap">
            <table className="catalog-table inventory-items-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Category</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Size</th>
                  <th scope="col">Count method</th>
                  <th scope="col">Reconciled</th>
                  <th scope="col">Critical</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loadingItems ? (
                  <LoadingRows columns={9} />
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="catalog-empty">
                        <Icon name="box" />
                        <h3>{hasFilters ? 'No items match these filters' : 'No stock items yet'}</h3>
                        <p>
                          {hasFilters
                            ? 'Clear filters or change a selection to see more items.'
                            : 'Add the first item to configure inventory counting.'}
                        </p>
                        {hasFilters ? (
                          <button className="catalog-button" onClick={clearFilters}>Clear filters</button>
                        ) : (
                          <Link className="catalog-button" to="/inventory/items/new">Add stock item</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Item"><strong>{item.name}</strong></td>
                      <td data-label="Category">{item.category.name}</td>
                      <td data-label="Unit">{item.unit}</td>
                      <td data-label="Size">{item.size || 'Not set'}</td>
                      <td data-label="Count method">
                        {item.countMethod === CountMethod.QUANTITY ? 'Quantity' : 'Level'}
                      </td>
                      <td data-label="Reconciled">
                        <StateBadge active={item.reconciled} trueLabel="Yes" falseLabel="No" />
                      </td>
                      <td data-label="Critical">
                        <StateBadge active={item.critical} trueLabel="Yes" falseLabel="No" />
                      </td>
                      <td data-label="Status">
                        <StateBadge active={item.active} trueLabel="Active" falseLabel="Inactive" />
                      </td>
                      <td data-label="Actions" className="table-action">
                        <Link className="catalog-button small" to={`/inventory/items/${item.id}/edit`}>
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="catalog-panel" aria-labelledby="stock-categories-heading">
          <div className="catalog-panel-head">
            <h2 id="stock-categories-heading">Stock categories</h2>
            <span>{categories.length} {categories.length === 1 ? 'category' : 'categories'}</span>
          </div>
          <div className="catalog-table-wrap">
            <table className="catalog-table inventory-categories-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Category</th>
                  <th scope="col">Sort weight</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loadingCategories ? (
                  <LoadingRows columns={6} />
                ) : (
                  categories.map((category, index) => (
                    <tr
                      key={category.id}
                      draggable
                      className={draggedId === category.id ? 'is-dragging' : ''}
                      onDragStart={(event: DragEvent) => {
                        setDraggedId(category.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDraggedId('')}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropCategory(category.id)}
                    >
                      <td data-label="Order">
                        <div className="inventory-order-actions">
                          <Icon name="grip" />
                          <button
                            aria-label={`Move ${category.name} up`}
                            disabled={index === 0}
                            onClick={() => moveCategory(category.id, -1)}
                          >↑</button>
                          <button
                            aria-label={`Move ${category.name} down`}
                            disabled={index === categories.length - 1}
                            onClick={() => moveCategory(category.id, 1)}
                          >↓</button>
                        </div>
                      </td>
                      <td data-label="Category"><strong>{category.name}</strong></td>
                      <td data-label="Sort weight" className="numeric">{category.sortWeight}</td>
                      <td data-label="Items" className="numeric">{category.itemCount}</td>
                      <td data-label="Status">
                        <div className="inventory-status-toggle">
                          <Switch
                            checked={category.active}
                            label={`${category.active ? 'Deactivate' : 'Activate'} ${category.name}`}
                            disabled={updatingCategoryId === category.id}
                            onChange={() => void toggleCategory(category)}
                          />
                          <span>{category.active ? 'Active' : 'Inactive'}</span>
                        </div>
                      </td>
                      <td data-label="Actions" className="table-action">
                        <button className="catalog-button small" onClick={() => openCategory(category)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {categoryDraft && (
        <div className="inventory-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingCategory) setCategoryDraft(null);
        }}>
          <section
            className="inventory-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
          >
            <div className="inventory-modal-head">
              <div>
                <h2 id="category-dialog-title">
                  {categoryDraft.id ? 'Edit category' : 'Create category'}
                </h2>
                <p>Changes appear in the saved category order.</p>
              </div>
              <button
                className="catalog-button small"
                aria-label="Close category editor"
                disabled={savingCategory}
                onClick={() => setCategoryDraft(null)}
              >Close</button>
            </div>
            <form noValidate onSubmit={saveCategory}>
              <div className="catalog-field">
                <label htmlFor="stock-category-name">Category name <span aria-hidden="true">*</span></label>
                <input
                  ref={categoryNameRef}
                  id="stock-category-name"
                  value={categoryDraft.name}
                  aria-invalid={Boolean(categoryErrors.name)}
                  aria-describedby={categoryErrors.name ? 'stock-category-name-error' : undefined}
                  onChange={(event) => {
                    setCategoryDraft({ ...categoryDraft, name: event.target.value });
                    setCategoryErrors({});
                  }}
                />
                {categoryErrors.name && <p id="stock-category-name-error" className="catalog-field-error">{categoryErrors.name}</p>}
              </div>
              <div className="inventory-modal-grid">
                <div className="catalog-field">
                  <label htmlFor="stock-category-weight">Sort weight <span aria-hidden="true">*</span></label>
                  <input
                    id="stock-category-weight"
                    type="number"
                    step="1"
                    value={categoryDraft.sortWeight}
                    aria-invalid={Boolean(categoryErrors.sortWeight)}
                    onChange={(event) => setCategoryDraft({ ...categoryDraft, sortWeight: event.target.value })}
                  />
                  {categoryErrors.sortWeight && <p className="catalog-field-error">{categoryErrors.sortWeight}</p>}
                </div>
                <div className="catalog-field">
                  <label htmlFor="stock-category-state">Status</label>
                  <select
                    id="stock-category-state"
                    value={categoryDraft.active ? 'active' : 'inactive'}
                    onChange={(event) => setCategoryDraft({ ...categoryDraft, active: event.target.value === 'active' })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              {categoryErrors.delete && (
                <Notice tone="danger" title={categoryErrors.delete} />
              )}
              <div className="inventory-modal-actions">
                {categoryDraft.id && (
                  <button
                    className="catalog-button danger"
                    type="button"
                    disabled={savingCategory}
                    onClick={() => void removeCategory()}
                  >
                    <Icon name="trash" />
                    Delete category
                  </button>
                )}
                <span />
                <button className="catalog-button" type="button" disabled={savingCategory} onClick={() => setCategoryDraft(null)}>
                  Cancel
                </button>
                <button className="catalog-button primary" type="submit" disabled={savingCategory}>
                  {savingCategory ? 'Saving…' : 'Save category'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  trueLabel = 'Yes',
  falseLabel = 'No',
  onChange,
}: {
  label: string;
  value: BooleanFilter;
  trueLabel?: string;
  falseLabel?: string;
  onChange: (value: BooleanFilter) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as BooleanFilter)}>
        <option value="all">All</option>
        <option value="true">{trueLabel}</option>
        <option value="false">{falseLabel}</option>
      </select>
    </label>
  );
}
