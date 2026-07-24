# UCM Coffee Studio POS — Business Discovery

## 1. Product purpose

UCM Coffee Studio POS is the operating system for a single coffee shop. It replaces sticky-note
orders, handwritten inventory records, and manual end-of-day cash calculations with one consistent
daily workflow.

The product is intended to:

- help counter staff take and settle orders quickly on a tablet;
- show who handled each order without requiring every staff member to have a separate system login;
- give the team a practical way to count supplies, record deliveries and wastage, and spot restock
  needs;
- reconcile the cash drawer and the shop's highest-value consumables at closing; and
- give the owner a reliable history of sales, payments, expenses, stock activity, and daily
  discrepancies.

The system is designed for in-shop use on a landscape tablet with a reliable Wi-Fi connection. It
does not currently support offline operation or multiple branches.

## 2. Where to access the product

The two main local entry points are:

- **Admin and owner workspace:** [http://localhost:8080/admin](http://localhost:8080/admin)
- **Staff POS workspace:** [http://localhost:8080/pos/order](http://localhost:8080/pos/order)

Both areas use the same system authentication. There is currently no direct link from the admin
workspace to the POS, so users must open the POS URL directly or keep it bookmarked. The hostname
will change when the product is deployed, but the `/admin` and `/pos/order` paths are the intended
entry points.

## 3. People and access

### Counter and shift staff

Staff use the touch-friendly workspace for opening and closing the day, taking orders, counting
inventory, recording movements, and reviewing the day's orders.

The shop uses a shared system login, while the active cashier is selected separately from the staff
roster. A staff member may have an optional PIN. If a PIN is configured, it must be entered before
that person becomes the active cashier. Orders are then attributed to that cashier. The system still
allows an order to be taken when no cashier has been selected so service is not blocked.

Inventory roles are assigned per count sheet rather than being permanent staff roles. A person may
be the shift lead on one day and production support or backup staff on another.

### Owner or administrator

The owner uses the back-office area to maintain products, prices, sizes, stock items, par levels,
and the staff roster. The owner can also review order history, sales performance, cash
reconciliation, and product trends.

Historical master records are protected. A staff member, product, or stock item may be deleted only
when it has never been referenced by operational records. Otherwise, it must be deactivated so past
transactions remain understandable.

## 4. Daily operating workflow

Each operating date is managed as one **business day**. Sales, counts, movements, expenses, and
closing results all belong to that day.

1. **Select the cashier.** Staff choose who is currently ringing up orders and enter their PIN when
   required.
2. **Open the day.** Staff record the business date, whether it is a normal or peak day, the opening
   cash float, and the person opening. Only one day may remain open at a time, and a date cannot be
   opened twice.
3. **Complete the opening count.** The opening sheet is deliberately short and contains only items
   marked as critical.
4. **Operate the shop.** Staff take orders, record deliveries and wastage, record cash movements and
   expenses, and monitor restock warnings.
5. **Complete the closing count.** The closing sheet contains all active stock items and becomes
   read-only after submission.
6. **Close and reconcile.** Staff enter the physical cash count. The system compares it with the
   expected drawer amount, calculates cup and lid variances, and stores the closing result.
7. **Review performance.** Staff can review the daily order ledger, while the owner can review
   longer-term sales and reconciliation reports.

All staff-facing screens use a full-width, touch-first design with large controls. A dark theme is
available for comfort in different lighting conditions.

## 5. Products and availability

Products belong to ordered categories so the most useful categories and items can appear first on
the POS.

A product may have multiple sizes. Price belongs to the size, not to the general product, because
each size may have a different selling price and consume a different cup and lid. Each sellable
size is therefore mapped to its corresponding cup and lid stock items.

Two separate availability decisions are maintained:

- **Active** controls whether the product is part of the managed catalog.
- **Available** is a temporary service-time control for marking a product sold out.

Counter staff can switch availability directly from the order screen. A sold-out product remains
visible for awareness but cannot be added to an order. The owner can also manage availability from
the back office.

## 6. Order taking and customer preferences

New orders default to **dine-in**, with **take-out** available as an alternative. A customer name may
be added for identification and cup labeling; unnamed orders are treated as walk-ins.

Staff select products and sizes from the product grid. Repeated taps on the same undiscounted size
increase its quantity instead of creating unnecessary duplicate lines. Quantities may be increased,
decreased, or removed while the order is still open.

Taste preferences are recorded per order line so different drinks in one order can have different
instructions. Staff have quick-action buttons for:

- Sweeter
- Stronger
- Less sweet
- Less ice

These options are multi-select. Staff may also retain or add free-text notes for requests not
covered by the quick actions.

### Discounts

PWD and Senior discounts are a flat **20%** and are applied per line item. This supports group
orders where only the eligible person's items should be discounted. The product does not capture
PWD or Senior ID details.

Prices and discounts are snapshotted with the sale so later catalog price changes do not rewrite
historical orders. Order totals are calculated consistently by the system and are not manually
editable.

### Park, resume, complete, and void

An order is saved as soon as its first item is added. Staff may park it and resume it later without
losing its contents. An empty parked order is discarded.

Each business day has its own sequential order numbers. Completed orders feed sales, cash, and
cup/lid calculations. Parked and void orders do not.

Completed transactions are not silently edited. If a correction is required, staff must void the
order with a reason and enter the corrected order again. The order history is read-only so the
original activity remains visible.

## 7. Payment and promotion rules

The POS supports:

- cash;
- online payment; and
- split payment between cash and online.

For a split payment, staff enter both portions and their sum must equal the amount due. Negative
allocations and short cash payments are blocked. Leaving “cash received” blank means the customer
paid the exact cash amount.

### Tips

Tips are cash-only. They are tracked separately from sales revenue, but they are included in the
expected drawer cash because the money is physically present until distributed to staff after the
count.

### Change

When staff enter the amount tendered, the POS shows the change due. If the shop cannot provide the
change immediately, staff can mark it as owed to the customer.

Outstanding change remains visible on the order screen. Because that money is still physically in
the drawer, it remains part of expected cash until staff confirms that the change has been handed
over. Settling it records when the obligation was completed.

### Free upsize

A free upsize has a fixed value of **₱30** and is available only when the order contains a product
from a coffee category. More than one free upsize can be recorded when applicable.

The giveaway lowers what the customer pays and is reported against the order. It is not subtracted
from the expected drawer a second time because the reduced customer payment has already accounted
for it.

Coffee eligibility currently depends on the product category name containing “coffee.” Category
names should therefore remain clear and should avoid misleading names such as “Non-Coffee,” which
would also match this rule.

## 8. Cash movements and expenses

The system distinguishes three kinds of non-sale money activity:

- **Cash in** records physical money added to the drawer.
- **Cash out** records physical money removed from the drawer.
- **Expense** records a business expense with a category and reason.

These are kept separate so the same outflow is not counted twice. Cash movements and expenses are
append-only operational records for the business day.

The free-upsize giveaway is also represented in reporting as an order-linked, non-cash expense. It
does not reduce expected cash because no additional money left the drawer.

## 9. Inventory and restocking

Stock items may be counted in one of two practical ways:

- **Quantity** for items that can be counted exactly, such as cups and lids.
- **Level** for items that are more naturally estimated, such as empty, quarter, half, or full.

Each item can have separate par thresholds for normal and peak days. Counts are classified as
**urgent**, **low**, **below par**, or **enough**. The restock screen orders items by urgency and uses
the closing count when available; otherwise, it uses the opening count. The main navigation also
surfaces the number of items needing attention.

Deliveries and wastage are recorded during the day with the affected stock item, quantity, and
reason. These movements are included in the relevant inventory calculations.

### Reconciled and count-only stock

Only cups and lids are formally reconciled against sales. Each completed drink sale consumes the
cup and lid mapped to its selected size.

Milk, Yakult, straws, and similar supplies are count-only in the current product. They support
visibility and restock decisions but are not automatically deducted by recipe or volume.

## 10. Closing and reconciliation

The system performs two core reconciliations at closing.

### Cup and lid reconciliation

For each reconciled cup or lid:

> Expected closing stock = opening count + deliveries − completed sales − wastage

The physical closing count is compared with the expected amount. Any difference becomes the
variance for investigation. Parked and void orders do not consume stock.

### Cash reconciliation

Expected drawer cash is based on:

> Opening float + cash sales + cash tips + unsettled customer change + cash in − cash out −
> cash-affecting expenses

Online sales are deliberately excluded because they never entered the physical drawer. This fixes
a known weakness in the former paper process, which used gross sales and could overstate expected
cash.

Split payments contribute only their cash portion to the drawer. Free-upsize giveaways are shown
for reporting but do not reduce the drawer calculation. Settled customer change is no longer
treated as cash still held.

At closing, staff enter the actual cash count and may give a reason for any discrepancy. The system
stores the expected cash, actual cash, discrepancy, tips, expenses, and other daily totals. It also
stores cup and lid variances and marks the business day closed.

The closing screen warns staff when a closing inventory count is missing because cup and lid
variances cannot be finalized without it.

## 11. History, dashboards, and reports

### Staff order history

Staff have a read-only order ledger that defaults to the currently open day, or the latest day when
none is open. They may choose a past closed day and filter orders by:

- completed, parked, or void status;
- cash, online, or split payment; and
- customer name.

Each order shows its items, discounts, cashier, payment breakdown, tip, free upsizes, owed or
settled change, and void reason where applicable.

### Owner views

The back office provides:

- read-only cross-day order history and order details;
- current open-day figures, or the latest day when none is open;
- order count, gross sales, cash sales, online sales, average order value, and cash tips;
- a 14-day cash-versus-online sales trend;
- top products by revenue over the last 14 days;
- date-range totals for gross, cash, online, and tips;
- a daily reconciliation table showing expected cash, actual cash, and variance;
- top products by quantity and revenue for the selected period; and
- CSV export of the daily reconciliation report.

Only completed orders contribute to sales and best-seller reporting.

## 12. Record integrity and accountability

The product favors traceability over silent correction:

- submitted stock counts become read-only;
- completed orders are corrected through void and re-entry;
- order history is read-only;
- referenced catalog and roster records are deactivated instead of deleted; and
- closing results are stored as a daily snapshot.

Voids and day closing are recorded in the audit trail. Audit coverage for some other actions,
including order creation, completion, and reopening, is not yet complete and remains an operational
control gap.

The active cashier identifies who rang up an order, but it is not a substitute for individual user
accounts or a complete staff authorization system.

## 13. Deliberate boundaries

The following are outside the current product scope:

- BIR or official receipt issuance;
- VAT calculation and reporting;
- capture or validation of PWD/Senior identification;
- automatic ingredient deduction by recipe or milk volume;
- multiple shop locations;
- offline operation; and
- separate application logins and permission sets for every staff member.

These boundaries keep the current product focused on the shop's immediate order, inventory,
drawer-control, and management-reporting needs.

## 14. Known readiness items

The main operating modules are present, including product management, inventory, POS, closing,
order history, dashboards, and reports. Before treating the product as fully production-ready, the
remaining operational work includes:

- completing audit coverage for important actions not yet recorded;
- confirming the real administrator setup and deployment credentials;
- aligning remaining environment and runtime configuration; and
- continuing hands-on shop testing for touch usability, validation gaps, and closing-day edge
  cases.

These are readiness and control items rather than changes to the core business workflow described
above.
