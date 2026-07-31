# brand-spec - UCM Coffee Studio staff POS

Preserve-mode extension of ten shipped mockups. The binding contract is copied
verbatim into `:root` in `styles.css`.

## 1. Binding core tokens

```css
:root {
  --bg: oklch(98% 0.005 250); --surface: oklch(100% 0 0); --fg: oklch(22% 0.02 240);
  --muted: oklch(50% 0.018 240); --border: oklch(90% 0.008 240);
  --border-strong: oklch(76% 0.012 240); --surface-subtle: oklch(96.5% 0.007 240);
  --ink-soft: oklch(36% 0.018 240); --accent: oklch(58% 0.16 145);
  --accent-hover: oklch(52% 0.16 145); --accent-pressed: oklch(46% 0.14 145);
  --danger: oklch(48% 0.18 28); --danger-surface: oklch(97% 0.018 28);
  --focus: oklch(43% 0.14 145);
  --warn-ink: oklch(41% 0.09 75); --warn-surface: oklch(97% 0.03 85); --warn-border: oklch(80% 0.08 80);
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px;
  --space-6:24px; --space-7:32px; --space-8:40px; --space-9:48px;
  --radius-control:6px; --radius-panel:10px;
  --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

## 2. Additive tokens

None. Selection and success tints derive from the fixed tokens using
`color-mix(in oklch, ...)`. All other states use the existing neutral, danger
and warning families.

## 3. Binding posture

1. Bright cool surfaces: `--bg` behind, `--surface` panels and
   `--surface-subtle` for secondary fills and table headers.
2. Weight-led system typography, one family, no display face.
3. Hairline borders between dense rows and stronger borders around controls.
4. Green is reserved for action, selection, focus and affirmative state.
5. Fields are 48px high, targets are at least 44px and focus rings are 3px at a
   2px offset.
6. Tablet-first, 32px content padding, 16px below 768px and a 1440px cap.
7. Money and numeric columns use tabular figures. Uppercase runs use at least
   0.06em tracking.

## 4. Type scale

Page heading is 30px/800, panel headings 18px/800, body and field values
15px/400-700, labels 13px/700, helpers 12px/400-700, and uppercase table headers
11px/800 with 0.07em tracking.
