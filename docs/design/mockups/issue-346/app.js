"use strict";

const stateSets = {
  placement: [
    ["recommended", "Recommended placement"],
    ["rejected", "Daily records alternative"]
  ],
  adjustments: [
    ["default", "Default list"],
    ["empty", "No adjustments yet"],
    ["filtered", "No filter matches"],
    ["deleted", "Deleted confirmation"]
  ],
  dialog: [
    ["add", "Add default"],
    ["advance", "Kind = Advance"],
    ["edited", "Preset then edited"],
    ["descriptionEmpty", "Description empty"],
    ["descriptionLong", "Description over 120"],
    ["amountMissing", "Amount missing"],
    ["amountNegative", "Amount negative"],
    ["amountNonnumeric", "Amount non-numeric"],
    ["amountSubcentavo", "Amount sub-centavo"],
    ["submitting", "Submitting"],
    ["edit", "Edit pre-populated"]
  ],
  delete: [
    ["confirm", "Confirmation"],
    ["deleting", "Deleting"],
    ["deleted", "Deleted"]
  ],
  payslip: [
    ["positive", "Result with adjustments"],
    ["negative", "Negative net payable"],
    ["onlyAdvances", "Only advances"],
    ["empty", "No records in range"],
    ["loading", "Loading"]
  ],
  download: [
    ["ready", "Ready"],
    ["preparing", "Preparing image"],
    ["downloaded", "Downloaded"],
    ["failed", "Failed"],
    ["empty", "Empty range"]
  ]
};

const currentState = Object.fromEntries(Object.entries(stateSets).map(([key, states]) => [key, states[0][0]]));

function money(value, negative = false) {
  return `<span class="money${negative ? " negative" : ""}">${negative ? "₱-" : "₱"}${value}</span>`;
}

function contextSwitch(active) {
  const items = ["Daily records", "Adjustments", "Payslips"];
  return `<nav class="reporting-context" aria-label="Compensation views">
    ${items.map((item) => `<a href="#" ${item === active ? 'aria-current="page"' : ""}>${item}</a>`).join("")}
  </nav>`;
}

function adminShell(content, active = "Adjustments") {
  return `<div class="admin-shell catalog-admin-shell">
    <aside class="admin-sidebar" aria-label="Admin navigation">
      <div class="admin-brand"><span class="brand-mark">UC</span><span>UCM Coffee Studio</span></div>
      <div class="admin-nav-group">
        <p>Store</p>
        <nav class="admin-nav-group-links" aria-label="Store">
          <a href="#">Overview</a><a href="#">Catalog</a><a href="#">Inventory</a>
        </nav>
      </div>
      <div class="admin-nav-group">
        <p>Operations</p>
        <nav class="admin-nav-group-links" aria-label="Operations">
          <a href="#">Sales</a><a href="#">Staff</a><a href="#" aria-current="page">Compensation</a>
        </nav>
      </div>
    </aside>
    <div class="reporting-page">
      <div class="reporting-page-head">
        <div><h3>Compensation</h3><p>Review staff earnings and adjustments.</p></div>
      </div>
      ${contextSwitch(active)}
      ${content}
    </div>
  </div>`;
}

function placementView(state) {
  if (state === "rejected") {
    return adminShell(`<div class="report-panel">
      <div class="report-panel-head"><div><h3>Daily records</h3><p>Rejected alternative shown for comparison.</p></div></div>
      <div class="catalog-notice danger"><strong>Do not fold adjustments into this surface.</strong> Daily records describe worked days and commission. Standalone dated adjustments have their own kind, description, validation, and hard-delete flow.</div>
      <div class="catalog-empty"><div><h3>Mixed responsibilities reduce clarity</h3><p>An advance row would sit beside work records even though it is not derived from attendance or sales.</p></div></div>
    </div>`, "Daily records");
  }
  return adminShell(`<div class="report-panel">
    <div class="report-panel-head">
      <div><h3>Adjustments</h3><p>Standalone allowances, bonuses, and advances.</p></div>
      <button class="catalog-button primary" type="button">Add adjustment</button>
    </div>
    <div class="catalog-empty"><div><h3>A distinct surface inside Compensation</h3><p>The third segment keeps adjustment management adjacent to payslips without confusing it with daily work records.</p></div></div>
  </div>`);
}

