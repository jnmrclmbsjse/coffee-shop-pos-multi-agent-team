"use strict";

const state = {
  activeTab: "stock",
  activeDrawer: null,
  editingItemId: null,
  editingCategoryId: null,
  returnFocus: null,
  filtersOpen: false,
  items: [
    {
      id: "pet-cup-16",
      name: "16oz PET Cup",
      categoryId: "cups",
      unit: "pcs",
      size: "16oz",
      method: "Quantity",
      critical: true,
      reconciled: true,
      active: true,
      references: 3,
      referenceLabel: "Iced Latte, Cold Brew, and Matcha Latte sizes",
      normal: { par: 240, low: 80, urgent: 40 },
      peak: { par: 420, low: 140, urgent: 70 }
    },
    {
      id: "flat-lid-16",
      name: "16oz Flat Lid",
      categoryId: "lids",
      unit: "pcs",
      size: "16oz",
      method: "Quantity",
      critical: true,
      reconciled: true,
      active: true,
      references: 3,
      referenceLabel: "Iced Latte, Cold Brew, and Matcha Latte sizes",
      normal: { par: 240, low: 80, urgent: 40 },
      peak: { par: 420, low: 140, urgent: 70 }
    },
    {
      id: "whole-milk",
      name: "Whole Milk",
      categoryId: "dairies",
      unit: "carton",
      size: "1 L",
      method: "Level",
      critical: true,
      reconciled: false,
      active: true,
      references: 0,
      normal: { par: 18, low: 8, urgent: 4 },
      peak: { par: 28, low: 12, urgent: 6 }
    },
    {
      id: "bottled-water",
      name: "Bottled Water",
      categoryId: "water",
      unit: "bottle",
      size: "500 ml",
      method: "Quantity",
      critical: false,
      reconciled: false,
      active: true,
      references: 0,
      normal: { par: 48, low: 18, urgent: 8 },
      peak: { par: 72, low: 24, urgent: 12 }
    },
    {
      id: "ice-cubes",
      name: "Ice Cubes",
      categoryId: "water",
      unit: "bag",
      size: "5 kg",
      method: "Level",
      critical: false,
      reconciled: false,
      active: true,
      references: 0,
      normal: { par: 8, low: 3, urgent: 1 },
      peak: { par: 14, low: 5, urgent: 2 }
    },
    {
      id: "oat-milk",
      name: "Oat Milk Carton",
      categoryId: "dairies",
      unit: "carton",
      size: "1 L",
      method: "Quantity",
      critical: false,
      reconciled: false,
      active: false,
      references: 0,
      normal: { par: 12, low: 5, urgent: 2 },
      peak: { par: 20, low: 8, urgent: 4 }
    }
  ],
  categories: [
    { id: "water", name: "Water & Ice", weight: 10, active: true },
    { id: "cups", name: "Cups", weight: 20, active: true },
    { id: "lids", name: "Lids", weight: 30, active: true },
    { id: "dairies", name: "Dairies", weight: 40, active: true },
    { id: "others", name: "Others", weight: 50, active: false }
  ]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoryById(id) {
  return state.categories.find((category) => category.id === id);
}

function itemCountForCategory(categoryId) {
  return state.items.filter((item) => item.categoryId === categoryId).length;
}

function sortedCategories() {
  return [...state.categories].sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));
}

function statusBadge(label, active, variant = "positive") {
  const className = active ? `badge badge-${variant}` : "badge badge-muted";
  const symbol = active ? "●" : "○";
  return `<span class="${className}"><span class="badge-symbol" aria-hidden="true">${symbol}</span>${escapeHtml(label)}</span>`;
}

