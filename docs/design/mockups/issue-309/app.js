const records = [
  ["Mara Santos", "Aug 14, 2026", "₱1,200.00", "₱450.00", "₱1,650.00"],
  ["Omar Diaz", "Aug 14, 2026", "₱950.00", "₱620.00", "₱1,570.00"],
  ["Ines Reyes", "Aug 13, 2026", "₱1,100.00", "₱480.00", "₱1,580.00"],
  ["Jon Bell", "Aug 13, 2026", "₱900.00", "₱700.00", "₱1,600.00"],
  ["Mara Santos", "Aug 12, 2026", "₱1,200.00", "₱510.00", "₱1,710.00"]
];

const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[character]));

function tableRows(rows, actions = true) {
  return rows.map((row) => `<tr>
    <th scope="row">${esc(row[0])}</th>
    <td>${esc(row[1])}</td>
    <td class="money">${esc(row[2])}</td>
    <td class="money">${esc(row[3])}</td>
    <td class="money"><strong>${esc(row[4])}</strong></td>
    ${actions ? `<td><div class="table-actions"><button class="catalog-button small" type="button" data-row-action="edit">Edit</button><button class="catalog-button small" type="button" data-row-action="delete">Delete</button></div></td>` : ""}
  </tr>`).join("");
}

function filters() {
  return `<form class="staff-filters" aria-label="Filter compensation records">
    <div class="catalog-field">
      <label class="catalog-field-label" for="filter-staff">Staff member</label>
      <select id="filter-staff"><option>All staff</option><option>Mara Santos</option><option>Jon Bell</option><option>Ines Reyes</option><option>Omar Diaz</option></select>
    </div>
    <div class="catalog-field">
      <label class="catalog-field-label" for="filter-start">From</label>
      <input id="filter-start" type="date" value="2026-08-01">
    </div>
    <div class="catalog-field">
      <label class="catalog-field-label" for="filter-end">To</label>
      <input id="filter-end" type="date" value="2026-08-31">
    </div>
    <button type="button" class="inventory-clear-filters">Clear filters</button>
  </form>`;
}

function renderRecords(state) {
  let body = "";
  if (state === "default") {
    body = `<p class="results-meta">Showing 5 records for Aug 1-31, 2026, all staff</p>
      <div class="catalog-table-wrap" tabindex="0" role="region" aria-label="Daily compensation records table, scroll horizontally to view all columns">
        <table class="catalog-table"><caption class="sr-only">Daily compensation records ordered by work date newest first, then staff member name</caption>
          <thead><tr><th scope="col">Staff member</th><th scope="col">Work date</th><th scope="col" class="money">Salary</th><th scope="col" class="money">Commission</th><th scope="col" class="money">Daily total</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${tableRows(records)}</tbody>
        </table>
      </div>`;
  } else if (state === "no-records") {
    body = `<div class="catalog-empty"><h3>No compensation records yet</h3><p>Add the first daily record for a staff member. Salary and commission can each be zero.</p><button class="catalog-button primary" type="button" data-open-record="add">Add daily record</button></div>`;
  } else {
    body = `<p class="results-meta">Showing 0 records for Aug 1-10, 2026, Mara Santos</p><div class="catalog-empty"><h3>No records match this filter</h3><p>Try another staff member or date range.</p><button class="catalog-button" type="button">Clear filters</button></div>`;
  }
  document.querySelector("#records-preview").innerHTML = `<div class="catalog-page" data-od-id="daily-records-page">
    <header class="catalog-page-head"><div><h2>Compensation</h2><p>Daily salary and commission records</p></div><button class="catalog-button primary" type="button" data-open-record="add">Add daily record</button></header>
    <div class="reporting-context" aria-label="Compensation sections"><button type="button" aria-current="page">Daily records</button><button type="button">Payslips</button></div>
    <div class="catalog-panel">${filters()}${body}</div>
  </div>`;
}

