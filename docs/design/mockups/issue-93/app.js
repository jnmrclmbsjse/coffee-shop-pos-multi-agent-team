"use strict";

const DASH = "—";
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const dateDisplay = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
const timestampDisplay = new Intl.DateTimeFormat("en-PH", {
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
});

const orders = [
  {
    id: "split-senior", businessDay: "2026-07-28", orderNo: 1042, customer: "Ana Reyes", status: "Completed",
    payment: "Split", total: 515, tip: 40, change: 0, changeState: "zero", completedAt: "2026-07-28T15:42:00+08:00",
    service: "Dine-in", subtotal: 550, discount: 35, cashPortion: 300, onlinePortion: 215,
    cashReceived: 340, changeSettled: DASH,
    items: [
      { product: "Spanish Latte", size: "Large", quantity: 2, discount: "Senior", original: 360, lineTotal: 325, note: "₱35.00 Senior discount applied to this line." },
      { product: "Basque Cheesecake", size: "Regular", quantity: 1, discount: "None", lineTotal: 190 }
    ]
  },
  {
    id: "parked", businessDay: "2026-07-28", orderNo: 1041, customer: "Miguel Santos", status: "Parked",
    payment: null, total: 280, tip: null, change: null, changeState: null, completedAt: null,
    service: "Take-out", subtotal: 280, discount: 0, cashPortion: null, onlinePortion: null,
    cashReceived: null, changeSettled: null,
    items: [{ product: "Cold Brew", size: "Large", quantity: 2, discount: "None", lineTotal: 280 }]
  },
  {
    id: "void", businessDay: "2026-07-28", orderNo: 1040, customer: "Lea Mendoza", status: "Void",
    payment: "Cash", total: 425, tip: 25, change: 50, changeState: "settled", completedAt: null,
    service: "Dine-in", subtotal: 425, discount: 0, cashPortion: 425, onlinePortion: 0,
    cashReceived: 500, changeSettled: "2026-07-28T14:18:00+08:00", voidReason: "Duplicate order entered at the counter.",
    items: [
      { product: "Flat White", size: "Regular", quantity: 1, discount: "None", lineTotal: 165 },
      { product: "Truffle Grilled Cheese", size: "Regular", quantity: 1, discount: "None", lineTotal: 260 }
    ]
  },
  {
    id: "outstanding", businessDay: "2026-07-28", orderNo: 1039, customer: "Paolo Dela Cruz", status: "Completed",
    payment: "Cash", total: 190, tip: 0, change: 20, changeState: "outstanding", completedAt: "2026-07-28T13:27:00+08:00",
    service: "Take-out", subtotal: 190, discount: 0, cashPortion: 190, onlinePortion: 0,
    cashReceived: 210, changeSettled: null,
    items: [{ product: "Basque Cheesecake", size: "Regular", quantity: 1, discount: "None", lineTotal: 190 }]
  },
  {
    id: "settled", businessDay: "2026-07-28", orderNo: 1038, customer: "Celine Tomas", status: "Completed",
    payment: "Cash", total: 220, tip: 0, change: 20, changeState: "settled", completedAt: "2026-07-28T12:11:00+08:00",
    service: "Dine-in", subtotal: 220, discount: 0, cashPortion: 220, onlinePortion: 0,
    cashReceived: 240, changeSettled: "2026-07-28T12:13:00+08:00",
    items: [{ product: "Matcha Latte", size: "Large", quantity: 1, discount: "None", lineTotal: 220 }]
  },
  {
    id: "walk-in", businessDay: "2026-07-28", orderNo: 1037, customer: "Walk-in", status: "Completed",
    payment: "Online", total: 165, tip: 0, change: 0, changeState: "zero", completedAt: "2026-07-28T11:48:00+08:00",
    service: "Take-out", subtotal: 165, discount: 0, cashPortion: 0, onlinePortion: 165,
    cashReceived: null, changeSettled: null,
    items: [{ product: "Flat White", size: "Regular", quantity: 1, discount: "None", lineTotal: 165 }]
  },
  {
    id: "o-20260727-1036", businessDay: "2026-07-27", orderNo: 1036, customer: "Nina Flores", status: "Completed",
    payment: "Cash", total: 360, tip: 20, change: 20, changeState: "settled", completedAt: "2026-07-27T17:06:00+08:00",
    service: "Dine-in", subtotal: 360, discount: 0, cashPortion: 360, onlinePortion: 0, cashReceived: 400,
    changeSettled: "2026-07-27T17:07:00+08:00",
    items: [{ product: "Spanish Latte", size: "Large", quantity: 2, discount: "None", lineTotal: 360 }]
  },
  {
    id: "o-20260727-1035", businessDay: "2026-07-27", orderNo: 1035, customer: "Ramon Uy", status: "Completed",
    payment: "Online", total: 610, tip: 60, change: 0, changeState: "zero", completedAt: "2026-07-27T16:22:00+08:00",
    service: "Dine-in", subtotal: 610, discount: 0, cashPortion: 0, onlinePortion: 610, cashReceived: null, changeSettled: null,
    items: [{ product: "Afternoon Set", size: "Regular", quantity: 2, discount: "None", lineTotal: 610 }]
  },
  {
    id: "o-20260727-1034", businessDay: "2026-07-27", orderNo: 1034, customer: "Mara Lim", status: "Void",
    payment: "Online", total: 175, tip: 0, change: 0, changeState: "zero", completedAt: null,
    service: "Take-out", subtotal: 175, discount: 0, cashPortion: 0, onlinePortion: 175, cashReceived: null, changeSettled: null,
    voidReason: "Customer requested cancellation before preparation.",
    items: [{ product: "Iced Americano", size: "Large", quantity: 1, discount: "None", lineTotal: 175 }]
  },
  {
    id: "o-20260727-1033", businessDay: "2026-07-27", orderNo: 1033, customer: "Carlo Garcia", status: "Completed",
    payment: "Cash", total: 485, tip: 15, change: 0, changeState: "zero", completedAt: "2026-07-27T14:59:00+08:00",
    service: "Dine-in", subtotal: 485, discount: 0, cashPortion: 485, onlinePortion: 0, cashReceived: 500, changeSettled: null,
    items: [{ product: "Coffee and Pastry Set", size: "Regular", quantity: 1, discount: "None", lineTotal: 485 }]
  },
  {
    id: "o-20260727-1032", businessDay: "2026-07-27", orderNo: 1032, customer: "Iris Tan", status: "Parked",
    payment: null, total: 330, tip: null, change: null, changeState: null, completedAt: null,
    service: "Dine-in", subtotal: 330, discount: 0, cashPortion: null, onlinePortion: null, cashReceived: null, changeSettled: null,
    items: [{ product: "Cappuccino", size: "Regular", quantity: 2, discount: "None", lineTotal: 330 }]
  },
  {
    id: "o-20260726-1031", businessDay: "2026-07-26", orderNo: 1031, customer: "Joaquin Co", status: "Completed",
    payment: "Split", total: 720, tip: 80, change: 0, changeState: "zero", completedAt: "2026-07-26T18:34:00+08:00",
    service: "Dine-in", subtotal: 720, discount: 0, cashPortion: 400, onlinePortion: 320, cashReceived: 480, changeSettled: null,
    items: [{ product: "Dinner Coffee Set", size: "Regular", quantity: 2, discount: "None", lineTotal: 720 }]
  },
  {
    id: "o-20260726-1030", businessDay: "2026-07-26", orderNo: 1030, customer: "Sofia Velasco", status: "Completed",
    payment: "Online", total: 245, tip: 0, change: 0, changeState: "zero", completedAt: "2026-07-26T17:19:00+08:00",
    service: "Take-out", subtotal: 245, discount: 0, cashPortion: 0, onlinePortion: 245, cashReceived: null, changeSettled: null,
    items: [{ product: "Mocha", size: "Large", quantity: 1, discount: "None", lineTotal: 245 }]
  },
  {
    id: "o-20260725-1029", businessDay: "2026-07-25", orderNo: 1029, customer: "Gabriel Ong", status: "Completed",
    payment: "Cash", total: 530, tip: 20, change: 50, changeState: "settled", completedAt: "2026-07-25T19:02:00+08:00",
    service: "Dine-in", subtotal: 530, discount: 0, cashPortion: 530, onlinePortion: 0, cashReceived: 600,
    changeSettled: "2026-07-25T19:04:00+08:00",
    items: [{ product: "House Specials", size: "Regular", quantity: 2, discount: "None", lineTotal: 530 }]
  }
];

