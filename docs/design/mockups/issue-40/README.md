# UCM Coffee Studio story #40 design reference

Open `index.html` in a browser. It is a self-contained responsive reference, not application code.

## Navigation and representative states

- **Categories** shows stored sort weights, active state, product counts, unique-name validation, drag-only ordering, and immediate persisted-order feedback.
- **Products** implements case-insensitive partial product-name search, category and active-state filters, three sort modes, direct availability changes, and create/edit paths.
- **Product editor** separates catalog active state from service availability. It includes repeatable draggable sizes, peso prices, optional current Cup/Lid mappings, row-level validation, a stale mapping example, and a sale-referenced removal block.
- **POS menu** keeps sold-out products visible and disabled while excluding inactive catalog products. Staff can change temporary availability from the same surface.

## Interaction decisions

Category and size weights are derived from drag order, so no numeric ordering control is exposed. Drag handles also support keyboard reordering: focus a handle, press Space to lift, use Up/Down, then press Space to drop.

Catalog state answers “should this product be offered?” Availability answers “can staff sell it right now?” Those states use distinct labels and behavior everywhere.

Prototype changes use browser local storage to make reload and re-navigation behavior inspectable. The reference deliberately promises refresh-on-open behavior, not live push.

Price inputs display Philippine pesos and accept zero. Missing and negative values block save with the affected row identified. The implementation note about integer cents is intentionally kept out of the editing interaction.

Only current stock-item selector options are accepted. Blank mappings are valid. The Large size demonstrates useful recovery copy for a stale stored mapping.

## Responsive behavior

The desktop navigation rail becomes a four-item bottom navigation below 760px. Data tables become labelled record rows, the editor summary moves below the form, and the POS order panel follows the menu. Controls remain at least 44px tall and the page does not require horizontal scrolling.
