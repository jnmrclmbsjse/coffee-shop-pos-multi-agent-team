"use strict";

const seedStaff = [
  { id: 1, name: "Mara Villanueva", active: true },
  { id: 2, name: "Paolo Reyes", active: true },
  { id: 3, name: "Amina Santos", active: false },
  { id: 4, name: "Luis Mendoza", active: true },
  { id: 5, name: "Nika Flores", active: false },
  { id: 6, name: "Gabriel Lim", active: true },
  { id: 7, name: "Mara Villanueva", active: false },
  { id: 8, name: "Paolo Reyes", active: true }
];

let staff = seedStaff.map((member) => ({ ...member }));
let nextId = 9;
let editingId = null;
let lastFocusedElement = null;
let toastTimer = null;
let saveTimer = null;
let demoState = "populated";

const state = {
  search: "",
  filter: "all",
  sortField: "name",
  direction: "asc"
};

const elements = {
  addButton: document.querySelector("#add-staff-button"),
  emptyAddButton: document.querySelector("#empty-add-button"),
  search: document.querySelector("#staff-search"),
  clearSearch: document.querySelector("#clear-search"),
  filter: document.querySelector("#status-filter"),
  sortField: document.querySelector("#sort-field"),
  sortDirection: document.querySelector("#sort-direction"),
  sortDirectionIcon: document.querySelector("#sort-direction-icon"),
  sortDirectionText: document.querySelector("#sort-direction-text"),
  mockupState: document.querySelector("#mockup-state"),
  table: document.querySelector("#staff-table"),
  tbody: document.querySelector("#staff-table-body"),
  emptyState: document.querySelector("#empty-state"),
  noResultsState: document.querySelector("#no-results-state"),
  noResultsClear: document.querySelector("#no-results-clear"),
  noResultsAll: document.querySelector("#no-results-all"),
  resultCount: document.querySelector("#result-count"),
  stateSummary: document.querySelector("#state-summary"),
  dialog: document.querySelector("#staff-dialog"),
  form: document.querySelector("#staff-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDescription: document.querySelector("#dialog-description"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogCancel: document.querySelector("#dialog-cancel"),
  dialogSubmit: document.querySelector("#dialog-submit"),
  name: document.querySelector("#staff-name"),
  nameError: document.querySelector("#name-error"),
  active: document.querySelector("#staff-active"),
  activeChoiceLabel: document.querySelector("#active-choice-label"),
  activeChoiceHelp: document.querySelector("#active-choice-help"),
  toast: document.querySelector("#toast")
};

function normalize(value) {
  return value.toLocaleLowerCase();
}

function getVisibleStaff() {
  if (demoState === "empty") {
    return [];
  }

  let visible = staff.filter((member) => {
    const matchesSearch = normalize(member.name).includes(normalize(state.search));
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "active" && member.active) ||
      (state.filter === "inactive" && !member.active);
    return matchesSearch && matchesFilter;
  });

  if (demoState === "no-results") {
    return [];
  }

  visible.sort((a, b) => {
    let comparison;
    if (state.sortField === "name") {
      comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (comparison === 0) {
        comparison = a.id - b.id;
      }
    } else {
      comparison = Number(a.active) - Number(b.active);
      if (comparison === 0) {
        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
    }
    return state.direction === "asc" ? comparison : -comparison;
  });

  return visible;
}

function statusText(active) {
  return active ? "Active" : "Inactive";
}

function createStaffRow(member) {
  const row = document.createElement("tr");
  row.dataset.odId = `staff-row-${member.id}`;

  const nameCell = document.createElement("td");
  nameCell.dataset.label = "Name";
  const name = document.createElement("span");
  name.className = "staff-name";
  name.textContent = member.name;
  nameCell.append(name);

  const statusCell = document.createElement("td");
  statusCell.dataset.label = "Is active";
  const statusControl = document.createElement("div");
  statusControl.className = "status-control";

  const badge = document.createElement("span");
  badge.className = `status-badge${member.active ? " active" : ""}`;
  badge.textContent = statusText(member.active);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "inline-switch";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(member.active));
  toggle.setAttribute(
    "aria-label",
    `${member.active ? "Deactivate" : "Activate"} ${member.name}`
  );
  toggle.dataset.action = "toggle";
  toggle.dataset.id = String(member.id);
  toggle.dataset.odId = `staff-status-toggle-${member.id}`;

  const track = document.createElement("span");
  track.className = "switch-track";
  track.setAttribute("aria-hidden", "true");
  const actionText = document.createElement("span");
  actionText.textContent = member.active ? "On" : "Off";
  toggle.append(track, actionText);

  statusControl.append(badge, toggle);
  statusCell.append(statusControl);

  const actionsCell = document.createElement("td");
  actionsCell.className = "row-actions";
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "button secondary edit-button";
  editButton.textContent = "Edit";
  editButton.setAttribute("aria-label", `Edit ${member.name}`);
  editButton.dataset.action = "edit";
  editButton.dataset.id = String(member.id);
  editButton.dataset.odId = `edit-staff-${member.id}`;
  actionsCell.append(editButton);

  row.append(nameCell, statusCell, actionsCell);
  return row;
}

