import type { MoneyCents } from './money.js';

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  category: CatalogCategory;
  packagingServings: number;
  active: boolean;
  available: boolean;
  variants: ProductVariant[];
}

export interface CatalogCategory {
  id: string;
  name: string;
  sortWeight: number;
  active: boolean;
  freeUpsizeEligible: boolean;
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

export enum StockLevel {
  EMPTY = 'EMPTY',
  LOW = 'LOW',
  QUARTER = 'QUARTER',
  ONE_THIRD = 'ONE_THIRD',
  HALF = 'HALF',
  TWO_THIRDS = 'TWO_THIRDS',
  THREE_QUARTERS = 'THREE_QUARTERS',
  FULL = 'FULL',
}

export enum MovementType {
  DELIVERY = 'DELIVERY',
  WASTAGE = 'WASTAGE',
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
  parQty: number | null;
  parLevel: StockLevel | null;
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
  // Login account linkage. A staff member has at most one account (userId is
  // unique), so hasAccount decides create-versus-manage in the admin UI.
  hasAccount: boolean;
  accountUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffCompensationEntry {
  id: string;
  staffMemberId: string;
  staffMemberDisplayName: string;
  workDate: string;
  salaryCents: MoneyCents;
  commissionCents: MoneyCents;
  dailyTotalCents: MoneyCents;
  locationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffCompensationEntryListQuery {
  staffMemberId?: string;
  from?: string;
  to?: string;
}

export interface CreateStaffCompensationEntryInput {
  staffMemberId: string;
  workDate: string;
  salaryCents: MoneyCents;
  commissionCents: MoneyCents;
}

export interface UpdateStaffCompensationEntryInput {
  salaryCents: MoneyCents;
  commissionCents: MoneyCents;
}

export interface PayslipEntry {
  id: string;
  workDate: string;
  salaryCents: MoneyCents;
  commissionCents: MoneyCents;
  dailyTotalCents: MoneyCents;
}

export interface PayslipQuery {
  staffMemberId: string;
  from: string;
  to: string;
}

export interface PayslipSummary {
  staffMember: Pick<StaffMember, 'id' | 'displayName'>;
  from: string;
  to: string;
  entries: PayslipEntry[];
  salaryTotalCents: MoneyCents;
  commissionTotalCents: MoneyCents;
  grandTotalCents: MoneyCents;
}

export interface SelectableStaffMember {
  id: string;
  displayName: string;
  requiresPin: boolean;
}

export interface ActiveCashier {
  id: string;
  displayName: string;
}

export interface ActiveCashierResponse {
  cashier: ActiveCashier | null;
}

export interface SelectActiveCashierInput {
  deviceId: string;
  staffMemberId: string;
  pin?: string;
}

export interface ClearActiveCashierInput {
  deviceId: string;
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

export interface CreateStaffAccountInput {
  username: string;
  displayName?: string;
  password: string;
  pin?: string;
}

export interface CreateStaffAccountResponse {
  username: string;
  displayName: string;
}

export type ProductListSort = 'category' | 'name' | 'active';

export type StockCountPhase = 'open' | 'close';

export interface StockCount {
  id: string;
  locationId: string | null;
  businessDate: string;
  phase: StockCountPhase;
  submittedByStaffMemberId: string;
  submittedByNameSnapshot: string;
  shiftLeadStaffMemberId: string | null;
  shiftLeadNameSnapshot: string | null;
  recordedAt: string;
  lines: StockCountLine[];
}

export interface StockCountLine {
  inventoryItemId: string;
  quantity: number | null;
  level: StockLevel | null;
}

export interface StockMovement {
  id: string;
  locationId: string | null;
  businessDate: string;
  inventoryItemId: string;
  type: MovementType;
  quantity: number;
  recordedByStaffMemberId: string | null;
  recordedByNameSnapshot: string | null;
  reason: string | null;
  recordedAt: string;
}

export interface CurrentOpenBusinessDay {
  isOpen: boolean;
  businessDate: string | null;
  dayType: DayType | null;
  openingFloatCents: MoneyCents | null;
  openedByDisplayName: string | null;
  openedAt: string | null;
}

export interface BusinessDayListItem {
  id: string;
  businessDate: string;
  status: TradingDayStatus;
}

export interface BusinessDayList {
  items: BusinessDayListItem[];
  currentOpenBusinessDayId: string | null;
}

export interface OpenBusinessDayInput {
  businessDate: string;
  dayType: DayType;
  openingFloatCents: MoneyCents;
  openedByStaffMemberId: string;
}

export interface CloseBusinessDayInput {
  clientGeneratedId: string;
  actualCashCents: MoneyCents;
  varianceReason?: string | null;
  closedByStaffMemberId: string;
}

export interface TradingDayClosingSummary {
  isOpen: boolean;
  businessDate: string | null;
  openingFloatCents: MoneyCents | null;
  cashSalesCents: MoneyCents | null;
  onlineSalesCents: MoneyCents | null;
  grossSalesCents: MoneyCents | null;
  cashTipsCents: MoneyCents | null;
  cashInCents: MoneyCents | null;
  cashOutCents: MoneyCents | null;
  cashExpensesCents: MoneyCents | null;
  outstandingChangeCents: MoneyCents | null;
  expectedCashCents: MoneyCents | null;
  packaging: PackagingReconciliationRow[];
  hasClosingStockCount: boolean;
}

export interface InventoryStaffOption {
  id: string;
  displayName: string;
}

export interface CountSheetItem {
  id: string;
  name: string;
  size: string | null;
  unit: string;
  countMethod: CountMethod;
  critical: boolean;
  // Category the count sheet groups this item under. Carried on the item
  // rather than as a nested list so the sheet stays a flat, ordered array.
  categoryId: string;
  categoryName: string;
}

export interface SubmittedStockCountLine extends StockCountLine {
  itemName: string;
}

export interface SubmittedStockCount extends Omit<StockCount, 'lines'> {
  lines: SubmittedStockCountLine[];
}

export interface CountSheet {
  businessDay: CurrentOpenBusinessDay;
  phase: StockCountPhase;
  items: CountSheetItem[];
  submittedCount: SubmittedStockCount | null;
}

export interface SubmitStockCountLineInput {
  inventoryItemId: string;
  quantity?: number;
  level?: StockLevel;
}

export interface SubmitStockCountInput {
  phase: StockCountPhase;
  submittedByStaffMemberId: string;
  shiftLeadStaffMemberId?: string | null;
  lines: SubmitStockCountLineInput[];
}

export interface CreateStockMovementInput {
  inventoryItemId: string;
  type: MovementType;
  quantity: number;
  recordedByStaffMemberId?: string | null;
  reason?: string | null;
}

export interface StockMovementListItem extends StockMovement {
  itemName: string;
}

export interface StockMovementList {
  businessDay: CurrentOpenBusinessDay;
  movements: StockMovementListItem[];
}

export type RestockStatus =
  | 'URGENT'
  | 'LOW'
  | 'BELOW_PAR'
  | 'ENOUGH';

export interface RestockStatusRow {
  inventoryItemId: string;
  itemName: string;
  critical: boolean;
  countMethod: CountMethod;
  quantity: number | null;
  level: StockLevel | null;
  // Quantity-counted items carry a numeric par; level-counted items carry a
  // level-valued par. Exactly one side is populated, matching countMethod.
  par: number | null;
  parLevel: StockLevel | null;
  status: RestockStatus;
}

export interface RestockStatusResult {
  businessDay: CurrentOpenBusinessDay;
  hasCount: boolean;
  selectedPhase: StockCountPhase | null;
  selectedCountId: string | null;
  selectedCountRecordedAt: string | null;
  rows: RestockStatusRow[];
}

export interface PackagingReconciliationRow {
  inventoryItemId: string;
  itemName: string;
  openingQty: number | null;
  deliveriesQty: number;
  wastageQty: number;
  soldQty: number;
  expectedQty: number | null;
  actualQty: number | null;
  varianceQty: number | null;
}

export interface DailyInventoryReport {
  businessDate: string;
  locationId: string | null;
  hasInventoryInformation: boolean;
  reconciliation: PackagingReconciliationRow[];
  restock: RestockStatusResult;
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
  PWD = 'PWD',
  SENIOR = 'SENIOR',
}

export enum LinePreference {
  SWEETER = 'SWEETER',
  STRONGER = 'STRONGER',
  LESS_SWEET = 'LESS_SWEET',
  LESS_ICE = 'LESS_ICE',
}

export interface Order {
  id: string;
  clientGeneratedId: string;
  locationId: string | null;
  tradingDayId: string;
  cashierStaffMemberId: string | null;
  cashierNameSnapshot: string | null;
  kind: 'PURCHASE' | 'VOID';
  correctsSaleId: string | null;
  dayOrderNumber: number;
  status: OrderStatus;
  customerName: string | null;
  serviceType: ServiceType;
  subtotalCents: MoneyCents;
  discountCents: MoneyCents;
  freeUpsizeCents: MoneyCents;
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
  preferences: LinePreference[];
  preferenceNote: string | null;
  freeUpsizeCount: number;
  freeUpsizeCents: MoneyCents;
  freeUpsizeEligible: boolean;
  lineTotalCents: MoneyCents;
  productNameSnapshot: string;
  variantNameSnapshot: string;
}

export interface OrderLineInput {
  productVariantId: string;
  quantity?: number;
  discountKind?: LineDiscountKind;
  preferences?: LinePreference[];
  preferenceNote?: string | null;
  freeUpsizeCount?: number;
}

export interface CreateOrderInput extends OrderLineInput {
  clientGeneratedId: string;
  deviceId: string;
  customerName?: string | null;
  serviceType?: ServiceType;
}

export interface UpdateOrderInput {
  customerName?: string | null;
  serviceType?: ServiceType;
}

export interface UpdateOrderLineInput {
  quantity?: number;
  discountKind?: LineDiscountKind;
  preferences?: LinePreference[];
  preferenceNote?: string | null;
  freeUpsizeCount?: number;
}

export interface CompleteOrderInput {
  payments: Array<{
    method: PaymentMethod;
    amountCents: MoneyCents;
  }>;
  cashReceivedCents?: MoneyCents | null;
  cashTipCents?: MoneyCents;
  changeOwedCents?: MoneyCents;
}

export interface VoidOrderInput {
  clientGeneratedId: string;
  deviceId: string;
  voidReason: string;
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
  dayType: DayType;
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

export enum CashMovementKind {
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
  EXPENSE = 'EXPENSE',
}

export interface CashMovement {
  id: string;
  tradingDayId: string;
  kind: CashMovementKind;
  amountCents: MoneyCents;
  description: string;
  category: string | null;
  recordedByStaffMemberId: string | null;
  recordedByNameSnapshot: string | null;
  recordedAt: string;
}

export interface CreateCashMovementInput {
  clientGeneratedId: string;
  kind: CashMovementKind;
  amountCents: MoneyCents;
  description: string;
  category?: string | null;
  recordedByStaffMemberId?: string | null;
}

export interface CashMovementList {
  businessDay: CurrentOpenBusinessDay;
  movements: CashMovement[];
}

export interface DayClosing {
  id: string;
  tradingDayId: string;
  cashCountId: string;
  openingFloatCents: MoneyCents;
  cashSalesCents: MoneyCents;
  onlineSalesCents: MoneyCents;
  cashTipsCents: MoneyCents;
  cashInCents: MoneyCents;
  cashOutCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  outstandingChangeCents: MoneyCents;
  expectedCashCents: MoneyCents;
  actualCashCents: MoneyCents;
  varianceCents: MoneyCents;
  varianceReason: string | null;
  closedByStaffMemberId: string;
  closedByNameSnapshot: string;
  closedAt: string;
  lines: DayClosingLine[];
}

export interface DayClosingLine {
  id: string;
  dayClosingId: string;
  inventoryItemId: string;
  itemNameSnapshot: string;
  expectedQty: number | null;
  actualQty: number | null;
  varianceQty: number | null;
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
  cashInCents: MoneyCents;
  cashOutCents: MoneyCents;
  cashExpensesCents: MoneyCents;
  outstandingChangeCents: MoneyCents;
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
  discountCents: MoneyCents;
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

export interface StaffOrderLedgerQuery {
  status?: OrderHistoryStatus;
  paymentMethod?: OrderHistoryPaymentMethod;
  search?: string;
}

export interface StaffOrderLedgerOrder {
  id: string;
  clientGeneratedId: string;
  dayOrderNumber: number;
  customerName: string | null;
  cashierName: string | null;
  status: OrderHistoryStatus;
  paymentMethod: OrderHistoryPaymentMethod | null;
  completedAt: string | null;
  totalCents: MoneyCents;
  lines: OrderHistoryLine[];
  cashPortionCents: MoneyCents | null;
  onlinePortionCents: MoneyCents | null;
  cashReceivedCents: MoneyCents | null;
  expectedChangeCents: MoneyCents | null;
  voidReason: string | null;
  changeOwedCents: MoneyCents;
  changeSettled: boolean;
  changeSettledAt: string | null;
}

export interface StaffOrderLedger {
  businessDayId: string;
  orders: StaffOrderLedgerOrder[];
}
