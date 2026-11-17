/**
 * Анкети (укладач): список версій, перегляд структури з балами, публікація, нова версія, архів.
 * Опубліковану анкету змінити не можна — лише нова версія (так хвилі лишаються порівнянними).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CopyPlus, Eye, Send } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Badge, Button, Card, Dialog, LoadingState, useToast } from '@/components/ui'
import { ApiError, type Schemas } from '@/api/client'
import { endpoints } from '@/api/endpoints'

const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'strength' }> = {
  draft: { label: 'Чернетка', tone: 'neutral' },
  published: { label: 'Опубліковано', tone: 'strength' },
  archived: { label: 'В архіві', tone: 'neutral' },
}
const CATEGORY: Record<string, string> = {
  working_group: 'Робоча група',
  staff: 'Особовий склад',
  expert: 'Зовнішні експерти',
}
const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.message}. ${e.hint}` : 'Не вдалося виконати дію.'

function Structure({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['questionnaire', id],
    queryFn: () => endpoints.questionnaire(id),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      variant="side"
      title={q.data?.title ?? 'Анкета'}
      description={q.data ? `Версія ${q.data.version} · ${q.data.code}` : undefined}
    >
      {q.isPending ? (
        <LoadingState>Завантажуємо структуру</LoadingState>
      ) : q.isError ? (
        <p className="text-critical-text">{errText(q.error)}</p>
      ) : (
        <div className="flex flex-col gap-4 pb-6">
          {q.data.description && (
            <p className="m-0 text-body text-text-muted">{q.data.description}</p>
          )}
          {q.data.sections.map((s) => (
            <section key={s.id} className="flex flex-col gap-2">
              <h3 className="m-0 text-card">
                {s.title} <span className="text-caption text-text-muted">({s.component})</span>
              </h3>
              <ol className="m-0 flex flex-col gap-2 pl-5">
                {s.questions.map((qq) => (
                  <li key={qq.id} className="text-body">
                    <p className="m-0">
                      {qq.text} <code className="text-caption text-text-muted">{qq.code}</code>
                    </p>
                    {qq.options.length > 0 && (
                      <ul className="m-0 mt-1 list-none p-0 text-caption text-text-muted">
                        {qq.options.map((o) => (
                          <li key={o.id}>
                            <span className="tabular font-semibold text-text">
                              {String(o.score).replace('.', ',')}
                            </span>{' '}
                            · {o.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  )
}

export function Surveys() {
  const toast = useToast()
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['questionnaires', 'all'],
    queryFn: () => endpoints.questionnaires(),
  })
  const [view, setView] = useState<string | null>(null)
  const act = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'publish' | 'version' | 'archive' }) => {
      if (kind === 'publish') {
        const issues = await endpoints.validate(id)
        if (issues.length) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join('; '))
        return endpoints.publish(id)
      }
      return kind === 'version' ? endpoints.newVersion(id) : endpoints.archive(id)
    },
    onSuccess: (q, v) => {
      toast.push({
        title:
          v.kind === 'publish'
            ? `Опубліковано: ${q.title}`
            : v.kind === 'version'
              ? `Створено чернетку версії ${q.version}`
              : `В архіві: ${q.title}`,
        tone: 'success',
      })
      void qc.invalidateQueries({ queryKey: ['questionnaires'] })
    },
    onError: (e) =>
      toast.push({
        title: e instanceof ApiError ? errText(e) : (e as Error).message,
        tone: 'error',
      }),
  })

  const rows = [...(list.data ?? [])].sort(
    (a, b) => a.code.localeCompare(b.code) || b.version - a.version,
  )
  return (
    <div data-ready="true" className="flex flex-col gap-5">
      <PageTitle>Анкети</PageTitle>
      <p className="m-0 max-w-(--prose-max) text-body text-text-muted">
        Опубліковану анкету змінити не можна: зміни вносяться новою версією, а кожна дія потрапляє в
        журнал. Ви не бачите, хто й скільки людей пройшли анкети.
      </p>
      {list.isPending ? (
        <LoadingState>Завантажуємо анкети</LoadingState>
      ) : (
        <Card className="p-0">
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {rows.map((q: Schemas['QuestionnaireSummary']) => {
              const st = STATUS[q.status] ?? STATUS.draft!
              return (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-body font-semibold">{q.title}</p>
                    <p className="m-0 text-caption text-text-muted">
                      {q.kind === 'checklist' ? 'Чек-лист' : CATEGORY[q.target_category]} · версія{' '}
                      {q.version} · <code>{q.code}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Eye aria-hidden className="size-4" />}
                      onClick={() => setView(q.id)}
                    >
                      Переглянути
                    </Button>
                    {q.status === 'draft' && (
                      <Button
                        size="sm"
                        leftIcon={<Send aria-hidden className="size-4" />}
                        onClick={() => act.mutate({ id: q.id, kind: 'publish' })}
                      >
                        Опублікувати
                      </Button>
                    )}
                    {q.status === 'published' && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<CopyPlus aria-hidden className="size-4" />}
                          onClick={() => act.mutate({ id: q.id, kind: 'version' })}
                        >
                          Нова версія
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<Archive aria-hidden className="size-4" />}
                          onClick={() => act.mutate({ id: q.id, kind: 'archive' })}
                        >
                          В архів
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      <p className="m-0 text-caption text-text-muted">
        Редагувати структуру чернетки (розділи, питання, варіанти й бали) можна через API
        конструктора: PUT /questionnaires/{'{id}'}/structure.
      </p>
      {view && <Structure id={view} onClose={() => setView(null)} />}
    </div>
  )
}
