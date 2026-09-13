import {
  CompensationAdjustmentKind,
  type PayslipSummary,
  type StaffMember,
} from '@coffee-shop/shared';
import { toPng } from 'html-to-image';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ReportingNotice } from '../reporting/components';
import {
  formatBusinessDate,
  formatMoney,
  formatSubmissionTime,
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

export function payslipFilename(
  displayName: string,
  from: string,
  to: string,
): string {
  const slug = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'staff';
  return `payslip-${slug}-${from}-${to}.png`;
}

// Exported at 2x so the text stays crisp when printed or zoomed.
const PIXEL_RATIO = 2;

// A couple of device pixels of rounding between the element's box and the
// rasterised canvas is normal; anything more means content was dropped.
const PNG_SIZE_TOLERANCE = 4;

const MEASURE_TIMEOUT_MS = 2_000;

// Resolves the exported PNG's pixel size, or null when it cannot be determined
// — no decoder, an environment that never fires the events, or a payload this
// browser will not read. Null means "unknown", never "bad".
function measureImageSize(
  dataUrl: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const image = new Image();
    image.onload = () =>
      finish(
        image.naturalWidth && image.naturalHeight
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    image.onerror = () => finish(null);
    // Never let the check itself hang the download button.
    setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    image.src = dataUrl;
  });
}

