# DESIGN - Active cashier selection

UCM Coffee Studio staff POS workspace, preserve-mode extension.

Dials: `DESIGN_VARIANCE 4`, `MOTION_INTENSITY 3`, `VISUAL_DENSITY 6`.

## Preserve-mode audit

Preserved from issue-154 and the sibling staff mockups:

- Full-bleed staff shell with the UCM lockup, Staff role tag, signed-in user,
  branch, day and register context.
- Flat horizontal navigation in its final product order, with Take Order active.
- Bright cool background, white surfaces and neutral secondary fills.
- One system font family with hierarchy created by size and weight.
- Hairline row structure, 6px controls, 10px panels and restrained shadows.
- 48px controls, 44px minimum targets, a 3px focus ring at 2px offset.
- Tablet-first 1440px cap, 32px content padding and 16px mobile padding.
- Dashed Review states / Mockup only panel outside production UI.

No third-party system was added because the existing UCM native CSS system is
complete and the brief prohibits packages, CDNs and network requests.

## Shell placement

The active-cashier control sits below the normal header metadata and above the
staff nav. This makes it persistent across `/pos` screens without conflating it
with the signed-in user. The indicator is a wide bordered control rather than a
status chip because it opens a workflow and must be comfortable on a tablet.

Pinned active rendering:

`Active cashier  Marilou Bagtas  Change` plus a separate `Clear` control.

Pinned empty rendering:

`Active cashier  No cashier selected  Change`

The empty state uses only neutral tokens. It is a supported state, never a
warning, error or blocked condition.

Pinned deactivated rendering:

`Benjie Cruz` with `No longer on active roster` beneath it. The name remains
because device attribution is a historical server fact. The picker excludes him
because new choices come only from the active roster.

## Picker composition

The centered tablet sheet becomes a bottom-aligned sheet below 768px. A current
selection summary stays at the top, so failed or cancelled handovers visibly
leave the prior cashier unchanged. The roster is a two-column grid on tablet and
one column on mobile.

Cards use the additive 88px minimum-height token. Each includes a literal name
and one quiet neutral marker: `PIN required` or `Selects now`. This marker
previews the next interaction and is intentionally not styled as a badge for
security or status. The selected card adds the literal `Currently active` plus
the existing accent selection treatment.

Loading uses quiet fixed-shape skeleton cards with no looping shimmer. Empty
uses a literal explanation and preserves both Clear and Cancel actions.

## PIN composition and security

PIN entry keeps two areas on a landscape tablet: identity, progress and failure
at left; keypad and actions at right. Mobile stacks them. The 4 slots are masked
and assistive technology receives only `n of 4 PIN digits entered`.

Exactly one generic failure component is rendered for every rejection cause:

`Cashier could not be selected. Try again or choose someone else.`

The cooldown state disables digit and Confirm controls and adds only a neutral
remaining-time line. It does not change the generic failure copy, border, fill
or announcement. This demonstrates refusal without identifying the cause of a
previous attempt.

Cancel and Back return to the picker with no error component. Escape closes the
dialog as a cancellation and returns focus to the indicator. The active cashier
is not mutated until a no-PIN selection or successful PIN completes.

## State and persistence

The mock server record is keyed by a stable device id in localStorage. Shell
rendering always reads that record rather than treating selection as modal state.
Reload and sign-in state changes therefore cannot clear attribution. Pending PIN
digits remain ephemeral and never enter storage.

## Accessibility

The overlay uses `role="dialog"`, `aria-modal="true"`, an accessible title,
manual focus trapping, Escape handling and focus restoration. Cards, digits,
Delete, Cancel, Back and Confirm are real buttons. Generic failure uses both an
inline alert and the shell live region. Focus treatment is inherited unchanged.

## Responsive behavior

At 768px and above the picker grid is two columns and PIN entry is split. Below
768px the sheet anchors to the viewport bottom, grids collapse to one column,
context rows stack and shell padding changes to 16px. The keypad retains three
equal columns and large keys. The page never scrolls horizontally.

## Motion

`MOTION_INTENSITY 3`. A single 180ms opacity and 8px translation communicates
dialog entry. It uses transform and opacity only and collapses under
`prefers-reduced-motion: reduce`. There is no ambient or decorative motion.

## Shell currency note

