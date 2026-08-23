const mount = document.querySelector('#screen-mount');
const live = document.querySelector('#cash-live');
const stateButtons = [...document.querySelectorAll('[data-state]')];
const dayChip = document.querySelector('#header-day-state');

const original = {
  id: 'CM-1847',
  kind: 'CASH_IN',
  amount: '100.00',
  description: 'Change float top-up',
  category: 'Not applicable',
  by: 'Marilou Bagtas',
  time: '9:14 AM'
};

let draft = {
  kind: 'CASH_OUT',
  amount: '80.00',
  description: 'Drawer cash removed after float check',
  category: ''
};

function announce(message) {
  live.textContent = '';
  window.setTimeout(() => { live.textContent = message; }, 20);
}

function kindLabel(kind) {
  return kind === 'CASH_IN' ? 'Cash in' : kind === 'CASH_OUT' ? 'Cash out' : 'Expense';
}

function kindBadge(kind) {
  const sign = kind === 'CASH_IN' ? '+' : '−';
  return `<span class="staff-cash-kind" data-kind="${kind}"><span aria-hidden="true">${sign}</span>${kindLabel(kind)}</span>`;
}

function stateHeading(title, note) {
  return `<div class="state-label"><h2 id="state-title">${title}</h2><p>${note}</p></div>`;
}

function dayContext(closed = false) {
  return `<section class="staff-cash-day-context" aria-label="Business day context">
    <div><span>${closed ? 'Recorded on' : 'Current business day'}</span><strong>Sunday, August 23, 2026</strong></div>
    <span>${closed ? 'Closed day, read only' : 'Normal day'}</span>
  </section>`;
}

