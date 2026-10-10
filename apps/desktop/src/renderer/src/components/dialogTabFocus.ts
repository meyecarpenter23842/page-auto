import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Keep Tab navigation inside an open, modal-only editor; do not change its data state. */
export function keepDialogTabFocus(event: ReactKeyboardEvent<HTMLElement>, dialog: HTMLElement | null): void {
  if (event.key !== 'Tab' || !dialog) return
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('hidden'))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}
