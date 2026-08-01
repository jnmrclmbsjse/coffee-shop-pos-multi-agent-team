import type {
  ClearActiveCashierInput,
  SelectActiveCashierInput,
} from '@coffee-shop/shared';

export type SelectActiveCashierDto = Partial<SelectActiveCashierInput> & {
  pin?: unknown;
};

export type ClearActiveCashierDto = Partial<ClearActiveCashierInput>;
