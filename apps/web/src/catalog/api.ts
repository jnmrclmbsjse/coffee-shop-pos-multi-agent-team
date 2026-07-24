import type {
  CatalogCategorySummary,
  InventoryItemOption,
  Product,
  ProductListSort,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface CategoryInput {
  name: string;
  sortWeight: number;
  active: boolean;
}

export interface ProductSizeInput {
  id?: string;
  name: string;
  priceCents: number;
  sortWeight: number;
  active: boolean;
  cupInventoryItemId: string | null;
  lidInventoryItemId: string | null;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  active: boolean;
  available: boolean;
  sizes: ProductSizeInput[];
}

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  active?: boolean;
  sort?: ProductListSort;
}

export class CatalogApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'Catalog request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let messages = ['The catalog change could not be saved. Try again.'];
    try {
      const body = (await response.json()) as { message?: unknown };
      if (Array.isArray(body.message)) {
        messages = body.message.filter(
          (message): message is string => typeof message === 'string',
        );
      } else if (typeof body.message === 'string') {
        messages = [body.message];
      }
    } catch {
      // The generic message above is appropriate when no JSON body is present.
    }
    throw new CatalogApiError(response.status, messages);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listCategories(): Promise<CatalogCategorySummary[]> {
  return request('/catalog/categories');
}

export function createCategory(
  input: CategoryInput,
): Promise<CatalogCategorySummary> {
  return request('/catalog/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCategory(
  id: string,
  input: Partial<CategoryInput>,
): Promise<CatalogCategorySummary> {
  return request(`/catalog/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function reorderCategories(
  categories: CatalogCategorySummary[],
): Promise<void> {
  return request('/catalog/categories/reorder', {
    method: 'PUT',
    body: JSON.stringify({
      items: categories.map(({ id }, index) => ({
        id,
        sortWeight: (index + 1) * 10,
      })),
    }),
  });
}

export function listProducts(filters: ProductFilters): Promise<Product[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.active !== undefined) {
    params.set('active', String(filters.active));
  }
  if (filters.sort) params.set('sort', filters.sort);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return request(`/catalog/products${query}`);
}

export function getProduct(id: string): Promise<Product> {
  return request(`/catalog/products/${id}`);
}

export function createProduct(input: ProductInput): Promise<Product> {
  return request('/catalog/products', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProduct(
  id: string,
  input: ProductInput,
): Promise<Product> {
  return request(`/catalog/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function updateProductAvailability(
  id: string,
  available: boolean,
): Promise<Product> {
  return request(`/catalog/products/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ available }),
  });
}

export function reorderSizes(productId: string, sizes: ProductSizeInput[]) {
  return request<void>(`/catalog/products/${productId}/sizes/reorder`, {
    method: 'PUT',
    body: JSON.stringify({
      items: sizes.map(({ id }, index) => ({
        id,
        sortWeight: (index + 1) * 10,
      })),
    }),
  });
}

export function removeSize(productId: string, sizeId: string): Promise<void> {
  return request(`/catalog/products/${productId}/sizes/${sizeId}`, {
    method: 'DELETE',
  });
}

export function listInventoryItems(): Promise<InventoryItemOption[]> {
  return request('/inventory/items');
}
