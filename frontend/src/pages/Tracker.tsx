import { PageTitle } from '@/components/layout/PageTitle'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, Columns3, ListChecks, ShieldCheck, Table2 } from 'lucide-react'
import {
  Badge,
  Card,
  EmptyState,
  Select,
  SegmentedControl,
  StatusBadge,
  Table,
  useToast,
  STATUSES,
  type StatusId,
  type TableColumn,
} from '@/components/ui'
import {
  MEASURE_TRANSITIONS,
  daysOverdue,
  effectiveStatus,
  overdueText,
  type Measure,
  type MeasureStatus,
} from '@/lib/measures'
import { cn } from '@/lib/cn'
import { allMeasures, setMeasureStatus } from '@/lib/decisions'
import { DEMO_MEASURES, PAST_RECOMMENDATIONS, TODAY } from '@/demo/measures'
import { getDecisions, setDecisions, useDecisions } from '@/demo/decisionsStore'
import { useDemoOptional } from '@/demo/demoContext'

type View = 'table' | 'board'

const BOARD_COLUMNS: MeasureStatus[] = [
  'accepted',
  'inprogress',
  'done',
  'confirmed',
  'notconfirmed',
]

/** «2026-11-05» у «05.11.2026». */
const fmtDate = (iso: string) => iso.split('-').reverse().join('.')

interface Row {
  id: string
  code: string
  title: string
  position: string
  dueDate: string
  statusLabel: string
  measure: Measure
  effective: StatusId
  overdue: number
}

function StatusCell({ row }: { row: Row }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {row.overdue > 0 ? (
        <span
          data-status="overdue"
          className="inline-flex items-center gap-1.5 rounded-sm bg-status-overdue-bg px-2 py-0.5 text-fine font-semibold text-status-overdue-text"
        >
          <AlarmClock aria-hidden className="size-4 shrink-0" />
          {overdueText(row.overdue)}
        </span>
      ) : (
        <StatusBadge status={row.effective} />
      )}
      {row.effective === 'overdue' && (
        <span className="text-caption text-text-muted">
          Статус: {STATUSES[row.measure.status].label}
        </span>
      )}
    </div>
  )
}

function StatusControl({
  row,
  onChange,
}: {
  row: Row
  onChange: (id: string, to: MeasureStatus) => void
}) {
  const next = MEASURE_TRANSITIONS[row.measure.status]
  if (next.length === 0)
    return <span className="text-caption text-text-muted">Змінює наступне оцінювання</span>
  return (
    <Select
      aria-label={`Змінити статус заходу «${row.title}»`}
      value={row.measure.status}
      onChange={(e) => onChange(row.id, e.target.value as MeasureStatus)}
      wrapperClassName="w-44"
      className="!h-9 !py-0 text-caption"
    >
      <option value={row.measure.status}>{STATUSES[row.measure.status].label}</option>
      {next.map((s) => (
        <option key={s} value={s}>
          {STATUSES[s].label}
        </option>
      ))}
    </Select>
  )
}

function VerificationCell({ m }: { m: Measure }) {
  if (m.verification)
    return (
      <span className="inline-flex items-start gap-1 text-body">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {m.verification}
      </span>
    )
  if (m.status === 'done')
    return <span className="text-text-muted">Очікує наступного оцінювання</span>
  return <span className="text-text-muted">Ще не настав час</span>
}