const state = {
  sortKey: "businessDay", sortDirection: "desc", page: 1, pageSize: 10,
  search: "", status: "All", payment: "All", listReview: "populated", activeOrderId: null
};

const el = {
  listScreen: document.querySelector("#list-screen"),
  detailScreen: document.querySelector("#detail-screen"),
  search: document.querySelector("#customer-search"),
  status: document.querySelector("#status-filter"),
  payment: document.querySelector("#payment-filter"),
  pageSize: document.querySelector("#page-size"),
  body: document.querySelector("#orders-body"),
  tableRegion: document.querySelector("#table-region"),
  empty: document.querySelector("#empty-state"),
  emptyGuidance: document.querySelector("#empty-guidance"),
  results: document.querySelector("#results-summary"),
  pagination: document.querySelector("#pagination"),
  announcer: document.querySelector("#screen-announcer"),
  detailReview: document.querySelector("#detail-review-select")
};

function money(value) {
  if (value === null || value === undefined || value === DASH) return DASH;
  return peso.format(value);
}

function safe(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return dateDisplay.format(new Date(`${value}T12:00:00+08:00`));
}

function formatTimestamp(value) {
  return value && value !== DASH ? `${timestampDisplay.format(new Date(value))} PHT` : DASH;
}

function statusMarkup(status) {
  return `<span class="status-badge status-${status.toLowerCase()}">${safe(status)}</span>`;
}

