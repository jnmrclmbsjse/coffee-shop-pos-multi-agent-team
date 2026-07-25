# UCM Coffee Studio brand specification

## Core tokens

```css
:root {
  --bg: oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg: oklch(22% 0.02 240);
  --muted: oklch(50% 0.018 240);
  --border: oklch(90% 0.008 240);
  --accent: oklch(58% 0.16 145);
}
```

## Supporting tokens

```css
:root {
  --accent-hover: oklch(52% 0.16 145);
  --danger: oklch(48% 0.18 28);
  --danger-surface: oklch(97% 0.018 28);
  --focus: oklch(43% 0.14 145);
  --subtle-surface: oklch(96.5% 0.007 240);
  --strong-border: oklch(76% 0.012 240);
}
```

## Typography

- Display and body: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Numeric data: `ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace`

## Posture

- Use a restrained light theme designed for bright ambient light.
- Reserve green for current selection, open status, focus, and primary actions.
- Use 6px controls and 10px content surfaces.
- Prefer dividers, whitespace, and plain data regions over nested cards.
- Keep product copy direct and operational.
