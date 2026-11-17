import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Info,
  Layers,
  Minus,
  Scale,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Badge,
  BigNumber,
  Card,
  IconCircle,
  MATURITY,
  Tooltip,
  type MaturityLevel,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { COMPONENT_LABELS, fmt, levelOf, type ComponentId } from '@/lib/scoring/methodology'
import { directionOf } from '@/lib/trends'

const ICON: Record<ComponentId, LucideIcon> = {
  culture: Users,
  system: Layers,
  accountability: Scale,
}

/** Стан компонента за значенням: до 37,5 критична зона, до 62,5 потребує уваги, вище сильна сторона. */
export function stateOf(value: number): { label: string; cls: string } {
  if (value <= 37.5) return { label: 'Критична зона', cls: 'bg-critical-bg text-critical-text' }
  if (value <= 62.5) return { label: 'Потребує уваги', cls: 'bg-attention-bg text-attention-text' }
  return { label: 'Сильна сторона', cls: 'bg-strength-bg text-strength-text' }
}

/** Міні-сходи рівнів: чотири точки в ряду, рядки знизу вгору за рівнем (колір не єдиний носій: рівень є текстом). */
function LevelDots({ level }: { level: MaturityLevel }) {
  return (
    <div aria-hidden className="grid grid-cols-4 gap-1.5">
      {[5, 4, 3, 2, 1].flatMap((l) =>
        [0, 1, 2, 3].map((c) => (
          <span
            key={`${l}-${c}`}
            className={cn(
              'size-2 rounded-[2px]',
              l > level
                ? 'bg-surface-muted'
                : l === 1
                  ? 'bg-critical-solid'
                  : l === 2
                    ? 'bg-attention-solid'
                    : 'bg-data',
            )}
          />
        )),
      )}
    </div>
  )
}

export function ComponentCard({
  id,
  value,
  delta,
  limitedHint,
  previous,
}: {
  id: ComponentId
  value: number
  delta: number
  limitedHint?: string
  previous: number
}) {
  const Icon = ICON[id]
  const level = levelOf(value)
  const st = stateOf(value)
  const dir = directionOf(delta)
  const Arrow = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  return (
    <Card as="section" aria-label={COMPONENT_LABELS[id]} className="relative flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconCircle tone={id} size={32}>
            <Icon className="size-4" />
          </IconCircle>
          <h2 className="m-0 text-card">
            <Link
              to={`/explain?c=${id}`}
              className="text-text no-underline after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {COMPONENT_LABELS[id]}
              <span className="sr-only">: розклад компонента</span>
            </Link>
          </h2>
        </div>
        <Tooltip content="Вага компонента в індексі: усі три компоненти мають однакову вагу, по третині.">
          <span className="relative z-10 text-caption text-text-muted">Вага ⅓</span>
        </Tooltip>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <BigNumber value={fmt(value)} />
          <span className="inline-flex items-center gap-1.5 text-body">
            <IconCircle tone={dir === 'down' ? 'accountability' : 'accent'} size={22}>
              <Arrow className="size-3" />
            </IconCircle>
            <span className="font-medium tabular">
              {sign}
              {fmt(Math.abs(delta))}
            </span>
            <span className="text-caption text-text-muted">
              {dir === 'up' ? 'Зросло' : dir === 'down' ? 'Знизилось' : 'Без змін'} (було{' '}
              {fmt(previous)})
            </span>
          </span>
        </div>
        <LevelDots level={level} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-fine font-semibold',
            st.cls,
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {st.label}
        </span>
        <span
          data-maturity={level}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-fine font-medium text-text"
        >
          Рівень {level} · {MATURITY[level].name}
        </span>
        {limitedHint && (
          <span className="relative z-10">
            <Tooltip content={limitedHint}>
              <Badge tone="attention">
                <Info aria-hidden className="size-3.5" />
                Зараховано з обмеженням
              </Badge>
            </Tooltip>
          </span>
        )}
      </div>
    </Card>
  )
}
