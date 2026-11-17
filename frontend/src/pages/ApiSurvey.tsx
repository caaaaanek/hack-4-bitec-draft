/* eslint-disable react-refresh/only-export-components */
/** Проходження анкети з бекенду: анонімно за одноразовим посиланням або за обліковим записом. */
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LoadingState } from '@/components/ui'
import { api, ApiError, type Schemas } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import { toSurvey } from '@/api/adapters'
import { useSessionOptional } from '@/api/session'
import type { Answers } from '@/lib/survey'
import type { Survey as SurveyModel } from '@/demo/survey'
import { SurveyFlow, TokenState } from './Survey'

/** Шкала приходить без варіантів: робимо варіанти «1…N», при поданні передаємо число. */
const SCALE = '__scale__:'

function withScales(form: Schemas['FormOut']): Schemas['FormOut'] {
  return {
    ...form,
    sections: form.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) =>
        q.type === 'scale' && q.options.length === 0 && q.scale_min != null && q.scale_max != null
          ? {
              ...q,
              options: Array.from({ length: q.scale_max - q.scale_min + 1 }, (_, i) => ({
                id: `${SCALE}${q.id}:${q.scale_min! + i}`,
                text: String(q.scale_min! + i),
              })),
            }
          : q,
      ),
    })),
  }
}

export function toSubmission(answers: Answers): Schemas['SubmissionIn'] {
  return {
    answers: Object.entries(answers).map(([questionId, optionId]) =>
      optionId.startsWith(SCALE)
        ? { question_id: questionId, option_ids: [], value: Number(optionId.split(':').pop()) }
        : { question_id: questionId, option_ids: [optionId] },
    ),
  }
}

const stateOf = (e: unknown): 'used' | 'invalid' | 'closed' =>
  e instanceof ApiError && e.code === 'token_used'
    ? 'used'
    : e instanceof ApiError && (e.code === 'campaign_not_open' || e.code === 'conflict')
      ? 'closed'
      : 'invalid'

function useSurvey(
  form: Schemas['FormOut'] | undefined,
  category?: string | null,
): SurveyModel | null {
  return useMemo(() => (form ? toSurvey(withScales(form), category) : null), [form, category])
}

/** /s/:token — без входу, токен лише в заголовку X-Response-Token. */
export function TokenSurvey() {
  const { token = '' } = useParams()
  const session = useSessionOptional()
  const q = useQuery({
    queryKey: ['token-form', token],
    queryFn: () => api.tokenForm(token),
    retry: false,
    staleTime: Infinity,
  })
  const survey = useSurvey(q.data)
  if (q.isPending)
    return (
      <div aria-busy="true" className="p-6">
        <LoadingState>Відкриваємо анкету</LoadingState>
      </div>
    )
  if (q.isError || !survey) return <TokenState state={stateOf(q.error)} />
  return (
    <SurveyFlow
      survey={survey}
      token={`t:${token.slice(0, 12)}`}
      minGroup={q.data.min_group_size}
      resultsHref={session?.user ? '/me' : null}
      onSubmit={async (answers) => {
        await api.tokenSubmit(token, toSubmission(answers))
      }}
    />
  )
}

/** /answer/:campaignId/:questionnaireId — за обліковим записом респондента. */
export function AccountSurvey() {
  const { campaignId = '', questionnaireId = '' } = useParams()
  const session = useSessionOptional()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['form', campaignId, questionnaireId],
    queryFn: () => endpoints.form(campaignId, questionnaireId),
    retry: false,
  })
  const survey = useSurvey(q.data, session?.user?.category)
  if (q.isPending)
    return (
      <div aria-busy="true" className="p-6">
        <LoadingState>Відкриваємо анкету</LoadingState>
      </div>
    )
  if (q.isError || !survey)
    return (
      <TokenState
        state={
          q.error instanceof ApiError &&
          q.error.status === 409 &&
          /пройш|вже/i.test(q.error.message)
            ? 'used'
            : stateOf(q.error)
        }
      />
    )
  return (
    <SurveyFlow
      survey={survey}
      token={`a:${campaignId}:${questionnaireId}`}
      resultsHref="/me"
      onSubmit={async (answers) => {
        await endpoints.submit(campaignId, questionnaireId, toSubmission(answers))
        void qc.invalidateQueries({ queryKey: ['assignments'] })
      }}
    />
  )
}
