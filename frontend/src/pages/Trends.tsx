import { PageTitle } from '@/components/layout/PageTitle'
import { useState } from 'react'
import { ArrowDown, ArrowUp, GitCompareArrows, Minus, TextQuote } from 'lucide-react'
import { Card, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fmt, fmtIndex, pointsText } from '@/lib/scoring/methodology'
import { DIRECTION_WORD, compareCycles, type CompareRow } from '@/lib/trends'
import { DynamicsPanel } from '@/components/dashboard/DynamicsChart'
import { useInstitution } from '@/demo/useInstitution'

const ICON = { up: ArrowUp, down: ArrowDown, same: Minus } as const
const TONE = {
  up: 'bg-strength-bg text-strength-text',
  down: 'bg-attention-bg text-attention-text',
  same: 'bg-neutral-bg text-neutral-text',
} as const

function DeltaCell({ row }: { row: CompareRow }) {
  const Icon = ICON[row.direction]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-fine font-semibold whitespace-nowrap',
        TONE[row.direction],
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {row.direction === 'same'
        ? DIRECTION_WORD.same
        : `${DIRECTION_WORD[row.direction]} на ${pointsText(row.delta)}`}
    </span>
  )
}

export function Trends() {
  const inst = useInstitution()
  const { series, events } = inst
  const cycles = series.map((p) => p.cycle)
  const [a, setA] = useState(cycles[0]!)
  const [b, setB] = useState(cycles[cycles.length - 1]!)
  const pa = series.find((p) => p.cycle === a)!
  const pb = series.find((p) => p.cycle === b)!
  const rows = compareCycles(pa, pb)

  const whole = compareCycles(series[0]!, series[series.length - 1]!).filter(
    (r) => r.id !== 'index',
  )
  const up = whole.filter((r) => r.direction === 'up')
  const down = whole.filter((r) => r.direction === 'down')

  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <div>
        <PageTitle>Динаміка</PageTitle>
        <p className="m-0 text-body text-text-muted">
          Як змінювався індекс доброчесності від циклу до циклу. Показано лише цей заклад, без
          порівняння із іншими.
        </p>
      </div>

      <DynamicsPanel series={series} events={events} chartClassName="h-[300px] xl:h-[380px]" />

      <div className="grid gap-5 xl:grid-cols-12">
        <Card as="section" aria-labelledby="cmp-h" className="p-4 md:p-4 xl:col-span-8">
          <h2 id="cmp-h" className="card-title">
            <GitCompareArrows aria-hidden />
            Порівняти два цикли
          </h2>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-caption text-text-muted">
              Було (цикл)
              <Select value={a} onChange={(e) => setA(e.target.value)} wrapperClassName="w-40">
                {cycles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-caption text-text-muted">
              Стало (цикл)
              <Select value={b} onChange={(e) => setB(e.target.value)} wrapperClassName="w-40">
                {cycles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {a === b ? (
            <p className="m-0 mt-3 text-body text-text-muted">
              Оберіть два різні цикли, щоб побачити, що змінилося.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-body">
                <caption className="sr-only">
                  Порівняння циклів {a} і {b}
                </caption>
                <thead className="bg-surface-muted text-caption">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      Показник
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Було
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Стало
                    </th>
                    <th scope="col" className="px-3 py-2 text-left">
                      Зміна
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {r.label}
                      </th>
                      <td className="tabular px-3 py-2 text-right">
                        {r.id === 'index' ? fmtIndex(r.before) : fmt(r.before)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {r.id === 'index' ? fmtIndex(r.after) : fmt(r.after)}
                      </td>
                      <td className="px-3 py-2">
                        <DeltaCell row={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 mt-2 text-caption text-text-muted">
            Було: значення в першому циклі. Стало: у другому. Зміна показана в пунктах шкали 0-100.
          </p>
        </Card>

        <Card as="section" aria-labelledby="sum-h" className="p-4 md:p-4 xl:col-span-4">
          <h2 id="sum-h" className="card-title">
            <TextQuote aria-hidden />
            Висновок за весь період
          </h2>
          <p className="m-0 mt-2 text-body">
            {up.length > 0
              ? `Позитивна динаміка: ${up.map((r) => `${r.label} (${pointsText(r.delta)})`).join(', ')}.`
              : 'Позитивної динаміки за період немає.'}
          </p>
          <p className="m-0 mt-2 text-body">
            {down.length > 0
              ? `Потребує уваги: ${down.map((r) => `${r.label} (${pointsText(r.delta)})`).join(', ')}.`
              : 'Негативної динаміки за компонентами немає.'}
          </p>
        </Card>
      </div>
    </div>
  )
}
