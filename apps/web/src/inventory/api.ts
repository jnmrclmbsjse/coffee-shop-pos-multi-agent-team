import type {
  CountMethod,
  DayType,
  InventoryItem,
  InventoryItemListFilters,
  ParLevel,
  StockCategorySummary,
} from '@coffee-shop/shared';

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface StockCategoryInput {
  name: string;
  sortWeight: number;
  active: boolean;
}

export interface InventoryItemInput {
  categoryId: string;
  name: string;
  unit: string;
  size: string | null;
  countMethod: CountMethod;
  critical: boolean;
  reconciled: boolean;
  active: boolean;
}

export interface ParLevelInput {
  parQty: number;
  lowThreshold: number | null;
  urgentThreshold: number | null;
}

export class InventoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? 'Inventory request failed');
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
    let messages = ['The inventory change could not be saved. Try again.'];
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
      // Keep the generic message when the server does not return JSON.
    }
    throw new InventoryApiError(response.status, messages);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listStockCategories(): Promise<StockCategorySummary[]> {
  return request('/inventory/categories');
}

export function createStockCategory(
  input: StockCategoryInput,
): Promise<StockCategorySummary> {
  return request('/inventory/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateStockCategory(
  id: string,
  input: Partial<StockCategoryInput>,
): Promise<StockCategorySummary> {
  return request(`/inventory/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteStockCategory(id: string): Promise<void> {
  return request(`/inventory/categories/${id}`, { method: 'DELETE' });
}

export function reorderStockCategories(
  categories: StockCategorySummary[],
): Promise<void> {
  return request('/inventory/categories/reorder', {
    method: 'PUT',
    body: JSON.stringify({
      items: categories.map(({ id }, index) => ({
        id,
        sortWeight: (index + 1) * 10,
      })),
    }),
  });
}

export function listInventoryItems(
  filters: InventoryItemListFilters,
): Promise<InventoryItem[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.countMethod) params.set('countMethod', filters.countMethod);
  for (const key of ['reconciled', 'critical', 'active'] as const) {
    if (filters[key] !== undefined) {
      params.set(key, String(filters[key]));
    }
  }
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return request(`/inventory/items${query}`);
}

export function getInventoryItem(id: string): Promise<InventoryItem> {
  return request(`/inventory/items/${id}`);
}

export function createInventoryItem(
  input: InventoryItemInput,
): Promise<InventoryItem> {
  return request('/inventory/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateInventoryItem(
  id: string,
  input: InventoryItemInput,
): Promise<InventoryItem> {
  return request(`/inventory/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteInventoryItem(id: string): Promise<void> {
  return request(`/inventory/items/${id}`, { method: 'DELETE' });
}

export function saveParLevel(
  itemId: string,
  dayType: DayType,
  input: ParLevelInput,
): Promise<ParLevel> {
  return request(`/inventory/items/${itemId}/par-levels/${dayType}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
