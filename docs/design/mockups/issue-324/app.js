const TODAY = "August 15, 2026";
const PRIOR_DAY = "August 14, 2026";
const LOCATION = "Escolta branch";

const shellStart = (active = "daily") => `
  <div class="app-shell">
    <aside class="admin-sidebar" aria-label="Admin navigation">
      <p class="admin-brand">Coffee POS Admin</p>
      <div class="nav-group">
        <p class="nav-group-label">Workspace</p>
        <a class="sidebar-link" href="#">Dashboard</a>
      </div>
      <div class="nav-group">
        <p class="nav-group-label">Catalog</p>
        <a class="sidebar-link" href="#">Categories</a>
        <a class="sidebar-link" href="#">Products</a>
      </div>
      <div class="nav-group">
        <p class="nav-group-label">Operations</p>
        <div class="sidebar-links">
          <a class="sidebar-link" href="#">Inventory</a>
          <a class="sidebar-link" href="#">Staff</a>
          <a class="sidebar-link active" aria-current="page" href="#">Reports</a>
          <a class="sidebar-link" href="#">Compensation</a>
          <a class="sidebar-link" href="#">Order History</a>
        </div>
      </div>
    </aside>
    <div class="app-content">
      <div class="reporting-page">
        <nav class="page-context-switch" aria-label="Report type">
          <a href="#" ${active === "sales" ? 'aria-current="page"' : ""}>Sales</a>
          <a href="#" ${active === "daily" ? 'aria-current="page"' : ""}>Daily inventory</a>
        </nav>`;

const shellEnd = `</div></div></div>`;

const reportHead = (date = TODAY) => `
  <header class="reporting-page-head">
    <div>
      <h2>Daily inventory report</h2>
      <p class="reporting-context">Business date: ${date}<br>Location: ${LOCATION}</p>
    </div>
    <span class="read-only-label">Read-only</span>
  </header>`;

const filter = (value = "2026-08-15") => `
  <form class="report-filter">
    <div class="field">
      <label for="business-date-${value}">Business date</label>
      <input id="business-date-${value}" type="date" value="${value}">
    </div>
    <button class="primary-control" type="submit">Show report</button>
  </form>`;

const applied = (date = TODAY) => `<p class="applied-range">Showing ${date} · ${LOCATION}</p>`;

function navigationView(state) {
  const active = state === "sales" ? "sales" : "daily";
  const title = active === "sales" ? "Sales report" : "Daily inventory report";
  const context = active === "sales" ? "Review completed sales across a date range." : "Reconcile packaging counts and review restock needs for one business day.";
  return `${shellStart(active)}
    <header class="reporting-page-head">
      <div><h2>${title}</h2><p class="reporting-context">${context}</p></div>
      ${active === "daily" ? '<span class="read-only-label">Read-only</span>' : ""}
    </header>
    <div class="report-panel">
      <div class="report-panel-head"><h3>One reporting destination</h3><p>The sidebar remains stable. Report type changes in local page context, without entering staff closing or restock workflows.</p></div>
      <div class="scope-footer"><p><a class="text-link" href="#">Inventory settings</a> is labelled navigation for configuration. This report does not offer editing actions.</p></div>
    </div>
  ${shellEnd}`;
}

function shellView(state) {
  if (state === "changing") {
    return `${shellStart()}${reportHead(PRIOR_DAY)}${filter("2026-08-15")}${applied(PRIOR_DAY)}
      <div class="loading-status" role="status" aria-live="polite">Loading ${TODAY} for ${LOCATION}…</div>
      <div class="reporting-loading" aria-busy="true" aria-label="Loaded report for ${PRIOR_DAY} is dimmed while the new day loads">
        ${reconciliationPanel("mixed", PRIOR_DAY)}
      </div>${shellEnd}`;
  }
  if (state === "error") {
    return `${shellStart()}${reportHead(TODAY)}${filter()}${applied(TODAY)}
      <div class="reporting-notice" role="alert"><h3>Report could not be loaded</h3><p>Daily inventory data for ${TODAY} at ${LOCATION} is unavailable. Try the request again.</p></div>${shellEnd}`;
  }
  return `${shellStart()}${reportHead()}${filter()}${applied()}${reconciliationPanel("mixed", TODAY)}${shellEnd}`;
}

const baseRows = [
  ["8 oz hot cup", 120, 48, 3, 101, 64, 62],
  ["8 oz hot lid", 118, 50, 2, 101, 65, 67],
  ["16 oz cold cup", 80, 24, 1, 62, 41, 41],
  ["16 oz cold lid", 79, 24, 0, 62, 41, 40]
];

