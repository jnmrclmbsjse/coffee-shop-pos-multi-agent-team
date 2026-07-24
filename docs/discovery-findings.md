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

### Open questions for the human

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
