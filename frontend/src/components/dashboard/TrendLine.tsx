import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, LabelList } from 'recharts'

export interface TrendPoint {
  cycle: string
  index: number
}

/** Динаміка індексу за цикли: лінія з підписаними значеннями. */
export function TrendLine({
  data,
  className = 'h-[84px]',
}: {
  data: TrendPoint[]
  className?: string
}) {
  return (
    <div className={className} aria-hidden>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 84 }}>
        <LineChart data={data} margin={{ top: 20, right: 28, bottom: 0, left: 28 }}>
          <XAxis
            dataKey="cycle"
            tick={{ fontSize: 14, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
          />
          <YAxis hide domain={[30, 60]} />
          <Line
            dataKey="index"
            stroke="var(--color-data)"
            strokeWidth={3}
            isAnimationActive={false}
            dot={{
              r: 5,
              fill: 'var(--color-data)',
              stroke: 'var(--color-surface)',
              strokeWidth: 2,
            }}
          >
            <LabelList
              dataKey="index"
              position="top"
              offset={8}
              formatter={(v: unknown) => Number(v).toFixed(1).replace('.', ',')}
              style={{ fontSize: 14, fontWeight: 600, fill: 'var(--color-text)' }}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