export function Tracker() {
  const { role } = useDemoOptional()
  const decisions = useDecisions()
  const toast = useToast()
  const canEdit = role === 'leader'
  const [view, setView] = useState<View>('table')
  const [status, setStatus] = useState<'all' | StatusId>('all')
  const [position, setPosition] = useState('all')

  const measures = useMemo(() => allMeasures(DEMO_MEASURES, decisions), [decisions])
  const rows: Row[] = measures.map((m, i) => ({
    id: m.id,
    code: `Т-${String(i + 1).padStart(2, '0')}`,
    title: m.title,
    position: m.responsiblePosition,
    dueDate: m.dueDate,
    statusLabel: STATUSES[effectiveStatus(m, TODAY)].label,
    measure: m,
    effective: effectiveStatus(m, TODAY),
    overdue: daysOverdue(m, TODAY),
  }))
  const positions = [...new Set(rows.map((r) => r.position))].sort((a, b) =>
    a.localeCompare(b, 'uk'),
  )
  const shown = rows.filter(
    (r) =>
      (status === 'all' || r.effective === status) &&
      (position === 'all' || r.position === position),
  )
  const overdueCount = rows.filter((r) => r.overdue > 0).length
  const confirmed = rows.filter((r) => r.measure.status === 'confirmed').length
  const waiting = rows.filter((r) => r.measure.status === 'done').length
  const notConfirmed = rows.filter((r) => r.measure.status === 'notconfirmed').length

  const change = (id: string, to: MeasureStatus) => {
    const next = setMeasureStatus(getDecisions(), measures, id, to)
    if (next === getDecisions()) return
    setDecisions(next)
    toast.push({
      title: `Статус заходу змінено на «${STATUSES[to].label}».`,
      tone: 'success',
    })
  }

  const STATS: [string, number, string][] = [
    ['Усього', rows.length, 'text-text'],
    [
      'В роботі',
      rows.filter((r) => r.measure.status === 'inprogress').length,
      'text-attention-text',
    ],
    ['Прострочено', overdueCount, 'text-critical-text'],
    [
      'Виконано',
      rows.filter((r) => r.measure.status === 'done' || r.measure.status === 'confirmed').length,
      'text-strength-text',
    ],
  ]

  const columns: TableColumn<Row>[] = [
    {
      key: 'code',
      header: 'ID',
      render: (r) => <span className="tabular text-text-muted">{r.code}</span>,
    },
    {
      key: 'title',
      header: 'Захід',
      sortable: true,
      render: (r) => (
        <div>
          <p className="m-0 font-semibold">{r.title}</p>
          {PAST_RECOMMENDATIONS[r.measure.recommendationId] && (
            <p className="m-0 text-caption text-text-muted">
              З рекомендації: {PAST_RECOMMENDATIONS[r.measure.recommendationId]}
            </p>
          )}
        </div>
      ),
    },
    { key: 'position', header: 'Відповідальна посада', sortable: true },
    {
      key: 'dueDate',
      header: 'Строк',
      sortable: true,
      render: (r) => <span className="tabular">{fmtDate(r.dueDate)}</span>,
    },
    { key: 'statusLabel', header: 'Статус', render: (r) => <StatusCell row={r} /> },
    {
      key: 'verification',
      header: 'Верифікація',
      render: (r) => <VerificationCell m={r.measure} />,
    },
    ...(canEdit
      ? [
          {
            key: 'action',
            header: 'Змінити статус',
            render: (r: Row) => <StatusControl row={r} onChange={change} />,
          } satisfies TableColumn<Row>,
        ]
      : []),
  ]

  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Трекер заходів</PageTitle>
      <ul aria-label="Підсумок" className="m-0 grid list-none grid-cols-2 gap-5 p-0 xl:grid-cols-4">
        {STATS.map(([label, value, cls]) => (
          <li key={label}>
            <Card className="flex flex-col gap-1">
              <span className="text-caption text-text-muted">{label}</span>
              <span className={cn('text-numeral tabular', cls)}>{value}</span>
            </Card>
          </li>
        ))}
      </ul>
      <p className="m-0 text-body text-text-muted">
        {measures.length} заходів
        {overdueCount > 0 ? `, з них ${overdueCount} прострочено` : ', прострочених немає'}.{' '}
        {canEdit
          ? 'Статуси змінює керівник.'
          : 'Режим читання: змінювати статуси може лише керівник.'}
      </p>

      <Card as="section" aria-labelledby="meas-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="meas-h" className="card-title">
            Заходи
          </h2>
          <SegmentedControl
            label="Вигляд"
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: 'Таблиця', icon: <Table2 aria-hidden className="size-4" /> },
              { value: 'board', label: 'Дошка', icon: <Columns3 aria-hidden className="size-4" /> },
            ]}
          />
        </div>

        <div role="group" aria-label="Фільтри" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-caption text-text-muted">
            Статус
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              wrapperClassName="w-48"
            >
              <option value="all">Усі статуси</option>
              {(
                [
                  'accepted',
                  'inprogress',
                  'done',
                  'confirmed',
                  'notconfirmed',
                  'overdue',
                ] as StatusId[]
              ).map((s) => (
                <option key={s} value={s}>
                  {STATUSES[s].label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-caption text-text-muted">
            Відповідальна посада
            <Select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              wrapperClassName="w-72 max-w-full"
            >
              <option value="all">Усі посади</option>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </label>
          <p className="m-0 pb-2 text-caption text-text-muted">
            Показано {shown.length} з {rows.length}
          </p>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-8" />}
            title="За цими фільтрами заходів немає"
            description="Змініть статус або посаду. Нові заходи зʼявляються, коли керівник приймає рекомендацію."
            action={
              <Link to="/recommendations" className="text-accent underline underline-offset-4">
                Перейти до рекомендацій
              </Link>
            }
          />
        ) : view === 'table' ? (
          <Table<Row>
            caption="Заходи, строки й статуси"
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            defaultSort={{ key: 'dueDate', dir: 'asc' }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {BOARD_COLUMNS.map((col) => {
              const items = shown.filter((r) => r.measure.status === col)
              return (
                <section
                  key={col}
                  aria-label={`Колонка «${STATUSES[col].label}»`}
                  className="flex min-w-0 flex-col gap-2"
                >
                  <h2 className="m-0 flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2 py-1.5 text-body font-semibold">
                    {STATUSES[col].label}
                    <Badge tone="neutral">{items.length}</Badge>
                  </h2>
                  {items.length === 0 && (
                    <p className="m-0 px-1 text-caption text-text-muted">Порожньо</p>
                  )}
                  {items.map((r) => (
                    <Card key={r.id} as="article" className="flex flex-col gap-2 p-3 md:p-3">
                      <p className="m-0 text-body font-semibold">{r.title}</p>
                      <p className="m-0 text-caption text-text-muted">{r.position}</p>
                      <p className="m-0 text-caption tabular">Строк: {fmtDate(r.dueDate)}</p>
                      <StatusCell row={r} />
                      {canEdit && <StatusControl row={r} onChange={change} />}
                    </Card>
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </Card>

      <Card as="section" aria-labelledby="verify-h" className="p-4 md:p-4">
        <h2 id="verify-h" className="card-title">
          <ShieldCheck aria-hidden />
          Верифікація наступним оцінюванням
        </h2>
        <p className="m-0 mt-2 max-w-(--prose-max) text-body">
          Статус «Виконано» ще не означає, що захід спрацював. Після наступного циклу оцінювання
          система перевіряє, чи покращились показники, пов’язані із заходом. Результат може бути
          «Підтверджено наступним оцінюванням» або «Не підтверджено, потрібен перегляд».
        </p>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
          <li>
            <Badge tone="strength">Підтверджено: {confirmed}</Badge>
          </li>
          <li>
            <Badge tone="neutral">Очікують наступного оцінювання: {waiting}</Badge>
          </li>
          <li>
            <Badge tone="attention">Потребують перегляду: {notConfirmed}</Badge>
          </li>
        </ul>
      </Card>
    </div>
  )
}