function filters(filtered = false) {
  return `<form class="report-filter" aria-label="Adjustment filters">
    <label class="report-filter-copy"><span class="catalog-field-label">Staff member</span><select><option>${filtered ? "Paolo Reyes" : "All staff members"}</option></select></label>
    <label class="report-filter-copy"><span class="catalog-field-label">From date</span><input type="date" value="${filtered ? "2026-07-01" : "2026-08-01"}"></label>
    <label class="report-filter-copy"><span class="catalog-field-label">To date</span><input type="date" value="${filtered ? "2026-07-15" : "2026-08-31"}"></label>
    <a class="inventory-clear-filters" href="#">Clear filters</a>
  </form>`;
}

const adjustmentRows = [
  ["kind-bonus", "Maria Santos", "Aug 28, 2026", "bonus", "Bonus", "Performance bonus", "2,000.00", false],
  ["kind-advance", "Paolo Reyes", "Aug 22, 2026", "advance", "Advance", "Emergency cash advance", "1,200.00", true],
  ["kind-allowance", "Maria Santos", "Aug 15, 2026", "allowance", "Allowance", "Transportation allowance", "450.00", false],
  ["kind-allowance", "Maria Santos", "Aug 15, 2026", "allowance", "Allowance", "Transportation allowance", "450.00", false],
  ["kind-allowance", "Ana Villanueva", "Aug 8, 2026", "allowance", "Allowance", "Load allowance", "600.00", false],
  ["kind-advance", "Maria Santos", "Aug 4, 2026", "advance", "Advance", "School supplies advance", "3,000.00", true]
];

