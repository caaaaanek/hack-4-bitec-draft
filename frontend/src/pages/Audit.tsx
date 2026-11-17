/** Журнал дій з перевіркою ланцюжка хешів (адміністратор, аудитор). Подань анкет у журналі немає. */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { History, ShieldAlert, ShieldCheck } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Button, Card, Input, LoadingState, Select, Table, type TableColumn } from '@/components/ui'
import { ApiError, type Schemas } from '@/api/client'
import { endpoints } from '@/api/endpoints'

type Row = Schemas['AuditLogOut']

const ENTITY: Record<string, string> = {
  campaign: 'Хвиля',
  questionnaire: 'Анкета',
  user: 'Користувач',
  unit: 'Підрозділ',
  checklist_entry: 'Чек-лист',
  evidence_file: 'Файл-доказ',
  measure: 'Захід',
  recommendation: 'Рекомендація',
  results: 'Результати',
  indicator: 'Факт',
  report: 'Звіт',
}

const fmtAt = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })
}
const detailsText = (d: Record<string, unknown>) =>
  Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')

export function Audit() {
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const log = useQuery({
    queryKey: ['audit', entity, action],
    queryFn: () =>
      endpoints.auditLog({ entity: entity || undefined, action: action || undefined, limit: 200 }),
  })
  const verify = useMutation({ mutationFn: endpoints.verifyAudit })

  const columns: TableColumn<Row>[] = [
    {
      key: 'seq',
      header: '№',
      numeric: true,
      sortable: true,
      render: (r) => <span className="tabular">{r.seq}</span>,
    },
    {
      key: 'at',
      header: 'Коли',
      sortable: true,
      render: (r) => <span className="tabular">{fmtAt(r.at)}</span>,
    },
    { key: 'action', header: 'Дія', render: (r) => <code>{r.action}</code> },
    { key: 'entity', header: "Об'єкт", render: (r) => ENTITY[r.entity] ?? r.entity },
    {
      key: 'details',
      header: 'Подробиці',
      render: (r) => (
        <span className="line-clamp-2 text-caption text-text-muted">
          {detailsText(r.details as Record<string, unknown>)}
        </span>
      ),
    },
    {
      key: 'hash',
      header: 'Хеш',
      render: (r) => <code className="text-caption text-text-muted">{r.hash.slice(0, 10)}…</code>,
    },
  ]

  const v = verify.data
  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Журнал</PageTitle>
      <Card as="section" aria-labelledby="verify-h" className="flex flex-col gap-3">
        <h2 id="verify-h" className="card-title">
          <ShieldCheck aria-hidden />
          Цілісність журналу
        </h2>
        <p className="m-0 text-body text-text-muted">
          Кожен запис містить хеш попереднього. Якщо запис змінили або видалили, перевірка покаже
          перший зламаний номер.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={verify.isPending} onClick={() => verify.mutate()}>
            Перевірити ланцюжок
          </Button>
          {v &&
            (v.ok ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-body text-strength-text"
              >
                <ShieldCheck aria-hidden className="size-4" />
                Ланцюжок цілий: перевірено записів {v.checked}
              </span>
            ) : (
              <span
                role="alert"
                className="inline-flex items-center gap-1.5 text-body text-critical-text"
              >
                <ShieldAlert aria-hidden className="size-4" />
                Порушено на записі № {v.broken_seq}: {v.reason}
              </span>
            ))}
          {verify.error && (
            <span className="text-critical-text">
              {verify.error instanceof ApiError ? verify.error.message : 'Помилка'}
            </span>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          Об'єкт
          <Select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            wrapperClassName="w-48"
          >
            <option value="">Усі</option>
            {Object.entries(ENTITY).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          Дія
          <Input
            value={action}
            placeholder="наприклад, close"
            onChange={(e) => setAction(e.target.value.trim())}
          />
        </label>
      </div>

      {log.isPending ? (
        <LoadingState>Завантажуємо журнал</LoadingState>
      ) : (
        <Table
          columns={columns}
          rows={log.data ?? []}
          rowKey={(r) => r.id}
          caption="Останні 200 записів журналу дій"
          captionVisible
          defaultSort={{ key: 'seq', dir: 'desc' }}
        />
      )}
      <p className="m-0 flex items-center gap-2 text-caption text-text-muted">
        <History aria-hidden className="size-4" />
        Подання анкет у журнал не пишуться: запис «хто і коли» дозволив би зіставити людину з
        відповіддю.
      </p>
    </div>
  )
}
