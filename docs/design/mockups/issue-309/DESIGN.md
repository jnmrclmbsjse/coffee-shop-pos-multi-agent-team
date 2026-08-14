# Compensation admin advisory reference

## Design read

Preserve-mode internal operations software for administrators, using the shipped POS shell, table, form, dialog, and Reports patterns. Design variance 3 keeps layouts conventional, motion intensity 1 limits motion to direct control feedback, and visual density 6 supports frequent record review without turning the page into a cockpit.

## Decision and rationale

Compensation belongs under Operations as one sidebar entry, positioned after Reports and before Order History. Daily records and Payslips are local views within that destination. They use the same roster and compensation vocabulary, share authorization, and are small enough that two global navigation entries would overstate the bounded context.

The records view first loads all staff for the current calendar month. In this dated reference, that means Aug 1-31, 2026. Records sort by work date descending, then staff member name ascending within the same date. Staff and inclusive date filters remain visible above the table so a growing history stays usable.

The add dialog allows only active staff members. Salary and commission are required numeric values, but zero is valid. Daily total is previewed live in a visually separate read-only summary because immediate arithmetic feedback is useful and no editable control is implied. The edit dialog presents staff member and work date as fixed context, not disabled inputs.

The database remains the authority for duplicate staff/date conflicts. A 409 response leaves the entered values intact, announces that nothing changed, and links to the existing record. The empty payslip state removes the line table and all totals, replacing them with an explicit result that says no payslip was generated.

The state switchers, explanatory assessment notes, success simulations, and dialog backdrops are mockup-only scaffolding. They are not production UI.

## Token statement

The prototype declares the supplied tokens in `:root` only so it renders standalone. Dev must drop the entire `:root` block when lifting these rules into the app stylesheet and rely on the already-shipped token definitions. No new tokens are proposed. The existing warning family provides enough distinction for the critical empty-range result. Primary button fills use `--accent-hover` at rest and `--accent-pressed` on hover. `--accent` is reserved for non-text emphasis. All money uses `--font-mono` with tabular numerals.

## Copy deck

