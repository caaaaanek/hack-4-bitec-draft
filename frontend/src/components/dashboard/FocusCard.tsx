import { useId } from 'react'
import { Link } from 'react-router-dom'
import {
  AlarmClock,
  ArrowRight,
  FileText,
  GraduationCap,
  Lightbulb,
  ListChecks,
  SearchCheck,
} from 'lucide-react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { COMPONENT_LABELS, type ComponentId } from '@/lib/scoring/methodology'
import type { Insight } from '@/demo/institutions'

const ACTION_ICON = { accountability: SearchCheck, system: FileText, culture: GraduationCap }

const row =
  'flex items-center gap-3 rounded-[10px] px-1.5 py-1.5 text-text no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** «Фокус»: що потребує уваги, сильні сторони, заходи в трекері і переходи до рекомендацій і звіту. */
export function FocusCard({
  attention,
  strengths,
  measures,
  links,
  className,
}: {
  attention: Insight[]
  strengths: Insight[]
  measures: { total: number; overdue: number } | null
  links: { recommendations: boolean; report: boolean; tracker: boolean }
  className?: string
}) {
  const hid = useId()
  const to = (it: Insight) => (it.component ? `/explain?c=${it.component}` : '/explain')
  return (
    <Card
      as="section"
      id="attention"
      aria-labelledby={hid}
      className={cn('flex flex-col', className)}
    >
      <h2 id={hid} className="card-title">
        Що потребує уваги
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
        {attention.map((it) => {
          const Icon = it.component ? ACTION_ICON[it.component as ComponentId] : SearchCheck
          return (
            <li key={it.id}>
              <Link to={to(it)} title={it.hint} className={row}>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-attention-solid" />
                <Icon aria-hidden className="size-4 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{it.title}</span>
                  {it.component && (
                    <span className="block text-fine text-text-muted">
                      {COMPONENT_LABELS[it.component]}
                    </span>
                  )}
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-text-muted" />
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="m-0 mt-3 px-1.5 text-caption font-medium text-text-muted">Сильні сторони</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {strengths.map((it) => (
          <li key={it.id}>
            <Link to={to(it)} title={it.hint} className={row}>
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-strength-solid" />
              <span className="min-w-0 flex-1 text-body">{it.title}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {measures && (
        <div className="mt-3 border-t border-border pt-2">
          {links.tracker ? (
            <Link to="/tracker" className={row}>
              <ListChecks aria-hidden className="size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 text-body">
                Заходи в трекері: {measures.total}
                {measures.overdue > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-caption font-medium text-critical-text">
                    <AlarmClock aria-hidden className="size-3.5" />З них {measures.overdue}{' '}
                    прострочено
                  </span>
                )}
              </span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-text-muted" />
            </Link>
          ) : (
            <p className="m-0 flex items-center gap-3 px-1.5 py-2 text-body">
              <ListChecks aria-hidden className="size-4 text-text-muted" />
              Заходи в трекері: {measures.total}
              {measures.overdue > 0 && (
                <span className="text-caption text-critical-text">
                  З них {measures.overdue} прострочено
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {(links.recommendations || links.report) && (
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3">
          {links.recommendations && (
            <Link
              to="/recommendations"
              className="inline-flex items-center gap-1.5 text-body font-medium text-accent"
            >
              <Lightbulb aria-hidden className="size-4" />
              Рекомендації
            </Link>
          )}
          {links.report && (
            <Link
              to="/reports"
              className="inline-flex items-center gap-1.5 text-body font-medium text-accent"
            >
              <FileText aria-hidden className="size-4" />
              Звіт
            </Link>
          )}
        </div>
      )}
    </Card>
  )
}
