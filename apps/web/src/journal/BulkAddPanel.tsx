import type {
  CreateJournalDepositInput,
  JournalMissingDay,
} from '@coffee-shop/shared';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Notice } from '../catalog/components';
import { formatBusinessDate, formatMoney } from '../reporting/format';
import { JournalApiError, createJournalDepositsBulk } from './api';
import { amountForInput, currencyToCents } from './domain';

export type BulkRowState = {
  selected: boolean;
  /**
   * Kept as a string so an empty field stays distinguishable from a typed `0`
   * (ADR 0018 §6). A `0` here is a real, savable ₱0 deposit.
   */
  amount: string;
  /** True once the administrator has typed over the server's suggestion. */
  dirty: boolean;
};

type BulkRowStates = Record<string, BulkRowState>;
type BulkRowErrors = Record<string, string>;

function defaultRowState(day: JournalMissingDay): BulkRowState {
  // `null` means the ledger offers no suggestion at all, so there is nothing to
  // prefill and nothing to tick on the administrator's behalf. A `0` suggestion
  // is a real suggestion and is prefilled and ticked like any other.
  const hasSuggestion = day.suggestedAmountCents !== null;
  return {
    selected: hasSuggestion,
    amount: hasSuggestion ? amountForInput(day.suggestedAmountCents!) : '',
    dirty: false,
  };
}

/**
 * Carry forward whatever the administrator has already ticked or typed, keyed by
 * business date. The list is refetched after every save and after a conflict, so
 * keying by array index would silently move amounts between days.
 */
function mergeRowStates(
  days: readonly JournalMissingDay[],
  current: BulkRowStates,
): BulkRowStates {
  const next: BulkRowStates = {};
  for (const day of days) {
    next[day.businessDate] =
      current[day.businessDate] ?? defaultRowState(day);
  }
  return next;
}

function suggestionLabel(day: JournalMissingDay, dirty: boolean): string {
  if (day.suggestedAmountCents === null) return 'No suggestion available';
  const amount = formatMoney(day.suggestedAmountCents);
  return dirty
    ? `Your amount replaces the ${amount} suggestion`
    : `${amount} suggested, not saved`;
}

