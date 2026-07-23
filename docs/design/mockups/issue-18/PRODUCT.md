# Product

## Register

product

## Users

Coffee-shop staff signing into the point-of-sale at a counter, primarily on shared tablets in bright ambient light. They need to identify themselves and start a shift quickly without exposing account details.

## Product Purpose

Provide a staff-only sign-in surface that is separate from administrator authentication. Remembered staff can use a four-digit PIN; other staff use Username and Password, which remembers them on successful sign-in. Success moves clearly into Point of Sale while every failure remains generic and non-identifying.

## Brand Personality

Calm, fast, trustworthy. The interface should feel operational and familiar, with restrained confirmation and no promotional tone.

## Anti-references

Marketing-page layouts, decorative coffee imagery, cream or beige canvases, gradients, glass effects, oversized headings or cards, nested cards, ornamental animation, and credential feedback that reveals whether an account exists.

## Design Principles

1. Put the fastest safe path first: remembered staff are one selection and four digits from Point of Sale.
2. Keep alternatives visible without competing: Username and Password remain available through clear progressive disclosure.
3. Make every state explicit: selected identity, input readiness, submission, failure, throttle, and success must be unambiguous.
4. Protect staff privacy by using one generic failure response and never confirming account status.
5. Design for counter conditions: large targets, high contrast, keyboard access, and no scrolling for core PIN controls on tablet.

## Accessibility & Inclusion

Use semantic HTML, visible keyboard focus, high-contrast text and controls, 44px minimum targets, labelled inputs and icon-only controls, aria-live status messaging, and reduced-motion behavior. The primary tablet acceptance sizes are 768×1024 and 1024×768 CSS pixels.
