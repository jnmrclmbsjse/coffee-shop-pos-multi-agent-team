"use strict";

const businessDays = [
  {
    id: "day-2026-07-31",
    businessDate: "2026-07-31",
    label: "Friday, 31 July 2026",
    status: "open",
    openedAt: "2026-07-31T07:03:00+08:00"
  },
  {
    id: "day-2026-07-30",
    businessDate: "2026-07-30",
    label: "Thursday, 30 July 2026",
    status: "closed",
    openedAt: "2026-07-30T06:58:00+08:00"
  },
  {
    id: "day-2026-07-25",
    businessDate: "2026-07-25",
    label: "Saturday, 25 July 2026",
    status: "closed",
    openedAt: "2026-07-25T07:11:00+08:00"
  }
];

const orders = [
  {
    id: "o-0731-14", dayId: "day-2026-07-31", number: 14, customer: "Bea Manalo",
    status: "completed", cashier: "Mika Reyes", payment: { type: "online", onlineCents: 26500 },
    completedAt: "2026-08-01T00:18:00+08:00", totalCents: 26500,
    lines: [{ quantity: 1, product: "Spanish Latte", size: "Large" }, { quantity: 1, product: "Banana Loaf", size: "Slice" }]
  },
  {
    id: "o-0731-13", dayId: "day-2026-07-31", number: 13, customer: null,
    status: "parked", cashier: "Carlo Dizon", payment: null, completedAt: null, totalCents: 18000,
    lines: [{ quantity: 2, product: "Iced Americano", size: "Regular" }]
  },
  {
    id: "o-0731-12", dayId: "day-2026-07-31", number: 12, customer: "Luis Navarro",
    status: "completed", cashier: "Aira Santos", payment: { type: "split", cashCents: 15000, onlineCents: 12000 },
    completedAt: "2026-07-31T21:42:00+08:00", totalCents: 27000,
    lines: [{ quantity: 1, product: "Cold Brew", size: "Large" }, { quantity: 1, product: "Chocolate Croissant", size: "Piece" }]
  },
  {
    id: "o-0731-11", dayId: "day-2026-07-31", number: 11, customer: "Dani Flores",
    status: "void", cashier: "Mika Reyes", payment: { type: "cash", cashCents: 23500 },
    completedAt: "2026-07-31T20:54:00+08:00", totalCents: 23500, voidReason: "Customer changed the milk option after payment",
    lines: [{ quantity: 1, product: "Café Latte", size: "Large" }, { quantity: 1, product: "Oat milk", size: "Add-on" }]
  },
  {
    id: "o-0731-10", dayId: "day-2026-07-31", number: 10, customer: "Lara Villanueva",
    status: "completed", cashier: "Mika Reyes", payment: { type: "cash", cashCents: 22000 },
    completedAt: "2026-07-31T20:59:00+08:00", totalCents: 22000,
    lines: [{ quantity: 1, product: "Café Latte", size: "Large" }]
  },
  {
    id: "o-0731-9", dayId: "day-2026-07-31", number: 9, customer: "Lara Villanueva",
    status: "void", cashier: "Mika Reyes", payment: { type: "cash", cashCents: 23500 },
    completedAt: "2026-07-31T20:54:00+08:00", totalCents: 23500, voidReason: "Entered with the wrong milk option",
    lines: [{ quantity: 1, product: "Café Latte", size: "Large" }, { quantity: 1, product: "Oat milk", size: "Add-on" }]
  },
  {
    id: "o-0731-8", dayId: "day-2026-07-31", number: 8, customer: "Paolo Evangelista",
    status: "completed", cashier: "Carlo Dizon", payment: { type: "cash", cashCents: 25000 },
    completedAt: "2026-07-31T18:36:00+08:00", totalCents: 20000,
    change: { amountCents: 5000, settled: true },
    lines: [{ quantity: 1, product: "Flat White", size: "Regular" }, { quantity: 1, product: "Ensaymada", size: "Piece", discount: "Senior discount" }]
  },
  {
    id: "o-0731-7", dayId: "day-2026-07-31", number: 7, customer: "Inez Garcia",
    status: "parked", cashier: "Aira Santos", payment: null, completedAt: null, totalCents: 36000,
    lines: [{ quantity: 2, product: "Matcha Latte", size: "Large" }]
  },
  {
    id: "o-0731-6", dayId: "day-2026-07-31", number: 6, customer: "Nico Javier",
    status: "completed", cashier: "Aira Santos", payment: { type: "cash", cashCents: 30000 },
    completedAt: "2026-07-31T15:08:00+08:00", totalCents: 25000,
    change: { amountCents: 5000, settled: false },
    lines: [{ quantity: 1, product: "Mocha", size: "Large" }, { quantity: 1, product: "Extra shot", size: "Add-on" }]
  },
  {
    id: "o-0731-5", dayId: "day-2026-07-31", number: 5, customer: null,
    status: "parked", cashier: "Carlo Dizon", payment: null, completedAt: null, totalCents: 19500,
    lines: [{ quantity: 1, product: "Caramel Latte", size: "Regular" }]
  },
  {
    id: "o-0731-4", dayId: "day-2026-07-31", number: 4, customer: "Mara Ong",
    status: "completed", cashier: null, payment: { type: "online", onlineCents: 17500 },
    completedAt: "2026-07-31T11:27:00+08:00", totalCents: 17500,
    lines: [{ quantity: 1, product: "Cappuccino", size: "Regular" }]
  },
  {
    id: "o-0731-3", dayId: "day-2026-07-31", number: 3, customer: "Enzo Ramos",
    status: "void", cashier: "Mika Reyes", payment: null, completedAt: null, totalCents: 16000, voidReason: "Duplicate parked order",
    lines: [{ quantity: 1, product: "Iced Americano", size: "Large" }]
  },
  {
    id: "o-0731-2", dayId: "day-2026-07-31", number: 2, customer: "Ana Ledesma",
    status: "parked", cashier: null, payment: null, completedAt: null, totalCents: 14500,
    lines: [{ quantity: 1, product: "Espresso Tonic", size: "Regular" }]
  },
  {
    id: "o-0731-1", dayId: "day-2026-07-31", number: 1, customer: null,
    status: "void", cashier: "Mika Reyes", payment: { type: "cash", cashCents: 13500 },
    completedAt: "2026-07-31T07:18:00+08:00", totalCents: 13500,
    voidReason: "Training order recorded before opening",
    lines: [{ quantity: 1, product: "Hot Americano", size: "Regular" }]
  },
  {
    id: "o-0730-6", dayId: "day-2026-07-30", number: 6, customer: "Karla Sison",
    status: "parked", cashier: "Carlo Dizon", payment: null, completedAt: null, totalCents: 22000,
    lines: [{ quantity: 1, product: "Café Latte", size: "Large" }]
  },
  {
    id: "o-0730-5", dayId: "day-2026-07-30", number: 5, customer: "Ramon Lim",
    status: "void", cashier: "Aira Santos", payment: { type: "online", onlineCents: 31000 },
    completedAt: "2026-07-30T19:43:00+08:00", totalCents: 31000, voidReason: "Order entered twice",
    lines: [{ quantity: 2, product: "Spanish Latte", size: "Regular" }]
  },
  {
    id: "o-0730-4", dayId: "day-2026-07-30", number: 4, customer: null,
    status: "completed", cashier: "Mika Reyes", payment: { type: "split", cashCents: 10000, onlineCents: 8500 },
    completedAt: "2026-07-30T15:22:00+08:00", totalCents: 18500,
    lines: [{ quantity: 1, product: "Matcha Latte", size: "Regular" }]
  },
  {
    id: "o-0730-3", dayId: "day-2026-07-30", number: 3, customer: "Joaquin Tan",
    status: "completed", cashier: null, payment: { type: "cash", cashCents: 18000 },
    completedAt: "2026-07-30T10:16:00+08:00", totalCents: 18000,
    lines: [{ quantity: 1, product: "Cold Brew", size: "Large", discount: "PWD discount" }]
  },
  {
    id: "o-0725-3", dayId: "day-2026-07-25", number: 3, customer: "Sofia Alonzo",
    status: "completed", cashier: "Mika Reyes", payment: { type: "online", onlineCents: 24000 },
    completedAt: "2026-07-25T14:31:00+08:00", totalCents: 24000,
    lines: [{ quantity: 1, product: "Mocha", size: "Large" }]
  },
  {
    id: "o-0725-2", dayId: "day-2026-07-25", number: 2, customer: null,
    status: "completed", cashier: "Carlo Dizon", payment: { type: "cash", cashCents: 15000 },
    completedAt: "2026-07-25T09:44:00+08:00", totalCents: 15000,
    lines: [{ quantity: 1, product: "Flat White", size: "Regular" }]
  },
  {
    id: "o-0725-1", dayId: "day-2026-07-25", number: 1, customer: "Miguel Co",
    status: "completed", cashier: "Carlo Dizon", payment: { type: "cash", cashCents: 14000 },
    completedAt: "2026-07-25T07:42:00+08:00", totalCents: 14000,
    lines: [{ quantity: 1, product: "Cappuccino", size: "Regular" }]
  }
];

