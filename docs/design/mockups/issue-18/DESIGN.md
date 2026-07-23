# UCM Coffee Studio Staff Sign-in

## Overview

A restrained, tablet-first product interface for staff authentication at a bright coffee-shop counter. One system sans family, cool-neutral layers, compact hierarchy, and familiar controls keep attention on the sign-in task.

## Color Palette

- Background: `oklch(98% 0.005 250)`
- Surface: `oklch(100% 0 0)`
- Foreground: `oklch(22% 0.02 240)`
- Muted: `oklch(50% 0.018 240)`
- Border: `oklch(90% 0.008 240)`
- Accent: `oklch(58% 0.16 145)`
- Accent hover: `oklch(52% 0.16 145)`
- Accent pressed: `oklch(46% 0.14 145)`
- Danger: `oklch(48% 0.18 28)`
- Danger surface: `oklch(97% 0.018 28)`
- Focus: `oklch(43% 0.14 145)`
- Soft ink: `oklch(36% 0.018 240)`
- Subtle surface: `oklch(96.5% 0.007 240)`
- Strong border: `oklch(76% 0.012 240)`

Green is used only for primary action, active selection, focus, and confirmation.

## Typography

- Family: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Page title: 24px, 700
- Section title: 20px, 700
- Body and controls: 15–17px, 500–700
- Supporting text: 13–14px, 500
- No display face; product hierarchy is weight-led and compact.

## Spacing and Shape

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48px
- Radii: 6px for fields and small controls, 10px for panels and major controls
- Touch target: 44px minimum
- Field height: 48px
- Control shadow: no more than 5px blur

## Layout

The app shell uses a compact top bar and centered work surface. The remembered-staff picker is the initial state. Selecting a person replaces it with a two-column identity and PIN composition on landscape tablets; portrait and mobile stack the regions. Username and Password are a separate in-surface state, never a competing adjacent form.

## Components

- Staff tiles use real display names and optional role labels; selected state uses an accent border and confirmation mark.
- PIN progress uses four masked cells with an accessible text equivalent.
- Number pad contains digits 0–9, Backspace, and Clear. The primary button is disabled until exactly four digits.
- Fields use persistent visible labels and 48px heights.
- Status banners use full borders and semantic tinting, never side stripes.
- Design notes live in a compact drawer opened from the top bar so the default view remains the product screen.

## Motion

State feedback lasts 180–220ms and changes opacity, color, or small translations only. Reduced-motion preferences remove transitions and animations.
