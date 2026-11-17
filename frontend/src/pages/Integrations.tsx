import { PageTitle } from '@/components/layout/PageTitle'
import { Link2, Workflow } from 'lucide-react'
import { Badge, Card, Table, type BadgeTone, type TableColumn } from '@/components/ui'
import {
  DATA_SOURCES,
  INTEGRATIONS,
  SOURCE_MODE_LABEL,
  type DataSource,
  type SourceMode,
} from '@/demo/dataSources'

const TONE: Record<SourceMode, BadgeTone> = {
  auto: 'strength',
  manual: 'neutral',
  planned: 'neutral',
  approval: 'attention',
}

const ModeBadge = ({ mode }: { mode: SourceMode }) => (
  <Badge tone={TONE[mode]}>{SOURCE_MODE_LABEL[mode]}</Badge>
)

const columns: TableColumn<DataSource>[] = [
  { key: 'metric', header: 'Метрика', sortable: true },
  { key: 'source', header: 'Джерело' },
  { key: 'modeLabel', header: 'Режим', render: (r) => <ModeBadge mode={r.mode} /> },
  { key: 'age', header: 'Вік даних' },
  { key: 'explanation', header: 'Пояснення' },
]

export function Integrations() {
  const rows = DATA_SOURCES.map((s) => ({ ...s, modeLabel: SOURCE_MODE_LABEL[s.mode] }))
  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <div>
        <PageTitle>Звідки беруться дані</PageTitle>
        <p className="m-0 text-body text-text-muted">
          Чесні статуси: що працює вже, що вносять вручну, а що лише планується.
        </p>
      </div>
      <section aria-labelledby="src-h" className="flex flex-col gap-2">
        <h2 id="src-h" className="card-title">
          <Link2 aria-hidden />
          Джерела даних за метриками
        </h2>
        <Table<DataSource & { modeLabel: string }>
          caption="Джерела даних за метриками"
          columns={columns as TableColumn<DataSource & { modeLabel: string }>[]}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </section>
      <section aria-labelledby="map-h" className="flex flex-col gap-2">
        <h2 id="map-h" className="card-title">
          <Workflow aria-hidden />
          Карта інтеграцій
        </h2>
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {INTEGRATIONS.map((i) => (
            <li key={i.id} className="min-w-0">
              <Card className="flex h-full flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="m-0 text-card">{i.system}</h3>
                  <ModeBadge mode={i.mode} />
                </div>
                <p className="m-0 text-body">
                  <span className="text-caption font-semibold text-text-muted">Навіщо: </span>
                  {i.purpose}
                </p>
                <p className="m-0 text-body">
                  <span className="text-caption font-semibold text-text-muted">Метод: </span>
                  {i.method}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