function generatedTimestamp(value: string): string {
  return `Generated ${formatSubmissionTime(value)}`;
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
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloadNotice, setDownloadNotice] = useState('');
  const captureRef = useRef<HTMLElement>(null);
  const clientRangeError = visibleRangeError(from, to);
  const dateError = serverRangeError || clientRangeError;
  const summaryStaff = summary
    ? staff.find((member) => member.id === summary.staffMember.id)
    : undefined;
  const hasPayslip = Boolean(
    summary && (summary.entries.length > 0 || summary.adjustments.length > 0),
  );
  const earningsAdjustments = summary?.adjustments.filter(
    (adjustment) => adjustment.kind !== CompensationAdjustmentKind.ADVANCE,
  ) ?? [];
  const advances = summary?.adjustments.filter(
    (adjustment) => adjustment.kind === CompensationAdjustmentKind.ADVANCE,
  ) ?? [];

  useEffect(() => {
    if (!staffMemberId && selectableStaff.length > 0 && selectableStaff[0]) {
      setStaffMemberId(selectableStaff[0].id);
    }
  }, [selectableStaff, staffMemberId]);

  async function generatePayslip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextStaffError = staffMemberId ? '' : 'Choose a staff member.';
    setStaffError(nextStaffError);
    setServerRangeError('');
    setRequestError('');
    setDownloadError('');
    setDownloadNotice('');
    if (nextStaffError || clientRangeError || loading) return;

    setLoading(true);
    setSummary(null);
    setGeneratedAt('');
    try {
      const nextSummary = await getPayslip({ staffMemberId, from, to });
      setSummary(nextSummary);
      setGeneratedAt(new Date().toISOString());
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
    setDownloadError('');
    setDownloadNotice('');
  }

  async function downloadPayslip() {
    if (!summary || !hasPayslip || !captureRef.current || downloading) return;
    const filename = payslipFilename(
      summary.staffMember.displayName,
      summary.from,
      summary.to,
    );
    setDownloading(true);
    setDownloadError('');
    setDownloadNotice('');
    try {
      const node = captureRef.current;
      await document.fonts?.ready;

      const options = {
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio: PIXEL_RATIO,
        // Pin the output box to the element's own measured size. Left to infer
        // it, html-to-image can settle on a stale or partial height and emit a
        // PNG holding only the top of the payslip.
        width: node.offsetWidth,
        height: node.offsetHeight,
        // Zero the clone's margin. The on-screen artifact is centred with
        // `margin: 0 auto`, and html-to-image copies COMPUTED styles — which
        // resolve `auto` to real pixels. On a wide screen that pushed the clone
        // hundreds of pixels right inside a box pinned to its own width, so
        // the PNG came out with blank space on the left and the right-hand
        // columns (commission, totals, net payable) cut off.
        style: { margin: '0' },
        filter: (candidate: Node) =>
          candidate.nodeType !== Node.ELEMENT_NODE ||
          (candidate as HTMLElement).dataset.payslipExportExclude !== 'true',
      };

      // Render TWICE and keep the second. html-to-image inlines fonts and
      // images while it walks the clone, and on the first pass those resources
      // are often still in flight — the pass completes anyway and produces a
      // short or partly blank image. The first pass primes its caches; the
      // second is the one worth keeping. `await document.fonts.ready` above
      // covers fonts the page already uses, not resources the clone fetches.
      await toPng(node, options);
      const dataUrl = await toPng(node, options);

      // VERIFY before handing it over. A truncated export is indistinguishable
      // from a good one until you open it, so a silent bad download is the
      // worst outcome: the payslip looks delivered and is not.
      //
      // FAIL OPEN. Only a measurement that SUCCEEDS and comes up short blocks
      // the download. If the image cannot be measured at all, that is a fact
      // about the measuring, not about the export — withholding the file then
      // would turn a working download into a broken one.
      const measured = await measureImageSize(dataUrl);
      const expectedHeight = Math.round(node.offsetHeight * PIXEL_RATIO);
      // Width is checked too: the defect actually reported from the field was
      // a horizontal crop, which a height-only check could never catch.
      const expectedWidth = Math.round(node.offsetWidth * PIXEL_RATIO);
      if (
        measured !== null &&
        expectedHeight - measured.height > PNG_SIZE_TOLERANCE
      ) {
        setDownloadError(
          `The PNG came out incomplete — ${measured.height} pixels tall instead of about ${expectedHeight} — so it was not downloaded. The on-screen payslip is unchanged. Try again, or narrow the date range to shorten the payslip.`,
        );
        return;
      }
      if (
        measured !== null &&
        expectedWidth - measured.width > PNG_SIZE_TOLERANCE
      ) {
        setDownloadError(
          `The PNG came out incomplete — ${measured.width} pixels wide instead of about ${expectedWidth}, so part of the payslip was cut off — so it was not downloaded. The on-screen payslip is unchanged. Try again.`,
        );
        return;
      }

      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
      setDownloadNotice(`Downloaded: ${filename}`);
    } catch {
      setDownloadError(
        'The PNG could not be prepared. The on-screen payslip is unchanged.',
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="payslip-view">
      <section className="report-filter payslip-filter" aria-labelledby="payslip-range-title">
        <div className="report-filter-copy">
          <h2 id="payslip-range-title">Generate payslip</h2>
          <p>
            Review salary, commission, allowances, bonuses, advances, and net
            payable for an inclusive date range.
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
                setDownloadError('');
                setDownloadNotice('');
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

      {summary && !hasPayslip && (
        <section className="report-panel payslip-empty" role="status">
          <h2>No records in this range</h2>
          <p>
            {summary.staffMember.displayName} has no daily compensation records
            or adjustments from {formatBusinessDate(summary.from)} through{' '}
            {formatBusinessDate(summary.to)}. No payslip or totals were
            generated, so there is nothing to download.
          </p>
        </section>
      )}

      {summary && hasPayslip && generatedAt && (
        <div className="payslip-stage">
          <article
            className="payslip-artifact"
            id="payslip-capture-node"
            ref={captureRef}
            aria-labelledby="payslip-result-title"
            aria-busy={downloading}
          >
            <header className="payslip-artifact-head">
              <div>
                <p className="payslip-zone-label">Generated payslip</p>
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
              <button
                className="report-button report-button-primary"
                type="button"
                disabled={downloading}
                data-payslip-export-exclude="true"
                onClick={downloadPayslip}
              >
                {downloading ? 'Preparing image…' : 'Download PNG'}
              </button>
            </header>

            <section className="payslip-zone" aria-labelledby="payslip-earnings-title">
              <p className="payslip-zone-label" id="payslip-earnings-title">
                Earnings
              </p>
              {summary.entries.length > 0 && (
                <div className="payslip-daily-block">
                  <h3 className="payslip-subsection-title">
                    Daily salary and commission
                  </h3>
                  <table className="payslip-table payslip-daily-table">
                    <caption className="sr-only">
                      Daily salary and commission entries included in this
                      payslip
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Work date</th>
                        <th scope="col">Salary</th>
                        <th scope="col">Commission</th>
                        <th scope="col">Daily total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.entries.map((entry) => (
                        <tr key={entry.id}>
                          <th scope="row" data-label="Work date">
                            {formatBusinessDate(entry.workDate)}
                          </th>
                          <td data-label="Salary">
                            {formatMoney(entry.salaryCents)}
                          </td>
                          <td data-label="Commission">
                            {formatMoney(entry.commissionCents)}
                          </td>
                          <td data-label="Daily total">
                            <strong>{formatMoney(entry.dailyTotalCents)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {summary.earningsTotalCents === 0 && (
                <p className="payslip-zone-note">
                  No salary, commission, allowance, or bonus earnings fall
                  inside this range.
                </p>
              )}
              {summary.earningsTotalCents !== 0 && (
                <table className="payslip-artifact-table">
                  <caption className="sr-only">Payslip earnings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.salaryTotalCents !== 0 && (
                      <tr>
                        <td>Salary<span>Selected inclusive range</span></td>
                        <td>{formatMoney(summary.salaryTotalCents)}</td>
                      </tr>
                    )}
                    {summary.commissionTotalCents !== 0 && (
                      <tr>
                        <td>Commission<span>Selected inclusive range</span></td>
                        <td>{formatMoney(summary.commissionTotalCents)}</td>
                      </tr>
                    )}
                    {earningsAdjustments.map((adjustment) => (
                      <tr key={adjustment.id}>
                        <td>
                          {adjustment.description}
                          <span>
                            {adjustment.kind === CompensationAdjustmentKind.ALLOWANCE
                              ? 'Allowance'
                              : 'Bonus'}
                            , {formatBusinessDate(adjustment.effectiveDate)}
                          </span>
                        </td>
                        <td>{formatMoney(adjustment.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <dl className="payslip-category-totals" aria-label="Earnings totals">
                <div><dt>Salary total</dt><dd>{formatMoney(summary.salaryTotalCents)}</dd></div>
                <div><dt>Commission total</dt><dd>{formatMoney(summary.commissionTotalCents)}</dd></div>
                <div><dt>Allowance total</dt><dd>{formatMoney(summary.allowanceTotalCents)}</dd></div>
                <div><dt>Bonus total</dt><dd>{formatMoney(summary.bonusTotalCents)}</dd></div>
                <div className="payslip-total-emphasis"><dt>Earnings total</dt><dd>{formatMoney(summary.earningsTotalCents)}</dd></div>
              </dl>
            </section>

            <hr className="payslip-rule" />

            <section className="payslip-zone" aria-labelledby="payslip-deductions-title">
              <p className="payslip-zone-label" id="payslip-deductions-title">
                Deductions
              </p>
              {advances.length === 0 ? (
                <p className="payslip-zone-note">No salary advances in this range.</p>
              ) : (
                <table className="payslip-artifact-table payslip-advance-table">
                  <caption className="sr-only">Salary advances</caption>
                  <thead>
                    <tr>
                      <th scope="col">Salary advance</th>
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.map((advance) => (
                      <tr key={advance.id}>
                        <td>{advance.description}<span>{formatBusinessDate(advance.effectiveDate)}</span></td>
                        <td>−{formatMoney(advance.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <dl className="payslip-category-totals payslip-deduction-total" aria-label="Deduction totals">
                <div><dt>Advance total</dt><dd>−{formatMoney(summary.advanceTotalCents)}</dd></div>
              </dl>
            </section>

            <div className={`payslip-net${summary.netPayableCents < 0 ? ' negative' : ''}`}>
              <div>
                <p className="payslip-net-label">Net payable</p>
                <p className="payslip-net-note">
                  {summary.netPayableCents < 0
                    ? 'Advances in this range exceed earnings. This amount is not carried into another range.'
                    : 'Earnings total less salary advances.'}
                </p>
              </div>
              <p className="payslip-net-value">{formatMoney(summary.netPayableCents)}</p>
            </div>
            <p className="payslip-generated-line">
              {generatedTimestamp(generatedAt)}
            </p>
          </article>

          {downloadNotice && (
            <div className="catalog-notice success payslip-download-status" role="status">
              <strong>{downloadNotice}</strong>
            </div>
          )}
          {downloadError && (
            <div className="catalog-notice danger payslip-download-status" role="alert">
              <strong>Image could not be prepared.</strong>
              <p>{downloadError}</p>
              <button className="catalog-button small" type="button" onClick={downloadPayslip}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
