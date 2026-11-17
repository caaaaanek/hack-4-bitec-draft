import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const PAGE_TITLE_SLOT = 'page-title-slot'

const subscribe = () => () => {}
const getSlot = () => document.getElementById(PAGE_TITLE_SLOT)
const getServerSlot = () => null

/**
 * Заголовок сторінки: у каркасі показується у верхній панелі (слот), без каркаса (тести окремих екранів) стоїть на місці.
 * Це єдиний h1 сторінки.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribe, getSlot, getServerSlot)
  const h1 = <h1 className="m-0 truncate text-title text-text">{children}</h1>
  return slot ? createPortal(h1, slot) : h1
}
