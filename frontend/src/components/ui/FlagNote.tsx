import type { ReactNode } from 'react'
import { SearchCheck } from 'lucide-react'
import { FLAG_HINT } from './messages'

/** Прапорець достовірності: «варто перевірити додатково», без ярликів. Колір плюс іконка і текст. */
export function FlagNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border border-l-4 border-l-attention-solid bg-surface p-4">
      <SearchCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-attention-text" />
      <div className="space-y-1">
        <p className="m-0 text-card">
          <span className="sr-only">Варто перевірити додатково: </span>
          {title}
        </p>
        {children && <p className="m-0 text-body">{children}</p>}
        <p className="m-0 text-caption text-text-muted">{FLAG_HINT}</p>
      </div>
    </div>
  )
}
