import type { MoneyCents } from './money.js';

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  category: CatalogCategory;
  active: boolean;
  available: boolean;
  variants: ProductVariant[];
}

export interface CatalogCategory {
  id: string;
  name: string;
  sortWeight: number;
  active: boolean;
}

export interface CatalogCategorySummary extends CatalogCategory {
  productCount: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  priceCents: MoneyCents;
  sortWeight: number;
  active: boolean;
  cupInventoryItemId: string | null;
  lidInventoryItemId: string | null;
}

export interface InventoryItemOption {
  id: string;
  name: string;
}

export type ProductListSort = 'category' | 'name' | 'active';

export type StockCountPhase = 'open' | 'close';

export interface StockCount {
  id: string;
  locationId: string | null;
  businessDate: string;
  phase: StockCountPhase;
  recordedAt: string;
  lines: StockCountLine[];
}

export interface StockCountLine {
  inventoryItemId: string;
  quantity: number;
}

export interface Order {
  id: string;
  clientGeneratedId: string;
  locationId: string | null;
  lines: LineItem[];
  totalCents: MoneyCents;
}

export interface LineItem {
  productVariantId: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  lineTotalCents: MoneyCents;
}
