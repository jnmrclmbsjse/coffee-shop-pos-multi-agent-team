# Issue #55 Inventory Administration Mockup

Open `index.html` directly in a modern browser. The mockup has no external dependencies and does not require a build step.

## Included Files

- `index.html`: semantic application shell and all prototype views
- `styles.css`: supplied UCM visual tokens and component states
- `responsive.css`: tablet and mobile layout behavior
- `app.js`: sample data, filtering, tabs, drawers, validation, ordering, deletion guards, and feedback
- `PRODUCT.md`: product register, users, purpose, principles, accessibility, and non-goals
- `DESIGN.md`: exact visual tokens and component/responsive decisions
- `brand-spec.md`: compact source-of-truth token binding and posture rules

## Screens and States

### Stock items

- Default table with six representative records
- Search and combined AND filters for category, count method, Reconciled, Critical, and Active
- Collapsed filter disclosure below 760px
- Responsive labeled records below 760px
- Empty filtered state with recovery action
- Add and edit item right-side drawer
- Full-screen item sheet on mobile
- Reconciled coupling that forces Quantity and disables Level
- Rejected Reconciled plus Level server example with unchanged saved values
- Independent Normal day and Peak day par values
- Local par validation plus failed-save summary
- Successful delete for an unreferenced item
- Blocked delete for a Cup/Lid item referenced by a catalog product size

### Categories

- Saved sort-weight order and consistent item counts
- Numeric sort-weight editing
- Accessible Move up and Move down controls
- Create and edit category drawer/sheet
- Successful deletion of an empty category
- Blocked deletion of a category that contains stock items
- Persistence feedback after order changes

## Interaction Instructions

1. Use the `Stock items` and `Categories` tabs to switch primary views.
2. Search or combine filters. All active filters use AND semantics. Choose values that produce no matches to see the recovery state.
3. Select any item name or `Add stock item` to open the editor.
4. Enable `Reconciled (cup/lid)` to see Quantity selected and Level disabled.
5. Use `Show rejected saved example` to inspect the server-rejected Reconciled plus Level state.
6. Enter invalid par values, then choose `Save stock item` to see field messages and the error summary. Enter `0` to confirm zero is valid.
7. Delete `Bottled Water` for the successful path. Delete `16oz PET Cup` or `16oz Flat Lid` for the blocked referenced-item path.
8. In Categories, edit sort weights or use move buttons to reorder. Open `Others` to demonstrate successful empty-category deletion, or open a populated category to see the delete guard.
9. Use Escape or the close button to dismiss a drawer. Tabs and all controls are keyboard reachable.

## Acceptance Criteria Coverage

- Administrators can manage stock items and categories from one Inventory surface.
- Filters visibly combine with AND behavior and can be cleared.
- Stock records expose category, unit, size, count method, Critical, Reconciled, Active, and actions.
- Reconciled is constrained to Quantity in the client, and rejected persisted combinations are explained without changing saved values.
- Par levels enforce whole, non-negative values and `Urgent ≤ Low ≤ Par` independently for Normal and Peak days.
- Delete guards preserve referenced items and non-empty categories.
- Category ordering is explicit, accessible, and accompanied by persistence messaging.
- Responsive layouts avoid page-level horizontal overflow at desktop, tablet, and phone widths.
