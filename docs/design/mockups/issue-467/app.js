(function () {
  "use strict";

  const stateSelect = document.querySelector("#state-select");
  const content = document.querySelector("#journal-content");
  const loading = document.querySelector("#journal-loading");
  const error = document.querySelector("#journal-error");
  const notice = document.querySelector("#global-notice");
  const activityBody = document.querySelector("#activity-body");
  const activityEmpty = document.querySelector("#activity-empty");
  const activityCount = document.querySelector("#activity-count");
  const ledgerTitle = document.querySelector("#ledger-title");
  const ledgerRule = document.querySelector("#ledger-rule");
  const balanceValue = document.querySelector("#balance-value");
  const balanceStatus = document.querySelector("#balance-status");
  const bulkRows = document.querySelector("#bulk-rows");
  const bulkEmpty = document.querySelector("#bulk-empty");
  const bulkTotals = document.querySelector("#bulk-totals");
  const bulkSave = document.querySelector("#bulk-save");
  const bulkConflictNotice = document.querySelector("#bulk-conflict-notice");
  const activityTab = document.querySelector("#activity-tab");
  const bulkTab = document.querySelector("#bulk-tab");
  const activityPanel = document.querySelector("#activity-panel");
  const bulkPanel = document.querySelector("#bulk-panel");
  let lastModalTrigger = null;
  let activeModal = null;

  const normalRows = [
    { date: "Oct 9, 2026", record: "Withdrawal", deposit: "₱-1,500.00", suggestion: "Not applicable", note: "Partial October rent payment", status: "Saved withdrawal", type: "withdrawal" },
    { date: "Oct 8, 2026", record: "Outstanding day", deposit: "Not recorded", suggestion: "₱387.10 suggested, not saved", note: "No note", status: "Needs review", type: "outstanding" },
    { date: "Oct 6, 2026", record: "Outstanding day", deposit: "Not recorded", suggestion: "₱0.00 suggested, not saved", note: "Gross sales were ₱0.00", status: "Needs review", type: "outstanding" },
    { date: "Oct 5, 2026", record: "Deposit", deposit: "₱356.25", suggestion: "Saved amount", note: "Cash count matched the closed day", status: "Saved deposit", type: "deposit" },
    { date: "Oct 3, 2026", record: "Deposit", deposit: "₱428.00", suggestion: "Saved amount", note: "Weekend close", status: "Saved deposit", type: "deposit" },
    { date: "Oct 1, 2026", record: "Deposit", deposit: "₱0.00", suggestion: "Saved amount", note: "Shop closed for scheduled maintenance", status: "Saved ₱0.00 deposit", type: "deposit" }
  ];

  const longRows = [
    { date: "Oct 9, 2026", record: "Withdrawal", deposit: "₱-2,350.00", suggestion: "Not applicable", note: "Payment for replacement grinder burrs, emergency electrical inspection, delivery fee, and the follow-up service visit approved by the administrator after the first repair did not resolve the problem.", status: "Saved withdrawal", type: "withdrawal" },
    ...normalRows.slice(1)
  ];

  const bulkData = [
    { date: "October 8, 2026", meta: "Closed business day", amount: 387.10, suggestion: "Suggested from 10% of gross" },
    { date: "October 7, 2026", meta: "Closed business day", amount: 425.90, suggestion: "Suggested from 10% of gross" },
    { date: "October 6, 2026", meta: "Closed business day", amount: 0, suggestion: "₱0.00 suggestion, not saved" },
    { date: "October 4, 2026", meta: "Closed business day", amount: 11.25, suggestion: "Suggested from 10% of gross" }
  ];
  const ledgerViews = {
    rent: { title: "Rent", rule: "10% of daily gross. Started October 1, 2026.", balance: "₱9,842.50", rows: normalRows, bulk: bulkData },
    chair: {
      title: "Chair", rule: "₱100 above a ₱3,000 gross threshold. Started October 1, 2026.", balance: "₱1,400.00",
      rows: [
        { date: "Oct 8, 2026", record: "Deposit", deposit: "₱100.00", suggestion: "Saved amount", note: "Daily gross exceeded threshold", status: "Saved deposit", type: "deposit" },
        { date: "Oct 2, 2026", record: "Outstanding day", deposit: "Not recorded", suggestion: "₱0.00 suggested, not saved", note: "Daily gross was below ₱3,000.00", status: "Needs review", type: "outstanding" }
      ],
      bulk: [{ date: "October 2, 2026", meta: "Closed business day", amount: 0, suggestion: "₱0.00 suggestion, not saved" }]
    },
    staff: {
      title: "Staff meals", rule: "Manual ledger. Started October 1, 2026. No automatic suggestion rule.", balance: "₱725.00",
      rows: [{ date: "Oct 3, 2026", record: "Outstanding day", deposit: "Not recorded", suggestion: "No suggestion", note: "Enter an amount only if this day needs a deposit", status: "Needs review", type: "outstanding" }],
      bulk: [{ date: "October 3, 2026", meta: "Closed business day", amount: 0, suggestion: "No suggestion available. Enter an amount." }]
    }
  };

  function rowActions(row) {
    if (row.type === "outstanding") {
      return '<button class="table-action" type="button" data-modal="deposit-modal">Record</button>';
    }
    const label = row.type === "deposit" ? "deposit" : "withdrawal";
    return '<button class="table-action" type="button" data-edit="' + label + '">Edit</button> <button class="table-action" type="button" data-delete="' + label + '" data-date="' + row.date + '">Delete</button>';
  }

  function renderActivity(rows) {
    activityBody.innerHTML = rows.map((row) => {
      const suggestion = row.suggestion.includes("suggested")
        ? '<span class="compensation-suggested">' + row.suggestion + '</span>'
        : row.suggestion === "No suggestion"
          ? '<span class="journal-no-suggestion">No suggestion available</span>'
          : row.suggestion;
      return '<tr><td>' + row.date + '</td><td>' + row.record + '</td><td class="num">' + row.deposit + '</td><td>' + suggestion + '</td><td><span class="journal-note">' + row.note + '</span></td><td><span class="journal-status"><strong>' + row.status + '</strong><small>' + (row.type === "outstanding" ? "No deposit recorded yet" : "Recorded in ledger") + '</small></span></td><td>' + rowActions(row) + '</td></tr>';
    }).join("");
    activityCount.textContent = rows.length + " records and outstanding days";
  }

  function renderBulk(rows) {
    bulkRows.innerHTML = rows.map((row, index) => '<div class="journal-bulk-row"><label class="journal-bulk-check"><input class="bulk-check" type="checkbox" checked data-index="' + index + '"><span class="visually-hidden">Select </span>' + row.date + '</label><div class="journal-bulk-day"><strong>' + row.meta + '</strong><small>' + row.suggestion + '</small></div><div class="journal-bulk-amount"><label for="bulk-amount-' + index + '">Deposit amount</label><input id="bulk-amount-' + index + '" class="bulk-amount" inputmode="decimal" value="' + row.amount.toFixed(2) + '" data-index="' + index + '"></div></div>').join("");
    document.querySelector("#bulk-all").checked = true;
    updateBulkTotal();
  }

  function updateBulkTotal() {
    const checks = [...document.querySelectorAll(".bulk-check")];
    let selected = 0;
    let cents = 0;
    checks.forEach((check) => {
      if (!check.checked) return;
      selected += 1;
      const input = document.querySelector('.bulk-amount[data-index="' + check.dataset.index + '"]');
      cents += Math.round((Number(input.value) || 0) * 100);
    });
    document.querySelector("#bulk-results").textContent = selected + " of " + checks.length + " selected";
    document.querySelector("#bulk-total").textContent = "₱" + (cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    bulkSave.disabled = selected === 0;
  }

  function switchTab(tabName, moveFocus) {
    const showBulk = tabName === "bulk";
    activityPanel.hidden = showBulk;
    bulkPanel.hidden = !showBulk;
    activityTab.setAttribute("aria-selected", String(!showBulk));
    bulkTab.setAttribute("aria-selected", String(showBulk));
    if (showBulk) {
      bulkTab.setAttribute("aria-current", "page");
      activityTab.removeAttribute("aria-current");
    } else {
      activityTab.setAttribute("aria-current", "page");
      bulkTab.removeAttribute("aria-current");
    }
    if (moveFocus) (showBulk ? bulkTab : activityTab).focus();
  }

  function resetState() {
    content.hidden = false;
    loading.hidden = true;
    error.hidden = true;
    notice.hidden = true;
    bulkConflictNotice.hidden = true;
    activityEmpty.hidden = true;
    document.querySelector(".report-table-region").hidden = false;
    bulkRows.hidden = false;
    bulkEmpty.hidden = true;
    bulkTotals.hidden = false;
    bulkSave.hidden = false;
    ledgerTitle.textContent = "Rent";
    ledgerRule.textContent = "10% of daily gross. Started October 1, 2026.";
    balanceValue.textContent = "₱9,842.50";
    balanceStatus.textContent = "Available";
    balanceStatus.className = "variance variance-even";
    renderActivity(normalRows);
    renderBulk(bulkData);
    switchTab("activity", false);
  }

  function applyState(value) {
    resetState();
    if (value === "empty") {
      activityBody.innerHTML = "";
      document.querySelector(".report-table-region").hidden = true;
      activityEmpty.hidden = false;
      activityCount.textContent = "0 records";
      balanceValue.textContent = "₱0.00";
    }
    if (value === "negative") {
      balanceValue.textContent = "₱-1,275.50";
      balanceStatus.textContent = "Negative balance";
      balanceStatus.className = "variance variance-short";
    }
    if (value === "long") {
      ledgerTitle.textContent = "Emergency equipment repairs and long-term café maintenance reserve";
      ledgerRule.textContent = "Manual ledger. Started October 1, 2026. No automatic suggestion rule.";
      renderActivity(longRows);
    }
    if (value === "duplicate") {
      notice.innerHTML = "<strong>Deposit not saved.</strong> Rent already has a deposit for October 1, 2026. The existing deposit was not changed.";
      notice.hidden = false;
      openModal(stateSelect, "deposit-modal");
      document.querySelector("#deposit-day").value = "2026-10-01";
      document.querySelector("#deposit-conflict").hidden = false;
    }
    if (value === "bulk-populated") switchTab("bulk", false);
    if (value === "bulk-empty") {
      switchTab("bulk", false);
      bulkRows.hidden = true;
      bulkEmpty.hidden = false;
      bulkTotals.hidden = true;
      bulkSave.hidden = true;
      document.querySelector("#bulk-results").textContent = "0 outstanding days";
    }
    if (value === "bulk-conflict") {
      switchTab("bulk", false);
      bulkConflictNotice.hidden = false;
    }
    if (value === "loading") {
      content.hidden = true;
      loading.hidden = false;
    }
    if (value === "error") {
      content.hidden = true;
      error.hidden = false;
    }
  }

  function focusableElements(modal) {
    return [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((item) => !item.hidden);
  }

  function openModal(trigger, id) {
    const modal = document.querySelector("#" + id);
    if (!modal) return;
    lastModalTrigger = trigger || document.activeElement;
    activeModal = modal;
    modal.hidden = false;
    const focusable = focusableElements(modal);
    if (focusable.length) focusable[0].focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    activeModal = null;
    if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
  }

  document.addEventListener("click", (event) => {
    const modalTrigger = event.target.closest("[data-modal]");
    if (modalTrigger) openModal(modalTrigger, modalTrigger.dataset.modal);
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) closeModal(closeButton.closest(".inventory-modal-backdrop"));
    const editButton = event.target.closest("[data-edit]");
    if (editButton) openModal(editButton, editButton.dataset.edit === "deposit" ? "deposit-modal" : "withdrawal-modal");
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      const isDeposit = deleteButton.dataset.delete === "deposit";
      document.querySelector("#delete-title").textContent = isDeposit ? "Delete deposit?" : "Delete withdrawal?";
      document.querySelector("#delete-message").textContent = isDeposit ? "Deleting this deposit makes " + deleteButton.dataset.date + " un-recorded again." : "This withdrawal will be removed from the ledger balance.";
      const dangerButton = document.querySelector("#delete-modal .danger");
      dangerButton.textContent = isDeposit ? "Delete deposit" : "Delete withdrawal";
      openModal(deleteButton, "delete-modal");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeModal) closeModal(activeModal);
    if (event.key === "Tab" && activeModal) {
      const focusable = focusableElements(activeModal);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  activityTab.addEventListener("click", () => switchTab("activity", false));
  bulkTab.addEventListener("click", () => switchTab("bulk", false));
  activityTab.addEventListener("keydown", (event) => { if (event.key === "ArrowRight") switchTab("bulk", true); });
  bulkTab.addEventListener("keydown", (event) => { if (event.key === "ArrowLeft") switchTab("activity", true); });
  stateSelect.addEventListener("change", () => applyState(stateSelect.value));
  document.querySelector("#retry-button").addEventListener("click", () => { stateSelect.value = "populated"; applyState("populated"); });
  document.querySelector("#refresh-bulk").addEventListener("click", () => { bulkConflictNotice.hidden = true; renderBulk(bulkData); });
  document.querySelector("#use-suggestion").addEventListener("click", () => { document.querySelector("#deposit-amount").value = "412.25"; });
  document.querySelectorAll('input[name="amount-source"]').forEach((radio) => radio.addEventListener("change", () => {
    if (radio.checked && radio.value === "suggested") document.querySelector("#deposit-amount").value = "412.25";
    if (radio.checked && radio.value === "manual") document.querySelector("#deposit-amount").focus();
  }));
  document.querySelector(".journal-ledger-list").addEventListener("click", (event) => {
    const button = event.target.closest(".journal-ledger-row");
    if (!button) return;
    const view = ledgerViews[button.dataset.ledger];
    document.querySelectorAll(".journal-ledger-row").forEach((row) => { row.classList.remove("is-selected"); row.removeAttribute("aria-current"); });
    button.classList.add("is-selected");
    button.setAttribute("aria-current", "true");
    ledgerTitle.textContent = view.title;
    ledgerRule.textContent = view.rule;
    balanceValue.textContent = view.balance;
    document.querySelector(".report-table-region").setAttribute("aria-label", view.title + " activity table. Scroll horizontally for more columns.");
    renderActivity(view.rows);
    renderBulk(view.bulk);
  });
  document.querySelector("#bulk-all").addEventListener("change", (event) => { document.querySelectorAll(".bulk-check").forEach((check) => { check.checked = event.target.checked; }); updateBulkTotal(); });
  bulkRows.addEventListener("input", updateBulkTotal);
  bulkRows.addEventListener("change", updateBulkTotal);

  document.querySelector("#deposit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(document.querySelector("#deposit-amount").value);
    const amountError = document.querySelector("#deposit-error");
    amountError.hidden = amount >= 0;
    if (amount < 0) return;
    const duplicate = document.querySelector("#deposit-day").value === "2026-10-01";
    document.querySelector("#deposit-conflict").hidden = !duplicate;
    if (duplicate) return;
    const submit = event.submitter;
    submit.disabled = true; submit.textContent = "Saving deposit...";
    window.setTimeout(() => { submit.disabled = false; submit.textContent = "Save deposit"; closeModal(document.querySelector("#deposit-modal")); }, 650);
  });

  document.querySelector("#withdrawal-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(document.querySelector("#withdrawal-amount").value);
    const amountError = document.querySelector("#withdrawal-error");
    amountError.hidden = amount > 0;
    if (amount <= 0) return;
    const submit = event.submitter;
    submit.disabled = true; submit.textContent = "Saving withdrawal...";
    window.setTimeout(() => { submit.disabled = false; submit.textContent = "Save withdrawal"; closeModal(document.querySelector("#withdrawal-modal")); }, 650);
  });

  document.querySelector("#ledger-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const duplicate = document.querySelector("#ledger-name").value.trim().toLowerCase() === "rent";
    const nameError = document.querySelector("#ledger-name-error");
    nameError.hidden = !duplicate;
    if (duplicate) return;
    const submit = event.submitter;
    submit.disabled = true; submit.textContent = "Adding ledger...";
    window.setTimeout(() => { submit.disabled = false; submit.textContent = "Add ledger"; closeModal(document.querySelector("#ledger-modal")); }, 650);
  });

  document.querySelector("#settings-form").addEventListener("submit", (event) => { event.preventDefault(); closeModal(document.querySelector("#settings-modal")); });
  document.querySelector("#bulk-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true; submit.textContent = "Saving selected deposits...";
    window.setTimeout(() => { submit.disabled = false; submit.textContent = "Save selected deposits"; }, 650);
  });

  const menuButton = document.querySelector(".admin-menu-button");
  menuButton.addEventListener("click", () => {
    const sidebar = document.querySelector(".admin-sidebar");
    const open = sidebar.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  applyState("populated");
})();
