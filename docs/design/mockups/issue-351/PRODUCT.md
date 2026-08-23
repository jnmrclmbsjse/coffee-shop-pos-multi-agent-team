# Product decisions for story #351

## Product intent

Staff can correct an incorrect cash movement while preserving a permanent, readable history. The correction is a new linked entry containing the corrected values in full. The original is never edited, deleted, hidden, voided, or filtered out.

## State model

### Amend affordance

- An effective entry on the current open day has a row-level `Amend` button.
- A closed-day entry keeps the action visible but disabled. Copy states: `Day closed. Recorded close cannot be changed.`
- A superseded entry keeps the action visible but disabled. Copy names the correction: `Already corrected by CM-1814.`
- The disabled explanation is linked with `aria-describedby` so the reason is available to assistive technology.

### Amendment flow

- The flow opens in place on the existing Cash & Expenses page.
- The original entry is shown before the fields: type, amount, description, and category.
- Staff provide the corrected type, amount, description, and category.
- Amount is a required positive magnitude. Type supplies direction.
- Description is required and carries the explanation for the correction. There is no amendment-reason field.
- Category is available only when type is Expense.
- Changing from Expense to Cash in or Cash out clears the category, removes it from the tab order, and announces the change.
- The first action is `Review correction`, not a write.
- `Cancel, record nothing` communicates the consequence before activation.

### Review before confirm

- Original and proposed values appear side by side on wide screens and stack on narrow screens.
- Changed fields receive a warning treatment and the visible word `Changed`.
- Unchanged fields remain neutral and are labeled `Unchanged`.
- The status message says that nothing has been recorded yet.
- Confirmation copy says the original remains visible and only the effective correction counts in totals.

### Corrected ledger

- Every row remains visible and the ordering stays newest recorded entry first.
- Each row has a visible `Effective` or `Superseded` status.
- A correction says `Corrects [id]` and states the effective kind and full positive amount.
- A superseded row says `Corrected by [id]` and states what it became.
- Row accessible names repeat kind, amount, status, and link text.
- Chain rows show `Original`, `Correction 1 of 3`, and so on. Each middle row says both what it corrects and which later row corrected it.
- A cross-type example explicitly reads `Corrected by CM-1862 to ₱100.00 Cash out.` No arithmetic is required.

### Effective totals

- Summary values come from the server read model and count only effective entries.
- The example states that CM-1847 contributes ₱0.00 and CM-1848 contributes ₱80.00 once.
- The original and correction remain visible beside the summary so `₱80.00 once, not ₱180.00` is explicit.
- The client does not derive effectiveness or recompute production totals from the displayed list.

### Failures and conflicts

- Day-closed 409: `No correction was recorded. The recorded close and totals did not change.` The day becomes read only.
- Already-superseded 409: names the superseding entry id and offers `Refresh and view CM-1848`. Retrying is not offered.
- Validation 400: amount, description, and category problems appear inline. The first invalid field receives focus.
- All failures announce their result and state that the ledger and totals are unchanged.

## Copy rules

- Use `correction` and `superseded`, not delete, void, reverse, or undo.
- Use full positive amounts such as `₱100.00` and `₱80.00`.
- Never describe an amendment as a negative amount or a delta.
- Use concrete record ids when explaining conflicts and links.
- Keep permanent-history reassurance short and operational.

