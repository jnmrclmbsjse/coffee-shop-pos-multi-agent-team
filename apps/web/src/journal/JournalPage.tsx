import {
  JournalSuggestionKind,
  type JournalDeposit,
  type JournalLedgerBalance,
  type JournalMissingDay,
  type JournalWithdrawal,
} from '@coffee-shop/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon, LoadingRows, Notice } from '../catalog/components';
import { MoneyValue } from '../reporting/MoneyValue';
import { formatBusinessDate, formatMoney, shopDate } from '../reporting/format';
import {
  JournalApiError,
  createJournalDeposit,
  createJournalLedger,
  createJournalWithdrawal,
  deleteJournalDeposit,
  deleteJournalWithdrawal,
  getJournalLedger,
  listJournalLedgers,
  listJournalMissingDays,
  updateJournalDeposit,
  updateJournalWithdrawal,
  type JournalLedgerDetail,
} from './api';
import { BulkAddPanel } from './BulkAddPanel';
import { SuggestionSettingsDialog } from './SuggestionSettingsDialog';
import { trapDialogFocus } from './dialog';
import { amountForInput, currencyToCents } from './domain';

type EntryKind = 'deposit' | 'withdrawal';
type Section = 'activity' | 'bulk';
/**
 * `amountSource` is the one record of whether the amount field still holds the
 * server's suggestion or the administrator's own figure — the same role
 * `suggestionSource` / `suggestionDirty` play on CompensationPage, collapsed into
 * the single radio control the Design Reference asks for.
 */
type AmountSource = 'suggested' | 'manual';
type EntryDraft = {
  kind: EntryKind;
  id?: string;
  date: string;
  amount: string;
  note: string;
  amountSource: AmountSource;
};
type EntryErrors = Partial<Record<'date' | 'amount', string>>;
type LedgerDraft = {
  name: string;
  startDate: string;
  startingBalance: string;
};
type LedgerErrors = Partial<
  Record<'name' | 'startDate' | 'startingBalance', string>
>;
type DeleteTarget =
  | { kind: 'deposit'; entry: JournalDeposit }
  | { kind: 'withdrawal'; entry: JournalWithdrawal };
type Activity =
  | { kind: 'deposit'; date: string; recordedAt: string; entry: JournalDeposit }
  | {
      kind: 'withdrawal';
      date: string;
      recordedAt: string;
      entry: JournalWithdrawal;
    }
  | {
      kind: 'outstanding';
      date: string;
      recordedAt: string;
      day: JournalMissingDay;
    };

const EMPTY_LEDGER_DRAFT: LedgerDraft = {
  name: '',
  startDate: '',
  startingBalance: '',
};

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof JournalApiError
    ? error.messages.join(' ')
    : fallback;
}

function activityRows(
  detail: JournalLedgerDetail | null,
  missingDays: JournalMissingDay[] | null,
): Activity[] {
  if (!detail) return [];
  return [
    // Outstanding closed days come from the server's missing-days list, so a day
    // the server did not return is simply absent — never a locally derived row.
    ...(missingDays ?? []).map(
      (day): Activity => ({
        kind: 'outstanding',
        date: day.businessDate,
        recordedAt: '',
        day,
      }),
    ),
    ...detail.deposits.map(
      (entry): Activity => ({
        kind: 'deposit',
        date: entry.businessDate,
        recordedAt: entry.recordedAt,
        entry,
      }),
    ),
    ...detail.withdrawals.map(
      (entry): Activity => ({
        kind: 'withdrawal',
        date: entry.withdrawnOn,
        recordedAt: entry.recordedAt,
        entry,
      }),
    ),
  ].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.recordedAt.localeCompare(left.recordedAt),
  );
}

