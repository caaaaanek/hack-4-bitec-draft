import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer, XAxis } from 'recharts'
import { ArrowDown, ArrowUp, CircleHelp, Info, Minus } from 'lucide-react'
import { BigNumber, Card, IconCircle, MATURITY, Tooltip, type MaturityLevel } from '@/components/ui'
import { TRUST_GRADE_TEXT } from '@/components/ui/messages'
import { cn } from '@/lib/cn'
import { LEVEL_UPPER_BOUNDS, fmt, fmtIndex, pointsText } from '@/lib/scoring/methodology'
import { directionOf, type CyclePoint } from '@/lib/trends'
import type { Institution } from '@/demo/institutions'
import { CYCLE, CYCLE_DATE } from '@/demo/data'

const LEVELS: MaturityLevel[] = [1, 2, 3, 4, 5]

function rangeText(l: MaturityLevel): string {
  const lo = l === 1 ? 0 : LEVEL_UPPER_BOUNDS[l - 2]!
  const hi = l === 5 ? 100 : LEVEL_UPPER_BOUNDS[l - 1]!
  return l === 1
    ? `від 0 до ${fmt(hi)}`
    : l === 5
      ? `вище ${fmt(lo)}`
      : `вище ${fmt(lo)} до ${fmt(hi)}`
}

/** Шкала рівнів 1-5: смуга з поточним рівнем і підписи (поточний жирним). Діапазон у підказці й для скрінрідерів. */
export function LevelScale({ level }: { level: MaturityLevel }) {
  return (
    <ol aria-label="Шкала рівнів зрілості" className="m-0 grid list-none grid-cols-5 gap-1.5 p-0">
      {LEVELS.map((l) => (
        <li key={l} title={rangeText(l)} className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className={cn('h-1.5 rounded-full', l <= level ? 'bg-data' : 'bg-surface-muted')}
          />
          <span
            className={cn(
              'text-fine leading-4',
              l === level ? 'font-semibold text-text' : 'text-text-muted',
            )}
            aria-current={l === level ? 'step' : undefined}
          >
            <span className="sr-only">Рівень {l}: </span>
            {MATURITY[l].name}
            <span className="sr-only">
              , {rangeText(l)}
              {l === level ? ', поточний' : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Міні-динаміка в картці індексу: область з підписаними циклами. Повні дані в картці «Динаміка індексу». */
function MiniTrend({ series }: { series: CyclePoint[] }) {
  const gid = 'mini-grad'
  const data = series.map((p) => ({ cycle: p.cycle, index: p.index }))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between">
        <span className="text-caption text-text-muted">Динаміка</span>
        <span className="text-caption text-text-muted">{series.length} цикли</span>
      </div>
      <div aria-hidden className="h-[110px]">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 300, height: 110 }}
        >
          <AreaChart data={data} margin={{ top: 6, right: 22, bottom: 0, left: 22 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-data)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-data)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="cycle"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              interval={0}
            />
            <Area
              type="monotone"
              dataKey="index"
              stroke="var(--color-data)"
              strokeWidth={2}
              fill={`url(#${gid})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Індекс за цикли: {series.map((p) => `${p.cycle} ${fmtIndex(p.index)}`).join(', ')}.
      </p>
    </div>
  )
}

export function IndexCard({
  inst,
  onWhy,
  className,
}: {
  inst: Institution
  onWhy: (section: 'top' | 'flags') => void
  className?: string
}) {
  const hid = useId()
  const grade = inst.trust.grade
  const t = TRUST_GRADE_TEXT[grade]
  const dir = directionOf(inst.delta)
  const Arrow = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus
  const prevCycle = inst.series[inst.series.length - 2]!.cycle
  const deltaText =
    dir === 'same'
      ? 'Без змін'
      : `${dir === 'up' ? 'Зросло' : 'Знизилось'} на ${pointsText(inst.delta)}`
  const tone =
    grade === 'A'
      ? 'bg-strength-bg text-strength-text'
      : grade === 'insufficient'
        ? 'bg-neutral-bg text-neutral-text'
        : 'bg-critical-bg text-critical-text'
  return (
    <Card as="section" aria-labelledby={hid} className={cn('flex flex-col gap-3', className)}>
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id={hid} className="m-0 text-caption font-normal text-text-muted">
                Індекс доброчесності
              </h2>
              <p className="m-0 text-fine text-text-muted">{inst.name}</p>
            </div>
            <Tooltip content={t.rule}>
              <button
                type="button"
                data-print-keep
                data-trust={grade}
                onClick={() => onWhy('flags')}
                aria-label={`Достовірність ${t.letter}, прапорці: ${inst.trust.raised.length}. Відкрити пояснення`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-fine font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  tone,
                )}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                <span aria-hidden>Достовірність {t.letter}</span>
              </button>
            </Tooltip>
          </div>
          <p className="sr-only" data-testid="summary">
            {fmt(inst.index)} бала, {MATURITY[inst.level].name}, достовірність {t.letter}
          </p>
          <div className="mt-1">
            <BigNumber value={fmtIndex(inst.index)} size="display" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              data-maturity={inst.level}
              className="inline-flex items-center gap-1.5 rounded-full bg-data-soft px-2.5 py-1 text-fine font-semibold text-strength-text"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-data" />
              <span aria-hidden>{inst.level} · </span>
              <span className="sr-only">Рівень зрілості {inst.level}: </span>
              {MATURITY[inst.level].name}
            </span>
            <Tooltip content="Різниця між індексом цього циклу та попереднього, у пунктах шкали 0-100.">
              <span className="inline-flex items-center gap-1.5 text-body text-text">
                <IconCircle tone={dir === 'down' ? 'accountability' : 'accent'} size={22}>
                  <Arrow className="size-3" />
                </IconCircle>
                <span className="font-medium">{deltaText}</span>
                <span className="text-caption text-text-muted">до циклу {prevCycle}</span>
              </span>
            </Tooltip>
          </div>
          <p className="m-0 mt-3 text-body">{inst.summaryReason}</p>
          <button
            type="button"
            onClick={() => onWhy('flags')}
            className="mt-1 text-caption font-medium text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.word} · Прапорці: {inst.trust.raised.length}
          </button>
        </div>
        <MiniTrend series={inst.series} />
      </div>
      <LevelScale level={inst.level} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="m-0 flex items-center gap-1.5 text-caption text-text-muted">
          Дані станом на {CYCLE_DATE} · цикл {CYCLE}
          <Tooltip content="Цикл оцінювання: один повний раунд опитування й збору фактів. Індекс порівнюється з попереднім циклом.">
            <span role="img" aria-label="Що таке цикл оцінювання" className="inline-flex">
              <Info aria-hidden className="size-4" />
            </span>
          </Tooltip>
        </p>
        <button
          type="button"
          onClick={() => onWhy('top')}
          className="inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-body font-medium text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <CircleHelp aria-hidden className="size-4" />
          Чому такий індекс
        </button>
      </div>
    </Card>
  )
}
