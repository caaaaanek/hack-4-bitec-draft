/**
 * Керування хвилями (адміністратор): створити, відкрити, закрити, прогрес без імен,
 * одноразові посилання для анонімного проходження.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Link2, Lock, Play, Plus, Settings } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  Radio,
  Select,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { ApiError, type Schemas } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import { K_MIN_GROUP } from '@/lib/scoring/methodology'

type Campaign = Schemas['CampaignOut']

const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'strength' }> = {
  draft: { label: 'Чернетка', tone: 'neutral' },
  open: { label: 'Відкрита', tone: 'accent' },
  closed: { label: 'Закрита', tone: 'strength' },
}
const CATEGORY: Record<string, string> = {
  working_group: 'робоча група',
  staff: 'особовий склад',
  expert: 'експерти',
}
const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.message}. ${e.hint}` : 'Не вдалося виконати дію.'
const fmtDate = (iso?: string | null) => (iso ? iso.split('-').reverse().join('.') : 'ще ні')

function unitLabel(units: Schemas['UnitOut'][]) {
  const byId = new Map(units.map((u) => [u.id, u]))
  const depth = (u: Schemas['UnitOut']): number =>
    u.parent_id && byId.get(u.parent_id) ? 1 + depth(byId.get(u.parent_id)!) : 0
  return (u: Schemas['UnitOut']) => `${'· '.repeat(depth(u))}${u.name}`
}

function CreateCampaign({ onCreated }: { onCreated: (c: Campaign) => void }) {
  const toast = useToast()
  const units = useQuery({ queryKey: ['units'], queryFn: endpoints.units })
  const qs = useQuery({
    queryKey: ['questionnaires', 'published'],
    queryFn: () => endpoints.questionnaires({ status: 'published' }),
  })
  const [title, setTitle] = useState('')
  const [unitId, setUnitId] = useState('')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [mode, setMode] = useState<'login' | 'token'>('login')
  const [k, setK] = useState(String(K_MIN_GROUP))
  const [error, setError] = useState('')
  const root = units.data?.find((u) => !u.parent_id)
  const label = useMemo(() => unitLabel(units.data ?? []), [units.data])
  const selected = picked ?? (qs.data ?? []).map((q) => q.id)

  const create = useMutation({
    mutationFn: () =>
      endpoints.createCampaign({
        title: title.trim(),
        unit_id: unitId || root!.id,
        questionnaire_ids: selected,
        min_group_size: Number(k),
        access_mode: mode,
      }),
    onSuccess: (c) => {
      toast.push({ title: `Хвилю «${c.title}» створено як чернетку`, tone: 'success' })
      setTitle('')
      onCreated(c)
    },
    onError: (e) => setError(errText(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setError('Вкажіть назву хвилі.')
    if (selected.length === 0) return setError('Оберіть хоча б одну анкету.')
    if (!(Number(k) >= K_MIN_GROUP)) return setError(`Поріг k не менший за ${K_MIN_GROUP}.`)
    setError('')
    create.mutate()
  }

  if (units.isPending || qs.isPending)
    return <LoadingState>Завантажуємо підрозділи й анкети</LoadingState>
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Назва хвилі" required>
          {({ id }) => (
            <Input
              id={id}
              value={title}
              placeholder="Хвиля 3 (весна)"
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Підрозділ (з дочірніми)" required>
          {({ id }) => (
            <Select
              id={id}
              value={unitId || root?.id || ''}
              onChange={(e) => setUnitId(e.target.value)}
            >
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {label(u)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      <fieldset className="m-0 border-0 p-0">
        <legend className="text-body font-semibold">Анкети</legend>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          {(qs.data ?? []).map((q) => (
            <Checkbox
              key={q.id}
              label={`${q.title} (v${q.version})`}
              hint={q.kind === 'checklist' ? 'чек-лист робочої групи' : CATEGORY[q.target_category]}
              checked={selected.includes(q.id)}
              onChange={(e) =>
                setPicked(
                  e.target.checked ? [...selected, q.id] : selected.filter((x) => x !== q.id),
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-body font-semibold">Як проходять</legend>
          <Radio
            name="mode"
            value="login"
            label="За обліковими записами"
            hint="Респонденти входять і бачать анкету у «Мої анкети»"
            checked={mode === 'login'}
            onChange={() => setMode('login')}
          />
          <Radio
            name="mode"
            value="token"
            label="Анонімно за одноразовими посиланнями"
            hint="Без облікових записів; посилання видаєте ви на цій сторінці"
            checked={mode === 'token'}
            onChange={() => setMode('token')}
          />
        </fieldset>
        <FormField
          label="Поріг k (мінімальна група)"
          hint={`Не менше ${K_MIN_GROUP}: менші групи не показуються`}
          error={error}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="number"
              min={K_MIN_GROUP}
              value={k}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(e) => setK(e.target.value)}
            />
          )}
        </FormField>
      </div>
      <div>
        <Button
          type="submit"
          loading={create.isPending}
          leftIcon={<Plus aria-hidden className="size-4" />}
        >
          Створити чернетку
        </Button>
      </div>
    </form>
  )
}

function Tokens({ campaign }: { campaign: Campaign }) {
  const toast = useToast()
  const units = useQuery({ queryKey: ['units'], queryFn: endpoints.units })
  const qs = useQuery({
    queryKey: ['questionnaires', 'published'],
    queryFn: () => endpoints.questionnaires({ status: 'published' }),
  })
  const surveys = (qs.data ?? []).filter(
    (q) => campaign.questionnaire_ids.includes(q.id) && q.kind !== 'checklist',
  )
  const [qid, setQid] = useState('')
  const [unitId, setUnitId] = useState('')
  const [count, setCount] = useState('10')
  const [issued, setIssued] = useState<Schemas['TokensOut'] | null>(null)
  const label = useMemo(() => unitLabel(units.data ?? []), [units.data])
  const q = surveys.find((x) => x.id === (qid || surveys[0]?.id))
  const isExpert = q?.target_category === 'expert'

  const issue = useMutation({
    mutationFn: () =>
      endpoints.issueTokens(campaign.id, {
        questionnaire_id: q!.id,
        unit_id: isExpert ? null : unitId || campaign.unit_id,
        count: Number(count),
      }),
    onSuccess: (r) => {
      setIssued(r)
      toast.push({ title: `Видано посилань: ${r.tokens.length}`, tone: 'success' })
    },
    onError: (e) => toast.push({ title: errText(e), tone: 'error' }),
  })
  const revoke = useMutation({
    mutationFn: () => endpoints.revokeTokens(campaign.id, {}),
    onSuccess: (r) =>
      toast.push({ title: `Відкликано невикористаних посилань: ${r.revoked}`, tone: 'success' }),
    onError: (e) => toast.push({ title: errText(e), tone: 'error' }),
  })
  const links = (issued?.tokens ?? []).map((t) =>
    t.link.startsWith('/') ? `${window.location.origin}${t.link}` : t.link,
  )
  const saveCsv = () => {
    const blob = new Blob(['﻿link\n' + links.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `links-${campaign.title}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (campaign.status === 'closed') return null
  return (
    <Card as="section" aria-labelledby="tok-h" className="flex flex-col gap-4">
      <h2 id="tok-h" className="card-title">
        <Link2 aria-hidden />
        Одноразові посилання
      </h2>
      <p className="m-0 text-body text-text-muted">
        Кожне посилання відкриває анкету один раз і без входу. Система зберігає лише хеш посилання і
        не знає, кому ви його дали. Посилання показуються тільки зараз: збережіть їх.
      </p>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end">
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          Анкета
          <Select value={q?.id ?? ''} onChange={(e) => setQid(e.target.value)}>
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          Підрозділ
          <Select
            value={unitId || campaign.unit_id}
            disabled={isExpert}
            onChange={(e) => setUnitId(e.target.value)}
          >
            {(units.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {label(u)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-text-muted">
          Кількість
          <Input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <Button loading={issue.isPending} disabled={!q} onClick={() => issue.mutate()}>
          Видати
        </Button>
      </div>
      {issued && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface-muted p-4">
          {issued.warning && <p className="m-0 text-body text-attention-text">{issued.warning}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Copy aria-hidden className="size-4" />}
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(links.join('\n'))
                  .then(() => toast.push({ title: 'Посилання скопійовано', tone: 'success' }))
              }
            >
              Копіювати всі
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Download aria-hidden className="size-4" />}
              onClick={saveCsv}
            >
              Зберегти CSV
            </Button>
          </div>
          <ol className="m-0 max-h-56 overflow-y-auto pl-6 text-caption">
            {links.map((l) => (
              <li key={l}>
                <a
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-accent underline underline-offset-2"
                >
                  {l}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div>
        <Button
          size="sm"
          variant="danger"
          loading={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Відкликати всі невикористані
        </Button>
      </div>
    </Card>
  )
}

function Details({ campaign }: { campaign: Campaign }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null)
  const progress = useQuery({
    queryKey: ['progress', campaign.id],
    queryFn: () => endpoints.progress(campaign.id),
    refetchInterval: campaign.status === 'open' ? 15000 : false,
  })
  const action = useMutation({
    mutationFn: (kind: 'open' | 'close') =>
      kind === 'open' ? endpoints.openCampaign(campaign.id) : endpoints.closeCampaign(campaign.id),
    onSuccess: (_, kind) => {
      toast.push({
        title:
          kind === 'open'
            ? 'Хвилю відкрито: респонденти бачать анкети'
            : 'Хвилю закрито: знімок результатів збережено',
        tone: 'success',
      })
      void qc.invalidateQueries()
    },
    onError: (e) => toast.push({ title: errText(e), tone: 'error' }),
    onSettled: () => setConfirm(null),
  })
  const st = STATUS[campaign.status] ?? STATUS.draft!
  return (
    <div className="flex flex-col gap-5">
      <Card as="section" aria-labelledby="det-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="det-h" className="m-0 text-section">
              {campaign.title}
            </h2>
            <p className="m-0 mt-1 text-caption text-text-muted">
              Відкрито {fmtDate(campaign.opened_on)} · закрито {fmtDate(campaign.closed_on)} · k ={' '}
              {campaign.min_group_size} ·{' '}
              {campaign.access_mode === 'token'
                ? 'анонімно за посиланнями'
                : 'за обліковими записами'}
            </p>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {campaign.status === 'draft' && (
            <Button
              leftIcon={<Play aria-hidden className="size-4" />}
              onClick={() => setConfirm('open')}
            >
              Відкрити хвилю
            </Button>
          )}
          {campaign.status === 'open' && (
            <Button
              leftIcon={<Lock aria-hidden className="size-4" />}
              onClick={() => setConfirm('close')}
            >
              Закрити й порахувати індекс
            </Button>
          )}
        </div>
        <div>
          <h3 className="m-0 text-card">Проходження</h3>
          <p className="m-0 text-caption text-text-muted">
            Лише кількості, без імен. Для груп, менших за k, приховано.
          </p>
          {progress.isPending ? (
            <LoadingState>Рахуємо</LoadingState>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {(progress.data?.items ?? []).map((i) => (
                <li key={i.questionnaire_id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap justify-between gap-2 text-body">
                    <span>{i.questionnaire_title}</span>
                    <span className="tabular text-text-muted">
                      {i.too_few_people
                        ? `менше ${campaign.min_group_size} осіб: приховано`
                        : `${i.submitted} з ${i.eligible} (${String(i.percent).replace('.', ',')}%)`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${i.percent ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {campaign.access_mode === 'token' && <Tokens campaign={campaign} />}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'open' ? 'Відкрити хвилю?' : 'Закрити хвилю?'}
        description={
          confirm === 'open'
            ? 'Після відкриття склад анкет і підрозділ змінити не можна. Респонденти побачать анкети.'
            : 'Прийом відповідей зупиниться, система порахує індекс і збереже незмінний знімок. Скасувати закриття не можна.'
        }
        confirmLabel={confirm === 'open' ? 'Відкрити' : 'Закрити хвилю'}
        onConfirm={() => confirm && action.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

export function Manage() {
  const qc = useQueryClient()
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: endpoints.campaigns })
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const list = campaigns.data ?? []
  const current =
    list.find((c) => c.id === selected) ??
    (creating ? undefined : (list.find((c) => c.status !== 'closed') ?? list[0]))

  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Керування циклом</PageTitle>
      <p className="m-0 max-w-(--prose-max) text-body text-text-muted">
        Ви запускаєте хвилі й бачите лише кількість відповідей. Самих відповідей, навіть
        узагальнених по людях, у вас немає.
      </p>
      <div className="grid gap-5 xl:grid-cols-[20rem_1fr]">
        <Card as="nav" aria-label="Хвилі" className="flex flex-col gap-2 self-start">
          <Button
            variant={creating ? 'primary' : 'secondary'}
            leftIcon={<Plus aria-hidden className="size-4" />}
            onClick={() => {
              setCreating(true)
              setSelected(null)
            }}
          >
            Нова хвиля
          </Button>
          {campaigns.isPending ? (
            <LoadingState>Завантажуємо</LoadingState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((c) => {
                const st = STATUS[c.status] ?? STATUS.draft!
                const active = !creating && current?.id === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setCreating(false)
                        setSelected(c.id)
                      }}
                      className={cn(
                        'flex w-full flex-col items-start gap-1 rounded-[12px] px-3 py-2 text-left',
                        active ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                      )}
                    >
                      <span className="text-body font-semibold">{c.title}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <div className="min-w-0">
          {creating ? (
            <Card as="section" aria-labelledby="new-h" className="flex flex-col gap-4">
              <h2 id="new-h" className="card-title">
                <Settings aria-hidden />
                Нова хвиля
              </h2>
              <CreateCampaign
                onCreated={(c) => {
                  void qc.invalidateQueries({ queryKey: ['campaigns'] })
                  setCreating(false)
                  setSelected(c.id)
                }}
              />
            </Card>
          ) : current ? (
            <Details key={current.id} campaign={current} />
          ) : (
            <EmptyState title="Хвиль ще немає" description="Створіть першу хвилю оцінювання." />
          )}
        </div>
      </div>
    </div>
  )
}