const els = {
  day: document.querySelector("#business-day"),
  status: document.querySelector("#status-filter"),
  payment: document.querySelector("#payment-filter"),
  search: document.querySelector("#customer-search"),
  clear: document.querySelector("#clear-filters"),
  count: document.querySelector("#result-count"),
  context: document.querySelector("#day-context"),
  ledger: document.querySelector("#order-ledger"),
  empty: document.querySelector("#empty-state"),
  reviewButtons: [...document.querySelectorAll("[data-review]")]
};

const state = {
  selectedDayId: getDefaultDay(businessDays)?.id || "",
  status: "completed",
  payment: "any",
  search: "",
  availableDayMode: "all",
  reviewState: "open"
};

function getDefaultDay(days) {
  return days.find((day) => day.status === "open") ||
    [...days].sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0] ||
    null;
}

function getAvailableDays() {
  if (state.availableDayMode === "none") return [];
  if (state.availableDayMode === "closed-only") {
    return businessDays.filter((day) => day.status === "closed");
  }
  return businessDays;
}

function peso(cents) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100).replace("PHP", "₱").replace(/\s/g, "");
}

function timeLabel(value) {
  if (!value) return "Not completed";
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value));
}

function customerName(order) {
  return order.customer || "Walk-in";
}

function paymentLabel(payment) {
  if (!payment) return "Not paid";
  return payment.type.charAt(0).toUpperCase() + payment.type.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDayOptions() {
  const availableDays = getAvailableDays();
  els.day.innerHTML = "";

  if (!availableDays.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No business days";
    option.selected = true;
    els.day.append(option);
    els.day.disabled = true;
    state.selectedDayId = "";
    return;
  }

  els.day.disabled = false;
  availableDays.forEach((day) => {
    const option = document.createElement("option");
    option.value = day.id;
    option.textContent = `${day.label} (${day.status === "open" ? "Open" : "Closed"})`;
    els.day.append(option);
  });

  if (!availableDays.some((day) => day.id === state.selectedDayId)) {
    state.selectedDayId = getDefaultDay(availableDays)?.id || "";
  }
  els.day.value = state.selectedDayId;
}

function getDayOrders() {
  return orders
    .filter((order) => order.dayId === state.selectedDayId)
    .sort((a, b) => b.number - a.number);
}

function getFilteredOrders(dayOrders) {
  const query = state.search.trim().toLocaleLowerCase("en-PH");
  return dayOrders.filter((order) => {
    const statusMatches = state.status === "all" || order.status === state.status;
    const paymentMatches = state.payment === "any" || order.payment?.type === state.payment;
    const searchMatches = !query || customerName(order).toLocaleLowerCase("en-PH").includes(query);
    return statusMatches && paymentMatches && searchMatches;
  });
}

function renderPayment(order) {
  if (!order.payment) {
    return `<div class="payment-summary"><span class="payment-unpaid">Not paid</span></div>`;
  }
  if (order.payment.type === "split") {
    return `
      <div class="payment-summary" aria-label="Split payment">
        <div class="payment-line"><span>Split: Cash</span><span class="money">${peso(order.payment.cashCents)}</span></div>
        <div class="payment-line"><span>Split: Online</span><span class="money">${peso(order.payment.onlineCents)}</span></div>
      </div>`;
  }
  const cents = order.payment.type === "cash" ? order.payment.cashCents : order.payment.onlineCents;
  return `
    <div class="payment-summary">
      <div class="payment-line"><span>${paymentLabel(order.payment)}</span><span class="money">${peso(cents)}</span></div>
    </div>`;
}

function renderOrderCard(order) {
  const cashier = order.cashier
    ? `<div><dt>Cashier</dt><dd>${escapeHtml(order.cashier)}</dd></div>`
    : "";
  const lines = order.lines.map((line) => `
    <li class="order-line">
      <span class="line-quantity">${line.quantity}×</span>
      <span class="line-product">
        ${escapeHtml(line.product)}
        ${line.discount ? `<span class="discount-label">${escapeHtml(line.discount)}</span>` : ""}
      </span>
      <span class="line-size">${escapeHtml(line.size)}</span>
    </li>`).join("");
  const change = order.change
    ? `<p class="order-note ${order.change.settled ? "change-settled" : "change-owed"}">
        <span>${order.change.settled ? "Change given" : "Change still owed"}</span>
        <span class="money">${peso(order.change.amountCents)}</span>
      </p>`
    : "";
  const voidReason = order.voidReason
    ? `<p class="void-reason"><strong>Void reason:</strong> ${escapeHtml(order.voidReason)}</p>`
    : "";

  return `
    <li class="order-card" data-od-id="order-card-${escapeHtml(order.id)}">
      <article aria-labelledby="order-title-${escapeHtml(order.id)}">
        <header class="order-card-header">
          <div class="order-title-row">
            <h3 id="order-title-${escapeHtml(order.id)}"><span class="order-number">Order ${order.number}</span> · ${escapeHtml(customerName(order))}</h3>
            <span class="status-badge" data-status="${order.status}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span>
          </div>
          <dl class="order-meta">
            <div><dt>Payment</dt><dd>${paymentLabel(order.payment)}</dd></div>
            <div><dt>Completion</dt><dd>${timeLabel(order.completedAt)}</dd></div>
            ${cashier}
            <div><dt>Total</dt><dd class="total-value money">${peso(order.totalCents)}</dd></div>
          </dl>
        </header>
        ${renderPayment(order)}
        <ul class="order-lines" aria-label="Order lines">${lines}</ul>
        ${change}
        ${voidReason}
      </article>
    </li>`;
}

function renderEmpty(dayOrders, filteredOrders) {
  const hasDays = getAvailableDays().length > 0;
  const filtersActive = state.status !== "all" || state.payment !== "any" || state.search.trim() !== "";
  const excluded = hasDays && dayOrders.length > 0 && filteredOrders.length === 0 && filtersActive;

  if (filteredOrders.length) {
    els.empty.hidden = true;
    els.empty.innerHTML = "";
    return;
  }

  let explanation = "There are no recorded orders for this business day.";
  let recovery = "";
  if (!hasDays) {
    explanation = "No business day has been opened yet.";
  } else if (excluded) {
    explanation = "The selected day has orders, but none match all current filters.";
    recovery = `<button type="button" data-empty-clear>Clear filters</button>`;
  }

  els.empty.innerHTML = `
    <h3>No orders to show</h3>
    <p>${explanation}</p>
    ${recovery}`;
  els.empty.hidden = false;

  const button = els.empty.querySelector("[data-empty-clear]");
  if (button) button.addEventListener("click", clearFilters);
}

function updateReviewState() {
  els.reviewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.review === state.reviewState));
  });
}

