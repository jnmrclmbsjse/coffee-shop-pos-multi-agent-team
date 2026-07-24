import type { ReactNode } from 'react';

export function Icon({
  name,
  className,
}: {
  name:
    | 'alert'
    | 'box'
    | 'check'
    | 'chevron'
    | 'edit'
    | 'grid'
    | 'grip'
    | 'plus'
    | 'search'
    | 'trash';
  className?: string;
}) {
  const paths: Record<typeof name, ReactNode> = {
    alert: (
      <>
        <path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    box: (
      <>
        <path d="m4 7 8-4 8 4-8 4Z" />
        <path d="m4 7 8 4 8-4v10l-8 4-8-4Z" />
        <path d="M12 11v10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    grip: (
      <>
        {[6, 12, 18].flatMap((y) =>
          [9, 15].map((x) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r=".8" fill="currentColor" />
          )),
        )}
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5" />
      </>
    ),
  };

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'danger' | 'info' | 'success';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`catalog-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={tone === 'danger' ? 'alert' : 'check'} />
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

export function StateBadge({
  active,
  trueLabel,
  falseLabel,
}: {
  active: boolean;
  trueLabel: string;
  falseLabel: string;
}) {
  return (
    <span className={`state-badge ${active ? 'positive' : 'neutral'}`}>
      <span aria-hidden="true" />
      {active ? trueLabel : falseLabel}
    </span>
  );
}

export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className="catalog-switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function LoadingRows({ columns = 5 }: { columns?: number }) {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <tr className="skeleton-row" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <span />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
