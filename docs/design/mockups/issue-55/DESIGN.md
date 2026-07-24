# UCM Coffee Studio Inventory Admin Design

## Intent

A restrained light product interface for fast, interruption-tolerant inventory configuration. Design serves the task: one system sans stack, compact hierarchy, familiar controls, explicit status language, and an in-context editor rather than centered modals.

## Color Tokens

All color values are authoritative and use OKLCH.

```css
:root {
  --bg: oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg: oklch(22% 0.02 240);
  --muted: oklch(50% 0.018 240);
  --border: oklch(90% 0.008 240);
  --accent: oklch(58% 0.16 145);
  --accent-hover: oklch(52% 0.16 145);
  --accent-pressed: oklch(46% 0.14 145);
  --danger: oklch(48% 0.18 28);
  --danger-surface: oklch(97% 0.018 28);
  --focus: oklch(43% 0.14 145);
  --soft-surface: oklch(96.5% 0.007 240);
  --strong-border: oklch(76% 0.012 240);
}
```

Accent green is reserved for primary actions, current selection, focus, and affirmative state. Danger red is reserved for errors and destructive actions. Every status also has text and a symbol.

## Typography

- Stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- One family across headings, labels, controls, body copy, and data.
- Product scale: 12, 13, 14, 16, 20, 24, 28px.
- Headings are compact and left aligned. Body copy is capped near 70 characters.
- Labels remain visible. Placeholder text is supplementary, never a label substitute.

## Spacing and Shape

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48px.
- Control radius: 6px.
- Working-surface radius: 10px.
- Field height: 48px.
- Minimum touch target: 44px.
- Borders separate dense operational regions. Shadows are used only to place the editor above the workspace.

## Layout

- Desktop: 72px fixed app rail, bounded content canvas, wide data table, 480px right-side editor.
- Tablet: rail becomes a compact top bar; filter controls wrap; editor remains an edge sheet.
- Below 760px: table rows become labeled records, filter controls collapse behind a disclosure, and editor becomes a full-screen sheet.
- At phone sizes: compact top navigation plus fixed bottom primary navigation; all form grids stack; no page-level horizontal overflow.

## Components and States

- App navigation: current destination has a green surface, symbol, and text.
- Tabs: semantic tablist with selected state and keyboard-compatible buttons.
- Buttons: primary, secondary, quiet, and danger variants with hover, pressed, focus, and disabled states.
- Inputs: 48px controls with visible labels, helper text, invalid borders, and `aria-describedby`.
- Badges: symbol plus label, never color alone.
- Table: desktop column layout; mobile labeled row layout.
- Drawer/sheet: in-context editor on desktop, full-screen on mobile, focus moves into it and Escape closes it.
- Notices: success, blocked, validation summary, and rejected-save states use a leading status symbol, headline, and next action.
- Empty filtered state: names active filtering as the cause and provides a clear-filters action.

## Inventory Rules Shown in UI

- Reconciled items must use Quantity. Enabling Reconciled immediately selects Quantity and disables Level.
- A rejected Reconciled plus Level save leaves saved values unchanged.
- Par is a required non-negative whole number.
- Low is optional.
- Urgent is optional only when Low exists.
- When supplied, `Urgent ≤ Low ≤ Par`.
- Normal day and Peak day values validate independently. Zero is valid.
- Referenced Cup/Lid stock items cannot be deleted.
- Non-empty categories cannot be deleted.
- Category order persists by numeric sort weight; accessible move controls provide an alternative.

## Motion and Accessibility

State transitions use 180–220ms ease-out motion. `prefers-reduced-motion: reduce` disables animation and smooth transitions. Focus uses the supplied focus token with a 3px outline and offset. Semantic tables, forms, fieldsets, status regions, and live regions support keyboard and assistive technology use.

