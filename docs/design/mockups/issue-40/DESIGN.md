# Design System

## Overview

UCM Coffee Studio uses a restrained light operational interface. Dense catalog information is presented in tables on wide screens and structured records on small screens. White working surfaces sit on a cool near-white canvas, with green reserved for primary actions, current navigation, and positive availability states.

## Color

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
  --focus: oklch(43% 0.14 145);
  --danger: oklch(48% 0.18 28);
  --danger-surface: oklch(97% 0.018 28);
  --soft: oklch(96.5% 0.007 240);
  --border-strong: oklch(76% 0.012 240);
}
```

## Typography

Use the system UI sans stack for every interface role:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Use weight and spacing, not a second display face, to establish hierarchy. Page titles are 24px to 28px, section titles 18px, body 14px, and compact metadata 12px.

## Spacing and Shape

Use the 4, 8, 12, 16, 20, 24, 32, 40, 48px spacing scale. Controls have a 6px radius, larger working surfaces have a 10px radius. Fields are 48px tall, and all interactive targets are at least 44px.

## Components

- Primary buttons use the accent color with a restrained 4px shadow.
- Secondary buttons use a white or soft surface and strong border.
- Inputs show a 2px focus ring offset by 2px.
- State badges always pair color with a text label and, where useful, an icon or dot.
- Switches show explicit Available/Sold out or Active/Inactive labels nearby.
- Validation appears next to the affected field or row and is summarized at the form level after a failed save.
- Wide data tables convert to labelled record rows below 760px.

## Layout

A fixed desktop rail provides Catalog and POS navigation. On small screens it becomes a sticky horizontal navigation bar. Main content uses a maximum width of 1440px with 24px to 32px page padding, reducing to 16px on narrow screens.

## Motion

Use 160ms to 220ms ease-out transitions for hover, navigation, notices, and switch state. Disable nonessential movement when reduced motion is requested.
