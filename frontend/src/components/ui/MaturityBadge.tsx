import { cn } from '@/lib/cn'
import { MATURITY, type MaturityLevel } from './config'

/** Цифра + назва + колір + візерунок (у друці). */
export function MaturityBadge({ level, className }: { level: MaturityLevel; className?: string }) {
  const { name, classes } = MATURITY[level]
  return (
    <span
      data-maturity={level}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-fine font-semibold whitespace-nowrap tabular',
        classes,
        className,
      )}
    >
      <span aria-hidden className="font-bold">
        {level}
      </span>
      <span className="sr-only">Рівень зрілості {level}: </span>
      {name}
    </span>
  )
}
