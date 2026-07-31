# Design decisions

## Preserve-mode audit

This is a targeted extension of the shipped UCM Coffee Studio staff workspace, not a redesign.

Preserved:

- Brand lockup `UCM Coffee Studio` with the `Staff` role tag
- Header meta chips and horizontal staff navigation
- Active navigation indicated with the reserved green selection color
- Cool bright background, white panels, and subtle secondary fills
- One system font family with weight-led hierarchy
- Hairline borders, compact density, 48px fields, and 44px minimum targets
- Tablet-first 1440px workspace with 32px padding and 16px mobile padding
- Control and panel radius roles from the fixed token contract

The screen uses the existing native CSS system because the brief binds it directly and prohibits network or dependency use.

## Read-only structure

Read-only behavior is visible in three layers:

1. The page head includes a quiet `Read only` label and a direct subtitle.
2. The ledger cards contain only headings, definitions, line items, and factual notes. They contain no actionable element.
3. The persistent correction guidance explains the permitted workflow and explicitly says that history never changes an order.

There is no primary action button. The production control cluster is titled `Find an order`, and every control changes only the view. The only recovery action clears filters.

## Status treatment

Status is always written in full and carried by shape, weight, border style, and restrained color reinforcement.

- Completed uses a lightly mixed affirmative surface and solid border. Green is used because completion is an affirmative recorded state.
- Parked uses the existing warm informational tokens and a solid border.
- Void is neutral, dashed, and struck through. It does not use `--danger` because void is an archival fact, not an error caused by the staff member viewing the screen.

This avoids a red-versus-green dependency and keeps `--danger` reserved for situations that need error urgency.

## Change given and change still owed

Both fixtures show the same `₱50.00` amount. The settled state uses a neutral solid container; the unsettled state uses the literal `Change still owed`, a dashed border, and the existing warm informational surface. The label and border pattern remain meaningful without color.

## Compact-card density

The ledger uses two columns on landscape tablet and desktop, then one column below 768px. DOM order remains descending by order number, so CSS grid fills left to right and then moves down without changing reading or screen-reader order.

Each card has four dense zones:

- Order identity and status
- Definition list for payment, completion, optional cashier, and total
- Payment breakdown
- Complete order-line list plus exceptional facts

Cards have hairline structure, no decorative elevation, and no expanded-receipt spacing.

## Correction guidance

The correction region is persistent, non-dismissible, and outside the filter controls. Its secondary surface and neutral border make it guidance rather than a warning or error. The `History only` label reinforces scope without adding an action. It has `data-testid="correction-guidance"` for stable QA selection.

## Filter behavior

The filter bar is sticky at the top of the scrolling viewport on tablet and desktop. On narrow screens it becomes static to avoid covering too much vertical space. The payment helper makes exclusivity visible. The result count sits in a polite live region.

Day changes update only the selected day identity. Other filters stay rendered and applied.

## Empty states

One composition handles three causes with different explanatory copy:

- No orders in the selected day
- Existing orders excluded by filters
- No business day exists

Only the filter-excluded case includes a recovery control. It clears filters and cannot affect an order.

## Motion

`MOTION_INTENSITY: 2`. The product surface has no automatic animation. The only physical feedback is a 1px button press on the clear and mockup controls. Reduced-motion CSS removes residual timing.

## Responsive behavior

- 1050px and below: filters become a two-column grid.
- Below 768px: shell padding becomes 16px, cards and filters become one column, the sticky filter becomes static, and guidance stacks.
- At 430px: metadata becomes one column, order-line size wraps below the product, and the clear action fills the available width.
- Shell navigation stays horizontally scrollable rather than wrapping into a broken second line.
