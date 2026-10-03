"use strict";

const SHOP_TODAY = "2026-10-03";
const stateByView = {
  daily: { staff: "All staff", start: "2026-10-01", end: "2026-10-15" },
  adjustments: { staff: "All staff", start: "2026-10-01", end: "2026-10-15" },
  payslip: { staff: "", start: "2026-10-01", end: "2026-10-15" },
};
let activeView = "daily";

function parseCalendar(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function calendarString(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

function cutoffContaining(value) {
  const date = parseCalendar(value) || parseCalendar(SHOP_TODAY);
  const endDay = date.day <= 15 ? 15 : daysInMonth(date.year, date.month);
  const startDay = date.day <= 15 ? 1 : 16;
  return {
    start: calendarString(date.year, date.month, startDay),
    end: calendarString(date.year, date.month, endDay),
  };
}

function shiftCutoff(startValue, direction) {
  const current = cutoffContaining(startValue || SHOP_TODAY);
  const start = parseCalendar(current.start);
  if (direction < 0) {
    if (start.day === 16) return { start: calendarString(start.year, start.month, 1), end: calendarString(start.year, start.month, 15) };
    const previousMonth = start.month === 1 ? 12 : start.month - 1;
    const previousYear = start.month === 1 ? start.year - 1 : start.year;
    return {
      start: calendarString(previousYear, previousMonth, 16),
      end: calendarString(previousYear, previousMonth, daysInMonth(previousYear, previousMonth)),
    };
  }
  if (start.day === 1) {
    return { start: calendarString(start.year, start.month, 16), end: calendarString(start.year, start.month, daysInMonth(start.year, start.month)) };
  }
  const nextMonth = start.month === 12 ? 1 : start.month + 1;
  const nextYear = start.month === 12 ? start.year + 1 : start.year;
  return { start: calendarString(nextYear, nextMonth, 1), end: calendarString(nextYear, nextMonth, 15) };
}

function isExactCutoff(startValue, endValue) {
  if (!startValue || !endValue) return false;
  const cutoff = cutoffContaining(startValue);
  return startValue === cutoff.start && endValue === cutoff.end;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthName(month) {
  return MONTH_NAMES[month - 1];
}

function formatOne(value, includeYear = true) {
  const date = parseCalendar(value);
  if (!date) return "";
  return `${monthName(date.month)} ${date.day}${includeYear ? `, ${date.year}` : ""}`;
}

function formatRange(startValue, endValue) {
  const start = parseCalendar(startValue);
  const end = parseCalendar(endValue);
  if (!startValue && !endValue) return "No range selected";
  if (!startValue) return `Custom range: choose a start date (ends ${formatOne(endValue)})`;
  if (!endValue) return `Custom range: ${formatOne(startValue)} to choose an end date`;
  if (!start || !end) return "Custom range: check the entered dates";
  const sameMonth = start.year === end.year && start.month === end.month;
  if (sameMonth) return `${isExactCutoff(startValue, endValue) ? "" : "Custom range: "}${monthName(start.month)} ${start.day} – ${end.day}, ${end.year}`;
  return `${isExactCutoff(startValue, endValue) ? "" : "Custom range: "}${formatOne(startValue)} – ${formatOne(endValue)}`;
}

function currentForm() {
  return document.querySelector(`[data-filter-form="${activeView}"]`);
}

function syncForm(view) {
  const form = document.querySelector(`[data-filter-form="${view}"]`);
  const state = stateByView[view];
  form.elements.staff.value = state.staff;
  form.elements.start.value = state.start;
  form.elements.end.value = state.end;
  form.querySelector("[data-cutoff-readout]").textContent = formatRange(state.start, state.end);
  const meta = document.querySelector(`[data-view-panel="${view}"] [data-results-meta]`);
  if (meta && view === "adjustments") {
    const range = state.start && state.end ? `${formatOne(state.start)} to ${formatOne(state.end)}` : "the selected dates";
    meta.textContent = `Showing 3 adjustments from ${range}`;
  }
}

function activateView(view) {
  activeView = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll("[data-view]").forEach((button) => { button.setAttribute("aria-selected", String(button.dataset.view === view)); });
  document.querySelectorAll("[data-fixture-view]").forEach((button) => { button.setAttribute("aria-pressed", String(button.dataset.fixtureView === view)); });
  syncForm(view);
}

function setRangeExample(example) {
  const state = stateByView[activeView];
  if (example === "cutoff") ({ start: state.start, end: state.end } = cutoffContaining(SHOP_TODAY));
  if (example === "custom") ({ start: state.start, end: state.end } = { start: "2026-10-03", end: "2026-10-12" });
  if (example === "blank") ({ start: state.start, end: state.end } = { start: "", end: "" });
  document.querySelectorAll("[data-fixture-range]").forEach((button) => { button.setAttribute("aria-pressed", String(button.dataset.fixtureRange === example)); });
  syncForm(activeView);
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.view)));
document.querySelectorAll("[data-fixture-view]").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.fixtureView)));
document.querySelectorAll("[data-fixture-range]").forEach((button) => button.addEventListener("click", () => setRangeExample(button.dataset.fixtureRange)));

document.querySelectorAll("[data-filter-form]").forEach((form) => {
  const view = form.dataset.filterForm;
  form.addEventListener("input", (event) => {
    if (!event.target.name) return;
    stateByView[view][event.target.name] = event.target.value;
    syncForm(view);
  });
  form.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {
    const direction = button.dataset.step === "previous" ? -1 : 1;
    const next = shiftCutoff(stateByView[view].start, direction);
    stateByView[view].start = next.start;
    stateByView[view].end = next.end;
    syncForm(view);
  }));
  form.querySelector("[data-clear]")?.addEventListener("click", () => {
    stateByView[view].staff = "All staff";
    stateByView[view].start = "";
    stateByView[view].end = "";
    syncForm(view);
  });
});

document.querySelector('[data-filter-form="payslip"]').addEventListener("submit", (event) => {
  event.preventDefault();
  const state = stateByView.payslip;
  const message = document.querySelector("[data-payslip-message]");
  if (!state.staff || !state.start || !state.end) {
    message.textContent = "Choose a staff member and complete both dates before generating the payslip.";
    return;
  }
  message.textContent = `Payslip generated for ${state.staff}, ${formatOne(state.start)} to ${formatOne(state.end)}. This preview is fixture data.`;
});

function runMathChecks() {
  const checks = [
    [shiftCutoff("2026-10-01", -1), { start: "2026-09-16", end: "2026-09-30" }],
    [shiftCutoff("2026-10-01", 1), { start: "2026-10-16", end: "2026-10-31" }],
    [shiftCutoff("2027-01-01", -1), { start: "2026-12-16", end: "2026-12-31" }],
    [shiftCutoff("2027-03-01", -1), { start: "2027-02-16", end: "2027-02-28" }],
    [shiftCutoff("2028-03-01", -1), { start: "2028-02-16", end: "2028-02-29" }],
  ];
  const passed = checks.filter(([actual, expected]) => actual.start === expected.start && actual.end === expected.end).length;
  checks.forEach(([actual, expected], index) => console.assert(actual.start === expected.start && actual.end === expected.end, `Cutoff math check ${index + 1} failed`, actual, expected));
  document.querySelector("#math-status").textContent = `${passed}/${checks.length} cutoff math checks passed`;
}

runMathChecks();
activateView("daily");
