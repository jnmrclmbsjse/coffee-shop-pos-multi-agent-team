import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  CatalogCategorySummary,
  Product,
  ProductListSort,
} from '@coffee-shop/shared';
import {
  listCategories,
  listProducts,
  updateProductAvailability,
} from './api';
import {
  Icon,
  LoadingRows,
  Notice,
  StateBadge,
  Switch,
} from './components';

type ActiveFilter = 'all' | 'active' | 'inactive';

export function ProductsPage() {
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [sort, setSort] = useState<ProductListSort>('category');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  useEffect(() => {
    document.title = 'Products · UCM Coffee Studio';
    void listCategories()
      .then(setCategories)
      .catch(() => setPageError('Category filters could not be loaded.'));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let activeRequest = true;
    setLoading(true);
    setPageError('');
    void listProducts({
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      active: active === 'all' ? undefined : active === 'active',
      sort,
    })
      .then((result) => {
        if (activeRequest) setProducts(result);
      })
      .catch(() => {
        if (activeRequest) {
          setPageError('Products could not be loaded. Refresh the page to try again.');
        }
      })
      .finally(() => {
        if (activeRequest) setLoading(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [active, categoryId, debouncedSearch, sort]);

  async function changeAvailability(product: Product, available: boolean) {
    const previous = products;
    setUpdatingId(product.id);
    setPageError('');
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id ? { ...item, available } : item,
      ),
    );
    try {
      const updated = await updateProductAvailability(product.id, available);
      setProducts((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice(
        `${product.name} marked ${available ? 'available' : 'sold out'}.`,
      );
    } catch {
      setProducts(previous);
      setPageError(`${product.name} availability could not be changed.`);
    } finally {
      setUpdatingId('');
    }
  }

  const hasFilters = Boolean(search || categoryId || active !== 'all');

  return (
    <main className="catalog-page">
      <div className="catalog-page-head">
        <div>
          <h1>Products</h1>
          <p>
            Find products by name, filter the catalog, and change today’s
            availability without editing the record.
          </p>
        </div>
        <Link className="catalog-button primary" to="/catalog/products/new">
          <Icon name="plus" />
          Create product
        </Link>
      </div>

      {pageError && <Notice tone="danger" title={pageError} />}
      {notice && !pageError && <Notice tone="success" title={notice} />}

      <section className="catalog-panel" aria-label="Product catalog">
        <div className="product-filters">
          <label className="search-control">
            <span className="sr-only">Search product name</span>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search product name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by category</span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by catalog state</span>
            <select
              value={active}
              onChange={(event) =>
                setActive(event.target.value as ActiveFilter)
              }
            >
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort products</span>
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as ProductListSort)
              }
            >
              <option value="category">Sort: Category</option>
              <option value="name">Sort: Product name</option>
              <option value="active">Sort: Active status</option>
            </select>
          </label>
        </div>

        <div className="results-meta">
          <span>
            {loading
              ? 'Loading products…'
              : `${products.length} ${products.length === 1 ? 'product' : 'products'}`}
          </span>
          <span>Availability changes save immediately</span>
        </div>

        <div className="catalog-table-wrap">
          <table className="catalog-table products-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Product name</th>
                <th scope="col">Catalog state</th>
                <th scope="col">Current availability</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows />
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="catalog-empty">
                      <Icon name={hasFilters ? 'search' : 'box'} />
                      <h3>
                        {hasFilters
                          ? 'No product names match'
                          : 'No products yet'}
                      </h3>
                      <p>
                        {hasFilters
                          ? 'Try a different product-name search or clear the filters.'
                          : 'Create the first product to add it to the catalog.'}
                      </p>
                      {hasFilters ? (
                        <button
                          className="catalog-button"
                          onClick={() => {
                            setSearch('');
                            setCategoryId('');
                            setActive('all');
                          }}
                        >
                          Clear filters
                        </button>
                      ) : (
                        <Link
                          className="catalog-button"
                          to="/catalog/products/new"
                        >
                          Create product
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td data-label="Category">{product.category.name}</td>
                    <td data-label="Product name">
                      <strong>{product.name}</strong>
                      <small>
                        {product.variants.length}{' '}
                        {product.variants.length === 1 ? 'size' : 'sizes'}
                      </small>
                    </td>
                    <td data-label="Catalog state">
                      <StateBadge
                        active={product.active}
                        trueLabel="Active"
                        falseLabel="Inactive"
                      />
                    </td>
                    <td data-label="Current availability">
                      <div className="availability-control">
                        <Switch
                          checked={product.available}
                          disabled={updatingId === product.id}
                          label={`${product.name} availability`}
                          onChange={(available) =>
                            void changeAvailability(product, available)
                          }
                        />
                        <span className={product.available ? '' : 'sold-out-text'}>
                          {product.available ? 'Available' : 'Sold out'}
                        </span>
                      </div>
                    </td>
                    <td data-label="Actions" className="table-action">
                      <Link
                        className="catalog-button small"
                        to={`/catalog/products/${product.id}/edit`}
                      >
                        <Icon name="edit" />
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
    </main>
  );
}
