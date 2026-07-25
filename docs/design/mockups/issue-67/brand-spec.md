# UCM Coffee Studio Back Office Brand Specification

The system uses cool near-white surfaces, compact system typography, thin neutral dividers, and a single green accent reserved for current selection and primary action.

## Color tokens

```css
--bg: oklch(98% 0.005 250);
--surface: oklch(100% 0 0);
--fg: oklch(22% 0.02 240);
--muted: oklch(50% 0.018 240);
--border: oklch(90% 0.008 240);
--accent: oklch(58% 0.16 145);
```

The implementation also preserves the supplied interaction, danger, focus, subtle-surface, and strong-border tokens in `styles.css`.

## Typography

- Display: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Body: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

## Posture rules

- Keep page hierarchy compact and operational.
- Use the accent only for primary actions, current navigation, focus, and active controls.
- Separate groups with spacing and fine borders instead of layered cards.
- Use 6px radii for controls and 10px radii for surfaces.
- Show status in text as well as through control position and color.
