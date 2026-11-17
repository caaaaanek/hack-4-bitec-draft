import { Printer } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { BigNumber, Button, Card, MATURITY, MaturityBadge } from '@/components/ui'
import { FLAG_WEIGHT_LABEL, TRUST_GRADE_TEXT } from '@/components/ui/messages'
import { COMPONENT_LABELS, fmt, fmtIndex, levelOf, pointsText } from '@/lib/scoring/methodology'
import { CYCLE, CYCLE_DATE } from '@/demo/data'
import { useInstitution } from '@/demo/useInstitution'

/** Звіт: екранний вигляд аркуша з підсумками циклу, друк кнопкою (друкарський шаблон світлий). */
export function Report() {
  const inst = useInstitution()
  const t = TRUST_GRADE_TEXT[inst.trust.grade]
  const prev = inst.series[inst.series.length - 2]!
  return (
    <div data-ready="true" className="flex flex-col gap-4">
      <PageTitle>Звіт</PageTitle>
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-body text-text-muted">
          Підсумок циклу {CYCLE} для друку або збереження у PDF через діалог друку.
        </p>
        <Button
          leftIcon={<Printer aria-hidden className="size-4" />}
          onClick={() => window.print()}
        >
          Друкувати
        </Button>
      </div>

      <Card as="article" aria-labelledby="rep-h" className="mx-auto w-full max-w-3xl p-5 md:p-10">
        <p className="m-0 text-caption text-text-muted">Звіт за результатами оцінювання</p>
        <h2 id="rep-h" className="m-0 mt-1 text-section">
          {inst.name} · цикл {CYCLE}
        </h2>
        <p className="m-0 mt-1 text-caption text-text-muted">
          Дані станом на {CYCLE_DATE}. Усі дані синтетичні.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-2">
          <BigNumber value={fmtIndex(inst.index)} size="display" />
          <div className="flex flex-col gap-1.5 pb-1">
            <MaturityBadge level={inst.level} className="self-start" />
            <span className="text-body">
              {inst.delta >= 0 ? 'Зросло' : 'Знизилось'} на {pointsText(inst.delta)} до циклу{' '}
              {prev.cycle}
            </span>
          </div>
        </div>
        <p className="m-0 mt-2 text-body">
          Достовірність {t.letter}: {t.word.toLowerCase()}. {inst.summaryReason}.
        </p>

        <h3 className="m-0 mt-6 text-card">Компоненти індексу</h3>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full border-collapse text-body">
            <caption className="sr-only">
              Сприйняття, факти й зараховане значення компонентів
            </caption>
            <thead>
              <tr className="bg-surface-muted text-left text-fine text-text-muted">
                <th scope="col" className="rounded-l-[10px] p-2.5 font-medium">
                  Компонент
                </th>
                <th scope="col" className="p-2.5 text-right font-medium">
                  Сприйняття
                </th>
                <th scope="col" className="p-2.5 text-right font-medium">
                  Факти
                </th>
                <th scope="col" className="p-2.5 text-right font-medium">
                  Зараховано
                </th>
                <th scope="col" className="rounded-r-[10px] p-2.5 font-medium">
                  Рівень
                </th>
              </tr>
            </thead>
            <tbody>
              {inst.components.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="p-2.5 text-left font-normal">
                    {COMPONENT_LABELS[c.id]}
                  </th>
                  <td className="tabular p-2.5 text-right">{fmt(c.perception)}</td>
                  <td className="tabular p-2.5 text-right">{fmt(c.facts)}</td>
                  <td className="tabular p-2.5 text-right font-semibold">
                    {fmt(c.credited.value)}
                    {c.credited.limited && ' (з обмеженням)'}
                  </td>
                  <td className="p-2.5">
                    {levelOf(c.credited.value)} {MATURITY[levelOf(c.credited.value)].name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="rep-attn">
            <h3 id="rep-attn" className="m-0 text-card">
              Що потребує уваги
            </h3>
            <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
              {inst.attention.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 py-2 text-body">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-attention-solid" />
                  <span>
                    {a.title}
                    {a.component && (
                      <span className="text-text-muted">, {COMPONENT_LABELS[a.component]}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="rep-str">
            <h3 id="rep-str" className="m-0 text-card">
              Сильні сторони
            </h3>
            <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
              {inst.strengths.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 py-2 text-body">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-strength-solid" />
                  {a.title}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {inst.trust.raised.length > 0 && (
          <section aria-labelledby="rep-flags" className="mt-6">
            <h3 id="rep-flags" className="m-0 text-card">
              Варто перевірити додатково
            </h3>
            <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
              {inst.trust.raised.map((f) => (
                <li key={f.id} className="py-2 text-body">
                  {f.title}{' '}
                  <span className="text-caption text-text-muted">
                    ({FLAG_WEIGHT_LABEL[f.weight].toLowerCase()})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Card>
    </div>
  )
}
