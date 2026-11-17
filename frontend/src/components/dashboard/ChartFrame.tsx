import { useId, useState, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { Card, buttonBase, buttonSizes, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface ChartFrameProps {
  title: string
  subtitle?: string
  /** Короткий текстовий опис графіка (завжди видимий). */
  description: string
  icon?: ReactNode
  chart: ReactNode
  table: ReactNode
  className?: string
  chartClassName?: string
}

/** Картка графіка: заголовок, графік або таблиця даних, текстовий опис. */
export function ChartFrame({
  title,
  subtitle,
  description,
  icon,
  chart,
  table,
  className,
  chartClassName,
}: ChartFrameProps) {
  const [asTable, setAsTable] = useState(false)
  const id = useId()
  return (
    <Card
      as="section"
      aria-labelledby={id}
      className={cn('flex flex-col p-4 md:p-4 short:p-3 short:md:p-3', className)}
    >
      <div className="mb-2 short:mb-1 flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div>
          <h2 id={id} className="card-title">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="m-0 text-caption text-text-muted">{subtitle}</p>}
        </div>
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
      </div>
      <div className={cn('min-h-0 flex-1', chartClassName)}>
        {asTable ? <div className="overflow-auto">{table}</div> : chart}
      </div>
      <p className="m-0 mt-2 text-caption text-text-muted short:sr-only">{description}</p>
    </Card>
  )
}

/** Проста компактна таблиця даних для режиму «як таблиця». */
export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string
  head: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="w-full border-collapse text-caption">
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-surface-muted">
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cn('px-3 py-1.5 font-semibold', i === 0 ? 'text-left' : 'text-right')}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])} className="border-b border-border last:border-b-0">
            {r.map((c, i) => (
              <td key={i} className={cn('px-3 py-1.5', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Графік з перемикачем «Показати як таблицю». Текстовий опис лише для скрінрідерів. */
export function ChartView({
  chart,
  table,
  description,
}: {
  chart: ReactNode
  table: ReactNode
  description: string
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <div className="flex flex-col">
      <div className="flex justify-end">
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
      </div>
      <div className="min-h-0">
        {asTable ? <div className="overflow-auto">{table}</div> : chart}
      </div>
      <p className="sr-only">{description}</p>
    </div>
  )
}
