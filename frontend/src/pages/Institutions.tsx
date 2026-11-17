import { PageTitle } from '@/components/layout/PageTitle'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUp, Building2, Minus } from 'lucide-react'
import { Card, MaturityBadge } from '@/components/ui'
import { TRUST_GRADE_TEXT } from '@/components/ui/messages'
import { fmtIndex, pointsText } from '@/lib/scoring/methodology'
import { directionOf } from '@/lib/trends'
import { useDemo } from '@/demo/demoContext'
import { INSTITUTIONS } from '@/demo/institutions'

const ARROW = { up: ArrowUp, down: ArrowDown, same: Minus } as const

/** Заклади для спостерігача: картки за назвою, без сортування за показниками й без порівнянь. */
export function Institutions() {
  const { setInstitutionId } = useDemo()
  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <div>
        <PageTitle>Заклади</PageTitle>
        <p className="m-0 text-body text-text-muted">
          Показано узагальнені дані. Заклади не порівнюються між собою.
        </p>
        <p className="m-0 text-caption text-text-muted">
          Заклади подано в алфавітному порядку за назвою.
        </p>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-4">
        {INSTITUTIONS.map((i) => {
          const dir = directionOf(i.delta)
          const Arrow = ARROW[dir]
          const t = TRUST_GRADE_TEXT[i.trust.grade]
          const change =
            dir === 'same'
              ? 'Без змін'
              : `${dir === 'up' ? 'Зросло' : 'Знизилось'} на ${pointsText(i.delta)}`
          return (
            <li key={i.id} className="min-w-0">
              <Card className="relative h-full transition-colors hover:bg-surface-muted">
                <h2 className="m-0 flex items-start gap-2 text-card">
                  <Building2 aria-hidden className="mt-1 size-5 shrink-0 text-text-muted" />
                  <Link
                    to="/"
                    onClick={() => setInstitutionId(i.id)}
                    className="text-text no-underline after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {i.name}
                    <span className="sr-only">: відкрити огляд закладу</span>
                  </Link>
                </h2>
                <p className="m-0 mt-3 flex items-baseline gap-2">
                  <span className="text-numeral tabular">{fmtIndex(i.index)}</span>
                  <span className="text-caption text-text-muted">індекс з 100</span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MaturityBadge level={i.level} />
                  <span className="inline-flex items-center gap-1.5 rounded-sm bg-neutral-bg px-2 py-0.5 text-fine text-neutral-text">
                    <span aria-hidden className="font-bold">
                      {t.letter}
                    </span>
                    <span className="sr-only">Достовірність {t.letter}: </span>
                    {t.word}
                  </span>
                </div>
                <p className="m-0 mt-2 flex items-center gap-1 text-body">
                  <Arrow aria-hidden className="size-4" />
                  {change}
                  <span className="text-caption text-text-muted">до попереднього циклу</span>
                </p>
                <p className="m-0 mt-3 flex items-center gap-1 text-caption text-accent">
                  Відкрити огляд <ArrowRight aria-hidden className="size-3.5" />
                </p>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
