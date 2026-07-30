(() => {
  "use strict";

  const LEVELS = [
    "Empty",
    "Low",
    "Quarter",
    "One-third",
    "Half",
    "Two-thirds",
    "Three-quarters",
    "Full"
  ];

  const STAFF = [
    { id: "maya", name: "Maya Robles", active: true },
    { id: "dan", name: "Dan Uy", active: true },
    { id: "ces", name: "Ces Navarro", active: true },
    { id: "ryo", name: "Ryo Tan", active: true }
  ];

  const ITEMS = [
    {
      id: "cups-16",
      name: "Coffee/Non-Coffee Cup",
      size: "16oz",
      unit: "pcs",
      mode: "quantity",
      critical: true,
      par: { normal: 240, peak: 360 },
      low: 120,
      urgent: 48
    },
    {
      id: "chocolate",
      name: "Chocolate syrup",
      size: "",
      unit: "bottle",
      mode: "level",
      critical: false
    },
    {
      id: "lids-dome",
      name: "Dome lids",
      size: "16oz",
      unit: "pcs",
      mode: "quantity",
      critical: true,
      par: { normal: 200, peak: 300 },
      low: 100,
      urgent: 40
    },
    {
      id: "espresso",
      name: "Espresso beans",
      size: "1kg bag",
      unit: "kg",
      mode: "quantity",
      critical: true,
      par: { normal: 12, peak: 18 },
      low: 5,
      urgent: 2
    },
    {
      id: "napkins",
      name: "Napkins",
      size: "",
      unit: "pack",
      mode: "quantity",
      critical: false,
      par: { normal: null, peak: null },
      low: null,
      urgent: null
    },
    {
      id: "oat-milk",
      name: "Oat milk",
      size: "1L",
      unit: "carton",
      mode: "quantity",
      critical: false,
      par: { normal: 14, peak: 22 },
      low: 7,
      urgent: 3
    },
    {
      id: "straws",
      name: "Paper straws",
      size: "",
      unit: "pack",
      mode: "quantity",
      critical: false,
      par: { normal: 6, peak: 10 },
      low: 3,
      urgent: 1
    },
    {
      id: "vanilla",
      name: "Vanilla syrup",
      size: "",
      unit: "bottle",
      mode: "level",
      critical: false
    },
    {
      id: "whole-milk",
      name: "Whole milk",
      size: "",
      unit: "L",
      mode: "level",
      critical: true
    }
  ];

  const NAV = [
    { id: "opening", label: "Opening" },
    { id: "closing", label: "Closing" },
    { id: "restock", label: "Restock" },
    { id: "movements", label: "Deliveries & Wastage" }
  ];

  const state = {
    screen: "opening",
    dayOpen: true,
    dayType: "normal",
    hideCritical: false,
    inactiveStaffId: null,
    pending: null,
    countError: { opening: "", closing: "" },
    movementError: "",
    movementNotice: "",
    selectedCountType: "opening",
    timestampIndex: 0,
    drafting: {
      opening: true,
      closing: true
    },
    drafts: {
      opening: { submittedBy: "", shiftLead: "", values: {} },
      closing: { submittedBy: "", shiftLead: "", values: {} }
    },
    submissions: {
      opening: [],
      closing: []
    },
    movementDraft: {
      itemId: "",
      type: "Delivery",
      quantity: "",
      recordedBy: "",
      reason: ""
    },
    movements: []
  };

  const root = document.querySelector("#app");

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function itemById(id) {
    return ITEMS.find((item) => item.id === id);
  }

  function staffById(id) {
    return STAFF.find((person) => person.id === id);
  }

  function activeStaff() {
    return STAFF.filter((person) => person.active && person.id !== state.inactiveStaffId);
  }

  function itemMeta(item) {
    return [item.size, item.unit].filter(Boolean).join(" · ");
  }

  function itemSelectLabel(item) {
    return item.size ? `${item.name} · ${item.size}` : item.name;
  }

  function sortedItems(type) {
    if (type === "opening") {
      if (state.hideCritical) return [];
      return ITEMS
        .filter((item) => item.critical)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...ITEMS].sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function latestSubmission(type) {
    const list = state.submissions[type];
    return list.length ? list[list.length - 1] : null;
  }

  function nextTimestamp(kind) {
    const times = kind === "movement"
      ? ["10:42 AM", "10:18 AM", "9:51 AM", "9:22 AM"]
      : ["8:07 AM", "8:14 AM", "5:36 PM", "5:44 PM"];
    const time = times[state.timestampIndex % times.length];
    state.timestampIndex += 1;
    return `Thu, Jul 23 2026, ${time}`;
  }

  function headerContext() {
    if (state.screen === "restock") {
      return state.selectedCountType === "closing" ? "Closing count" : "Opening count";
    }
    return state.dayType === "peak" ? "Peak day" : "Normal day";
  }

  function renderHeader() {
    return `
      <header class="staff-header" data-od-id="staff-workspace-header">
        <div class="header-inner">
          <div class="brand-block">
            <div class="brand-line">
              <span class="brand-name">UCM Coffee Studio</span>
              <span class="staff-tag">Staff</span>
            </div>
            <span class="signed-in">Signed in: Maya Robles</span>
          </div>
          <nav class="staff-nav" aria-label="Staff workspace">
            <ul>
              ${NAV.map((item) => `
                <li>
                  <a
                    class="nav-link"
                    href="#${item.id}"
                    data-nav="${item.id}"
                    ${state.screen === item.id ? 'aria-current="page"' : ""}
                  >${escapeHtml(item.label)}</a>
                </li>
              `).join("")}
            </ul>
          </nav>
          <div class="header-context" aria-label="Business day context">
            <span class="context-chip">Thu, Jul 23 2026</span>
            <span class="context-chip">${headerContext()}</span>
          </div>
        </div>
      </header>
    `;
  }

  function renderHeading(title, subtitle) {
    return `
      <div class="page-heading">
        <h1 id="screen-title" data-od-id="${state.screen}-heading">${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    `;
  }

  function renderStaffSelects(type, disabled) {
    const draft = state.drafts[type];
    const people = activeStaff();
    return `
      <div class="staff-fields">
        <div class="field">
          <label for="${type}-submitted-by">Submitted by <span class="required" aria-hidden="true">*</span></label>
          <select id="${type}-submitted-by" data-count-type="${type}" data-count-field="submittedBy" ${disabled ? "disabled" : ""} required>
            <option value="">Select staff member</option>
            ${people.map((person) => `
              <option value="${person.id}" ${draft.submittedBy === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>
            `).join("")}
            ${draft.submittedBy && !people.some((person) => person.id === draft.submittedBy) ? `
              <option value="${draft.submittedBy}" selected>${escapeHtml(staffById(draft.submittedBy)?.name || "Inactive staff member")}</option>
            ` : ""}
          </select>
        </div>
        <div class="field">
          <label for="${type}-shift-lead">Shift lead <span class="helper">(optional)</span></label>
          <select id="${type}-shift-lead" data-count-type="${type}" data-count-field="shiftLead" ${disabled ? "disabled" : ""}>
            <option value="">—</option>
            ${people.map((person) => `
              <option value="${person.id}" ${draft.shiftLead === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>
            `).join("")}
          </select>
        </div>
      </div>
    `;
  }

  function renderLevelSelector(type, item, selectedValue) {
    const groupName = `${type}-${item.id}`;
    return `
      <fieldset class="level-fieldset">
        <legend class="visually-hidden">${escapeHtml(item.name)} level</legend>
        <div class="level-options">
          ${LEVELS.map((level) => {
            const id = `${groupName}-${level.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
            return `
              <div class="level-option">
                <input
                  id="${id}"
                  type="radio"
                  name="${groupName}"
                  value="${escapeHtml(level)}"
                  data-level-type="${type}"
                  data-item-id="${item.id}"
                  ${selectedValue === level ? "checked" : ""}
                >
                <label for="${id}">${escapeHtml(level)}</label>
              </div>
            `;
          }).join("")}
        </div>
      </fieldset>
    `;
  }

  function renderCountInput(type, item, value) {
    if (item.mode === "level") {
      return renderLevelSelector(type, item, value);
    }
    return `
      <div class="quantity-wrap field">
        <label class="visually-hidden" for="${type}-${item.id}">${escapeHtml(item.name)} counted quantity</label>
        <input
          class="quantity-input"
          id="${type}-${item.id}"
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          placeholder="Enter count"
          data-quantity-type="${type}"
          data-item-id="${item.id}"
          value="${escapeHtml(value ?? "")}"
        >
      </div>
    `;
  }

  function renderReadOnlyValue(item, submission) {
    const entry = submission.entries[item.id];
    if (!entry) {
      return `<div class="readonly-value not-counted">Not counted</div>`;
    }
    const value = item.mode === "level" ? entry.value : `${entry.value} ${item.unit}`;
    return `<div class="readonly-value">${escapeHtml(value)}</div>`;
  }

  function renderCountRows(type, submission) {
    const draft = state.drafts[type];
    return `
      <div class="count-list">
        ${sortedItems(type).map((item) => `
          <div class="count-row" data-od-id="${type}-item-${item.id}">
            <div>
              <div class="item-name">
                <span>${escapeHtml(item.name)}</span>
                ${type === "closing" && item.critical ? '<span class="critical-badge">Critical</span>' : ""}
              </div>
              <div class="item-meta">${escapeHtml(itemMeta(item))}</div>
            </div>
            ${submission
              ? renderReadOnlyValue(item, submission)
              : renderCountInput(type, item, draft.values[item.id])}
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderCountScreen(type) {
    const opening = type === "opening";
    const title = opening ? "Opening count" : "Closing count";
    const subtitle = opening ? "Short sheet — critical items." : "Full sheet — every active item.";
    const submission = state.drafting[type] ? null : latestSubmission(type);
    const items = sortedItems(type);
    const isPending = state.pending === type;
    const error = state.countError[type];

    return `
      <section class="screen" aria-labelledby="screen-title" data-od-id="${type}-count-screen">
        ${renderHeading(title, subtitle)}
        ${!state.dayOpen ? renderBlockingState() : `
          ${items.length === 0 ? `
            <div class="empty-state"><p>No active Critical items.</p></div>
          ` : `
            <form class="panel form-panel" data-count-form="${type}" novalidate>
              ${submission ? `
                <div class="submitted-banner" role="status">
                  <div>
                    <strong>Count submitted</strong>
                    <span>Submitted at ${escapeHtml(submission.submittedAt)} by ${escapeHtml(staffById(submission.submittedBy)?.name || "Staff member")}</span>
                  </div>
                </div>
              ` : ""}
              ${renderStaffSelects(type, Boolean(submission))}
              ${renderCountRows(type, submission)}
              <div class="form-actions">
                ${submission ? `
                  <button class="button button-secondary" type="button" data-action="another-count" data-count-type="${type}">
                    Record another ${type} count
                  </button>
                ` : `
                  <button
                    class="button button-primary"
                    type="submit"
                    data-count-type="${type}"
                    ${isPending ? "disabled" : ""}
                  >${isPending ? "Submitting..." : `Submit ${type} count`}</button>
                `}
              </div>
              <div class="message message-error" role="alert" aria-live="polite" ${error ? "" : "hidden"}>${escapeHtml(error)}</div>
            </form>
          `}
        `}
        ${renderReviewPanel(type)}
      </section>
    `;
  }

  function renderBlockingState() {
    return `
      <div class="blocking-state" role="status" data-od-id="no-open-day-state">
        <p>No business day is open.</p>
      </div>
    `;
  }

  function statusFor(item, value) {
    if (item.mode === "level") {
      if (["Empty", "Low"].includes(value)) return "Urgent";
      if (["Quarter", "One-third"].includes(value)) return "Low";
      if (["Half", "Two-thirds"].includes(value)) return "Below par";
      return "Enough";
    }

    const count = Number(value);
    const par = item.par?.[state.dayType];
    if (item.urgent !== null && item.urgent !== undefined && count <= item.urgent) return "Urgent";
    if (item.low !== null && item.low !== undefined && count <= item.low) return "Low";
    if (par !== null && par !== undefined && count < par) return "Below par";
    return "Enough";
  }

  function restockRows(submission) {
    if (!submission) return [];
    const rank = { "Urgent": 0, "Low": 1, "Below par": 2, "Enough": 3 };
    return Object.entries(submission.entries)
      .map(([itemId, entry]) => {
        const item = itemById(itemId);
        return { item, entry, status: statusFor(item, entry.value) };
      })
      .sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        if (a.item.critical !== b.item.critical) return a.item.critical ? -1 : 1;
        return a.item.name.localeCompare(b.item.name);
      });
  }

  function restockStatusClass(status) {
    return status.toLowerCase().replaceAll(" ", "-");
  }

  function renderRestockScreen() {
    const available = ["opening", "closing"].filter((type) => latestSubmission(type));
    if (available.length && !available.includes(state.selectedCountType)) {
      state.selectedCountType = available[available.length - 1];
    }
    const selected = latestSubmission(state.selectedCountType);
    const rows = restockRows(selected);
    return `
      <section class="screen" aria-labelledby="screen-title" data-od-id="restock-status-screen">
        ${renderHeading("Restock status", "Counts vs par for the day. Restock the top of the list first.")}
        ${!state.dayOpen ? renderBlockingState() : `
          ${available.length ? `
            <div class="restock-controls">
              <div class="field">
                <label for="count-in-use">Count in use</label>
                <select id="count-in-use" data-restock-count>
                  ${available.map((type) => `
                    <option value="${type}" ${state.selectedCountType === type ? "selected" : ""}>
                      ${type === "opening" ? "Opening count" : "Closing count"}
                    </option>
                  `).join("")}
                </select>
              </div>
            </div>
          ` : ""}
          ${!selected ? `
            <div class="empty-state"><p>No count has been submitted for this day yet.</p></div>
          ` : `
            <div class="table-wrap">
              <table>
                <caption>Using ${state.selectedCountType} count submitted at ${escapeHtml(selected.submittedAt)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Counted</th>
                    <th scope="col">Par</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(({ item, entry, status }) => {
                    const par = item.mode === "level" ? "—" : item.par?.[state.dayType];
                    return `
                      <tr>
                        <td>
                          <div class="item-name">${escapeHtml(item.name)}</div>
                          <div class="item-meta">${escapeHtml(itemMeta(item))}${item.critical ? " · Critical" : ""}</div>
                        </td>
                        <td class="${item.mode === "quantity" ? "number-cell" : ""}">
                          ${item.mode === "level"
                            ? `<span class="counted-level"><strong>${escapeHtml(entry.value)}</strong><small>Level</small></span>`
                            : `${escapeHtml(entry.value)} ${escapeHtml(item.unit)}`}
                        </td>
                        <td class="number-cell">${par === null || par === undefined ? "—" : escapeHtml(par)}</td>
                        <td><span class="status-badge status-${restockStatusClass(status)}">${escapeHtml(status)}</span></td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
            <p class="table-scroll-hint">Swipe table sideways to compare all columns.</p>
          `}
        `}
        ${renderReviewPanel("restock")}
      </section>
    `;
  }

  function renderMovementForm() {
    const draft = state.movementDraft;
    return `
      <div class="panel form-panel">
        <p class="permanence-warning">Each entry is permanent. Check the item, type, and quantity before recording.</p>
        <form id="movement-form" novalidate>
          <div class="movement-form">
            <div class="field">
              <label for="movement-item">Item <span class="required" aria-hidden="true">*</span></label>
              <select id="movement-item" data-movement-field="itemId" required>
                <option value="">Select item</option>
                ${[...ITEMS].sort((a, b) => a.name.localeCompare(b.name)).map((item) => `
                  <option value="${item.id}" ${draft.itemId === item.id ? "selected" : ""}>${escapeHtml(itemSelectLabel(item))}</option>
                `).join("")}
              </select>
            </div>
            <fieldset class="type-fieldset">
              <legend class="field-label">Type <span class="required" aria-hidden="true">*</span></legend>
              <div class="type-options">
                ${["Delivery", "Wastage"].map((type) => `
                  <div class="type-option">
                    <input id="movement-${type.toLowerCase()}" type="radio" name="movement-type" value="${type}" data-movement-type ${draft.type === type ? "checked" : ""}>
                    <label for="movement-${type.toLowerCase()}">${type}</label>
                  </div>
                `).join("")}
              </div>
            </fieldset>
            <div class="field">
              <label for="movement-quantity">Quantity <span class="required" aria-hidden="true">*</span></label>
              <input id="movement-quantity" type="number" inputmode="numeric" min="0" step="1" placeholder="Whole units" data-movement-field="quantity" value="${escapeHtml(draft.quantity)}" required>
            </div>
            <div class="field recorded-field">
              <label for="movement-recorder">Recorded by <span class="helper">(optional)</span></label>
              <select id="movement-recorder" data-movement-field="recordedBy">
                <option value="">—</option>
                ${activeStaff().map((person) => `
                  <option value="${person.id}" ${draft.recordedBy === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>
                `).join("")}
              </select>
            </div>
            <div class="field reason-field">
              <label for="movement-reason">Reason <span class="helper">(optional)</span></label>
              <input id="movement-reason" type="text" maxlength="120" placeholder="e.g. AM delivery, dropped tray" data-movement-field="reason" value="${escapeHtml(draft.reason)}">
            </div>
          </div>
          <div class="form-actions">
            <button class="button button-primary" type="submit">Record movement</button>
          </div>
          <div class="message message-error" role="alert" aria-live="polite" ${state.movementError ? "" : "hidden"}>${escapeHtml(state.movementError)}</div>
          <div class="message message-success" role="status" aria-live="polite" ${state.movementNotice ? "" : "hidden"}>${escapeHtml(state.movementNotice)}</div>
        </form>
      </div>
    `;
  }

  function renderMovementTable() {
    if (!state.movements.length) {
      return `<div class="empty-state"><p>No movements recorded today.</p></div>`;
    }
    return `
      <div class="table-wrap">
        <table>
          <caption>Movements recorded on Thu, Jul 23 2026, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col">Quantity</th>
              <th scope="col">Reason</th>
              <th scope="col">Who</th>
            </tr>
          </thead>
          <tbody>
            ${state.movements.map((entry) => `
              <tr>
                <td>
                  <div class="item-name">${escapeHtml(itemById(entry.itemId).name)}</div>
                  <div class="item-meta">${escapeHtml(itemMeta(itemById(entry.itemId)))}</div>
                </td>
                <td>${escapeHtml(entry.type)}</td>
                <td class="number-cell">${escapeHtml(entry.quantity)}</td>
                <td>${entry.reason ? escapeHtml(entry.reason) : "—"}</td>
                <td>${entry.recordedBy ? escapeHtml(staffById(entry.recordedBy)?.name || "—") : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <p class="table-scroll-hint">Swipe table sideways to review every field.</p>
    `;
  }

  function renderMovementsScreen() {
    return `
      <section class="screen" aria-labelledby="screen-title" data-od-id="deliveries-wastage-screen">
        ${renderHeading("Deliveries & wastage", "Adjust stock between counts. Each entry is permanent.")}
        ${!state.dayOpen ? renderBlockingState() : `
          ${renderMovementForm()}
          <section class="table-section" aria-labelledby="today-movements">
            <h2 id="today-movements">Today’s entries</h2>
            <div aria-live="polite">${renderMovementTable()}</div>
          </section>
        `}
        ${renderReviewPanel("movements")}
      </section>
    `;
  }

  function reviewButton(label, action, value = "") {
    return `<button class="review-button" type="button" data-review="${action}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
  }

  function renderReviewPanel(type) {
    let controls = [
      reviewButton(state.dayOpen ? "No open day" : "Restore open day", "toggle-day-open"),
      reviewButton("Normal day", "day-type", "normal"),
      reviewButton("Peak day", "day-type", "peak")
    ];

    if (type === "opening" || type === "closing") {
      controls = controls.concat([
        reviewButton("Blank sheet", "blank-count", type),
        reviewButton("Submitted sheet", "submitted-count", type),
        reviewButton("Level unset", "level-unset", type),
        reviewButton("Level set", "level-set", type),
        reviewButton("Block: no submitter", "count-error", `${type}:no-staff`),
        reviewButton("Block: every item blank", "count-error", `${type}:blank`),
        reviewButton("Block: inactive staff", "count-error", `${type}:inactive`),
        reviewButton("Block: invalid quantity", "count-error", `${type}:invalid`)
      ]);
      if (type === "opening") controls.push(reviewButton("No Critical items", "no-critical"));
    }

    if (type === "restock") {
      controls = controls.concat([
        reviewButton("Restock empty", "restock-empty"),
        reviewButton("All four statuses", "restock-populated")
      ]);
    }

    if (type === "movements") {
      controls = controls.concat([
        reviewButton("Movements empty", "movements-empty"),
        reviewButton("Several entries", "movements-populated"),
        reviewButton("Block: negative", "movement-invalid", "negative"),
        reviewButton("Block: decimal", "movement-invalid", "decimal")
      ]);
    }

    return `
      <aside class="review-panel" aria-labelledby="review-title">
        <h2 class="review-heading" id="review-title">Review states <span class="mockup-label">Mockup only</span></h2>
        <div class="review-actions">${controls.join("")}</div>
        <p class="review-note">These controls change fictional in-memory state and are not part of the production workspace.</p>
      </aside>
    `;
  }

  function renderScreen() {
    if (state.screen === "opening") return renderCountScreen("opening");
    if (state.screen === "closing") return renderCountScreen("closing");
    if (state.screen === "restock") return renderRestockScreen();
    return renderMovementsScreen();
  }

  function render() {
    root.innerHTML = `
      <div class="app-shell">
        ${renderHeader()}
        <main class="workspace" id="main-content" tabindex="-1">
          ${renderScreen()}
        </main>
      </div>
    `;
  }

  function resetDraft(type) {
    state.drafts[type] = { submittedBy: "", shiftLead: "", values: {} };
    state.countError[type] = "";
    state.inactiveStaffId = null;
  }

  function validateCount(type) {
    const draft = state.drafts[type];
    if (!state.dayOpen) {
      return "No count was recorded. No business day is open. Open a business day and try again.";
    }
    if (!draft.submittedBy) {
      return "No count was recorded. Select a submitting staff member and try again.";
    }
    const person = staffById(draft.submittedBy);
    if (!person || !person.active || state.inactiveStaffId === draft.submittedBy) {
      return "No count was recorded. The selected staff member is no longer active. Select an active staff member and try again.";
    }
    const entries = Object.entries(draft.values).filter(([, value]) => value !== "" && value !== undefined && value !== null);
    if (!entries.length) {
      return "No count was recorded. Every item is blank. Count at least one item and try again.";
    }
    for (const [itemId, value] of entries) {
      const item = itemById(itemId);
      if (item.mode === "quantity" && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
        return "No count was recorded. A quantity is negative or not a whole number. Enter a whole number at or above zero and try again.";
      }
    }
    return "";
  }

  function submitCount(type) {
    if (state.pending) return;
    const error = validateCount(type);
    state.countError[type] = error;
    if (error) {
      render();
      return;
    }

    state.pending = type;
    render();
    window.setTimeout(() => {
      const draft = state.drafts[type];
      const entries = {};
      Object.entries(draft.values).forEach(([itemId, value]) => {
        if (value === "" || value === undefined || value === null) return;
        entries[itemId] = {
          value: itemById(itemId).mode === "quantity" ? Number(value) : value
        };
      });
      state.submissions[type].push({
        id: `${type}-${state.submissions[type].length + 1}`,
        submittedAt: nextTimestamp("count"),
        submittedBy: draft.submittedBy,
        shiftLead: draft.shiftLead,
        entries
      });
      state.selectedCountType = type;
      state.drafting[type] = false;
      state.pending = null;
      state.countError[type] = "";
      render();
    }, 650);
  }

  function validateMovement() {
    const draft = state.movementDraft;
    if (!state.dayOpen) {
      return "No movement was recorded. No business day is open. Open a business day and try again.";
    }
    if (!draft.itemId) {
      return "No movement was recorded. Select an item and try again.";
    }
    if (draft.quantity === "") {
      return "No movement was recorded. Enter a quantity and try again.";
    }
    if (!Number.isInteger(Number(draft.quantity)) || Number(draft.quantity) < 0) {
      return "No movement was recorded. Quantity must be a whole number at or above zero. Check the quantity and try again.";
    }
    return "";
  }

  function recordMovement() {
    const error = validateMovement();
    state.movementError = error;
    state.movementNotice = "";
    if (error) {
      render();
      return;
    }
    const draft = state.movementDraft;
    state.movements.unshift({
      itemId: draft.itemId,
      type: draft.type,
      quantity: Number(draft.quantity),
      recordedBy: draft.recordedBy,
      reason: draft.reason.trim(),
      recordedAt: nextTimestamp("movement")
    });
    state.movementDraft = {
      itemId: "",
      type: "Delivery",
      quantity: "",
      recordedBy: "",
      reason: ""
    };
    state.movementError = "";
    state.movementNotice = "Movement recorded. The form is ready for another entry.";
    render();
  }

  function seedSubmittedCount(type) {
    resetDraft(type);
    state.drafts[type].submittedBy = "maya";
    const entries = type === "opening"
      ? {
          espresso: { value: 4 },
          "cups-16": { value: 0 },
          "whole-milk": { value: "Half" }
        }
      : {
          espresso: { value: 7 },
          "cups-16": { value: 170 },
          "lids-dome": { value: 180 },
          "whole-milk": { value: "Three-quarters" },
          chocolate: { value: "Half" },
          napkins: { value: 2 },
          straws: { value: 5 }
        };
    state.submissions[type] = [{
      id: `${type}-review`,
      submittedAt: type === "opening" ? "Thu, Jul 23 2026, 8:07 AM" : "Thu, Jul 23 2026, 5:36 PM",
      submittedBy: "maya",
      shiftLead: "",
      entries
    }];
    state.drafting[type] = false;
    state.selectedCountType = type;
    state.hideCritical = false;
  }

  function seedRestock() {
    state.dayType = "normal";
    state.submissions.opening = [{
      id: "opening-restock-review",
      submittedAt: "Thu, Jul 23 2026, 8:07 AM",
      submittedBy: "maya",
      shiftLead: "dan",
      entries: {
        espresso: { value: 4 },
        "cups-16": { value: 80 },
        "whole-milk": { value: "Quarter" }
      }
    }];
    state.submissions.closing = [{
      id: "closing-restock-review",
      submittedAt: "Thu, Jul 23 2026, 5:36 PM",
      submittedBy: "ces",
      shiftLead: "",
      entries: {
        espresso: { value: 1 },
        "cups-16": { value: 80 },
        "lids-dome": { value: 160 },
        "whole-milk": { value: "Full" },
        chocolate: { value: "Half" },
        napkins: { value: 2 }
      }
    }];
    state.drafting.opening = false;
    state.drafting.closing = false;
    state.selectedCountType = "closing";
  }

  function seedMovements() {
    state.movements = [
      {
        itemId: "cups-16",
        type: "Wastage",
        quantity: 6,
        reason: "Dropped sleeve",
        recordedBy: "ces",
        recordedAt: "Thu, Jul 23 2026, 10:42 AM"
      },
      {
        itemId: "whole-milk",
        type: "Delivery",
        quantity: 12,
        reason: "",
        recordedBy: "",
        recordedAt: "Thu, Jul 23 2026, 10:18 AM"
      },
      {
        itemId: "espresso",
        type: "Delivery",
        quantity: 8,
        reason: "AM supplier drop",
        recordedBy: "maya",
        recordedAt: "Thu, Jul 23 2026, 9:51 AM"
      }
    ];
    state.movementError = "";
    state.movementNotice = "";
  }

  function applyCountError(value) {
    const [type, scenario] = value.split(":");
    resetDraft(type);
    state.submissions[type] = [];
    state.hideCritical = false;
    if (scenario === "no-staff") {
      state.countError[type] = "No count was recorded. Select a submitting staff member and try again.";
    }
    if (scenario === "blank") {
      state.drafts[type].submittedBy = "maya";
      state.countError[type] = "No count was recorded. Every item is blank. Count at least one item and try again.";
    }
    if (scenario === "inactive") {
      state.drafts[type].submittedBy = "ryo";
      state.inactiveStaffId = "ryo";
      state.countError[type] = "No count was recorded. The selected staff member is no longer active. Select an active staff member and try again.";
    }
    if (scenario === "invalid") {
      state.drafts[type].submittedBy = "maya";
      const quantityItem = sortedItems(type).find((item) => item.mode === "quantity");
      state.drafts[type].values[quantityItem.id] = "-1.5";
      state.countError[type] = "No count was recorded. A quantity is negative or not a whole number. Enter a whole number at or above zero and try again.";
    }
  }

  function applyReview(action, value) {
    if (action === "toggle-day-open") {
      state.dayOpen = !state.dayOpen;
    } else if (action === "day-type") {
      state.dayType = value;
    } else if (action === "blank-count") {
      state.submissions[value] = [];
      resetDraft(value);
      state.drafting[value] = true;
      state.hideCritical = false;
    } else if (action === "submitted-count") {
      seedSubmittedCount(value);
    } else if (action === "level-unset") {
      state.submissions[value] = [];
      resetDraft(value);
      state.drafting[value] = true;
      state.drafts[value].submittedBy = "maya";
      state.hideCritical = false;
    } else if (action === "level-set") {
      state.submissions[value] = [];
      resetDraft(value);
      state.drafting[value] = true;
      state.drafts[value].submittedBy = "maya";
      const levelItem = sortedItems(value).find((item) => item.mode === "level");
      state.drafts[value].values[levelItem.id] = "Half";
      state.hideCritical = false;
    } else if (action === "no-critical") {
      state.submissions.opening = [];
      resetDraft("opening");
      state.drafting.opening = true;
      state.hideCritical = true;
    } else if (action === "count-error") {
      applyCountError(value);
    } else if (action === "restock-empty") {
      state.submissions.opening = [];
      state.submissions.closing = [];
      state.drafting.opening = true;
      state.drafting.closing = true;
      state.selectedCountType = "opening";
    } else if (action === "restock-populated") {
      seedRestock();
    } else if (action === "movements-empty") {
      state.movements = [];
      state.movementError = "";
      state.movementNotice = "";
    } else if (action === "movements-populated") {
      seedMovements();
    } else if (action === "movement-invalid") {
      state.movementDraft = {
        itemId: "espresso",
        type: "Delivery",
        quantity: value === "negative" ? "-2" : "1.5",
        recordedBy: "",
        reason: ""
      };
      state.movementNotice = "";
      state.movementError = "No movement was recorded. Quantity must be a whole number at or above zero. Check the quantity and try again.";
    }
    render();
  }

  root.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      state.screen = nav.dataset.nav;
      state.countError.opening = "";
      state.countError.closing = "";
      state.movementError = "";
      render();
      document.querySelector("#main-content")?.focus();
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "another-count") {
        const type = action.dataset.countType;
        resetDraft(type);
        state.drafting[type] = true;
        render();
      }
      return;
    }

    const review = event.target.closest("[data-review]");
    if (review) {
      applyReview(review.dataset.review, review.dataset.value || "");
    }
  });

  root.addEventListener("input", (event) => {
    const quantity = event.target.closest("[data-quantity-type]");
    if (quantity) {
      state.drafts[quantity.dataset.quantityType].values[quantity.dataset.itemId] = quantity.value;
      state.countError[quantity.dataset.quantityType] = "";
    }

    const movementField = event.target.closest("[data-movement-field]");
    if (movementField) {
      state.movementDraft[movementField.dataset.movementField] = movementField.value;
      state.movementError = "";
      state.movementNotice = "";
    }
  });

  root.addEventListener("change", (event) => {
    const countField = event.target.closest("[data-count-field]");
    if (countField) {
      state.drafts[countField.dataset.countType][countField.dataset.countField] = countField.value;
      state.countError[countField.dataset.countType] = "";
    }

    const level = event.target.closest("[data-level-type]");
    if (level) {
      state.drafts[level.dataset.levelType].values[level.dataset.itemId] = level.value;
      state.countError[level.dataset.levelType] = "";
    }

    if (event.target.matches("[data-restock-count]")) {
      state.selectedCountType = event.target.value;
      render();
    }

    if (event.target.matches("[data-movement-type]")) {
      state.movementDraft.type = event.target.value;
      state.movementError = "";
      state.movementNotice = "";
    }
  });

  root.addEventListener("submit", (event) => {
    const countForm = event.target.closest("[data-count-form]");
    if (countForm) {
      event.preventDefault();
      submitCount(countForm.dataset.countForm);
      return;
    }
    if (event.target.id === "movement-form") {
      event.preventDefault();
      recordMovement();
    }
  });

  render();
})();