function ledgerTable(rows, label = 'Current business day cash entries') {
  return `<div class="staff-cash-table-wrap" role="region" aria-label="${label}" tabindex="0">
    <table>
      <thead><tr><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Detail</th><th scope="col">By</th><th scope="col">Time</th><th scope="col">Record status</th><th scope="col">Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function basicRow({ id, kind, amount, detail, by, time, status = 'Effective', action = 'amend', className = '', link = '', position = '' }) {
  const actionCell = action === 'amend'
    ? `<button class="row-action" type="button" data-amend-id="${id}" aria-label="Amend ${kindLabel(kind)} ₱${amount}, ${detail}">Amend</button>`
    : `<button class="row-action" type="button" disabled aria-describedby="note-${id}">Amend</button><span class="action-note" id="note-${id}">${action}</span>`;
  const statusClass = status === 'Effective' ? 'effective' : 'superseded';
  return `<tr class="${className}" aria-label="${kindLabel(kind)} ₱${amount}. ${status}. ${link}">
    <th scope="row">${kindBadge(kind)}${position ? `<span class="chain-position">${position}</span>` : ''}</th>
    <td class="staff-cash-amount">₱${amount}</td>
    <td class="staff-cash-detail"><strong>${detail}</strong>${link ? `<small>${link}</small>` : ''}</td>
    <td>${by}</td><td>${time}</td>
    <td><span class="status-text ${statusClass}">${status}</span>${link ? `<span class="link-copy">${link}</span>` : ''}</td>
    <td>${actionCell}</td>
  </tr>`;
}

function recordPanel() {
  return `<section class="staff-inventory-panel staff-cash-entry-panel" aria-labelledby="record-entry-title" data-od-id="record-entry-panel">
    <header><h2 id="record-entry-title">Record an entry</h2><p>Entries are permanent.</p></header>
    <form>
      <fieldset class="staff-cash-type"><legend>Type <span class="staff-inventory-required" aria-hidden="true">*</span></legend>
        <div class="staff-cash-type-options">
          <label><input type="radio" name="record-kind" checked><span><strong>Cash in</strong><small>Adds to drawer</small><em>Selected</em></span></label>
          <label><input type="radio" name="record-kind"><span><strong>Cash out</strong><small>Reduces drawer</small></span></label>
          <label><input type="radio" name="record-kind"><span><strong>Expense</strong><small>Reduces drawer</small></span></label>
        </div>
      </fieldset>
      <div class="staff-inventory-field"><label for="record-amount">Amount <span class="staff-inventory-required" aria-hidden="true">*</span></label><div class="staff-cash-amount-input"><span aria-hidden="true">₱</span><input id="record-amount" type="text" inputmode="decimal" placeholder="0.00"></div></div>
      <div class="staff-inventory-field"><label for="record-description">Reason <span class="staff-inventory-required" aria-hidden="true">*</span></label><textarea id="record-description" placeholder="What was this entry for?"></textarea></div>
      <p class="staff-cash-permanence"><strong>Permanent record.</strong> Entries cannot be deleted or hidden. Incorrect entries can be corrected while the day is open.</p>
      <div class="staff-inventory-actions"><button class="staff-inventory-button primary" type="button">Record entry</button></div>
    </form>
  </section>`;
}

function renderAffordance() {
  dayChip.textContent = 'Day open';
  dayChip.className = 'chip chip--open';
  const openRows = [
    basicRow({ id: 'CM-1852', kind: 'EXPENSE', amount: '350.00', detail: 'Supplies / Milk run', by: 'Marilou Bagtas', time: '10:08 AM' }),
    basicRow({ id: original.id, kind: original.kind, amount: original.amount, detail: original.description, by: original.by, time: original.time })
  ].join('');
  const closedRow = basicRow({ id: 'CM-1731', kind: 'CASH_OUT', amount: '500.00', detail: 'Bank deposit', by: 'Noel Pascual', time: '6:12 PM', action: 'Day closed. Recorded close cannot be changed.' });
  const supersededRow = basicRow({ id: 'CM-1810', kind: 'CASH_IN', amount: '100.00', detail: 'Change float top-up', by: 'Marilou Bagtas', time: '8:51 AM', status: 'Superseded', className: 'superseded-row', link: 'Corrected by CM-1814', action: 'Already corrected by CM-1814.' });

  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">
    ${stateHeading('1. Start an amendment', 'Only effective entries on the current open day can be amended.')}
    ${dayContext()}
    <div class="staff-cash-layout">
      ${recordPanel()}
      <section class="staff-cash-ledger" aria-labelledby="cash-ledger-title" data-od-id="staff-cash-ledger">
        <div class="staff-cash-ledger-heading"><div><h2 id="cash-ledger-title">Today's entries</h2><p>Newest recorded entry first. Every entry remains in the ledger.</p></div><span class="ledger-count">2 entries</span></div>
        ${ledgerTable(openRows)}
      </section>
    </div>
    <section class="summary-panel unavailable-examples" aria-labelledby="unavailable-title" data-od-id="amend-unavailable-states">
      <h2 id="unavailable-title">When Amend is unavailable</h2><p>The action stays visible but disabled, with a plain-language explanation.</p>
      <div class="failure-grid">
        <div><h3>Closed day</h3>${ledgerTable(closedRow, 'Closed day entry, amendment unavailable')}</div>
        <div><h3>Already superseded</h3>${ledgerTable(supersededRow, 'Superseded entry, amendment unavailable')}</div>
      </div>
    </section>
  </section>`;
}

