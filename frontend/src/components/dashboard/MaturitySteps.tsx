import { MATURITY, type MaturityLevel } from '@/components/ui/config'
import { cn } from '@/lib/cn'

const LEVELS: MaturityLevel[] = [1, 2, 3, 4, 5]

/** П'ять рівнів зрілості: цифра в кожному, поточний виділено кільцем, назва для скрінрідерів. */
export function MaturitySteps({ level }: { level: MaturityLevel }) {
  return (
    <ol aria-label="Рівні зрілості" className="m-0 flex list-none gap-1.5 p-0">
      {LEVELS.map((l) => (
        <li
          key={l}
          title={`${l} ${MATURITY[l].name}`}
          aria-current={l === level ? 'step' : undefined}
          className={cn(
            'flex size-8 items-center justify-center rounded-sm border text-caption tabular',
            l === level
              ? cn(MATURITY[l].classes, 'font-bold ring-2 ring-text')
              : 'border-border bg-surface-raised text-text-muted',
          )}
        >
          <span className="sr-only">
            Рівень {l}: {MATURITY[l].name}
            {l === level ? ', поточний' : ''}
          </span>
          <span aria-hidden>{l}</span>
        </li>
      ))}
    </ol>
  )
}
