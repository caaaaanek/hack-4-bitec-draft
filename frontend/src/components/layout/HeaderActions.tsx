import { CalendarDays } from 'lucide-react'
import { ThemeToggle, Tooltip } from '@/components/ui'
import { CYCLE } from '@/demo/data'
import { DemoPanel } from './DemoPanel'

/** Праворуч у верхній панелі: «Синтетичні дані», цикл, перемикач теми, аватар ролі з демо-панеллю. */
export function HeaderActions() {
  return (
    <div data-print="hide" className="flex items-center gap-2">
      <span className="hidden rounded-full border border-border px-2.5 py-1 text-fine font-normal text-text-muted md:inline-block">
        Синтетичні дані
      </span>
      <Tooltip
        placement="bottom"
        content="Цикл оцінювання: один повний раунд опитування й збору фактів. Індекс порівнюється з попереднім циклом."
      >
        <span className="hidden h-[38px] items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-body font-medium text-text md:inline-flex">
          <CalendarDays aria-hidden className="size-4 text-text-muted" />
          Цикл {CYCLE}
        </span>
      </Tooltip>
      <ThemeToggle />
      <DemoPanel />
    </div>
  )
}