function amendmentForm() {
  const expense = draft.kind === 'EXPENSE';
  return `<section class="staff-inventory-panel staff-cash-entry-panel" aria-labelledby="amend-entry-title" data-od-id="amend-entry-panel">
    <header><h2 id="amend-entry-title">Amend entry</h2><p>Enter the corrected values in full.</p></header>
    <div class="original-card" aria-labelledby="original-title">
      <h3 id="original-title">Original entry, ${original.id}</h3>
      <dl class="value-grid"><div><dt>Type</dt><dd>Cash in</dd></div><div><dt>Amount</dt><dd class="money-value">₱100.00</dd></div><div><dt>Description</dt><dd>Change float top-up</dd></div><div><dt>Category</dt><dd>Not applicable</dd></div></dl>
    </div>
    <form id="amend-form" novalidate>
      <fieldset class="staff-cash-type"><legend>Correct type <span class="staff-inventory-required" aria-hidden="true">*</span></legend>
        <div class="staff-cash-type-options">
          ${['CASH_IN','CASH_OUT','EXPENSE'].map(kind => `<label><input type="radio" name="kind" value="${kind}" ${draft.kind === kind ? 'checked' : ''}><span><strong>${kindLabel(kind)}</strong><small>${kind === 'CASH_IN' ? 'Adds to drawer' : 'Reduces drawer'}</small>${draft.kind === kind ? '<em>Selected</em>' : ''}</span></label>`).join('')}
        </div>
      </fieldset>
      <div class="staff-inventory-field"><label for="amend-amount">Correct amount <span class="staff-inventory-required" aria-hidden="true">*</span></label><div class="staff-cash-amount-input"><span aria-hidden="true">₱</span><input id="amend-amount" name="amount" type="text" inputmode="decimal" value="${draft.amount}" required aria-required="true" aria-describedby="amend-amount-help"></div><p class="staff-cash-field-help" id="amend-amount-help">Enter a positive peso amount. Direction comes from the type.</p></div>
      <div class="staff-inventory-field"><label for="amend-description">Correct description <span class="staff-inventory-required" aria-hidden="true">*</span></label><textarea id="amend-description" name="description" required aria-required="true">${draft.description}</textarea></div>
      <div class="staff-cash-category-slot" id="category-slot">
        ${expense ? `<div class="staff-inventory-field"><label for="amend-category">Category <span class="staff-inventory-helper">(optional)</span></label><input id="amend-category" name="category" type="text" value="${draft.category}" placeholder="e.g. Supplies"><p class="staff-cash-field-help">Category is accepted only for an expense.</p></div>` : `<p class="staff-cash-category-note" role="status">Category is not available for ${kindLabel(draft.kind)}. Any expense category is cleared when the type changes.</p>`}
      </div>
      <p class="staff-cash-permanence"><strong>The original stays visible.</strong> This records one linked correction. It does not edit or delete ${original.id}.</p>
      <div class="staff-inventory-actions"><button class="staff-inventory-button primary" type="submit">Review correction</button><button class="staff-inventory-button secondary" type="button" data-cancel>Cancel, record nothing</button></div>
    </form>
  </section>`;
}

function renderAmend() {
  dayChip.textContent = 'Day open'; dayChip.className = 'chip chip--open';
  const row = basicRow({ id: original.id, kind: original.kind, amount: original.amount, detail: original.description, by: original.by, time: original.time, action: 'Amendment in progress.' });
  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">${stateHeading('2. Enter corrected values', 'The original remains beside the form for comparison.')}${dayContext()}<div class="staff-cash-layout">${amendmentForm()}<section class="staff-cash-ledger" aria-labelledby="cash-ledger-title"><div class="staff-cash-ledger-heading"><div><h2 id="cash-ledger-title">Today's entries</h2><p>The selected entry remains visible while it is corrected.</p></div><span class="ledger-count">Selected: ${original.id}</span></div>${ledgerTable(row)}</section></div></section>`;
}

function compareItem(label, oldValue, newValue) {
  const changed = oldValue !== newValue;
  return `<div class="${changed ? 'changed' : ''}"><dt>${label}</dt><dd>${newValue}</dd>${changed ? '<span class="change-note">Changed</span>' : '<span class="change-note">Unchanged</span>'}</div>`;
}

function recordedItem(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd><span class="change-note">Recorded value</span></div>`;
}

function renderReview() {
  const newCategory = draft.kind === 'EXPENSE' ? (draft.category || 'None') : 'Not applicable';
  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">${stateHeading('3. Review before confirming', 'Changed fields receive emphasis. Unchanged fields stay quiet.')}${dayContext()}
    <section class="staff-inventory-panel" aria-labelledby="review-correction-title" data-od-id="review-correction-panel">
      <header><h2 id="review-correction-title">Review correction</h2><p role="status">Nothing has been recorded yet. Compare both records before confirming.</p></header>
      <div class="compare-grid">
        <section class="compare-column" aria-labelledby="original-values-title"><h3 id="original-values-title">Original, ${original.id}</h3><dl class="compare-list">${recordedItem('Type', kindLabel(original.kind))}${recordedItem('Amount', '₱' + original.amount)}${recordedItem('Description', original.description)}${recordedItem('Category', original.category)}</dl></section>
        <section class="compare-column proposed" aria-labelledby="corrected-values-title"><h3 id="corrected-values-title">Proposed correction</h3><dl class="compare-list">${compareItem('Type', kindLabel(original.kind), kindLabel(draft.kind))}${compareItem('Amount', '₱' + original.amount, '₱' + Number(draft.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}))}${compareItem('Description', original.description, draft.description)}${compareItem('Category', original.category, newCategory)}</dl></section>
      </div>
      <p class="review-assurance"><strong>Confirm records one correction.</strong> The original stays in the ledger, and only the effective correction counts in totals.</p>
      <div class="staff-inventory-actions"><button class="staff-inventory-button primary" type="button" data-confirm>Confirm correction</button><button class="staff-inventory-button secondary" type="button" data-back>Edit corrected values</button><button class="staff-inventory-button secondary" type="button" data-cancel>Cancel, record nothing</button></div>
    </section>
  </section>`;
}

