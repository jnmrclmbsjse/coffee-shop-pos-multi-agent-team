(function () {
  'use strict';

  var DEVICE_ID = 'ucm-main-register-1';
  var SERVER_KEY = 'ucm-mock-server:cashier:' + DEVICE_ID;
  var FAILURE_THRESHOLD = 3;
  var COOLDOWN_MS = 12000;
  var GENERIC_FAILURE = 'Cashier could not be selected. Try again or choose someone else.';
  var SIGNED_IN_USER = 'Marilou Bagtas';

  var MEMBERS = [
    { id: 'staff-marilou', name: 'Marilou Bagtas', active: true, requiresPin: true, pin: '2468' },
    { id: 'staff-renz', name: 'Renz Villafuerte', active: true, requiresPin: false, pin: '' },
    { id: 'staff-jhoanna', name: 'Jhoanna Sarmiento', active: true, requiresPin: true, pin: '1357' },
    { id: 'staff-mika', name: 'Mika Reyes', active: true, requiresPin: false, pin: '' },
    { id: 'staff-benjie', name: 'Benjie Cruz', active: false, requiresPin: true, pin: '8042' }
  ];

  var state = {
    view: 'closed',
    pickerMode: 'populated',
    pendingMemberId: null,
    pin: '',
    genericFailure: false,
    lastTrigger: null,
    review: '',
    cooldownTimer: null
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function defaultServerState() {
    return { deviceId: DEVICE_ID, activeMemberId: 'staff-marilou', failureCount: 0, lockUntil: 0 };
  }

  function readServer() {
    try {
      var raw = window.localStorage.getItem(SERVER_KEY);
      if (!raw) {
        var initial = defaultServerState();
        window.localStorage.setItem(SERVER_KEY, JSON.stringify(initial));
        return initial;
      }
      var parsed = JSON.parse(raw);
      return {
        deviceId: DEVICE_ID,
        activeMemberId: parsed.activeMemberId || null,
        failureCount: Number(parsed.failureCount) || 0,
        lockUntil: Number(parsed.lockUntil) || 0
      };
    } catch (error) {
      return defaultServerState();
    }
  }

  function writeServer(next) {
    try { window.localStorage.setItem(SERVER_KEY, JSON.stringify(next)); } catch (error) { /* Storage may be unavailable in a restricted browser. */ }
  }

  function updateServer(patch) {
    var current = readServer();
    Object.keys(patch).forEach(function (key) { current[key] = patch[key]; });
    writeServer(current);
    return current;
  }

  function memberById(id) {
    for (var index = 0; index < MEMBERS.length; index += 1) {
      if (MEMBERS[index].id === id) return MEMBERS[index];
    }
    return null;
  }

  function activeMember() { return memberById(readServer().activeMemberId); }
  function selectableMembers() { return MEMBERS.filter(function (member) { return member.active; }); }

  function activeLabel() {
    var member = activeMember();
    return member ? member.name : 'No cashier selected';
  }

  function announce(message) {
    var live = $('#app-live');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = message; }, 30);
  }

  function renderShell() {
    var member = activeMember();
    var indicator = $('#cashier-indicator');
    $('#cashier-indicator-value').textContent = activeLabel();
    $('#context-cashier').textContent = activeLabel();
    indicator.classList.toggle('is-empty', !member);
    indicator.classList.toggle('is-deactivated', Boolean(member && !member.active));
    $('#cashier-clear').hidden = !member;
    if (!member) {
      $('#cashier-state-note').textContent = 'Orders may be taken without selecting a cashier.';
    } else if (!member.active) {
      $('#cashier-state-note').textContent = member.name + ' remains active on this device but no longer appears in new cashier choices.';
    } else {
      $('#cashier-state-note').textContent = 'New orders on this device will be attributed to ' + member.name + '.';
    }
  }

  function currentSummaryHtml() {
    var member = activeMember();
    var suffix = member && !member.active ? ' (no longer on active roster)' : '';
    return '<div class="current-summary" data-od-id="picker-current-cashier">'
      + '<span class="current-summary__label">Current cashier on this device</span>'
      + '<span class="current-summary__value">' + esc(activeLabel() + suffix) + '</span></div>';
  }

  function pickerHtml() {
    var members = state.pickerMode === 'empty' ? [] : selectableMembers();
    if (state.pickerMode === 'loading') {
      return '<div class="dialog-body">' + currentSummaryHtml()
        + '<div class="loading-grid" role="status" aria-label="Loading selectable cashiers">'
        + '<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div></div>'
        + '<div class="picker-actions"><button class="btn" type="button" data-action="cancel-dialog">Cancel</button></div></div>';
    }
    if (!members.length) {
      return '<div class="dialog-body">' + currentSummaryHtml()
        + '<div class="empty-state" data-od-id="picker-empty-state"><h3>No selectable cashiers</h3><p>No active roster members are available. The current cashier stays unchanged until staff clear or switch it.</p></div>'
        + '<div class="picker-actions"><button class="btn" type="button" data-action="clear-selection">Clear selection</button><button class="btn" type="button" data-action="cancel-dialog">Cancel</button></div></div>';
    }
    var active = readServer().activeMemberId;
    var cards = members.map(function (member) {
      var isActive = member.id === active;
      return '<button class="member-card' + (isActive ? ' is-active' : '') + '" type="button" data-member-id="' + esc(member.id) + '" data-od-id="cashier-card-' + esc(member.id) + '"' + (isActive ? ' aria-current="true"' : '') + '>'
        + '<span><span class="member-card__name">' + esc(member.name) + '</span>'
        + (isActive ? '<span class="member-card__state">Currently active</span>' : '') + '</span>'
        + (member.requiresPin ? '<span class="pin-marker">PIN required</span>' : '<span class="pin-marker">Selects now</span>') + '</button>';
    }).join('');
    return '<div class="dialog-body">' + currentSummaryHtml()
      + '<div class="member-grid" data-od-id="cashier-picker-grid">' + cards + '</div>'
      + '<div class="picker-actions"><button class="btn" type="button" data-action="clear-selection">Clear selection</button><button class="btn" type="button" data-action="cancel-dialog">Cancel</button></div></div>';
  }

  function remainingCooldown() {
    return Math.max(0, readServer().lockUntil - Date.now());
  }

  function pinHtml() {
    var member = memberById(state.pendingMemberId);
    var locked = remainingCooldown() > 0;
    var filled = state.pin.length;
    var slots = '';
    for (var index = 0; index < 4; index += 1) {
      var classes = 'pin-slot' + (index < filled ? ' is-filled' : '') + (index === filled && filled < 4 ? ' is-current' : '');
      slots += '<span class="' + classes + '" aria-hidden="true"></span>';
    }
    var digits = ['1','2','3','4','5','6','7','8','9'];
    var keys = digits.map(function (digit) {
      return '<button class="key" type="button" data-digit="' + digit + '" aria-label="' + digit + '"' + (locked ? ' disabled' : '') + '>' + digit + '</button>';
    }).join('');
    keys += '<button class="key key--text" type="button" data-action="pin-cancel">Cancel</button>';
    keys += '<button class="key" type="button" data-digit="0" aria-label="0"' + (locked ? ' disabled' : '') + '>0</button>';
    keys += '<button class="key key--text" type="button" data-action="pin-delete" aria-label="Delete last PIN digit"' + (locked ? ' disabled' : '') + '>Delete</button>';
    var failure = state.genericFailure
      ? '<div class="generic-failure" id="pin-error" role="alert">' + GENERIC_FAILURE + '</div>' : '';
    var cooldown = locked
      ? '<p class="cooldown-state" id="cooldown-state">Keypad unavailable for ' + Math.ceil(remainingCooldown() / 1000) + ' seconds.</p>' : '';
    return '<div class="dialog-body"><div class="pin-layout">'
      + '<div class="pin-copy"><h3>Enter PIN for ' + esc(member ? member.name : 'cashier') + '</h3><p>Use the keypad to enter exactly 4 digits.</p>'
      + '<div class="pin-slots" role="img" aria-label="' + filled + ' of 4 PIN digits entered">' + slots + '</div>'
      + '<span class="sr-only">PIN digits are masked.</span>' + failure + cooldown + '</div>'
      + '<div><div class="keypad" aria-label="PIN keypad">' + keys + '</div>'
      + '<div class="pin-actions"><button class="btn" type="button" data-action="pin-back">Back</button><button class="btn btn--primary" type="button" data-action="pin-confirm"' + (locked ? ' disabled' : '') + '>Confirm</button></div></div>'
      + '</div></div>';
  }

  function renderDialog() {
    var dialog = $('#cashier-dialog');
    if (state.view === 'closed') {
      dialog.hidden = true;
      document.body.classList.remove('has-modal');
      stopCooldownTimer();
      renderShell();
      return;
    }
    dialog.hidden = false;
    document.body.classList.add('has-modal');
    $('#dialog-title').textContent = state.view === 'pin' ? 'Cashier PIN' : 'Select cashier';
    $('#dialog-description').textContent = state.view === 'pin'
      ? 'The signed-in POS user will not change.'
      : 'Choose who should be attributed to new orders on this register.';
    $('#dialog-content').innerHTML = state.view === 'pin' ? pinHtml() : pickerHtml();
    wireDialogContent();
    if (state.view === 'pin' && remainingCooldown() > 0) startCooldownTimer();
  }

  function openPicker(trigger, mode) {
    state.lastTrigger = trigger || $('#cashier-indicator');
    state.view = 'picker';
    state.pickerMode = mode || 'populated';
    state.pendingMemberId = null;
    state.pin = '';
    state.genericFailure = false;
    renderDialog();
    focusFirstDialogControl();
  }

  function openPin(memberId, options) {
    state.view = 'pin';
    state.pendingMemberId = memberId;
    state.pin = options && options.pin ? options.pin : '';
    state.genericFailure = Boolean(options && options.failure);
    renderDialog();
    focusFirstDialogControl();
  }

  function closeDialog() {
    state.view = 'closed';
    state.pin = '';
    state.pendingMemberId = null;
    state.genericFailure = false;
    renderDialog();
    var target = state.lastTrigger && document.contains(state.lastTrigger) ? state.lastTrigger : $('#cashier-indicator');
    target.focus();
  }

  function returnToPicker() {
    state.view = 'picker';
    state.pickerMode = 'populated';
    state.pin = '';
    state.pendingMemberId = null;
    state.genericFailure = false;
    renderDialog();
    focusFirstDialogControl();
  }

  function clearSelection(closeAfter) {
    updateServer({ activeMemberId: null });
    renderShell();
    announce('Cashier selection cleared. Orders may still be taken.');
    if (closeAfter) closeDialog(); else renderDialog();
  }

  function selectMember(memberId) {
    var member = memberById(memberId);
    if (!member || !member.active) return;
    if (member.requiresPin) {
      openPin(member.id);
      return;
    }
    updateServer({ activeMemberId: member.id, failureCount: 0, lockUntil: 0 });
    renderShell();
    closeDialog();
    announce(member.name + ' is now the active cashier. The signed-in POS user is unchanged.');
  }

  function appendDigit(digit) {
    if (remainingCooldown() > 0 || state.pin.length >= 4) return;
    state.pin += digit;
    state.genericFailure = false;
    renderDialog();
  }

  function deleteDigit() {
    if (remainingCooldown() > 0) return;
    state.pin = state.pin.slice(0, -1);
    state.genericFailure = false;
    renderDialog();
  }

  function recordFailure() {
    var server = readServer();
    server.failureCount += 1;
    if (server.failureCount >= FAILURE_THRESHOLD) server.lockUntil = Date.now() + COOLDOWN_MS;
    writeServer(server);
    state.pin = '';
    state.genericFailure = true;
    renderShell();
    renderDialog();
    announce(GENERIC_FAILURE);
  }

  function confirmPin() {
    var server = readServer();
    var member = memberById(state.pendingMemberId);
    if (server.lockUntil > Date.now()) {
      state.pin = '';
      state.genericFailure = true;
      renderDialog();
      announce(GENERIC_FAILURE);
      return;
    }
    if (!member || !member.active || state.pin.length !== 4 || state.pin !== member.pin) {
      recordFailure();
      return;
    }
    updateServer({ activeMemberId: member.id, failureCount: 0, lockUntil: 0 });
    renderShell();
    closeDialog();
    announce(member.name + ' is now the active cashier. The signed-in POS user is unchanged.');
  }

  function wireDialogContent() {
    $$('[data-member-id]', $('#dialog-content')).forEach(function (button) {
      button.addEventListener('click', function () { selectMember(button.dataset.memberId); });
    });
    $$('[data-digit]', $('#dialog-content')).forEach(function (button) {
      button.addEventListener('click', function () { appendDigit(button.dataset.digit); });
    });
    $$('[data-action]', $('#dialog-content')).forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.dataset.action;
        if (action === 'cancel-dialog') closeDialog();
        if (action === 'clear-selection') clearSelection(true);
        if (action === 'pin-cancel' || action === 'pin-back') returnToPicker();
        if (action === 'pin-delete') deleteDigit();
        if (action === 'pin-confirm') confirmPin();
      });
    });
  }

  function focusableDialogItems() {
    return $$('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])', $('#cashier-dialog')).filter(function (element) {
      return !element.hidden && element.offsetParent !== null;
    });
  }

  function focusFirstDialogControl() {
    window.setTimeout(function () {
      var items = focusableDialogItems();
      if (items.length) items[0].focus();
    }, 0);
  }

  function trapDialogKeydown(event) {
    if (state.view === 'closed') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (state.view === 'pin' && /^[0-9]$/.test(event.key)) {
      event.preventDefault();
      appendDigit(event.key);
      return;
    }
    if (state.view === 'pin' && event.key === 'Backspace') {
      event.preventDefault();
      deleteDigit();
      return;
    }
    if (state.view === 'pin' && event.key === 'Enter') {
      event.preventDefault();
      confirmPin();
      return;
    }
    if (event.key !== 'Tab') return;
    var items = focusableDialogItems();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function startCooldownTimer() {
    stopCooldownTimer();
    state.cooldownTimer = window.setInterval(function () {
      if (state.view !== 'pin') { stopCooldownTimer(); return; }
      if (remainingCooldown() <= 0) {
        updateServer({ failureCount: 0, lockUntil: 0 });
        state.genericFailure = false;
        stopCooldownTimer();
      }
      renderDialog();
    }, 1000);
  }

  function stopCooldownTimer() {
    if (state.cooldownTimer) window.clearInterval(state.cooldownTimer);
    state.cooldownTimer = null;
  }

  function setReviewPressed(name) {
    state.review = name;
    $$('[data-review]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.review === name));
    });
  }

  function reviewResult(message) { $('#review-result').textContent = message; announce(message); }

  function applyReview(name, trigger) {
    setReviewPressed(name);
    state.lastTrigger = trigger;
    if (name === 'picker-loading') openPicker(trigger, 'loading');
    if (name === 'picker-empty') openPicker(trigger, 'empty');
    if (name === 'picker-populated') openPicker(trigger, 'populated');
    if (name === 'pin-idle') openPin('staff-jhoanna');
    if (name === 'pin-partial') openPin('staff-jhoanna', { pin: '13' });
    if (name === 'pin-failure') openPin('staff-jhoanna', { failure: true });
    if (name === 'pin-cooldown') {
      updateServer({ failureCount: FAILURE_THRESHOLD, lockUntil: Date.now() + COOLDOWN_MS });
      openPin('staff-jhoanna', { failure: true });
    }
    if (name === 'no-cashier') {
      updateServer({ activeMemberId: null }); closeDialog(); renderShell(); reviewResult('No cashier is selected. Order taking remains available.');
    }
    if (name === 'cashier-active') {
      updateServer({ activeMemberId: 'staff-marilou' }); closeDialog(); renderShell(); reviewResult('Marilou Bagtas is active on this device.');
    }
    if (name === 'cashier-deactivated') {
      updateServer({ activeMemberId: 'staff-benjie' }); closeDialog(); renderShell(); reviewResult('Benjie Cruz remains active but is absent from new picker choices.');
    }
    if (name === 'reload') {
      closeDialog(); renderShell(); reviewResult('Simulated reload complete. The device-held cashier selection persisted.');
    }
    if (name === 'signout') {
      closeDialog();
      $('#signed-in-user').textContent = 'Signed out';
      $('#context-user').textContent = 'Signed out';
      reviewResult('Signed out. The device cashier selection remains stored.');
      window.setTimeout(function () {
        $('#signed-in-user').textContent = SIGNED_IN_USER;
        $('#context-user').textContent = SIGNED_IN_USER;
        renderShell();
        reviewResult('Signed back in as ' + SIGNED_IN_USER + '. The active cashier is still ' + activeLabel() + '.');
      }, 900);
    }
  }

  $('#cashier-indicator').addEventListener('click', function () { openPicker(this, 'populated'); });
  $('#cashier-clear').addEventListener('click', function () { clearSelection(false); this.focus(); });
  $('#dialog-close').addEventListener('click', closeDialog);
  $('.modal-backdrop').addEventListener('click', closeDialog);
  document.addEventListener('keydown', trapDialogKeydown);
  $$('[data-review]').forEach(function (button) {
    button.addEventListener('click', function () { applyReview(button.dataset.review, button); });
  });
  document.addEventListener('click', function (event) {
    var inert = event.target.closest ? event.target.closest('a[aria-disabled="true"]') : null;
    if (inert) event.preventDefault();
  });
  window.addEventListener('hashchange', function () {
    if (window.location.hash !== '#/pos') window.location.hash = '/pos';
  });

  if (window.location.hash !== '#/pos') window.location.hash = '/pos';
  renderShell();
}());
