/**
 * Контрольний чек-лист хвилі: робоча група вносить статус і докази (текст і файли), укладач анкет
 * підтверджує за доказами, аудитор лише переглядає. Будь-яка зміна знімає підтвердження.
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Download,
  FileText,
  Paperclip,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { COMPONENT_LABELS } from '@/lib/scoring/methodology'
import { API_BASE, ApiError, type Schemas } from '@/api/client'
import { downloadWithAuth, endpoints } from '@/api/endpoints'
import { isComponentId } from '@/api/adapters'
import { useSession } from '@/api/session'

type Item = Schemas['ChecklistItemOut']
type Status = 'full' | 'partial' | 'none'

const STATUS_LABEL: Record<Status, string> = {
  full: 'Впроваджено повністю',
  partial: 'Частково',
  none: 'Не впроваджено',
}
const STATUS_TONE: Record<Status, 'strength' | 'attention' | 'critical'> = {
  full: 'strength',
  partial: 'attention',
  none: 'critical',
}

const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.message}. ${e.hint}` : 'Не вдалося зберегти.'
const kb = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`

function ItemRow({
  item,
  campaignId,
  canEdit,
  canConfirm,
  onChanged,
}: {
  item: Item
  campaignId: string
  canEdit: boolean
  canConfirm: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [status, setStatus] = useState<Status | ''>((item.status as Status | null) ?? '')
  const [evidence, setEvidence] = useState(item.evidence)
  const [comment, setComment] = useState(item.comment)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty =
    status !== (item.status ?? '') || evidence !== item.evidence || comment !== item.comment
  const done = (title: string) => {
    toast.push({ title, tone: 'success' })
    onChanged()
  }
  const fail = (e: unknown) => toast.push({ title: errText(e), tone: 'error' })

  const save = useMutation({
    mutationFn: () =>
      endpoints.setEntry(campaignId, item.question_id, {
        status: status as Status,
        evidence,
        comment,
      }),
    onSuccess: () => done(`Пункт ${item.number} збережено`),
    onError: fail,
  })
  const confirm = useMutation({
    mutationFn: () =>
      item.confirmed
        ? endpoints.unconfirm(campaignId, item.question_id)
        : endpoints.confirm(campaignId, item.question_id),
    onSuccess: () =>
      done(
        item.confirmed
          ? `Підтвердження пункту ${item.number} відкликано`
          : `Пункт ${item.number} підтверджено`,
      ),
    onError: fail,
  })
  const upload = useMutation({
    mutationFn: (f: File) => endpoints.uploadFile(campaignId, item.question_id, f),
    onSuccess: (f) => done(`Файл «${f.filename}» додано, sha256 ${f.sha256.slice(0, 12)}…`),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (fileId: string) => endpoints.deleteFile(campaignId, item.question_id, fileId),
    onSuccess: () => done('Файл прибрано з пункту (лишається в журналі)'),
    onError: fail,
  })

  const st = item.status as Status | null
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="m-0 max-w-(--prose-max) text-body">
          <span className="font-semibold">{item.number}.</span>{' '}
          {item.text.replace(/^\d+(\.\d+)*\.\s*/, '')}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {st ? (
            <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
          ) : (
            <Badge tone="neutral">Не внесено</Badge>
          )}
          {item.confirmed ? (
            <Badge tone="strength">
              <ShieldCheck aria-hidden className="size-3.5" /> Підтверджено
            </Badge>
          ) : (
            st && <Badge tone="neutral">Не підтверджено</Badge>
          )}
        </div>
      </div>
      {item.indicator && (
        <p className="m-0 text-caption text-text-muted">Індикатор: {item.indicator}</p>
      )}

      {canEdit ? (
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <label className="flex flex-col gap-1 text-caption text-text-muted">
            Статус
            <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="" disabled>
                Оберіть
              </option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-caption text-text-muted">
            Доказ (документ, наказ, посилання)
            <Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <span />
          <label className="flex flex-col gap-1 text-caption text-text-muted">
            Коментар
            <Textarea rows={1} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>
      ) : (
        (item.evidence || item.comment) && (
          <div className="text-body">
            {item.evidence && (
              <p className="m-0">
                <span className="text-text-muted">Доказ:</span> {item.evidence}
              </p>
            )}
            {item.comment && (
              <p className="m-0">
                <span className="text-text-muted">Коментар:</span> {item.comment}
              </p>
            )}
          </div>
        )
      )}

      {item.files.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {item.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-body">
              <FileText aria-hidden className="size-4 text-text-muted" />
              <button
                type="button"
                className="text-accent underline underline-offset-2"
                onClick={() =>
                  downloadWithAuth(
                    `${API_BASE}/campaigns/${campaignId}/checklist/${item.question_id}/files/${f.id}`,
                    f.filename,
                  ).catch(fail)
                }
              >
                {f.filename}
              </button>
              <span className="text-caption text-text-muted">
                {kb(f.size)} · sha256 <code>{f.sha256.slice(0, 12)}…</code>
              </span>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Прибрати файл ${f.filename}`}
                  className="text-text-muted hover:text-critical-text"
                  onClick={() => remove.mutate(f.id)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <>
            <Button
              size="sm"
              disabled={!dirty || !status}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Зберегти
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              aria-label={`Додати файл-доказ до пункту ${item.number}`}
              accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.odt,.ods,.txt,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f)
                e.target.value = ''
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={upload.isPending}
              leftIcon={<Upload aria-hidden className="size-4" />}
              onClick={() => fileRef.current?.click()}
            >
              Додати файл
            </Button>
          </>
        )}
        {canConfirm && st && (
          <Button
            size="sm"
            variant={item.confirmed ? 'secondary' : 'primary'}
            loading={confirm.isPending}
            leftIcon={<CheckCircle2 aria-hidden className="size-4" />}
            onClick={() => confirm.mutate()}
          >
            {item.confirmed ? 'Відкликати підтвердження' : 'Підтвердити за доказами'}
          </Button>
        )}
      </div>
    </li>
  )
}

export function Checklist() {
  const { role, user } = useSession()
  const qc = useQueryClient()
  const isWg = role === 'checklist_editor'
  const campaigns = useQuery({
    queryKey: ['checklist-campaigns', isWg],
    queryFn: async () => {
      if (isWg) {
        const a = await endpoints.assignments()
        return a
          .filter((x) => x.kind === 'checklist')
          .map((x) => ({ id: x.campaign_id, title: x.campaign_title, status: 'open' }))
      }
      const list = await endpoints.campaigns()
      return list
        .filter((c) => c.status !== 'draft')
        .map((c) => ({ id: c.id, title: c.title, status: c.status }))
    },
  })
  const [picked, setPicked] = useState<string>('')
  const campaignId =
    picked || campaigns.data?.find((c) => c.status === 'open')?.id || campaigns.data?.[0]?.id || ''
  const current = campaigns.data?.find((c) => c.id === campaignId)
  const checklist = useQuery({
    queryKey: ['checklist', campaignId],
    queryFn: () => endpoints.checklist(campaignId),
    enabled: Boolean(campaignId),
    retry: false,
  })
  const canEdit = isWg && current?.status === 'open'
  const canConfirm = user?.role === 'commissioner' && current?.status === 'open'

  const groups = useMemo(() => {
    const out = new Map<string, Item[]>()
    for (const it of checklist.data?.items ?? []) {
      const key = isComponentId(it.component) ? COMPONENT_LABELS[it.component] : 'Інше'
      out.set(key, [...(out.get(key) ?? []), it])
    }
    return [...out.entries()]
  }, [checklist.data])

  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Чек-лист</PageTitle>
      <p className="m-0 max-w-(--prose-max) text-body text-text-muted">
        {isWg
          ? 'Ви вносите статус пунктів і докази. Підтверджує їх інша людина (укладач анкет). Будь-яка зміна знімає підтвердження.'
          : canConfirm
            ? 'Ви підтверджуєте пункти за доказами робочої групи. Без доказу (тексту чи файлу) пункт підтвердити не можна.'
            : 'Перегляд стану чек-листа: що внесено, які докази, що підтверджено.'}
      </p>

      {campaigns.isPending ? (
        <LoadingState>Завантажуємо хвилі</LoadingState>
      ) : !campaigns.data?.length ? (
        <EmptyState
          icon={<Paperclip className="size-8" />}
          title="Немає хвилі з чек-листом"
          description={
            isWg
              ? 'Чек-лист зʼявиться, коли адміністратор відкриє хвилю з ним.'
              : 'Хвиль ще не відкривали.'
          }
        />
      ) : (
        <>
          {campaigns.data.length > 1 && (
            <label className="flex max-w-md flex-col gap-1 text-caption text-text-muted">
              Хвиля
              <Select value={campaignId} onChange={(e) => setPicked(e.target.value)}>
                {campaigns.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.status === 'open' ? 'відкрита' : 'закрита'})
                  </option>
                ))}
              </Select>
            </label>
          )}
          {checklist.isPending ? (
            <LoadingState>Завантажуємо пункти</LoadingState>
          ) : checklist.isError ? (
            <ErrorState
              title="Чек-лист недоступний"
              description={
                checklist.error instanceof ApiError
                  ? checklist.error.message
                  : 'Сервер не відповів.'
              }
              whatToDo="Оберіть іншу хвилю або оновіть сторінку."
            />
          ) : (
            <>
              <ul aria-label="Підсумок" className="m-0 grid list-none grid-cols-3 gap-5 p-0">
                {[
                  ['Пунктів', checklist.data.total],
                  ['Внесено', checklist.data.filled],
                  ['Підтверджено', checklist.data.confirmed],
                ].map(([label, value]) => (
                  <li key={label}>
                    <Card className="flex flex-col gap-1">
                      <span className="text-caption text-text-muted">{label}</span>
                      <span className="text-numeral tabular">{value}</span>
                    </Card>
                  </li>
                ))}
              </ul>
              {groups.map(([title, items]) => (
                <Card as="section" key={title} aria-label={title} className="flex flex-col gap-3">
                  <h2 className="card-title">{title}</h2>
                  <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                    {items.map((it) => (
                      <ItemRow
                        key={`${it.question_id}-${it.entered_at ?? ''}-${it.confirmed}-${it.files.length}`}
                        item={it}
                        campaignId={campaignId}
                        canEdit={canEdit}
                        canConfirm={canConfirm}
                        onChanged={() =>
                          void qc.invalidateQueries({ queryKey: ['checklist', campaignId] })
                        }
                      />
                    ))}
                  </ul>
                </Card>
              ))}
              <p className="m-0 flex items-center gap-2 text-caption text-text-muted">
                <Download aria-hidden className="size-4" />
                Файли завантажуються зі звіркою sha256: якщо вміст на сервері змінили, система це
                покаже.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
