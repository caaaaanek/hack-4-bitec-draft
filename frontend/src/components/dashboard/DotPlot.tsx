import { SourceMarker } from '@/components/ui'
import { SOURCES } from '@/components/ui/config'
import { cn } from '@/lib/cn'
import { COMPONENT_LABELS, fmt } from '@/lib/scoring/methodology'
import type { CompareRow } from '@/lib/compare'

const POINTS = [
  { key: 'wg', get: (r: CompareRow) => r.bySource.wg },
  { key: 'os', get: (r: CompareRow) => r.bySource.os },
  { key: 'experts', get: (r: CompareRow) => r.bySource.experts },
  { key: 'facts', get: (r: CompareRow) => r.facts },
] as const

/** Точковий графік: по компоненту маркери джерел на шкалі 0-100 і розрив сприйняття й фактів справа. */
export function DotPlot({ rows }: { rows: CompareRow[] }) {
  return (
    <div className="flex flex-1 flex-col">
      <ul
        aria-label="Джерела"
        className="m-0 mb-3 flex list-none flex-wrap justify-end gap-x-4 gap-y-1 p-0 text-caption text-text-muted"
      >
        {POINTS.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <SourceMarker source={p.key} size={12} />
            {SOURCES[p.key].label}
          </li>
        ))}
      </ul>
      <ul className="m-0 flex flex-1 list-none flex-col justify-around p-0" aria-hidden>
        {rows.map((r) => {
          const vals = POINTS.map((p) => p.get(r))
          const lo = Math.min(...vals)
          const hi = Math.max(...vals)
          return (
            <li
              key={r.component}
              className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 border-t border-border py-4 first:border-t-0"
            >
              <span className="text-body">{COMPONENT_LABELS[r.component]}</span>
              <span className="relative block h-6">
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                <span
                  className={cn(
                    'absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full',
                    r.limited ? 'bg-critical-bg' : 'bg-attention-bg',
                  )}
                  style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                />
                {POINTS.map((p) => (
                  <span
                    key={p.key}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${p.get(r)}%` }}
                  >
                    <SourceMarker source={p.key} size={14} />
                  </span>
                ))}
              </span>
              <span
                className={cn(
                  'tabular text-right text-body font-semibold',
                  r.limited ? 'text-critical-text' : 'text-text',
                )}
              >
                {fmt(r.gap)}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="m-0 mt-2 text-caption text-text-muted">
        Число справа: розрив між сприйняттям і фактами в пунктах. Понад 25 пунктів спрацьовує
        обмежувач.
      </p>
    </div>
  )
}
