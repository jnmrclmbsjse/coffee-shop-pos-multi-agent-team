/* UCM Coffee Studio — staff POS workspace
   Open business day (#/pos/open) and Close business day (#/pos/close)

   Prototype only. All data is in-memory, obviously fictional, and resets on
   reload. No network requests, no packages, no build step.

   Money is held as INTEGER CENTS everywhere. There are no floats in this file
   except inside parseMoneyToCents, where a string is converted once and
   immediately rounded to an integer.
*/
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Money
   * ------------------------------------------------------------------ */

  var PESO = '₱'; // ₱

  function peso(cents) {
    var n = Math.abs(cents | 0);
    var whole = Math.floor(n / 100);
    var frac = n % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return PESO + s + '.' + (frac < 10 ? '0' + frac : String(frac));
  }

  /* Signed money for the cash summary. The sign is a property of the ROW's
     direction, not of the value, so it is rendered separately from the amount
     and stays put at zero. See DESIGN.md. */
  function parseMoneyToCents(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/,/g, '');
    if (s === '') return null;                     // not entered
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;  // not a valid non-negative amount
    var parts = s.split('.');
    var frac = (parts[1] || '') + '00';
    return parseInt(parts[0], 10) * 100 + parseInt(frac.slice(0, 2), 10);
  }

  /* ------------------------------------------------------------------ *
   * Fictional sample data
   * ------------------------------------------------------------------ */

  var STAFF = [
    { id: 's-01', name: 'Marilou Bagtas', active: true },
    { id: 's-02', name: 'Renz Villafuerte', active: true },
    { id: 's-03', name: 'Jhoanna Sarmiento', active: true },
    { id: 's-04', name: 'Dexter Ilagan', active: true },
    { id: 's-90', name: 'Kiko Panganiban', active: false }, // never offered
    { id: 's-91', name: 'Aileen Mabborang', active: false } // never offered
  ];

  function activeStaff() {
    return STAFF.filter(function (s) { return s.active; });
  }
  function staffName(id) {
    for (var i = 0; i < STAFF.length; i++) if (STAFF[i].id === id) return STAFF[i].name;
    return '';
  }

  /* Business dates that already belong to an open or a closed day. */
  var USED_DATES = {
    '2026-07-20': 'closed',
    '2026-07-21': 'closed',
    '2026-07-22': 'closed'
  };

  /* Cup / lid rows. expected / actual are QUANTITIES (never money), and null
     means genuinely unknown — distinct from a recorded 0. */
  function reconRows(hasClosingCount) {
    var rows = [
      { item: '12 oz hot cup', sub: 'Packaging · cup', expected: 240, actual: 236 },
      { item: '16 oz cold cup', sub: 'Packaging · cup', expected: null, actual: 180,
        expectedWhy: 'no opening count' },
      { item: '12 oz sip lid', sub: 'Packaging · lid', expected: 0, actual: 0 },
      { item: '16 oz dome lid', sub: 'Packaging · lid', expected: 150, actual: null,
        actualWhy: 'not in count' },
      { item: '8 oz espresso cup', sub: 'Packaging · cup', expected: 96, actual: 98 }
    ];
    if (!hasClosingCount) {
      rows.forEach(function (r) { r.actual = null; r.actualWhy = 'no closing count'; });
    }
    return rows;
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var state = {
    route: '/pos/open',

    // ---- Open screen ----
    openReview: 'empty',       // empty | filled | invalid | date-taken | submitting | open-normal | open-peak
    day: null,                 // null, or the open business day
    openForm: { date: '', type: '', floatRaw: '', openedBy: '' },
    openErrors: null,
    openSubmitting: false,

    // ---- Close screen ----
    closeReview: 'with-count', // no-day | no-count | with-count | no-recon-items
    closeForm: { countedRaw: '', reason: '', closedBy: '' },
    closeErrors: null,
    closeSubmitting: false
  };

  function sampleDay(type) {
    return {
      date: '2026-07-23',
      type: type || 'NORMAL',
      floatCents: 200000,          // ₱2,000.00
      openedBy: 's-01',
      openedAt: '06:12'
    };
  }

  /* Cash summary figures. Everything except the float has no capture workflow
     yet, so these are GENUINE, LABELLED ZEROS — not unknowns, not hidden. */
  function cashFigures(day) {
    var f = {
      floatCents: day ? day.floatCents : 0,
      cashSalesCents: 0,
      onlineSalesCents: 0,
      cashTipsCents: 0,
      cashInCents: 0,
      cashOutCents: 0,
      cashExpensesCents: 0,
      changeOwedCents: 0
    };
    f.expectedCents =
      f.floatCents + f.cashSalesCents + f.cashTipsCents + f.cashInCents + f.changeOwedCents
      - f.cashOutCents - f.cashExpensesCents;
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Small DOM helpers
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseISO(iso) {
    var p = String(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function longDate(iso) {
    var d = parseISO(iso);
    return WEEKDAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
  }
  function shortDate(iso) {
    var d = parseISO(iso);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
  }
  function dayTypeLabel(t) { return t === 'PEAK' ? 'Peak day' : 'Normal day'; }

  /* ------------------------------------------------------------------ *
   * Shared fragments
   * ------------------------------------------------------------------ */

  function staffOptions(selected) {
    var html = '<option value="">Select a staff member</option>';
    activeStaff().forEach(function (s) {
      html += '<option value="' + s.id + '"' + (s.id === selected ? ' selected' : '') + '>'
        + esc(s.name) + '</option>';
    });
    return html;
  }

  function errorPanel(err) {
    if (!err) return '';
    var items = err.items.map(function (i) { return '<li>' + i + '</li>'; }).join('');
    return '<div class="msg msg--error state-enter" role="group" aria-label="Submission failed">'
      + '<h3>' + esc(err.headline) + '</h3>'
      + '<p>' + esc(err.unchanged) + '</p>'
      + (items ? '<ul>' + items + '</ul>' : '')
      + '<p>' + esc(err.next) + '</p>'
      + '</div>';
  }

  function noDayOpenPanel(bodyHtml) {
    return '<div class="msg msg--blocking state-enter">'
      + '<h3>No business day is open.</h3>'
      + bodyHtml
      + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Screen 1 — Open business day
   * ------------------------------------------------------------------ */

  function renderOpenScreen() {
    var mount = $('#open-mount');
    mount.innerHTML = state.day ? openSummaryHtml() : openFormHtml();
    if (!state.day) wireOpenForm();
  }

  function openSummaryHtml() {
    var d = state.day;
    return ''
      + '<section class="day-open-panel state-enter" aria-labelledby="day-open-h">'
      + '  <div class="day-open-head">'
      + '    <span class="badge-day-open">Day open</span>'
      + '    <h2 class="day-open-date" id="day-open-h">' + esc(longDate(d.date)) + '</h2>'
      + '    <span class="chip' + (d.type === 'PEAK' ? ' chip--daytype-peak' : '') + '">'
      +        esc(dayTypeLabel(d.type)) + '</span>'
      + '  </div>'
      + '  <dl class="summary-grid">'
      + summaryCell('Business date', shortDate(d.date))
      + summaryCell('Day type', dayTypeLabel(d.type))
      + summaryCell('Cash float', peso(d.floatCents))
      + summaryCell('Opened by', staffName(d.openedBy))
      + summaryCell('Opened at', d.openedAt)
      + '  </dl>'
      + '  <p class="day-open-foot">Take orders and record cash against this day; close it at end of shift.'
      + '    <span class="closure-note">This day is already set. Its date, type, float and opener are fixed '
      + '      for the rest of the shift, so there is nothing to submit here. Closing happens on '
      + '      <a href="#/pos/close">Close Day</a>.</span>'
      + '  </p>'
      + '</section>';
  }

  function summaryCell(label, value) {
    return '<div class="summary-cell"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function openFormHtml() {
    var f = state.openForm;
    var e = state.openErrors;
    var fieldErr = (e && e.fields) || {};
    var busy = state.openSubmitting;

    function invalidClass(k) { return fieldErr[k] ? ' is-invalid' : ''; }
    function fieldError(k) {
      return fieldErr[k] ? '<span class="field-error" id="err-' + k + '">' + esc(fieldErr[k]) + '</span>' : '';
    }
    function aria(k) {
      return fieldErr[k] ? ' aria-invalid="true" aria-describedby="err-' + k + '"' : '';
    }

    return ''
      + errorPanel(e)
      + '<form class="panel" id="open-form" novalidate aria-labelledby="open-form-h">'
      + '  <h2 id="open-form-h">Day setup</h2>'
      + '  <p class="panel-note">Nothing is recorded against the shop until a day is open.</p>'
      + '  <div class="field-grid">'

      + '    <div class="field' + invalidClass('date') + '">'
      + '      <label class="field-label" for="open-date">Business date <span class="req">Required</span></label>'
      + '      <input type="date" id="open-date" name="date" value="' + esc(f.date) + '"'
      +          (busy ? ' disabled' : '') + aria('date') + '>'
      + '      <span class="field-help">Past, current and future dates are all accepted.</span>'
      +        fieldError('date')
      + '    </div>'

      + '    <fieldset class="field field--daytype' + invalidClass('type') + '">'
      + '      <legend class="field-label">Day type <span class="req">Required</span></legend>'
      + '      <div class="radio-row" role="radiogroup"' + aria('type') + '>'
      +          radioCard('NORMAL', 'Normal day', 'Standard par levels', f.type, busy)
      +          radioCard('PEAK', 'Peak day', 'Raised par levels', f.type, busy)
      + '      </div>'
      +        fieldError('type')
      + '    </fieldset>'

      + '    <div class="field' + invalidClass('float') + '">'
      + '      <label class="field-label" for="open-float">Opening cash float <span class="req">Required</span></label>'
      + '      <div class="money-input"><span class="peso" aria-hidden="true">' + PESO + '</span>'
      + '        <input type="text" inputmode="decimal" id="open-float" name="float" placeholder="0.00"'
      + '          value="' + esc(f.floatRaw) + '"' + (busy ? ' disabled' : '') + aria('float') + '></div>'
      + '      <span class="field-help">Zero is a valid float.</span>'
      +        fieldError('float')
      + '    </div>'

      + '    <div class="field' + invalidClass('openedBy') + '">'
      + '      <label class="field-label" for="open-by">Opened by <span class="req">Required</span></label>'
      + '      <select id="open-by" name="openedBy"' + (busy ? ' disabled' : '') + aria('openedBy') + '>'
      +          staffOptions(f.openedBy)
      + '      </select>'
      + '      <span class="field-help">Active staff only.</span>'
      +        fieldError('openedBy')
      + '    </div>'

      + '  </div>'
      + '  <div class="form-actions">'
      + '    <button type="submit" class="btn btn--primary" id="open-submit"'
      +        (busy ? ' disabled aria-disabled="true"' : '') + '>'
      +        (busy ? 'Opening day…' : 'Open day') + '</button>'
      +      (busy ? '<span class="busy-note">Opening the day. Do not press again.</span>' : '')
      + '  </div>'
      + '</form>';
  }

  function radioCard(value, label, sub, current, busy) {
    return '<label class="radio-card">'
      + '<input type="radio" name="daytype" value="' + value + '"'
      + (current === value ? ' checked' : '') + (busy ? ' disabled' : '') + '>'
      + '<span class="dot" aria-hidden="true"></span>'
      + '<span>' + esc(label) + '<span class="radio-sub">' + esc(sub) + '</span></span>'
      + '</label>';
  }

  function wireOpenForm() {
    var form = $('#open-form');
    if (!form) return;

    $('#open-date').addEventListener('input', function (ev) { state.openForm.date = ev.target.value; });
    $('#open-float').addEventListener('input', function (ev) { state.openForm.floatRaw = ev.target.value; });
    $('#open-by').addEventListener('change', function (ev) { state.openForm.openedBy = ev.target.value; });
    $$('input[name="daytype"]', form).forEach(function (r) {
      r.addEventListener('change', function (ev) { state.openForm.type = ev.target.value; });
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitOpenDay();
    });
  }

  function validateOpen() {
    var f = state.openForm;
    var fields = {};
    var items = [];

    if (!f.date) {
      fields.date = 'Choose the business date.';
      items.push('<strong>Business date</strong> is empty.');
    } else if (USED_DATES[f.date]) {
      fields.date = 'This date already has a business day.';
      items.push('<strong>' + esc(shortDate(f.date)) + '</strong> already belongs to a '
        + USED_DATES[f.date] + ' business day.');
    }

    if (!f.type) {
      fields.type = 'Choose Normal day or Peak day.';
      items.push('<strong>Day type</strong> was not chosen.');
    }

    var cents = parseMoneyToCents(f.floatRaw);
    if (cents === null) {
      fields.float = 'Enter the opening float. Enter 0 if the drawer starts empty.';
      items.push('<strong>Opening cash float</strong> is empty. Enter <strong>0</strong> if the drawer starts empty.');
    } else if (isNaN(cents)) {
      fields.float = 'Enter an amount like 2000 or 2000.00.';
      items.push('<strong>Opening cash float</strong> is not a valid amount. Use digits only, e.g. 2000.00.');
    }

    if (!f.openedBy) {
      fields.openedBy = 'Choose who is opening the day.';
      items.push('<strong>Opened by</strong> was not chosen.');
    }

    if (items.length === 0) return null;

    return {
      headline: 'No business day was opened.',
      unchanged: 'Nothing changed. There is still no open day, no cash float on record, and no orders '
        + 'or cash can be taken yet.',
      items: items,
      next: 'Fix the fields marked above, then press Open day again.',
      fields: fields
    };
  }

  function submitOpenDay() {
    var err = validateOpen();
    state.openErrors = err;

    if (err) {
      renderOpenScreen();
      announce('#open-live', err.headline + ' ' + err.items.length + ' problem'
        + (err.items.length === 1 ? '' : 's') + ' to fix.');
      var firstBad = $('#open-form [aria-invalid="true"]');
      if (firstBad) firstBad.focus();
      return;
    }

    state.openSubmitting = true;
    renderOpenScreen();
    announce('#open-live', 'Opening the business day.');

    window.setTimeout(function () {
      var f = state.openForm;
      state.day = {
        date: f.date,
        type: f.type,
        floatCents: parseMoneyToCents(f.floatRaw),
        openedBy: f.openedBy,
        openedAt: '06:12'
      };
      state.openSubmitting = false;
      state.openReview = f.type === 'PEAK' ? 'open-peak' : 'open-normal';
      renderAll();
      announce('#open-live', 'Business day opened for ' + longDate(state.day.date) + '.');
    }, 900);
  }

  /* ------------------------------------------------------------------ *
   * Screen 2 — Close business day
   * ------------------------------------------------------------------ */

  function renderCloseScreen() {
    var mount = $('#close-mount');

    if (!state.day) {
      mount.innerHTML = noDayOpenPanel(
        '<p>There is nothing to close. A day has to be opened before orders, cash or counts '
        + 'can be recorded against it.</p>'
        + '<p>Open one on <a href="#/pos/open">Open Day</a>.</p>'
      );
      return;
    }

    var hasCount = state.closeReview !== 'no-count';
    var hasReconItems = state.closeReview !== 'no-recon-items';

    mount.innerHTML = ''
      + (hasCount ? '' : advisoryHtml())
      + reconciliationHtml(hasCount, hasReconItems)
      + cashSummaryHtml()
      + countAndCloseHtml();

    wireCloseForm();
    updateDiscrepancy();
  }

  function advisoryHtml() {
    return '<div class="msg msg--advisory state-enter">'
      + '<h3>No closing count submitted yet<span class="advisory-tag">Advisory</span></h3>'
      + '<p>No closing count submitted yet — cup/lid variances won’t be snapshotted. '
      + '<a href="#/pos/closing">Do the closing count.</a></p>'
      + '<p>You can still close the day without it.</p>'
      + '</div>';
  }

  function reconciliationHtml(hasCount, hasReconItems) {
    var head = '<section class="panel" aria-labelledby="recon-h">'
      + '<h2 id="recon-h">Cup / lid balance</h2>'
      + '<p class="panel-note">Expected = opening count + deliveries − wastage − packaging used by '
      + 'completed, non-voided drink sales. A dash with a reason means the figure is unknown; '
      + '<strong>0</strong> means it was counted and it was zero.</p>';

    if (!hasReconItems) {
      return head
        + '<div class="empty-state">'
        + '<h3>No items are marked for reconciliation</h3>'
        + '<p>Nothing is set up to be balanced against cups and lids, so there is no variance to '
        + 'review. Mark packaging items for reconciliation in the back office to see them here.</p>'
        + '</div></section>';
    }

    var rows = reconRows(hasCount).map(function (r) {
      return '<tr>'
        + '<td class="item">' + esc(r.item) + '<span class="item-sub">' + esc(r.sub) + '</span></td>'
        + '<td class="num">' + qtyCell(r.expected, r.expectedWhy || 'no opening count') + '</td>'
        + '<td class="num">' + qtyCell(r.actual, r.actualWhy || 'no closing count') + '</td>'
        + '<td class="num">' + varCell(r.expected, r.actual) + '</td>'
        + '</tr>';
    }).join('');

    return head
      + '<div class="table-scroll" tabindex="0" role="region" aria-labelledby="recon-h">'
      + '<table>'
      + '<caption class="sr-only">Expected against actual cup and lid quantities</caption>'
      + '<thead><tr>'
      + '<th scope="col">Item</th>'
      + '<th scope="col" class="num">Expected</th>'
      + '<th scope="col" class="num">Actual</th>'
      + '<th scope="col" class="num">Var</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>'
      + '<p class="scroll-hint">Scroll the table sideways to see every column.</p>'
      + '</section>';
  }

  /* Unknown never renders as a bare em dash: it always carries its reason, so
     it cannot be confused with the legitimate 0 sitting in the same column. */
  function qtyCell(v, why) {
    if (v === null || v === undefined) {
      return '<span class="unknown"><span class="dash" aria-hidden="true">—</span>'
        + '<span class="why">' + esc(why) + '</span>'
        + '<span class="sr-only">Unknown: ' + esc(why) + '</span></span>';
    }
    return '<span class="' + (v === 0 ? 'zero-real' : '') + '">' + v + '</span>';
  }

  function varCell(expected, actual) {
    if (expected === null || expected === undefined || actual === null || actual === undefined) {
      return '<span class="unknown"><span class="dash" aria-hidden="true">—</span>'
        + '<span class="why">needs both counts</span>'
        + '<span class="sr-only">Unknown: needs both counts</span></span>';
    }
    var diff = actual - expected;
    if (diff === 0) return '<span class="zero-real">0</span>';
    if (diff < 0) {
      return '<span class="var-short"><span aria-hidden="true">▾</span> ' + Math.abs(diff)
        + ' short</span>';
    }
    return '<span class="var-over"><span aria-hidden="true">▴</span> ' + diff + ' over</span>';
  }

  function cashSummaryHtml() {
    var f = cashFigures(state.day);

    function row(label, why, op, cents, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>'
        + '<td class="cash-label">' + esc(label)
        + (why ? '<span class="cash-why">' + esc(why) + '</span>' : '') + '</td>'
        + '<td class="num">'
        + '<span class="op' + (op === '−' ? ' op--minus' : '') + '" aria-hidden="true">'
        + (op || '') + '</span>'
        + '<span class="sr-only">' + (op === '−' ? 'minus ' : op === '+' ? 'plus ' : '') + '</span>'
        + peso(cents) + '</td>'
        + '</tr>';
    }

    return '<section class="panel" aria-labelledby="cash-h">'
      + '<h2 id="cash-h">Cash summary (online sales excluded)</h2>'
      + '<p class="panel-note">Cash sales, online sales, tips, cash in, cash out and expenses have no '
      + 'capture workflow in this build, so they are real zeros, not unknowns.</p>'
      + '<div class="table-scroll table-scroll--cash" tabindex="0" role="region" aria-labelledby="cash-h">'
      + '<table class="cash-table">'
      + '<caption class="sr-only">Rows that make up the expected cash in the drawer</caption>'
      + '<tbody>'
      + row('Cash float', 'What the drawer started the day with.', '', f.floatCents)
      + row('Cash sales', '', '+', f.cashSalesCents)
      + row('Online sales (excluded)', 'Recorded for the day, but the money never enters this drawer.',
            '', f.onlineSalesCents, 'row-excluded')
      + row('Cash tips (+)', '', '+', f.cashTipsCents)
      + row('Cash in (+)', '', '+', f.cashInCents)
      + row('Cash out (−)', '', '−', f.cashOutCents)
      + row('Expenses (cash) (−)', '', '−', f.cashExpensesCents)
      + row('Change owed (still in drawer)',
            'Change a customer is owed but has not been handed yet. It is still physically in the '
            + 'drawer, so you will count it.',
            '+', f.changeOwedCents, 'row-highlight')
      + '</tbody>'
      + '<tfoot><tr>'
      + '<td class="cash-label">Expected cash</td>'
      + '<td class="num" id="expected-cash" data-cents="' + f.expectedCents + '">'
      + peso(f.expectedCents) + '</td>'
      + '</tr></tfoot>'
      + '</table></div>'
      + '<p class="scroll-hint">Scroll the table sideways to see the amounts.</p>'
      + '</section>';
  }

  function countAndCloseHtml() {
    var c = state.closeForm;
    var e = state.closeErrors;
    var fieldErr = (e && e.fields) || {};
    var busy = state.closeSubmitting;

    function invalidClass(k) { return fieldErr[k] ? ' is-invalid' : ''; }
    function fieldError(k) {
      return fieldErr[k] ? '<span class="field-error" id="cerr-' + k + '">' + esc(fieldErr[k]) + '</span>' : '';
    }
    function aria(k) { return fieldErr[k] ? ' aria-invalid="true" aria-describedby="cerr-' + k + '"' : ''; }

    return errorPanel(e)
      + '<form class="panel" id="close-form" novalidate aria-labelledby="count-h">'
      + '  <h2 id="count-h">Count the drawer and close</h2>'
      + '  <div class="field-grid field-grid--narrow">'

      + '    <div class="field' + invalidClass('counted') + '">'
      + '      <label class="field-label" for="close-counted">Actual cash counted <span class="req">Required</span></label>'
      + '      <div class="money-input"><span class="peso" aria-hidden="true">' + PESO + '</span>'
      + '        <input type="text" inputmode="decimal" id="close-counted" placeholder="0.00"'
      + '          value="' + esc(c.countedRaw) + '"' + (busy ? ' disabled' : '') + aria('counted') + '></div>'
      + '      <span class="field-help">Zero is valid.</span>'
      +        fieldError('counted')
      + '    </div>'

      + '    <div class="field">'
      + '      <span class="field-label" id="disc-label">Discrepancy</span>'
      + '      <output class="discrepancy-readout" id="disc-readout" for="close-counted"'
      + '        aria-labelledby="disc-label" role="status" aria-live="polite"></output>'
      + '    </div>'
      + '  </div>'

      + '  <div class="field-grid" style="margin-top:var(--space-5)">'
      + '    <div class="field">'
      + '      <label class="field-label" for="close-reason">Discrepancy reason <span class="opt">Optional</span></label>'
      + '      <textarea id="close-reason" placeholder="e.g. short by change given, over from tips"'
      +          (busy ? ' disabled' : '') + '>' + esc(c.reason) + '</textarea>'
      + '      <span class="field-help">Stays optional even when the drawer does not balance.</span>'
      + '    </div>'

      + '    <div class="field' + invalidClass('closedBy') + '">'
      + '      <label class="field-label" for="close-by">Closed by <span class="req">Required</span></label>'
      + '      <select id="close-by"' + (busy ? ' disabled' : '') + aria('closedBy') + '>'
      +          staffOptions(c.closedBy)
      + '      </select>'
      + '      <span class="field-help">Active staff only.</span>'
      +        fieldError('closedBy')
      + '    </div>'
      + '  </div>'

      + '  <div class="form-actions">'
      + '    <button type="submit" class="btn btn--primary" id="close-submit"'
      +        (busy ? ' disabled aria-disabled="true"' : '') + '>'
      +        (busy ? 'Closing day…' : 'Close day') + '</button>'
      +      (busy ? '<span class="busy-note">Closing the day. Do not press again.</span>' : '')
      + '  </div>'
      + '</form>';
  }

  function wireCloseForm() {
    var form = $('#close-form');
    if (!form) return;

    $('#close-counted').addEventListener('input', function (ev) {
      state.closeForm.countedRaw = ev.target.value;
      updateDiscrepancy();
    });
    $('#close-reason').addEventListener('input', function (ev) { state.closeForm.reason = ev.target.value; });
    $('#close-by').addEventListener('change', function (ev) { state.closeForm.closedBy = ev.target.value; });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitCloseDay();
    });
  }

  /* Live, before any submission. Direction is carried by the WORD, not by a
     minus sign glued to the currency symbol. */
  function updateDiscrepancy() {
    var out = $('#disc-readout');
    if (!out) return;

    var expectedEl = $('#expected-cash');
    var expected = expectedEl ? parseInt(expectedEl.getAttribute('data-cents'), 10) : 0;
    var counted = parseMoneyToCents(state.closeForm.countedRaw);

    out.className = 'discrepancy-readout';

    if (counted === null) {
      out.innerHTML = '<span class="disc-note">Enter the counted cash to see the discrepancy.</span>';
      return;
    }
    if (isNaN(counted)) {
      out.innerHTML = '<span class="disc-note">Waiting for a valid amount, e.g. 1995.50.</span>';
      return;
    }

    var diff = counted - expected;

    if (diff === 0) {
      out.className += ' is-balanced';
      out.innerHTML = '<span class="disc-dir">Balanced</span>'
        + '<span class="disc-amount">' + peso(0) + '</span>';
      return;
    }

    out.className += ' is-off';
    if (diff < 0) {
      out.innerHTML = '<span class="disc-dir"><span aria-hidden="true">▾</span> Short</span>'
        + '<span class="disc-amount">' + peso(diff) + '</span>'
        + '<span class="disc-note">Drawer holds less than expected.</span>';
    } else {
      out.innerHTML = '<span class="disc-dir"><span aria-hidden="true">▴</span> Over</span>'
        + '<span class="disc-amount">' + peso(diff) + '</span>'
        + '<span class="disc-note">Drawer holds more than expected.</span>';
    }
  }

  function validateClose() {
    var c = state.closeForm;
    var fields = {};
    var items = [];

    var counted = parseMoneyToCents(c.countedRaw);
    if (counted === null) {
      fields.counted = 'Enter the cash you counted. Enter 0 if the drawer is empty.';
      items.push('<strong>Actual cash counted</strong> is empty. Enter <strong>0</strong> if the drawer is empty.');
    } else if (isNaN(counted)) {
      fields.counted = 'Enter an amount like 1995.50.';
      items.push('<strong>Actual cash counted</strong> is not a valid amount. Use digits only, e.g. 1995.50.');
    }

    if (!c.closedBy) {
      fields.closedBy = 'Choose who is closing the day.';
      items.push('<strong>Closed by</strong> was not chosen.');
    }

    if (items.length === 0) return null;

    return {
      headline: 'No business day was closed.',
      unchanged: 'Nothing changed. The day is still open, the drawer count was not recorded, and the '
        + 'cup/lid variances were not snapshotted.',
      items: items,
      next: 'Fix the fields marked above, then press Close day again.',
      fields: fields
    };
  }

  function submitCloseDay() {
    var err = validateClose();
    state.closeErrors = err;

    if (err) {
      renderCloseScreen();
      announce('#close-live', err.headline + ' ' + err.items.length + ' problem'
        + (err.items.length === 1 ? '' : 's') + ' to fix.');
      var firstBad = $('#close-form [aria-invalid="true"]');
      if (firstBad) firstBad.focus();
      return;
    }

    state.closeSubmitting = true;
    renderCloseScreen();
    announce('#close-live', 'Closing the business day.');

    window.setTimeout(function () {
      state.closeSubmitting = false;
      announce('#close-live', 'Prototype only: the day was not actually closed. Reload to reset.');
      renderCloseScreen();
    }, 900);
  }

  /* ------------------------------------------------------------------ *
   * Header chips
   * ------------------------------------------------------------------ */

  function renderHeader() {
    var d = state.day;
    $('#hdr-date').textContent = d
      ? shortDate(d.date)
      : shortDate('2026-07-23');

    var dayChip = $('#hdr-day-chip');
    dayChip.textContent = d ? 'Day open' : 'No day open';
    dayChip.className = 'chip' + (d ? ' chip--open' : '');

    var typeChip = $('#hdr-type-chip');
    if (d) {
      typeChip.hidden = false;
      typeChip.textContent = d.type === 'PEAK' ? 'Peak' : 'Normal';
      typeChip.className = 'chip' + (d.type === 'PEAK' ? ' chip--daytype-peak' : '');
    } else {
      typeChip.hidden = true;
    }

    var countChip = $('#hdr-count-chip');
    var hasCount = !!d && state.closeReview !== 'no-count';
    countChip.textContent = d
      ? (hasCount ? 'Closing count: done' : 'Closing count: none')
      : 'Closing count: n/a';
  }

  /* ------------------------------------------------------------------ *
   * Review-states panel (mockup only)
   * ------------------------------------------------------------------ */

  function applyOpenReview(name) {
    state.openReview = name;
    state.openErrors = null;
    state.openSubmitting = false;

    if (name === 'open-normal' || name === 'open-peak') {
      state.day = sampleDay(name === 'open-peak' ? 'PEAK' : 'NORMAL');
      renderAll();
      return;
    }

    state.day = null;

    if (name === 'empty') {
      state.openForm = { date: '', type: '', floatRaw: '', openedBy: '' };
    } else if (name === 'filled') {
      state.openForm = { date: '2026-07-23', type: 'NORMAL', floatRaw: '2000.00', openedBy: 's-01' };
    } else if (name === 'invalid') {
      state.openForm = { date: '', type: '', floatRaw: 'two thousand', openedBy: '' };
      state.openErrors = validateOpen();
    } else if (name === 'date-taken') {
      state.openForm = { date: '2026-07-22', type: 'PEAK', floatRaw: '2500.00', openedBy: 's-02' };
      state.openErrors = validateOpen();
    } else if (name === 'submitting') {
      state.openForm = { date: '2026-07-23', type: 'PEAK', floatRaw: '2500.00', openedBy: 's-03' };
      state.openSubmitting = true;
    }
    renderAll();
  }

  function applyCloseReview(name) {
    state.closeReview = name;
    state.closeErrors = null;
    state.closeSubmitting = false;
    state.day = name === 'no-day' ? null : (state.day || sampleDay('NORMAL'));
    renderAll();
  }

  function applyCloseCount(name) {
    state.closeErrors = null;
    state.closeSubmitting = false;
    if (!state.day) state.day = sampleDay('NORMAL');

    // Expected cash equals the float, since every other row is a genuine zero.
    var expected = cashFigures(state.day).expectedCents;
    if (name === 'empty') state.closeForm.countedRaw = '';
    else if (name === 'balanced') state.closeForm.countedRaw = centsToInput(expected);
    else if (name === 'short') state.closeForm.countedRaw = centsToInput(expected - 450);
    else if (name === 'over') state.closeForm.countedRaw = centsToInput(expected + 125);
    renderAll();
  }

  function applyCloseSubmit(name) {
    if (!state.day) state.day = sampleDay('NORMAL');
    state.closeErrors = null;
    state.closeSubmitting = false;

    if (name === 'submitting') {
      if (!state.closeForm.closedBy) state.closeForm.closedBy = 's-02';
      if (!state.closeForm.countedRaw) {
        state.closeForm.countedRaw = centsToInput(cashFigures(state.day).expectedCents);
      }
      state.closeSubmitting = true;
    } else if (name === 'invalid') {
      state.closeForm.countedRaw = '';
      state.closeForm.closedBy = '';
      state.closeErrors = validateClose();
    }
    renderAll();
  }

  function centsToInput(cents) {
    var n = Math.max(0, cents | 0);
    return Math.floor(n / 100) + '.' + (n % 100 < 10 ? '0' + (n % 100) : String(n % 100));
  }

  function syncReviewButtons() {
    $$('[data-review-group="open"] button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.state === state.openReview));
    });
    $$('[data-review-group="close"] button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.state === state.closeReview));
    });
  }

  function wireReviewPanels() {
    $$('[data-review-group="open"] button').forEach(function (b) {
      b.addEventListener('click', function () { applyOpenReview(b.dataset.state); });
    });
    $$('[data-review-group="close"] button').forEach(function (b) {
      b.addEventListener('click', function () { applyCloseReview(b.dataset.state); });
    });
    $$('[data-review-group="close-count"] button').forEach(function (b) {
      b.addEventListener('click', function () { applyCloseCount(b.dataset.count); });
    });
    $$('[data-review-group="close-submit"] button').forEach(function (b) {
      b.addEventListener('click', function () { applyCloseSubmit(b.dataset.submit); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Routing + render
   * ------------------------------------------------------------------ */

  function announce(sel, msg) {
    var el = $(sel);
    if (!el) return;
    el.textContent = '';
    window.setTimeout(function () { el.textContent = msg; }, 30);
  }

  function readRoute() {
    var h = window.location.hash.replace(/^#/, '');
    return h === '/pos/close' ? '/pos/close' : '/pos/open';
  }

  function renderRoute() {
    var isClose = state.route === '/pos/close';
    $('#screen-open').hidden = isClose;
    $('#screen-close').hidden = !isClose;

    $$('.nav-list a[data-route]').forEach(function (a) {
      if (a.dataset.route === state.route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    document.title = (isClose ? 'Close business day' : 'Open business day')
      + ' · UCM Coffee Studio Staff POS';
  }

  function renderAll() {
    // The close screen's review state can never claim a day that is not open.
    if (!state.day) state.closeReview = 'no-day';
    else if (state.closeReview === 'no-day') state.closeReview = 'with-count';

    renderHeader();
    renderRoute();
    if (state.route === '/pos/close') renderCloseScreen();
    else renderOpenScreen();
    syncReviewButtons();
  }

  window.addEventListener('hashchange', function () {
    state.route = readRoute();
    renderAll();
  });

  // Non-navigating shell links stay inert.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[aria-disabled="true"]') : null;
    if (a) ev.preventDefault();
  });

  state.route = readRoute();
  wireReviewPanels();
  applyOpenReview('empty');
  state.closeForm = { countedRaw: '', reason: '', closedBy: '' };
  renderAll();
})();