function correctedRows() {
  return [
    basicRow({ id: 'CM-1862', kind: 'CASH_OUT', amount: '100.00', detail: 'Supplier float was removed from drawer', by: 'Noel Pascual', time: '11:42 AM', className: 'correction-row chain-group', link: 'Corrects CM-1859. Effective amount: ₱100.00 Cash out.', position: 'Correction 1 of 1' }),
    basicRow({ id: 'CM-1859', kind: 'CASH_IN', amount: '100.00', detail: 'Supplier float received', by: 'Noel Pascual', time: '11:36 AM', status: 'Superseded', className: 'superseded-row', link: 'Corrected by CM-1862 to ₱100.00 Cash out.', position: 'Original', action: 'Already corrected by CM-1862.' }),
    basicRow({ id: 'CM-1858', kind: 'EXPENSE', amount: '90.00', detail: 'Supplies / Replacement cleaning cloths', by: 'Marilou Bagtas', time: '10:31 AM', className: 'correction-row chain-group', link: 'Corrects CM-1856. Effective amount: ₱90.00 Expense.', position: 'Correction 3 of 3' }),
    basicRow({ id: 'CM-1856', kind: 'EXPENSE', amount: '80.00', detail: 'Supplies / Cleaning cloths', by: 'Marilou Bagtas', time: '10:26 AM', status: 'Superseded', className: 'superseded-row', link: 'Corrects CM-1854. Corrected again by CM-1858 to ₱90.00 Expense.', position: 'Correction 2 of 3', action: 'Already corrected by CM-1858.' }),
    basicRow({ id: 'CM-1854', kind: 'CASH_OUT', amount: '80.00', detail: 'Cleaning cloths', by: 'Marilou Bagtas', time: '10:19 AM', status: 'Superseded', className: 'superseded-row', link: 'Corrects CM-1851. Corrected again by CM-1856.', position: 'Correction 1 of 3', action: 'Already corrected by CM-1856.' }),
    basicRow({ id: 'CM-1851', kind: 'CASH_OUT', amount: '100.00', detail: 'Cleaning supplies', by: 'Marilou Bagtas', time: '10:12 AM', status: 'Superseded', className: 'superseded-row', link: 'Corrected by CM-1854. Final effective entry is CM-1858, ₱90.00 Expense.', position: 'Original', action: 'Already corrected by CM-1854.' }),
    basicRow({ id: 'CM-1848', kind: draft.kind, amount: Number(draft.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}), detail: draft.kind === 'EXPENSE' && draft.category ? `${draft.category} / ${draft.description}` : draft.description, by: 'Marilou Bagtas', time: '9:22 AM', className: 'correction-row chain-group', link: `Corrects ${original.id}. Effective amount: ₱${Number(draft.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})} ${kindLabel(draft.kind)}.`, position: 'Correction 1 of 1' }),
    basicRow({ id: original.id, kind: original.kind, amount: original.amount, detail: original.description, by: original.by, time: original.time, status: 'Superseded', className: 'superseded-row', link: `Corrected by CM-1848 to ₱${Number(draft.amount).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})} ${kindLabel(draft.kind)}.`, position: 'Original', action: 'Already corrected by CM-1848.' })
  ].join('');
}

function renderLedger() {
  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">${stateHeading('4. Read corrections in the ledger', 'All linked rows remain visible. Newest recorded entry stays first.')}${dayContext()}<section class="staff-cash-ledger" aria-labelledby="cash-ledger-title" data-od-id="staff-cash-ledger"><div class="staff-cash-ledger-heading"><div><h2 id="cash-ledger-title">Today's entries</h2><p>Status and link text explain each pair and chain without relying on color.</p></div><span class="ledger-count">8 entries, 3 effective</span></div>${ledgerTable(correctedRows(), 'Ledger containing corrected pairs, an amendment chain, and a cross-type correction')}</section></section>`;
}

