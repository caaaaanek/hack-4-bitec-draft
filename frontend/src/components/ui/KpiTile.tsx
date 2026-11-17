import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card } from './Card'

/** Чип зміни: стрілка, число і слово. Колір лише підсилює. */
export function ChangeChip({ delta, unit = '' }: { delta: number; unit?: string }) {
  const up = delta > 0
  const down = delta < 0
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus
  const word = up ? 'Зросло' : down ? 'Знизилось' : 'Без змін'
  const abs = Math.abs(delta).toLocaleString('uk-UA', { maximumFractionDigits: 1 })
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption font-semibold tabular-nums',
        up && 'bg-strength-bg text-strength-text',
        down && 'bg-attention-bg text-attention-text',
        !up && !down && 'bg-neutral-bg text-neutral-text',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {!up && !down ? null : (
        <span>
          {abs}
          {unit}
        </span>
      )}
      <span className="font-medium">{word}</span>
    </span>
  )
}

export interface KpiTileProps {
  label: string
  value: ReactNode
  unit?: string
  delta?: number
  deltaUnit?: string
  className?: string
}

/** KPI-плитка: велике число, підпис, чип зміни. */
export function KpiTile({ label, value, unit, delta, deltaUnit, className }: KpiTileProps) {
  return (
    <Card className={cn('p-3 md:p-4', className)}>
      <p className="m-0 text-caption text-text-muted">{label}</p>
      <p className="m-0 mt-1 flex items-baseline gap-1 text-numeral tabular-nums">
        {value}
        {unit && <span className="text-body text-text-muted">{unit}</span>}
      </p>
      {delta !== undefined && (
        <p className="m-0 mt-2">
          <ChangeChip delta={delta} unit={deltaUnit} />
        </p>
      )}
    </Card>
  )
}
