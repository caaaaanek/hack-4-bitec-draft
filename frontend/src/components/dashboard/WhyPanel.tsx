import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { SearchCheck, TriangleAlert } from 'lucide-react'
import { Dialog, MATURITY, type MaturityLevel } from '@/components/ui'
import {
  FLAG_HINT,
  FLAG_WEIGHT_LABEL,
  TRUST_GRADE_TEXT,
  TRUST_HINT,
  TRUST_LABEL,
} from '@/components/ui/messages'
import { buildConclusion } from '@/lib/conclusion'
import { cn } from '@/lib/cn'
import { LEVEL_UPPER_BOUNDS, LIMITER_MARGIN, fmt } from '@/lib/scoring/methodology'
import type { Institution } from '@/demo/institutions'

export type WhySection = 'top' | 'flags'

const LEVELS: MaturityLevel[] = [1, 2, 3, 4, 5]

function rangeText(l: MaturityLevel): string {
  const lo = l === 1 ? 0 : LEVEL_UPPER_BOUNDS[l - 2]!
  const hi = l === 5 ? 100 : LEVEL_UPPER_BOUNDS[l - 1]!
  return l === 1
    ? `від 0 до ${fmt(hi)}`
    : l === 5
      ? `вище ${fmt(lo)}`
      : `вище ${fmt(lo)} до ${fmt(hi)}`
}

/** Три смуги «Сприйняття, Факти, Зараховано»: підпис і число завжди поруч, колір не єдиний носій. */
function LimitedCompare({
  perception,
  facts,
  credited,
}: {
  perception: number
  facts: number
  credited: number
}) {
  const rows: { label: string; value: number; cls: string }[] = [
    { label: 'Сприйняття', value: perception, cls: 'bg-source-wg' },
    { label: 'Факти', value: facts, cls: 'bg-source-facts' },
    { label: 'Зараховано', value: credited, cls: 'bg-accent' },
  ]
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-body"
        >
          <span>{r.label}</span>
          <span aria-hidden className="h-3 rounded-sm bg-surface-muted">
            <span className={cn('block h-3 rounded-sm', r.cls)} style={{ width: `${r.value}%` }} />
          </span>
          <span className="tabular text-right font-semibold">{fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Висувна панель «Чому такий індекс»: висновок, обмеження, як рахується, шкала, прапорці. */
export function WhyPanel({
  open,
  onClose,
  inst,
  section = 'top',
}: {
  open: boolean
  onClose: () => void
  inst: Institution
  section?: WhySection
}) {
  useEffect(() => {
    if (!open || section !== 'flags') return
    const t = setTimeout(
      () => document.getElementById('why-flags')?.scrollIntoView?.({ block: 'start' }),
      0,
    )
    return () => clearTimeout(t)
  }, [open, section])

  const limited = inst.components.find((c) => c.credited.limited)
  const grade = inst.trust.grade
  const t = TRUST_GRADE_TEXT[grade]
  const conclusion = buildConclusion({
    index: inst.index,
    level: inst.level,
    delta: inst.delta,
    components: inst.components,
    trustGrade: grade,
  })

  return (
    <Dialog open={open} onClose={onClose} title="Чому такий індекс" variant="side">
      <div className="flex flex-col gap-5 pb-2">
        <section aria-labelledby="why-summary">
          <h3 id="why-summary" className="m-0 text-body font-semibold">
            Короткий висновок
          </h3>
          <p className="m-0 mt-1 text-body">{conclusion}</p>
        </section>

        {limited && (
          <section
            aria-labelledby="why-limited"
            className="rounded-md border border-border bg-surface-muted p-3"
          >
            <h3 id="why-limited" className="m-0 text-body font-semibold">
              Показано з обмеженням
            </h3>
            <p className="m-0 mt-1 text-caption text-text-muted">{limited.credited.reason}</p>
            <LimitedCompare
              perception={limited.perception}
              facts={limited.facts}
              credited={limited.credited.value}
            />
          </section>
        )}

        <section aria-labelledby="why-how">
          <h3 id="why-how" className="m-0 text-body font-semibold">
            Як це рахується
          </h3>
          <ol className="m-0 mt-1 flex list-decimal flex-col gap-1.5 pl-5 text-body">
            <li>
              Індекс від 0 до 100 це середнє трьох компонентів: Культура, Система, Підзвітність.
            </li>
            <li>
              Кожен компонент складається зі сприйняття (анкети) і фактів (чек-лист та дані обліку).
            </li>
            <li>
              Сприйняття не може бути вищим за факти більш ніж на {LIMITER_MARGIN} пунктів: у такому
              разі зараховується менше значення.
            </li>
            <li>Рівень зрілості від 1 до 5 визначають межі шкали нижче.</li>
            <li>
              Достовірність показує, наскільки результату можна довіряти. Вона залежить від
              прапорців.
            </li>
          </ol>
          <p className="m-0 mt-2 text-caption">
            <Link to="/explain" onClick={onClose} className="text-accent underline">
              Відкрити розклад індексу
            </Link>
          </p>
        </section>

        <section aria-labelledby="why-scale">
          <h3 id="why-scale" className="m-0 text-body font-semibold">
            Шкала рівнів зрілості
          </h3>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-body">
            {LEVELS.map((l) => (
              <li key={l} className="flex flex-wrap items-center gap-2">
                <span
                  data-maturity={l}
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-sm border tabular',
                    MATURITY[l].classes,
                    l === inst.level && 'font-bold ring-2 ring-text',
                  )}
                >
                  {l}
                </span>
                <span>
                  {MATURITY[l].name}: {rangeText(l)}
                </span>
                {l === inst.level && <span className="text-caption font-semibold">Поточний</span>}
              </li>
            ))}
          </ul>
        </section>

        <section
          id="why-flags"
          aria-labelledby="why-flags-h"
          className="scroll-mt-2 border-t border-border pt-3"
        >
          <h3 id="why-flags-h" className="m-0 text-body font-semibold">
            Варто перевірити додатково
          </h3>
          <p className="m-0 mt-1 text-caption text-text-muted">
            {TRUST_LABEL} {t.letter}: {t.word}. {TRUST_HINT}
          </p>
          {inst.trust.raised.length === 0 ? (
            <p className="m-0 mt-2 text-body">Жоден прапорець не спрацював.</p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {inst.trust.raised.map((f) => {
                const Icon = f.weight === 'major' ? TriangleAlert : SearchCheck
                return (
                  <li key={f.id} className="flex items-start gap-2">
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention-text" />
                    <div>
                      <p className="m-0 text-body font-semibold">
                        {f.title}{' '}
                        <span className="rounded-sm border border-border px-1.5 text-caption font-normal text-text-muted">
                          {FLAG_WEIGHT_LABEL[f.weight]}
                        </span>
                      </p>
                      <p className="m-0 text-caption text-text-muted">{f.explanation}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="m-0 mt-2 text-caption text-text-muted">{FLAG_HINT}</p>
        </section>
      </div>
    </Dialog>
  )
}