function methodBadge(method) {
  const symbol = method === "Quantity" ? "#" : "≈";
  return `<span class="badge"><span class="badge-symbol" aria-hidden="true">${symbol}</span>${escapeHtml(method)}</span>`;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span aria-hidden="true">✓</span><strong>${escapeHtml(message)}</strong>`;
  $("#toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function populateCategoryOptions() {
  const sorted = sortedCategories();
  const filter = $("#category-filter");
  const filterValue = filter.value;
  filter.innerHTML = `<option value="">All categories</option>${sorted.map((category) =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
  ).join("")}`;
  filter.value = state.categories.some((category) => category.id === filterValue) ? filterValue : "";

  const itemCategory = $("#item-category");
  const itemValue = itemCategory.value;
  itemCategory.innerHTML = `<option value="">Select category</option>${sorted.map((category) =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}${category.active ? "" : " (Inactive)"}</option>`
  ).join("")}`;
  itemCategory.value = state.categories.some((category) => category.id === itemValue) ? itemValue : "";
}

function currentFilters() {
  return {
    search: $("#search-items").value.trim().toLowerCase(),
    categoryId: $("#category-filter").value,
    method: $("#method-filter").value,
    reconciled: $("#reconciled-filter").value,
    critical: $("#critical-filter").value,
    active: $("#active-filter").value
  };
}

function filteredItems() {
  const filters = currentFilters();
  return state.items.filter((item) => {
    const searchMatch = !filters.search || item.name.toLowerCase().includes(filters.search);
    const categoryMatch = !filters.categoryId || item.categoryId === filters.categoryId;
    const methodMatch = !filters.method || item.method === filters.method;
    const reconciledMatch = !filters.reconciled || String(item.reconciled) === filters.reconciled;
    const criticalMatch = !filters.critical || String(item.critical) === filters.critical;
    const activeMatch = !filters.active || String(item.active) === filters.active;
    return searchMatch && categoryMatch && methodMatch && reconciledMatch && criticalMatch && activeMatch;
  });
}

function filterDescriptions() {
  const filters = currentFilters();
  const descriptions = [];
  if (filters.search) descriptions.push(`name contains “${$("#search-items").value.trim()}”`);
  if (filters.categoryId) descriptions.push(`category is ${categoryById(filters.categoryId)?.name || "selected"}`);
  if (filters.method) descriptions.push(`method is ${filters.method}`);
  if (filters.reconciled) descriptions.push(filters.reconciled === "true" ? "Reconciled" : "not Reconciled");
  if (filters.critical) descriptions.push(filters.critical === "true" ? "Critical" : "not Critical");
  if (filters.active) descriptions.push(filters.active === "true" ? "Active" : "Inactive");
  return descriptions;
}

function itemTableRow(item) {
  const category = categoryById(item.categoryId);
  return `
    <tr data-item-id="${escapeHtml(item.id)}">
      <td><button class="item-name-button" type="button" data-edit-item="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button></td>
      <td>${escapeHtml(category?.name || "Uncategorized")}</td>
      <td><span class="cell-primary">${escapeHtml(item.unit)}</span>${item.size ? `<span class="cell-secondary">${escapeHtml(item.size)}</span>` : ""}</td>
      <td>${methodBadge(item.method)}</td>
      <td>${statusBadge(item.critical ? "Critical" : "Standard", item.critical, "danger")}</td>
      <td>${statusBadge(item.reconciled ? "Reconciled" : "Not reconciled", item.reconciled)}</td>
      <td>${statusBadge(item.active ? "Active" : "Inactive", item.active)}</td>
      <td class="table-actions"><button class="action-menu-button" type="button" data-edit-item="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}">Edit</button></td>
    </tr>
  `;
}

function itemMobileRecord(item) {
  const category = categoryById(item.categoryId);
  return `
    <article class="mobile-record" data-item-id="${escapeHtml(item.id)}">
      <div class="mobile-record-header">
        <div>
          <button class="item-name-button" type="button" data-edit-item="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>
          <span class="cell-secondary">${escapeHtml(category?.name || "Uncategorized")}</span>
        </div>
        <button class="action-menu-button" type="button" data-edit-item="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}">Edit</button>
      </div>
      <dl class="mobile-record-grid">
        <div class="mobile-record-field"><dt>Unit / size</dt><dd>${escapeHtml(item.unit)}${item.size ? ` · ${escapeHtml(item.size)}` : ""}</dd></div>
        <div class="mobile-record-field"><dt>Count method</dt><dd>${methodBadge(item.method)}</dd></div>
        <div class="mobile-record-field"><dt>Critical</dt><dd>${statusBadge(item.critical ? "Critical" : "Standard", item.critical, "danger")}</dd></div>
        <div class="mobile-record-field"><dt>Reconciled</dt><dd>${statusBadge(item.reconciled ? "Reconciled" : "No", item.reconciled)}</dd></div>
        <div class="mobile-record-field"><dt>Status</dt><dd>${statusBadge(item.active ? "Active" : "Inactive", item.active)}</dd></div>
      </dl>
    </article>
  `;
}

function renderStockItems() {
  const items = filteredItems();
  $("#stock-table-body").innerHTML = items.map(itemTableRow).join("");
  $("#stock-mobile-list").innerHTML = items.map(itemMobileRecord).join("");
  $("#stock-empty-state").hidden = items.length > 0;
  $(".table-scroll", $("#stock-data-surface")).hidden = items.length === 0;
  $("#stock-mobile-list").hidden = items.length === 0;
  $("#result-count").textContent = `${items.length} ${items.length === 1 ? "stock item" : "stock items"}`;
  $("#stock-tab-count").textContent = state.items.length;

  const descriptions = filterDescriptions();
  const hasFilters = descriptions.length > 0;
  $("#clear-filters").disabled = !hasFilters;
  $("#active-filter-summary").hidden = !hasFilters;
  $("#filter-summary-text").textContent = hasFilters
    ? `Showing items where ${descriptions.join(" AND ")}.`
    : "Filters combine with AND logic.";
  $("#filter-active-count").hidden = !hasFilters;
  $("#filter-active-count").textContent = descriptions.length;
}

function categoryTableRow(category, index, categories) {
  const count = itemCountForCategory(category.id);
  return `
    <tr data-category-id="${escapeHtml(category.id)}">
      <td><button class="category-name-button" type="button" data-edit-category="${escapeHtml(category.id)}">${escapeHtml(category.name)}</button></td>
      <td>
        <label class="sr-only" for="weight-${escapeHtml(category.id)}">Sort weight for ${escapeHtml(category.name)}</label>
        <input class="category-weight-input" id="weight-${escapeHtml(category.id)}" type="number" min="0" step="1" value="${category.weight}" data-category-weight="${escapeHtml(category.id)}">
      </td>
      <td>${statusBadge(category.active ? "Active" : "Inactive", category.active)}</td>
      <td><span class="cell-primary">${count}</span><span class="cell-secondary">${count === 1 ? "stock item" : "stock items"}</span></td>
      <td>
        <div class="move-controls">
          <button class="move-button" type="button" data-move-category="${escapeHtml(category.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(category.name)} up">↑</button>
          <button class="move-button" type="button" data-move-category="${escapeHtml(category.id)}" data-direction="1" ${index === categories.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(category.name)} down">↓</button>
        </div>
      </td>
      <td class="table-actions"><button class="action-menu-button" type="button" data-edit-category="${escapeHtml(category.id)}" aria-label="Edit ${escapeHtml(category.name)}">Edit</button></td>
    </tr>
  `;
}

function categoryMobileRecord(category, index, categories) {
  const count = itemCountForCategory(category.id);
  return `
    <article class="mobile-record" data-category-id="${escapeHtml(category.id)}">
      <div class="mobile-record-header">
        <div>
          <button class="category-name-button" type="button" data-edit-category="${escapeHtml(category.id)}">${escapeHtml(category.name)}</button>
          <span class="cell-secondary">${count} ${count === 1 ? "stock item" : "stock items"}</span>
        </div>
        <button class="action-menu-button" type="button" data-edit-category="${escapeHtml(category.id)}">Edit</button>
      </div>
      <dl class="mobile-record-grid">
        <div class="mobile-record-field">
          <dt>Sort weight</dt>
          <dd><input class="category-weight-input" aria-label="Sort weight for ${escapeHtml(category.name)}" type="number" min="0" step="1" value="${category.weight}" data-category-weight="${escapeHtml(category.id)}"></dd>
        </div>
        <div class="mobile-record-field"><dt>Status</dt><dd>${statusBadge(category.active ? "Active" : "Inactive", category.active)}</dd></div>
        <div class="mobile-record-field">
          <dt>Move</dt>
          <dd class="move-controls">
            <button class="move-button" type="button" data-move-category="${escapeHtml(category.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(category.name)} up">↑</button>
            <button class="move-button" type="button" data-move-category="${escapeHtml(category.id)}" data-direction="1" ${index === categories.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(category.name)} down">↓</button>
          </dd>
        </div>
      </dl>
    </article>
  `;
}

function renderCategories(message) {
  const categories = sortedCategories();
  $("#category-table-body").innerHTML = categories.map((category, index) => categoryTableRow(category, index, categories)).join("");
  $("#category-mobile-list").innerHTML = categories.map((category, index) => categoryMobileRecord(category, index, categories)).join("");
  $("#category-tab-count").textContent = state.categories.length;
  populateCategoryOptions();
  if (message) {
    const notice = $("#category-order-message");
    notice.className = "inline-notice notice-success";
    notice.innerHTML = `<span class="notice-symbol" aria-hidden="true">✓</span><div><strong>Category order saved</strong><p>${escapeHtml(message)}</p></div>`;
  }
}

function selectTab(tabName, focus = false) {
  state.activeTab = tabName;
  $$(".tab-button").forEach((button) => {
    const selected = button.dataset.tab === tabName;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  $("#stock-panel").hidden = tabName !== "stock";
  $("#categories-panel").hidden = tabName !== "categories";
}

function clearFilters() {
  $("#search-items").value = "";
  ["#category-filter", "#method-filter", "#reconciled-filter", "#critical-filter", "#active-filter"].forEach((selector) => {
    $(selector).value = "";
  });
  renderStockItems();
  $("#search-items").focus();
}

function openDrawer(type, trigger) {
  closeDrawer(false);
  state.activeDrawer = type;
  state.returnFocus = trigger || document.activeElement;
  const drawer = type === "item" ? $("#item-drawer") : $("#category-drawer");
  $("#drawer-backdrop").hidden = false;
  drawer.removeAttribute("inert");
  drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  document.body.style.overflow = "hidden";
  window.setTimeout(() => $(".drawer-close", drawer).focus(), 50);
}

function closeDrawer(restoreFocus = true) {
  const drawer = state.activeDrawer === "item" ? $("#item-drawer") : state.activeDrawer === "category" ? $("#category-drawer") : null;
  if (!drawer) return;
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  drawer.setAttribute("inert", "");
  $("#drawer-backdrop").hidden = true;
  document.body.style.overflow = "";
  const focusTarget = state.returnFocus;
  state.activeDrawer = null;
  if (restoreFocus && focusTarget && document.contains(focusTarget)) {
    window.setTimeout(() => focusTarget.focus(), 20);
  }
}

function setInputValue(id, value) {
  $(id).value = value ?? "";
}

function clearItemErrors() {
  $$(".field-error", $("#item-drawer")).forEach((element) => {
    element.textContent = "";
  });
  $$("[aria-invalid='true']", $("#item-drawer")).forEach((element) => element.removeAttribute("aria-invalid"));
  $("#item-form-summary").hidden = true;
  $("#item-form-summary-list").innerHTML = "";
  $("#server-rejected-state").hidden = true;
  $("#item-delete-outcome").hidden = true;
  $("#item-delete-outcome").className = "inline-notice";
  $("#delete-item-button").disabled = false;
  $('#item-form button[type="submit"]').disabled = false;
}

function applyReconciledRule() {
  const reconciled = $("#item-reconciled").checked;
  if (reconciled) {
    $("#method-quantity").checked = true;
    $("#method-level").disabled = true;
    $("#count-method-help").textContent = "Reconciled Cup/Lid items must use Quantity. Level is unavailable while Reconciled is on.";
  } else {
    $("#method-level").disabled = false;
    $("#count-method-help").textContent = "Quantity records whole units. Level records an approximate amount.";
  }
}

function openItemEditor(itemId, trigger) {
  clearItemErrors();
  const item = state.items.find((candidate) => candidate.id === itemId);
  state.editingItemId = item?.id || null;
  $("#item-drawer-title").textContent = item ? "Edit stock item" : "Add stock item";
  $("#item-saved-caption").textContent = item ? `Saved item: ${item.name}` : "Create a new configured stock item";
  setInputValue("#item-name", item?.name || "");
  setInputValue("#item-category", item?.categoryId || "");
  setInputValue("#item-unit", item?.unit || "pcs");
  setInputValue("#item-size", item?.size || "");
  $("#method-quantity").checked = !item || item.method === "Quantity";
  $("#method-level").checked = item?.method === "Level";
  $("#item-critical").checked = item?.critical || false;
  $("#item-reconciled").checked = item?.reconciled || false;
  $("#item-active").checked = item ? item.active : true;
  setInputValue("#normal-par", item?.normal.par ?? 0);
  setInputValue("#normal-low", item?.normal.low ?? "");
  setInputValue("#normal-urgent", item?.normal.urgent ?? "");
  setInputValue("#peak-par", item?.peak.par ?? 0);
  setInputValue("#peak-low", item?.peak.low ?? "");
  setInputValue("#peak-urgent", item?.peak.urgent ?? "");
  $("#delete-item-button").hidden = !item;
  applyReconciledRule();
  openDrawer("item", trigger);
}

function numericFieldValue(id) {
  const value = $(id).value.trim();
  return value === "" ? null : Number(value);
}

function setFieldError(id, message) {
  const input = $(id);
  input.setAttribute("aria-invalid", "true");
  $(`${id}-error`).textContent = message;
}

function validateParGroup(prefix, label) {
  const errors = [];
  const par = numericFieldValue(`#${prefix}-par`);
  const low = numericFieldValue(`#${prefix}-low`);
  const urgent = numericFieldValue(`#${prefix}-urgent`);

  const validateWholeNonNegative = (value, field, fieldLabel, required = false) => {
    if (value === null) {
      if (required) {
        setFieldError(`#${prefix}-${field}`, `${fieldLabel} is required.`);
        errors.push(`${label} ${fieldLabel} is required`);
      }
      return false;
    }
    if (!Number.isInteger(value) || value < 0) {
      setFieldError(`#${prefix}-${field}`, "Enter a non-negative whole number. Zero is valid.");
      errors.push(`${label} ${fieldLabel} must be a non-negative whole number`);
      return false;
    }
    return true;
  };

  const validPar = validateWholeNonNegative(par, "par", "Par", true);
  const validLow = low === null || validateWholeNonNegative(low, "low", "Low");
  const validUrgent = urgent === null || validateWholeNonNegative(urgent, "urgent", "Urgent");

  if (urgent !== null && low === null && validUrgent) {
    setFieldError(`#${prefix}-urgent`, "Enter Low before adding Urgent.");
    errors.push(`${label} Urgent needs a Low value`);
  } else if (urgent !== null && low !== null && validUrgent && validLow && urgent > low) {
    setFieldError(`#${prefix}-urgent`, "Urgent must be less than or equal to Low.");
    errors.push(`${label} Urgent must be less than or equal to Low`);
  }

  if (low !== null && par !== null && validLow && validPar && low > par) {
    setFieldError(`#${prefix}-low`, "Low must be less than or equal to Par.");
    errors.push(`${label} Low must be less than or equal to Par`);
  }

  return errors;
}

function validateItemForm() {
  clearItemErrors();
  const errors = [];
  if (!$("#item-name").value.trim()) {
    setFieldError("#item-name", "Enter an item name.");
    errors.push("Item name is required");
  }
  if (!$("#item-category").value) {
    setFieldError("#item-category", "Select a category.");
    errors.push("Category is required");
  }
  errors.push(...validateParGroup("normal", "Normal day"));
  errors.push(...validateParGroup("peak", "Peak day"));

  if (errors.length) {
    $("#item-form-summary-list").innerHTML = errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("");
    $("#item-form-summary").hidden = false;
    $("#item-form-summary").focus();
  }
  return errors.length === 0;
}

function parFromForm(prefix) {
  return {
    par: numericFieldValue(`#${prefix}-par`),
    low: numericFieldValue(`#${prefix}-low`),
    urgent: numericFieldValue(`#${prefix}-urgent`)
  };
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function saveItem(event) {
  event.preventDefault();
  if (!validateItemForm()) return;
  const existing = state.items.find((item) => item.id === state.editingItemId);
  const record = {
    id: existing?.id || `${slugify($("#item-name").value)}-${Date.now().toString().slice(-4)}`,
    name: $("#item-name").value.trim(),
    categoryId: $("#item-category").value,
    unit: $("#item-unit").value.trim() || "pcs",
    size: $("#item-size").value.trim(),
    method: $("#method-quantity").checked ? "Quantity" : "Level",
    critical: $("#item-critical").checked,
    reconciled: $("#item-reconciled").checked,
    active: $("#item-active").checked,
    references: existing?.references || 0,
    referenceLabel: existing?.referenceLabel || "",
    normal: parFromForm("normal"),
    peak: parFromForm("peak")
  };
  if (existing) Object.assign(existing, record);
  else state.items.push(record);
  renderStockItems();
  renderCategories();
  showToast(existing ? "Stock item changes saved" : "Stock item added");
  closeDrawer();
}

function deleteCurrentItem() {
  const item = state.items.find((candidate) => candidate.id === state.editingItemId);
  if (!item) return;
  const outcome = $("#item-delete-outcome");
  outcome.hidden = false;
  if (item.references > 0) {
    outcome.className = "inline-notice notice-error";
    outcome.innerHTML = `
      <span class="notice-symbol" aria-hidden="true">!</span>
      <div><strong>Stock item cannot be deleted</strong>
      <p>${escapeHtml(item.name)} is referenced as a Cup/Lid by ${escapeHtml(item.referenceLabel)}. The item and the ${state.items.length}-item count are unchanged.</p></div>
    `;
    return;
  }
  state.items = state.items.filter((candidate) => candidate.id !== item.id);
  renderStockItems();
  renderCategories();
  outcome.className = "inline-notice notice-success";
  outcome.innerHTML = `
    <span class="notice-symbol" aria-hidden="true">✓</span>
    <div><strong>Stock item deleted</strong><p>${escapeHtml(item.name)} was unreferenced and has been removed. Counts were updated.</p></div>
  `;
  $("#delete-item-button").disabled = true;
  $('#item-form button[type="submit"]').disabled = true;
}

function clearCategoryErrors() {
  $("#category-form-summary").hidden = true;
  $("#category-name-error").textContent = "";
  $("#category-weight-error").textContent = "";
  $("#category-name").removeAttribute("aria-invalid");
  $("#category-weight").removeAttribute("aria-invalid");
  $("#category-delete-outcome").hidden = true;
  $("#category-delete-outcome").className = "inline-notice";
  $("#delete-category-button").disabled = false;
  $('#category-form button[type="submit"]').disabled = false;
}

function openCategoryEditor(categoryId, trigger) {
  clearCategoryErrors();
  const category = state.categories.find((candidate) => candidate.id === categoryId);
  state.editingCategoryId = category?.id || null;
  $("#category-drawer-title").textContent = category ? "Edit category" : "Add category";
  setInputValue("#category-name", category?.name || "");
  setInputValue("#category-weight", category?.weight ?? (Math.max(0, ...state.categories.map((item) => item.weight)) + 10));
  $("#category-active").checked = category ? category.active : true;
  $("#delete-category-button").hidden = !category;
  openDrawer("category", trigger);
}

function validateCategoryForm() {
  clearCategoryErrors();
  let valid = true;
  const name = $("#category-name").value.trim();
  const weight = numericFieldValue("#category-weight");
  if (!name) {
    setFieldError("#category-name", "Enter a category name.");
    valid = false;
  }
  if (weight === null || !Number.isInteger(weight) || weight < 0) {
    setFieldError("#category-weight", "Enter a non-negative whole number.");
    valid = false;
  }
  $("#category-form-summary").hidden = valid;
  return valid;
}

function saveCategory(event) {
  event.preventDefault();
  if (!validateCategoryForm()) return;
  const existing = state.categories.find((category) => category.id === state.editingCategoryId);
  const record = {
    id: existing?.id || `${slugify($("#category-name").value)}-${Date.now().toString().slice(-4)}`,
    name: $("#category-name").value.trim(),
    weight: numericFieldValue("#category-weight"),
    active: $("#category-active").checked
  };
  if (existing) Object.assign(existing, record);
  else state.categories.push(record);
  renderCategories("The edited weight is now the saved order.");
  renderStockItems();
  showToast(existing ? "Category changes saved" : "Category added");
  closeDrawer();
}

function deleteCurrentCategory() {
  const category = state.categories.find((candidate) => candidate.id === state.editingCategoryId);
  if (!category) return;
  const count = itemCountForCategory(category.id);
  const outcome = $("#category-delete-outcome");
  outcome.hidden = false;
  if (count > 0) {
    outcome.className = "inline-notice notice-error";
    outcome.innerHTML = `
      <span class="notice-symbol" aria-hidden="true">!</span>
      <div><strong>Category cannot be deleted</strong>
      <p>${escapeHtml(category.name)} contains ${count} ${count === 1 ? "stock item" : "stock items"}. Move or delete those items first. The category and items are unchanged.</p></div>
    `;
    return;
  }
  state.categories = state.categories.filter((candidate) => candidate.id !== category.id);
  renderCategories("The empty category was removed and the remaining order was preserved.");
  renderStockItems();
  outcome.className = "inline-notice notice-success";
  outcome.innerHTML = `
    <span class="notice-symbol" aria-hidden="true">✓</span>
    <div><strong>Empty category deleted</strong><p>${escapeHtml(category.name)} had no stock items and has been removed.</p></div>
  `;
  $("#delete-category-button").disabled = true;
  $('#category-form button[type="submit"]').disabled = true;
}

function saveInlineWeight(categoryId, value) {
  const category = categoryById(categoryId);
  const weight = Number(value);
  if (!category || !Number.isInteger(weight) || weight < 0) {
    showToast("Sort weight must be a non-negative whole number");
    renderCategories();
    return;
  }
  category.weight = weight;
  renderCategories(`${category.name} now uses sort weight ${weight}.`);
}

function moveCategory(categoryId, direction) {
  const categories = sortedCategories();
  const index = categories.findIndex((category) => category.id === categoryId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return;
  const current = categories[index];
  const target = categories[targetIndex];
  const currentWeight = current.weight;
  current.weight = target.weight;
  target.weight = currentWeight;
  if (current.weight === target.weight) {
    current.weight += direction;
  }
  renderCategories(`${current.name} moved ${direction < 0 ? "up" : "down"} and the new order was saved.`);
}

function loadInvalidParExample() {
  setInputValue("#normal-par", -4);
  setInputValue("#normal-low", "");
  setInputValue("#normal-urgent", 5);
  setInputValue("#peak-par", 12.5);
  setInputValue("#peak-low", 18);
  setInputValue("#peak-urgent", 20);
  validateItemForm();
}

function bindEvents() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      selectTab(state.activeTab === "stock" ? "categories" : "stock", true);
    });
  });

  ["#search-items", "#category-filter", "#method-filter", "#reconciled-filter", "#critical-filter", "#active-filter"].forEach((selector) => {
    $(selector).addEventListener(selector === "#search-items" ? "input" : "change", renderStockItems);
  });
  $("#clear-filters").addEventListener("click", clearFilters);
  $("#empty-clear-filters").addEventListener("click", clearFilters);
  $("#filters-disclosure").addEventListener("click", () => {
    state.filtersOpen = !state.filtersOpen;
    $("#filter-fields").classList.toggle("is-open", state.filtersOpen);
    $("#filters-disclosure").setAttribute("aria-expanded", String(state.filtersOpen));
  });

  $("#add-item-button").addEventListener("click", (event) => openItemEditor(null, event.currentTarget));
  $("#add-category-button").addEventListener("click", (event) => openCategoryEditor(null, event.currentTarget));

  document.addEventListener("click", (event) => {
    const itemTrigger = event.target.closest("[data-edit-item]");
    if (itemTrigger) openItemEditor(itemTrigger.dataset.editItem, itemTrigger);

    const categoryTrigger = event.target.closest("[data-edit-category]");
    if (categoryTrigger) openCategoryEditor(categoryTrigger.dataset.editCategory, categoryTrigger);

    const moveTrigger = event.target.closest("[data-move-category]");
    if (moveTrigger) moveCategory(moveTrigger.dataset.moveCategory, Number(moveTrigger.dataset.direction));
  });

  document.addEventListener("change", (event) => {
    const weightInput = event.target.closest("[data-category-weight]");
    if (weightInput) saveInlineWeight(weightInput.dataset.categoryWeight, weightInput.value);
  });

  $$(".drawer-close").forEach((button) => button.addEventListener("click", () => closeDrawer()));
  $("#drawer-backdrop").addEventListener("click", () => closeDrawer());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeDrawer) {
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || !state.activeDrawer) return;
    const drawer = state.activeDrawer === "item" ? $("#item-drawer") : $("#category-drawer");
    const focusable = $$("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])", drawer)
      .filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return;
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

  $("#item-reconciled").addEventListener("change", applyReconciledRule);
  $("#item-form").addEventListener("submit", saveItem);
  $("#delete-item-button").addEventListener("click", deleteCurrentItem);
  $("#load-invalid-par").addEventListener("click", loadInvalidParExample);
  $("#show-server-error").addEventListener("click", () => {
    $("#server-rejected-state").hidden = false;
    $("#server-rejected-state").focus();
  });
  $("#dismiss-server-error").addEventListener("click", () => {
    $("#server-rejected-state").hidden = true;
  });

  $("#category-form").addEventListener("submit", saveCategory);
  $("#delete-category-button").addEventListener("click", deleteCurrentCategory);
}

function initialize() {
  populateCategoryOptions();
  renderStockItems();
  renderCategories();
  bindEvents();
}

initialize();
