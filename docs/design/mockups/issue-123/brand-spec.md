# brand-spec — UCM Coffee Studio staff POS

Preserve-mode extension of eight shipped mockups. The core contract below is
**unchanged and binding**, copied verbatim into `:root` in `styles.css`.

---

## 1. Binding core tokens (unchanged)

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

  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-7: 32px; --space-8: 40px;
  --space-9: 48px;

  --radius-control: 6px;
  --radius-panel:   10px;
  --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

**Posture rules, unchanged:**

1. Bright cool surfaces. `--bg` behind, `--surface` panels, `--surface-subtle`
   for secondary fills and table headers.
2. Weight-led system typography. One family. Hierarchy from weight (500 / 600 /
   700 / 800) and size, never from a second face.
3. Thin hairline borders for dense data. 1px `--border` between rows, 1px
   `--border-strong` under sticky headers and around controls.
4. **Green is reserved.** `--accent` / `--accent-hover` / `--accent-pressed` /
   `--focus` appear only for action, selection, focus and affirmative state.
   Never decoration, never a chart fill, never a section header.
5. Fields 48px high; every touch target ≥44px. Control shadows ≤5px blur. Focus
   ring 3px `--focus` at 2px offset.
6. Tablet-first. Landscape tablet is the primary layout. Content 32px padding,
   16px below 768px, capped at 1440px full-width. Not a sidebar back office.

---

## 2. Additive tokens

**One family was added. Three declarations.**

```css
:root {
  --warn-ink:     oklch(41% 0.09 75);   /* text and icons */
  --warn-surface: oklch(97% 0.03 85);   /* panel fill */
  --warn-border:  oklch(80% 0.08 80);   /* border and leading bar */
}
```

Constructed to sit inside the existing system: the same lightness band as
`--danger` / `--danger-surface`, low chroma so it does not out-shout `--accent`,
and hue 75–85 — far enough from `--danger` (28) and `--accent` (145) that it is
unmistakable as either at a glance.

### 2.1 Why it was needed — the advisory warning

The missing-closing-count banner has to be impossible to miss and clearly not an
error, because closing past it is permitted.

- `--danger` / `--danger-surface` is wrong: on this surface red means *"your
  submission failed and nothing changed"*. Reusing it for a state the staff
  member may legitimately walk past would devalue it on the very screen where
  real submission failures also appear.
- `--accent` is wrong: green is reserved for affirmative state, and this is not
  affirmative.
- `--border-strong` / `--surface-subtle` (the neutral blocking-panel treatment)
  is wrong in the other direction: neutral grey reads as informational chrome
  and is exactly what gets skimmed past.

No existing token occupies the "attention, but not failure" slot, so the family
is genuinely additive rather than a restyle of something that exists.

### 2.2 Why it also covers short / over — and why no second pair was added

The discrepancy pair reuses the same family. No additional tokens.

A shortage is not an error: closing a drawer ₱4.50 short because change was
given is routine, and colouring it `--danger` alongside genuine validation
failures on the same screen would flatten a real distinction. An overage is not
a success: it usually means a sale was mis-keyed, so `--accent` misreads it as
good news and breaks the reserved-green rule.

Both directions therefore render in `--warn-*`, and **direction is carried by
the word** — `Short` / `Over`, reinforced by a static `▾` / `▴` — not by hue.
This is stronger than a colour pair would be: a red/green short-over pair would
be exactly the wrong semantics, and it would be invisible to a red-green
colour-blind staff member, who is the person most likely to be counting a
drawer under fluorescent light at 9pm.

`Balanced` is the one discrepancy state that keeps `--accent`, because balanced
genuinely is an affirmative state and green is exactly what it means.

### 2.3 Rejected additions

Considered and not added, to keep the additive set minimal:

- A dedicated `--accent-subtle`. Not needed; `color-mix(in oklch, var(--accent)
  6-8%, var(--surface))` derives every accent tint used.
- A neutral `--info` family. The blocking "No business day is open." panel is
  already served by `--surface-subtle` + `--border-strong`, which is what the
  inventory screens use.
- A `--warn-strong` for icon fills. `--warn-ink` covers every icon on both
  screens at the sizes used.

---

## 3. Contrast

| Pair | Ratio | Requirement |
|---|---|---|
| `--fg` on `--surface` | ~14.2:1 | AA body ✓ |
| `--ink-soft` on `--surface` | ~9.1:1 | AA body ✓ |
| `--muted` on `--surface` | ~5.5:1 | AA body ✓ |
| `--muted` on `--surface-subtle` | ~5.2:1 | AA body ✓ |
| `--danger` on `--danger-surface` | ~6.9:1 | AA body ✓ |
| `--warn-ink` on `--warn-surface` | ~6.4:1 | AA body ✓ |
| white on `--accent` | ~4.6:1 | AA large (16px/700 button) ✓ |
| `--focus` ring vs `--surface` | ~7.8:1 | AA non-text ✓ |

---

## 4. Type scale in use

| Role | Size / weight / tracking |
|---|---|
| Page heading | 26px / 700 / -0.015em |
| Panel heading | 16px / 700 / -0.005em |
| Summary value | 19px / 650 / -0.01em, tabular-nums |
| Discrepancy amount | 22px / 750 / -0.015em, tabular-nums |
| Body / field value | 15px / 400–600 |
| Table cell | 14px / 600, tabular-nums on numerics |
| Field label | 13px / 700 |
| Helper, sub-line | 12px / 400–500 |
| Column header, chip, tag | 11px / 700–800 / 0.06–0.09em, uppercase |
| Required / Optional tag | 10px / 700–800 / 0.08em, uppercase |

Every uppercase run carries ≥0.06em tracking. All numeric columns and all money
values use `font-variant-numeric: tabular-nums` so digits align down a column.