function changeMarkup(order) {
  if (order.change === null || order.change === undefined) return `<span class="unavailable">${DASH}</span>`;
  const zeroClass = order.change === 0 ? " money-zero" : "";
  if (order.changeState === "outstanding") {
    return `<span class="change-value change-outstanding"><span class="money">${money(order.change)}</span><span class="change-note">Outstanding</span><span class="sr-only">change is outstanding</span></span>`;
  }
  if (order.changeState === "settled" && order.change > 0) {
    return `<span class="change-value"><span class="money">${money(order.change)}</span><span class="change-note">Settled</span><span class="sr-only">change was settled</span></span>`;
  }
  return `<span class="money${zeroClass}">${money(order.change)}</span>`;
}

function getFilteredOrders() {
  if (state.listReview === "no-orders" || state.listReview === "filtered-empty") return [];
  const query = state.search.trim().toLocaleLowerCase("en-PH");
  return orders.filter((order) => {
    const searchableCustomer = order.customer === "Walk-in" ? "" : order.customer.toLocaleLowerCase("en-PH");
    return (!query || searchableCustomer.includes(query))
      && (state.status === "All" || order.status === state.status)
      && (state.payment === "All" || order.payment === state.payment);
  });
}

function compareOrders(a, b) {
  const key = state.sortKey;
  let aValue = a[key];
  let bValue = b[key];
  if (aValue === null) aValue = "";
  if (bValue === null) bValue = "";
  const result = typeof aValue === "number"
    ? aValue - bValue
    : String(aValue).localeCompare(String(bValue), "en-PH", { numeric: true });
  if (result !== 0) return state.sortDirection === "asc" ? result : -result;
  if (key === "businessDay") return b.orderNo - a.orderNo;
  return b.businessDay.localeCompare(a.businessDay);
}

function updateSortHeaders() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const active = button.dataset.sort === state.sortKey;
    const indicator = button.querySelector("span");
    indicator.textContent = active ? (state.sortDirection === "asc" ? "↑" : "↓") : "";
    button.removeAttribute("aria-sort");
    button.closest("th").setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.setAttribute("aria-label", `${button.textContent.trim().replace(/[↑↓]/g, "")}${active ? `, sorted ${state.sortDirection === "asc" ? "ascending" : "descending"}` : ", not sorted"}`);
  });
}

