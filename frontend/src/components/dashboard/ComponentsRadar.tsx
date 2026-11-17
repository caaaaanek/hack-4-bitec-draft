import { fmt } from '@/lib/scoring/methodology'
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'
import { LEVEL_UPPER_BOUNDS } from '@/lib/scoring/methodology'

/** Анімація появи до 800 мс, вимкнена при prefers-reduced-motion. */
const animate = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false

const RINGS = [...LEVEL_UPPER_BOUNDS, 100]

export interface RadarRow {
  name: string
  current: number
  previous: number
}

const CUR = 'var(--color-data)'
const PREV = 'var(--color-neutral-solid)'

/** Радар по трьох компонентах: поточний цикл суцільний з колом, попередній пунктирний з квадратом. */
export function ComponentsRadar({ data }: { data: RadarRow[] }) {
  return (
    <div className="h-full min-h-[120px]" aria-hidden>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 320, height: 220 }}
      >
        <RadarChart
          data={data}
          outerRadius="92%"
          margin={{ top: 34, right: 8, bottom: 30, left: 8 }}
        >
          <PolarGrid stroke="var(--color-border-strong)" strokeOpacity={0.5} />
          <PolarRadiusAxis
            angle={150}
            domain={[0, 100]}
            ticks={RINGS}
            tickFormatter={(v: number) => String(RINGS.indexOf(v) + 1)}
            tick={false}
            axisLine={false}
            tickLine={false}
          />
          <PolarAngleAxis
            dataKey="name"
            tick={({ x: rx = 0, y: ry = 0, payload }) => {
              const x = Number(rx)
              const y = Number(ry)
              const row = data.find((d) => d.name === payload.value)
              const top = payload.index === 0
              return (
                <text x={x} y={y} textAnchor="middle" fontSize={14} fill="var(--color-text)">
                  <tspan x={x} dy={top ? -18 : 14}>
                    {payload.value}
                  </tspan>
                  <tspan x={x} dy={top ? 16 : 17} fontWeight={700}>
                    {row ? fmt(row.current) : ''}
                  </tspan>
                </text>
              )
            }}
          />
          <Radar
            dataKey="previous"
            stroke={PREV}
            strokeWidth={2}
            strokeDasharray="6 4"
            fill={PREV}
            fillOpacity={0.08}
            isAnimationActive={animate()}
            animationDuration={800}
            dot={({ cx = 0, cy = 0 }) => (
              <rect key={`${cx}${cy}`} x={cx - 4} y={cy - 4} width={8} height={8} fill={PREV} />
            )}
          />
          <Radar
            dataKey="current"
            stroke={CUR}
            strokeWidth={3}
            fill={CUR}
            fillOpacity={0.22}
            isAnimationActive={animate()}
            animationDuration={800}
            dot={({ cx = 0, cy = 0 }) => (
              <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={5} fill={CUR} />
            )}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RadarLegend({ current, previous }: { current: string; previous: string }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-caption">
      <li className="flex items-center gap-2">
        <svg width="28" height="12" aria-hidden>
          <line x1="0" y1="6" x2="28" y2="6" stroke={CUR} strokeWidth="3" />
          <circle cx="14" cy="6" r="5" fill={CUR} />
        </svg>
        Цикл {current}
      </li>
      <li className="flex items-center gap-2">
        <svg width="28" height="12" aria-hidden>
          <line x1="0" y1="6" x2="28" y2="6" stroke={PREV} strokeWidth="2" strokeDasharray="6 4" />
          <rect x="10" y="2" width="8" height="8" fill={PREV} />
        </svg>
        Цикл {previous}
      </li>
      <li className="text-text-muted">Кільця 1-5: верхні межі рівнів зрілості</li>
    </ul>
  )
}
