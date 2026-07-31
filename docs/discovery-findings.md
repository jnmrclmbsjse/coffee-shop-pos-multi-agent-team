# v1 Discovery Findings

This log records what the existing v1 coffee-shop POS actually does, observed by
read-only exploration. It is a citable source: entries are **descriptive only**
— what was seen, not what v2 should do. Recommendations and bug judgements belong
under "Open questions for the human", phrased as questions.

---

## 2026-07-24 — Catalog: Products, Sizes & Product Categories (admin back office)

Explored the admin back-office Catalog section at `/admin/products` and
`/admin/product-categories`, signed in as the administrator. The admin panel is
a Filament v5.7.1 UI. Exploration was read-only; no records were created,
edited, or deleted.

### Products list (`/admin/products`)

- The list shows columns: **Category**, **Name**, **Sizes** (a count, e.g. "1"),
  **Is active** ("Yes"/"No"), **Available** (an inline toggle switch), and an
  **Action** column with an **Edit** link.
- The **Available** column is an inline toggle switch directly in the table row
  (togglable without opening the record).
- Category, Name, and Is active column headers are sortable buttons.
- A **Search** box and a **Filter** control are present. The filter offers two
  filters: **Category** (options: Coffee, Non Coffee) and **Is active**
  (options: "-", "Yes", "No").
- Pagination offers per-page sizes 5, 10, 25, 50 (default 10).
- Seeded data at time of exploration: 3 products — "House Blend" (Coffee, 1 size,
  active, available), "Milky Choco" (Non Coffee, 1 size, active, available),
  "Signature Latte" (Coffee, 1 size, active, available).
- A **New product** button links to a dedicated create page
  (`/admin/products/create`).

### Product create / edit form (`/admin/products/create`, `/…/{id}/edit`)

The form has two sections: **Product** and **Sizes**.

**Product section:**
- **Category** — required (marked `*`), a searchable select. Options are the
  existing product categories (Coffee, Non Coffee).
- **Name** — required (marked `*`), free text.
- **Is active** — a toggle switch, **on by default**, with helper text
  "Catalog on/off."
- **Available** — a toggle switch, **on by default**, with helper text
  'Temporary "sold out" — also flippable from the POS.'

