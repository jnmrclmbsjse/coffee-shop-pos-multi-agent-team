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