export function JournalPage() {
  const [ledgers, setLedgers] = useState<JournalLedgerBalance[]>([]);
  const [selectedLedgerId, setSelectedLedgerId] = useState('');
  const [detail, setDetail] = useState<JournalLedgerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRequest, setDetailRequest] = useState(0);
  const [section, setSection] = useState<Section>('activity');
  const [missingDays, setMissingDays] = useState<JournalMissingDay[] | null>(null);
  const [missingDaysLoading, setMissingDaysLoading] = useState(false);
  const [missingDaysError, setMissingDaysError] = useState('');
  const [missingDaysRequest, setMissingDaysRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [ledgerDraft, setLedgerDraft] = useState<LedgerDraft | null>(null);
  const [ledgerErrors, setLedgerErrors] = useState<LedgerErrors>({});
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [entryErrors, setEntryErrors] = useState<EntryErrors>({});
  const [modalError, setModalError] = useState('');
  const [conflict, setConflict] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);

  const activity = useMemo(
    () => activityRows(detail, missingDays),
    [detail, missingDays],
  );
  const selectedLedger = useMemo(
    () => ledgers.find((ledger) => ledger.id === selectedLedgerId) ?? null,
    [ledgers, selectedLedgerId],
  );
  // ADR 0018 §4: a fully manual ledger has no rate and `PUT` refuses it, so the
  // settings affordance is not offered for one at all.
  const canEditRate =
    selectedLedger !== null &&
    selectedLedger.suggestionKind !== JournalSuggestionKind.NONE;

  async function loadLedgers(preferredId?: string) {
    setLoading(true);
    setPageError('');
    try {
      const nextLedgers = await listJournalLedgers();
      setLedgers(nextLedgers);
      setSelectedLedgerId((current) => {
        const candidate = preferredId ?? current;
        return nextLedgers.some((ledger) => ledger.id === candidate)
          ? candidate
          : (nextLedgers[0]?.id ?? '');
      });
    } catch {
      setPageError('Journal could not be loaded. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = 'Journal · UCM Coffee Studio';
    void loadLedgers();
  }, []);

  useEffect(() => {
    if (!selectedLedgerId) {
      setDetail(null);
      return;
    }
    let current = true;
    setDetailLoading(true);
    setDetailError('');
    void getJournalLedger(selectedLedgerId)
      .then((nextDetail) => {
        if (current) setDetail(nextDetail);
      })
      .catch(() => {
        if (current) {
          setDetailError('This ledger could not be loaded. Check the connection and try again.');
          setDetail(null);
        }
      })
      .finally(() => {
        if (current) setDetailLoading(false);
      });
    return () => {
      current = false;
    };
  }, [detailRequest, selectedLedgerId]);

  useEffect(() => {
    if (!selectedLedgerId) {
      setMissingDays(null);
      return;
    }
    let current = true;
    setMissingDaysLoading(true);
    setMissingDaysError('');
    void listJournalMissingDays(selectedLedgerId)
      .then((days) => {
        if (current) setMissingDays(days);
      })
      .catch(() => {
        if (current) {
          setMissingDaysError(
            'Closed business days could not be loaded. Check the connection and try again.',
          );
          setMissingDays(null);
        }
      })
      .finally(() => {
        if (current) setMissingDaysLoading(false);
      });
    return () => {
      current = false;
    };
  }, [missingDaysRequest, selectedLedgerId]);

  useEffect(() => {
    if (ledgerDraft || entryDraft) {
      dialogRef.current?.focus();
    }
  }, [entryDraft !== null, ledgerDraft !== null]);

  useEffect(() => {
    if (deleteTarget) {
      deleteCancelRef.current?.focus();
    }
  }, [deleteTarget]);

  function rememberFocus() {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  function returnFocus() {
    requestAnimationFrame(() => {
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      } else {
        workspaceHeadingRef.current?.focus();
      }
    });
  }

  function openAddLedger() {
    rememberFocus();
    setLedgerDraft({ ...EMPTY_LEDGER_DRAFT, startDate: shopDate() });
    setLedgerErrors({});
    setModalError('');
    setConflict('');
  }

  function closeLedgerEditor() {
    if (saving) return;
    setLedgerDraft(null);
    setLedgerErrors({});
    setModalError('');
    setConflict('');
    returnFocus();
  }

  /**
   * The suggestion for a deposit draft's business day, straight from the server's
   * missing-days list. A day the server did not return — an open day, a date with
   * no trading day, or a day that already has a deposit — has no entry here and
   * gets no suggestion. Nothing is computed in the browser (ADR 0018 §5).
   */
  function suggestionFor(businessDate: string): JournalMissingDay | null {
    return (
      missingDays?.find((day) => day.businessDate === businessDate) ?? null
    );
  }

  function openNewEntry(kind: EntryKind, businessDate?: string) {
    if (!detail) return;
    rememberFocus();
    // Default a deposit to the most recent outstanding closed day: today is
    // normally still open and therefore not depositable.
    const date =
      kind === 'deposit'
        ? (businessDate ?? missingDays?.at(-1)?.businessDate ?? shopDate())
        : shopDate();
    const suggested =
      kind === 'deposit' ? suggestionFor(date)?.suggestedAmountCents : undefined;
    setEntryDraft({
      kind,
      date,
      amount:
        suggested === undefined || suggested === null
          ? ''
          : amountForInput(suggested),
      note: '',
      amountSource: 'suggested',
    });
    setEntryErrors({});
    setModalError('');
    setConflict('');
  }

  function changeEntryDate(date: string) {
    if (!entryDraft) return;
    setEntryErrors((current) => ({ ...current, date: undefined }));
    setConflict('');
    if (entryDraft.kind !== 'deposit' || entryDraft.amountSource === 'manual') {
      setEntryDraft({ ...entryDraft, date });
      return;
    }
    // Still on the suggestion, so follow the new day's suggestion. An absent or
    // `null` suggestion empties the field rather than writing ₱0.00 into it.
    const suggested = suggestionFor(date)?.suggestedAmountCents;
    setEntryDraft({
      ...entryDraft,
      date,
      amount:
        suggested === undefined || suggested === null
          ? ''
          : amountForInput(suggested),
    });
  }

  function changeEntryAmount(amount: string) {
    if (!entryDraft) return;
    setEntryDraft({ ...entryDraft, amount, amountSource: 'manual' });
    setEntryErrors((current) => ({ ...current, amount: undefined }));
  }

  function changeAmountSource(source: AmountSource) {
    if (!entryDraft) return;
    const suggested = suggestionFor(entryDraft.date)?.suggestedAmountCents;
    setEntryDraft({
      ...entryDraft,
      amountSource: source,
      ...(source === 'suggested' && suggested !== undefined && suggested !== null
        ? { amount: amountForInput(suggested) }
        : {}),
    });
    setEntryErrors((current) => ({ ...current, amount: undefined }));
  }

  function openEditDeposit(entry: JournalDeposit) {
    rememberFocus();
    setEntryDraft({
      kind: 'deposit',
      id: entry.id,
      date: entry.businessDate,
      amount: amountForInput(entry.amountCents),
      note: entry.note ?? '',
      amountSource: 'manual',
    });
    setEntryErrors({});
    setModalError('');
    setConflict('');
  }

  function openEditWithdrawal(entry: JournalWithdrawal) {
    rememberFocus();
    setEntryDraft({
      kind: 'withdrawal',
      id: entry.id,
      date: entry.withdrawnOn,
      amount: amountForInput(entry.amountCents),
      note: entry.note ?? '',
      amountSource: 'manual',
    });
    setEntryErrors({});
    setModalError('');
    setConflict('');
  }

  function closeEntryEditor() {
    if (saving) return;
    setEntryDraft(null);
    setEntryErrors({});
    setModalError('');
    setConflict('');
    returnFocus();
  }

  function openDelete(target: DeleteTarget) {
    rememberFocus();
    setDeleteTarget(target);
    setNotice('');
    setPageError('');
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    returnFocus();
  }

  async function refreshSelectedLedger() {
    if (!selectedLedgerId) return;
    const [nextLedgers, nextDetail] = await Promise.all([
      listJournalLedgers(),
      getJournalLedger(selectedLedgerId),
    ]);
    setLedgers(nextLedgers);
    setDetail(nextDetail);
    // Recorded-ness has changed, so which days are still missing has too.
    refreshMissingDays();
  }

  function refreshMissingDays() {
    setMissingDaysRequest((request) => request + 1);
  }

  function openSettings() {
    rememberFocus();
    setSettingsOpen(true);
    setNotice('');
    setPageError('');
  }

  function closeSettings() {
    setSettingsOpen(false);
    returnFocus();
  }

  function validateLedger(): LedgerErrors {
    if (!ledgerDraft) return {};
    const errors: LedgerErrors = {};
    if (!ledgerDraft.name.trim()) errors.name = 'Enter a ledger name.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ledgerDraft.startDate)) {
      errors.startDate = 'Choose a valid start date.';
    }
    if (ledgerDraft.startingBalance.trim() !== '') {
      const result = currencyToCents(
        ledgerDraft.startingBalance,
        'Starting balance',
        { allowZero: true, allowNegative: true },
      );
      if (result.error) errors.startingBalance = result.error;
    }
    return errors;
  }

  async function saveLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ledgerDraft || saving) return;
    const errors = validateLedger();
    if (Object.keys(errors).length) {
      setLedgerErrors(errors);
      const first = (['name', 'startDate', 'startingBalance'] as const).find(
        (field) => errors[field],
      );
      requestAnimationFrame(() =>
        document.getElementById(`journal-ledger-${first}`)?.focus(),
      );
      return;
    }

    const balance =
      ledgerDraft.startingBalance.trim() === ''
        ? undefined
        : currencyToCents(ledgerDraft.startingBalance, 'Starting balance', {
            allowZero: true,
            allowNegative: true,
          }).cents;
    setSaving(true);
    setModalError('');
    setConflict('');
    try {
      const created = await createJournalLedger({
        name: ledgerDraft.name.trim(),
        startDate: ledgerDraft.startDate,
        ...(balance !== undefined ? { startingBalanceCents: balance } : {}),
      });
      setLedgerDraft(null);
      setNotice(`${created.name} ledger was added.`);
      await loadLedgers(created.id);
      returnFocus();
    } catch (error) {
      if (error instanceof JournalApiError && error.status === 409) {
        setConflict(
          `A ledger named “${ledgerDraft.name.trim()}” already exists. Names must be unique, regardless of letter case.`,
        );
      } else {
        setModalError(apiMessage(error, 'The ledger could not be added. Try again.'));
      }
    } finally {
      setSaving(false);
    }
  }

  function validateEntry(): EntryErrors {
    if (!entryDraft || !detail) return {};
    const errors: EntryErrors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDraft.date)) {
      errors.date = `Choose a valid ${entryDraft.kind === 'deposit' ? 'business day' : 'withdrawal date'}.`;
    } else if (entryDraft.kind === 'deposit' && entryDraft.date < detail.startDate) {
      errors.date = `Choose a business day on or after ${formatBusinessDate(detail.startDate)}.`;
    }
    const amount = currencyToCents(
      entryDraft.amount,
      entryDraft.kind === 'deposit' ? 'Deposit amount' : 'Withdrawal amount',
      { allowZero: entryDraft.kind === 'deposit' },
    );
    if (amount.error) errors.amount = amount.error;
    return errors;
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryDraft || !detail || saving) return;
    const errors = validateEntry();
    if (Object.keys(errors).length) {
      setEntryErrors(errors);
      const first = (['date', 'amount'] as const).find((field) => errors[field]);
      requestAnimationFrame(() =>
        document.getElementById(`journal-entry-${first}`)?.focus(),
      );
      return;
    }

    const amount = currencyToCents(
      entryDraft.amount,
      entryDraft.kind === 'deposit' ? 'Deposit amount' : 'Withdrawal amount',
      { allowZero: entryDraft.kind === 'deposit' },
    ).cents!;
    setSaving(true);
    setModalError('');
    setConflict('');
    setNotice('');
    try {
      if (entryDraft.kind === 'deposit') {
        const input = {
          businessDate: entryDraft.date,
          amountCents: amount,
          note: entryDraft.note.trim() || null,
        };
        if (entryDraft.id) await updateJournalDeposit(entryDraft.id, input);
        else await createJournalDeposit(detail.id, input);
      } else {
        const input = {
          withdrawnOn: entryDraft.date,
          amountCents: amount,
          note: entryDraft.note.trim() || null,
        };
        if (entryDraft.id) await updateJournalWithdrawal(entryDraft.id, input);
        else await createJournalWithdrawal(detail.id, input);
      }
      const action = entryDraft.id ? 'updated' : 'recorded';
      const label = entryDraft.kind === 'deposit' ? 'Deposit' : 'Withdrawal';
      setEntryDraft(null);
      await refreshSelectedLedger();
      setNotice(`${label} ${formatMoney(amount)} was ${action}.`);
      returnFocus();
    } catch (error) {
      if (
        entryDraft.kind === 'deposit' &&
        error instanceof JournalApiError &&
        error.status === 409
      ) {
        setConflict(
          `${detail.name} already has a deposit for ${formatBusinessDate(entryDraft.date)}. The existing deposit was not changed.`,
        );
      } else if (
        error instanceof JournalApiError &&
        error.status === 400 &&
        error.field === 'businessDate'
      ) {
        setEntryErrors({
          date: 'Choose a closed business day on or after the ledger start date.',
        });
      } else {
        setModalError(
          apiMessage(
            error,
            `The ${entryDraft.kind} could not be saved. Try again.`,
          ),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setPageError('');
    try {
      if (deleteTarget.kind === 'deposit') {
        await deleteJournalDeposit(deleteTarget.entry.id);
      } else {
        await deleteJournalWithdrawal(deleteTarget.entry.id);
      }
      const label = deleteTarget.kind === 'deposit' ? 'Deposit' : 'Withdrawal';
      setDeleteTarget(null);
      await refreshSelectedLedger();
      setNotice(`${label} was deleted.`);
      returnFocus();
    } catch (error) {
      setDeleteTarget(null);
      setPageError(
        apiMessage(error, 'The Journal entry could not be deleted. Try again.'),
      );
    } finally {
      setDeleting(false);
    }
  }

  const depositSuggestion =
    entryDraft && entryDraft.kind === 'deposit'
      ? suggestionFor(entryDraft.date)
      : null;
  // An explicit `!== null` check: a ₱0 suggestion is a real suggestion and is
  // offered, prefilled and savable like any other (ADR 0018 §6).
  const hasDepositSuggestion =
    depositSuggestion !== null &&
    depositSuggestion.suggestedAmountCents !== null;
  const depositDayAlreadyRecorded =
    entryDraft !== null &&
    entryDraft.kind === 'deposit' &&
    (detail?.deposits ?? []).some(
      (deposit) =>
        deposit.businessDate === entryDraft.date &&
        deposit.id !== entryDraft.id,
    );

  return (
    <main className="catalog-page journal-page">
      <header className="catalog-page-head">
        <div>
          <h1>Journal</h1>
          <p>Track set-aside funds across closed business days.</p>
        </div>
        <div className="journal-page-actions">
          {canEditRate && (
            <button
              className="catalog-button"
              type="button"
              onClick={openSettings}
            >
              Suggestion settings
            </button>
          )}
          <button
            className="catalog-button primary"
            type="button"
            onClick={openAddLedger}
          >
            <Icon name="plus" />
            Add ledger
          </button>
        </div>
      </header>

      {notice && (
        <Notice tone="success" title="Journal updated">
          <p>{notice}</p>
        </Notice>
      )}
      {pageError && (
        <Notice tone="danger" title="Journal could not be loaded">
          <p>{pageError}</p>
          <button
            className="catalog-button small"
            type="button"
            onClick={() => void loadLedgers(selectedLedgerId)}
          >
            Try again
          </button>
        </Notice>
      )}

      {loading && ledgers.length === 0 ? (
        <section className="catalog-panel journal-state-panel" aria-live="polite">
          <span className="spinner spinner-dark" aria-hidden="true" />
          <h2>Loading Journal</h2>
          <p>Getting ledgers and activity records.</p>
        </section>
      ) : ledgers.length === 0 ? (
        <section className="catalog-panel catalog-empty journal-state-panel">
          <Icon name="wallet" />
          <h2>No ledgers yet</h2>
          <p>Add a ledger to begin recording deposits and withdrawals.</p>
          <button className="catalog-button" type="button" onClick={openAddLedger}>
            Add ledger
          </button>
        </section>
      ) : (
        <div className="journal-layout">
          <aside className="catalog-panel journal-ledger-panel" aria-labelledby="journal-ledgers-title">
            <header className="journal-panel-head">
              <div>
                <h2 id="journal-ledgers-title">Ledgers</h2>
                <p aria-live="polite">
                  {ledgers.length} {ledgers.length === 1 ? 'ledger' : 'ledgers'}
                </p>
              </div>
            </header>
            <div className="journal-ledger-list">
              {ledgers.map((ledger) => (
                <button
                  className="journal-ledger-row"
                  type="button"
                  aria-current={ledger.id === selectedLedgerId ? 'true' : undefined}
                  key={ledger.id}
                  onClick={() => {
                    setNotice('');
                    setSelectedLedgerId(ledger.id);
                  }}
                >
                  <span>
                    <strong>{ledger.name}</strong>
                    <small>From {formatBusinessDate(ledger.startDate, 'short')}</small>
                  </span>
                  <span
                    className={`num${ledger.balanceCents < 0 ? ' variance-short' : ''}`}
                  >
                    <MoneyValue cents={ledger.balanceCents} />
                    {ledger.balanceCents < 0 && <small>Negative</small>}
                  </span>
                </button>
              ))}
            </div>
            <div className="journal-status-guide">
              <h3>Recording status</h3>
              <p>
                <strong>A saved ₱0.00 deposit</strong>
                <span>
                  A real deposit. Its business day is recorded in this ledger and
                  is no longer outstanding.
                </span>
              </p>
              <p>
                <strong>A ₱0.00 suggestion</strong>
                <span>
                  A real suggestion, offered when the day's gross is below the
                  threshold. Nothing is recorded until it is saved.
                </span>
              </p>
              <p>
                <strong>No suggestion at all</strong>
                <span>
                  A fully manual ledger suggests nothing. That is not the same as
                  a suggestion of ₱0.00.
                </span>
              </p>
              <p>
                <strong>An open business day</strong>
                <span>
                  Not eligible for a deposit, carries no suggestion, and is absent
                  from Bulk add.
                </span>
              </p>
            </div>
          </aside>

          <section className="catalog-panel journal-workspace" aria-labelledby="journal-workspace-title">
            {detailError ? (
              <div className="journal-state-panel">
                <Notice tone="danger" title="Ledger could not be loaded">
                  <p>{detailError}</p>
                  <button
                    className="catalog-button small"
                    type="button"
                    onClick={() => setDetailRequest((request) => request + 1)}
                  >
                    Try again
                  </button>
                </Notice>
              </div>
            ) : detailLoading || !detail || detail.id !== selectedLedgerId ? (
              <div className="journal-state-panel" aria-live="polite">
                <span className="spinner spinner-dark" aria-hidden="true" />
                <h2>Loading ledger</h2>
                <p>Getting the latest balance and activity.</p>
              </div>
            ) : (
              <>
                <header className="journal-summary">
                  <div className="journal-summary-copy">
                    <span>Selected ledger</span>
                    <h2
                      id="journal-workspace-title"
                      ref={workspaceHeadingRef}
                      tabIndex={-1}
                    >
                      {detail.name}
                    </h2>
                    <p>Started {formatBusinessDate(detail.startDate)}</p>
                  </div>
                  <dl className="report-metric" aria-live="polite">
                    <dt>Current balance</dt>
                    <dd className={detail.balanceCents < 0 ? 'variance-short' : undefined}>
                      <MoneyValue cents={detail.balanceCents} />
                    </dd>
                    <span>
                      {detail.balanceCents < 0
                        ? 'Negative balance'
                        : `Starting balance ${formatMoney(detail.startingBalanceCents)}`}
                    </span>
                  </dl>
                </header>

                <nav className="compensation-sections" aria-label="Journal sections">
                  <button
                    type="button"
                    aria-current={section === 'activity' ? 'page' : undefined}
                    onClick={() => setSection('activity')}
                  >
                    Activity
                  </button>
                  <button
                    type="button"
                    aria-current={section === 'bulk' ? 'page' : undefined}
                    onClick={() => setSection('bulk')}
                  >
                    Bulk add
                  </button>
                </nav>

                {section === 'bulk' ? (
                  <BulkAddPanel
                    ledgerId={detail.id}
                    ledgerName={detail.name}
                    startDate={detail.startDate}
                    days={missingDays}
                    loading={missingDaysLoading}
                    loadError={missingDaysError}
                    onRefresh={refreshMissingDays}
                    onSaved={(savedCount) => {
                      setNotice(
                        `${savedCount} ${savedCount === 1 ? 'deposit was' : 'deposits were'} recorded.`,
                      );
                      void refreshSelectedLedger();
                    }}
                  />
                ) : (
                  <>
                  <div className="journal-panel-head">
                    <div>
                      <h3>Activity</h3>
                      <p aria-live="polite">
                        {activity.length}{' '}
                        {activity.length === 1
                          ? 'record or outstanding day'
                          : 'records and outstanding days'}
                      </p>
                    </div>
                    <div className="journal-toolbar">
                      <button
                        className="catalog-button"
                        type="button"
                        onClick={() => openNewEntry('withdrawal')}
                      >
                        Record withdrawal
                      </button>
                      <button
                        className="catalog-button primary"
                        type="button"
                        onClick={() => openNewEntry('deposit')}
                      >
                        Record deposit
                      </button>
                    </div>
                  </div>

                  {activity.length === 0 ? (
                    <div className="catalog-empty journal-empty">
                      <Icon name="document" />
                      <h3>No activity yet</h3>
                      <p>Record a deposit or withdrawal to begin this ledger.</p>
                    </div>
                  ) : (
                    <>
                      <p className="report-scroll-hint">Scroll horizontally to view all columns.</p>
                      <div
                        className="report-table-region journal-table-region"
                        tabIndex={0}
                        role="region"
                        aria-label={`${detail.name} ledger activity, scroll horizontally to view all columns`}
                      >
                        <table className="report-table journal-activity-table">
                          <caption className="sr-only">
                            Deposits and withdrawals, newest date first
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col" aria-sort="descending">Date</th>
                              <th scope="col">Type</th>
                              <th className="num" scope="col">Amount</th>
                              <th scope="col">Suggestion</th>
                              <th scope="col">Note</th>
                              <th scope="col">Status</th>
                              <th scope="col"><span className="sr-only">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailLoading ? (
                              <LoadingRows columns={7} />
                            ) : (
                              activity.map((row) =>
                                row.kind === 'outstanding' ? (
                                  <tr key={`outstanding-${row.date}`}>
                                    <td>{formatBusinessDate(row.date)}</td>
                                    <td>
                                      <span className="journal-entry-kind outstanding">
                                        Outstanding day
                                      </span>
                                    </td>
                                    <td className="num">
                                      <span className="journal-not-recorded">
                                        Not recorded
                                      </span>
                                    </td>
                                    <td>
                                      {row.day.suggestedAmountCents === null ? (
                                        <span className="journal-no-suggestion">
                                          No suggestion available
                                        </span>
                                      ) : (
                                        <span className="compensation-suggested">
                                          {formatMoney(row.day.suggestedAmountCents)}{' '}
                                          suggested, not saved
                                        </span>
                                      )}
                                    </td>
                                    <td className="journal-note">
                                      <span className="journal-no-note">
                                        Gross {formatMoney(row.day.grossSalesCents)}
                                      </span>
                                    </td>
                                    <td>Needs review</td>
                                    <td className="table-action">
                                      <div className="journal-row-actions">
                                        <button
                                          className="catalog-button small"
                                          type="button"
                                          aria-label={`Record deposit for ${formatBusinessDate(row.date)}`}
                                          onClick={() =>
                                            openNewEntry('deposit', row.date)
                                          }
                                        >
                                          Record deposit
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                <tr key={`${row.kind}-${row.entry.id}`}>
                                  <td>{formatBusinessDate(row.date)}</td>
                                  <td>
                                    <span className={`journal-entry-kind ${row.kind}`}>
                                      {row.kind === 'deposit' ? 'Deposit' : 'Withdrawal'}
                                    </span>
                                  </td>
                                  <td className="num">
                                    {row.kind === 'withdrawal' ? '−' : ''}
                                    <MoneyValue cents={row.entry.amountCents} />
                                  </td>
                                  <td>
                                    <span className="journal-no-suggestion">
                                      {row.kind === 'deposit'
                                        ? 'Saved amount'
                                        : 'Not applicable'}
                                    </span>
                                  </td>
                                  <td className="journal-note">
                                    {row.entry.note ?? <span className="journal-no-note">No note</span>}
                                  </td>
                                  <td>
                                    {row.kind === 'withdrawal'
                                      ? 'Saved withdrawal'
                                      : 'Recorded in ledger'}
                                    {row.kind === 'deposit' && row.entry.amountCents === 0 && (
                                      <small className="journal-zero-label">Saved ₱0.00 deposit</small>
                                    )}
                                  </td>
                                  <td className="table-action">
                                    <div className="journal-row-actions">
                                      <button
                                        className="catalog-button small"
                                        type="button"
                                        aria-label={`Edit ${row.kind} from ${formatBusinessDate(row.date)}`}
                                        onClick={() =>
                                          row.kind === 'deposit'
                                            ? openEditDeposit(row.entry)
                                            : openEditWithdrawal(row.entry)
                                        }
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="catalog-button small danger"
                                        type="button"
                                        aria-label={`Delete ${row.kind} from ${formatBusinessDate(row.date)}`}
                                        onClick={() =>
                                          openDelete(
                                            row.kind === 'deposit'
                                              ? { kind: 'deposit', entry: row.entry }
                                              : { kind: 'withdrawal', entry: row.entry },
                                          )
                                        }
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                ),
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {ledgerDraft && (
        <div className="inventory-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeLedgerEditor();
        }}>
          <section
            ref={dialogRef}
            className="inventory-modal staff-modal journal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-ledger-dialog-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeLedgerEditor();
              else trapDialogFocus(event);
            }}
          >
            <header className="inventory-modal-head">
              <div>
                <h2 id="journal-ledger-dialog-title">Add ledger</h2>
                <p>Create a manual set-aside fund ledger.</p>
              </div>
              <button className="catalog-button small" type="button" disabled={saving} onClick={closeLedgerEditor}>Close</button>
            </header>
            <form noValidate onSubmit={saveLedger}>
              {conflict && <Notice tone="danger" title="Ledger not added"><p>{conflict}</p></Notice>}
              {modalError && <Notice tone="danger" title="Ledger not added"><p>{modalError}</p></Notice>}
              <div className="catalog-field journal-field-wide">
                <label htmlFor="journal-ledger-name">Ledger name <span aria-hidden="true">*</span></label>
                <input id="journal-ledger-name" value={ledgerDraft.name} disabled={saving} aria-invalid={Boolean(ledgerErrors.name)} aria-describedby={ledgerErrors.name ? 'journal-ledger-name-error journal-ledger-name-help' : 'journal-ledger-name-help'} onChange={(event) => {
                  setLedgerDraft({ ...ledgerDraft, name: event.target.value });
                  setLedgerErrors((current) => ({ ...current, name: undefined }));
                  setConflict('');
                }} />
                <p className="catalog-field-help" id="journal-ledger-name-help">Names must be unique, regardless of letter case.</p>
                {ledgerErrors.name && <p className="catalog-field-error" id="journal-ledger-name-error">{ledgerErrors.name}</p>}
              </div>
              <div className="inventory-modal-grid">
                <div className="catalog-field">
                  <label htmlFor="journal-ledger-startDate">Start date <span aria-hidden="true">*</span></label>
                  <input id="journal-ledger-startDate" type="date" value={ledgerDraft.startDate} disabled={saving} aria-invalid={Boolean(ledgerErrors.startDate)} aria-describedby={ledgerErrors.startDate ? 'journal-ledger-startDate-error' : undefined} onChange={(event) => {
                    setLedgerDraft({ ...ledgerDraft, startDate: event.target.value });
                    setLedgerErrors((current) => ({ ...current, startDate: undefined }));
                  }} />
                  {ledgerErrors.startDate && <p className="catalog-field-error" id="journal-ledger-startDate-error">{ledgerErrors.startDate}</p>}
                </div>
                <div className="catalog-field">
                  <label htmlFor="journal-ledger-startingBalance">Starting balance (optional)</label>
                  <div className="journal-money-input"><span aria-hidden="true">₱</span><input id="journal-ledger-startingBalance" inputMode="decimal" value={ledgerDraft.startingBalance} disabled={saving} aria-invalid={Boolean(ledgerErrors.startingBalance)} aria-describedby={ledgerErrors.startingBalance ? 'journal-ledger-startingBalance-error' : 'journal-ledger-startingBalance-help'} onChange={(event) => {
                    setLedgerDraft({ ...ledgerDraft, startingBalance: event.target.value });
                    setLedgerErrors((current) => ({ ...current, startingBalance: undefined }));
                  }} /></div>
                  <p className="catalog-field-help" id="journal-ledger-startingBalance-help">Leave empty to start at ₱0.00.</p>
                  {ledgerErrors.startingBalance && <p className="catalog-field-error" id="journal-ledger-startingBalance-error">{ledgerErrors.startingBalance}</p>}
                </div>
              </div>
              <div className="inventory-modal-actions"><span /><button className="catalog-button" type="button" disabled={saving} onClick={closeLedgerEditor}>Cancel</button><button className="catalog-button primary" type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Adding ledger…' : 'Add ledger'}</button></div>
            </form>
          </section>
        </div>
      )}

      {entryDraft && detail && (
        <div className="inventory-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEntryEditor();
        }}>
          <section
            ref={dialogRef}
            className="inventory-modal staff-modal journal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-entry-dialog-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEntryEditor();
              else trapDialogFocus(event);
            }}
          >
            <header className="inventory-modal-head">
              <div>
                <h2 id="journal-entry-dialog-title">{entryDraft.id ? 'Edit' : 'Record'} {entryDraft.kind}</h2>
                <p>{detail.name} ledger</p>
              </div>
              <button className="catalog-button small" type="button" disabled={saving} onClick={closeEntryEditor}>Close</button>
            </header>
            <form noValidate onSubmit={saveEntry}>
              {conflict && <Notice tone="danger" title="Deposit not saved"><p>{conflict}</p></Notice>}
              {modalError && <Notice tone="danger" title={`${entryDraft.kind === 'deposit' ? 'Deposit' : 'Withdrawal'} not saved`}><p>{modalError}</p></Notice>}
              <div className="inventory-modal-grid">
                <div className="catalog-field">
                  <label htmlFor="journal-entry-date">{entryDraft.kind === 'deposit' ? 'Business day' : 'Withdrawal date'} <span aria-hidden="true">*</span></label>
                  <input id="journal-entry-date" type="date" min={entryDraft.kind === 'deposit' ? detail.startDate : undefined} max={entryDraft.kind === 'deposit' ? shopDate() : undefined} value={entryDraft.date} disabled={saving} aria-invalid={Boolean(entryErrors.date)} aria-describedby={entryErrors.date ? 'journal-entry-date-error journal-entry-date-help' : 'journal-entry-date-help'} onChange={(event) => changeEntryDate(event.target.value)} />
                  <p className="catalog-field-help" id="journal-entry-date-help">{entryDraft.kind === 'deposit' ? (depositDayAlreadyRecorded ? `${detail.name} already has a deposit for this business day (already recorded).` : 'Only a closed business day on or after the ledger start date can be saved.') : 'Withdrawals are dated independently of business days.'}</p>
                  {entryErrors.date && <p className="catalog-field-error" id="journal-entry-date-error">{entryErrors.date}</p>}
                </div>
                <div className="catalog-field">
                  {hasDepositSuggestion && (
                    <>
                      <span className="catalog-field-label" id="journal-entry-source-label">Amount source</span>
                      <div className="journal-radio-group" role="radiogroup" aria-labelledby="journal-entry-source-label">
                        <label htmlFor="journal-entry-source-suggested">
                          <input id="journal-entry-source-suggested" type="radio" name="journal-entry-source" value="suggested" checked={entryDraft.amountSource === 'suggested'} disabled={saving} onChange={() => changeAmountSource('suggested')} />
                          Use suggested amount
                        </label>
                        <label htmlFor="journal-entry-source-manual">
                          <input id="journal-entry-source-manual" type="radio" name="journal-entry-source" value="manual" checked={entryDraft.amountSource === 'manual'} disabled={saving} onChange={() => changeAmountSource('manual')} />
                          Enter another amount
                        </label>
                      </div>
                    </>
                  )}
                  <label htmlFor="journal-entry-amount">Amount <span aria-hidden="true">*</span></label>
                  <div className="journal-money-input"><span aria-hidden="true">₱</span><input id="journal-entry-amount" inputMode="decimal" value={entryDraft.amount} disabled={saving} aria-invalid={Boolean(entryErrors.amount)} aria-describedby={[hasDepositSuggestion && entryDraft.amountSource === 'suggested' ? 'journal-entry-amount-suggested' : '', 'journal-entry-amount-help', entryErrors.amount ? 'journal-entry-amount-error' : ''].filter(Boolean).join(' ')} onChange={(event) => changeEntryAmount(event.target.value)} /></div>
                  {hasDepositSuggestion && entryDraft.amountSource === 'suggested' && (
                    <p className="compensation-field-annotation">
                      <span className="compensation-suggested" id="journal-entry-amount-suggested">
                        {formatMoney(depositSuggestion!.suggestedAmountCents!)} suggested, not saved
                      </span>
                    </p>
                  )}
                  {entryDraft.kind === 'deposit' && depositSuggestion !== null && depositSuggestion.suggestedAmountCents === null && (
                    <p className="journal-no-suggestion">No suggestion available for this ledger.</p>
                  )}
                  <p className="catalog-field-help" id="journal-entry-amount-help">{entryDraft.kind === 'deposit' ? '₱0.00 is a saved deposit and marks the day as recorded.' : 'Must be greater than ₱0.00.'}</p>
                  {entryErrors.amount && <p className="catalog-field-error" id="journal-entry-amount-error">{entryErrors.amount}</p>}
                </div>
              </div>
              <div className="catalog-field journal-field-wide">
                <label htmlFor="journal-entry-note">Note (optional)</label>
                <textarea id="journal-entry-note" rows={3} value={entryDraft.note} disabled={saving} onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })} />
              </div>
              <div className="inventory-modal-actions"><span /><button className="catalog-button" type="button" disabled={saving} onClick={closeEntryEditor}>Cancel</button><button className="catalog-button primary" type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : `Save ${entryDraft.kind}`}</button></div>
            </form>
          </section>
        </div>
      )}

      {settingsOpen && selectedLedger && canEditRate && (
        <SuggestionSettingsDialog
          ledger={selectedLedger}
          onClose={closeSettings}
          onSaved={(ledgerName) => {
            setSettingsOpen(false);
            setNotice(
              `${ledgerName} suggestion settings were saved. They apply to business days from today onward; earlier days keep the suggestion in force on the day itself.`,
            );
            // Earlier days keep their old suggestions and days from today onward
            // change, so the list must come back from the server.
            refreshMissingDays();
            returnFocus();
          }}
        />
      )}

      {deleteTarget && (
        <div className="inventory-modal-backdrop">
          <section className="inventory-modal journal-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="journal-delete-title" onKeyDown={(event) => {
            if (event.key === 'Escape') closeDelete();
            else trapDialogFocus(event);
          }}>
            <header className="inventory-modal-head"><div><h2 id="journal-delete-title">Delete {deleteTarget.kind}?</h2></div></header>
            <div className="compensation-delete-body">
              <p>{deleteTarget.kind === 'deposit' ? `Deleting this deposit makes ${formatBusinessDate(deleteTarget.entry.businessDate)} un-recorded again.` : 'This withdrawal will be removed from the ledger balance.'}</p>
              <p><strong><MoneyValue cents={deleteTarget.entry.amountCents} /></strong></p>
              <div className="staff-modal-actions"><button ref={deleteCancelRef} className="catalog-button" type="button" disabled={deleting} onClick={closeDelete}>Keep {deleteTarget.kind}</button><button className="catalog-button danger" type="button" disabled={deleting} aria-busy={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : `Delete ${deleteTarget.kind}`}</button></div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
