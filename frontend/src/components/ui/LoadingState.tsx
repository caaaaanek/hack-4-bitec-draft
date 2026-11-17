import type { ReactNode } from 'react'
import { LOADING_TEXT } from './messages'

/** Обгортка для скелетонів: повідомляє допоміжним технологіям про завантаження. */
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{LOADING_TEXT}</span>
      {children}
    </div>
  )
}