This mockup was generated before the issue #174 cross-screen reconciliation
merged (#183, #184). Its staff strip has since been retargeted onto the
reconciled nine-destination order that `apps/web/src/staff/StaffWorkspace.tsx`
now ships — `Sell, Open Day, Opening, Restock, Deliveries & Wastage, Order
History, Cash & Expenses, Closing, Close Day`, with the day-bracketing
separators — and the sell surface is labelled `Sell`, not `Take Order`. The
shell here remains an illustrative host: Dev integrates into the real
`StaffWorkspace` shell, not into this markup.

## Implementation handoff

### Requirements — inherited, not negotiable

From the story's acceptance criteria:

- Every roster card's selectable target is at least 44×44 CSS px (AC1).
- Only active roster members appear as new choices (AC2, AC13).
- The POS always states the active cashier by name, or states that none is
  selected (AC3); the "none" state is neutral, never a warning or a blocker.
- No PIN is requested for a member without one; a PIN is requested for a member
  with one (AC4, AC5).
- A correct PIN activates the cashier and does not change the signed-in POS user
  (AC6).
- Incorrect and incomplete PINs produce the *same* non-identifying result
  (AC7). One failure component, one string, for every rejection cause — this is
  a security requirement from ADR 0007, not a copy preference.
- Cancellation is not a failure: it shows no unsuccessful-attempt error (AC8).
- A failed or cancelled attempt leaves the previous active cashier unchanged
  (AC9). The picker's current-selection summary exists to make this visible.
- After the configured failure threshold, all attempts including a correct PIN
  are refused for the cooldown, and the refusal stays non-identifying (AC10).
- Clearing requires no PIN (AC12); selection survives reload and sign-out/in on
  the same device (AC14) and is scoped per device (AC15).

From ADR 0007 and ADR 0001:

- `requiresPin` is derived server-side from `GET /staff/selectable`. The client
  never decides whether a PIN is needed, and the `PIN required` / `Selects now`
  card marker is a render of the server's answer.
- Active-cashier state is the server-side append-only `CashierSelection` log
  keyed on `deviceId`, not `localStorage`. The mockup fakes that record in
  `localStorage` only because it has no API; that is prototype scaffolding and
  must not be carried across. `deviceId` comes from the existing
  `auth/device.ts`.
- PIN authorization mints no session and refreshes none.

Accessibility obligations:

- `role="dialog"`, `aria-modal="true"`, accessible title, focus trap, Escape as
  cancellation, focus restored to the indicator on close.
- Masked PIN slots expose only `n of 4 PIN digits entered` to assistive tech —
  never the digits.
- The generic failure is announced through both an inline alert and the shell
  live region, and the announced string is identical across causes.
- Reduced motion collapses the dialog transition.

### Advisory — Dev's call

- **Indicator placement.** The mockup pins the control in the header bar, above
  the nav, so it persists across `/pos` routes. That intent (persistent,
  visually separate from the signed-in user) is the point; the exact slot in the
  reconciled header is Dev's to choose alongside the business-day context block.
- Wide bordered control rather than a status chip, because it opens a workflow.
- Two-column roster grid at ≥768px collapsing to one; sheet centred on tablet,
  bottom-anchored on mobile.
- 88px card minimum height and 68px keypad keys — now bound as
  `cashierPicker.cardMinHeight` and `cashierPicker.keypadKeySize` in
  `docs/design/tokens.json`.
- Split PIN layout (identity/progress left, keypad right) on landscape tablet,
  stacked below 768px.
- Fixed-shape skeleton cards for loading, with no looping shimmer.
- Deactivated-active rendering: name plus `No longer on active roster`.
- Exact copy strings throughout, including the failure sentence, are advisory —
  but whatever string is chosen must be the *only* one used for all rejection
  causes.

### Proposed changes to shared shell or components

One, and it is additive: the reconciled `StaffWorkspace` header gains a
persistent active-cashier control. Reason — AC3 requires the active cashier to
be legible from the POS at all times and AC14 requires it to survive route
changes and re-authentication, which page-level placement cannot give. It sits
outside the signed-in-user block deliberately: ADR 0007 defines cashier
attribution and sign-in identity as distinct, and rendering them as one control
would re-conflate exactly what the ADR separated. No existing shell element is
moved, reordered, or restyled by this proposal.

