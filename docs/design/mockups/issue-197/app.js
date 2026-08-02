(() => {
  "use strict";

  const ORDER_DUE_FALLBACK = 35000;
  const productCatalog = {
    "milky-choco": { name: "Milky Choco", size: "Medio", price: 15800, category: "Non Coffee", freeUpsizeEligible: false },
    "house-blend": { name: "House Blend", size: "M", price: 5000, category: "Coffee", freeUpsizeEligible: true },
    "signature-latte": { name: "Signature Latte", size: "M", price: 15000, category: "Coffee", freeUpsizeEligible: true }
  };

  const state = {
    lines: [],
    activeLineId: null,
    paymentMethod: "cash",
    completed: false,
    voided: false,
    cashier: "",
    frozenCashier: "",
    nextLineId: 1
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const byId = (id) => document.getElementById(id);
  const money = (cents) => `₱${(Math.max(0, cents) / 100).toFixed(2)}`;
  const parseCents = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  };

  function newLine(productKey, overrides = {}) {
    const product = productCatalog[productKey];
    return {
      id: state.nextLineId++,
      productKey,
      name: product.name,
      size: product.size,
      unitPrice: product.price,
      quantity: 1,
      preferences: [],
      note: "",
      discount: "none",
      upsizes: 0,
      freeUpsizeEligible: product.freeUpsizeEligible,
      ...overrides
    };
  }

  function resetOrder(mode = "lines") {
    state.completed = false;
    state.voided = false;
    state.nextLineId = 1;
    state.frozenCashier = state.cashier;
    if (mode === "empty") {
      state.lines = [];
    } else if (mode === "worst") {
      state.lines = [newLine("signature-latte", {
        quantity: 2,
        preferences: ["Sweeter", "Stronger", "Less sweet", "Less ice"],
        note: "Oat milk, warm not hot, split into two cups, please",
        discount: "senior",
        upsizes: 2
      })];
    } else {
      state.lines = [
        newLine("signature-latte", {
          quantity: 2,
          preferences: ["Sweeter", "Stronger", "Less sweet", "Less ice"],
          note: "Oat milk, warm not hot, split into two cups, please",
          discount: "senior",
          upsizes: 2
        }),
        newLine("milky-choco")
      ];
    }
    renderOrder();
  }

  function lineMath(line) {
    const subtotal = line.unitPrice * line.quantity;
    const promotion = line.upsizes * 3000;
    const discountBase = Math.max(0, subtotal - promotion);
    const discount = line.discount === "none" ? 0 : Math.floor((discountBase * 20 + 50) / 100);
    const total = discountBase - discount;
    return { subtotal, promotion, discountBase, discount, total };
  }

  function orderMath() {
    return state.lines.reduce((sum, line) => {
      const result = lineMath(line);
      sum.subtotal += result.subtotal;
      sum.promotion += result.promotion;
      sum.discount += result.discount;
      sum.total += result.total;
      return sum;
    }, { subtotal: 0, promotion: 0, discount: 0, total: 0 });
  }

  function detailChip(text, className = "") {
    return `<span class="detail-chip ${className}">${text}</span>`;
  }

  function renderLine(line) {
    const amounts = lineMath(line);
    const preferenceChips = line.preferences.map((item) => detailChip(item)).join("");
    const discountChip = line.discount === "none" ? "" : detailChip(`${line.discount === "pwd" ? "PWD" : "Senior"} -${money(amounts.discount)}`, "discount");
    const promotionChip = line.upsizes ? detailChip(`${line.upsizes} free upsize${line.upsizes > 1 ? "s" : ""} -${money(amounts.promotion)}`, "promotion") : "";
    return `
      <article class="line-item" data-line-id="${line.id}" data-od-id="order-line-${line.id}">
        <div class="line-main">
          <div class="line-heading">
            <h3>${line.name}</h3>
            <p>${line.size} · ${money(line.unitPrice)} each · Qty ${line.quantity}</p>
          </div>
          <strong class="line-total">${money(amounts.total)}</strong>
        </div>
        <div class="line-details">
          ${preferenceChips}${promotionChip}${discountChip}
          ${line.note ? `<p class="line-note"><strong>Note:</strong> ${line.note}</p>` : ""}
        </div>
        <div class="line-controls" aria-label="Controls for ${line.name}, ${line.size}">
          <button type="button" data-action="decrease" aria-label="Decrease ${line.name} quantity">−</button>
          <span class="qty" aria-label="Quantity ${line.quantity}">${line.quantity}</span>
          <button type="button" data-action="increase" aria-label="Increase ${line.name} quantity">+</button>
          <button type="button" class="prefs-action" data-action="preferences">Prefs</button>
          <button type="button" class="discount-action" data-action="discount">Discount</button>
          <button type="button" class="upsize-action" data-action="upsize" ${line.freeUpsizeEligible ? "" : `disabled aria-describedby="upsize-unavailable-${line.id}"`}>Upsize</button>
          <button type="button" class="remove-line" data-action="remove" aria-label="Remove ${line.name}">×</button>
          ${line.freeUpsizeEligible ? "" : `<span id="upsize-unavailable-${line.id}" class="sr-only">Unavailable because this line’s category is not marked free upsize eligible.</span>`}
        </div>
      </article>`;
  }

  function renderOrder() {
    const list = byId("line-list");
    if (!state.lines.length) {
      list.innerHTML = `<div class="empty-order"><div><h3>Order is empty</h3><p>Choose a size from the catalog to begin a walk-in order.</p></div></div>`;
    } else {
      list.innerHTML = state.lines.map(renderLine).join("");
    }
    const totals = orderMath();
    byId("subtotal").textContent = money(totals.subtotal);
    byId("upsize-total").textContent = totals.promotion ? `-${money(totals.promotion)}` : money(0);
    byId("discount-total").textContent = totals.discount ? `-${money(totals.discount)}` : money(0);
    byId("amount-due").textContent = money(totals.total);
    byId("charge-amount").textContent = money(totals.total);
    byId("charge-button").disabled = !state.lines.length || state.completed;
    byId("park-button").disabled = !state.lines.length || state.completed;
    byId("void-button").disabled = !state.completed || state.voided;
    byId("order-cashier").textContent = state.frozenCashier || "No cashier";
    byId("order-number").textContent = state.completed ? "Completed #1048" : "Order #1048";
  }

  function setReviewButton(activeState) {
    $$(".review-controls button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.state === activeState));
    });
  }

  function showDialog(id) {
    const dialog = byId(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = byId(id);
    if (dialog?.open) dialog.close();
  }

  function toast(message) {
    const element = byId("toast");
    element.textContent = message;
    element.hidden = false;
    window.setTimeout(() => { element.hidden = true; }, 3000);
  }

  function selectLine(preferredEligible = false) {
    const line = preferredEligible
      ? state.lines.find((item) => item.freeUpsizeEligible)
      : state.lines[0];
    state.activeLineId = line?.id ?? null;
    return line;
  }

  function openPreferences(line = selectLine()) {
    if (!line) return;
    state.activeLineId = line.id;
    byId("preferences-title").textContent = `${line.name}, ${line.size}`;
    $$("input[name='preference']").forEach((input) => { input.checked = line.preferences.includes(input.value); });
    byId("preference-note").value = line.note;
    updatePreferenceValidation();
    showDialog("preferences-dialog");
  }

  function openDiscount(line = selectLine()) {
    if (!line) return;
    state.activeLineId = line.id;
    const radio = $(`input[name='discount'][value='${line.discount}']`);
    if (radio) radio.checked = true;
    byId("discount-title").textContent = `${line.name} discount`;
    showDialog("discount-dialog");
  }

  function openUpsize(line = selectLine(true)) {
    if (!line) return;
    state.activeLineId = line.id;
    byId("upsize-title").textContent = `${line.name} free upsize`;
    byId("upsize-count").max = String(line.quantity);
    byId("upsize-count").value = String(line.upsizes);
    byId("upsize-limit").textContent = `Maximum ${line.quantity} for quantity ${line.quantity}`;
    byId("upsize-error").hidden = true;
    showDialog("upsize-dialog");
  }

  function updatePreferenceValidation() {
    const note = byId("preference-note");
    const length = note.value.trim().length;
    byId("note-counter").textContent = `${length} / 255`;
    byId("note-counter").classList.toggle("field-error", length > 255);
    byId("note-error").hidden = length <= 255;
    const checked = $$("input[name='preference']:checked").map((input) => input.value);
    byId("sweet-pair-note").hidden = !(checked.includes("Sweeter") && checked.includes("Less sweet"));
  }

  function paymentMarkup(method, due) {
    if (method === "online") {
      return `<div class="decision-note"><strong>Online settles ${money(due)} in full.</strong><p>No cash-received or change fields apply to this payment.</p></div>`;
    }
    if (method === "split") {
      return `
        <div class="payment-summary" aria-live="polite"><div><span>Amount due</span><strong>${money(due)}</strong></div><div><span>Running remainder</span><strong id="split-remainder">${money(due)}</strong></div></div>
        <label class="field-block" for="cash-portion"><span>Cash portion</span><input id="cash-portion" class="money-input" type="number" inputmode="decimal" min="0" step="0.01" value="150.00" aria-describedby="split-error"></label>
        <label class="field-block" for="online-portion"><span>Online portion</span><input id="online-portion" class="money-input" type="number" inputmode="decimal" min="0" step="0.01" value="200.00" aria-describedby="split-error"></label>
        <p class="field-error" id="split-error" role="alert" hidden>Cash and Online portions must be non-negative and sum exactly to ${money(due)}.</p>
        <label class="field-block" for="cash-received"><span>Cash received <small>Blank means exactly the Cash portion</small></span><input id="cash-received" class="money-input" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Exact cash received" aria-describedby="cash-error"></label>
        <p class="field-error" id="cash-error" role="alert" hidden>Cash received must cover the Cash portion.</p>
        <div class="payment-summary"><div><span>Change due</span><strong id="change-due">₱0.00</strong></div><div><span>Online settles</span><strong id="online-settles">₱200.00</strong></div></div>`;
    }
    return `
      <label class="field-block" for="cash-received"><span>Cash received <small>Blank means exact cash received</small></span><input id="cash-received" class="money-input" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Exact amount: ${money(due)}" aria-describedby="cash-help cash-error"></label>
      <p id="cash-help">Leave blank when the customer hands over exactly ${money(due)}.</p>
      <p class="field-error" id="cash-error" role="alert" hidden>Cash received must be at least ${money(due)}.</p>
      <div class="payment-summary"><div><span>Amount due</span><strong>${money(due)}</strong></div><div><span>Change due</span><strong id="change-due">₱0.00</strong></div></div>`;
  }

  function openCharge(method = "cash") {
    if (!state.lines.length) resetOrder("lines");
    state.paymentMethod = method;
    const due = orderMath().total || ORDER_DUE_FALLBACK;
    $("#charge-title .money").textContent = money(due);
    $$(".payment-tabs button").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.payment === method));
    });
    byId("payment-fields").innerHTML = paymentMarkup(method, due);
    byId("cash-tip").value = "0.00";
    byId("change-owed").value = "0.00";
    byId("tip-error").hidden = true;
    byId("owed-error").hidden = true;
    bindPaymentInputs();
    updatePayment();
    showDialog("charge-dialog");
  }

  function bindPaymentInputs() {
    ["cash-received", "cash-portion", "online-portion"].forEach((id) => {
      byId(id)?.addEventListener("input", updatePayment);
    });
  }

  function currentPayment() {
    const due = orderMath().total || ORDER_DUE_FALLBACK;
    if (state.paymentMethod === "online") return { due, cashPortion: 0, onlinePortion: due, cashReceived: 0, change: 0, remainder: 0 };
    if (state.paymentMethod === "split") {
      const cashPortion = parseCents(byId("cash-portion")?.value) ?? 0;
      const onlinePortion = parseCents(byId("online-portion")?.value) ?? 0;
      const receivedInput = parseCents(byId("cash-received")?.value);
      const cashReceived = receivedInput === null ? cashPortion : receivedInput;
      return { due, cashPortion, onlinePortion, cashReceived, change: Math.max(0, cashReceived - cashPortion), remainder: due - cashPortion - onlinePortion };
    }
    const receivedInput = parseCents(byId("cash-received")?.value);
    const cashReceived = receivedInput === null ? due : receivedInput;
    return { due, cashPortion: due, onlinePortion: 0, cashReceived, change: Math.max(0, cashReceived - due), remainder: 0 };
  }

  function updatePayment() {
    const payment = currentPayment();
    if (byId("change-due")) byId("change-due").textContent = money(payment.change);
    if (byId("split-remainder")) {
      const sign = payment.remainder < 0 ? "-" : "";
      byId("split-remainder").textContent = `${sign}${money(Math.abs(payment.remainder))}`;
    }
    if (byId("online-settles")) byId("online-settles").textContent = money(payment.onlinePortion);
    const cashError = byId("cash-error");
    if (cashError) cashError.hidden = payment.cashReceived >= payment.cashPortion;
    const splitError = byId("split-error");
    if (splitError) splitError.hidden = payment.cashPortion >= 0 && payment.onlinePortion >= 0 && payment.remainder === 0;
    byId("change-owed").max = (payment.change / 100).toFixed(2);
  }

  function validatePayment() {
    const payment = currentPayment();
    const tip = parseCents(byId("cash-tip").value) ?? 0;
    const owed = parseCents(byId("change-owed").value) ?? 0;
    const splitValid = state.paymentMethod !== "split" || (payment.cashPortion >= 0 && payment.onlinePortion >= 0 && payment.remainder === 0);
    const cashValid = payment.cashReceived >= payment.cashPortion;
    const tipValid = tip >= 0;
    const owedValid = owed >= 0 && owed <= payment.change;
    if (byId("split-error")) byId("split-error").hidden = splitValid;
    if (byId("cash-error")) byId("cash-error").hidden = cashValid;
    byId("tip-error").hidden = tipValid;
    byId("owed-error").hidden = owedValid;
    return { valid: splitValid && cashValid && tipValid && owedValid, payment, tip, owed };
  }

  function completePayment() {
    const result = validatePayment();
    if (!result.valid) return false;
    state.completed = true;
    state.voided = false;
    const labels = { cash: "Cash received", online: "Online payment", split: "Cash + Online" };
    byId("confirm-method").textContent = labels[state.paymentMethod];
    byId("confirm-paid").textContent = state.paymentMethod === "online"
      ? money(result.payment.onlinePortion)
      : state.paymentMethod === "split"
        ? `${money(result.payment.cashPortion)} + ${money(result.payment.onlinePortion)}`
        : money(result.payment.cashReceived);
    byId("confirm-tip").textContent = money(result.tip);
    byId("confirm-change").textContent = money(result.payment.change);
    byId("confirm-owed").textContent = money(result.owed);
    closeDialog("charge-dialog");
    renderOrder();
    showDialog("confirmation-dialog");
    return true;
  }

  function showOrders() {
    byId("order-workspace").hidden = true;
    byId("orders-review").hidden = false;
  }

  function showWorkspace() {
    byId("orders-review").hidden = true;
    byId("order-workspace").hidden = false;
  }

  $$("[data-add]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    const existing = state.lines.find((line) => line.productKey === button.dataset.add && line.discount === "none" && !line.note && !line.upsizes);
    if (existing) existing.quantity += 1;
    else state.lines.push(newLine(button.dataset.add));
    renderOrder();
    toast(`${productCatalog[button.dataset.add].name}, ${productCatalog[button.dataset.add].size} added.`);
  }));

  $$(".stock-toggle").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest(".product-card");
    const soldOut = !card.classList.contains("is-sold-out");
    card.classList.toggle("is-sold-out", soldOut);
    button.setAttribute("aria-pressed", String(soldOut));
    button.textContent = soldOut ? "Mark available" : "Mark sold out";
    const availability = $(".availability", card);
    availability.textContent = soldOut ? "Sold out · Unbuyable" : "Available";
    availability.className = `availability ${soldOut ? "sold-out" : "available"}`;
    $$("[data-add]", card).forEach((add) => { add.disabled = soldOut; });
    toast(`${$("h3", card).textContent} marked ${soldOut ? "sold out" : "available"}.`);
  }));

  byId("line-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const lineElement = button.closest("[data-line-id]");
    const line = state.lines.find((item) => item.id === Number(lineElement.dataset.lineId));
    if (!line) return;
    const action = button.dataset.action;
    if (action === "increase") line.quantity += 1;
    if (action === "decrease") {
      if (line.quantity === 1) state.lines = state.lines.filter((item) => item.id !== line.id);
      else {
        line.quantity -= 1;
        if (line.upsizes > line.quantity) line.upsizes = line.quantity;
      }
    }
    if (action === "remove") state.lines = state.lines.filter((item) => item.id !== line.id);
    if (action === "preferences") return openPreferences(line);
    if (action === "discount") return openDiscount(line);
    if (action === "upsize") return openUpsize(line);
    renderOrder();
  });

  $$(".segmented-control button").forEach((button) => button.addEventListener("click", () => {
    $$(".segmented-control button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  }));

  $$(".category-tabs a").forEach((link) => link.addEventListener("click", () => {
    $$(".category-tabs a").forEach((item) => item.removeAttribute("aria-current"));
    link.setAttribute("aria-current", "location");
  }));

  byId("cashier-control").addEventListener("click", () => showDialog("cashier-dialog"));
  $$(".cashier-choice").forEach((button) => button.addEventListener("click", () => {
    state.cashier = button.dataset.cashier;
    byId("cashier-label").textContent = state.cashier || "No cashier selected";
    $$(".cashier-choice").forEach((item) => item.classList.toggle("selected", item === button));
    closeDialog("cashier-dialog");
    toast(state.cashier ? `${state.cashier} is active for new orders.` : "No cashier selected. New orders can continue without attribution.");
  }));

  byId("preference-note").addEventListener("input", updatePreferenceValidation);
  $$("input[name='preference']").forEach((input) => input.addEventListener("change", updatePreferenceValidation));
  byId("preferences-form").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    const trimmed = byId("preference-note").value.trim();
    if (trimmed.length > 255) { event.preventDefault(); updatePreferenceValidation(); return; }
    const line = state.lines.find((item) => item.id === state.activeLineId);
    if (line) {
      line.preferences = $$("input[name='preference']:checked").map((input) => input.value);
      line.note = trimmed;
      renderOrder();
    }
  });

  byId("discount-form").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    const line = state.lines.find((item) => item.id === state.activeLineId);
    const selected = $("input[name='discount']:checked");
    if (line && selected) { line.discount = selected.value; renderOrder(); }
  });

  byId("upsize-form").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    const line = state.lines.find((item) => item.id === state.activeLineId);
    const count = Number(byId("upsize-count").value);
    const valid = line && line.freeUpsizeEligible && Number.isInteger(count) && count >= 0 && count <= line.quantity;
    if (!valid) { event.preventDefault(); byId("upsize-error").hidden = false; return; }
    line.upsizes = count;
    renderOrder();
  });
  byId("upsize-count").addEventListener("input", () => { byId("upsize-error").hidden = true; });

  byId("charge-button").addEventListener("click", () => openCharge("cash"));
  $$(".payment-tabs button").forEach((button) => button.addEventListener("click", () => {
    state.paymentMethod = button.dataset.payment;
    $$(".payment-tabs button").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
    byId("payment-fields").innerHTML = paymentMarkup(state.paymentMethod, orderMath().total || ORDER_DUE_FALLBACK);
    bindPaymentInputs();
    updatePayment();
  }));
  byId("cash-tip").addEventListener("input", () => { byId("tip-error").hidden = true; });
  byId("change-owed").addEventListener("input", () => { byId("owed-error").hidden = true; });
  byId("charge-form").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    completePayment();
  });

  byId("review-completed").addEventListener("click", () => { closeDialog("confirmation-dialog"); state.completed = true; renderOrder(); });
  byId("new-order").addEventListener("click", () => { closeDialog("confirmation-dialog"); resetOrder("empty"); toast("New walk-in order ready."); });
  byId("void-button").addEventListener("click", () => showDialog("void-dialog"));
  byId("void-form").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    const reason = byId("void-reason").value.trim();
    if (!reason) { event.preventDefault(); byId("void-error").hidden = false; return; }
    state.voided = true;
    renderOrder();
    toast("Order #1048 marked void. Create a new order for any correction.");
  });
  byId("void-reason").addEventListener("input", () => { byId("void-error").hidden = true; });

  $$('[data-review-target="orders"]').forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showOrders(); }));
  byId("back-to-order").addEventListener("click", showWorkspace);
  byId("settle-change").addEventListener("click", (event) => {
    const row = byId("unsettled-change-row");
    row.children[3].innerHTML = `<strong>Settled</strong><small>Handed over 11:08 AM</small>`;
    event.currentTarget.replaceWith(Object.assign(document.createElement("span"), { className: "neutral-status", textContent: "Complete" }));
    toast("Settlement time recorded. The original ₱50.00 owed remains on the order record.");
  });

  $$(".parked-order").forEach((button) => button.addEventListener("click", () => {
    resetOrder("lines");
    toast("Parked walk-in order resumed with its original cashier attribution.");
  }));

  $$(".review-controls button").forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.state;
    setReviewButton(mode);
    showWorkspace();
    byId("day-closed").hidden = true;
    if (mode === "empty") resetOrder("empty");
    if (mode === "loading") {
      state.lines = [];
      byId("line-list").innerHTML = `<div class="loading-order" role="status" aria-live="polite" aria-label="Loading current order"><div class="skeleton"></div><div class="skeleton"></div><span class="sr-only">Loading current order</span></div>`;
      ["subtotal", "upsize-total", "discount-total", "amount-due", "charge-amount"].forEach((id) => { byId(id).textContent = "₱0.00"; });
      byId("charge-button").disabled = true;
      byId("park-button").disabled = true;
    }
    if (mode === "lines") resetOrder("lines");
    if (mode === "worst") resetOrder("worst");
    if (mode === "preferences") { resetOrder("worst"); openPreferences(); }
    if (mode === "discount") { resetOrder("worst"); openDiscount(); }
    if (mode === "upsize") { resetOrder("worst"); openUpsize(); }
    if (mode === "soldout") {
      const card = $("[data-product='milky-choco']");
      const toggle = $(".stock-toggle", card);
      if (!card.classList.contains("is-sold-out")) toggle.click();
      card.setAttribute("tabindex", "-1");
      card.focus({ preventScroll: true });
    }
    if (mode === "nodayout") byId("day-closed").hidden = false;
    if (["cash", "online", "split"].includes(mode)) { resetOrder("lines"); openCharge(mode); }
    if (mode === "changeowed") showOrders();
    if (mode === "completed") { resetOrder("lines"); state.completed = true; renderOrder(); showDialog("confirmation-dialog"); }
    if (mode === "void") { resetOrder("lines"); state.completed = true; renderOrder(); showDialog("void-dialog"); }
    if (mode === "nocashier") {
      state.cashier = "";
      state.frozenCashier = "";
      byId("cashier-label").textContent = "No cashier selected";
      renderOrder();
      toast("Supported state: order can proceed without cashier attribution.");
    }
  }));

  resetOrder("lines");
})();
