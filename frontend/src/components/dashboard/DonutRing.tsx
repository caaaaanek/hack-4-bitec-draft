import { cn } from '@/lib/cn'

/** Кільце відсотка: колір за значенням (від 60 сильно, від 40 увага, нижче критично), число завжди поруч. */
export function DonutRing({
  value,
  size = 44,
  className,
}: {
  value: number
  size?: number
  className?: string
}) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const color =
    value >= 60
      ? 'var(--color-data)'
      : value >= 40
        ? 'var(--color-attention-solid)'
        : 'var(--color-critical-solid)'
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      focusable="false"
      className={cn('shrink-0 -rotate-90', className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="5"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(Math.min(value, 100) / 100) * c} ${c}`}
      />
    </svg>
  )
}
