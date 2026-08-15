import type { PayslipSummary, StaffMember } from '@coffee-shop/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ReportingNotice } from '../reporting/components';
import {
  formatBusinessDate,
  formatMoney,
  rangeError,
} from '../reporting/format';
import { CompensationApiError, getPayslip } from './api';

interface PayslipViewProps {
  staff: StaffMember[];
  staffMemberIdsWithEntries: ReadonlySet<string>;
  initialRange: { from: string; to: string };
}

function visibleRangeError(from: string, to: string): string {
  const error = rangeError(from, to);
  if (error && from && to) {
    return 'End date must be on or after the start date. Dates were not changed.';
  }
  return error;
}

export function PayslipView({
  staff,
  staffMemberIdsWithEntries,
  initialRange,
}: PayslipViewProps) {
  const selectableStaff = useMemo(
    () =>
      staff.filter(
        (member) =>
          member.isActive || staffMemberIdsWithEntries.has(member.id),
      ),
    [staff, staffMemberIdsWithEntries],
  );
  const [staffMemberId, setStaffMemberId] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [staffError, setStaffError] = useState('');
  const [serverRangeError, setServerRangeError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [summary, setSummary] = useState<PayslipSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const clientRangeError = visibleRangeError(from, to);
  const dateError = serverRangeError || clientRangeError;
  const summaryStaff = summary
    ? staff.find((member) => member.id === summary.staffMember.id)
    : undefined;

  useEffect(() => {
    if (
      !staffMemberId &&
      selectableStaff.length > 0 &&
      selectableStaff[0]
    ) {
      setStaffMemberId(selectableStaff[0].id);
    }
  }, [selectableStaff, staffMemberId]);

  async function generatePayslip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextStaffError = staffMemberId ? '' : 'Choose a staff member.';
    setStaffError(nextStaffError);
    setServerRangeError('');
    setRequestError('');
    if (nextStaffError || clientRangeError || loading) return;

    setLoading(true);
    setSummary(null);
    try {
      setSummary(await getPayslip({ staffMemberId, from, to }));
    } catch (error) {
      if (
        error instanceof CompensationApiError &&
        error.status === 400 &&
        (error.field === 'from' || error.field === 'to')
      ) {
        setServerRangeError(
          'End date must be on or after the start date. Dates were not changed.',
        );
      } else {
        setRequestError(
          error instanceof CompensationApiError
            ? error.messages.join(' ')
            : 'The payslip could not be generated. Try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function changeRange(field: 'from' | 'to', value: string) {
    if (field === 'from') setFrom(value);
    else setTo(value);
    setServerRangeError('');
    setRequestError('');
  }

  return (
    <div className="payslip-view">
      <section className="report-filter payslip-filter" aria-labelledby="payslip-range-title">
        <div className="report-filter-copy">
          <h2 id="payslip-range-title">Generate payslip</h2>
          <p>
            <strong>Gross amounts only.</strong> This summary does not include
            taxes, deductions, or net pay.
          </p>
        </div>
        <form noValidate onSubmit={generatePayslip}>
          <label>
            <span>Staff member</span>
            <select
              value={staffMemberId}
              aria-invalid={Boolean(staffError)}
              aria-describedby={
                staffError ? 'payslip-staff-error' : 'payslip-staff-help'
              }
              onChange={(event) => {
                setStaffMemberId(event.target.value);
                setStaffError('');
                setRequestError('');
              }}
            >
              <option value="">Choose staff member</option>
              {selectableStaff.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.displayName}
                  {member.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
            <span className="report-field-help" id="payslip-staff-help">
              Includes active staff and deactivated staff with records.
            </span>
            {staffError && (
              <span className="report-field-error" id="payslip-staff-error">
                {staffError}
              </span>
            )}
          </label>
          <label>
            <span>Start date</span>
            <input
              type="date"
              value={from}
              aria-invalid={Boolean(!from)}
              aria-describedby={dateError ? 'payslip-range-error' : undefined}
              onChange={(event) => changeRange('from', event.target.value)}
            />
          </label>
          <label>
            <span>End date</span>
            <input
              type="date"
              value={to}
              aria-invalid={Boolean(!to || (from && to && from > to))}
              aria-describedby={dateError ? 'payslip-range-error' : undefined}
              onChange={(event) => changeRange('to', event.target.value)}
            />
          </label>
          <button
            className="report-button report-button-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Generating…' : 'Generate payslip'}
          </button>
        </form>
        {dateError && (
          <p className="report-range-error" id="payslip-range-error" role="alert">
            {dateError}
          </p>
        )}
      </section>

      {requestError && <ReportingNotice>{requestError}</ReportingNotice>}

      {loading && (
        <section
          className="report-panel payslip-loading"
          aria-busy="true"
          aria-label="Generating payslip"
        >
          <strong>Generating payslip…</strong>
          <span />
          <span />
          <span />
        </section>
      )}

      {summary && summary.entries.length === 0 && (
        <section className="report-panel payslip-empty" role="status">
          <h2>No records in this range</h2>
          <p>
            {summary.staffMember.displayName} has no entered compensation
            records from {formatBusinessDate(summary.from)} through{' '}
            {formatBusinessDate(summary.to)}. No payslip or totals were
            generated.
          </p>
        </section>
      )}

      {summary && summary.entries.length > 0 && (
        <section className="report-panel payslip-result" aria-labelledby="payslip-result-title">
          <header className="report-panel-head">
            <div>
              <h2 id="payslip-result-title">
                {summary.staffMember.displayName}
                {summaryStaff?.isActive === false && (
                  <span className="payslip-inactive-badge">
                    Inactive staff member
                  </span>
                )}
              </h2>
              <p>
                Inclusive range: {formatBusinessDate(summary.from)} to{' '}
                {formatBusinessDate(summary.to)}
              </p>
            </div>
            <p>
              <strong>Gross compensation summary</strong>
              <br />
              No taxes, deductions, or net pay included.
            </p>
          </header>
          <p className="report-scroll-hint">
            Scroll horizontally to inspect all payslip columns.
          </p>
          <div
            className="report-table-region payslip-table-region"
            tabIndex={0}
            role="region"
            aria-label="Payslip daily entries, horizontally scrollable"
          >
            <table className="report-table payslip-table">
              <caption className="sr-only">
                Daily compensation entries included in this payslip
              </caption>
              <thead>
                <tr>
                  <th scope="col">Work date</th>
                  <th scope="col" className="num">Salary</th>
                  <th scope="col" className="num">Commission</th>
                  <th scope="col" className="num">Daily total</th>
                </tr>
              </thead>
              <tbody>
                {summary.entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{formatBusinessDate(entry.workDate)}</th>
                    <td className="num">{formatMoney(entry.salaryCents)}</td>
                    <td className="num">{formatMoney(entry.commissionCents)}</td>
                    <td className="num">
                      <strong>{formatMoney(entry.dailyTotalCents)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl
            className="report-totals payslip-totals"
            role="group"
            aria-label="Payslip totals"
          >
            <div className="report-metric">
              <dt>Salary total</dt>
              <dd>{formatMoney(summary.salaryTotalCents)}</dd>
            </div>
            <div className="report-metric">
              <dt>Commission total</dt>
              <dd>{formatMoney(summary.commissionTotalCents)}</dd>
            </div>
            <div className="report-metric">
              <dt>Overall gross total</dt>
              <dd>{formatMoney(summary.grandTotalCents)}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