function adjustmentsTable() {
  return `<div class="table-scroll" role="region" aria-label="Adjustments table" tabindex="0">
    <table class="catalog-table">
      <thead><tr><th scope="col">Staff member</th><th scope="col">Effective date</th><th scope="col">Kind</th><th scope="col">Description</th><th scope="col" class="amount-cell">Amount</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${adjustmentRows.map(([rowClass, staff, date, kindClass, kind, description, amount, negative]) => `<tr class="adjustment-row ${rowClass}">
        <td><strong>${staff}</strong></td><td>${date}</td><td><span class="kind-badge ${kindClass}">${kind}</span></td><td>${description}</td><td class="amount-cell">${money(amount, negative)}</td>
        <td><div class="table-actions"><button type="button" aria-label="Edit ${description} for ${staff}">Edit</button><button class="delete-link" type="button" aria-label="Delete ${description} for ${staff}">Delete</button></div></td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function adjustmentsView(state) {
  let body = "";
  if (state === "default" || state === "deleted") {
    body = `${filters()}${state === "deleted" ? '<div class="catalog-notice success" role="status"><strong>Adjustment deleted.</strong> Maria Santos, Aug 4, 2026, Advance, School supplies advance, ₱-3,000.00.</div>' : ""}<p class="results-meta">Showing 6 adjustments from Aug 1 to Aug 31, newest first.</p>${adjustmentsTable()}`;
  } else if (state === "empty") {
    body = `${filters()}<p class="results-meta">Showing 0 adjustments from Aug 1 to Aug 31.</p><div class="catalog-empty"><div><h3>No adjustments recorded yet</h3><p>Add the first standalone allowance, bonus, or advance for a staff member.</p><button type="button" class="catalog-button primary">Add adjustment</button></div></div>`;
  } else {
    body = `${filters(true)}<p class="results-meta">Showing 0 adjustments for Paolo Reyes from Jul 1 to Jul 15.</p><div class="catalog-empty empty-critical"><div><h3>No adjustments match these filters</h3><p>Keep the current filters visible so the admin can see why the list is empty.</p><a class="inventory-clear-filters" href="#">Clear filters</a></div></div>`;
  }
  return adminShell(`<div class="report-panel"><div class="report-panel-head"><div><h3>Adjustments</h3><p>Current month on first load. No deduplication is applied.</p></div><button type="button" class="catalog-button primary">Add adjustment</button></div>${body}</div>`);
}

function dialogConfig(state) {
  const configs = {
    add: { title: "Add adjustment", kind: "Allowance", description: "", amount: "", count: 0 },
    advance: { title: "Add adjustment", kind: "Advance", description: "", amount: "", count: 0 },
    edited: { title: "Add adjustment", kind: "Allowance", description: "Transportation allowance - closing shift", amount: "450.00", count: 41, selectedPreset: "Transportation allowance" },
    descriptionEmpty: { title: "Add adjustment", kind: "Allowance", description: "   ", amount: "450.00", count: 3, errorField: "description", error: "Enter a description. Spaces alone are not accepted." },
    descriptionLong: { title: "Add adjustment", kind: "Bonus", description: "Performance bonus for consistently covering additional opening shifts and supporting new baristas during the August training schedule", amount: "2000.00", count: 128, errorField: "description", error: "Description must be 120 characters or fewer." },
    amountMissing: { title: "Add adjustment", kind: "Allowance", description: "Load allowance", amount: "", count: 14, errorField: "amount", error: "Enter an amount." },
    amountNegative: { title: "Add adjustment", kind: "Advance", description: "Emergency cash advance", amount: "-1200.00", count: 22, errorField: "amount", error: "Enter a positive amount. The kind determines its sign." },
    amountNonnumeric: { title: "Add adjustment", kind: "Bonus", description: "Spot bonus", amount: "two thousand", count: 10, errorField: "amount", error: "Enter a numeric peso amount." },
    amountSubcentavo: { title: "Add adjustment", kind: "Allowance", description: "Transportation allowance", amount: "12.345", count: 24, errorField: "amount", error: "Enter no more than two decimal places." },
    submitting: { title: "Add adjustment", kind: "Allowance", description: "Calamity allowance", amount: "1500.00", count: 18, disabled: true },
    edit: { title: "Edit adjustment", kind: "Bonus", description: "Performance bonus", amount: "2000.00", count: 17, edit: true }
  };
  return configs[state] || configs.add;
}

function presetBlock(kind, selectedPreset) {
  const values = kind === "Allowance"
    ? ["Load allowance", "Transportation allowance", "Calamity allowance"]
    : kind === "Bonus" ? ["Performance bonus", "Spot bonus"] : [];
  if (!values.length) {
    return `<div class="preset-block span-2"><p class="preset-label">Start from</p><p class="no-presets">No presets for advances. Type a description.</p></div>`;
  }
  return `<div class="preset-block span-2"><p class="preset-label">Start from</p><div class="preset-chips">${values.map((value) => `<button type="button" class="preset-chip" data-preset="${value}" aria-pressed="${value === selectedPreset}">${value}</button>`).join("")}</div><p class="catalog-field-help">Choosing a preset fills the text field. You can edit every character afterwards.</p></div>`;
}

function errorSummary(config) {
  if (!config.error) return "";
  const label = config.errorField === "amount" ? "Amount" : "Description";
  return `<div class="staff-account-error-list" role="alert"><h4>Fix the following field</h4><ul><li><a href="#adjustment-${config.errorField}">${label}: ${config.error}</a></li></ul></div>`;
}

function adjustmentDialog(state) {
  const c = dialogConfig(state);
  const disabled = c.disabled ? " disabled" : "";
  const invalidDescription = c.errorField === "description";
  const invalidAmount = c.errorField === "amount";
  return `<div class="inventory-modal-backdrop">
    <section class="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-dialog-title">
      <div class="inventory-modal-head"><div><h3 id="adjustment-dialog-title">${c.title}</h3><p>${c.edit ? "Update this standalone dated row." : "Record a standalone dated compensation row."}</p></div><button type="button" class="modal-close" aria-label="Close dialog"${disabled}>×</button></div>
      <div class="modal-body">
        ${errorSummary(c)}
        <form>
          <div class="modal-grid">
            <label class="catalog-field"><span class="catalog-field-label">Staff member</span><select id="adjustment-staff"${disabled}><option>${c.edit ? "Maria Santos" : "Ana Villanueva"}</option><option>Maria Santos</option><option>Paolo Reyes</option></select></label>
            <label class="catalog-field"><span class="catalog-field-label">Effective date</span><input id="adjustment-date" type="date" value="2026-08-${c.edit ? "28" : "22"}"${disabled}></label>
            <div class="catalog-field span-2"><span class="catalog-field-label" id="kind-label">Kind</span><div class="kind-control" role="group" aria-labelledby="kind-label">${["Advance", "Allowance", "Bonus"].map((kind) => `<button type="button" data-dialog-kind="${kind}" aria-pressed="${kind === c.kind}"${disabled}>${kind}</button>`).join("")}</div><p class="catalog-field-help">Amounts are stored positive. Kind supplies the direction in payslip arithmetic.</p></div>
            ${presetBlock(c.kind, c.selectedPreset)}
            <label class="catalog-field span-2" for="adjustment-description"><span class="catalog-field-label">Description</span><input id="adjustment-description" type="text" required maxlength="120" value="${c.description}" aria-describedby="description-help description-count${invalidDescription ? " description-error" : ""}" aria-invalid="${invalidDescription}"${disabled}><span id="description-count" class="character-count${c.count > 120 ? " over" : ""}">${c.count} / 120</span><span id="description-help" class="catalog-field-help">Required. Leading and trailing spaces are removed before storage.</span>${invalidDescription ? `<span id="description-error" class="catalog-field-error">${c.error}</span>` : ""}</label>
            <label class="catalog-field span-2" for="adjustment-amount"><span class="catalog-field-label">Amount</span><span class="amount-input-wrap"><span aria-hidden="true">₱</span><input id="adjustment-amount" type="text" inputmode="decimal" value="${c.amount}" aria-describedby="amount-help${invalidAmount ? " amount-error" : ""}" aria-invalid="${invalidAmount}"${disabled}></span><span id="amount-help" class="catalog-field-help">Positive pesos only, with up to two decimal places. Minimum ₱0.01.</span>${invalidAmount ? `<span id="amount-error" class="catalog-field-error">${c.error}</span>` : ""}</label>
          </div>
          <div class="catalog-form-actions"><button type="button" class="catalog-button"${disabled}>Cancel</button><button type="submit" class="catalog-button primary"${disabled}>${c.disabled ? '<span class="busy-label">Saving</span>' : c.edit ? "Save changes" : "Add adjustment"}</button></div>
        </form>
      </div>
    </section>
  </div>`;
}

function deleteDialog(state) {
  if (state === "deleted") {
    return `<div class="inventory-modal-backdrop"><section class="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="deleted-title"><div class="inventory-modal-head"><div><h3 id="deleted-title">Adjustment deleted</h3><p>The row has been permanently removed.</p></div><button type="button" class="modal-close" aria-label="Close dialog">×</button></div><div class="modal-body"><div class="catalog-notice success" role="status"><strong>Deleted:</strong> Maria Santos, Aug 4, 2026, Advance, School supplies advance, ₱-3,000.00.</div><div class="catalog-form-actions"><button type="button" class="catalog-button primary">Done</button></div></div></section></div>`;
  }
  const deleting = state === "deleting";
  return `<div class="inventory-modal-backdrop"><section class="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div class="inventory-modal-head"><div><h3 id="delete-title">Delete adjustment?</h3><p>This permanently deletes the row. There is no undo.</p></div><button type="button" class="modal-close" aria-label="Close dialog"${deleting ? " disabled" : ""}>×</button></div><div class="modal-body"><dl class="delete-detail"><div><dt>Staff member</dt><dd>Maria Santos</dd></div><div><dt>Effective date</dt><dd>Aug 4, 2026</dd></div><div><dt>Kind</dt><dd><span class="kind-badge advance">Advance</span></dd></div><div><dt>Description</dt><dd>School supplies advance</dd></div><div><dt>Amount</dt><dd>${money("3,000.00", true)}</dd></div></dl><div class="catalog-form-actions"><button type="button" class="catalog-button"${deleting ? " disabled" : ""}>Cancel</button><button type="button" class="catalog-button danger"${deleting ? " disabled" : ""}>${deleting ? '<span class="busy-label">Deleting</span>' : "Delete permanently"}</button></div></div></section></div>`;
}

const payslipData = {
  positive: {
    staff: "Maria Santos", range: "Aug 1 to Aug 31, 2026 (inclusive)",
    earnings: [
      ["Daily salary", "Aug 1-15", "12,000.00"], ["Sales commission", "Aug 1-31", "3,480.00"],
      ["Load allowance", "Allowance, Aug 8", "600.00"], ["Transportation allowance", "Allowance, Aug 15", "450.00"],
      ["Transportation allowance", "Allowance, Aug 15", "450.00"], ["Performance bonus", "Bonus, Aug 28", "2,000.00"]
    ], earningsTotal: "18,980.00", deductions: [["School supplies advance", "Aug 4", "3,000.00"], ["Emergency cash advance", "Aug 22", "1,200.00"]], advanceTotal: "4,200.00", net: "14,780.00"
  },
  negative: {
    staff: "Paolo Reyes", range: "Aug 16 to Aug 31, 2026 (inclusive)",
    earnings: [["Daily salary", "Aug 16-20", "4,500.00"], ["Sales commission", "Aug 16-31", "700.00"], ["Load allowance", "Allowance, Aug 18", "500.00"]],
    earningsTotal: "5,700.00", deductions: [["Medical cash advance", "Aug 17", "4,000.00"], ["Emergency cash advance", "Aug 24", "2,800.00"]], advanceTotal: "6,800.00", net: "1,100.00", negative: true
  },
  onlyAdvances: {
    staff: "Ana Villanueva", range: "Aug 21 to Aug 24, 2026 (inclusive)", earnings: [], earningsTotal: "0.00",
    deductions: [["Emergency cash advance", "Aug 22", "1,500.00"]], advanceTotal: "1,500.00", net: "1,500.00", negative: true, onlyAdvances: true
  }
};

function artifactTable(rows, emptyCopy) {
  if (!rows.length) return `<p class="catalog-field-help">${emptyCopy}</p>`;
  return `<table class="payslip-table"><thead><tr><th scope="col">Item</th><th scope="col">Amount</th></tr></thead><tbody>${rows.map(([label, note, amount]) => `<tr><td>${label}<span class="item-note">${note}</span></td><td>${money(amount)}</td></tr>`).join("")}</tbody></table>`;
}

function payslipArtifact(data, options = {}) {
  const negative = Boolean(data.negative);
  return `<article class="payslip-artifact" id="payslip-capture-node" aria-busy="${options.preparing ? "true" : "false"}">
    <header class="payslip-artifact-head"><div><p class="artifact-zone-label">Generated payslip</p><h3>${data.staff}</h3><p>${data.range}</p></div>${options.showDownload ? `<div class="artifact-action"><button type="button" class="catalog-button primary" data-download-action${options.preparing ? " disabled" : ""}>${options.preparing ? '<span class="busy-label">Preparing image...</span>' : "Download PNG"}</button></div>` : ""}</header>
    <section class="payslip-zone" aria-labelledby="earnings-label"><p class="artifact-zone-label" id="earnings-label">Earnings</p>${data.onlyAdvances ? '<p class="only-advance-note">No earnings fall inside this range. The advance remains a valid dated row.</p>' : ""}${artifactTable(data.earnings, "No salary, commission, allowance, or bonus items in this range.")}<dl class="report-totals"><div class="report-metric"><dt>Earnings total</dt><dd>₱${data.earningsTotal}</dd></div></dl></section>
    <hr class="payslip-rule">
    <section class="payslip-zone" aria-labelledby="deductions-label"><p class="artifact-zone-label" id="deductions-label">Deductions</p>${artifactTable(data.deductions, "No advances in this range.")}<dl class="report-totals"><div class="report-metric"><dt>Advance total</dt><dd>₱${data.advanceTotal}</dd></div></dl></section>
    <div class="net-payable${negative ? " negative" : ""}"><div><p class="net-payable-label">Net payable</p>${negative ? '<p class="net-payable-note">Advances in this range exceed earnings. This is not carried into another range.</p>' : '<p class="net-payable-note">Earnings total less advance total.</p>'}</div><p class="net-payable-value">${negative ? "₱-" : "₱"}${data.net}</p></div>
    <p class="generated-line">Generated Aug 31, 2026 at 6:42 PM</p>
  </article>`;
}

function payslipView(state) {
  if (state === "loading") {
    return adminShell(`<div class="report-panel"><div class="report-panel-head"><div><h3>Generate payslip</h3><p>Maria Santos, Aug 1 to Aug 31.</p></div></div><div class="loading-panel" aria-busy="true" aria-label="Generating payslip"><span class="loading-line"></span><span class="loading-line"></span><span class="loading-line"></span><span class="loading-line"></span><span class="loading-line"></span></div></div>`, "Payslips");
  }
  if (state === "empty") {
    return adminShell(`<div class="report-panel"><div class="report-panel-head"><div><h3>Generate payslip</h3><p>Paolo Reyes, Jul 1 to Jul 7.</p></div></div><div class="catalog-empty empty-critical"><div><h3>No records in this range</h3><p>No daily records or adjustments were found. No payslip was generated, so there is nothing to download.</p><button type="button" class="catalog-button">Change date range</button></div></div></div>`, "Payslips");
  }
  return adminShell(`<div class="payslip-stage">${payslipArtifact(payslipData[state], { showDownload: true })}</div>`, "Payslips");
}

function downloadView(state) {
  if (state === "empty") {
    return adminShell(`<div class="report-panel"><div class="report-panel-head"><div><h3>Generate payslip</h3><p>Maria Santos, Jul 1 to Jul 3.</p></div></div><div class="catalog-empty empty-critical"><div><h3>No records in this range</h3><p>Download is absent because no payslip artifact was generated.</p><button type="button" class="catalog-button">Change date range</button></div></div></div>`, "Payslips");
  }
  const options = { showDownload: true, preparing: state === "preparing" };
  let notice = "";
  if (state === "downloaded") notice = '<div class="catalog-notice success download-status" role="status"><strong>Downloaded:</strong> payslip-maria-santos-2026-08-01-2026-08-31.png</div>';
  if (state === "failed") notice = '<div class="catalog-notice danger download-status" role="alert"><strong>Image could not be prepared.</strong> The on-screen payslip is unchanged. <button type="button" class="catalog-button small" data-retry-download>Try again</button></div>';
  return adminShell(`<div class="payslip-stage">${payslipArtifact(payslipData.positive, options)}${notice}</div>`, "Payslips");
}

const renderers = {
  placement: placementView,
  adjustments: adjustmentsView,
  dialog: adjustmentDialog,
  delete: deleteDialog,
  payslip: payslipView,
  download: downloadView
};

function renderSwitcher(section) {
  const host = document.querySelector(`[data-state-switcher="${section}"]`);
  host.innerHTML = stateSets[section].map(([id, label]) => `<button type="button" data-state="${id}" aria-pressed="${id === currentState[section]}">${label}</button>`).join("");
  host.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      currentState[section] = button.dataset.state;
      renderSection(section);
    });
  });
}