**Sizes section** (a repeater; section subtitle: "Each size carries its own
price and maps to the cup + lid it draws down."):
- Each size row has: a **Move** (drag reorder) handle and a **Delete** button.
- **Label** — required (marked `*`), free text, with hint "S / M / L".
- **Price** — required (marked `*`). Rendered with a "₱" prefix. The underlying
  input is `type=number` with `min=0` and `step=any` (i.e. negative values are
  blocked at the input level; fractional values are permitted by the step).
- **Cup** — optional select. Options are stock items (observed options:
  "Coffee/Non-Coffee Cup (16oz)", "Coffee/Non-Coffee Lid (16oz and 12oz)" — the
  cup/lid selects draw from the stock-items list).
- **Lid** — optional select, same option source as Cup.
- **Sort weight** — required (marked `*`), `type=number` with `step=1`,
  defaults to 0.
- **Is active** — a per-size toggle switch, on by default.
- An **Add size** button adds another size row.
- The create form opens with one blank size row already present.

Observed values on the existing "House Blend" product: Category = Coffee,
Name = House Blend, Is active = on, Available = on; single size labelled "M",
Price = 50, Cup = "Coffee/Non-Coffee Cup (16oz)",
Lid = "Coffee/Non-Coffee Lid (16oz and 12oz)", Sort weight = 0, size Is active = on.

**Validation observed:** Submitting the create form with empty required fields
triggers native browser validation ("Please fill out this field") on the first
empty required field (Name). No server round-trip occurred and no record was
created. Server-side validation messages (e.g. for price/category) were not
observed because doing so would require submitting a valid-enough form, which
would create a record.

**Edit page** (`/…/{id}/edit`) shows the same two-section form pre-filled, with
a **Save changes** button, a **Cancel** button, and a **Delete** button in the
page header. Selects show a "Clear selection" (×) control when a value is set.

### Product Categories (`/admin/product-categories`)

- List columns: (drag handle), **Name**, **Sort weight**, **Products** (a count
  of products in the category), **Is active** ("Yes"/"No"), and per-row **Edit**
  and **Delete** actions.
- A **Reorder records** button is present (drag-to-reorder), consistent with the
  drag handle column.
- Seeded data: "Non Coffee" (sort weight 0, 1 product, active) and "Coffee"
  (sort weight 1, 2 products, active).
- Creating a category uses a **modal** (opened by "New product category"), not a
  separate route — `/admin/product-categories/create` returns 404.
- The category modal fields: **Name** (required), **Sort weight** (required
  number, default 0), and **Is active** (toggle switch).

(Catalog open questions for the human are retained at the end of this file.)

## 2026-07-24 — Inventory: Stock Categories, Stock Items & Par Levels (admin back office)

Explored the admin back-office Inventory section at `/admin/stock-categories`,
`/admin/stock-items`, and the stock-item edit page (which hosts a Par Levels
relation manager), signed in as the administrator. Same Filament v5.7.1 admin
UI as the Catalog section. Exploration was read-only; no records were created,
edited, or deleted. Two forms were submitted empty to observe validation only,
and one toggle was flipped to observe a UI reaction — neither was saved.

### Sidebar navigation

The admin sidebar groups these two resources under an **Inventory** heading:
**Stock Categories** (`/admin/stock-categories`) and **Stock Items**
(`/admin/stock-items`).

### Stock Categories list (`/admin/stock-categories`)

- Columns: (bulk-select checkbox), **Name**, **Sort weight**, **Items** (a count
  of stock items in the category), **Is active** ("Yes"/"No"), and per-row
  **Edit** and **Delete** actions.
- Name, Sort weight, and Is active column headers are sortable buttons.
- A **Reorder records** button is present (drag-to-reorder), consistent with the
  sortable sort-weight column. A **Search** box and a **Filter** control (0
  active filters) are present.
- Seeded data at time of exploration: 5 categories — "Water & Ice" (sort 0, 1
  item), "Cups" (sort 1, 1 item), "Lids" (sort 2, 1 item), "Dairies" (sort 3,
  1 item), "Others" (sort 4, 2 items). All active.
- Creating a category uses a **modal** ("New stock category"), consistent with
  product categories.
- The modal fields: **Name** (required) with helper text 'Reconciled cup/lid
  items are matched by a category name containing "cup" or "lid".'; **Sort
  weight** (required number, default 0); **Is active** (toggle switch, on by
  default). Buttons: **Create**, **Create & create another**, **Cancel**.

### Stock Items list (`/admin/stock-items`)

- Columns: **Category**, **Name**, **Size**, **Unit**, **Count method**,
  **Reconciled** ("Yes"/"No"), **Critical** ("Yes"/"No"), **Is active**
  ("Yes"/"No"), and an **Action** column with an **Edit** link. Category and
  Name headers are sortable buttons.
- A **Search** box, a **Filter** control, and a **Column manager** button are
  present. Pagination offers per-page sizes 5, 10, 25, 50 (default 10).
- The **Filter** panel offers: **Category** (All + one option per stock
  category: Cups, Dairies, Lids, Others, Water & Ice), **Count method** (All,
  Quantity, Level), **Is reconciled** (-, Yes, No), **Is critical** (-, Yes,
  No), and **Is active** (-, Yes, No).
- Seeded data (6 items):
  - "Coffee/Non-Coffee Cup" — Category Cups, Size 16oz, Unit pcs, Count method
    Quantity, Reconciled Yes, Critical Yes, active.
  - "Coffee/Non-Coffee Lid" — Category Lids, Size "16oz and 12oz", Unit pcs,
    Count method Quantity, Reconciled Yes, Critical Yes, active.
  - "Full Cream Milk" — Category Dairies, no Size ("—"), Unit carton, Count
    method Quantity, Reconciled No, Critical Yes, active.
  - "Straw" — Category Others, no Size, Unit pcs, Count method Quantity,
    Reconciled No, Critical No, active.
  - "Water" — Category "Water & Ice", no Size, Unit container, Count method
    **Level**, Reconciled No, Critical Yes, active.
  - "Yakult" — Category Others, no Size, Unit bottle, Count method Quantity,
    Reconciled No, Critical Yes, active.
- A **New stock item** button links to a dedicated create page
  (`/admin/stock-items/create`).

### Stock Item create / edit form

The create page (`/admin/stock-items/create`) and edit page
(`/…/{id}/edit`) share the same field set:

- **Category** — required (marked `*`), a select. Options are the existing stock
  categories.
- **Name** — required (marked `*`), free text.
- **Unit** — required (marked `*`), free text, default value "pcs", helper text
  "e.g. pcs / ml / bottle / pack".
- **Size** — optional, free text, helper text "Set for cups/lids (S/M/L)."
- **Reconciled (cup/lid)** — a toggle switch, **off by default** on the create
  form, helper text "Cups & lids only. Forces counting by quantity."
- **Count method** — a select (Quantity / Level). On the create form it is
  marked required (`*`) and defaults to **Quantity**. Observed behaviour:
  toggling **Reconciled** on **disables** the Count method select and forces it
  to **Quantity** (the required `*` marker also drops while disabled). On the
  edit page of the reconciled "Coffee/Non-Coffee Cup", Count method was shown
  disabled and set to Quantity.
- **Critical (opening sheet)** — a toggle switch, **off by default**, helper
  text "Shows on the short opening count sheet."
- **Is active** — a toggle switch, **on by default**.

The edit page additionally shows a **Delete** button in the page header. The
create page has **Create**, **Create & create another**, and **Cancel**
buttons; the edit page has **Save changes** and **Cancel**.

**Validation observed:** Submitting the create form empty triggers native
browser validation and focuses the first empty required field. No server
round-trip occurred and no record was created. Server-side validation messages
were not observed (that would require a valid-enough submission, which would
create a record).

### Par Levels (relation manager on the stock-item edit page)

The stock-item **edit** page hosts a **Par levels** table below the main form
(this is per-stock-item; it is not present on the create page).

- Table columns: (bulk-select checkbox), **Day type**, **Par**, **Low**,
  **Urgent**, **Actions** (per-row **Edit** and **Delete**). A **New par level**
  button is present.
- Observed on "Coffee/Non-Coffee Cup": 2 par-level rows —
  **Peak** (Par 60.00, Low 15.00, Urgent 5.00) and **Normal** (Par 30.00, Low
  15.00, Urgent 5.00). Values render with two decimal places.
- The **New par level** modal ("Create Par Level") fields: **Day type**
  (required select; options **Normal** and **Peak**), **Par qty** (required,
  numeric spinbutton), **Low qty threshold** (optional, numeric spinbutton),
  **Urgent qty threshold** (optional, numeric spinbutton). Buttons: **Create**,
  **Create & create another**, **Cancel**. (Modal was opened and cancelled; no
  record created.)

### Open questions for the human

- **Two ways to designate a reconciled cup/lid.** The stock-item form has an
  explicit per-item **Reconciled (cup/lid)** toggle, while the stock-*category*
  create modal states 'Reconciled cup/lid items are matched by a category name
  containing "cup" or "lid".' I observed both mechanisms in the UI but did not
  determine how they interact (whether the category-name substring match sets or
  overrides the per-item toggle, or whether both must agree). This parallels the
  catalog "coffee" substring rule for free upsize. Should v2 keep substring
  matching on category names for reconciliation, rely on the explicit per-item
  flag, or use an explicit per-category flag — and what happens if the toggle
  and the category name disagree?
- **Deletion of a referenced stock item.** "Coffee/Non-Coffee Cup" and
  "Coffee/Non-Coffee Lid" are referenced by product-size cup/lid mappings (per
  the catalog findings) and by reconciliation. Their edit pages still show a
  plain **Delete** button. I did not confirm the deletion (that would mutate
  v1), so I could not verify whether v1 blocks deletion of a referenced stock
  item server-side or whether the delete proceeds. Should v2 block deletion of
  referenced stock items and require deactivation instead (consistent with
  DISCOVERY.md's record-integrity rule), and should the UI surface that before
  the confirm?
- **Par-level thresholds are optional and not obviously constrained.** In the
  Create Par Level modal only **Day type** and **Par qty** are required; **Low**
  and **Urgent** thresholds are optional, and the modal shows no visible
  constraint that Urgent ≤ Low ≤ Par. I did not submit values (that would
  mutate v1), so I could not observe whether v1 enforces such ordering
  server-side. Should v2 enforce Urgent ≤ Low ≤ Par (and require the
  thresholds), or leave them free-form as v1's form appears to?

<!-- (catalog open questions retained below) -->

### Catalog open questions (2026-07-24) — retained

- **Product deletion of a referenced product.** "House Blend" is referenced by
  an existing order (it appears in today's open-day sales). Its edit page still
  shows a plain **Delete** button, and clicking it opens a generic confirmation
  ("Delete House Blend — Are you sure you would like to do this?") with no
  indication that the product is referenced. I did not confirm the deletion
  (that would mutate v1), so I could not verify whether v1 actually blocks
  deletion of a referenced product server-side or whether the delete proceeds.
  Should v2 block deletion of referenced products (and, per DISCOVERY.md,
  require deactivation instead), and if so should the UI surface that before the
  confirm rather than presenting a plain "Delete"?
- **Category "Non Coffee" naming vs. coffee-eligibility rule.** A category named
  "Non Coffee" exists. DISCOVERY.md notes v1's free-upsize coffee eligibility
  depends on the category name *containing* "coffee", which "Non Coffee" would
  match. This was not exercised in the catalog UI (it is a POS behaviour), but
  the naming is present in seeded data. Should v2 keep the substring-based
  coffee rule (and this naming), or use an explicit per-category flag?

---

## 2026-07-25 — Staff roster (admin back office)

Explored the admin back-office **Staff** resource at `/admin/staff` (the
create/edit modals and the row delete confirmation), signed in as the
administrator. Same Filament v5.7.1 admin UI as the Catalog and Inventory
sections. Exploration was read-only; no records were created, edited, or
deleted. One empty create form was submitted to observe validation, one edit
modal was opened, and one delete confirmation was opened and cancelled —
nothing was saved or confirmed.

### Sidebar navigation

Unlike Catalog and Inventory (which are collapsible sidebar groups with child
resources), **Staff** is a top-level sidebar link (`/admin/staff`), listed
alongside **Dashboard** and **Reports** at the top of the sidebar, not under a
group heading.

### Staff list (`/admin/staff`)

- Columns: **Name**, **Is active**, and an **Actions** column. Name and Is
  active column headers are sortable buttons.
- The **Is active** column renders as an inline toggle button showing "Yes" or
  "No" directly in the row (togglable without opening the record), consistent
  with the Products list's inline **Available** toggle.
- The **Actions** column has per-row **Edit** and **Delete** buttons.
- A **Search** box, a **Filter** control (0 active filters), and a **Column
  manager** button are present. Pagination offers per-page sizes 5, 10, 25, 50
  (default 10).
- The **Filter** panel offers a single filter: **Is active** (options "-",
  "Yes", "No"), with **Reset** and **Apply filters** controls.
- Seeded data at time of exploration: 4 staff — "Ana Banana" (Is active **No**),
  "Ben" (Yes), "Carmen" (Yes), "Rodette Sevilla" (Yes).
- A **New staff** button opens a create **modal** (not a separate route).

### Staff create modal ("Create Staff")

The create form is a modal with only two fields:

- **Name** — required (marked `*`), free text.
- **Is active** — a toggle switch, **on by default**.

Buttons: **Create**, **Create & create another**, **Cancel**. There is **no PIN
field** and no other field (no role, no username, no password) on the create
modal.

**Validation observed:** Clicking **Create** with the Name field left empty
leaves the modal open and creates no record (the list still showed "4 results"
afterward). No inline error-message text was captured in the dialog's rendered
text at the moment observed, and no server round-trip that created a record
occurred.

### Staff edit modal ("Edit {name}")

Opening **Edit** on "Ben" showed the same two fields pre-filled: **Name**
("Ben") and **Is active** (on). Buttons: **Save changes** and **Cancel**. There
is **no Delete button inside the edit modal** (deletion is only a row action on
the list) and, again, **no PIN field**.

### Delete confirmation (row action)

The row **Delete** action opens a generic confirmation alertdialog titled
"Delete {name}" with the body "Are you sure you would like to do this?" and
**Cancel** / **Delete** buttons. It carries no indication of whether the staff
member is referenced by any operational record. The confirmation was cancelled;
no deletion was performed, so whether v1 blocks deletion of a referenced staff
member server-side was not observed.

### Open questions for the human

- **Where is a staff PIN managed in v1?** DISCOVERY.md states a staff member may
  have an optional PIN that must be entered before they become the active
  cashier. The admin back-office **Staff** resource exposes only **Name** and
  **Is active** on both the create and edit modals — no PIN field anywhere in
  this resource. I did not explore the POS cashier-selection flow in this run,
  so I could not observe where (or whether) a PIN is set, changed, or cleared.
  Should v2's back-office staff management include PIN setup/reset, or is PIN
  entry/management intended to live only in the POS workspace as v1 appears to
  arrange it?
- **Deletion of a referenced staff member.** The staff **Delete** row action
  presents a plain generic confirmation with no reference guard, mirroring the
  catalog "product deletion" and inventory "stock-item deletion" open questions.
  DISCOVERY.md's record-integrity rule says referenced roster records should be
  deactivated, not deleted (the active cashier attributes each order). I did not
  confirm the deletion (that would mutate v1), so I could not verify whether v1
  blocks deletion of a staff member referenced by orders. Should v2 block
  deletion of referenced staff and require deactivation instead, and should the
  UI surface that before the confirm rather than presenting a plain "Delete"?

---

## 2026-07-25 — Owner reporting: Dashboard & Reports (admin back office)

Explored the admin back-office **Dashboard** (`/admin`) and **Reports**
(`/admin/reports`), signed in as the administrator. Same Filament v5.7.1 admin
UI as the Catalog, Inventory, and Staff sections. Exploration was read-only: no
records were created, edited, or deleted. The only actions taken were changing
the Reports date-range inputs (a query filter) and clicking **Export CSV**
(which produces a download and writes nothing). Observed on 2026-07-25, when the
open business day was **Jul 23**.

### Sidebar navigation

The sidebar has three ungrouped top-level links — **Dashboard**, **Staff**,
**Reports** — followed by three collapsible groups: **Sales** (containing
**Order History**, `/admin/sales-orders`), **Catalog**, and **Inventory**.
`Reports` and `Order History` are separate destinations. Order History was not
explored in this run.

### Dashboard (`/admin`)

The page is titled "Dashboard" and contains, top to bottom:

- A **Welcome** card showing "Administrator" with a **Sign out** button, and a
  Filament branding card (v5.7.1, Documentation and GitHub links).
- **"Sales — last 14 days"** — a grouped vertical bar chart rendered to a
  `<canvas>` with two legended series, **Cash** and **Online**. The x-axis
  showed exactly five labels: Jul 16, Jul 17, Jul 20, Jul 21, Jul 23. These are
  precisely the five dates that have a business-day record in the same period —
  dates in the 14-day window with no business day (e.g. Jul 18, Jul 19, Jul 22)
  did not appear on the axis at all, rather than appearing as zero-height bars.
  The y-axis ran 0–5,000.
- **"Today"** — a row of four stat tiles:
  - **Orders**: `1`, with the subtitle **"Open day · Jul 23"**.
  - **Gross sales**: `₱50.00`, subtitle "Cash ₱50.00 · Online ₱0.00".
  - **Avg order**: `₱50.00`.
  - **Cash tips**: `₱0.00`.

  The section heading reads "Today", but the figures shown were those of the
  open business day (Jul 23) while the actual calendar date was Jul 25; the
  Orders tile subtitle names the day it is actually reporting.
- **"Top products — last 14 days"** — a horizontal bar chart (canvas) with three
  bars labelled House Blend, Signature Latte, and Milky Choco, on an x-axis
  running 0–6,000.

Both charts are canvas drawings with only an `aria-label` matching the widget
heading; the plotted values are not exposed as text in the accessibility tree.

### Reports (`/admin/reports`)

The page header is "Reports" with a single **Export CSV** button. There are no
create, edit, or delete affordances anywhere on the page — it is entirely
read-only apart from the date filter.

#### Date range controls

- Two native `<input type="date">` fields labelled **From** and **To**, bound
  live (each change re-queries immediately; there is no Apply button).
- Defaults on load: **From 2026-07-12**, **To 2026-07-25** — a 14-day window
  inclusive, ending on the current date.
- Neither input carries a `min`, `max`, or `required` attribute.

#### Range summary tiles

Four tiles for the selected range: **Gross sales**, **Cash sales**, **Online
sales**, **Cash tips**. For the default range these read ₱9,216.00 / ₱6,108.00 /
₱3,108.00 / ₱0.00. There is **no order count and no average order value** on
the Reports page; those two figures appear only on the Dashboard "Today" widget.

#### Daily reconciliation table

Columns: **Date, Status, Cash, Online, Gross, Tips, Expected, Actual,
Variance**. Dates render as "Thu, Jul 16". Status renders as "Closed" or
"Open". There are no pagination controls. Rows observed for the default range:

| Date | Status | Cash | Online | Gross | Tips | Expected | Actual | Variance |
|---|---|---|---|---|---|---|---|---|
| Thu, Jul 16 | Closed | ₱0.00 | ₱0.00 | ₱0.00 | ₱0.00 | ₱1,000.00 | ₱1,000.00 | ₱0.00 |
| Fri, Jul 17 | Closed | ₱908.00 | ₱108.00 | ₱1,016.00 | ₱0.00 | ₱1,908.00 | ₱1,910.00 | ₱2.00 |
| Mon, Jul 20 | Closed | ₱5,000.00 | ₱3,000.00 | ₱8,000.00 | ₱0.00 | ₱6,400.00 | ₱6,350.00 | ₱-50.00 |
| Tue, Jul 21 | Closed | ₱150.00 | ₱0.00 | ₱150.00 | ₱0.00 | ₱1,150.00 | ₱1,152.00 | ₱2.00 |
| Thu, Jul 23 | Open | ₱50.00 | ₱0.00 | ₱50.00 | ₱0.00 | ₱1,050.00 | — | — |

Observable behaviours:

- The **open** day (Jul 23) shows an **Expected** figure but renders **"—"** for
  both **Actual** and **Variance**.
- Jul 16 has zero sales in every column yet an Expected and Actual of ₱1,000.00,
  consistent with an opening cash float being counted with no trading activity.
- A negative variance renders as **"₱-50.00"** — the minus sign is printed after
  the peso symbol, not before it.
- Only dates that have a business-day record appear as rows; the range's other
  calendar dates are absent.

#### Top products table

Columns: **Product, Qty sold, Revenue**. Rows for the default range: House Blend
(109, ₱5,450.00), Signature Latte (23, ₱3,450.00), Milky Choco (2, ₱316.00).
Sorted by revenue descending. Only three products have any sales in the
available data, so a maximum row count for this table could not be determined.

#### Range behaviour observed

- **Very wide range** (2020-01-01 → 2026-12-31): identical totals, the same five
  reconciliation rows and the same three product rows as the 14-day default —
  all seeded activity falls inside the default window.
- **Range with no data** (2026-01-01 → 2026-01-07): all four summary tiles show
  ₱0.00; the reconciliation table shows **"No days in this range."** and the
  products table shows **"No sales in this range."**
- **Inverted range** (From 2026-07-25, To 2026-07-12): accepted with **no
  validation message**; the page renders exactly the same empty states as a
  genuinely empty range.
- **Blank date field**: clearing **From** caused the Livewire update request
  (`POST /livewire-…/update`) to return **500 Internal Server Error**. A
  full-screen Laravel debug overlay appeared reading "Internal Server Error —
  `Illuminate\Database\QueryException`, SQLSTATE[22007]: Invalid datetime
  format: 7 ERROR: invalid input syntax for type date: ''", marked UNHANDLED,
  code 22007, on Laravel 13.20.0 / PHP 8.5.8. The overlay disclosed the failing
  SQL, which selects `business_date, cash_sales, online_sales, gross_sales,
  total_tips, cash_expenses, expected_cash` from a `v_daily_cash_summary` view
  inner-joined to `business_day` (for `status`, `actual_cash`,
  `cash_discrepancy`), with a malformed `where "business_date" between and
  2026-07-25` clause, plus the database connection details (pgsql, host `db`,
  port 5432, database `coffee_pos`). Behind the overlay the report still showed
  the previous range's figures. This was reproduced twice from a freshly loaded
  page.

#### CSV export

Clicking **Export CSV** downloads a file named
`ucm-report-{from}_to_{to}.csv` (observed: `ucm-report-2026-07-12_to_2026-07-25.csv`).
Its contents for the default range:

```
Date,Status,"Cash sales","Online sales",Gross,Tips,"Cash expenses","Expected cash","Actual cash",Discrepancy
2026-07-16,closed,0.00,0.00,0.00,0.00,0.00,1000.00,1000.00,0.00
2026-07-17,closed,908.00,108.00,1016.00,0.00,0.00,1908.00,1910.00,2.00
2026-07-20,closed,5000.00,3000.00,8000.00,0.00,500.00,6400.00,6350.00,-50.00
2026-07-21,closed,150.00,0.00,150.00,0.00,0.00,1150.00,1152.00,2.00
2026-07-23,open,50.00,0.00,50.00,0.00,0.00,1050.00,,
```

Differences between the export and the on-screen table:

- The CSV carries a **"Cash expenses"** column that the on-screen reconciliation
  table does not show at all (Jul 20 = 500.00, all other days 0.00).
- The on-screen column **Variance** is named **Discrepancy** in the CSV.
- CSV dates are ISO (`2026-07-16`) rather than "Thu, Jul 16"; status is
  lowercase (`closed`/`open`); amounts are plain decimals with no peso symbol
  and no thousands separators; negatives use a leading minus (`-50.00`).
- The open day exports with **empty** Actual cash and Discrepancy fields.
- The export covers the daily reconciliation only — the Top products table is
  not included.

### Open questions for the human

- **Blank report date crashes v1.** Clearing the From (or To) date on
  `/admin/reports` produces an unhandled database error and a 500 rather than
  any user-facing message. Should v2 treat an empty date as a validation error,
  retain the previous value, or fall back to a default — and what should the
  owner see when a report query fails?
- **Inverted date ranges are silently empty.** v1 accepts From later than To and
  renders "No days in this range.", which is indistinguishable from a range that
  genuinely has no trading. Should v2 validate the order of the dates, swap them
  automatically, or keep v1's silent-empty behaviour?
- **Error output exposes infrastructure detail.** The 500 overlay displayed the
  full SQL statement, view and table names, and the database host, port, and
  name. Is this purely a local development configuration, and what should v2's
  production error behaviour be for the back office?
- **"Today" does not mean today.** The Dashboard's "Today" section was headed
  "Today" but reported the open business day (Jul 23) while the calendar date
  was Jul 25, with "Open day · Jul 23" as a tile subtitle. Should v2 keep
  business-day semantics and rename the heading, or report the actual calendar
  day?
- **Charts skip days with no business day.** The "Sales — last 14 days" chart
  plotted only the five dates that have business-day records, so closed or
  untraded dates are absent from the axis instead of showing as zero. Should
  v2's 14-day trend show a continuous daily axis including zero days?
- **The CSV is richer than the screen.** "Cash expenses" appears in the export
  but nowhere in the on-screen reconciliation table, even though expected cash
  is calculated net of it. Should v2 surface cash expenses in the on-screen
  table as well, or deliberately keep the export more detailed?
- **"Variance" vs "Discrepancy".** The same figure is labelled "Variance" on
  screen and "Discrepancy" in the CSV (and `cash_discrepancy` in the underlying
  data). Which term should v2 standardise on?
- **Top products has no visible limit.** Only three products had sales in the
  available data, so I could not observe whether v1 caps the Top products table.
  Should v2 cap it (and at what number), or list every product with sales in the
  range?

---

## 2026-07-26 — Sales: Order History (admin back office)

Explored the admin back-office **Order History** resource at `/admin/sales-orders`
(the list, its filters, search, sorting, column manager, and the per-order View
page), signed in as the administrator. Same Filament v5.7.1 admin UI as the
Catalog, Inventory, Staff, and Reporting sections. Exploration was read-only: no
records were created, edited, or deleted. The only actions taken were changing
list filters, the search term, the sort column, and the per-page size — all
query-only controls — and opening View pages. Observed on 2026-07-26, when the
open business day was **Jul 23, 2026**.

### Navigation

**Order History** is the single child of the collapsible **Sales** sidebar group
and resolves to `/admin/sales-orders`. Its breadcrumb and page heading read
"Sales Orders" (the sidebar label "Order History" and the page title "Sales
Orders" differ). There is no navigation badge on the item.

### The resource is read-only

- The list has **no "New" button**, no bulk-select checkbox column, and no
  bulk-actions control. The only per-row action is **View**.
- `/admin/sales-orders/create` returns **404**, and
  `/admin/sales-orders/{id}/edit` returns **404** for a valid order id.
- The View page carries **no buttons at all** inside the page content — no Edit,
  no Delete, no Void, no Reopen, no print/receipt action.
- An unknown order id (`00000000-0000-0000-0000-000000000000`) returns **404**.

### Order list (`/admin/sales-orders`)

- Columns, left to right: **Day**, **#**, **Customer**, **Status**, **Payment**,
  **Total**, **Tip**, **Change owed**, **Completed at**, **Action** (View).
- Sortable column headers (rendered as buttons): **Day**, **#**, **Status**,
  **Total**, **Completed at**. **Customer**, **Payment**, **Tip**, and **Change
  owed** are not sortable.
- Every cell in a row is itself a link to that order's View page, so clicking
  anywhere in the row opens the order.
- A **Search** box, a **Filter** control, and a **Column manager** button are
  present. The column manager lists all nine data columns as individually
  toggleable.
- Pagination offers per-page sizes 5, 10, 25, 50 (default 10). 15 orders existed
  at time of exploration.
- Empty states render the text **"No sales orders"**.
- Amounts render with a `₱` prefix and thousands separators (e.g. `₱5,000.00`).
- Absent values render as an em dash (`—`): Payment and Completed at are `—` for
  parked orders, Completed at is `—` for the void order.
- **Day** renders as "Jul 23, 2026"; **Completed at** renders as
  "Jul 23, 2026 13:21:14" (date plus 24-hour time).

Seeded data at time of exploration (15 orders across four business days):

| Day | # | Customer | Status | Payment | Total | Tip | Change owed | Completed at |
|---|---|---|---|---|---|---|---|---|
| Jul 23, 2026 | 2 | Walk-in | Parked | — | ₱158.00 | ₱0.00 | ₱0.00 | — |
| Jul 23, 2026 | 1 | Jay | Completed | Cash | ₱50.00 | ₱0.00 | ₱50.00 | Jul 23, 2026 13:21:14 |
| Jul 17, 2026 | 7 | Ajoy | Completed | Cash | ₱200.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:54:06 |
| Jul 17, 2026 | 6 | Walk-in | Completed | Split (Cash + Online) | ₱408.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:33:40 |
| Jul 17, 2026 | 5 | Wes | Completed | Cash | ₱158.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:21:42 |
| Jul 17, 2026 | 4 | Thea | Completed | Online | ₱50.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:21:00 |
| Jul 17, 2026 | 3 | Thea | Completed | Online | ₱50.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:20:36 |
| Jul 17, 2026 | 2 | Thea | Completed | Cash | ₱50.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:19:53 |
| Jul 17, 2026 | 1 | Jay | Completed | Cash | ₱100.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 19:19:13 |
| Jul 21, 2026 | 2 | Risa | Completed | Cash | ₱150.00 | ₱0.00 | ₱0.00 | Jul 21, 2026 08:17:08 |
| Jul 21, 2026 | 1 | Ian | Parked | — | ₱100.00 | ₱0.00 | ₱0.00 | — |
| Jul 20, 2026 | 3 | Lola Nena | Parked | — | ₱120.00 | ₱0.00 | ₱0.00 | — |
| Jul 20, 2026 | 4 | Void Test | Void | Cash | ₱250.00 | ₱0.00 | ₱0.00 | — |
| Jul 20, 2026 | 1 | Walk-in 1 | Completed | Cash | ₱5,000.00 | ₱0.00 | ₱0.00 | Jul 19, 2026 19:13:42 |
| Jul 20, 2026 | 2 | Walk-in 2 | Completed | Online | ₱3,000.00 | ₱0.00 | ₱0.00 | Jul 19, 2026 19:13:42 |

Observable from that data:

- **Order numbers restart per business day** and are shared across statuses:
  Jul 20 has #1 (completed), #2 (completed), #3 (parked), and #4 (void); Jul 17
  runs #1–#7. Parked and void orders consume a number in the same sequence.
- The **default list order groups neither by Day nor by Completed at** — the
  rows above are in default order, and the Jul 17 block sits above Jul 21 and
  Jul 20. Orders are listed newest-created first, which is not the same as the
  Day column's order.
- An unnamed order shows the literal customer text **"Walk-in"**.
- A **void order retains its payment method** ("Cash") in the list but has no
  Completed at.
- The **Change owed** column keeps showing `₱50.00` for the Jul 23 #1 order even
  though that order's View page records the change as settled (see below) — the
  list column does not distinguish owed-and-outstanding from owed-and-settled.

### Filters

The Filter panel offers exactly two filters, plus a **Reset** and an **Apply
filters** button. Filters are deferred: changing a select does nothing until
**Apply filters** is clicked.

- **Status** — All / Parked / Completed / Void.
- **Payment** — All / Cash / Online / Split (Cash + Online).

Applying Status = Void narrowed the list to 1 result and set the URL to
`?filters[status][value]=void`.

There is **no date filter and no date-range filter** on this screen — no
business-day picker, no From/To. The only way to narrow to a period is to sort
by Day and read.

### Search

The Search box is a live, debounced filter and writes `?search=` to the URL. It
matches on **customer name only**, case-insensitively, as a substring:

- `Thea` → 3 results; `THEA` → the same 3 results (case-insensitive).
- `walk` → 2 results ("Walk-in 1", "Walk-in 2").
- `void` → 1 result — the order whose *customer name* is "Void Test", not the
  void-status order set.
- `House Blend` (a product on several orders) → no results.
- `7` (an order number) → no results.
- `2026-07-17` and `Jul 17` (business dates) → no results.
- `cash` (a payment method) → no results.
- `zzzz` → the "No sales orders" empty state.

### Sorting

Clicking a sortable header toggles ascending then descending and writes
`?sort=<column>:<direction>` to the URL (e.g. `?sort=order_number:desc`).

Sorting by **Day** ascending groups the days correctly (Jul 17 → Jul 20 →
Jul 21 → Jul 23), but within a day the rows are **not** secondarily ordered by
order number: Jul 20 appeared as #3, #4, #1, #2.

Sorting by **#** sorts on the order number across all business days at once, so
days interleave — descending produced 7, 6, 5, 4(Jul 17), 4(Jul 20), 3(Jul 17),
3(Jul 20), 2(Jul 23), 2(Jul 17), 2(Jul 21), 2(Jul 20), 1(Jul 23), 1(Jul 17),
1(Jul 21), 1(Jul 20).

### Order View page (`/admin/sales-orders/{id}`)

The page title and heading are "View {order number}" (e.g. "View 6"). Content is
three sections with these entries, in order:

**Order** — Order #, Day, Customer, Status, Service type, Payment.

**Items** — a repeating block per order line with: Product, Size, Qty, Discount,
Line total.

**Payment** — Subtotal, Discount, Total, Cash, Online, Tip, Cash received,
Change owed, Change settled, Completed at, Void reason.

That is the complete field list — 23 labels. Notably **absent** from the View
page: any **cashier / staff attribution**, any **free upsize** figure, and any
**taste preference or per-line note** (Sweeter / Stronger / Less sweet / Less
ice / free text). None of these appear anywhere on the list or the View page.

Observed records:

- **Void order** (Jul 20 #4, "Void Test"): Status Void, Service type Take-out,
  Payment Cash; one line — House Blend / M / Qty 5 / Discount None / ₱250.00;
  Subtotal ₱250.00, Discount ₱0.00, Total ₱250.00, Cash `—`, Online `—`, Tip
  ₱0.00, Cash received `—`, Change owed ₱0.00, Change settled `—`, Completed at
  `—`, **Void reason "wrong order"**. The void reason is free text and is shown
  in full.
- **Split payment** (Jul 17 #6, Walk-in): Payment "Split (Cash + Online)"; three
  lines — Milky Choco / Medio / 1 / ₱158.00, House Blend / M / 2 / ₱100.00,
  Signature Latte / M / 1 / ₱150.00; Subtotal ₱408.00, Total ₱408.00, **Cash
  ₱400.00 and Online ₱8.00** (summing to the total). Qty 2 on one line renders
  as a single line with a line total of 2 × the unit price, not two lines.
- **Change owed then settled** (Jul 23 #1, Jay): Total ₱50.00, Cash ₱50.00, Cash
  received ₱100.00, **Change owed ₱50.00**, **Change settled Jul 23, 2026
  13:21:53**, Completed at Jul 23, 2026 13:21:14. The settlement timestamp is
  separate from and later than the completion timestamp.
- **Change given immediately** (Jul 17 #7, Ajoy): Total ₱200.00, Cash received
  ₱300.00, **Change owed ₱0.00**. Change owed therefore records only change that
  was *not* handed over, not the arithmetic change due.
- **Discounted line** (Jul 20 #3, Lola Nena, Parked): one line — Signature Latte
  / M / Qty 1 / **Discount "Senior"** / Line total **₱120.00**; Subtotal
  ₱150.00, **Discount ₱30.00**, Total ₱120.00. The discount is named on the line
  and totalled at order level; ₱30.00 is 20% of ₱150.00. Undiscounted lines show
  Discount "None".
- **Parked order** (Jul 23 #2, Walk-in): Status Parked, Payment `—`; the Items
  and totals sections are fully populated (Subtotal/Total ₱158.00) while Cash,
  Online, Cash received, Change settled, Completed at are all `—` and Tip and
  Change owed are ₱0.00. A parked order therefore shows the same payment section
  as a completed one, with the money entries blank.
- **Service type** renders as "Dine-in" or "Take-out" and is present on parked
  and void orders as well as completed ones.

### Business date vs. completion timestamp

The Day column and the Completed at timestamp are independent and can disagree
in either direction in the stored data:

- Jul 17's orders #1–#7 all carry Completed at timestamps on **Jul 21**
  (19:19–19:54) — four days after their business day.
- Jul 20's orders #1 and #2 both carry Completed at **Jul 19, 2026 19:13:42** —
  the day *before* their business day.

The screen presents both values plainly with no warning, badge, or annotation
when they disagree.

### Open questions for the human

- **Order History shows no cashier.** DISCOVERY.md says each order shows its
  cashier and that the active cashier is how v1 attributes who rang up an order.
  The admin Order History list and View page expose no staff or cashier field at
  all. I did not explore the staff-facing POS order ledger in this run, so I
  could not confirm whether cashier attribution is visible there instead. Should
  v2's back-office order history show the cashier — and if v1 stores it but does
  not display it here, is that a gap to close or a deliberate omission?
- **Free upsizes and taste preferences are not shown.** DISCOVERY.md describes
  per-line taste preferences (Sweeter / Stronger / Less sweet / Less ice plus
  free text) and free upsizes worth ₱30, and says the staff ledger shows free
  upsizes. Neither appears anywhere on the admin View page. Should v2's owner
  order detail include them, or is the owner view intentionally money-only?
- **No date filtering on order history.** The screen filters only by status and
  payment; there is no business-day or date-range control, so finding a specific
  day's orders means sorting by Day and scrolling. The Reports screen, by
  contrast, has From/To dates. Should v2's order history offer a day picker or
  date range?
- **Search covers customer name only.** Product name, order number, business
  date, status text, and payment method all return no results. Should v2 widen
  order search (order number and date seem the most likely lookups for an
  owner), or keep it as a customer-name lookup?
- **Sorting by "#" ignores the business day.** Because order numbers restart each
  day, sorting by the "#" column interleaves days into runs of equal numbers,
  and sorting by Day does not order by "#" within a day. Should v2 sort order
  history by day-then-number as a unit?
- **"Change owed" stays populated after the change is settled.** The Jul 23 #1
  order shows Change owed ₱50.00 in the list while its View page records Change
  settled at 13:21:53. A reader scanning the list cannot tell outstanding change
  from change already handed over. Should v2's list distinguish them (e.g. show
  only outstanding change, or add a settled indicator)?
- **Completed at can fall outside the business day.** Seeded orders exist whose
  completion timestamp is four days after their business day (Jul 17 → Jul 21)
  and whose completion timestamp is the day before their business day (Jul 20 →
  Jul 19). I could not determine whether this reflects real v1 behaviour (e.g.
  a day left open across calendar dates, or backdated seeding) or only how this
  dataset was created, because confirming it would require completing an order.
  Should v2 constrain a completion timestamp to its business day, or accept and
  display the divergence as v1 does?
- **A cash-received figure below the order total exists in the data.** Jul 17 #1
  (Jay) shows Total ₱100.00 with **Cash received ₱90.00**, Cash ₱100.00 and
  Change owed ₱0.00, while DISCOVERY.md states short cash payments are blocked.
  I could not test the POS validation without completing an order, so I cannot
  say whether v1's POS would accept this today or whether the record predates
  the rule. Should v2 block cash received below the amount due, and what should
  happen to historical records that breach the rule?
- **Sidebar label and page title differ.** The sidebar says "Order History"
  while the breadcrumb, page heading, and browser title all say "Sales Orders".
  Which name should v2 use?

---

## 2026-07-30 — Inventory operations: staff count sheets, restock status & movements (staff POS workspace)

Explored the **staff** POS workspace inventory screens at `/inventory/opening`,
`/inventory/closing`, `/inventory/status`, and `/inventory/movements`, signed in
with the shared system login as the administrator. This is the operational
counterpart to the 2026-07-24 admin-side inventory findings (stock categories,
stock items, par levels); no earlier run had covered any staff POS screen.

Exploration was strictly read-only: no count was submitted, no movement was
recorded, no field was filled in. Every form below was observed in its initial
state only. The screens are not the Filament admin UI — they are a separate
touch-first layout with large controls (buttons have a 48px minimum height).

Environment at time of exploration: one business day was open, **Thu, Jul 23
2026**, flagged **Normal day**, with **no stock count submitted for it yet**.
That state fixed what was observable and what was not (noted per screen).

### Staff POS shell and navigation

- Every staff screen shares a header: the shop name (linking to `/pos/order`), a
  horizontal nav, a **Toggle dark mode** button, and a **Set cashier** link to
  `/pos/cashier`.
- The nav has nine links in this order: **Open Day** (`/pos/open`), **Take
  Order** (`/pos/order`), **Order History** (`/pos/orders`), **Cash & Expenses**
  (`/pos/cash`), **Close Day** (`/pos/close`), **Opening**
  (`/inventory/opening`), **Closing** (`/inventory/closing`), **Restock**
  (`/inventory/status`), **Deliveries & Wastage** (`/inventory/movements`).
  Inventory therefore sits in the same flat nav as the day and order screens,
  under `/inventory/*` rather than `/pos/*`.
- All four inventory screens loaded while **no cashier was set** (the header
  still offered "Set cashier"). They do not require an active cashier; each
  identifies the person through its own staff select instead.
- Each screen's header carries a right-aligned pair of chips. On the three
  count/movement screens these read the business date ("Thu, Jul 23 2026") and
  the day type ("Normal day"). On the Restock screen the second chip instead
  names the count source ("Opening count").
- No numeric attention badge appeared on the **Restock** nav link. With no count
  submitted for the open day, no count-derived indicator was rendered anywhere
  in the nav.
- The nav's current-page link carries no `aria-current` attribute; the active
  item is conveyed by styling only.

### Opening count (`/inventory/opening`)

- Heading "Opening count", subtitle "Short sheet — critical items."
- Two selects above the item list:
  - **Submitted by** — marked required (`*`), placeholder option "Select staff…"
    selected by default.
  - **Shift lead** — not marked required, default option "—".
  - Both list the same three names: **Ben**, **Carmen**, **Rodette Sevilla**.
    The roster (per the 2026-07-25 staff findings) holds four staff, of which
    "Ana Banana" is inactive; the inactive member is absent from both selects.
  - No third role select was present on this sheet (no "production support" or
    "backup" field was rendered).
- The sheet listed **5 items**, each badged **critical**: Coffee/Non-Coffee Cup
  (16oz · pcs), Coffee/Non-Coffee Lid (16oz and 12oz · pcs), Full Cream Milk
  (carton), Water (container), Yakult (bottle). Each row shows the item name and
  a secondary line combining size (when set) and unit.
- These are exactly the five items flagged **Critical = Yes** in the admin stock
  items list; **Straw** (Critical = No) does not appear.
- Items counted by **quantity** render a single number input: `min="0"`, no
  `max`, `inputmode="numeric"`, empty value with placeholder "0".
- **Water**, the one item whose admin count method is **Level**, renders no
  number input. It renders a row of eight level buttons instead: **Empty**,
  **Low**, **Quarter**, **One-third**, **Half**, **Two-thirds**,
  **Three-quarters**, **Full**. None was pre-selected — the item starts unset.
- A single **Submit opening count** button sits at the foot of the sheet. It was
  **enabled** with every field still empty and no staff selected.
- The form is a Livewire form (`wire:submit`); the inputs carry no `name` or
  HTML `required` attributes, so validation is server-side. Because submitting
  would create a count record, no validation message was observed.

### Closing count (`/inventory/closing`)

- Heading "Closing count", subtitle "Full sheet — every active item."
- Identical structure to the opening sheet: same **Submitted by** (required) and
  **Shift lead** (optional) selects, same three staff options.
- The sheet listed **6 items** — the five critical items above **plus Straw**
  (pcs), which carries no "critical" badge. That matches the six active stock
  items in the admin list.
- Item order differs between the two sheets. Opening lists its five critical
  items alphabetically by name. Closing lists the same five critical items
  first, in the same alphabetical order, and appends the non-critical **Straw**
  last — i.e. critical items sort ahead of non-critical ones rather than the
  whole sheet being alphabetical. Neither sheet follows the stock-category sort
  weights recorded on 2026-07-24 (Water & Ice 0, Cups 1, Lids 2, Dairies 3,
  Others 4).
- Water again renders the same eight level buttons; quantity items render the
  same `min="0"` numeric inputs.
- Button label is **Submit closing count**; also enabled with the sheet empty.
- The closing sheet shows **no expected figures, no opening count, and no
  variance column** — it collects physical counts only. No warning about a
  missing opening count was displayed even though none had been submitted for
  the open day.
- DISCOVERY.md states a submitted closing sheet becomes read-only. That state
  could not be observed: no count existed for the open day, and submitting one
  would mutate v1.

### Restock status (`/inventory/status`)

- Heading "Restock status", subtitle "Counts vs par for the day. Restock the top
  of the list first."
- The second header chip read **"Opening count"**, naming the count the page is
  reading from, consistent with DISCOVERY.md's rule that closing is used when
  available and opening otherwise.
- A table with four columns: **Item**, **Counted**, **Par**, **Status**.
- With no count submitted, the table body held a single full-width empty-state
  row: **"No count has been submitted for this day yet."** No items, pars, or
  status badges were listed.
- Because the open day had no count, the populated behaviour could not be
  observed: the urgent / low / below par / enough classifications, the
  urgency ordering, and the peak-vs-normal par column were all unobservable
  without submitting a count.

### Deliveries & wastage (`/inventory/movements`)

- Heading "Deliveries & wastage", subtitle **"Adjust stock between counts. Each
  entry is permanent."**
- An entry form with five controls:
  - **Item** — marked required, select, placeholder "Select item…". Options list
    all six active stock items, alphabetically, with size appended where set:
    "Coffee/Non-Coffee Cup · 16oz", "Coffee/Non-Coffee Lid · 16oz and 12oz",
    "Full Cream Milk", "Straw", "Water", "Yakult". **Water is selectable even
    though it is counted by level, not quantity.**
  - **Type** — marked required, a two-button pair **Delivery** / **Wastage**.
    **Delivery** is pre-selected (rendered filled; Wastage outlined). Selection
    is conveyed by styling only — neither button carries `aria-pressed`.
  - **Quantity** — marked required, number input, `min="0"`, `step="any"`
    (decimal values are accepted by the control), placeholder "0", empty by
    default.
  - **Recorded by** — **not** marked required, select defaulting to "—", same
    three active staff names.
  - **Reason** — **not** marked required, free-text box, placeholder "e.g. AM
    delivery, dropped tray".
- **Record movement** button, enabled with the form empty.
- Below the form, a table of the day's movements with columns **Item**,
  **Type**, **Qty**, **Reason**, **By**. Its empty state read **"No movements
  recorded today."**
- The table shows no timestamp column and no per-row edit or delete action,
  consistent with the "Each entry is permanent" subtitle.

### Not observable in this run

Recorded so the gaps are not mistaken for absent behaviour:

- A submitted count sheet (its read-only state) and a populated restock table
  with status badges and urgency ordering — both require submitting a count.
- Server-side validation messages on all three forms (required-field errors,
  whether a quantity item may be left blank, whether a level item must be set).
- Peak-day par behaviour: the only open day was flagged "Normal day".
- What these four screens show when **no** business day is open.
- Whether the back office can review submitted counts or movements at all: the
  admin sidebar lists only Dashboard, Staff, Reports, Order History, Product
  Categories, Products, Stock Categories, Stock Items. No admin resource for
  counts or movements was present.

### Open questions for the human

- **Quantity movements against a level-counted item.** The movements Item select
  offers **Water**, whose count method is **Level** (counted with Empty…Full
  buttons, never a number), yet the form's only quantity control is a numeric
  input. I did not record a movement, so I could not see how v1 stores or
  applies a numeric delivery against a level-counted item, nor whether it
  affects that item's restock status. Should v2 allow deliveries and wastage on
  level-counted items, and if so in what unit?
- **Decimal quantities on whole-unit items.** The movement quantity input allows
  decimals (`step="any"`) for every item, including cups, lids, straws and
  bottles that are counted in `pcs`. The count sheets' quantity inputs use the
  default integer step instead. Should v2 allow fractional movement quantities,
  and should the movement input match the item's unit the way the count sheet
  does?
- **Submit buttons are enabled on an empty sheet.** All three forms let the user
  press Submit / Record with nothing filled in and no staff selected, and
  validation is server-side only. I could not observe what comes back without
  mutating v1. Should v2 block submission until the required fields are set, and
  should a count sheet with some items left blank be rejected, or accepted with
  those items treated as uncounted (which is different from counted zero)?
- **No back-office view of counts or movements.** Submitted counts and
  movements appear only on the staff screens for the current business day, and
  the closing sheet is described as becoming read-only after submission. The
  admin panel offers no resource for either, so once a day is closed there is no
  observed way for the owner to review what was counted or which wastage was
  recorded, or to correct a mistaken entry. Should v2 give the owner a read-only
  history of counts and movements — and, given "each entry is permanent", how
  should a wrong count or a mis-keyed wastage entry be corrected?
- **No missing-opening-count warning on the closing sheet.** DISCOVERY.md notes
  the *closing day* screen warns when a closing count is missing. The closing
  *count* sheet showed no warning that no opening count existed for the open day,
  even though cup and lid variance needs both. Should v2 warn at count time that
  the opening count is missing?
- **Level scale is finer than the business description.** DISCOVERY.md describes
  level counting as "empty, quarter, half, or full"; the sheets offer eight
  steps (Empty, Low, Quarter, One-third, Half, Two-thirds, Three-quarters,
  Full), mixing fractions with a qualitative "Low". Should v2 keep all eight
  steps, and is "Low" intended as a level or as a status?

---

## 2026-07-31 — Business day opening and closing (staff POS workspace)

Explored the staff POS workspace at `/pos/open` and `/pos/close`, signed in
with the shared system login as the administrator. Exploration was strictly
read-only: the open business day was not changed, no day was closed, and no
field was submitted. To observe the close form's live calculation, values were
typed into **Actual cash counted**, then the page was reloaded; the values were
not submitted and did not persist.

Environment at time of exploration: one business day was already open,
**Thursday, Jul 23 2026**, marked **Normal day**. Its opening inventory count
and closing inventory count had not been submitted. One completed cash order
for ₱50.00 existed on the day.

### Open business day (`/pos/open`)

- The page heading is **"Open business day"** with the subtitle **"Start the
  day everything else anchors on — orders, cash, and counts."**
- Because a day was already open, the screen showed a read-only **DAY OPEN**
  summary instead of an opening form.
- The summary showed **Thursday, Jul 23 2026** and **Normal day**.
- It showed **Cash float ₱1,000.00**, **Opened by Rodette Sevilla**, and
  **Opened at 1:16 PM**.
- Below the summary, the page said **"Take orders and record cash against this
  day; close it at end of shift."**
- There was no action to open another day, edit the open day, or close it from
  this screen. Apart from the shared dark-mode toggle, the page contained no
  form control.

### Close business day (`/pos/close`)

- The page heading is **"Close business day"** with the subtitle **"Review
  both reconciliations, count the drawer, then close."**
- A warning appeared above the reconciliation:
  **"No closing count submitted yet — cup/lid variances won't be snapshotted.
  Do the closing count."** The final sentence is a link to
  `/inventory/closing`.
- The **Cup / lid balance** table has columns **Item**, **Expected**,
  **Actual**, and **Var**.
- It listed two reconciled items: **Coffee/Non-Coffee Cup · 16oz** and
  **Coffee/Non-Coffee Lid · 16oz and 12oz**. Both showed **-1** Expected and an
  em dash for Actual and Var.
- The **Cash summary (online sales excluded)** showed these rows:
  Cash float ₱1,000.00; Cash sales ₱50.00; Online sales (excluded) ₱0.00;
  Cash tips +₱0.00; Cash in +₱0.00; Cash out −₱0.00; Expenses (cash) −₱0.00;
  Expected cash ₱1,050.00.
- **Actual cash counted** is visibly marked required (`*`). Its control is a
  number input with placeholder `0.00`, minimum `0`, and step `0.01`.
- **Discrepancy** initially showed an em dash. Typing an actual count updated it
  without submitting: 1050.00 showed **₱0.00**, 1049.50 showed **₱-0.50**, and
  1051.25 showed **₱1.25**.
- A negative discrepancy places the minus sign after the peso symbol
  (`₱-0.50`), matching the formatting observed in the admin Reports table.
- **Discrepancy reason** is an unmarked text field with placeholder
  **"e.g. short by change given, over from tips"**. It did not become visibly
  required when the live discrepancy was non-zero.
- **Closed by** is an unmarked select that defaults to an em dash. Its options
  were the three active staff members **Ben**, **Carmen**, and
  **Rodette Sevilla**; inactive **Ana Banana** was not offered.
- The **Close day** submit button was enabled while Actual cash counted was
  blank, Closed by was unset, and no closing inventory count existed.
- Although Actual cash counted has a visible required marker, the input did not
  have an HTML `required` attribute. Closed by and Discrepancy reason also had
  no HTML `required` attribute. Validation could not be observed without
  attempting the mutating close action.
- Reloading after typing test amounts restored Actual cash counted to blank and
  Discrepancy to an em dash, confirming the unsubmitted values had not
  persisted.

### Not observable in this run

- The day-opening form, its defaults, constraints, and validation because v1
  permits only one open business day and closing the existing day would mutate
  data.
- Server-side validation from **Close day**, including whether Actual cash
  counted or Closed by is enforced and whether a discrepancy reason is required
  for a non-zero result.
- The closed-day result or stored closing snapshot because closing the day would
  mutate data.
- Final cup/lid Actual and Var figures because no closing inventory count had
  been submitted.
- The opening and closing screens when no business day is open.

### Open questions for the human

- **Closing is offered without a closing inventory count.** v1 warns that
  cup/lid variances will not be snapshotted and links to the closing sheet, but
  leaves **Close day** enabled. Should v2 allow the day to close after this
  warning, or require a closing count first?
- **Expected cup and lid stock is negative when the opening count is missing.**
  With no opening count and one completed drink sale, both Expected figures
  showed `-1` rather than unavailable. Should v2 display a negative expected
  quantity in this state, or show that reconciliation cannot be calculated
  until an opening count exists?
- **Closed by appears optional.** The select has no required marker, defaults to
  an em dash, and the submit action remains enabled. Should v2 require an active
  staff member to be identified before the day can close?
- **A non-zero cash discrepancy does not visibly require a reason.** The reason
  field remained optional-looking for both a ₱0.50 shortage and a ₱1.25
  overage. Should v2 require a reason whenever actual cash differs from
  expected cash?
- **The close action is enabled before visibly required data is entered.**
  Actual cash counted is marked required, but **Close day** remains enabled
  while it is blank. Should v2 leave submission available and return validation
  afterward, or disable it until the visible prerequisites are present?
