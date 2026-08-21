(function () {
  "use strict";

  const money = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const states = [
    {
      id: "cash-change-given",
      label: "Cash with change due",
      order: 12,
      status: "Completed",
      statusKey: "completed",
      payment: "Cash",
      completion: "10:42 AM",
      cashier: "Mika Santos",
      total: 20000,
      tenders: [{ label: "Cash", cents: 20000 }],
      cashReceived: 50000,
      lines: [{ name: "2 × Iced latte", cents: 18000 }, { name: "1 × Espresso shot", cents: 2000 }],
      change: { state: "given", cents: 30000, time: "Handed over at 10:43 AM" }
    },
    {
      id: "cash-zero",
      label: "Exact cash, zero",
      order: 13,
      status: "Completed",
      statusKey: "completed",
      payment: "Cash",
      completion: "10:51 AM",
      cashier: "Mika Santos",
      total: 18000,
      tenders: [{ label: "Cash", cents: 18000 }],
      cashReceived: 18000,
      lines: [{ name: "2 × Cappuccino", cents: 18000 }]
    },
    {
      id: "cash-negative",
      label: "Negative legacy value",
      order: 14,
      status: "Completed",
      statusKey: "completed",
      payment: "Cash",
      completion: "11:03 AM",
      cashier: "Paolo Reyes",
      total: 22000,
      tenders: [{ label: "Cash", cents: 22000 }],
      cashReceived: 20000,
      lines: [{ name: "2 × Flat white", cents: 22000 }]
    },
    {
      id: "cash-tip",
      label: "Cash with tip",
      order: 15,
      status: "Completed",
      statusKey: "completed",
      payment: "Cash",
      completion: "11:14 AM",
      cashier: "Paolo Reyes",
      total: 20000,
      tenders: [{ label: "Cash", cents: 20000 }, { label: "Cash tip", cents: 5000 }],
      cashReceived: 50000,
      lines: [{ name: "2 × Cold brew", cents: 20000 }]
    },
    {
      id: "split",
      label: "Split cash + online",
      order: 16,
      status: "Completed",
      statusKey: "completed",
      payment: "Split",
      completion: "11:26 AM",
      cashier: "Lia Mendoza",
      total: 45000,
      tenders: [{ label: "Cash", cents: 20000 }, { label: "Online", cents: 25000 }],
      tenderAria: "Split payment",
      cashReceived: 50000,
      lines: [{ name: "3 × Spanish latte", cents: 36000 }, { name: "1 × Banana loaf", cents: 9000 }]
    },
    {
      id: "online-only",
      label: "Online only",
      order: 17,
      status: "Completed",
      statusKey: "completed",
      payment: "Online",
      completion: "11:37 AM",
      cashier: "Lia Mendoza",
      total: 24000,
      tenders: [{ label: "Online", cents: 24000 }],
      cashReceived: null,
      lines: [{ name: "2 × Matcha latte", cents: 24000 }]
    },
    {
      id: "received-no-cash-row",
      label: "Received, no cash row",
      order: 18,
      status: "Completed",
      statusKey: "completed",
      payment: "Online",
      completion: "11:49 AM",
      cashier: "Mika Santos",
      total: 16000,
      tenders: [{ label: "Online", cents: 16000 }],
      cashReceived: 50000,
      lines: [{ name: "2 × Americano", cents: 16000 }]
    },
    {
      id: "parked",
      label: "Parked",
      order: 19,
      status: "Parked",
      statusKey: "parked",
      payment: "Not settled",
      completion: "Not completed",
      cashier: "Paolo Reyes",
      total: 28000,
      tenders: [],
      cashReceived: null,
      lines: [{ name: "2 × Mocha", cents: 24000 }, { name: "1 × Extra shot", cents: 4000 }]
    },
    {
      id: "voided-original",
      label: "Voided after completion",
      order: 20,
      status: "Voided",
      statusKey: "voided",
      payment: "Cash",
      completion: "12:08 PM",
      cashier: "Lia Mendoza",
      total: 20000,
      tenders: [{ label: "Cash", cents: 20000 }],
      cashReceived: 50000,
      originalRecord: true,
      lines: [{ name: "2 × Cold brew", cents: 20000 }],
      voidReason: "Void reason: Duplicate order"
    },
    {
      id: "change-outstanding",
      label: "Outstanding handover",
      order: 21,
      status: "Completed",
      statusKey: "completed",
      payment: "Cash",
      completion: "12:19 PM",
      cashier: "Mika Santos",
      total: 35000,
      tenders: [{ label: "Cash", cents: 35000 }],
      cashReceived: 50000,
      lines: [{ name: "2 × Caramel latte", cents: 28000 }, { name: "1 × Croissant", cents: 7000 }],
      change: { state: "owed", cents: 15000 }
    }
  ];

  function escapeText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatMoney(cents) {
    return money.format(cents / 100);
  }

  function cashPortion(order) {
    const cash = order.tenders.find((tender) => tender.label === "Cash");
    return cash ? cash.cents : null;
  }

  function unavailable(label) {
    return `<span class="staff-order-unavailable" aria-label="${label}">—</span>`;
  }

  function renderFactValue(order, kind) {
    if (kind === "received") {
      return order.cashReceived === null
        ? unavailable("Cash received not recorded")
        : `<strong class="staff-order-fact-value">${formatMoney(order.cashReceived)}</strong>`;
    }

    const cash = cashPortion(order);
    if (order.cashReceived === null || cash === null) {
      return unavailable("Expected change not available");
    }

    const expected = order.cashReceived - cash;
    const recordedNote = expected < 0
      ? `<span class="staff-order-recorded-note">Recorded as-is</span>`
      : "";

    return `<span class="staff-order-fact-value-group"><strong class="staff-order-fact-value">${formatMoney(expected)}</strong>${recordedNote}</span>`;
  }

  function renderCard(order, instance) {
    const tenderRows = order.tenders.length
      ? order.tenders.map((tender) => `
          <div class="staff-order-payment-row">
            <span>${escapeText(tender.label)}</span>
            <strong>${formatMoney(tender.cents)}</strong>
          </div>`).join("")
      : `<div class="staff-order-payment-row"><span>No recorded payment</span></div>`;

    const context = order.originalRecord
      ? `<p class="staff-order-payment-context" id="original-context-${instance}">Original payment record</p>`
      : "";
    const contextAttribute = order.originalRecord ? ` aria-describedby="original-context-${instance} payment-note-${instance}"` : ` aria-describedby="payment-note-${instance}"`;

    const lines = order.lines.map((line) => `
      <li class="staff-order-line">
        <span>${escapeText(line.name)}</span>
        <span>${formatMoney(line.cents)}</span>
      </li>`).join("");

    let changeBlock = "";
    if (order.change) {
      const isGiven = order.change.state === "given";
      changeBlock = `
        <div class="staff-order-change is-${order.change.state}">
          <div class="staff-order-change-copy">
            <span class="staff-order-change-label">${isGiven ? "Change handed over" : "Change owed"}</span>
            ${isGiven ? `<span class="staff-order-change-time">${escapeText(order.change.time)}</span>` : ""}
          </div>
          <strong class="staff-order-change-amount">${formatMoney(order.change.cents)}</strong>
          ${isGiven ? "" : `<button type="button">Confirm change handed over</button>`}
        </div>`;
    }

    return `
      <li class="staff-order-card is-${order.statusKey}" data-od-id="staff-order-card-${order.id}-${instance}">
        <article aria-labelledby="order-title-${instance}">
          <header class="staff-order-card-head">
            <div class="staff-order-title-row">
              <h3 id="order-title-${instance}">Order #${order.order} · Walk-in</h3>
              <span class="staff-order-status" data-status="${order.statusKey}">${order.status}</span>
            </div>
            <dl class="staff-order-meta">
              <div><dt>Payment</dt><dd>${escapeText(order.payment)}</dd></div>
              <div><dt>Completion</dt><dd>${escapeText(order.completion)}</dd></div>
              <div><dt>Cashier</dt><dd>${escapeText(order.cashier)}</dd></div>
              <div><dt>Total</dt><dd class="staff-order-total">${formatMoney(order.total)}</dd></div>
            </dl>
          </header>
          <div class="staff-order-payment"${order.tenderAria ? ` aria-label="${order.tenderAria}"` : ""}>
            ${tenderRows}
            <div class="staff-order-payment-facts"${contextAttribute}>
              ${context}
              <div class="staff-order-fact-row">
                <span>Cash received</span>
                ${renderFactValue(order, "received")}
              </div>
              <div class="staff-order-fact-row">
                <span>Expected change</span>
                ${renderFactValue(order, "expected")}
              </div>
              <p class="staff-order-payment-note" id="payment-note-${instance}">Expected change uses the Cash row only. Online payment and cash tips are not included.</p>
            </div>
          </div>
          <ul class="staff-order-lines" aria-label="Order lines">${lines}</ul>
          ${changeBlock}
          ${order.voidReason ? `<p class="staff-order-void-reason">${escapeText(order.voidReason)}</p>` : ""}
        </article>
      </li>`;
  }

  const optionContainer = document.getElementById("state-options");
  const desktopCard = document.getElementById("desktop-card");
  const mobileCard = document.getElementById("mobile-card");

  function selectState(id) {
    const order = states.find((state) => state.id === id) || states[0];
    desktopCard.innerHTML = renderCard(order, `desktop-${order.id}`);
    mobileCard.innerHTML = renderCard(order, `mobile-${order.id}`);

    optionContainer.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.state === order.id));
    });
  }

  states.forEach((state, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.state = state.id;
    button.textContent = state.label;
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => selectState(state.id));
    optionContainer.appendChild(button);
  });

  selectState(states[0].id);
}());