const recordStates = {
  add: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "1200.00", commission: "450.00", total: "₱1,650.00" },
  missing: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "", commission: "", total: "Not available", summary: ["Enter a salary amount.", "Enter a commission amount."], salaryError: "Enter a salary amount. Zero is allowed.", commissionError: "Enter a commission amount. Zero is allowed." },
  negative: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "-50", commission: "450.00", total: "Not available", summary: ["Salary cannot be negative."], salaryError: "Enter zero or a positive amount." },
  nonnumeric: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "one thousand", commission: "450.00", total: "Not available", summary: ["Salary must be a number."], salaryError: "Enter a number, such as 1200.00." },
  subcentavo: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "1200.005", commission: "450.00", total: "Not available", summary: ["Salary cannot have more than 2 decimal places."], salaryError: "Enter an amount to the nearest centavo." },
  future: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-20", salary: "1200.00", commission: "450.00", total: "₱1,650.00", summary: ["Work date cannot be in the future."], dateError: "Choose today or an earlier date." },
  inactive: { title: "Add daily record", staff: "Omar Diaz (inactive)", date: "2026-08-15", salary: "950.00", commission: "620.00", total: "₱1,570.00", summary: ["Omar Diaz is no longer active."], staffError: "Choose an active staff member for a new record." },
  duplicate: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-14", salary: "1200.00", commission: "450.00", total: "₱1,650.00", conflict: true },
  submitting: { title: "Add daily record", staff: "Mara Santos", date: "2026-08-15", salary: "1200.00", commission: "450.00", total: "₱1,650.00", submitting: true },
  edit: { title: "Edit daily record", staff: "Mara Santos", dateLabel: "Aug 14, 2026", salary: "1200.00", commission: "450.00", total: "₱1,650.00", edit: true },
  saved: { saved: true }
};

function errorSummary(items) {
  if (!items) return "";
  const targetFor = (item) => {
    if (item.includes("commission")) return "commission";
    if (item.includes("Salary") || item.includes("salary")) return "salary";
    if (item.includes("Work date")) return "record-date";
    return "record-staff";
  };
  return `<div class="staff-account-error-list" role="alert" aria-labelledby="record-error-title"><strong id="record-error-title">Fix the following</strong><ul>${items.map((item) => `<li><a href="#${targetFor(item)}">${esc(item)}</a></li>`).join("")}</ul></div>`;
}

function field({ id, label, type = "text", value, help, error }) {
  const describedBy = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const inputMode = id === "salary" || id === "commission" ? 'inputmode="decimal"' : "";
  return `<div class="catalog-field"><label class="catalog-field-label" for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${inputMode} ${error ? 'aria-invalid="true"' : ""} ${describedBy ? `aria-describedby="${describedBy}"` : ""}>${help ? `<p class="catalog-field-help" id="${id}-help">${help}</p>` : ""}${error ? `<p class="catalog-field-error" id="${id}-error">${error}</p>` : ""}</div>`;
}

