# UCM Admin Local Brand Specification

This mockup preserves the supplied UCM Admin light system. These values are local to the story #93 design bundle and do not change any repository token file.

## Core tokens

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
  --ink-soft: oklch(36% 0.018 240);
  --subtle-surface: oklch(96.5% 0.007 240);
  --strong-border: oklch(76% 0.012 240);
}
```

## Typography

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
```

System sans is used throughout. Currency, order numbers, dates, and timestamps use the mono stack with tabular numerals.

## Geometry and spacing

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48px
- Control radius: 6px
- Surface radius: 10px
- Minimum touch target: 44px
- Field height: 48px
- Desktop sidebar: 232px
- Maximum content width: 1440px
- Elevation: restrained; primary surfaces use borders without wide decorative shadows

## Smallest local status additions

The additions below are used only to distinguish historical status labels. They remain neutral or derive from the supplied green accent.

```css
:root {
  --status-completed-bg: oklch(95.5% 0.035 145);
  --status-parked-bg: oklch(95.5% 0.008 240);
  --status-void-bg: oklch(94.5% 0.01 240);
  --status-void-fg: oklch(32% 0.018 240);
}
```

- Completed: green text and a pale green surface.
- Parked: neutral text and surface with a dashed neutral border. It is not a warning.
- Void: neutral ink and surface with a text treatment. It is not danger.
- Every status remains distinguishable by its written label.

## Observed posture rules

1. Use light, bordered surfaces for compact operational grouping.
2. Reserve green for selected navigation, active focus, links, and Completed support.
3. Use mono text for financial and order identity data.
4. Prefer familiar controls and tables over decorative containers.
5. Keep historical states factual; never turn Void into an error or Parked into a warning.
