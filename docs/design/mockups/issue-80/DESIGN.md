# Design System

## Overview

UCM Admin is a light, system-sans product interface for fast business review. The structure favors strong labels, compact numbers, direct tables, and explicit state language.

## Color

The canonical values live in `brand-spec.md`. Use the exact OKLCH values without substitution. Green is the only chromatic accent. Danger red is semantic and limited to invalid input and short variance.

## Typography

Use one system sans family throughout. The fixed scale is 12, 13, 14, 16, 20, 24, and 28px. Use the mono stack for currency, quantities, dates in tables, and chart values.

## Spacing

Use the 4, 8, 12, 16, 20, 24, 32, 40, and 48px scale. Desktop content has a maximum width of 1440px. Sidebar width is 232px. Main sections use 24px gaps, compacted to 16px on small screens.

## Shape

Controls use a 6px radius. Content surfaces use a 10px radius. Buttons and navigation are never pill shaped. Touch targets are at least 44px and fields are 48px.

## Components

- App shell: fixed desktop sidebar, compact mobile header and navigation.
- Demo utility: separate bordered region labeled Review states.
- Buttons: primary green, secondary white with strong border, quiet segmented state buttons.
- Badges: compact text plus icon-free semantic label, with meaning in copy.
- Tables: sticky headers inside horizontally scrollable regions, mono numeric cells, explicit mobile scroll hint.
- Charts: DOM-based bars with visible labels, legends, and accessible value tables.
- Empty and error states: inline, specific, and non-modal.

## Motion

Use 180ms opacity and translate transitions only for screen or state changes. Disable nonessential transition duration when reduced motion is requested.

## Responsive Behavior

- At 1024px, reduce metric columns and content padding.
- Below 800px, replace the sidebar with a mobile header and two-item navigation.
- Below 640px, stack screen headers, filters, metrics, and chart layouts.
- Data tables retain their natural width in a labeled horizontal scroll region.
