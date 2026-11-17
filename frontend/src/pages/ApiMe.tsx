/** Кабінет учасника з бекенду: призначені анкети (пройти) і узагальнені результати свого підрозділу. */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, ClipboardList, HeartHandshake } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  BigNumber,
  Card,
  EmptyState,
  ErrorState,
  HiddenGroupState,
  LoadingState,
  MaturityBadge,
  SegmentedBar,
  buttonBase,
  buttonSizes,
  buttonVariants,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import type { MaturityLevel } from '@/components/ui/config'
import { fmt, fmtIndex, levelOf } from '@/lib/scoring/methodology'
import { endpoints } from '@/api/endpoints'
import { isComponentId } from '@/api/adapters'
import { useSession } from '@/api/session'
import { ApiError, type Schemas } from '@/api/client'

const levelOfBrief = (
  l: { level: number } | null | undefined,
  score: number | null | undefined,
): MaturityLevel => (l?.level ?? levelOf(score ?? 0)) as MaturityLevel

function Scope({ scope, title }: { scope: Schemas['ScopeBrief']; title: string }) {
  if (!scope.sufficient)
    return (
      <Card as="section" className="flex flex-col gap-3">
        <h2 className="card-title">{title}</h2>
        <HiddenGroupState />
      </Card>
    )
  const index = scope.index.score ?? 0
  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="card-title">{title}</h2>
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
        <li className="flex flex-col gap-2 rounded-[14px] bg-primary-soft p-4">
          <span className="text-caption text-text-muted">Індекс</span>
          <BigNumber value={fmtIndex(index)} size="display" />
          <MaturityBadge level={levelOfBrief(scope.index.level, index)} className="self-start" />
        </li>
        {scope.components.map((c) => (
          <li key={c.code} className="flex flex-col gap-2 rounded-[14px] bg-surface-muted p-4">
            <span className="text-caption text-text-muted">{c.title}</span>
            <BigNumber value={c.score === null || c.score === undefined ? 'н/д' : fmt(c.score)} />
            {isComponentId(c.code) && c.score != null && (
              <SegmentedBar
                meter
                tone={c.code}
                segments={24}
                className="h-1.5"
                value={c.score}
                label={`${c.title}: ${fmt(c.score)} з 100`}
              />
            )}
            <MaturityBadge level={levelOfBrief(c.level, c.score)} className="self-start" />
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function ApiMe() {
  const { role } = useSession()
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: endpoints.assignments })
  const results = useQuery({ queryKey: ['my-results'], queryFn: endpoints.myResults })
  const latest = Array.isArray(results.data)
    ? (results.data as Schemas['ParticipantResultOut'][])[0]
    : results.data

  const todo = (assignments.data ?? []).filter((a) => a.kind !== 'checklist')

  return (
    <div data-ready="true" className="space-y-5">
      <div>
        <PageTitle>Мої анкети й результати</PageTitle>
        <p className="mt-1 flex items-center gap-2 text-body-lg text-text-muted">
          <HeartHandshake aria-hidden className="size-5 shrink-0 text-accent" />
          Відповіді анонімні: вони не повʼязані з вашим обліковим записом.
        </p>
      </div>

      <Card as="section" aria-labelledby="todo-h" className="flex flex-col gap-3">
        <h2 id="todo-h" className="card-title">
          <ClipboardList aria-hidden />
          Анкети відкритих хвиль
        </h2>
        {assignments.isPending ? (
          <LoadingState>Завантажуємо анкети</LoadingState>
        ) : todo.length === 0 ? (
          <p className="m-0 text-body text-text-muted">Зараз немає відкритих анкет для вас.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {todo.map((a) => (
              <li
                key={`${a.campaign_id}-${a.questionnaire_id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="m-0 text-body font-semibold">{a.questionnaire_title}</p>
                  <p className="m-0 text-caption text-text-muted">{a.campaign_title}</p>
                </div>
                {a.submitted ? (
                  <span className="inline-flex items-center gap-1.5 text-body text-strength-text">
                    <CheckCircle2 aria-hidden className="size-4" />
                    Пройдено
                  </span>
                ) : (
                  <Link
                    to={`/answer/${a.campaign_id}/${a.questionnaire_id}`}
                    className={cn(
                      buttonBase,
                      buttonVariants.primary,
                      buttonSizes.md,
                      'no-underline',
                    )}
                  >
                    Пройти анкету
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {role === 'checklist_editor' && (
          <p className="m-0 flex items-center gap-2 text-body">
            <ClipboardCheck aria-hidden className="size-4 text-accent" />
            Ви в робочій групі:{' '}
            <Link to="/checklist" className="text-accent underline underline-offset-2">
              заповнити чек-лист
            </Link>
          </p>
        )}
      </Card>

      {results.isPending ? (
        <LoadingState>Завантажуємо результати</LoadingState>
      ) : results.isError ? (
        results.error instanceof ApiError && results.error.status === 404 ? (
          <EmptyState
            title="Результатів ще немає"
            description="Вони зʼявляться після закриття хвилі."
          />
        ) : (
          <ErrorState
            description={
              results.error instanceof ApiError ? results.error.message : 'Сервер не відповів.'
            }
            whatToDo="Оновіть сторінку."
            onRetry={() => void results.refetch()}
          />
        )
      ) : !latest ? (
        <EmptyState
          title="Результатів ще немає"
          description="Вони зʼявляться після закриття хвилі, у якій ви брали участь."
        />
      ) : (
        <>
          <p className="m-0 text-body text-text-muted">
            {latest.campaign_title}
            {latest.closed_on ? `, закрито ${latest.closed_on.split('-').reverse().join('.')}` : ''}
            .
          </p>
          {latest.my_unit && (
            <Scope scope={latest.my_unit} title={`Мій підрозділ: ${latest.my_unit.unit_name}`} />
          )}
          <Scope scope={latest.institution} title={`Заклад: ${latest.institution.unit_name}`} />
          {latest.summary.length > 0 && (
            <Card as="section" aria-labelledby="sum-h">
              <h2 id="sum-h" className="card-title">
                Коротко
              </h2>
              <ul className="m-0 mt-2 list-disc pl-5 text-body">
                {latest.summary.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <p className="m-0 border-t border-border pt-3 text-caption text-text-muted">
        Тут лише узагальнені дані груп не менше k осіб. Окремих відповідей і імен немає.
      </p>
    </div>
  )
}
