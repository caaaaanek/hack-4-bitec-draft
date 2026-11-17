import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'
import { LEVEL_UPPER_BOUNDS, fmt } from '@/lib/scoring/methodology'

export interface RadarSeries {
  key: string
  label: string
  color: string
  dash?: string
  shape: 'circle' | 'square' | 'diamond'
}

export type RadarRow = { name: string } & Record<string, number | string>

const animate = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false

const RINGS = [...LEVEL_UPPER_BOUNDS, 100]

const marker = (shape: RadarSeries['shape'], cx: number, cy: number, color: string, k: string) =>
  shape === 'square' ? (
    <rect key={k} x={cx - 4} y={cy - 4} width={8} height={8} fill={color} />
  ) : shape === 'diamond' ? (
    <path
      key={k}
      d={`M${cx} ${cy - 5}L${cx + 5} ${cy}L${cx} ${cy + 5}L${cx - 5} ${cy}Z`}
      fill={color}
    />
  ) : (
    <circle key={k} cx={cx} cy={cy} r={4.5} fill={color} />
  )

/** Радар по компонентах: кілька серій, кільця меж рівнів 1-5, значення біля вершин. */
export function ProfileRadar({ data, series }: { data: RadarRow[]; series: RadarSeries[] }) {
  return (
    <div className="h-full" aria-hidden>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 360, height: 280 }}
      >
        <RadarChart
          data={data}
          outerRadius="96%"
          margin={{ top: 34, right: 24, bottom: 30, left: 24 }}
        >
          <PolarGrid stroke="var(--color-border-strong)" strokeOpacity={0.45} />
          <PolarRadiusAxis
            angle={150}
            domain={[0, 100]}
            ticks={RINGS}
            tick={false}
            axisLine={false}
          />
          <PolarAngleAxis
            dataKey="name"
            tick={({ x: rx = 0, y: ry = 0, payload }) => {
              const x = Number(rx)
              const y = Number(ry)
              const row = data.find((d) => d.name === payload.value)
              const top = payload.index === 0
              return (
                <text x={x} y={y} textAnchor="middle" fontSize={13} fill="var(--color-text)">
                  <tspan x={x} dy={top ? -16 : 14}>
                    {payload.value}
                  </tspan>
                  <tspan x={x} dy={top ? 15 : 16} fontWeight={700}>
                    {row ? fmt(Number(row[series[series.length - 1]!.key])) : ''}
                  </tspan>
                </text>
              )
            }}
          />
          {series.map((s) => (
            <Radar
              key={s.key}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              fill={s.color}
              fillOpacity={0.08}
              isAnimationActive={animate()}
              animationDuration={800}
              dot={({ cx = 0, cy = 0, index }) =>
                marker(s.shape, cx, cy, s.color, `${s.key}-${index}`)
              }
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RadarLegendList({ series }: { series: RadarSeries[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-1 p-0 text-caption text-text-muted">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <svg width="28" height="12" aria-hidden>
            <line
              x1="0"
              y1="6"
              x2="28"
              y2="6"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dash}
            />
            {marker(s.shape, 14, 6, s.color, 'l')}
          </svg>
          {s.label}
        </li>
      ))}
      <li>Кільця 1-5: верхні межі рівнів зрілості</li>
    </ul>
  )
}
