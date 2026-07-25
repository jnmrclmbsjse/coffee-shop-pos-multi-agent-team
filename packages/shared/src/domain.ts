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

export enum CountMethod {
  QUANTITY = 'QUANTITY',
  LEVEL = 'LEVEL',
}

export enum DayType {
  NORMAL = 'NORMAL',
  PEAK = 'PEAK',
}

export interface StockCategory {
  id: string;
  name: string;
  sortWeight: number;
  active: boolean;
}

export interface StockCategorySummary extends StockCategory {
  itemCount: number;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  category: StockCategory;
  unit: string;
  size: string | null;
  countMethod: CountMethod;
  critical: boolean;
  reconciled: boolean;
  active: boolean;
  parLevels: ParLevel[];
}

export interface ParLevel {
  id: string;
  inventoryItemId: string;
  dayType: DayType;
  parQty: number;
  lowThreshold: number | null;
  urgentThreshold: number | null;
}

export interface InventoryItemListFilters {
  search?: string;
  categoryId?: string;
  countMethod?: CountMethod;
  reconciled?: boolean;
  critical?: boolean;
  active?: boolean;
}

export interface StaffMember {
  id: string;
  displayName: string;
  isActive: boolean;
  locationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StaffMemberListSort = 'name' | 'active';

export type SortDirection = 'asc' | 'desc';

export interface StaffMemberListQuery {
  search?: string;
  active?: boolean;
  sort?: StaffMemberListSort;
  direction?: SortDirection;
}

export interface CreateStaffMemberInput {
  displayName: string;
  isActive?: boolean;
  locationId?: string | null;
}

export interface UpdateStaffMemberInput {
  displayName?: string;
  isActive?: boolean;
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

export enum TradingDayStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  ONLINE = 'ONLINE',
}

export interface TradingDay {
  id: string;
  locationId: string | null;
  businessDate: string;
  status: TradingDayStatus;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: MoneyCents;
  openedByStaffMemberId: string;
  closedByStaffMemberId: string | null;
}

export interface CashCount {
  id: string;
  tradingDayId: string;
  countedCents: MoneyCents;
  countedAt: string;
  countedByStaffMemberId: string;
}

export interface CashExpense {
  id: string;
  tradingDayId: string;
  amountCents: MoneyCents;
  description: string;
  recordedAt: string;
}

export interface SalePayment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amountCents: MoneyCents;
}