function varianceMarkup(actual, expected) {
  const value = actual - expected;
  if (value > 0) return `<span class="variance surplus"><strong>+${value}</strong> Surplus</span>`;
  if (value < 0) return `<span class="variance short"><strong>${value}</strong> Short</span>`;
  return `<span class="variance even"><strong>0</strong> Even</span>`;
}

function unavailableCell(reason) {
  return `<span class="unavailable" aria-label="Unavailable: ${reason}. No count was taken; this is not a count of zero.">Unavailable</span>`;
}

function reconciliationTable(rows, caption, unavailableMode = "") {
  const tableRows = rows.map((row, index) => {
    const [item, opening, deliveries, wastage, used, expected, actual] = row;
    const missingOpening = unavailableMode === "opening" || unavailableMode === "both";
    const missingClosing = unavailableMode === "closing" || unavailableMode === "both";
    const openingCell = missingOpening && index === 0 ? unavailableCell("opening count not submitted") : `<span class="num">${opening}</span>`;
    const expectedCell = missingOpening && index === 0 ? unavailableCell("expected closing cannot be calculated without an opening count") : `<span class="num">${expected}</span>`;
    const actualCell = missingClosing && index === 0 ? unavailableCell("closing count not submitted") : `<span class="num">${actual}</span>`;
    const varianceCell = (missingOpening || missingClosing) && index === 0
      ? unavailableCell("variance cannot be calculated without both opening and closing counts")
      : varianceMarkup(actual, expected);
    return `<tr>
      <th class="item-cell" scope="row">${item}</th>
      <td>${openingCell}</td><td class="num">${deliveries}</td><td class="num">${wastage}</td><td class="num">${used}</td>
      <td class="outcome-start">${expectedCell}</td><td class="actual-cell">${actualCell}</td><td class="variance-cell">${varianceCell}</td>
    </tr>`;
  }).join("");
  return `<p class="report-scroll-hint">Swipe or scroll horizontally to review all columns.</p>
    <div class="report-table-region" tabindex="0" role="region" aria-label="Cup and lid reconciliation table. Scroll horizontally for more columns.">
      <table class="report-table">
        <caption>${caption}</caption>
        <thead>
          <tr><th rowspan="2" scope="col">Item</th><th colspan="4" scope="colgroup">Derivation: opening <span class="operator">+</span> deliveries <span class="operator">-</span> wastage <span class="operator">-</span> used</th><th class="outcome-start" colspan="3" scope="colgroup">Outcome</th></tr>
          <tr><th scope="col">Opening</th><th scope="col">Deliveries</th><th scope="col">Wastage</th><th scope="col">Used by completed sales</th><th class="outcome-start" scope="col">Expected closing</th><th scope="col">Actual closing</th><th scope="col">Variance</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

function reconciliationPanel(mode = "mixed", date = TODAY) {
  const rows = mode === "even" ? baseRows.map(row => [...row.slice(0, 6), row[5]]) : baseRows;
  return `<section class="report-panel" aria-labelledby="reconciliation-title">
    <div class="report-panel-head"><h3 id="reconciliation-title">Cup and lid reconciliation</h3><p>Physical item counts for the selected business day. Variance equals actual closing minus expected closing.</p></div>
    ${reconciliationTable(rows, `Cup and lid counts for ${date} at ${LOCATION}. All values are physical item counts.`)}
  </section>`;
}

function reconciliationView(state) {
  return `${shellStart()}${reportHead()}${applied()}${reconciliationPanel(state)}${shellEnd}`;
}

function unavailableView(state) {
  const mode = state === "all" ? "" : state;
  const label = state === "all" ? "All opening and closing counts submitted" : {
    opening: "Opening count unavailable for 8 oz hot cup",
    closing: "Closing count unavailable for 8 oz hot cup",
    both: "Opening and closing counts unavailable for 8 oz hot cup"
  }[state];
  return `${shellStart()}${reportHead()}${applied()}
    <section class="report-panel" aria-labelledby="availability-title">
      <div class="report-panel-head"><h3 id="availability-title">Cup and lid reconciliation</h3><p>${label}.</p></div>
      ${reconciliationTable(baseRows.slice(0, 2), `Count availability example for ${TODAY} at ${LOCATION}.`, mode)}
      <p class="report-footnote"><strong>Unavailable</strong> means no count was taken. It is not the same as a count of zero. Expected closing and variance are also Unavailable when a required count is missing.</p>
    </section>${shellEnd}`;
}

function restockTable() {
  const rows = [
    ["Oat milk", true, "2", "12", "urgent", "Urgent"],
    ["8 oz hot cups", false, "18", "80", "urgent", "Urgent"],
    ["Vanilla syrup", true, "Low", "Unavailable", "low", "Low"],
    ["16 oz cold lids", false, "34", "60", "low", "Low"],
    ["Chocolate powder", true, "Half", "Unavailable", "below-par", "Below par"],
    ["Paper bags", false, "42", "55", "below-par", "Below par"]
  ];
  return `<p class="report-scroll-hint">Swipe or scroll horizontally to review all columns.</p>
    <div class="report-table-region" tabindex="0" role="region" aria-label="Restock needs table. Scroll horizontally for more columns.">
      <table class="report-table">
        <caption>Items below their restock threshold, ordered by status, Critical setting, then item name.</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Counted amount</th><th scope="col">Target (par)</th><th scope="col">Status</th></tr></thead>
        <tbody>${rows.map(([item, critical, amount, target, cls, status]) => `<tr>
          <th class="item-cell" scope="row">${item}${critical ? '<span class="critical-marker">Critical</span>' : ""}</th>
          <td class="${/^\d+$/.test(amount) ? "num" : ""}">${amount}</td><td class="${target === "Unavailable" ? "unavailable" : "num"}">${target}</td>
          <td><span class="staff-restock-status ${cls}">${status}</span></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function restockView(state) {
  let content;
  if (state === "nothing") {
    content = `<div class="report-empty positive"><h3>Nothing needs restocking</h3><p>The closing count submitted on ${TODAY} at 9:42 PM for ${LOCATION} has no Urgent, Low, or Below par items.</p></div>`;
  } else if (state === "none") {
    content = `<div class="report-empty"><h3>No count submitted for this day</h3><p>No opening or closing count was submitted for ${TODAY} at ${LOCATION}, so a restock list cannot be prepared.</p></div>`;
  } else {
    content = `<p class="restock-copy">This list uses the closing count submitted on ${TODAY} at 9:42 PM.</p><p class="restock-copy">Only Urgent, Low, and Below par items are shown. Items with Enough stock do not appear.</p>${restockTable()}`;
  }
  return `${shellStart()}${reportHead()}${applied()}<section class="report-panel" aria-labelledby="restock-title"><div class="report-panel-head"><h3 id="restock-title">Restock needs</h3><p>Read-only priorities for the selected business day.</p></div>${content}</section>${shellEnd}`;
}

function emptyView(state) {
  let title;
  let body;
  if (state === "not-opened") {
    title = "Business day not opened";
    body = `No business day was opened for ${TODAY} at ${LOCATION}. There is no daily inventory report for this date.`;
  } else if (state === "no-restock-count") {
    title = "No restock count submitted";
    body = `No opening or closing count was submitted for ${TODAY} at ${LOCATION}, so no restock list is presented.`;
  } else {
    title = "Nothing reportable for this opened day";
    body = `The business day for ${TODAY} at ${LOCATION} was opened, but it has no counts, movements, or completed-sale packaging usage.`;
  }
  return `${shellStart()}${reportHead()}${filter()}${applied()}
    <section class="report-panel" aria-labelledby="empty-title"><div class="report-empty"><h3 id="empty-title">${title}</h3><p>${body}</p></div>
    <div class="scope-footer"><p>This report is read-only. To manage item configuration, use <a class="text-link" href="#">Inventory settings</a>.</p></div></section>${shellEnd}`;
}

const renderers = {
  navigation: navigationView,
  shell: shellView,
  reconciliation: reconciliationView,
  unavailable: unavailableView,
  restock: restockView,
  empty: emptyView
};

function renderPreview(name, state) {
  const target = document.querySelector(`#preview-${name}`);
  if (!target || !renderers[name]) return;
  target.innerHTML = renderers[name](state);
}

document.querySelectorAll(".state-switcher").forEach(group => {
  group.addEventListener("click", event => {
    const button = event.target.closest("button[data-preview]");
    if (!button) return;
    group.querySelectorAll("button").forEach(candidate => candidate.setAttribute("aria-pressed", String(candidate === button)));
    renderPreview(button.dataset.preview, button.dataset.state);
  });
});

document.querySelectorAll('.state-switcher button[aria-pressed="true"]').forEach(button => {
  renderPreview(button.dataset.preview, button.dataset.state);
});

document.addEventListener("submit", event => event.preventDefault());
document.addEventListener("click", event => {
  const link = event.target.closest('.preview-frame a[href="#"]');
  if (link) event.preventDefault();
});
