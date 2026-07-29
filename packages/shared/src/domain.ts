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

export enum OrderStatus {
  PARKED = 'PARKED',
  COMPLETED = 'COMPLETED',
}

export enum ServiceType {
  DINE_IN = 'DINE_IN',
  TAKE_OUT = 'TAKE_OUT',
}

export enum LineDiscountKind {
  NONE = 'NONE',
  SENIOR = 'SENIOR',
}

export interface Order {
  id: string;
  clientGeneratedId: string;
  locationId: string | null;
  tradingDayId: string;
  kind: 'PURCHASE' | 'VOID';
  correctsSaleId: string | null;
  dayOrderNumber: number;
  status: OrderStatus;
  customerName: string | null;
  serviceType: ServiceType;
  subtotalCents: MoneyCents;
  discountCents: MoneyCents;
  taxCents: MoneyCents;
  totalCents: MoneyCents;
  cashTipCents: MoneyCents;
  cashReceivedCents: MoneyCents | null;
  changeOwedCents: MoneyCents;
  changeSettledAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
  recordedAt: string;
  payments: SalePayment[];
  lines: LineItem[];
}

export interface LineItem {
  id: string;
  productVariantId: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  lineGrossCents: MoneyCents;
  discountKind: LineDiscountKind;
  discountCents: MoneyCents;
  lineTotalCents: MoneyCents;
  productNameSnapshot: string;
  variantNameSnapshot: string;
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

export interface DailyReconciliation {
  date: string;
  status: 'open' | 'closed';
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  grossSalesCents: MoneyCents;
  tipsCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  expectedCashCents: MoneyCents;
  actualCashCents: MoneyCents | null;
  varianceCents: MoneyCents | null;
}

export interface ProductSales {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueCents: MoneyCents;
}

export interface SalesReportTotals {
  grossSalesCents: MoneyCents;
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  tipsCents: MoneyCents;
}

export interface SalesRangeReport {
  from: string;
  to: string;
  totals: SalesReportTotals;
  dailyReconciliation: DailyReconciliation[];
  topProducts: ProductSales[];
}

export interface DashboardSalesTrend {
  date: string;
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
}

export interface DashboardTradingDaySummary {
  date: string;
  status: 'open' | 'closed';
  orderCount: number;
  grossSalesCents: MoneyCents;
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  averageOrderValueCents: MoneyCents;
  cashTipsCents: MoneyCents;
}

export interface ReportingDashboard {
  summary: DashboardTradingDaySummary | null;
  salesTrend: DashboardSalesTrend[];
  topProducts: ProductSales[];
}

export type OrderHistoryStatus = 'Parked' | 'Completed' | 'Void';

export type OrderHistoryPaymentMethod = 'Cash' | 'Online' | 'Split';

export type OrderHistoryListSort =
  | 'businessDay'
  | 'orderNumber'
  | 'status'
  | 'total'
  | 'completedAt';

export interface OrderHistoryListQuery {
  status?: OrderHistoryStatus;
  paymentMethod?: OrderHistoryPaymentMethod;
  search?: string;
  sort?: OrderHistoryListSort;
  direction?: SortDirection;
  page?: number;
  pageSize?: 5 | 10 | 25 | 50;
}

export interface OrderHistoryListItem {
  id: string;
  businessDay: string;
  dayOrderNumber: number;
  customerName: string | null;
  status: OrderHistoryStatus;
  paymentMethod: OrderHistoryPaymentMethod | null;
  totalCents: MoneyCents;
  tipCents: MoneyCents;
  changeOwedCents: MoneyCents;
  changeSettled: boolean | null;
  completedAt: string | null;
}

export interface OrderHistoryList {
  items: OrderHistoryListItem[];
  page: number;
  pageSize: 5 | 10 | 25 | 50;
  totalItems: number;
  totalPages: number;
}

export interface OrderHistoryLine {
  id: string;
  productName: string;
  size: string;
  quantity: number;
  discountKind: LineDiscountKind;
  lineTotalCents: MoneyCents;
}

export interface OrderHistoryDetail {
  id: string;
  businessDay: string;
  dayOrderNumber: number;
  customerName: string | null;
  status: OrderHistoryStatus;
  serviceType: ServiceType;
  paymentMethod: OrderHistoryPaymentMethod | null;
  lines: OrderHistoryLine[];
  subtotalCents: MoneyCents;
  totalDiscountCents: MoneyCents;
  totalCents: MoneyCents;
  cashPortionCents: MoneyCents | null;
  onlinePortionCents: MoneyCents | null;
  tipCents: MoneyCents;
  cashReceivedCents: MoneyCents | null;
  changeOwedCents: MoneyCents;
  changeSettledAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
}
