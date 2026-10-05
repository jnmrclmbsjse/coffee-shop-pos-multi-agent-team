import {
  JournalSuggestionKind,
  type JournalLedgerBalance,
  type JournalSuggestionRate,
  type UpdateJournalSuggestionRateInput,
} from '@coffee-shop/shared';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Notice } from '../catalog/components';
import {
  JournalApiError,
  getJournalSuggestionRate,
  updateJournalSuggestionRate,
} from './api';
import {
  amountForInput,
  basisPointsForInput,
  currencyToCents,
  percentToBasisPoints,
} from './domain';
import { trapDialogFocus } from './dialog';

type RateDraft = {
  rentPercent: string;
  chairAmount: string;
  chairThreshold: string;
};

type RateErrors = Partial<Record<keyof RateDraft, string>>;

const EMPTY_DRAFT: RateDraft = {
  rentPercent: '',
  chairAmount: '',
  chairThreshold: '',
};

function draftFromRate(rate: JournalSuggestionRate | null): RateDraft {
  if (!rate) return EMPTY_DRAFT;
  return {
    rentPercent:
      rate.rentPercentBasisPoints === null
        ? ''
        : basisPointsForInput(rate.rentPercentBasisPoints),
    chairAmount:
      rate.chairAmountCents === null ? '' : amountForInput(rate.chairAmountCents),
    chairThreshold:
      rate.chairThresholdCents === null
        ? ''
        : amountForInput(rate.chairThresholdCents),
  };
}

/**
 * Suggestion settings for one ledger. There is deliberately no effective-date
 * field: the server stamps the current calendar date and backdating is not
 * available (ADR 0018 §4). The Rent rounding rule is fixed and is explained as
 * text, never rendered as a control.
 */