function wireDialog() {
  const preview = document.querySelector('[data-preview="dialog"]');
  const input = preview.querySelector("#adjustment-description");
  const counter = preview.querySelector("#description-count");
  if (input && counter) {
    input.addEventListener("input", () => {
      counter.textContent = `${input.value.length} / 120`;
      counter.classList.toggle("over", input.value.length > 120);
    });
  }
  preview.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!input) return;
      input.value = button.dataset.preset;
      input.dispatchEvent(new Event("input"));
      preview.querySelectorAll("[data-preset]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      input.focus();
    });
  });
  preview.querySelectorAll("[data-dialog-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      currentState.dialog = button.dataset.dialogKind === "Advance" ? "advance" : "add";
      const c = dialogConfig(currentState.dialog);
      c.kind = button.dataset.dialogKind;
      preview.innerHTML = adjustmentDialogFromConfig(c);
      wireDialog();
    });
  });
  const form = preview.querySelector("form");
  if (form) form.addEventListener("submit", (event) => event.preventDefault());
}

function adjustmentDialogFromConfig(config) {
  const temporaryKey = "__interactive";
  const original = dialogConfig;
  dialogConfigOverrides[temporaryKey] = config;
  const html = adjustmentDialogWithOverride(temporaryKey);
  delete dialogConfigOverrides[temporaryKey];
  return html;
}