function renderList() {
  const filtered = getFilteredOrders().sort(compareOrders);
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageOrders = filtered.slice(start, start + state.pageSize);

  el.body.innerHTML = pageOrders.map((order) => `
    <tr data-od-id="order-row-${safe(order.id)}">
      <td><span class="identity-cell"><span class="mono">${formatDate(order.businessDay)}</span><span class="sr-only">paired with order ${order.orderNo}</span></span></td>
      <td><a class="order-link" href="#order/${encodeURIComponent(order.id)}" data-order-id="${safe(order.id)}" aria-label="Open order ${order.orderNo} for business day ${formatDate(order.businessDay)}">${order.orderNo}</a></td>
      <td><span class="customer-name">${safe(order.customer)}</span></td>
      <td>${statusMarkup(order.status)}</td>
      <td>${order.payment ? safe(order.payment === "Split" ? "Split (Cash + Online)" : order.payment) : `<span class="unavailable">${DASH}</span>`}</td>
      <td class="numeric"><span class="money">${money(order.total)}</span></td>
      <td class="numeric"><span class="${order.tip === 0 ? "money money-zero" : order.tip === null ? "unavailable" : "money"}">${money(order.tip)}</span></td>
      <td class="numeric">${changeMarkup(order)}</td>
      <td><span class="mono ${order.completedAt ? "" : "unavailable"}">${formatTimestamp(order.completedAt)}</span></td>
    </tr>
  `).join("");

  const isEmpty = filtered.length === 0;
  el.empty.hidden = !isEmpty;
  el.tableRegion.querySelector("table").hidden = isEmpty;
  el.pagination.hidden = isEmpty;

  if (isEmpty) {
    const genuinelyEmpty = state.listReview === "no-orders";
    el.emptyGuidance.textContent = genuinelyEmpty ? "Orders will appear here after the shop records its first sale." : "Clear the current filters or search to see available orders.";
    el.results.textContent = "0 orders";
  } else {
    el.results.textContent = `Showing ${start + 1}–${Math.min(start + state.pageSize, filtered.length)} of ${filtered.length} orders`;
  }

  renderPagination(filtered.length, totalPages);
  updateSortHeaders();
  bindOrderLinks();
}

function renderPagination(total, totalPages) {
  if (!total) {
    el.pagination.innerHTML = "";
    return;
  }
  const pageButtons = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `<button type="button" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ""} aria-label="Page ${page}">${page}</button>`;
  }).join("");
  el.pagination.innerHTML = `
    <button type="button" data-page-action="previous" ${state.page === 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons}
    <button type="button" data-page-action="next" ${state.page === totalPages ? "disabled" : ""}>Next</button>
  `;
  el.pagination.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.page) state.page = Number(button.dataset.page);
    if (button.dataset.pageAction === "previous") state.page -= 1;
    if (button.dataset.pageAction === "next") state.page += 1;
    renderList();
    el.results.focus?.();
  }));
}

function bindOrderLinks() {
  document.querySelectorAll("[data-order-id]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showDetail(link.dataset.orderId);
    });
  });
}

function detailMoney(value) {
  const className = value === 0 ? "money money-zero" : value === null || value === undefined || value === DASH ? "unavailable" : "money";
  return `<span class="${className}">${money(value)}</span>`;
}

function renderPaymentSummary(order) {
  const rows = [
    ["Subtotal", detailMoney(order.subtotal), ""],
    ["Total discount", detailMoney(order.discount), ""],
    ["Total", detailMoney(order.total), "total-row"],
    ["Cash portion", detailMoney(order.cashPortion), "group-start"],
    ["Online portion", detailMoney(order.onlinePortion), ""],
    ["Tip", detailMoney(order.tip), "group-start"],
    ["Cash received", detailMoney(order.cashReceived), ""],
    ["Change owed", detailMoney(order.change), ""],
    ["Change settled", order.changeSettled ? `<span class="mono">${formatTimestamp(order.changeSettled)}</span>` : `<span class="unavailable">${DASH}</span>`, ""],
    ["Completed", order.completedAt ? `<span class="mono">${formatTimestamp(order.completedAt)}</span>` : `<span class="unavailable">${DASH}</span>`, ""]
  ];
  if (order.status === "Void") rows.push(["Void reason", safe(order.voidReason || DASH), "group-start"]);
  document.querySelector("#payment-summary").innerHTML = rows.map(([label, value, className]) =>
    `<div class="payment-row ${className}"><dt>${label}</dt><dd>${value}</dd></div>`
  ).join("");
  document.querySelector("#split-note").hidden = order.payment !== "Split";
}