export function SuggestionSettingsDialog({
  ledger,
  onClose,
  onSaved,
}: {
  ledger: JournalLedgerBalance;
  onClose: () => void;
  onSaved: (ledgerName: string) => void;
}) {
  const isRent =
    ledger.suggestionKind === JournalSuggestionKind.RENT_PERCENT_OF_ROUNDED_GROSS;
  const [draft, setDraft] = useState<RateDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<RateErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  // Focus the dialog itself, not a field: autofocusing a field on mount steals
  // the next programmatic fill (recorded hazard on the compensation modals).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    void getJournalSuggestionRate(ledger.id)
      .then((rate) => {
        if (!current) return;
        setDraft(draftFromRate(rate));
      })
      .catch(() => {
        if (current) {
          setLoadError(
            'The current suggestion settings could not be loaded. Close this dialog and try again.',
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [ledger.id]);

  function change(field: keyof RateDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  }

  function validate(): { errors: RateErrors; input?: UpdateJournalSuggestionRateInput } {
    const nextErrors: RateErrors = {};
    if (isRent) {
      const percent = percentToBasisPoints(draft.rentPercent);
      if (percent.error) {
        nextErrors.rentPercent = percent.error;
        return { errors: nextErrors };
      }
      return {
        errors: nextErrors,
        input: { rentPercentBasisPoints: percent.basisPoints },
      };
    }

    const amount = currencyToCents(draft.chairAmount, 'Chair amount', {
      allowZero: true,
    });
    if (amount.error) nextErrors.chairAmount = amount.error;
    const threshold = currencyToCents(
      draft.chairThreshold,
      'Chair gross threshold',
      { allowZero: true },
    );
    if (threshold.error) nextErrors.chairThreshold = threshold.error;
    if (Object.keys(nextErrors).length) return { errors: nextErrors };

    return {
      errors: nextErrors,
      input: {
        chairAmountCents: amount.cents,
        chairThresholdCents: threshold.cents,
      },
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || loadError) return;
    const { errors: nextErrors, input } = validate();
    if (!input) {
      setErrors(nextErrors);
      const first = (['rentPercent', 'chairAmount', 'chairThreshold'] as const).find(
        (field) => nextErrors[field],
      );
      requestAnimationFrame(() =>
        document.getElementById(`journal-rate-${first}`)?.focus(),
      );
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await updateJournalSuggestionRate(ledger.id, input);
      onSaved(ledger.name);
    } catch (error) {
      setFormError(
        error instanceof JournalApiError
          ? error.messages.join(' ')
          : 'The suggestion settings could not be saved. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!saving) onClose();
    } else {
      trapDialogFocus(event);
    }
  }

  return (
    <div
      className="inventory-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="inventory-modal staff-modal journal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-rate-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <header className="inventory-modal-head">
          <div>
            <h2 id="journal-rate-dialog-title">Suggestion settings</h2>
            <p>{ledger.name} ledger</p>
          </div>
          <button
            className="catalog-button small"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <form noValidate onSubmit={save}>
          {loadError && (
            <Notice tone="danger" title="Settings could not be loaded">
              <p>{loadError}</p>
            </Notice>
          )}
          {formError && (
            <Notice tone="danger" title="Settings not saved">
              <p>{formError}</p>
            </Notice>
          )}

          <p className="journal-rate-scope">
            Changes apply to business days on or after the calendar date of the
            change. Settings cannot be backdated, so earlier business days keep
            the suggestion that was in force on the day itself.
          </p>

          {loading ? (
            <div className="journal-state-panel" aria-live="polite">
              <span className="spinner spinner-dark" aria-hidden="true" />
              <p>Loading the current settings.</p>
            </div>
          ) : isRent ? (
            <div className="catalog-field journal-field-wide">
              <label htmlFor="journal-rate-rentPercent">
                Rent percentage <span aria-hidden="true">*</span>
              </label>
              <div className="journal-money-input">
                <input
                  id="journal-rate-rentPercent"
                  inputMode="decimal"
                  value={draft.rentPercent}
                  disabled={saving}
                  aria-invalid={Boolean(errors.rentPercent)}
                  aria-describedby={
                    errors.rentPercent
                      ? 'journal-rate-rentPercent-error journal-rate-rentPercent-help'
                      : 'journal-rate-rentPercent-help'
                  }
                  onChange={(event) => change('rentPercent', event.target.value)}
                />
                <span aria-hidden="true">%</span>
              </div>
              <p className="catalog-field-help" id="journal-rate-rentPercent-help">
                Up to 2 decimal places, from 0% to 100%. The Rent rounding rule is
                fixed and is not a setting.
              </p>
              {errors.rentPercent && (
                <p
                  className="catalog-field-error"
                  id="journal-rate-rentPercent-error"
                >
                  {errors.rentPercent}
                </p>
              )}
            </div>
          ) : (
            <div className="inventory-modal-grid">
              <div className="catalog-field">
                <label htmlFor="journal-rate-chairAmount">
                  Chair amount <span aria-hidden="true">*</span>
                </label>
                <div className="journal-money-input">
                  <span aria-hidden="true">₱</span>
                  <input
                    id="journal-rate-chairAmount"
                    inputMode="decimal"
                    value={draft.chairAmount}
                    disabled={saving}
                    aria-invalid={Boolean(errors.chairAmount)}
                    aria-describedby={
                      errors.chairAmount
                        ? 'journal-rate-chairAmount-error journal-rate-chairAmount-help'
                        : 'journal-rate-chairAmount-help'
                    }
                    onChange={(event) =>
                      change('chairAmount', event.target.value)
                    }
                  />
                </div>
                <p
                  className="catalog-field-help"
                  id="journal-rate-chairAmount-help"
                >
                  Suggested on a day whose gross reaches the threshold.
                </p>
                {errors.chairAmount && (
                  <p
                    className="catalog-field-error"
                    id="journal-rate-chairAmount-error"
                  >
                    {errors.chairAmount}
                  </p>
                )}
              </div>
              <div className="catalog-field">
                <label htmlFor="journal-rate-chairThreshold">
                  Chair gross threshold <span aria-hidden="true">*</span>
                </label>
                <div className="journal-money-input">
                  <span aria-hidden="true">₱</span>
                  <input
                    id="journal-rate-chairThreshold"
                    inputMode="decimal"
                    value={draft.chairThreshold}
                    disabled={saving}
                    aria-invalid={Boolean(errors.chairThreshold)}
                    aria-describedby={
                      errors.chairThreshold
                        ? 'journal-rate-chairThreshold-error journal-rate-chairThreshold-help'
                        : 'journal-rate-chairThreshold-help'
                    }
                    onChange={(event) =>
                      change('chairThreshold', event.target.value)
                    }
                  />
                </div>
                <p
                  className="catalog-field-help"
                  id="journal-rate-chairThreshold-help"
                >
                  A day below this gross suggests ₱0.00, which is still a real
                  suggestion.
                </p>
                {errors.chairThreshold && (
                  <p
                    className="catalog-field-error"
                    id="journal-rate-chairThreshold-error"
                  >
                    {errors.chairThreshold}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="inventory-modal-actions">
            <span />
            <button
              className="catalog-button"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="catalog-button primary"
              type="submit"
              disabled={saving || loading || Boolean(loadError)}
              aria-busy={saving}
            >
              {saving ? 'Saving settings…' : 'Save settings'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