function renderTotals() {
  const rows = [
    basicRow({ id: original.id, kind: 'CASH_IN', amount: '100.00', detail: 'Change float top-up', by: original.by, time: original.time, status: 'Superseded', className: 'superseded-row', link: 'Excluded from totals. Corrected by CM-1848.', action: 'Already corrected by CM-1848.' }),
    basicRow({ id: 'CM-1848', kind: 'CASH_IN', amount: '80.00', detail: 'Correct change float', by: original.by, time: '9:22 AM', className: 'correction-row', link: 'Included once in totals. Corrects CM-1847.' })
  ].join('');
  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">${stateHeading('5. Correction counts once', 'Totals use effective entries supplied by the server.')}${dayContext()}
    <div class="staff-cash-layout">
      <section class="summary-panel" aria-labelledby="summary-title" data-od-id="cash-summary"><h2 id="summary-title">Cash summary</h2><p>Amended totals for Sunday, August 23, 2026.</p><div class="summary-grid"><div class="summary-item"><span>Opening cash</span><strong>₱5,000.00</strong></div><div class="summary-item"><span>Cash in</span><strong>₱80.00</strong></div><div class="summary-item"><span>Cash out</span><strong>₱500.00</strong></div><div class="summary-item expected"><span>Expected cash</span><strong>₱4,580.00</strong></div></div><p class="equation">Expected cash: <strong>₱5,000.00 + ₱80.00 - ₱500.00 = ₱4,580.00</strong></p><p class="counting-note">CM-1847 is superseded and contributes ₱0.00. CM-1848 contributes ₱80.00 once. The pair does not total ₱180.00.</p></section>
      <section class="staff-cash-ledger" aria-labelledby="total-ledger-title"><div class="staff-cash-ledger-heading"><div><h2 id="total-ledger-title">Rows behind Cash in</h2><p>Both records remain visible even though only one is effective.</p></div></div>${ledgerTable(rows, 'Cash in rows showing which entry counts in totals')}</section>
    </div>
  </section>`;
}

function renderFailures() {
  mount.innerHTML = `<section class="state-frame" aria-labelledby="state-title">${stateHeading('6. Failure and conflict states', 'Every rejection records nothing and leaves totals unchanged.')}${dayContext()}
    <div id="failure-live" class="message" role="status" aria-live="polite"><h3>Choose a scenario</h3><p>The result will appear here. No scenario changes the ledger or totals.</p></div>
    <div class="failure-grid">
      <section class="failure-card"><h3>409: day closed</h3><p>The day closes after review but before confirmation reaches the server.</p><button class="staff-inventory-button secondary" type="button" data-failure="closed">Show day-closed conflict</button></section>
      <section class="failure-card"><h3>409: entry already corrected</h3><p>Another staff member corrects CM-1847 first. The response includes CM-1848.</p><button class="staff-inventory-button secondary" type="button" data-failure="superseded">Show correction conflict</button></section>
      <section class="failure-card"><h3>400: invalid values</h3><p>Amount is not positive, description is blank, and category is sent for Cash out.</p><button class="staff-inventory-button secondary" type="button" data-failure="validation">Show validation errors</button></section>
      <section class="failure-card"><h3>After any rejection</h3><p>The original ledger and cash summary remain exactly as they were.</p><button class="staff-inventory-button secondary" type="button" data-state="totals">View unchanged totals</button></section>
    </div>
    <div id="validation-preview"></div>
  </section>`;
}

function validationPreview() {
  return `<section class="staff-inventory-panel" aria-labelledby="invalid-title"><header><h2 id="invalid-title">Correct the highlighted fields</h2><p role="alert">Three fields need attention. No correction was recorded.</p></header>
    <div class="staff-inventory-field"><label for="invalid-amount">Correct amount <span class="staff-inventory-required" aria-hidden="true">*</span></label><div class="staff-cash-amount-input"><span aria-hidden="true">₱</span><input id="invalid-amount" type="text" value="0.00" aria-invalid="true" aria-describedby="invalid-amount-error"></div><p class="staff-inventory-field-error" id="invalid-amount-error">Enter an amount greater than ₱0.00 with up to two decimal places.</p></div>
    <div class="staff-inventory-field"><label for="invalid-description">Correct description <span class="staff-inventory-required" aria-hidden="true">*</span></label><textarea id="invalid-description" aria-invalid="true" aria-describedby="invalid-description-error">   </textarea><p class="staff-inventory-field-error" id="invalid-description-error">Enter a description containing at least one non-space character.</p></div>
    <div class="staff-inventory-field"><label for="invalid-category">Category</label><input id="invalid-category" type="text" value="Supplies" disabled aria-invalid="true" aria-describedby="invalid-category-error"><p class="staff-inventory-field-error" id="invalid-category-error">Category is accepted only for Expense. Clear it or change the type to Expense.</p></div>
  </section>`;
}

function setState(name, shouldAnnounce = true) {
  const renderers = { affordance: renderAffordance, amend: renderAmend, review: renderReview, ledger: renderLedger, totals: renderTotals, failures: renderFailures };
  const selected = renderers[name] ? name : 'affordance';
  dayChip.textContent = 'Day open';
  dayChip.className = 'chip chip--open';
  renderers[selected]();
  stateButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === selected)));
  history.replaceState(null, '', `#${selected}`);
  if (shouldAnnounce) announce(`${selected} state shown.`);
}

