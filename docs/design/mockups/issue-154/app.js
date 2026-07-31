(function () {
  'use strict';

  var PESO = '₱';
  var MAX_CENTS = 2147483647;
  var DAY = { dateLabel: 'Thu, Jul 23 2026', typeLabel: 'Normal day', open: true };
  var ACTIVE_STAFF = [
    { id: 's-01', name: 'Marilou Bagtas' },
    { id: 's-02', name: 'Renz Villafuerte' },
    { id: 's-03', name: 'Jhoanna Sarmiento' }
  ];

  var SAMPLE_ENTRIES = [
    { id: 'e-07', type: 'expense', amountCents: 6850, reason: 'Taxi fare after late closing', category: 'Transport', by: { name: 'Benjie Cruz', note: 'Inactive staff' }, recordedAt: '8:42 PM' },
    { id: 'e-06', type: 'cashOut', amountCents: 50000, reason: 'Bank deposit pickup', category: '', by: { name: 'Rina Lopez', note: 'Now Rina Santos' }, recordedAt: '6:10 PM' },
    { id: 'e-05', type: 'expense', amountCents: 13750, reason: 'Emergency ice purchase', category: '', by: null, recordedAt: '3:18 PM' },
    { id: 'e-04', type: 'expense', amountCents: 42000, reason: 'Oat milk delivery', category: 'Supplies', by: { name: 'Jhoanna Sarmiento' }, recordedAt: '1:06 PM' },
    { id: 'e-03', type: 'cashIn', amountCents: 100000, reason: 'Additional bank change', category: '', by: { name: 'Marilou Bagtas' }, recordedAt: '11:14 AM' },
    { id: 'e-02', type: 'cashOut', amountCents: 25000, reason: 'Petty cash transfer', category: '', by: null, recordedAt: '9:35 AM' },
    { id: 'e-01', type: 'cashIn', amountCents: 200000, reason: 'Opening drawer top-up', category: '', by: { name: 'Renz Villafuerte' }, recordedAt: '7:02 AM' }
  ];

  var state = {
    review: 'cash-in',
    dayOpen: true,
    form: { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' },
    errors: {},
    entries: SAMPLE_ENTRIES.slice(),
    submitting: false,
    confirmation: '',
    rejection: '',
    forceEmptyLedger: false,
    submitTimer: null
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function peso(cents) {
    var n = Math.abs(Number(cents));
    var whole = Math.floor(n / 100);
    var fraction = n % 100;
    return PESO + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (fraction < 10 ? '0' : '') + fraction;
  }

  function parseMoneyToCents(raw) {
    var value = String(raw == null ? '' : raw).trim();
    if (value === '') return { kind: 'blank' };
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return { kind: 'format' };
    var parts = value.split('.');
    var whole = Number(parts[0]);
    var decimal = (parts[1] || '') + '00';
    var cents = whole * 100 + Number(decimal.slice(0, 2));
    if (!Number.isSafeInteger(cents)) return { kind: 'over' };
    if (cents === 0) return { kind: 'zero' };
    if (cents > MAX_CENTS) return { kind: 'over' };
    return { kind: 'valid', cents: cents };
  }

  function staffOptions(selected) {
    var html = '<option value="">No one selected (optional)</option>';
    ACTIVE_STAFF.forEach(function (staff) {
      html += '<option value="' + staff.id + '"' + (staff.id === selected ? ' selected' : '') + '>' + esc(staff.name) + '</option>';
    });
    return html;
  }

  function selectedStaffSnapshot() {
    for (var i = 0; i < ACTIVE_STAFF.length; i += 1) {
      if (ACTIVE_STAFF[i].id === state.form.byId) return { name: ACTIVE_STAFF[i].name };
    }
    return null;
  }

  function typeLabel(type) {
    if (type === 'cashIn') return 'Cash in';
    if (type === 'cashOut') return 'Cash out';
    return 'Expense';
  }

  function typeCard(value, label, checked) {
    return '<label class="type-card">'
      + '<input type="radio" name="entry-type" value="' + value + '" required aria-required="true"' + (checked ? ' checked' : '') + (state.submitting ? ' disabled' : '') + '>'
      + '<span class="radio-mark" aria-hidden="true"></span>'
      + '<span>' + label + '<span class="selected-word"> Selected</span></span>'
      + '</label>';
  }

  function fieldError(name) {
    return state.errors[name] ? '<span class="field-error" id="error-' + name + '">' + esc(state.errors[name]) + '</span>' : '';
  }

  function fieldAria(name, helpId) {
    var described = [helpId];
    if (state.errors[name]) described.push('error-' + name);
    return ' aria-describedby="' + described.join(' ') + '"' + (state.errors[name] ? ' aria-invalid="true"' : '');
  }

  function messageHtml() {
    if (state.rejection) {
      return '<div class="msg msg--error state-enter" role="alert"><h3>Entry not recorded</h3><p>' + esc(state.rejection) + '</p><p>Nothing was added to the ledger.</p></div>';
    }
    if (state.confirmation) {
      return '<div class="msg msg--success state-enter" role="status"><h3>Entry recorded</h3><p>' + esc(state.confirmation) + '</p></div>';
    }
    return '';
  }

  function formHtml() {
    var f = state.form;
    var expense = f.type === 'expense';
    var busy = state.submitting;
    return '<section class="panel" aria-labelledby="record-title" data-od-id="record-entry-panel">'
      + '<div class="panel-head"><h2 id="record-title">Record an entry</h2><p>Every entry is permanent and belongs to the currently open business day.</p></div>'
      + '<div class="day-context" aria-label="Entry business day">'
      + '<span class="context-label">This entry will be written to</span>'
      + '<span class="context-chip">' + DAY.dateLabel + '</span><span class="context-chip">' + DAY.typeLabel + '</span></div>'
      + messageHtml()
      + '<form id="entry-form" novalidate>'
      + '<fieldset class="field"><legend class="field-label">Type <span class="req">Required</span></legend>'
      + '<div class="type-options" role="radiogroup" aria-label="Entry type">'
      + typeCard('cashIn', 'Cash in', f.type === 'cashIn') + typeCard('cashOut', 'Cash out', f.type === 'cashOut') + typeCard('expense', 'Expense', expense)
      + '</div><span class="field-help">Cash in adds to the drawer. Cash out and Expense reduce it.</span></fieldset>'
      + '<div class="field' + (state.errors.amount ? ' is-invalid' : '') + '"><label class="field-label" for="amount">Amount <span class="req">Required</span></label>'
      + '<div class="money-input"><span class="peso" aria-hidden="true">' + PESO + '</span><input id="amount" name="amount" type="text" inputmode="decimal" required aria-required="true" placeholder="0.00" value="' + esc(f.amountRaw) + '"' + fieldAria('amount', 'amount-help') + (busy ? ' disabled' : '') + '></div>'
      + '<span class="field-help" id="amount-help">From ₱0.01 to ₱21,474,836.47. Use no more than 2 decimal places.</span>' + fieldError('amount') + '</div>'
      + '<div class="field category-slot' + (expense ? '' : ' is-reserved') + '" aria-hidden="' + String(!expense) + '"><label class="field-label" for="category">Category <span class="opt">Optional</span></label>'
      + '<input id="category" name="category" type="text" placeholder="supplies, transport" value="' + esc(f.category) + '"' + (!expense || busy ? ' disabled' : '') + '><span class="field-help">Shown only for expenses.</span></div>'
      + '<div class="field' + (state.errors.reason ? ' is-invalid' : '') + '"><label class="field-label" for="reason">Reason <span class="req">Required</span></label>'
      + '<textarea id="reason" name="reason" required aria-required="true" placeholder="bank change, milk delivery payment"' + fieldAria('reason', 'reason-help') + (busy ? ' disabled' : '') + '>' + esc(f.reason) + '</textarea>'
      + '<span class="field-help" id="reason-help">Say what the money movement was for.</span>' + fieldError('reason') + '</div>'
      + '<div class="field"><label class="field-label" for="recorded-by">Recorded by <span class="opt">Optional</span></label>'
      + '<select id="recorded-by" name="recorded-by" aria-describedby="by-help"' + (busy ? ' disabled' : '') + '>' + staffOptions(f.byId) + '</select><span class="field-help" id="by-help">Active staff only. Leaving this unselected records Unattributed.</span></div>'
      + '<p class="permanence-note"><strong>Permanent record.</strong> Check the amount and reason before recording. Entries cannot be edited, deleted or undone.</p>'
      + '<div class="form-actions"><button type="submit" class="btn btn--primary"' + (busy ? ' disabled aria-disabled="true"' : '') + '>' + (busy ? 'Recording...' : 'Record') + '</button>'
      + (busy ? '<span class="busy-note">One entry is being recorded. The form is locked to prevent duplicates.</span>' : '') + '</div></form></section>';
  }

  function detailHtml(entry) {
    if (entry.type === 'expense' && entry.category) {
      return '<span class="detail-category">' + esc(entry.category) + '</span><span class="detail-separator"> / </span><span class="detail-main">' + esc(entry.reason) + '</span>';
    }
    return '<span class="detail-main">' + esc(entry.reason) + '</span>';
  }

  function byHtml(entry) {
    if (!entry.by) return '<span class="unattributed">Unattributed</span>';
    return '<span class="by-name">' + esc(entry.by.name) + '</span>' + (entry.by.note ? '<span class="by-note">' + esc(entry.by.note) + '</span>' : '');
  }

  function ledgerRows() {
    return state.entries.map(function (entry) {
      var adds = entry.type === 'cashIn';
      return '<tr data-od-id="ledger-row-' + esc(entry.id) + '"><td><span class="type-badge" data-type="' + esc(entry.type) + '"><span class="direction" aria-hidden="true">' + (adds ? '+' : '−') + '</span>' + esc(typeLabel(entry.type)) + '</span></td>'
        + '<td class="money"><span class="sr-only">' + (adds ? 'adds ' : 'reduces drawer by ') + '</span>' + peso(entry.amountCents) + '</td>'
        + '<td>' + detailHtml(entry) + '<span class="by-note">Recorded ' + esc(entry.recordedAt) + '</span></td><td>' + byHtml(entry) + '</td></tr>';
    }).join('');
  }

  function ledgerHtml() {
    var entries = state.forceEmptyLedger ? [] : state.entries;
    var body = entries.length
      ? '<div class="table-scroll" tabindex="0" role="region" aria-labelledby="ledger-title" aria-describedby="ledger-order-note"><table><caption class="sr-only">Cash and expense entries for ' + DAY.dateLabel + ', newest first</caption><thead><tr><th scope="col">Type</th><th scope="col" class="money">Amount</th><th scope="col">Detail</th><th scope="col">By</th></tr></thead><tbody>' + ledgerRows() + '</tbody></table></div><p class="scroll-hint">Scroll the table sideways to see every column.</p>'
      : '<div class="empty-state"><h3>No entries yet</h3><p>Cash movements and expenses recorded for this business day will appear here, newest first.</p></div>';
    return '<section class="panel ledger-panel" aria-labelledby="ledger-title" data-od-id="current-day-ledger"><div class="ledger-heading"><div><h2 id="ledger-title">Current business day ledger</h2><p id="ledger-order-note">Newest recorded entry appears first. Rows are permanent and read only.</p></div><p class="ledger-count" role="status" aria-live="polite">' + entries.length + ' ' + (entries.length === 1 ? 'entry' : 'entries') + '</p></div>' + body + '</section>';
  }

  function noDayHtml() {
    return messageHtml() + '<div class="msg msg--blocking state-enter" data-od-id="no-day-open"><h2>No business day is open.</h2><p>Cash and expense entries can only be recorded against the currently open business day.</p><p>Open one on <a href="#/pos/open">Open Day</a>, then return here.</p></div>';
  }

  function render() {
    var mount = $('#screen-mount');
    mount.innerHTML = state.dayOpen ? '<div class="production-grid">' + formHtml() + ledgerHtml() + '</div>' : noDayHtml();
    $('#header-day-state').textContent = state.dayOpen ? 'Day open' : 'No day open';
    $('#header-day-state').className = 'chip' + (state.dayOpen ? ' chip--open' : '');
    wireProduction();
    syncReviewButtons();
  }

  function wireProduction() {
    var form = $('#entry-form');
    if (!form) return;
    $$('input[name="entry-type"]', form).forEach(function (radio) {
      radio.addEventListener('change', function (event) {
        state.form.type = event.target.value;
        state.errors = {};
        state.confirmation = '';
        state.rejection = '';
        render();
        var selected = $('input[name="entry-type"]:checked');
        if (selected) selected.focus();
      });
    });
    $('#amount').addEventListener('input', function (event) { state.form.amountRaw = event.target.value; });
    $('#category').addEventListener('input', function (event) { state.form.category = event.target.value; });
    $('#reason').addEventListener('input', function (event) { state.form.reason = event.target.value; });
    $('#recorded-by').addEventListener('change', function (event) { state.form.byId = event.target.value; });
    form.addEventListener('submit', submitEntry);
  }

  function validate() {
    var errors = {};
    var amount = parseMoneyToCents(state.form.amountRaw);
    if (amount.kind === 'blank') errors.amount = 'Enter an amount from ₱0.01 to ₱21,474,836.47.';
    else if (amount.kind === 'zero') errors.amount = 'Amount must be at least ₱0.01.';
    else if (amount.kind === 'over') errors.amount = 'Amount must not exceed ₱21,474,836.47.';
    else if (amount.kind === 'format') errors.amount = 'Enter a positive number with no more than 2 decimal places.';
    if (state.form.reason.trim() === '') errors.reason = 'Enter a reason. Spaces alone do not count.';
    return { errors: errors, amount: amount };
  }

  function submitEntry(event) {
    event.preventDefault();
    if (state.submitting) return;
    var result = validate();
    state.errors = result.errors;
    state.confirmation = '';
    state.rejection = '';
    if (Object.keys(result.errors).length) {
      render();
      announce('Entry not recorded. Fix the marked fields.');
      var firstInvalid = $('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    state.submitting = true;
    render();
    announce('Recording one entry. The form is locked.');
    state.submitTimer = window.setTimeout(function () {
      if (!state.dayOpen) {
        state.submitting = false;
        state.rejection = 'The business day closed before the write completed. Reopen is not available, so this entry was rejected.';
        render();
        announce('Entry not recorded because the business day closed.');
        return;
      }
      var entry = {
        id: 'e-new-' + String(Date.now()), type: state.form.type, amountCents: result.amount.cents,
        reason: state.form.reason.trim(), category: state.form.type === 'expense' ? state.form.category.trim() : '',
        by: selectedStaffSnapshot(), recordedAt: 'Just now'
      };
      state.entries.unshift(entry);
      state.form = { type: state.form.type, amountRaw: '', category: '', reason: '', byId: '' };
      state.errors = {};
      state.submitting = false;
      state.confirmation = typeLabel(entry.type) + ' for ' + peso(entry.amountCents) + ' was added as the first row.';
      state.review = 'recorded';
      state.forceEmptyLedger = false;
      render();
      announce('Entry recorded once and added to the top of the ledger.');
    }, 900);
  }

  function announce(message) {
    var live = $('#cash-live');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = message; }, 30);
  }

  function clearPendingTimer() {
    if (state.submitTimer) window.clearTimeout(state.submitTimer);
    state.submitTimer = null;
  }

  function resetCommon(name) {
    clearPendingTimer();
    state.review = name;
    state.dayOpen = true;
    state.errors = {};
    state.submitting = false;
    state.confirmation = '';
    state.rejection = '';
    state.forceEmptyLedger = false;
  }

  function applyReview(name) {
    resetCommon(name);
    if (name === 'empty-form' || name === 'cash-in') state.form = { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' };
    if (name === 'cash-out') state.form = { type: 'cashOut', amountRaw: '', category: '', reason: '', byId: '' };
    if (name === 'expense') state.form = { type: 'expense', amountRaw: '', category: '', reason: '', byId: '' };
    if (name === 'filled') state.form = { type: 'expense', amountRaw: '725.50', category: 'Supplies', reason: 'Milk delivery payment', byId: 's-01' };
    if (name === 'invalid') {
      state.form = { type: 'cashOut', amountRaw: '-25.999', category: '', reason: '   ', byId: '' };
      state.errors = validate().errors;
    }
    if (name === 'submitting') {
      state.form = { type: 'cashIn', amountRaw: '500.00', category: '', reason: 'Additional bank change', byId: 's-02' };
      state.submitting = true;
    }
    if (name === 'recorded') {
      state.form = { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' };
      state.confirmation = 'Cash in for ₱500.00 was added as the first row.';
    }
    if (name === 'rejected') {
      state.form = { type: 'expense', amountRaw: '320.00', category: 'Supplies', reason: 'Cleaning materials', byId: 's-03' };
      state.dayOpen = false;
      state.rejection = 'The business day closed before the write completed. Reopen is not available, so this entry was rejected.';
    }
    if (name === 'ledger') state.form = { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' };
    if (name === 'ledger-empty') {
      state.form = { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' };
      state.forceEmptyLedger = true;
    }
    if (name === 'no-day') {
      state.dayOpen = false;
      state.form = { type: 'cashIn', amountRaw: '', category: '', reason: '', byId: '' };
    }
    render();
  }

  function syncReviewButtons() {
    $$('[data-review]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.review === state.review)); });
  }

  $$('[data-review]').forEach(function (button) { button.addEventListener('click', function () { applyReview(button.dataset.review); }); });
  document.addEventListener('click', function (event) {
    var inert = event.target.closest ? event.target.closest('a[aria-disabled="true"]') : null;
    if (inert) event.preventDefault();
  });
  window.addEventListener('hashchange', function () {
    if (window.location.hash !== '#/pos/cash') window.location.hash = '/pos/cash';
  });
  if (window.location.hash !== '#/pos/cash') window.location.hash = '/pos/cash';
  render();
}());