- `Design task #311`
- `Compensation admin reference`
- `Advisory implementation reference for GitHub #309`
- `Mockup sections`
- `Daily records preview state`
- `Daily record dialog preview state`
- `Delete confirmation preview state`
- `Payslip preview state`
- `A. Daily records`
- `B. Add and edit`
- `C. Delete`
- `D. Payslip`
- `E. Navigation`
- `A. Daily compensation records - list`
- `Decision:`
- `First load shows all staff for August 1-31, 2026. Results sort by work date newest first, then staff name A-Z.`
- `Default list`
- `No records yet`
- `No filter matches`
- `Compensation`
- `Daily salary and commission records`
- `Add daily record`
- `Daily records`
- `Payslips`
- `Compensation sections`
- `Filter compensation records`
- `Staff member`
- `All staff`
- `Mara Santos`
- `Jon Bell`
- `Ines Reyes`
- `Omar Diaz`
- `From`
- `To`
- `Clear filters`
- `Showing 5 records for Aug 1-31, 2026, all staff`
- `Daily compensation records table, scroll horizontally to view all columns`
- `Daily compensation records ordered by work date newest first, then staff member name`
- `Staff member`
- `Work date`
- `Salary`
- `Commission`
- `Daily total`
- `Actions`
- `Aug 14, 2026`
- `Aug 13, 2026`
- `Aug 12, 2026`
- `₱1,200.00`
- `₱450.00`
- `₱1,650.00`
- `₱950.00`
- `₱620.00`
- `₱1,570.00`
- `₱1,100.00`
- `₱480.00`
- `₱1,580.00`
- `₱900.00`
- `₱700.00`
- `₱1,600.00`
- `₱510.00`
- `₱1,710.00`
- `Edit`
- `Delete`
- `No compensation records yet`
- `Add the first daily record for a staff member. Salary and commission can each be zero.`
- `Showing 0 records for Aug 1-10, 2026, Mara Santos`
- `No records match this filter`
- `Try another staff member or date range.`
- `B. Add / edit a daily record`
- `Decision:`
- `Preview the daily total live as a read-only calculation. It confirms the math without presenting a fifth input.`
- `Add default`
- `Missing amounts`
- `Negative amount`
- `Non-numeric`
- `Sub-centavo`
- `Future date`
- `Inactive staff`
- `Duplicate 409`
- `Submitting`
- `Edit pre-populated`
- `Edit saved`
- `Add daily record`
- `Edit daily record`
- `Close dialog`
- `Close`
- `Dialog closed`
- `Choose a state above to inspect the dialog again.`
- `Only active staff members can be selected.`
- `Today or earlier.`
- `Salary amount`
- `Commission amount`
- `PHP, up to 2 decimal places. Zero is allowed.`
- `Computed from salary + commission. Not editable.`
- `Not available`
- `Fix the following`
- `Enter a salary amount.`
- `Enter a commission amount.`
- `Enter a salary amount. Zero is allowed.`
- `Enter a commission amount. Zero is allowed.`
- `Salary cannot be negative.`
- `Enter zero or a positive amount.`
- `Salary must be a number.`
- `Enter a number, such as 1200.00.`
- `Salary cannot have more than 2 decimal places.`
- `Enter an amount to the nearest centavo.`
- `Work date cannot be in the future.`
- `Choose today or an earlier date.`
- `Omar Diaz (inactive)`
- `Omar Diaz is no longer active.`
- `Choose an active staff member for a new record.`
- `A record already exists`
- `Nothing was changed. Mara Santos already has a record for Aug 14, 2026.`
- `Open the existing record`
- `Cancel`
- `Add record`
- `Save changes`
- `Saving...`
- `Daily record updated`
- `Mara Santos, Aug 14, 2026 now totals ₱1,700.00. The list updated without a page refresh.`
- `Updated daily compensation record`
- `₱1,250.00`
- `₱1,700.00`
- `C. Delete confirmation`
- `Confirmation`
- `Cancelled`
- `Deleted`
- `Delete daily record?`
- `This permanently deletes Mara Santos's record for Aug 14, 2026 with a daily total of ₱1,650.00.`
- `This cannot be undone.`
- `Delete record`
- `Deletion cancelled`
- `Mara Santos's Aug 14, 2026 record is unchanged.`
- `Daily record deleted`
- `Mara Santos's Aug 14, 2026 record was removed from the list without a page refresh.`
- `D. Generate a payslip`
- `Critical state:`
- `An empty valid range replaces the result table and totals entirely. It cannot be mistaken for a zero-earnings payslip.`
- `Result with lines`
- `End before start`
- `Empty range`
- `Deactivated member`
- `Loading`
- `Generate a gross summary from entered daily records`
- `Generate payslip`
- `Gross amounts only.`
- `This summary does not include taxes, deductions, or net pay.`
- `Start date`
- `End date`
- `Includes active and deactivated staff with records.`
- `End date must be on or after the start date. Dates were not changed.`
- `Generating payslip...`
- `Generating payslip`
- `No records in this range`
- `Mara Santos has no entered compensation records from Aug 1 through Aug 5, 2026. No payslip or totals were generated.`
- `Inclusive range: Aug 12-14, 2026`
- `Gross compensation summary`
- `No taxes, deductions, or net pay included.`
- `Inactive staff member`
- `Payslip daily entries, scroll horizontally to view all columns`
- `Daily compensation entries included in this payslip`
- `Salary total`
- `Commission total`
- `Overall gross total`
- `₱2,400.00`
- `₱960.00`
- `₱3,360.00`
- `E. Navigation placement`
- `Recommendation:`
- `Add one Compensation entry under Operations. Records and Payslips remain a local switch because they share the same admin-only context and roster vocabulary.`
- `Admin sidebar excerpt`
- `Coffee POS`
- `Workspace`
- `Dashboard`
- `Catalog`
- `Categories`
- `Products`
- `Operations`
- `Inventory`
- `Staff`
- `Reports`
- `Order History`
- `One admin-only destination keeps daily records and payslip generation together. The local switch appears immediately below the page heading.`

## Implementation handoff

### 1. Requirements