function getStateSummary() {
  const filterLabel = elements.filter.options[elements.filter.selectedIndex].text;
  const sortLabel = elements.sortField.options[elements.sortField.selectedIndex].text;
  const directionLabel = state.direction === "asc" ? "ascending" : "descending";
  return `${filterLabel} status, sorted by ${sortLabel.toLowerCase()} ${directionLabel}`;
}

function render() {
  const visible = getVisibleStaff();
  const rosterIsEmpty = demoState === "empty" || staff.length === 0;
  const hasNoResults = !rosterIsEmpty && (demoState === "no-results" || visible.length === 0);

  elements.tbody.replaceChildren(...visible.map(createStaffRow));
  elements.table.hidden = rosterIsEmpty || hasNoResults;
  elements.emptyState.hidden = !rosterIsEmpty;
  elements.noResultsState.hidden = !hasNoResults;

  const noun = visible.length === 1 ? "staff member" : "staff members";
  elements.resultCount.textContent = rosterIsEmpty
    ? "0 staff members"
    : hasNoResults
      ? "0 staff members shown"
      : `${visible.length} ${noun} shown`;

  elements.stateSummary.textContent = getStateSummary();
  elements.search.value = state.search;
  elements.filter.value = state.filter;
  elements.sortField.value = state.sortField;
  elements.clearSearch.hidden = state.search.length === 0;
  elements.sortDirectionIcon.textContent = state.direction === "asc" ? "↑" : "↓";
  elements.sortDirectionText.textContent = state.direction === "asc" ? "Ascending" : "Descending";
  elements.sortDirection.setAttribute(
    "aria-label",
    `Sort ${state.direction === "asc" ? "ascending" : "descending"}. Activate to sort ${state.direction === "asc" ? "descending" : "ascending"}`
  );
  elements.sortDirection.setAttribute("aria-pressed", String(state.direction === "desc"));
}