function renderRecord(state) {
  const data = recordStates[state];
  if (data.saved) {
    document.querySelector("#record-preview").innerHTML = `<div class="catalog-page"><div class="catalog-notice success" role="status"><strong>Daily record updated</strong><br>Mara Santos, Aug 14, 2026 now totals <span class="money">₱1,700.00</span>. The list updated without a page refresh.</div><div class="catalog-panel" style="margin-top:16px"><div class="catalog-table-wrap" tabindex="0" role="region" aria-label="Updated daily compensation record"><table class="catalog-table"><caption class="sr-only">Updated daily compensation record</caption><thead><tr><th scope="col">Staff member</th><th scope="col">Work date</th><th scope="col" class="money">Salary</th><th scope="col" class="money">Commission</th><th scope="col" class="money">Daily total</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${tableRows([["Mara Santos", "Aug 14, 2026", "₱1,250.00", "₱450.00", "₱1,700.00"]])}</tbody></table></div></div></div>`;
    return;
  }
  const staff = data.edit ? `<dl class="fixed-context"><div><dt>Staff member</dt><dd>${data.staff}</dd></div><div><dt>Work date</dt><dd>${data.dateLabel}</dd></div></dl>` : `<div class="modal-grid"><div class="catalog-field"><label class="catalog-field-label" for="record-staff">Staff member</label><select id="record-staff" ${data.staffError ? 'aria-invalid="true" aria-describedby="record-staff-error"' : ""}><option>${data.staff}</option><option>Ines Reyes</option><option>Jon Bell</option><option>Mara Santos</option></select>${data.staffError ? `<p class="catalog-field-error" id="record-staff-error">${data.staffError}</p>` : `<p class="catalog-field-help">Only active staff members can be selected.</p>`}</div>${field({ id: "record-date", label: "Work date", type: "date", value: data.date, help: "Today or earlier.", error: data.dateError })}</div>`;
  const conflict = data.conflict ? `<div class="catalog-notice danger" role="alert" aria-live="assertive"><strong>A record already exists</strong><br>Nothing was changed. Mara Santos already has a record for Aug 14, 2026.<br><a class="conflict-link" href="#records">Open the existing record</a></div>` : "";
  document.querySelector("#record-preview").innerHTML = `<div class="inventory-modal-backdrop"><section class="inventory-modal staff-modal" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
    <header class="inventory-modal-head"><h2 id="record-dialog-title">${data.title}</h2><button class="catalog-button small" type="button" aria-label="Close dialog" data-dialog-close>Close</button></header>
    <form><div class="modal-body">${errorSummary(data.summary)}${conflict}${staff}<div class="modal-grid">${field({ id: "salary", label: "Salary amount", value: data.salary, help: "PHP, up to 2 decimal places. Zero is allowed.", error: data.salaryError })}${field({ id: "commission", label: "Commission amount", value: data.commission, help: "PHP, up to 2 decimal places. Zero is allowed.", error: data.commissionError })}</div><div class="derived-total" aria-live="polite"><div><span>Daily total</span><p>Computed from salary + commission. Not editable.</p></div><strong>${data.total}</strong></div></div>
    <div class="catalog-form-actions staff-modal-actions"><button class="catalog-button" type="button" data-dialog-close>Cancel</button><button class="catalog-button primary" type="submit" ${data.submitting ? "disabled" : ""}>${data.submitting ? "Saving..." : data.edit ? "Save changes" : "Add record"}</button></div></form>
  </section></div>`;
  setupLiveTotal();
}

function renderDelete(state) {
  const target = document.querySelector("#delete-preview");
  if (state === "confirm") {
    target.innerHTML = `<div class="inventory-modal-backdrop"><section class="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><header class="inventory-modal-head"><h2 id="delete-title">Delete daily record?</h2></header><div class="modal-body"><p>This permanently deletes Mara Santos's record for Aug 14, 2026 with a daily total of <strong class="money">₱1,650.00</strong>.</p><div class="catalog-notice danger"><strong>This cannot be undone.</strong></div></div><div class="staff-modal-actions"><button class="catalog-button" type="button" data-dialog-close data-close-result="cancelled">Cancel</button><button class="catalog-button danger" type="button" data-dialog-close data-close-result="deleted">Delete record</button></div></section></div>`;
  } else if (state === "cancelled") {
    target.innerHTML = `<div class="catalog-page"><div class="catalog-notice success" role="status"><strong>Deletion cancelled</strong><br>Mara Santos's Aug 14, 2026 record is unchanged.</div></div>`;
  } else {
    target.innerHTML = `<div class="catalog-page"><div class="catalog-notice success" role="status"><strong>Daily record deleted</strong><br>Mara Santos's Aug 14, 2026 record was removed from the list without a page refresh.</div></div>`;
  }
}

