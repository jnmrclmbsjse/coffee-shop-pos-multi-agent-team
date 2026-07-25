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
