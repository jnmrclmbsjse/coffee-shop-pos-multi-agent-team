const dailyData = [
  { date: "2026-07-13", label: "Jul 13", status: "Closed", cash: 12450, online: 6830, tips: 780, expected: 12780, actual: 12780, expenses: 450 },
  { date: "2026-07-14", label: "Jul 14", status: "Closed", cash: 13820, online: 7120, tips: 860, expected: 14360, actual: 14310, expenses: 320 },
  { date: "2026-07-15", label: "Jul 15", omitted: true },
  { date: "2026-07-16", label: "Jul 16", status: "Closed", cash: 15900, online: 8450, tips: 920, expected: 16140, actual: 16165, expenses: 680 },
  { date: "2026-07-17", label: "Jul 17", status: "Closed", cash: 17120, online: 9100, tips: 1040, expected: 17620, actual: 17620, expenses: 540 },
  { date: "2026-07-18", label: "Jul 18", status: "Closed", cash: 20400, online: 11780, tips: 1260, expected: 20760, actual: 20810, expenses: 900 },
  { date: "2026-07-19", label: "Jul 19", status: "Closed", cash: 16950, online: 10200, tips: 970, expected: 17540, actual: 17520, expenses: 380 },
  { date: "2026-07-20", label: "Jul 20", omitted: true },
  { date: "2026-07-21", label: "Jul 21", status: "Closed", cash: 0, online: 0, tips: 0, expected: 0, actual: 0, expenses: 0 },
  { date: "2026-07-22", label: "Jul 22", status: "Closed", cash: 14200, online: 8990, tips: 850, expected: 14640, actual: 14640, expenses: 410 },
  { date: "2026-07-23", label: "Jul 23", status: "Closed", cash: 18600, online: 12480, tips: 1180, expected: 19020, actual: 19000, expenses: 760 },
  { date: "2026-07-24", label: "Jul 24", status: "Closed", cash: 19750, online: 13420, tips: 1340, expected: 20270, actual: 20300, expenses: 820 },
  { date: "2026-07-25", label: "Jul 25", status: "Open", cash: 18560, online: 11680, tips: 1420, expected: 19380, actual: null, expenses: 600 },
  { date: "2026-07-26", label: "Jul 26", omitted: true }
];

const productData = [
  { name: "Latte", quantity: 143, revenue: 59820 },
  { name: "Cold Brew", quantity: 121, revenue: 44100 },
  { name: "Spanish Latte", quantity: 98, revenue: 38250 },
  { name: "Americano", quantity: 132, revenue: 31800 },
  { name: "Matcha Latte", quantity: 74, revenue: 28150 },
  { name: "Espresso", quantity: 86, revenue: 23140 },
  { name: "Mocha", quantity: 52, revenue: 20490 },
  { name: "Retail Beans 250g", quantity: -1, revenue: -650 }
];

const getQualifyingProducts = (products = productData) => products
  .filter((product) => product.quantity !== 0 || product.revenue !== 0)
  .sort((a, b) => (b.revenue - a.revenue) || a.name.localeCompare(b.name));

const defaultRange = { from: "2026-07-13", to: "2026-07-26" };
const emptyRange = { from: "2026-06-01", to: "2026-06-02" };
let activeScreen = "dashboard";
let dashboardState = "current";
let reportState = "populated";
let lastValidReportState = "populated";
let toastTimer;

