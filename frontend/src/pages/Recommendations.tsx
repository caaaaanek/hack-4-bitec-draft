import { PageTitle } from '@/components/layout/PageTitle'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleCheck, Lightbulb, MessageSquareText, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  Input,
  PriorityBadge,
  Select,
  StatusBadge,
  Textarea,
  useToast,
  type StatusId,
} from '@/components/ui'
import { COMPONENT_IDS, COMPONENT_LABELS, type ComponentId } from '@/lib/scoring/methodology'
import { cn } from '@/lib/cn'
import {
  PRIORITY_LABEL,
  RECOMMENDATION_STATUS_LABEL,
  buildRecommendations,
  type Recommendation,
  type RecommendationStatus,
} from '@/lib/recommendations'
import { accept, applyDecisions, clarify, reject } from '@/lib/decisions'
import { getDecisions, setDecisions, useDecisions } from '@/demo/decisionsStore'
import { POSITIONS, TODAY } from '@/demo/measures'
import { useInstitution } from '@/demo/useInstitution'

const STATUS_IDS: RecommendationStatus[] = ['proposed', 'accepted', 'clarified', 'rejected']

/** Дата ISO через N днів від дати демо. */
function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

type DialogState = { kind: 'accept' | 'clarify' | 'reject'; rec: Recommendation } | null

function AcceptDialog({
  rec,
  onClose,
  onDone,
}: {
  rec: Recommendation
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [position, setPosition] = useState<string>(POSITIONS[0])
  const [due, setDue] = useState(plusDays(TODAY, 60))
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!due || due < TODAY) {
      setError('Оберіть строк не раніше за сьогодні.')
      return
    }
    setDecisions(accept(getDecisions(), rec, { position, dueDate: due, measureId: `m-${rec.id}` }))
    onDone(`Рекомендацію прийнято. Захід «${rec.title}» додано до трекера.`)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Прийняти рекомендацію"
      description={rec.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Скасувати
          </Button>
          <Button type="submit" form="accept-form">
            Прийняти й створити захід
          </Button>
        </>
      }
    >
      <form id="accept-form" onSubmit={submit} noValidate className="flex flex-col gap-4 pb-4">
        <FormField label="Відповідальна посада" required>
          {({ id }) => (
            <Select id={id} value={position} onChange={(e) => setPosition(e.target.value)}>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Строк виконання" required error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={due}
              min={TODAY}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(e) => {
                setDue(e.target.value)
                setError('')
              }}
            />
          )}
        </FormField>
        <p className="m-0 text-caption text-text-muted">
          Підтвердження: після прийняття в трекері зʼявиться захід із цією посадою й строком. Посаду
          і строк можна буде уточнити пізніше.
        </p>
      </form>
    </Dialog>
  )
}

function TextDialog({
  rec,
  kind,
  onClose,
  onDone,
}: {
  rec: Recommendation
  kind: 'clarify' | 'reject'
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const isReject = kind === 'reject'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) {
      setError(isReject ? 'Вкажіть причину відхилення.' : 'Напишіть, що саме потрібно уточнити.')
      return
    }
    if (isReject) {
      setDecisions(reject(getDecisions(), rec.id, text))
      onDone('Рекомендацію відхилено. Причину збережено.')
    } else {
      setDecisions(clarify(getDecisions(), rec.id, text.trim()))
      onDone('Рекомендацію позначено як «Уточнено». Коментар збережено.')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={isReject ? 'Відхилити рекомендацію' : 'Уточнити рекомендацію'}
      description={rec.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Скасувати
          </Button>
          <Button type="submit" form="text-form">
            {isReject ? 'Відхилити' : 'Надіслати уточнення'}
          </Button>
        </>
      }
    >
      <form id="text-form" onSubmit={submit} noValidate className="pb-4">
        <FormField
          label={isReject ? 'Причина відхилення' : 'Короткий коментар'}
          hint={
            isReject
              ? 'Причина обов’язкова: вона допоможе наступним оцінюванням.'
              : 'Що потрібно уточнити, перш ніж ухвалити рішення.'
          }
          required
          error={error}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={4}
              value={text}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(e) => {
                setText(e.target.value)
                setError('')
              }}
            />
          )}
        </FormField>
      </form>
    </Dialog>
  )
}

const PRIORITY_BOX: Record<string, string> = {
  high: 'bg-critical-bg text-critical-text',
  medium: 'bg-attention-bg text-attention-text',
  low: 'bg-status-accepted-bg text-status-accepted-text',
}

