import { useMemo, useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  Card,
  MATURITY,
  SegmentedControl,
  buttonBase,
  buttonSizes,
  buttonVariants,
} from '@/components/ui'
import { FLAG_WEIGHT_LABEL, TRUST_GRADE_TEXT } from '@/components/ui/messages'
import { cn } from '@/lib/cn'
import { buildCompareRows } from '@/lib/compare'
import { COMPONENT_LABELS, fmt, fmtIndex } from '@/lib/scoring/methodology'
import { useInstitution } from '@/demo/useInstitution'
import { DataTable } from '@/components/dashboard/ChartFrame'
import { DonutRing } from '@/components/dashboard/DonutRing'
import { DotPlot } from '@/components/dashboard/DotPlot'
import { Gauge } from '@/components/dashboard/Gauge'
import {
  ProfileRadar,
  RadarLegendList,
  type RadarRow,
  type RadarSeries,
} from '@/components/dashboard/ProfileRadar'

type Mode = 'sources' | 'cycles'

const SOURCES_SERIES: RadarSeries[] = [
  { key: 'perception', label: 'Сприйняття', color: 'var(--color-source-wg)', shape: 'circle' },
  { key: 'facts', label: 'Факти', color: 'var(--color-text)', dash: '5 4', shape: 'square' },
  { key: 'credited', label: 'Зараховано', color: 'var(--color-data)', shape: 'diamond' },
]

function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={asTable}
      onClick={onToggle}
      className={cn(buttonBase, buttonVariants.ghost, buttonSizes.sm, 'shrink-0 !px-2')}
    >
      {asTable ? (
        <BarChart3 aria-hidden className="size-4" />
      ) : (
        <Table2 aria-hidden className="size-4" />
      )}
      <span>{asTable ? 'Показати як діаграму' : 'Показати як таблицю'}</span>
    </button>
  )
}