const dialogConfigOverrides = {};
const baseAdjustmentDialog = adjustmentDialog;
function adjustmentDialogWithOverride(state) {
  if (!dialogConfigOverrides[state]) return baseAdjustmentDialog(state);
  const c = dialogConfigOverrides[state];
  const synthetic = c.kind === "Advance" ? "advance" : "add";
  let html = baseAdjustmentDialog(synthetic);
  if (c.kind === "Bonus") {
    html = html.replace(/aria-pressed="true">Allowance/, 'aria-pressed="false">Allowance').replace(/aria-pressed="false">Bonus/, 'aria-pressed="true">Bonus');
    html = html.replace(presetBlock("Allowance"), presetBlock("Bonus"));
  }
  return html;
}

function wireDownload() {
  const preview = document.querySelector('[data-preview="download"]');
  const button = preview.querySelector("[data-download-action]");
  if (button && currentState.download === "ready") {
    button.addEventListener("click", () => {
      currentState.download = "preparing";
      renderSection("download");
      window.setTimeout(() => {
        currentState.download = "downloaded";
        renderSection("download");
      }, 700);
    });
  }
  const retry = preview.querySelector("[data-retry-download]");
  if (retry) retry.addEventListener("click", () => {
    currentState.download = "preparing";
    renderSection("download");
    window.setTimeout(() => {
      currentState.download = "downloaded";
      renderSection("download");
    }, 700);
  });
}

function renderSection(section) {
  renderSwitcher(section);
  const preview = document.querySelector(`[data-preview="${section}"]`);
  preview.innerHTML = renderers[section](currentState[section]);
  if (section === "dialog") wireDialog();
  if (section === "download") wireDownload();
}

Object.keys(stateSets).forEach(renderSection);
