import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { CatalogCategorySummary } from '@coffee-shop/shared';
import {
  CatalogApiError,
  createCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from './api';
import { Icon, LoadingRows, Notice, StateBadge } from './components';

interface CategoryDraft {
  id?: string;
  name: string;
  active: boolean;
}

const EMPTY_DRAFT: CategoryDraft = { name: '', active: true };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const moved = next[from]!;
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function CategoriesPage() {
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [nameError, setNameError] = useState('');
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Categories · UCM Coffee Studio';
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setPageError('');
    try {
      setCategories(await listCategories());
    } catch {
      setPageError('Categories could not be loaded. Refresh the page to try again.');
    } finally {
      setLoading(false);
    }
  }

  function openForm(category?: CatalogCategorySummary) {
    setDraft(
      category
        ? { id: category.id, name: category.name, active: category.active }
        : EMPTY_DRAFT,
    );
    setNameError('');
    setPageError('');
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function validateName(): string {
    const name = draft?.name.trim() ?? '';
    if (!name) {
      return 'Enter a category name after trimming spaces.';
    }
    const duplicate = categories.some(
      (category) =>
        category.id !== draft?.id &&
        category.name.trim().toLocaleLowerCase('en-US') ===
          name.toLocaleLowerCase('en-US'),
    );
    return duplicate
      ? `“${name}” already exists. Names ignore letter case.`
      : '';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const validation = validateName();
    setNameError(validation);
    if (validation) {
      nameRef.current?.focus();
      return;
    }

    setSaving(true);
    setPageError('');
    try {
      const name = draft.name.trim();
      if (draft.id) {
        const updated = await updateCategory(draft.id, {
          name,
          active: draft.active,
        });
        setCategories((current) =>
          current.map((category) =>
            category.id === updated.id ? updated : category,
          ),
        );
        setNotice(`${updated.name} was updated.`);
      } else {
        const created = await createCategory({
          name,
          active: draft.active,
          sortWeight: (categories.length + 1) * 10,
        });
        setCategories((current) => [...current, created]);
        setNotice(`${created.name} was created.`);
      }
      setDraft(null);
    } catch (error) {
      if (
        error instanceof CatalogApiError &&
        (error.status === 409 ||
          error.messages.some((message) => message.includes('name')))
      ) {
        setNameError(error.message);
        nameRef.current?.focus();
      } else {
        setPageError(
          error instanceof CatalogApiError
            ? error.message
            : 'The category could not be saved. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function persistOrder(next: CatalogCategorySummary[]) {
    const previous = categories;
    const weighted = next.map((category, index) => ({
      ...category,
      sortWeight: (index + 1) * 10,
    }));
    setCategories(weighted);
    setPageError('');
    try {
      await reorderCategories(weighted);
      setNotice('Category order saved.');
    } catch {
      setCategories(previous);
      setPageError('The new category order could not be saved. Try again.');
    }
  }

  function dropOn(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const from = categories.findIndex(({ id }) => id === draggedId);
    const to = categories.findIndex(({ id }) => id === targetId);
    if (from >= 0 && to >= 0) {
      void persistOrder(moveItem(categories, from, to));
    }
    setDraggedId(null);
  }

  function handleKeyboardOrder(
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) {
    if (event.key === ' ') {
      event.preventDefault();
      if (liftedId === id) {
        setLiftedId(null);
        setNotice('Category order saved.');
      } else {
        setLiftedId(id);
        setNotice('Category lifted. Use Up and Down arrows, then Space to drop.');
      }
      return;
    }
    if (liftedId !== id || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const from = categories.findIndex((category) => category.id === id);
    const to = event.key === 'ArrowUp' ? from - 1 : from + 1;
    if (to < 0 || to >= categories.length) return;
    void persistOrder(moveItem(categories, from, to)).then(() => {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(`[data-category-handle="${id}"]`)
          ?.focus(),
      );
    });
  }

  return (
    <main className="catalog-page">
      <div className="catalog-page-head">
        <div>
          <h1>Categories</h1>
          <p>
            Control how product groups appear. Stored weights update from the
            order below.
          </p>
        </div>
        <button className="catalog-button primary" onClick={() => openForm()}>
          <Icon name="plus" />
          Create category
        </button>
      </div>

      {pageError && <Notice tone="danger" title={pageError} />}
      {notice && !pageError && <Notice tone="success" title={notice} />}

      {draft && (
        <form className="category-form" noValidate onSubmit={submit}>
          <div className="catalog-field">
            <label htmlFor="category-name">
              Category name <span aria-hidden="true">*</span>
            </label>
            <input
              ref={nameRef}
              id="category-name"
              value={draft.name}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'category-name-error' : undefined}
              disabled={saving}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setNameError('');
              }}
            />
            {nameError && (
              <p className="catalog-field-error" id="category-name-error">
                {nameError}
              </p>
            )}
          </div>
          <div className="catalog-field">
            <label htmlFor="category-state">Catalog state</label>
            <select
              id="category-state"
              value={draft.active ? 'active' : 'inactive'}
              disabled={saving}
              onChange={(event) =>
                setDraft({ ...draft, active: event.target.value === 'active' })
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <p className="catalog-field-help">
              Inactive categories stay out of the POS.
            </p>
          </div>
          <div className="catalog-form-actions">
            <button
              className="catalog-button primary"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save category'}
            </button>
            <button
              className="catalog-button"
              type="button"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="catalog-panel" aria-labelledby="category-list-title">
        <div className="catalog-panel-head">
          <h2 id="category-list-title">All categories</h2>
          <span>
            {categories.length} {categories.length === 1 ? 'category' : 'categories'}
          </span>
        </div>
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Category name</th>
                <th scope="col">Stored weight</th>
                <th scope="col">Status</th>
                <th scope="col">Products</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows columns={6} />
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="catalog-empty">
                      <Icon name="grid" />
                      <h3>No categories yet</h3>
                      <p>Create the first category to start organizing products.</p>
                      <button
                        className="catalog-button"
                        onClick={() => openForm()}
                      >
                        Create category
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr
                    key={category.id}
                    className={draggedId === category.id ? 'is-dragging' : ''}
                    onDragOver={(event: DragEvent) => event.preventDefault()}
                    onDrop={() => dropOn(category.id)}
                  >
                    <td data-label="Order">
                      <button
                        className={`drag-handle${liftedId === category.id ? ' is-lifted' : ''}`}
                        type="button"
                        draggable
                        data-category-handle={category.id}
                        aria-label={`Reorder ${category.name}. Press Space, then Arrow keys.`}
                        aria-pressed={liftedId === category.id}
                        onDragStart={(event) => {
                          setDraggedId(category.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setDraggedId(null)}
                        onKeyDown={(event) =>
                          handleKeyboardOrder(event, category.id)
                        }
                      >
                        <Icon name="grip" />
                      </button>
                    </td>
                    <td data-label="Category name">
                      <strong>{category.name}</strong>
                    </td>
                    <td data-label="Stored weight" className="numeric">
                      {category.sortWeight}
                    </td>
                    <td data-label="Status">
                      <StateBadge
                        active={category.active}
                        trueLabel="Active"
                        falseLabel="Inactive"
                      />
                    </td>
                    <td data-label="Products" className="numeric">
                      {category.productCount}
                    </td>
                    <td data-label="Actions" className="table-action">
                      <button
                        className="catalog-button small"
                        onClick={() => openForm(category)}
                      >
                        <Icon name="edit" />
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
    </main>
  );
}