function setDemoState(value, updateUrl = true) {
  demoState = ["populated", "empty", "no-results"].includes(value) ? value : "populated";
  elements.mockupState.value = demoState;

  if (demoState === "no-results") {
    state.search = "No matching staff";
    state.filter = "all";
  } else if (demoState === "empty") {
    state.search = "";
    state.filter = "all";
  } else if (state.search === "No matching staff") {
    state.search = "";
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (demoState === "populated") {
      const keptParameters = new URLSearchParams(
        [...url.searchParams.entries()].filter(([key]) => key !== "state")
      );
      url.search = keptParameters.toString();
    } else {
      url.searchParams.set("state", demoState);
    }
    window.history.replaceState({}, "", url);
  }
  render();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function updateActiveChoice() {
  const isActive = elements.active.checked;
  elements.activeChoiceLabel.textContent = isActive ? "Active" : "Inactive";
  elements.activeChoiceHelp.textContent = isActive
    ? "Available for cashier attribution"
    : "Kept in the roster but unavailable for new attribution";
}

function clearValidation() {
  elements.name.removeAttribute("aria-invalid");
  elements.nameError.hidden = true;
}

function validateName() {
  const valid = elements.name.value.trim().length > 0;
  elements.name.setAttribute("aria-invalid", String(!valid));
  elements.nameError.hidden = valid;
  if (!valid) {
    elements.name.focus();
  }
  return valid;
}

function openStaffDialog(mode, id = null) {
  lastFocusedElement = document.activeElement;
  editingId = mode === "edit" ? Number(id) : null;
  clearValidation();

  if (mode === "edit") {
    const member = staff.find((item) => item.id === editingId);
    if (!member) return;
    elements.dialogTitle.textContent = "Edit staff";
    elements.dialogDescription.textContent = "Update this roster entry without changing its identity.";
    elements.dialogSubmit.textContent = "Save changes";
    elements.name.value = member.name;
    elements.active.checked = member.active;
  } else {
    elements.dialogTitle.textContent = "Add staff";
    elements.dialogDescription.textContent = "Names appear in the roster exactly as saved.";
    elements.dialogSubmit.textContent = "Add staff";
    elements.name.value = "";
    elements.active.checked = true;
  }

  updateActiveChoice();
  elements.dialog.showModal();
  window.setTimeout(() => elements.name.focus(), 0);
}

function closeStaffDialog() {
  window.clearTimeout(saveTimer);
  elements.dialog.close();
}

function finishDialogClose() {
  editingId = null;
  elements.form.reset();
  clearValidation();
  elements.dialogSubmit.disabled = false;
  elements.dialogCancel.disabled = false;
  elements.dialogClose.disabled = false;
  updateActiveChoice();
  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

function saveStaff(event) {
  event.preventDefault();
  if (!validateName()) return;

  const trimmedName = elements.name.value.trim();
  const isActive = elements.active.checked;
  const isEditing = editingId !== null;

  elements.dialogSubmit.disabled = true;
  elements.dialogCancel.disabled = true;
  elements.dialogClose.disabled = true;
  elements.dialogSubmit.textContent = isEditing ? "Saving changes" : "Adding staff";

  saveTimer = window.setTimeout(() => {
    if (isEditing) {
      const member = staff.find((item) => item.id === editingId);
      if (member) {
        member.name = trimmedName;
        member.active = isActive;
      }
    } else {
      staff.push({ id: nextId, name: trimmedName, active: isActive });
      nextId += 1;
    }

    if (demoState !== "populated") {
      setDemoState("populated");
    } else {
      render();
    }
    elements.dialog.close();
    showToast(isEditing ? `Changes saved for ${trimmedName}.` : `${trimmedName} added to staff.`);
  }, 450);
}

function toggleStatus(id) {
  const member = staff.find((item) => item.id === Number(id));
  if (!member) return;
  member.active = !member.active;
  render();
  showToast(`${member.name} is now ${statusText(member.active).toLowerCase()}.`);
}

elements.addButton.addEventListener("click", () => openStaffDialog("add"));
elements.emptyAddButton.addEventListener("click", () => openStaffDialog("add"));

elements.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  if (demoState !== "populated") {
    demoState = "populated";
    elements.mockupState.value = "populated";
  }
  render();
});

elements.clearSearch.addEventListener("click", () => {
  state.search = "";
  demoState = "populated";
  elements.mockupState.value = "populated";
  render();
  elements.search.focus();
});

elements.filter.addEventListener("change", (event) => {
  state.filter = event.target.value;
  if (demoState === "no-results") {
    demoState = "populated";
    elements.mockupState.value = "populated";
  }
  render();
});

elements.sortField.addEventListener("change", (event) => {
  state.sortField = event.target.value;
  render();
});

elements.sortDirection.addEventListener("click", () => {
  state.direction = state.direction === "asc" ? "desc" : "asc";
  render();
});

elements.mockupState.addEventListener("change", (event) => {
  setDemoState(event.target.value);
});

elements.noResultsClear.addEventListener("click", () => {
  state.search = "";
  demoState = "populated";
  elements.mockupState.value = "populated";
  render();
  elements.search.focus();
});

elements.noResultsAll.addEventListener("click", () => {
  state.filter = "all";
  state.search = "";
  demoState = "populated";
  elements.mockupState.value = "populated";
  render();
  elements.filter.focus();
});

elements.tbody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit") {
    openStaffDialog("edit", button.dataset.id);
  } else if (button.dataset.action === "toggle") {
    toggleStatus(button.dataset.id);
  }
});

elements.active.addEventListener("change", updateActiveChoice);
elements.name.addEventListener("input", () => {
  if (elements.name.getAttribute("aria-invalid") === "true") {
    validateName();
  }
});
elements.form.addEventListener("submit", saveStaff);
elements.dialogCancel.addEventListener("click", closeStaffDialog);
elements.dialogClose.addEventListener("click", closeStaffDialog);
elements.dialog.addEventListener("close", finishDialogClose);
elements.dialog.addEventListener("cancel", () => {
  window.clearTimeout(saveTimer);
});

const initialState = new URL(window.location.href).searchParams.get("state");
setDemoState(initialState || "populated", false);
