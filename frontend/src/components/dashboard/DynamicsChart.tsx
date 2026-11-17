import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts'
import { BarChart3, Table2, TrendingUp } from 'lucide-react'
import { Card, Select, buttonBase, buttonSizes, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  LEVEL_UPPER_BOUNDS,
  fmt,
  fmtIndex,
  type ComponentId,
} from '@/lib/scoring/methodology'
import { eventsBetween, sliceSeries, type CyclePoint, type TrendEvent } from '@/lib/trends'
import { DataTable } from './ChartFrame'

type LineId = 'index' | ComponentId
type Shape = 'circle' | 'square' | 'triangle' | 'diamond'

/** Лінії розрізняються кольором, штрихом і формою маркера: колір не єдиний носій. */
const LINE_STYLE: Record<LineId, { color: string; dash?: string; shape: Shape; label: string }> = {
  index: { color: 'var(--color-data)', shape: 'circle', label: 'Індекс доброчесності' },
  culture: {
    color: 'var(--color-cat-culture)',
    dash: '7 4',
    shape: 'square',
    label: COMPONENT_LABELS.culture,
  },
  system: {
    color: 'var(--color-cat-system)',
    dash: '2 4',
    shape: 'triangle',
    label: COMPONENT_LABELS.system,
  },
  accountability: {
    color: 'var(--color-cat-accountability)',
    dash: '10 3 2 3',
    shape: 'diamond',
    label: COMPONENT_LABELS.accountability,
  },
}

function marker(shape: Shape, cx: number, cy: number, r: number, color: string) {
  const common = { fill: color, stroke: 'var(--color-surface)', strokeWidth: 1.5 }
  switch (shape) {
    case 'square':
      return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />
    case 'triangle':
      return (
        <path
          d={`M${cx} ${cy - r - 1}L${cx + r + 1} ${cy + r}L${cx - r - 1} ${cy + r}Z`}
          {...common}
        />
      )
    case 'diamond':
      return (
        <path
          d={`M${cx} ${cy - r - 1}L${cx + r + 1} ${cy}L${cx} ${cy + r + 1}L${cx - r - 1} ${cy}Z`}
          {...common}
        />
      )
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />
  }
}

const BOUNDS = [0, ...LEVEL_UPPER_BOUNDS, 100]
const TICKS = [0, ...LEVEL_UPPER_BOUNDS, 100]
/** Середини смуг рівнів: тут стоять підписи «Рівень N» на правій осі. */
const MIDS = BOUNDS.slice(0, -1).map((b, i) => (b + BOUNDS[i + 1]!) / 2)

export interface TrendsChartProps {
  series: CyclePoint[]
  events: TrendEvent[]
  /** Повний ряд, щоб знайти події між циклами. */
  fullSeries: CyclePoint[]
  lines: Record<ComponentId, boolean>
  className?: string
}

