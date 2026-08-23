# UCM Coffee Studio staff POS brand specification

This story is a preserve-mode extension of the shipped Cash & Expenses screen. It keeps the same cool light surfaces, system typography, compact panels, and green action language.

## 1. Binding token contract

The following contract is copied verbatim into `:root` in `styles.css`.

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
  --success-surface: oklch(96% 0.028 145);
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px;
  --space-6:24px; --space-7:32px; --space-8:40px; --space-9:48px;
  --radius-control:6px; --radius-panel:10px;
  --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

## 2. Additive tokens

None.

The superseded treatment uses the existing warning surface, border, and ink tokens because it is an informational record state, not an error. The effective correction uses the existing `--success-surface` with ordinary foreground text. Action, selection, and focus continue to use the existing accent family. No state requires a new hue or semantic family.

## 3. Type and control posture

1. Use the system font stack for display and body text.
2. Set the page heading at 30px/800 and panel headings at 18px/800.
3. Set uppercase table headers at 11px/800 with `0.07em` tracking.
4. Use tabular figures for every peso amount and summary value.
5. Keep fields 48px high, touch targets at least 44px, and visible focus rings 3px wide with a 2px offset.
6. Use 32px content padding at tablet and desktop widths, 16px below 768px, and a 1440px content cap.

## 4. Amendment posture

1. Status is text-first: Effective, Superseded, Corrects, and Corrected by remain readable without color.
2. Superseded rows use a warning tint without strikethrough. Their recorded values stay legible.
3. Correction rows use the existing success surface and include a complete link sentence.
4. The `+` or `−` glyph stays inside the existing kind badge only. Every displayed amount remains a positive magnitude.
5. The review comparison emphasizes changed fields with the existing warning family. Unchanged fields use the normal neutral surface.