const money = (value) => {
  const sign = value < 0 ? "-" : "";
  return `₱${sign}${Math.abs(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

const shortMoney = (value) => {
  if (value === 0) return "₱0";
  if (value >= 1000) return `₱${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `₱${value}`;
};

const formatDate = (iso, style = "long") => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: style === "long" ? "numeric" : undefined,
    timeZone: "Asia/Manila"
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const metric = (label, value, note = "") => `
  <div class="metric">
    <span class="metric-label">${label}</span>
    <strong class="metric-value">${value}</strong>
    ${note ? `<span class="metric-note">${note}</span>` : ""}
  </div>
`;

function setPressedState(selector, attribute, value) {
  document.querySelectorAll(selector).forEach((button) => {
    const isActive = button.dataset[attribute] === value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderDashboard() {
  const target = document.querySelector("#dashboard-content");

  if (dashboardState === "empty") {
    target.innerHTML = `
      <section class="panel" data-od-id="dashboard-no-data">
        <div class="empty-state">
          <div>
            <strong>No trading day data yet.</strong>
            <p>The dashboard will show a summary after the first trading day is opened.</p>
          </div>
        </div>
      </section>
    `;
    return;
  }

  const isCurrent = dashboardState === "current";
  const day = isCurrent
    ? { date: "2026-07-25", status: "Open", orders: 39, gross: 30240, cash: 18560, online: 11680, aov: 775.38, tips: 1420 }
    : { date: "2026-07-24", status: "Closed", orders: 42, gross: 33170, cash: 19750, online: 13420, aov: 789.76, tips: 1340 };

  target.innerHTML = `
    <section class="day-summary" aria-labelledby="day-summary-title" data-od-id="trading-day-summary">
      <div class="day-summary-head">
        <div>
          <div class="business-date">
            <h2 id="day-summary-title">${isCurrent ? "Current trading day" : "Latest closed trading day"}</h2>
            <span class="badge badge-${day.status.toLowerCase()}">${day.status}</span>
          </div>
          <p class="day-context">Business date ${formatDate(day.date)}. Shop date is July 26, 2026.</p>
        </div>
      </div>
      <div class="metrics-grid">
        ${metric("Completed orders", day.orders.toLocaleString("en-PH"), "Paid orders")}
        ${metric("Gross sales", money(day.gross), "Cash and online")}
        ${metric("Cash sales", money(day.cash))}
        ${metric("Online sales", money(day.online))}
        ${metric("Average order value", money(day.aov))}
        ${metric("Cash tips", money(day.tips))}
      </div>
    </section>

    <div class="two-column">
      ${renderSalesTrend()}
      ${renderProductBars()}
    </div>
  `;
}

function renderSalesTrend() {
  const maxGross = Math.max(...dailyData.filter((day) => !day.omitted).map((day) => day.cash + day.online));
  const bars = dailyData.map((day) => {
    if (day.omitted) {
      return `
        <div class="chart-day is-omitted" title="${day.label}: no trading day">
          <div class="chart-column" aria-hidden="true"></div>
          <span class="chart-label">${day.label.replace("Jul ", "")}</span>
        </div>
      `;
    }

    const gross = day.cash + day.online;
    const cashHeight = (day.cash / maxGross) * 100;
    const onlineHeight = (day.online / maxGross) * 100;
    const zeroClass = gross === 0 ? " is-zero" : "";
    return `
      <div class="chart-day${zeroClass}" title="${day.label}: cash ${money(day.cash)}, online ${money(day.online)}">
        <div class="chart-column" aria-hidden="true">
          <div class="bar-online" style="height:${onlineHeight}%"></div>
          <div class="bar-cash" style="height:${cashHeight}%"></div>
        </div>
        <span class="chart-label">${day.label.replace("Jul ", "")}</span>
      </div>
    `;
  }).join("");

  const rows = dailyData.map((day) => {
    if (day.omitted) {
      return `
        <tr>
          <td class="num">${day.label}</td>
          <td>No trading day</td>
          <td class="num">Not applicable</td>
          <td class="num">Not applicable</td>
          <td class="num">Not applicable</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td class="num">${day.label}</td>
        <td>${day.status}</td>
        <td class="num">${money(day.cash)}</td>
        <td class="num">${money(day.online)}</td>
        <td class="num">${money(day.cash + day.online)}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="panel" aria-labelledby="trend-title" data-od-id="sales-trend-panel">
      <div class="panel-header">
        <div class="section-heading">
          <h2 id="trend-title">Sales trend</h2>
          <p>Jul 13 to Jul 26, 2026. Trading days only.</p>
        </div>
        <div class="legend" aria-label="Sales chart legend">
          <span class="legend-item"><span class="legend-swatch"></span>Cash</span>
          <span class="legend-item"><span class="legend-swatch online"></span>Online</span>
          <span class="legend-item"><span class="legend-swatch omitted"></span>No trading day</span>
        </div>
      </div>
      <div class="sales-chart-wrap">
        <div class="sales-chart" role="img" aria-label="Stacked sales bars from July 13 to July 26. July 21 is a zero-sales trading day. July 15, 20, and 26 have no trading day.">
          ${bars}
        </div>
        <p class="chart-scale-note">Daily gross scale up to ${shortMoney(maxGross)}. Zero-sales days keep a baseline. Omitted dates use an outlined slot.</p>
      </div>
      <details class="data-details">
        <summary>Read sales values</summary>
        <div class="table-region" tabindex="0" aria-label="Sales trend values">
          <table>
            <thead>
              <tr><th>Date</th><th>Trading day</th><th class="num">Cash</th><th class="num">Online</th><th class="num">Gross</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>
    </section>
  `;
}

function renderProductBars() {
  const topProducts = getQualifyingProducts().slice(0, 5);
  const maxRevenue = Math.max(...topProducts.map((product) => Math.max(product.revenue, 0)), 1);
  const rows = topProducts.map((product, index) => `
    <div class="product-bar-row" role="listitem" data-od-id="product-bar-${index + 1}">
      <span class="product-name">${index + 1}. ${product.name}</span>
      <span class="product-value">${money(product.revenue)}</span>
      <span class="product-bar-track" aria-hidden="true">
        <span class="product-bar-fill" style="width:${(Math.max(product.revenue, 0) / maxRevenue) * 100}%"></span>
      </span>
    </div>
  `).join("");

  return `
    <section class="panel" aria-labelledby="products-title" data-od-id="top-products-panel">
      <div class="panel-header">
        <div class="section-heading">
          <h2 id="products-title">Top base products</h2>
          <p>Revenue, variants combined, for the same date range.</p>
        </div>
      </div>
      <div class="product-bars" role="list" aria-label="Top five products ranked by revenue">
        ${rows}
      </div>
    </section>
  `;
}

function getReportTotals() {
  return dailyData.reduce((totals, day) => {
    if (day.omitted) return totals;
    totals.cash += day.cash;
    totals.online += day.online;
    totals.gross += day.cash + day.online;
    totals.tips += day.tips;
    return totals;
  }, { cash: 0, online: 0, gross: 0, tips: 0 });
}

function renderReportsContent(state = lastValidReportState) {
  const target = document.querySelector("#reports-content");
  const isEmpty = state === "empty";
  const totals = isEmpty ? { cash: 0, online: 0, gross: 0, tips: 0 } : getReportTotals();

  target.innerHTML = `
    <section class="report-summary" aria-label="Report totals" data-od-id="report-summary">
      ${metric("Gross sales", money(totals.gross))}
      ${metric("Cash sales", money(totals.cash))}
      ${metric("Online sales", money(totals.online))}
      ${metric("Cash tips", money(totals.tips))}
    </section>

    ${isEmpty ? renderEmptyReportTables() : `${renderDailyTable()}${renderProductTable()}`}
  `;
}

function renderDailyTable() {
  const rows = dailyData.filter((day) => !day.omitted).map((day) => {
    const variance = day.actual === null ? null : day.actual - day.expected;
    return `
      <tr>
        <td class="num">${day.date}</td>
        <td><span class="badge badge-${day.status.toLowerCase()}">${day.status}</span></td>
        <td class="num">${money(day.cash)}</td>
        <td class="num">${money(day.online)}</td>
        <td class="num">${money(day.cash + day.online)}</td>
        <td class="num">${money(day.tips)}</td>
        <td class="num">${money(day.expected)}</td>
        <td class="num">${day.actual === null ? `<span aria-label="Actual cash not recorded">—</span>` : money(day.actual)}</td>
        <td class="num">${varianceMarkup(variance)}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="panel" aria-labelledby="daily-table-title" data-od-id="daily-reconciliation-panel">
      <div class="panel-header">
        <div class="section-heading">
          <h2 id="daily-table-title">Daily reconciliation</h2>
          <p>Oldest to newest. Expected cash is cash sales plus tips less cash expenses.</p>
        </div>
      </div>
      <p class="table-scroll-note">Swipe horizontally to inspect all reconciliation columns.</p>
      <div class="table-region" tabindex="0" aria-label="Daily reconciliation table, horizontally scrollable on small screens">
        <table class="daily-table">
          <thead>
            <tr>
              <th>Date</th><th>Status</th><th class="num">Cash sales</th><th class="num">Online sales</th>
              <th class="num">Gross</th><th class="num">Tips</th><th class="num">Expected cash</th>
              <th class="num">Actual cash</th><th class="num">Variance</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function varianceMarkup(variance) {
  if (variance === null) return `<span aria-label="Variance not available">—</span>`;
  if (variance < 0) {
    return `<span class="variance-cell variance-short"><span class="variance-label">Short</span><span class="variance-amount">${money(variance)}</span></span>`;
  }
  if (variance > 0) {
    return `<span class="variance-cell variance-over"><span class="variance-label">Over</span><span class="variance-amount">${money(variance)}</span></span>`;
  }
  return `<span class="variance-cell"><span class="variance-label">Even</span><span class="variance-amount">${money(0)}</span></span>`;
}

function renderProductTable() {
  const rows = getQualifyingProducts().map((product) => `
    <tr>
      <td>${product.name}</td>
      <td class="num">${product.quantity > 0 ? "+" : ""}${product.quantity}</td>
      <td class="num">${money(product.revenue)}</td>
    </tr>
  `).join("");

  return `
    <section class="panel" aria-labelledby="product-table-title" data-od-id="product-sales-panel">
      <div class="panel-header">
        <div class="section-heading">
          <h2 id="product-table-title">Product sales</h2>
          <p>Every qualifying base product, variants combined. Revenue order, then alphabetical ties.</p>
        </div>
      </div>
      <p class="table-scroll-note">Swipe horizontally to inspect product values.</p>
      <div class="table-region" tabindex="0" aria-label="Product sales table, horizontally scrollable on small screens">
        <table class="product-table">
          <thead><tr><th>Base product</th><th class="num">Quantity sold</th><th class="num">Revenue</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEmptyReportTables() {
  return `
    <section class="panel" aria-labelledby="daily-empty-title" data-od-id="daily-reconciliation-empty">
      <div class="panel-header"><h2 id="daily-empty-title">Daily reconciliation</h2></div>
      <div class="empty-state"><div><strong>No days in this range.</strong><p>Choose another valid range or export the header-only CSV.</p></div></div>
    </section>
    <section class="panel" aria-labelledby="product-empty-title" data-od-id="product-sales-empty">
      <div class="panel-header"><h2 id="product-empty-title">Product sales</h2></div>
      <div class="empty-state"><div><strong>No sales in this range.</strong><p>No qualifying base products were recorded for these dates.</p></div></div>
    </section>
  `;
}

function switchScreen(screen) {
  activeScreen = screen;
  document.querySelectorAll("[data-screen]").forEach((section) => {
    const isActive = section.dataset.screen === screen;
    section.hidden = !isActive;
    section.classList.toggle("is-active", isActive);
  });

  document.querySelectorAll("[data-screen-target]").forEach((button) => {
    const isActive = button.dataset.screenTarget === screen;
    button.classList.toggle("is-selected", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  document.title = `${screen === "dashboard" ? "Dashboard" : "Reports"} | UCM Coffee Studio Admin`;
  document.querySelector(`[data-screen="${screen}"] h1`).focus({ preventScroll: true });
}

function setDashboardState(state) {
  dashboardState = state;
  setPressedState("[data-dashboard-state]", "dashboardState", state);
  renderDashboard();
}

function setReportState(state) {
  reportState = state;
  setPressedState("[data-report-state]", "reportState", state);

  const from = document.querySelector("#from-date");
  const to = document.querySelector("#to-date");

  if (state === "invalid") {
    from.value = "2026-07-26";
    to.value = "2026-07-13";
    setRangeValidity(false);
    return;
  }

  const range = state === "empty" ? emptyRange : defaultRange;
  from.value = range.from;
  to.value = range.to;
  lastValidReportState = state;
  setRangeValidity(true);
  updateRangePresentation(range.from, range.to, state);
  renderReportsContent(state);
}

function isRangeValid() {
  const from = document.querySelector("#from-date").value;
  const to = document.querySelector("#to-date").value;
  return Boolean(from && to && from <= to);
}

function setRangeValidity(valid) {
  const from = document.querySelector("#from-date");
  const to = document.querySelector("#to-date");
  const error = document.querySelector("#range-error");
  const apply = document.querySelector("#apply-range");
  const exportButton = document.querySelector("#export-csv");

  from.setAttribute("aria-invalid", String(!valid));
  to.setAttribute("aria-invalid", String(!valid));
  error.hidden = valid;
  apply.disabled = !valid;
  exportButton.disabled = !valid;

  if (!valid) {
    document.querySelector("#range-status").textContent = "Invalid range. Showing last valid results.";
  }
}

function updateRangePresentation(from, to, state) {
  document.querySelector("#range-status").textContent = `Showing ${formatDate(from, "short")} to ${formatDate(to, "short")}, ${to.slice(0, 4)}`;
  document.querySelector("#export-filename").textContent = `ucm-report-${from}_to_${to}.csv`;
  document.querySelector("#export-contract").textContent = state === "empty"
    ? "CSV includes daily reconciliation and cash expenses only. This valid empty range exports the header only."
    : "CSV includes daily reconciliation and cash expenses only. A valid empty range exports the header only.";
}

function applyRange(event) {
  event.preventDefault();
  if (!isRangeValid()) {
    setRangeValidity(false);
    return;
  }

  const from = document.querySelector("#from-date").value;
  const to = document.querySelector("#to-date").value;
  const isDefault = from === defaultRange.from && to === defaultRange.to;
  reportState = isDefault ? "populated" : "empty";
  lastValidReportState = reportState;
  setPressedState("[data-report-state]", "reportState", reportState);
  setRangeValidity(true);
  updateRangePresentation(from, to, reportState);
  renderReportsContent(reportState);
  showToast(`Applied ${formatDate(from, "short")} to ${formatDate(to, "short")}.`);
}

function buildCsv() {
  const header = "Date,Status,Cash sales,Online sales,Gross,Tips,Cash expenses,Expected cash,Actual cash,Variance";

  if (lastValidReportState === "empty") return header;

  const dailyRows = dailyData.filter((day) => !day.omitted).map((day) => {
    const variance = day.actual === null ? "" : day.actual - day.expected;
    return [
      day.date, day.status.toLowerCase(), day.cash.toFixed(2), day.online.toFixed(2),
      (day.cash + day.online).toFixed(2), day.tips.toFixed(2), day.expenses.toFixed(2),
      day.expected.toFixed(2), day.actual === null ? "" : day.actual.toFixed(2),
      variance === "" ? "" : variance.toFixed(2)
    ].join(",");
  });

  return [header, ...dailyRows].join("\n");
}

function exportCsv() {
  if (!isRangeValid()) return;
  const filename = document.querySelector("#export-filename").textContent;
  const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(lastValidReportState === "empty" ? `Exported header-only ${filename}` : `Exported ${filename}`);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

document.querySelectorAll("[data-screen-target]").forEach((button) => {
  button.addEventListener("click", () => switchScreen(button.dataset.screenTarget));
});

document.querySelectorAll("[data-dashboard-state]").forEach((button) => {
  button.addEventListener("click", () => setDashboardState(button.dataset.dashboardState));
});

document.querySelectorAll("[data-report-state]").forEach((button) => {
  button.addEventListener("click", () => setReportState(button.dataset.reportState));
});

document.querySelector("#report-form").addEventListener("submit", applyRange);
document.querySelector("#export-csv").addEventListener("click", exportCsv);

["#from-date", "#to-date"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", () => {
    const valid = isRangeValid();
    setRangeValidity(valid);
    if (valid) {
      const from = document.querySelector("#from-date").value;
      const to = document.querySelector("#to-date").value;
      document.querySelector("#export-csv").disabled = true;
      document.querySelector("#range-status").textContent = `Ready to apply ${formatDate(from, "short")} to ${formatDate(to, "short")}.`;
    }
  });
});

renderDashboard();
renderReportsContent();