function render() {
  renderDayOptions();
  els.status.value = state.status;
  els.payment.value = state.payment;
  els.search.value = state.search;

  const dayOrders = getDayOrders();
  const filteredOrders = getFilteredOrders(dayOrders);
  const selectedDay = businessDays.find((day) => day.id === state.selectedDayId);

  els.ledger.innerHTML = filteredOrders.map(renderOrderCard).join("");
  els.count.textContent = `Showing ${filteredOrders.length} of ${dayOrders.length} orders`;
  els.context.textContent = selectedDay
    ? `${selectedDay.label} · ${selectedDay.status === "open" ? "Open business day" : "Closed business day"}`
    : "No business day selected";
  els.clear.disabled = state.status === "all" && state.payment === "any" && state.search.trim() === "";
  renderEmpty(dayOrders, filteredOrders);
  updateReviewState();
}

function clearFilters() {
  state.status = "all";
  state.payment = "any";
  state.search = "";
  render();
}

function setReviewState(name) {
  state.reviewState = name;
  state.availableDayMode = "all";
  state.status = "all";
  state.payment = "any";
  state.search = "";

  const configs = {
    open: { day: "day-2026-07-31", status: "completed" },
    "closed-mixed": { day: "day-2026-07-30", status: "all" },
    past: { day: "day-2026-07-25" },
    "no-open": { mode: "closed-only", day: "day-2026-07-30" },
    "no-days": { mode: "none", day: "" },
    "filters-empty": { day: "day-2026-07-31", status: "parked", payment: "online", search: "Walk-in" },
    retained: { day: "day-2026-07-30", status: "completed", payment: "cash", search: "Joaquin" },
    "void-pair": { day: "day-2026-07-31", search: "Lara Villanueva" },
    split: { day: "day-2026-07-31", payment: "split" },
    change: { day: "day-2026-07-31", payment: "cash", search: "" },
    cashier: { day: "day-2026-07-31", search: "Mara Ong" },
    discount: { day: "day-2026-07-31", search: "Paolo Evangelista" }
  };
  const config = configs[name] || configs.open;

  state.availableDayMode = config.mode || "all";
  state.selectedDayId = config.day;
  state.status = config.status || "all";
  state.payment = config.payment || "any";
  state.search = config.search || "";
  render();
}

els.day.addEventListener("change", (event) => {
  state.selectedDayId = event.target.value;
  render();
});
els.status.addEventListener("change", (event) => {
  state.status = event.target.value;
  render();
});
els.payment.addEventListener("change", (event) => {
  state.payment = event.target.value;
  render();
});
els.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});
els.clear.addEventListener("click", clearFilters);
els.reviewButtons.forEach((button) => {
  button.addEventListener("click", () => setReviewState(button.dataset.review));
});
document.querySelectorAll('.shell-nav a[aria-disabled="true"]').forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

if (!window.location.hash) window.location.hash = "/pos/orders";
render();
