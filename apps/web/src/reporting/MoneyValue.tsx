import { formatMoney } from './format';

export function MoneyValue({
  cents,
  unavailable = false,
  unavailableLabel,
  unavailableClassName = 'order-unavailable',
}: {
  cents: number | null;
  unavailable?: boolean;
  unavailableLabel?: string;
  unavailableClassName?: string;
}) {
  if (unavailable || cents === null) {
    return (
      <span
        className={unavailableClassName}
        aria-label={unavailableLabel}
      >
        —
      </span>
    );
  }

  return <>{formatMoney(cents)}</>;
}