function RecommendationRow({
  rec,
  index,
  note,
  onAction,
}: {
  rec: Recommendation
  index: number
  note?: string
  onAction: (kind: 'accept' | 'clarify' | 'reject') => void
}) {
  const open = rec.status === 'proposed' || rec.status === 'clarified'
  return (
    <article
      aria-labelledby={`rec-${rec.id}`}
      className="rounded-[14px] border border-border p-4 transition-colors hover:bg-surface-muted/40"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span
          title={`Пріоритет: ${PRIORITY_LABEL[rec.priority].toLowerCase()}`}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-[10px] text-body font-bold tabular',
            PRIORITY_BOX[rec.priority],
          )}
        >
          <span className="sr-only">Номер за пріоритетом: </span>
          {index}
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h3 id={`rec-${rec.id}`} className="m-0 text-card">
            {rec.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={rec.priority} />
            <Badge tone="neutral">{COMPONENT_LABELS[rec.component]}</Badge>
            <StatusBadge status={rec.status as StatusId} />
            <Badge tone="neutral">На підставі: {rec.evidence.length}</Badge>
          </div>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              leftIcon={<X aria-hidden className="size-4" />}
              onClick={() => onAction('reject')}
            >
              Відхилити
            </Button>
            {rec.status === 'proposed' && (
              <Button
                variant="secondary"
                leftIcon={<MessageSquareText aria-hidden className="size-4" />}
                onClick={() => onAction('clarify')}
              >
                Уточнити
              </Button>
            )}
            <Button
              leftIcon={<CircleCheck aria-hidden className="size-4" />}
              onClick={() => onAction('accept')}
            >
              Прийняти
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-3">
          <section aria-label="Чому система це пропонує">
            <h4 className="m-0 text-caption font-medium text-text-muted">
              Чому система це пропонує
            </h4>
            <p className="m-0 mt-0.5 text-body">{rec.why}</p>
          </section>
          <section aria-label="На підставі">
            <h4 className="m-0 text-caption font-medium text-text-muted">На підставі</h4>
            <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
              {rec.evidence.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-2 rounded-[10px] bg-surface-muted px-2.5 py-1.5 text-caption"
                >
                  <span>
                    {e.label}: <strong className="tabular text-text">{e.valueText}</strong>
                  </span>
                  <Link
                    to={e.href}
                    className="inline-flex items-center gap-1 text-accent underline underline-offset-2"
                  >
                    Відкрити в розкладі
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section aria-label="Дії">
          <h4 className="m-0 text-caption font-medium text-text-muted">Запропоновані дії</h4>
          <ol className="m-0 mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-body">
            {rec.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </section>
      </div>
      {note && (
        <p className="m-0 mt-3 rounded-[10px] bg-neutral-bg p-2.5 text-body text-neutral-text">
          {note}
        </p>
      )}
      {rec.status === 'accepted' && (
        <p className="m-0 mt-3 text-body">
          <Link to="/tracker" className="text-accent underline underline-offset-2">
            Подивитися захід у трекері
          </Link>
        </p>
      )}
    </article>
  )
}

export function Recommendations() {
  const inst = useInstitution()
  const decisions = useDecisions()
  const toast = useToast()
  const [status, setStatus] = useState<'all' | RecommendationStatus>('all')
  const [component, setComponent] = useState<'all' | ComponentId>('all')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [announce, setAnnounce] = useState('')

  const all = useMemo(
    () =>
      applyDecisions(
        buildRecommendations({
          items: [...inst.perceptionItems, ...inst.factItems],
          flags: inst.flags,
        }),
        decisions,
      ),
    [inst, decisions],
  )
  const list = all.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (component === 'all' || r.component === component),
  )
  const noteFor = (r: Recommendation): string | undefined => {
    const d = decisions.recommendations[r.id]
    if (r.status === 'rejected' && d?.reason) return `Причина відхилення: ${d.reason}`
    if (r.status === 'clarified' && d?.comment) return `Коментар до уточнення: ${d.comment}`
    return undefined
  }
  const done = (msg: string) => {
    setDialog(null)
    setAnnounce(msg)
    toast.push({ title: msg, tone: 'success' })
  }

  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Рекомендації</PageTitle>
      <Card as="section" aria-labelledby="recs-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 id="recs-h" className="card-title">
              Нові рекомендації
            </h2>
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-fine font-semibold tabular text-text-muted">
              {all.length}
            </span>
          </div>
          <div role="group" aria-label="Фільтри" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-caption text-text-muted">
              Статус
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                wrapperClassName="w-44"
                className="!h-9 !py-0"
              >
                <option value="all">Усі статуси</option>
                {STATUS_IDS.map((st) => (
                  <option key={st} value={st}>
                    {RECOMMENDATION_STATUS_LABEL[st]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-caption text-text-muted">
              Компонент
              <Select
                value={component}
                onChange={(e) => setComponent(e.target.value as typeof component)}
                wrapperClassName="w-44"
                className="!h-9 !py-0"
              >
                <option value="all">Усі компоненти</option>
                {COMPONENT_IDS.map((c) => (
                  <option key={c} value={c}>
                    {COMPONENT_LABELS[c]}
                  </option>
                ))}
              </Select>
            </label>
            <p className="m-0 pb-2 text-caption text-text-muted">
              Показано {list.length} з {all.length}
            </p>
          </div>
        </div>
        <p className="m-0 text-body text-text-muted">
          Рекомендація це пропозиція системи, рішення приймає керівник.
        </p>

        <p role="status" aria-live="polite" data-testid="announce" className="sr-only">
          {announce}
        </p>

        {list.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="size-6" />}
            title="За цими фільтрами рекомендацій немає"
            description="Змініть статус або компонент. Нові рекомендації зʼявляються після кожного циклу оцінювання."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((r, i) => (
              <RecommendationRow
                key={r.id}
                rec={r}
                index={i + 1}
                note={noteFor(r)}
                onAction={(kind) => setDialog({ kind, rec: r })}
              />
            ))}
          </div>
        )}
      </Card>

      {dialog?.kind === 'accept' && (
        <AcceptDialog rec={dialog.rec} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog && dialog.kind !== 'accept' && (
        <TextDialog
          rec={dialog.rec}
          kind={dialog.kind}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  )
}