function reportForm(state) {
  const error = state === "range-error";
  const inactive = state === "inactive";
  return `<form class="report-filter" aria-label="Generate payslip">
    <p class="report-filter-copy"><strong>Gross amounts only.</strong> This summary does not include taxes, deductions, or net pay.</p>
    <div class="catalog-field"><label class="catalog-field-label" for="payslip-staff">Staff member</label><select id="payslip-staff"><option>${inactive ? "Omar Diaz (inactive)" : "Mara Santos"}</option><option>Ines Reyes</option><option>Jon Bell</option><option>Omar Diaz (inactive)</option></select><p class="catalog-field-help">Includes active and deactivated staff with records.</p></div>
    <div class="catalog-field"><label class="catalog-field-label" for="payslip-start">Start date</label><input id="payslip-start" type="date" value="${error ? "2026-08-14" : "2026-08-12"}"></div>
    <div class="catalog-field"><label class="catalog-field-label" for="payslip-end">End date</label><input id="payslip-end" type="date" value="${error ? "2026-08-12" : "2026-08-14"}" ${error ? 'aria-invalid="true" aria-describedby="payslip-end-error"' : ""}>${error ? `<p class="report-range-error" id="payslip-end-error">End date must be on or after the start date. Dates were not changed.</p>` : ""}</div>
    <button class="report-button report-button-primary" type="submit">Generate payslip</button>
  </form>`;
}

function payslipResult(state) {
  if (state === "range-error") return "";
  if (state === "loading") return `<section class="report-panel" aria-busy="true" aria-label="Generating payslip"><div class="loading-result"><strong>Generating payslip...</strong><div class="loading-line"></div><div class="loading-line" style="width:82%"></div><div class="loading-line" style="width:64%"></div></div></section>`;
  if (state === "empty") return `<section class="report-panel"><div class="empty-critical" role="status"><h3>No records in this range</h3><p>Mara Santos has no entered compensation records from Aug 1 through Aug 5, 2026. No payslip or totals were generated.</p></div></section>`;
  const inactive = state === "inactive";
  const name = inactive ? "Omar Diaz" : "Mara Santos";
  const lines = inactive ? [[name, "Aug 14, 2026", "₱950.00", "₱620.00", "₱1,570.00"]] : records.filter((row) => row[0] === name);
  const totals = inactive ? ["₱950.00", "₱620.00", "₱1,570.00"] : ["₱2,400.00", "₱960.00", "₱3,360.00"];
  return `<section class="report-panel"><header class="report-panel-head"><div><h3>${name} ${inactive ? '<span class="inactive-badge">Inactive staff member</span>' : ""}</h3><p>Inclusive range: Aug 12-14, 2026</p></div><p><strong>Gross compensation summary</strong><br>No taxes, deductions, or net pay included.</p></header><div class="catalog-table-wrap" tabindex="0" role="region" aria-label="Payslip daily entries, scroll horizontally to view all columns"><table class="catalog-table"><caption class="sr-only">Daily compensation entries included in this payslip</caption><thead><tr><th scope="col">Work date</th><th scope="col" class="money">Salary</th><th scope="col" class="money">Commission</th><th scope="col" class="money">Daily total</th></tr></thead><tbody>${lines.map((row) => `<tr><th scope="row">${row[1]}</th><td class="money">${row[2]}</td><td class="money">${row[3]}</td><td class="money"><strong>${row[4]}</strong></td></tr>`).join("")}</tbody></table></div><div class="report-totals"><div class="report-metric"><span>Salary total</span><strong>${totals[0]}</strong></div><div class="report-metric"><span>Commission total</span><strong>${totals[1]}</strong></div><div class="report-metric"><span>Overall gross total</span><strong>${totals[2]}</strong></div></div></section>`;
}

function renderPayslip(state) {
  document.querySelector("#payslip-preview").innerHTML = `<div class="reporting-page"><header class="reporting-page-head"><div><h2>Compensation</h2><p>Generate a gross summary from entered daily records</p></div></header><div class="reporting-context" aria-label="Compensation sections"><button type="button">Daily records</button><button type="button" aria-current="page">Payslips</button></div><div class="report-panel">${reportForm(state)}</div>${payslipResult(state)}</div>`;
}