/** Графік динаміки з осями, межами рівнів, смугами, підписаними точками та подіями під віссю. */
export function TrendsChart({ series, events, fullSeries, lines, className }: TrendsChartProps) {
  const data = series.map((p, i) => ({ x: i, cycle: p.cycle, index: p.index, ...p.components }))
  const evs = eventsBetween(events, fullSeries, series[0]!.cycle, series[series.length - 1]!.cycle)
  const n = series.length
  return (
    <div className={cn('min-h-[200px] w-full', className)} aria-hidden>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 600, height: 300 }}
      >
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 4 }}>
          {BOUNDS.slice(0, -1).map((b, i) => (
            <ReferenceArea
              key={`band-${i}`}
              y1={b}
              y2={BOUNDS[i + 1]!}
              fill={`var(--color-maturity-${i + 1}-chart)`}
              fillOpacity={0.06}
              stroke="none"
              ifOverflow="visible"
            />
          ))}
          <defs>
            <linearGradient id="dyn-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-data)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-data)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="none" />
          <Area
            dataKey="index"
            stroke="none"
            fill="url(#dyn-grad)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
          {LEVEL_UPPER_BOUNDS.map((b) => (
            <ReferenceLine
              key={b}
              y={b}
              stroke="var(--color-border-strong)"
              strokeDasharray="3 4"
              strokeWidth={1}
            />
          ))}
          <XAxis
            type="number"
            dataKey="x"
            domain={[-0.4, n - 0.6]}
            ticks={data.map((d) => d.x)}
            tickFormatter={(v: number) => data[v]?.cycle ?? ''}
            tick={{ fontSize: 12, fill: 'var(--color-text)' }}
            tickLine={{ stroke: 'var(--color-border-strong)' }}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            height={evs.length ? 66 : 48}
            tickMargin={6}
            label={{
              value: 'Час (цикл оцінювання)',
              position: 'insideBottom',
              offset: 2,
              fontSize: 12,
              fill: 'var(--color-text-muted)',
            }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={TICKS}
            interval={0}
            tickFormatter={(v: number) => fmt(v)}
            width={52}
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            tickLine={{ stroke: 'var(--color-border-strong)' }}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            label={{
              value: 'Індекс (0-100)',
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              style: { textAnchor: 'middle', fontSize: 12, fill: 'var(--color-text-muted)' },
            }}
          />
          <YAxis
            yAxisId="levels"
            orientation="right"
            domain={[0, 100]}
            ticks={MIDS}
            interval={0}
            tickFormatter={(v: number) => `Рівень ${MIDS.indexOf(v) + 1}`}
            width={58}
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={false}
          />
          <Line
            yAxisId="levels"
            dataKey="index"
            stroke="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
          {COMPONENT_IDS.filter((id) => lines[id]).map((id) => {
            const st = LINE_STYLE[id]
            return (
              <Line
                key={id}
                dataKey={id}
                stroke={st.color}
                strokeWidth={2}
                strokeDasharray={st.dash}
                isAnimationActive={false}
                dot={({ cx = 0, cy = 0, index }) => (
                  <g key={`${id}-${index}`}>{marker(st.shape, cx, cy, 4, st.color)}</g>
                )}
              />
            )
          })}
          <Line
            dataKey="index"
            stroke={LINE_STYLE.index.color}
            strokeWidth={2.5}
            isAnimationActive={false}
            dot={({ cx = 0, cy = 0, index }) => (
              <g key={`i-${index}`}>{marker('circle', cx, cy, 5, LINE_STYLE.index.color)}</g>
            )}
          >
            <LabelList
              dataKey="index"
              position="top"
              offset={9}
              formatter={(v: unknown) => fmtIndex(Number(v))}
              style={{ fontSize: 13, fontWeight: 700, fill: 'var(--color-text)' }}
            />
          </Line>
          {evs.map((e) => {
            const from = series.findIndex((p) => p.cycle === e.afterCycle)
            return (
              <ReferenceDot
                key={e.id}
                x={from + 0.5}
                y={0}
                r={0}
                ifOverflow="visible"
                shape={({ cx = 0, cy = 0 }) => (
                  <g transform={`translate(${cx},${cy + 32})`}>
                    <title>{e.title}</title>
                    <path
                      d="M0 -7L7 0L0 7L-7 0Z"
                      fill="var(--color-surface)"
                      stroke="var(--color-text)"
                      strokeWidth={2}
                    />
                  </g>
                )}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function LineToggle({
  id,
  pressed,
  onToggle,
}: {
  id: ComponentId
  pressed: boolean
  onToggle: () => void
}) {
  const st = LINE_STYLE[id]
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'touch-h inline-flex items-center gap-1.5 rounded-md border px-2 text-caption focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        pressed
          ? 'border-accent bg-accent-soft font-semibold text-text'
          : 'border-border-strong bg-surface text-text-muted hover:bg-surface-muted',
      )}
    >
      <svg width="30" height="12" aria-hidden>
        <line
          x1="0"
          y1="6"
          x2="30"
          y2="6"
          stroke={st.color}
          strokeWidth="2"
          strokeDasharray={st.dash}
        />
        <g>{marker(st.shape, 15, 6, 3.5, st.color)}</g>
      </svg>
      {st.label}
    </button>
  )
}

export interface DynamicsPanelProps {
  series: CyclePoint[]
  events: TrendEvent[]
  /** Висота графіка (клас Tailwind). */
  chartClassName?: string
  /** Посилання «Детальніше» (на головній). */
  moreHref?: string
  title?: string
  headingId?: string
  /** Рівень заголовка: картка на головній використовує h2. */
  className?: string
  extra?: ReactNode
}

/** Картка «Динаміка індексу»: період, лінії, графік, таблиця, опис для скрінрідерів. */
export function DynamicsPanel({
  series,
  events,
  chartClassName = 'h-[260px]',
  moreHref,
  title = 'Динаміка індексу',
  className,
  extra,
}: DynamicsPanelProps) {
  const headId = useId()
  const cycles = series.map((p) => p.cycle)
  const [from, setFrom] = useState(cycles[0]!)
  const [to, setTo] = useState(cycles[cycles.length - 1]!)
  const [lines, setLines] = useState<Record<ComponentId, boolean>>({
    culture: false,
    system: false,
    accountability: false,
  })
  const [asTable, setAsTable] = useState(false)
  const slice = useMemo(() => sliceSeries(series, from, to), [series, from, to])
  const shownEvents = eventsBetween(events, series, from, to)

  const fromIdx = cycles.indexOf(from)
  const onFrom = (v: string) => {
    setFrom(v)
    if (cycles.indexOf(to) <= cycles.indexOf(v))
      setTo(cycles[Math.min(cycles.indexOf(v) + 1, cycles.length - 1)]!)
  }
  const first = slice[0]!
  const last = slice[slice.length - 1]!
  const description = `Індекс доброчесності: ${slice.map((p) => `${p.cycle} ${fmtIndex(p.index)}`).join(', ')}. ${
    last.index > first.index
      ? `За період індекс зріс на ${fmt(last.index - first.index)} пункта.`
      : last.index < first.index
        ? `За період індекс знизився на ${fmt(first.index - last.index)} пункта.`
        : 'За період індекс не змінився.'
  }${shownEvents.length ? ` Події між циклами: ${shownEvents.map((e) => e.title).join('; ')}.` : ''}`
  const activeLines = COMPONENT_IDS.filter((id) => lines[id])

  return (
    <Card
      as="section"
      aria-labelledby={headId}
      className={cn('flex flex-col gap-2 p-4 short:p-3', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={headId} className="card-title">
          <TrendingUp aria-hidden />
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-caption text-text-muted">
            Від
            <Select
              aria-label="Початок періоду"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
              wrapperClassName="w-[7.5rem]"
              className="!h-9 !py-0 text-caption"
            >
              {cycles.slice(0, -1).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1 text-caption text-text-muted">
            До
            <Select
              aria-label="Кінець періоду"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              wrapperClassName="w-[7.5rem]"
              className="!h-9 !py-0 text-caption"
            >
              {cycles.slice(fromIdx + 1).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className={cn(buttonBase, buttonVariants.ghost, buttonSizes.sm, 'shrink-0 !px-2')}
          >
            {asTable ? (
              <BarChart3 aria-hidden className="size-4" />
            ) : (
              <Table2 aria-hidden className="size-4" />
            )}
            <span>{asTable ? 'Показати як діаграму' : 'Показати як таблицю'}</span>
          </button>
          {moreHref && (
            <Link
              to={moreHref}
              className={cn(buttonBase, buttonVariants.secondary, buttonSizes.sm, 'no-underline')}
            >
              Детальніше
            </Link>
          )}
        </div>
      </div>
      <div
        role="group"
        aria-label="Лінії компонентів"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-caption text-text-muted short:sr-only">Додати лінію:</span>
        {COMPONENT_IDS.map((id) => (
          <LineToggle
            key={id}
            id={id}
            pressed={lines[id]}
            onToggle={() => setLines((l) => ({ ...l, [id]: !l[id] }))}
          />
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {asTable ? (
          <div className="overflow-auto">
            <DataTable
              caption="Індекс і компоненти за цикли оцінювання"
              head={['Цикл', 'Індекс', ...activeLines.map((id) => COMPONENT_LABELS[id])]}
              rows={slice.map((p) => [
                p.cycle,
                fmtIndex(p.index),
                ...activeLines.map((id) => fmt(p.components[id])),
              ])}
            />
            {shownEvents.length > 0 && (
              <ul className="m-0 mt-2 list-disc pl-5 text-caption">
                {shownEvents.map((e) => (
                  <li key={e.id}>
                    Після циклу {e.afterCycle}: {e.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <TrendsChart
            series={slice}
            fullSeries={series}
            events={events}
            lines={lines}
            className={chartClassName}
          />
        )}
      </div>
      {!asTable && shownEvents.length > 0 && (
        <p className="m-0 flex items-center gap-1.5 text-caption text-text-muted short:sr-only">
          <svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden>
            <path
              d="M0 -7L7 0L0 7L-7 0Z"
              fill="var(--color-surface)"
              stroke="var(--color-text)"
              strokeWidth="2"
            />
          </svg>
          Виконані заходи між циклами: {shownEvents.length}. Подробиці в таблиці («Показати як
          таблицю»).
        </p>
      )}
      <p className="sr-only">{description}</p>
      {extra}
    </Card>
  )
}