function showDetail(orderId) {
  const order = orders.find((item) => item.id === orderId) || orders[0];
  state.activeOrderId = order.id;
  el.detailReview.value = ["split-senior", "parked", "void", "outstanding", "settled"].includes(order.id) ? order.id : "split-senior";

  document.querySelector("#detail-order-number").textContent = order.orderNo;
  document.querySelector("#detail-identity").textContent = `${formatDate(order.businessDay)} · Order ${order.orderNo}`;
  document.querySelector("#detail-customer").textContent = order.customer;
  document.querySelector("#detail-service").textContent = order.service;
  document.querySelector("#detail-payment").textContent = order.payment ? (order.payment === "Split" ? "Split (Cash + Online)" : order.payment) : DASH;
  document.querySelector("#detail-status").outerHTML = statusMarkup(order.status).replace("<span", '<span id="detail-status"');

  document.querySelector("#items-body").innerHTML = order.items.map((item) => `
    <tr>
      <td>${safe(item.product)}</td>
      <td>${safe(item.size)}</td>
      <td class="numeric mono">${item.quantity}</td>
      <td>${safe(item.discount)}${item.note ? `<span class="line-note">${safe(item.note)}</span>` : ""}</td>
      <td class="numeric money">${item.original ? `<span class="original-price">${money(item.original)}</span>` : ""}${money(item.lineTotal)}</td>
    </tr>
  `).join("");
  renderPaymentSummary(order);

  el.listScreen.hidden = true;
  el.listScreen.classList.remove("screen-active");
  el.detailScreen.hidden = false;
  el.detailScreen.classList.remove("screen-active");
  void el.detailScreen.offsetWidth;
  el.detailScreen.classList.add("screen-active");
  document.title = `Order ${order.orderNo} | UCM Coffee Studio Admin`;
  history.replaceState(null, "", `#order/${encodeURIComponent(order.id)}`);
  document.querySelector("#back-link").focus();
  el.announcer.textContent = `Opened order ${order.orderNo} for ${formatDate(order.businessDay)}`;
}

function showList() {
  el.detailScreen.hidden = true;
  el.detailScreen.classList.remove("screen-active");
  el.listScreen.hidden = false;
  el.listScreen.classList.remove("screen-active");
  void el.listScreen.offsetWidth;
  el.listScreen.classList.add("screen-active");
  document.title = "Order History | UCM Coffee Studio Admin";
  history.replaceState(null, "", "#order-history");
  document.querySelector("#page-title").focus?.();
  el.announcer.textContent = "Returned to Order History with list context preserved";
}

document.querySelectorAll(".sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDirection = key === "status" ? "asc" : "desc";
    }
    state.page = 1;
    renderList();
  });
});

el.search.addEventListener("input", () => {
  state.search = el.search.value.trim();
  state.page = 1;
  state.listReview = "populated";
  syncListReviewButtons();
  renderList();
});

el.status.addEventListener("change", () => {
  state.status = el.status.value;
  state.page = 1;
  state.listReview = "populated";
  syncListReviewButtons();
  renderList();
});

el.payment.addEventListener("change", () => {
  state.payment = el.payment.value;
  state.page = 1;
  state.listReview = "populated";
  syncListReviewButtons();
  renderList();
});

el.pageSize.addEventListener("change", () => {
  state.pageSize = Number(el.pageSize.value);
  state.page = 1;
  renderList();
});

function syncListReviewButtons() {
  document.querySelectorAll("[data-list-state]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.listState === state.listReview));
  });
}

document.querySelectorAll("[data-list-state]").forEach((button) => {
  button.addEventListener("click", () => {
    state.listReview = button.dataset.listState;
    state.page = 1;
    syncListReviewButtons();
    renderList();
    el.announcer.textContent = `${button.textContent} list review state selected`;
  });
});

document.querySelector("#back-link").addEventListener("click", (event) => {
  event.preventDefault();
  showList();
});

el.detailReview.addEventListener("change", () => {
  showDetail(el.detailReview.value);
  el.detailReview.focus();
});

window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#order/")) showList();
});

renderList();
if (location.hash.startsWith("#order/")) showDetail(decodeURIComponent(location.hash.split("/")[1]));