function renderNavigation() {
  document.querySelector("#navigation-preview").innerHTML = `<div class="admin-shell catalog-admin-shell"><aside class="admin-sidebar" aria-label="Admin sidebar excerpt"><h2>Coffee POS</h2><nav>
    <div class="admin-nav-group"><p class="admin-nav-label">Workspace</p><div class="admin-nav-group-links"><a href="#navigation">Dashboard</a></div></div>
    <div class="admin-nav-group"><p class="admin-nav-label">Catalog</p><div class="admin-nav-group-links"><a href="#navigation">Categories</a><a href="#navigation">Products</a></div></div>
    <div class="admin-nav-group"><p class="admin-nav-label">Operations</p><div class="admin-nav-group-links"><a href="#navigation">Inventory</a><a href="#navigation">Staff</a><a href="#navigation">Reports</a><a href="#navigation" aria-current="page">Compensation</a><a href="#navigation">Order History</a></div></div>
  </nav></aside><main class="admin-main"><h2>Compensation</h2><p>One admin-only destination keeps daily records and payslip generation together. The local switch appears immediately below the page heading.</p><div class="reporting-context" aria-label="Compensation sections"><button type="button" aria-current="page">Daily records</button><button type="button">Payslips</button></div></main></div>`;
}

const renderers = { records: renderRecords, record: renderRecord, delete: renderDelete, payslip: renderPayslip };

function setupLiveTotal() {
  const salary = document.querySelector("#record-preview #salary");
  const commission = document.querySelector("#record-preview #commission");
  const output = document.querySelector("#record-preview .derived-total strong");
  if (!salary || !commission || !output) return;
  const update = () => {
    const validAmount = (value) => /^\d+(\.\d{0,2})?$/.test(value.trim());
    if (!validAmount(salary.value) || !validAmount(commission.value)) {
      output.textContent = "Not available";
      return;
    }
    const total = Number(salary.value) + Number(commission.value);
    output.textContent = `₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  salary.addEventListener("input", update);
  commission.addEventListener("input", update);
}

function setupMockDialog(target, invoker) {
  const preview = document.querySelector(`#${target}-preview`);
  const dialog = preview && preview.querySelector('[role="dialog"]');
  if (!dialog || !invoker) return;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
  if (!focusable.length) return;
  focusable[0].focus();
  const close = (result) => {
    if (target === "delete" && result) {
      renderDelete(result);
    } else {
      preview.innerHTML = `<div class="catalog-empty" role="status"><h3>Dialog closed</h3><p>Choose a state above to inspect the dialog again.</p></div>`;
    }
    invoker.focus();
  };
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.querySelectorAll("[data-dialog-close]").forEach((control) => {
    control.addEventListener("click", () => close(control.dataset.closeResult));
  });
}

document.querySelectorAll(".state-switcher button").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest(".state-switcher");
    group.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    renderers[button.dataset.target](button.dataset.state);
    if (button.dataset.target === "record" || (button.dataset.target === "delete" && button.dataset.state === "confirm")) {
      setupMockDialog(button.dataset.target, button);
    }
  });
});

document.addEventListener("click", (event) => {
  const recordControl = event.target.closest("[data-open-record], [data-row-action]");
  if (!recordControl) return;
  const state = recordControl.dataset.openRecord || recordControl.dataset.rowAction;
  if (state === "delete") {
    renderDelete("confirm");
    setupMockDialog("delete", recordControl);
  } else {
    renderRecord(state === "edit" ? "edit" : "add");
    setupMockDialog("record", recordControl);
  }
});

document.addEventListener("submit", (event) => event.preventDefault());

renderRecords("default");
renderRecord("add");
renderDelete("confirm");
renderPayslip("result");
renderNavigation();
