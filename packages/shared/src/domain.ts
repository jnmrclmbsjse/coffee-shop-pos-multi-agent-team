import type { MoneyCents } from './money.js';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  variants: ProductVariant[];
}

export interface ProductVariant {
  id: string;
  name: string;
  priceCents: MoneyCents;
}

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