document.addEventListener('click', event => {
  const stateButton = event.target.closest('[data-state]');
  if (stateButton) { event.preventDefault(); setState(stateButton.dataset.state); return; }
  const amendButton = event.target.closest('[data-amend-id]');
  if (amendButton) { setState('amend'); return; }
  if (event.target.closest('[data-cancel]')) { setState('affordance'); announce('Correction cancelled. Nothing was recorded.'); return; }
  if (event.target.closest('[data-back]')) { setState('amend'); return; }
  if (event.target.closest('[data-confirm]')) { setState('ledger'); announce('Correction recorded once. The original remains visible and is now superseded.'); return; }
  const failure = event.target.closest('[data-failure]');
  if (failure) showFailure(failure.dataset.failure);
});

document.addEventListener('change', event => {
  if (event.target.matches('#amend-form input[name="kind"]')) {
    const form = event.target.form;
    draft.amount = form.elements.amount.value;
    draft.description = form.elements.description.value;
    draft.category = form.elements.category?.value || '';
    draft.kind = event.target.value;
    if (draft.kind !== 'EXPENSE') draft.category = '';
    renderAmend();
    announce(draft.kind === 'EXPENSE' ? 'Expense selected. Category is now available.' : `${kindLabel(draft.kind)} selected. Category was cleared and is no longer available.`);
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'amend-form') return;
  event.preventDefault();
  const form = event.target;
  const amount = form.elements.amount.value.trim();
  const description = form.elements.description.value.trim();
  const amountNumber = Number(amount);
  if (!amount || !Number.isFinite(amountNumber) || amountNumber <= 0 || !description) {
    setState('failures');
    showFailure('validation');
    return;
  }
  draft.amount = amountNumber.toFixed(2);
  draft.description = description;
  draft.category = draft.kind === 'EXPENSE' ? (form.elements.category?.value.trim() || '') : '';
  setState('review');
  announce('Review step shown. Nothing has been recorded yet.');
});

function showFailure(type) {
  const box = document.querySelector('#failure-live');
  const validation = document.querySelector('#validation-preview');
  if (!box || !validation) return;
  validation.innerHTML = '';
  box.className = 'message error';
  if (type === 'closed') {
    dayChip.textContent = 'Day closed'; dayChip.className = 'chip chip--closed';
    box.innerHTML = '<h3>The business day closed before confirmation</h3><p>No correction was recorded. The recorded close and totals did not change. Return to Cash & Expenses to view the closed day as read only.</p>';
  } else if (type === 'superseded') {
    box.className = 'message warning';
    box.innerHTML = '<h3>CM-1847 was already corrected</h3><p>No correction was recorded. Refresh the ledger to see superseding entry CM-1848. Do not retry this amendment.</p><div class="staff-inventory-actions"><button class="staff-inventory-button secondary" type="button" data-state="ledger">Refresh and view CM-1848</button></div>';
  } else {
    box.innerHTML = '<h3>Correct the highlighted fields</h3><p>No correction was recorded. The ledger and totals are unchanged.</p>';
    validation.innerHTML = validationPreview();
    window.setTimeout(() => document.querySelector('#invalid-amount')?.focus(), 20);
  }
  announce(box.textContent.trim());
}

setState(location.hash.slice(1) || 'affordance', false);
