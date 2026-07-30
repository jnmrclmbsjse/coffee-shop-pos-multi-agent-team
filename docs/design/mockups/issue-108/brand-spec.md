# UCM Coffee Studio staff inventory brand contract

This mockup extends the shipped UCM Coffee Studio staff system: bright cool surfaces, weight-led system typography, thin borders for dense data, and green reserved for action, selection, focus, and affirmative state.

## Core tokens

The following tokens are binding and unchanged.

```css
--bg: oklch(98% 0.005 250);
--surface: oklch(100% 0 0);
--fg: oklch(22% 0.02 240);
--muted: oklch(50% 0.018 240);
--border: oklch(90% 0.008 240);
--border-strong: oklch(76% 0.012 240);
--surface-subtle: oklch(96.5% 0.007 240);
--ink-soft: oklch(36% 0.018 240);
--accent: oklch(58% 0.16 145);
--accent-hover: oklch(52% 0.16 145);
--accent-pressed: oklch(46% 0.14 145);
--danger: oklch(48% 0.18 28);
--danger-surface: oklch(97% 0.018 28);
--focus: oklch(43% 0.14 145);
```

Typography is `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. The spacing scale is 4, 8, 12, 16, 20, 24, 32, 40, and 48px. Fields and small controls use 6px radius. Panels use 10px radius. Touch targets are at least 44px and fields are 48px high. Control shadows use no more than 5px blur.

## Additive restock status scale

These are semantic text and border colors. A light surface is derived with `color-mix(in oklch, currentColor 9%, var(--surface))`, so the scale adds only four color values.

```css
--restock-urgent: oklch(44% 0.17 28);
--restock-low: oklch(45% 0.14 48);
--restock-below-par: oklch(42% 0.105 82);
--restock-enough: oklch(40% 0.018 240);
```

- Urgent is the strongest red signal and always includes the text `Urgent`.
- Low uses a distinct burnt-orange signal and always includes the text `Low`.
- Below par uses a restrained amber warning and always includes the text `Below par`.
- Enough is neutral, not green, and always includes the text `Enough`. This keeps satisfactory rows quieter than rows requiring action.
- The scale never substitutes color for text. It does not reuse `--danger` or `--accent` as a four-step data encoding.

## Additive eight-step level selector contract

The selector reuses core color tokens and adds only component geometry tokens:

```css
--level-selector-gap: 4px;
--level-selector-min-height: 48px;
--level-selector-radius: 6px;
```

- The control is a real radiogroup containing eight radio inputs: Empty, Low, Quarter, One-third, Half, Two-thirds, Three-quarters, Full.
- At landscape tablet widths the choices form one eight-column row.
- Below 900px they form a four-column by two-row grid.
- On phones they form a two-column by four-row grid.
- Every label is at least 48px high. Unselected options use `--surface`, `--border-strong`, and `--fg`.
- Hover uses `--surface-subtle`. Keyboard focus uses the shared 3px `--focus` ring.
- Selected options use `--accent` with a high-contrast foreground. Green is appropriate here because the state is a current selection.
- Selection is exposed by native radio state and visible fill, never fill alone.

## Theme note

The semantic token model can support a later dark theme for changing counter light. Core surfaces, text, borders, focus, and the four restock status values would need paired dark values, while component rules and semantic names can remain unchanged. This mockup intentionally implements the shipped light theme only.