1. Enforce the story and ADR 0013 ownership boundary: Compensation is admin-only, derives no values from attendance, sales, or targets, and exposes no staff self-service surface.
2. Persist at most one daily compensation record per staff member and work date with a database uniqueness constraint. Treat a conflict as a server 409 after submit. Never replace or mutate the existing record in that failure path.
3. Accept salary and commission as peso amounts with at most two decimal places at the field, but transmit and store them as integer centavos per ADR 0013 §3 — no float arithmetic anywhere. Both fields are required; zero is valid. Reject missing, negative, non-numeric, and sub-centavo input per field. The daily total is derived (`salaryCents + commissionCents`) and payslip totals are summed server-side; the browser renders totals and never computes them.
4. Refuse future work dates. On add, allow only active roster members. On edit, keep staff member and work date immutable and update only salary and commission.
5. Format every monetary value with a peso sign, grouped thousands, and exactly two decimal places. Use the mono family for alignment.
6. Order the list by work date descending, then staff member name ascending. Default first load to all staff in the current calendar month and support staff plus inclusive date-range filtering.
7. Distinguish a roster with no records from a filter with no matches. Only the filtered empty state offers Clear filters.
8. Hard-delete only after explicit confirmation that names the staff member, work date, and total and states that deletion cannot be undone. Cancel must not mutate data.
9. Generate payslip summaries from one staff member and an inclusive date range. Allow deactivated staff with existing records. Refuse an end date before the start date without swapping either endpoint.
10. For a valid range with no records, render an explicit no-records result with no line table and no zero totals. Every populated result must state that values are entered gross amounts and exclude taxes, deductions, and net pay.
11. After create, update, or delete, reconcile the visible list from the response or query cache without a full page refresh.
12. Every target is at least 44px. Apply a visible 3px `--focus` ring. Use real labels, `aria-invalid`, and `aria-describedby` for field errors. Use the shipped error summary and link summary items to fields in production.
13. Move focus into an opened dialog, trap focus, close on Escape, and return focus to the invoking control. Announce server conflicts through `role="alert"` or an assertive live region. Keep the duplicate form populated.
14. Do not rely on color or `title` attributes to communicate state. Keep reasons as persistent text. Do not make a disabled control the only explanation for unavailability.
15. Give tables captions and scoped headers. Make each horizontally scrollable table wrapper keyboard-focusable and give it an accessible label.
16. Use direct control feedback only. Do not add decorative transitions to this operational flow.
17. Do not add printing, PDF or CSV download, email, payment or paid states, payslip numbering, payslip history, employee self-service, or attendance, sales, or target-derived features.

### 2. Advisory

1. Keep one Compensation route with a local Daily records / Payslips switch. Preserve the surrounding admin navigation labels and ordering except for the single new entry.
2. Use the current month as first-load scope, but keep explicit date values in the controls so scope is never hidden. Update the result sentence whenever filters change.
3. Debounce neither date selects nor staff selection unless the production shell already does so. A deliberate Apply action is unnecessary for a local data set, but may be retained if Reports already uses one.
4. Show the derived daily total live only when both inputs parse as valid amounts. Otherwise show Not available. Never round sub-centavo input into apparent validity.
5. In production, focus the first invalid field after the error summary is announced. For 409 conflicts, focus the danger notice and preserve all submitted values.
6. Link Open the existing record to the conflicting row or open its edit dialog. Avoid silently replacing the current form with the existing values.
7. On mobile, keep filters in one column and expose the table through the same focusable horizontal-scroll wrapper used elsewhere. Do not turn financial rows into a second card pattern unless the shipped shell already does so.
8. Keep the gross-only statement above every generation form and repeat it in populated results. Inactive status is informational and does not block generation.
9. Use a non-animated loading treatment matching the final result geometry. If generation takes long enough to need cancellation, define that as a separate product requirement rather than improvising it here.
10. The state switchers, annotations, simulated success views, and staged backdrops in the reference are review aids only and must not ship.

### 3. Proposed material changes to existing shared shells/components

1. Add a single Compensation link to `.admin-nav-group-links` under Operations because both new surfaces are admin-only operational work.
2. Extend the existing local page-context switch used around Reports, or introduce a shared equivalent, for Daily records and Payslips because adding two sidebar entries would over-fragment the bounded context.
3. Allow `.staff-filters` to accept a staff select plus two date fields because the growing record table needs stable roster and range scope without a new filter idiom.
4. Reuse `.staff-modal` with a fixed-context block for immutable edit identifiers because disabled text inputs falsely suggest that staff member or work date could become editable.
5. Add the dialog-level danger notice inside the existing modal body because a server 409 is not a field validation error and must be announced assertively without clearing the form.
6. Reuse `.report-filter` for payslip staff and inclusive dates because Reports already establishes the range form idiom.
7. Extend `.report-empty` behavior so a valid no-data result can replace both the table and `.report-totals` because showing zero totals would imply a real earnings statement.
8. Ensure the shared table wrapper supports `tabindex="0"`, an accessible region label, and a visible focus ring because wide compensation and payslip tables scroll horizontally on narrow screens.
