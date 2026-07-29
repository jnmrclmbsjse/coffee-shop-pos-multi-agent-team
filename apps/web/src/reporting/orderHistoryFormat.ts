import type {
  OrderHistoryListQuery,
  OrderHistoryPaymentMethod,
  OrderHistoryStatus,
  ServiceType,
} from '@coffee-shop/shared';

const STATUSES: OrderHistoryStatus[] = ['Parked', 'Completed', 'Void'];
const PAYMENT_METHODS: OrderHistoryPaymentMethod[] = [
  'Cash',
  'Online',
  'Split',
];
const SORTS = [
  'businessDay',
  'orderNumber',
  'status',
  'total',
  'completedAt',
] as const;
const PAGE_SIZES = [5, 10, 25, 50] as const;

export const DEFAULT_ORDER_HISTORY_QUERY: Required<
  Pick<OrderHistoryListQuery, 'sort' | 'direction' | 'page' | 'pageSize'>
> = {
  sort: 'businessDay',
  direction: 'desc',
  page: 1,
  pageSize: 10,
};

export function parseOrderHistoryQuery(
  params: URLSearchParams,
): OrderHistoryListQuery {
  const status = params.get('status');
  const paymentMethod = params.get('paymentMethod');
  const search = params.get('search')?.trim();
  const sort = params.get('sort');
  const direction = params.get('direction');
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('pageSize'));

  return {
    ...(STATUSES.includes(status as OrderHistoryStatus)
      ? { status: status as OrderHistoryStatus }
      : {}),
    ...(PAYMENT_METHODS.includes(paymentMethod as OrderHistoryPaymentMethod)
      ? { paymentMethod: paymentMethod as OrderHistoryPaymentMethod }
      : {}),
    ...(search ? { search } : {}),
    sort: SORTS.includes(sort as (typeof SORTS)[number])
      ? (sort as (typeof SORTS)[number])
      : DEFAULT_ORDER_HISTORY_QUERY.sort,
    direction:
      direction === 'asc' || direction === 'desc'
        ? direction
        : DEFAULT_ORDER_HISTORY_QUERY.direction,
    page: Number.isInteger(page) && page > 0
      ? page
      : DEFAULT_ORDER_HISTORY_QUERY.page,
    pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
      ? (pageSize as (typeof PAGE_SIZES)[number])
      : DEFAULT_ORDER_HISTORY_QUERY.pageSize,
  };
}

export function formatOrderHistoryPaymentMethod(
  method: OrderHistoryPaymentMethod | null,
): string {
  if (method === 'Split') return 'Split (Cash + Online)';
  return method ?? '—';
}

export function formatServiceType(serviceType: ServiceType): string {
  return serviceType === 'DINE_IN' ? 'Dine-in' : 'Take-out';
}

export function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
    timeZoneName: 'short',
  }).format(date);
}