/** Порівняння: профіль компонентів, сприйняття проти фактів, об'єктивні показники, достовірність і індекс на шкалі. */
export function Compare() {
  const inst = useInstitution()
  const [mode, setMode] = useState<Mode>('sources')
  const [profileTable, setProfileTable] = useState(false)
  const [gapTable, setGapTable] = useState(false)

  const rows = useMemo(() => buildCompareRows(inst.perceptionItems, inst.components), [inst])
  const prev = inst.series[inst.series.length - 2]!
  const cur = inst.series[inst.series.length - 1]!
  const trust = TRUST_GRADE_TEXT[inst.trust.grade]

  const data: RadarRow[] = rows.map((r) => ({
    name: COMPONENT_LABELS[r.component],
    perception: r.perception,
    facts: r.facts,
    credited: r.credited,
    previous: prev.components[r.component],
    current: r.credited,
  }))
  const series: RadarSeries[] =
    mode === 'sources'
      ? SOURCES_SERIES
      : [
          {
            key: 'previous',
            label: `Цикл ${prev.cycle}`,
            color: 'var(--color-neutral-solid)',
            dash: '6 4',
            shape: 'square',
          },
          {
            key: 'current',
            label: `Цикл ${cur.cycle}`,
            color: 'var(--color-data)',
            shape: 'circle',
          },
        ]
  const percents = inst.factItems.filter((i) => i.count)

  return (
    <div data-ready="true" className="grid gap-5 xl:grid-cols-12">
      <PageTitle>Порівняння</PageTitle>

      <Card as="section" aria-labelledby="prof-h" className="flex flex-col gap-3 xl:col-span-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="prof-h" className="card-title">
            Профіль
          </h2>
          <TableToggle asTable={profileTable} onToggle={() => setProfileTable((v) => !v)} />
        </div>
        <SegmentedControl<Mode>
          label="Що порівнювати"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sources', label: 'Сприйняття й факти' },
            { value: 'cycles', label: 'Цикли' },
          ]}
        />
        {profileTable ? (
          <DataTable
            caption="Значення компонентів для профілю"
            head={['Компонент', ...series.map((s) => s.label)]}
            rows={data.map((d) => [String(d.name), ...series.map((s) => fmt(Number(d[s.key])))])}
          />
        ) : (
          <>
            <div className="relative min-h-[320px] flex-1">
              <div className="absolute inset-0">
                <ProfileRadar data={data} series={series} />
              </div>
            </div>
            <RadarLegendList series={series} />
          </>
        )}
        <p className="sr-only">
          {data
            .map(
              (d) =>
                `${d.name}: ${series.map((s) => `${s.label} ${fmt(Number(d[s.key]))}`).join(', ')}`,
            )
            .join('. ')}
          .
        </p>
      </Card>

      <Card as="section" aria-labelledby="gap-h" className="flex flex-col gap-3 xl:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gap-h" className="card-title">
            Сприйняття vs факти
          </h2>
          <TableToggle asTable={gapTable} onToggle={() => setGapTable((v) => !v)} />
        </div>
        {gapTable ? (
          <DataTable
            caption="Сприйняття за джерелами, факти й розрив"
            head={['Компонент', 'РГ', 'ОС', 'Експерти', 'Факти', 'Розрив']}
            rows={rows.map((r) => [
              COMPONENT_LABELS[r.component],
              fmt(r.bySource.wg),
              fmt(r.bySource.os),
              fmt(r.bySource.experts),
              fmt(r.facts),
              fmt(r.gap),
            ])}
          />
        ) : (
          <DotPlot rows={rows} />
        )}
      </Card>

      <Card as="section" aria-labelledby="scale-h" className="flex flex-col gap-2 xl:col-span-4">
        <h2 id="scale-h" className="card-title">
          Індекс на шкалі рівнів
        </h2>
        <p className="m-0 text-caption text-text-muted">
          Індекс {fmtIndex(inst.index)} з 100, рівень {inst.level} «{MATURITY[inst.level].name}».
        </p>
        <Gauge value={inst.index} level={inst.level} />
      </Card>

      <Card as="section" aria-labelledby="obj-h" className="xl:col-span-5">
        <h2 id="obj-h" className="card-title">
          Об’єктивні показники
        </h2>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2">
          {percents.map((i) => (
            <li key={i.id} className="rounded-[14px] bg-surface-muted p-3">
              <div className="flex items-center gap-3">
                <DonutRing value={i.value} />
                <span className="text-numeral tabular text-text">
                  {fmt(i.value)}
                  <span className="text-text-muted">%</span>
                </span>
              </div>
              <p className="m-0 mt-2 text-caption text-text-muted">{i.label}</p>
              {i.count && (
                <p className="m-0 text-fine text-text-muted">
                  {i.count.numerator} з {i.count.denominator}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="trust-h" className="xl:col-span-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="trust-h" className="card-title">
            Достовірність
          </h2>
          <span
            className="rounded-full bg-critical-bg px-2.5 py-1 text-fine font-semibold text-critical-text data-[grade=A]:bg-strength-bg data-[grade=A]:text-strength-text"
            data-grade={inst.trust.grade}
          >
            {trust.letter}
          </span>
        </div>
        <p className="m-0 mt-1 text-caption text-text-muted">
          {trust.word}. {trust.rule}
        </p>
        {inst.trust.raised.length === 0 ? (
          <p className="m-0 mt-3 text-body">Жоден прапорець не спрацював.</p>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
            {inst.trust.raised.map((f) => (
              <li key={f.id} className="flex items-start gap-2.5 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    f.weight === 'major' ? 'bg-critical-solid' : 'bg-attention-solid',
                  )}
                />
                <div>
                  <p className="m-0 text-body">{f.title}</p>
                  <p className="m-0 text-fine text-text-muted">
                    {FLAG_WEIGHT_LABEL[f.weight]} прапорець
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