const BulkAddRow = memo(function BulkAddRow({
  day,
  state,
  error,
  disabled,
  onToggle,
  onChangeAmount,
  onUseSuggestion,
}: {
  day: JournalMissingDay;
  state: BulkRowState;
  error?: string;
  disabled: boolean;
  onToggle: (businessDate: string, selected: boolean) => void;
  onChangeAmount: (businessDate: string, amount: string) => void;
  onUseSuggestion: (businessDate: string) => void;
}) {
  const amountId = `journal-bulk-amount-${day.businessDate}`;
  const errorId = `${amountId}-error`;
  const suggestionId = `${amountId}-suggestion`;
  const hasSuggestion = day.suggestedAmountCents !== null;
  const showChip = hasSuggestion && !state.dirty;

  return (
    <div className="journal-bulk-row">
      <label className="journal-bulk-check">
        <input
          type="checkbox"
          checked={state.selected}
          disabled={disabled}
          aria-label={`Include ${formatBusinessDate(day.businessDate)}`}
          onChange={(event) => onToggle(day.businessDate, event.target.checked)}
        />
        <span>{formatBusinessDate(day.businessDate)}</span>
      </label>
      <div className="journal-bulk-day">
        <strong>Gross {formatMoney(day.grossSalesCents)}</strong>
        {showChip ? (
          <span className="compensation-suggested" id={suggestionId}>
            {suggestionLabel(day, false)}
          </span>
        ) : hasSuggestion ? (
          <span className="journal-bulk-overridden" id={suggestionId}>
            {suggestionLabel(day, true)}{' '}
            <button
              className="table-action"
              type="button"
              disabled={disabled}
              onClick={() => onUseSuggestion(day.businessDate)}
            >
              Use suggestion
            </button>
          </span>
        ) : (
          <span className="journal-no-suggestion" id={suggestionId}>
            {suggestionLabel(day, false)}
          </span>
        )}
      </div>
      <div className="journal-bulk-amount">
        <label htmlFor={amountId}>Deposit amount</label>
        <div className="journal-money-input">
          <span aria-hidden="true">₱</span>
          <input
            id={amountId}
            inputMode="decimal"
            value={state.amount}
            disabled={disabled}
            aria-label={`Deposit amount for ${formatBusinessDate(day.businessDate)}`}
            aria-invalid={Boolean(error)}
            aria-describedby={[suggestionId, error ? errorId : '']
              .filter(Boolean)
              .join(' ')}
            onChange={(event) =>
              onChangeAmount(day.businessDate, event.target.value)
            }
          />
        </div>
        {error && (
          <p className="catalog-field-error" id={errorId}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
});

export function BulkAddPanel({
  ledgerId,
  ledgerName,
  startDate,
  days,
  loading,
  loadError,
  onRefresh,
  onSaved,
}: {
  ledgerId: string;
  ledgerName: string;
  startDate: string;
  days: JournalMissingDay[] | null;
  loading: boolean;
  loadError: string;
  onRefresh: () => void;
  onSaved: (savedCount: number) => void;
}) {
  const [rows, setRows] = useState<BulkRowStates>({});
  const [errors, setErrors] = useState<BulkRowErrors>({});
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState('');
  const [saving, setSaving] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRows((current) => mergeRowStates(days ?? [], current));
    setErrors({});
  }, [days]);

  const toggleRow = useCallback((businessDate: string, selected: boolean) => {
    setRows((current) => {
      const row = current[businessDate];
      if (!row) return current;
      return { ...current, [businessDate]: { ...row, selected } };
    });
    setConflict('');
    setFormError('');
  }, []);

  const changeAmount = useCallback((businessDate: string, amount: string) => {
    setRows((current) => {
      const row = current[businessDate];
      if (!row) return current;
      return { ...current, [businessDate]: { ...row, amount, dirty: true } };
    });
    setErrors((current) => {
      if (!(businessDate in current)) return current;
      const next = { ...current };
      delete next[businessDate];
      return next;
    });
    setConflict('');
    setFormError('');
  }, []);

  const useSuggestion = useCallback(
    (businessDate: string) => {
      const day = days?.find((entry) => entry.businessDate === businessDate);
      if (!day || day.suggestedAmountCents === null) return;
      setRows((current) => {
        const row = current[businessDate];
        if (!row) return current;
        return {
          ...current,
          [businessDate]: {
            ...row,
            amount: amountForInput(day.suggestedAmountCents!),
            dirty: false,
          },
        };
      });
      setErrors((current) => {
        if (!(businessDate in current)) return current;
        const next = { ...current };
        delete next[businessDate];
        return next;
      });
    },
    [days],
  );

  const visibleDays = days ?? [];
  const selectedDays = visibleDays.filter(
    (day) => rows[day.businessDate]?.selected,
  );
  const allSelected =
    visibleDays.length > 0 && selectedDays.length === visibleDays.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedDays.length > 0 && !allSelected;
    }
  }, [allSelected, selectedDays.length]);

  function toggleAll(selected: boolean) {
    setRows((current) => {
      const next: BulkRowStates = { ...current };
      for (const day of visibleDays) {
        const row = next[day.businessDate];
        if (row) next[day.businessDate] = { ...row, selected };
      }
      return next;
    });
    setConflict('');
    setFormError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setConflict('');
    setFormError('');

    if (selectedDays.length === 0) {
      setFormError('Tick at least one business day to save.');
      return;
    }

    const nextErrors: BulkRowErrors = {};
    const deposits: CreateJournalDepositInput[] = [];
    for (const day of selectedDays) {
      const amount = currencyToCents(
        rows[day.businessDate]!.amount,
        'Deposit amount',
        { allowZero: true },
      );
      if (amount.error !== undefined) {
        nextErrors[day.businessDate] = amount.error;
        continue;
      }
      // Unticked days never reach here: the server has no concept of a skipped
      // day, so they are simply absent from the payload (ADR 0018 §6). A ticked
      // row holding `0` is a real ₱0 deposit and is sent.
      deposits.push({
        businessDate: day.businessDate,
        amountCents: amount.cents,
      });
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      const first = selectedDays.find((day) => nextErrors[day.businessDate]);
      if (first) {
        requestAnimationFrame(() =>
          document
            .getElementById(`journal-bulk-amount-${first.businessDate}`)
            ?.focus(),
        );
      }
      return;
    }

    setSaving(true);
    try {
      await createJournalDepositsBulk(ledgerId, { deposits });
      onSaved(deposits.length);
    } catch (error) {
      if (error instanceof JournalApiError && error.status === 409) {
        // One transaction server-side: a day recorded between the page load and
        // the save rolls the whole batch back, so nothing at all was written.
        setConflict(
          `Another deposit was recorded for one of the selected business days, so nothing at all was saved. The list below has been refreshed — review your selections and save again.`,
        );
        onRefresh();
      } else {
        setFormError(
          error instanceof JournalApiError
            ? error.messages.join(' ')
            : 'The selected deposits could not be saved. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="journal-bulk-panel">
        <Notice tone="danger" title="Missing days could not be loaded">
          <p>{loadError}</p>
          <button className="catalog-button small" type="button" onClick={onRefresh}>
            Try again
          </button>
        </Notice>
      </div>
    );
  }

  return (
    <div className="journal-bulk-panel">
      <div className="journal-panel-head">
        <div>
          <h3>Bulk add deposits</h3>
          <p>
            Closed business days on or after{' '}
            {formatBusinessDate(startDate)} with no recorded deposit in{' '}
            {ledgerName}. Saving is all or nothing.
          </p>
        </div>
        <button
          className="catalog-button"
          type="button"
          disabled={loading || saving}
          onClick={onRefresh}
        >
          Refresh list
        </button>
      </div>

      {conflict && (
        <Notice tone="danger" title="Nothing was saved">
          <p>{conflict}</p>
        </Notice>
      )}
      {formError && (
        <Notice tone="danger" title="Deposits not saved">
          <p>{formError}</p>
        </Notice>
      )}

      {loading && days === null ? (
        <div className="journal-state-panel" aria-live="polite">
          <span className="spinner spinner-dark" aria-hidden="true" />
          <h3>Loading business days</h3>
          <p>Getting closed days with no recorded deposit.</p>
        </div>
      ) : visibleDays.length === 0 ? (
        <div className="catalog-empty journal-empty">
          <h3>No deposits to add</h3>
          <p>Every eligible closed business day has a recorded deposit.</p>
        </div>
      ) : (
        <form noValidate onSubmit={save}>
          <fieldset className="journal-bulk-fieldset" disabled={saving}>
            <legend className="sr-only">
              Closed business days with no recorded deposit
            </legend>
            <div className="journal-bulk-header">
              <label>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                Select all
              </label>
              <span className="results-meta" aria-live="polite">
                {selectedDays.length} of {visibleDays.length} selected
              </span>
            </div>
            <div className="journal-bulk-rows">
              {visibleDays.map((day) => (
                <BulkAddRow
                  key={day.businessDate}
                  day={day}
                  state={rows[day.businessDate] ?? defaultRowState(day)}
                  error={errors[day.businessDate]}
                  disabled={saving}
                  onToggle={toggleRow}
                  onChangeAmount={changeAmount}
                  onUseSuggestion={useSuggestion}
                />
              ))}
            </div>
          </fieldset>
          <div className="journal-bulk-actions">
            <button
              className="catalog-button primary"
              type="submit"
              disabled={saving || selectedDays.length === 0}
              aria-busy={saving}
            >
              {saving ? 'Saving selected deposits…' : 'Save selected deposits'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
