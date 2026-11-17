import { useEffect, useState } from 'react'
import { LEVEL_UPPER_BOUNDS, fmt } from '@/lib/scoring/methodology'
import { MATURITY, type MaturityLevel } from '@/components/ui/config'

const CX = 160
const CY = 150
const R = 112
const W = 26
const BOUNDS = [0, ...LEVEL_UPPER_BOUNDS, 100]

const pt = (v: number, r: number) => {
  const a = Math.PI * (1 - v / 100)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const
}
const arcAt = (v0: number, v1: number, r: number) => {
  const [x0, y0] = pt(v0, r)
  const [x1, y1] = pt(v1, r)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const arc = (v0: number, v1: number) => arcAt(v0, v1, R)

const SWEEP_MS = 800

/** Прогрес 0..1 за SWEEP_MS (ease-out). Без анімації при prefers-reduced-motion або без rAF. */
function useSweep(): number {
  const [t, setT] = useState(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function')
      return 1
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false ? 0 : 1
  })
  useEffect(() => {
    if (t === 1) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / SWEEP_MS)
      setT(1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return t
}

/** Gauge 0-100: п'ять рівнів зрілості, межі підписано, маркер значення. */
export function Gauge({ value, level }: { value: number; level: MaturityLevel }) {
  const shown = value * useSweep()
  const [nx0, ny0] = pt(shown, R - W / 2 - 5)
  const [nx1, ny1] = pt(shown, R + W / 2 + 5)
  return (
    <svg
      viewBox="0 0 320 190"
      className="mx-auto block h-auto w-full max-w-[340px] short:max-w-[270px]"
      aria-hidden
      focusable="false"
    >
      {BOUNDS.slice(0, -1).map((b, i) => {
        const lv = (i + 1) as MaturityLevel
        const [tx, ty] = pt((b + BOUNDS[i + 1]!) / 2, R)
        return (
          <g key={lv}>
            {lv === level && (
              <path
                d={arc(b, BOUNDS[i + 1]!)}
                fill="none"
                strokeWidth={W + 6}
                stroke="var(--color-text)"
              />
            )}
            <path
              d={arc(b, BOUNDS[i + 1]!)}
              fill="none"
              strokeWidth={W}
              stroke={`var(--color-maturity-${lv}-chart)`}
            />
            <text
              x={tx}
              y={ty + 5}
              textAnchor="middle"
              fontSize="15"
              fontWeight="700"
              fill={`var(--color-maturity-${lv}-chart-text)`}
            >
              {lv}
            </text>
          </g>
        )
      })}
      {/* Короткі риски шкали через кожні 2,5 пункту */}
      {Array.from({ length: 41 }, (_, i) => i * 2.5).map((v) => {
        if (BOUNDS.includes(v) || v % 12.5 === 0) return null
        const [x0, y0] = pt(v, R + W / 2 + 4)
        const [x1, y1] = pt(v, R + W / 2 + 7)
        return (
          <line
            key={v}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke="var(--color-border-strong)"
            strokeWidth="1"
          />
        )
      })}
      {/* Межі рівнів: розділювачі, довгі риски й підписи значень */}
      {BOUNDS.slice(1, -1).map((b) => {
        const [x0, y0] = pt(b, R - W / 2 - 1)
        const [x1, y1] = pt(b, R + W / 2 + 1)
        const [tx0, ty0] = pt(b, R + W / 2 + 4)
        const [tx1, ty1] = pt(b, R + W / 2 + 11)
        const [lx, ly] = pt(b, R + W / 2 + 22)
        return (
          <g key={b}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-surface)" strokeWidth="3" />
            <line
              x1={tx0}
              y1={ty0}
              x2={tx1}
              y2={ty1}
              stroke="var(--color-text-muted)"
              strokeWidth="2"
            />
            <text
              x={lx}
              y={ly + 5}
              textAnchor="middle"
              fontSize="14"
              fill="var(--color-text-muted)"
            >
              {fmt(b)}
            </text>
          </g>
        )
      })}
      <text x={CX - R} y={CY + 24} textAnchor="middle" fontSize="14" fill="var(--color-text-muted)">
        0
      </text>
      <text x={CX + R} y={CY + 24} textAnchor="middle" fontSize="14" fill="var(--color-text-muted)">
        100
      </text>
      {/* Заповнення: внутрішня дуга від 0 до значення, росте разом зі стрілкою */}
      {shown > 0.2 && (
        <path
          d={arcAt(0, shown, R - W / 2 - 9)}
          fill="none"
          stroke="var(--color-text)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      <line
        x1={nx0}
        y1={ny0}
        x2={nx1}
        y2={ny1}
        stroke="var(--color-text)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <text
        x={CX}
        y={CY - 18}
        textAnchor="middle"
        fontSize="56"
        fontWeight="700"
        letterSpacing="-1"
        fill="var(--color-text)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {fmt(value)}
      </text>
      <text x={CX} y={CY + 6} textAnchor="middle" fontSize="15" fill="var(--color-text-muted)">
        з 100
      </text>
      <text
        x={CX}
        y={CY + 26}
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fill="var(--color-text)"
      >
        {`Рівень ${level}: ${MATURITY[level].name}`}
      </text>
      <title>{`Індекс доброчесності ${fmt(value)} з 100, рівень ${level} ${MATURITY[level].name}`}</title>
    </svg>
  )
}
