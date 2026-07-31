# UCM Coffee Studio token contract

## 1. Binding tokens

The prototype copies the supplied token block verbatim.

```css
:root {
  --bg:             oklch(98% 0.005 250);
  --surface:        oklch(100% 0 0);
  --fg:             oklch(22% 0.02 240);
  --muted:          oklch(50% 0.018 240);
  --border:         oklch(90% 0.008 240);
  --border-strong:  oklch(76% 0.012 240);
  --surface-subtle: oklch(96.5% 0.007 240);
  --ink-soft:       oklch(36% 0.018 240);
  --accent:         oklch(58% 0.16 145);
  --accent-hover:   oklch(52% 0.16 145);
  --accent-pressed: oklch(46% 0.14 145);
  --danger:         oklch(48% 0.18 28);
  --danger-surface: oklch(97% 0.018 28);
  --focus:          oklch(43% 0.14 145);
  --warn-ink:       oklch(41% 0.09 75);
  --warn-surface:   oklch(97% 0.03 85);
  --warn-border:    oklch(80% 0.08 80);
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-7: 32px; --space-8: 40px;
  --space-9: 48px;
  --radius-control: 6px;
  --radius-panel:   10px;
  --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

## 2. Additive tokens

No tokens were added. Status and selection tints are derived with `color-mix(in oklch, ...)`.

## 3. Posture

- `--bg` backs the workspace, `--surface` holds ledger cards, and `--surface-subtle` groups secondary facts.
- Typography uses the single bound system stack. Weight and size create hierarchy.
- Dense data is separated with 1px hairlines.
- Green is limited to active navigation, completed state reinforcement, focus, and selected review fixtures.
- Controls use `--radius-control`; panels and cards use `--radius-panel`.

## 4. Type scale in use

| Role | Size | Weight | Tracking |
| --- | ---: | ---: | ---: |
| Page title | 30-40px responsive | 800 | -0.02em |
| Section heading | 18px | 800 | -0.01em |
| Card heading | 18px | 800 | -0.01em |
| Body and controls | 16px | 400-700 | 0 to 0.02em |
| Metadata | 13-14px | 600-700 | 0.02em on labels |
| Compact badge | 12px | 700-800 | 0.02em to 0.08em |

## 5. Contrast table

Values below are design-review estimates based on the supplied OKLCH lightness relationships. Browser-level automated contrast testing should remain part of production QA.

| Foreground | Background | Use | Target | Review |
| --- | --- | --- | ---: | --- |
| `--fg` | `--bg` | Page text | 4.5:1 | Pass |
| `--fg` | `--surface` | Headings and totals | 4.5:1 | Pass |
| `--ink-soft` | `--surface` | Metadata values | 4.5:1 | Pass |
| `--muted` | `--surface` | Supporting text at 14-16px | 4.5:1 | Pass |
| `--focus` | `--surface` | Focus ring | 3:1 component contrast | Pass |
| `--focus` | accent-derived pale surface | Completed text | 4.5:1 | Pass |
| `--warn-ink` | `--warn-surface` | Parked and change owed | 4.5:1 | Pass |
| `--ink-soft` | `--surface-subtle` | Void and guidance | 4.5:1 | Pass |
| `--surface` | `--fg` | Skip link | 4.5:1 | Pass |

Borders do not carry text meaning alone. Status and settlement remain identifiable through literal words, weight, and border style.
