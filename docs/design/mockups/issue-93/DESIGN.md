# UCM Coffee Studio Admin Order History Design

## Design read

This is an internal, high-frequency Admin product for a single-location coffee shop owner working in a bright back-office environment. The visual language is calm, operational, compact, and consistent with the supplied Reports mockup system. Design serves rapid comparison and accurate historical lookup.

## App shell

Desktop uses the existing 232px fixed sidebar with UCM Coffee Studio / Admin branding, the supplied navigation order, and shop-date context in the footer. Order History is selected with a restrained green-tinted surface and text, not a large decorative block.

Below 800px, the sidebar becomes a compact header. Primary navigation scrolls horizontally so labels remain readable and touch targets remain at least 44px. Main content padding changes from 32px to 16px.

## List decisions

- Columns follow the story’s exact order and do not include an action column.
- Order number is the sole row affordance. Its accessible name includes the business day, preserving the paired identity even when announced out of table context.
- The default order is business day descending, then order number descending.
- Sort headers expose their active direction visually and through `aria-sort`.
- Filters are ordinary labeled fields at 48px height and combine in one result set.
- A control change returns pagination to page 1.
- The horizontally scrollable table retains a sticky header. A small-screen hint explains the horizontal gesture.
- Walk-in has the same typographic weight as customer names. It is display text, not a search target.
- Recorded zero money is subdued but legible. It remains `₱0.00`, while unavailable data uses the exact glyph “—”.
- Outstanding and settled non-zero change values add plain-language secondary text inside Change owed. Screen-reader text carries the same meaning.

## Status treatment

Status is always written as Completed, Parked, or Void. Color is supportive only:

- Completed uses a quiet green-tinted surface and green text.
- Parked uses a neutral surface and dashed neutral border. It is not styled as a warning.
- Void uses a neutral surface and a subtle strike through its text. It is not styled as danger or as a negative financial correction.

Void rows retain original positive total, payment, tip, and change. Parked rows retain the positive order total and use “—” for payment, tip, change, and completion.

## Detail decisions

The detail header keeps order number and business day together, followed by customer, service type, status, and payment method. The page remains read-only and has no production action controls.

Items remain tabular for line-by-line verification. A Senior-discount line shows the exact Discount value, original amount, discounted line total, and a quiet line note connecting the line discount to Total discount.

The payment summary always shows the applicable financial labels in a stable order. A recorded zero is `₱0.00`; unavailable data is “—”. For split payment, Cash portion and Online portion are adjacent and a note confirms both exclude tip and sum to Total.

Void reason is appended only for a Void record. Completed remains “—” for a Void record. A Parked record keeps Total while payment and settlement data remain unavailable.

## Review utilities

Dashed Review states sections are placed outside production controls and state that they are mockup-only. They make edge cases deterministic for design review without suggesting production actions.

## Responsive behavior

- At 1100px, filters reorganize into two columns and detail sections stack.
- Below 800px, the mobile header replaces the fixed sidebar and content padding becomes 16px.
- Below 520px, filter controls stack in one column and review-state buttons become full width.
- Tables preserve their comparison structure and scroll horizontally. No page-level horizontal overflow is required.

## Accessibility

- Semantic landmarks, navigation, headings, tables, captions, definitions, and form labels
- Skip link to the main content
- Visible 3px focus indicator using the supplied focus token
- 44px minimum interactive targets and 48px form fields
- `aria-sort` and spoken sort labels
- `aria-live` result and screen announcements
- Text-based status and settlement distinctions
- Exact unavailable glyph “—”
- No decorative or looping motion
- A single 180ms opacity/translate state transition with a reduced-motion override

## Radius and elevation

Fields and compact labels use the 6px control radius. Bounded surfaces use the 10px surface radius. Table, filter, and detail surfaces use borders rather than wide shadows. Green remains the only brand accent.
