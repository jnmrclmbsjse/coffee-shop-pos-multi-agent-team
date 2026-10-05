import type { KeyboardEvent } from 'react';

/**
 * Keep Tab inside an open Journal dialog. Shared so every Journal modal gets the
 * same containment from one implementation.
 */
export function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
    ),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
