/* eslint-disable react-refresh/only-export-components */
/**
 * Дані результатів з бекенду для екранів керівника, аудитора, адміністратора й укладача:
 * остання закрита хвиля, її знімок, історія підрозділу, рекомендації з рішеннями й заходи.
 *
 * Поза цим провайдером (демо-режим, тести окремих екранів) хуки повертають демо-дані.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3 } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import type { Measure, MeasureStatus } from '@/lib/measures'
import { ApiError } from './client'
import { endpoints } from './endpoints'
import {
  BACKEND_MEASURE_STATUS,
  toInstitution,
  toMeasure,
  toRecommendation,
  type ApiInstitution,
  type ApiRecommendation,
} from './adapters'

const RESULT_ROLES = new Set(['admin', 'commissioner', 'leader', 'auditor'])

export interface AppDataValue {
  status: 'loading' | 'empty' | 'error' | 'ready'
  error: ApiError | null
  institution: ApiInstitution | null
  recommendations: ApiRecommendation[]
  measures: Measure[]
  /** Назви рекомендацій за кодом (для підпису «З рекомендації»). */
  recommendationTitles: Record<string, string>
  today: string
  decide: (
    code: string,
    decision: 'accepted' | 'clarify' | 'rejected',
    comment: string,
    measure?: { owner: string; due_date: string },
  ) => Promise<void>
  setMeasureStatus: (id: string, to: MeasureStatus, evidence?: string) => Promise<void>
  reload: () => void
}

const AppDataContext = createContext<AppDataValue | null>(null)

const isoToday = () => new Date().toISOString().slice(0, 10)

export function AppDataProvider({
  backendRole,
  children,
}: {
  backendRole: string
  children: ReactNode
}) {
  const qc = useQueryClient()
  const enabled = RESULT_ROLES.has(backendRole)

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => endpoints.dashboard(),
    enabled,
    retry: false,
  })
  const campaignId = dashboard.data?.campaign_id ?? undefined
  const unitId = dashboard.data?.unit_id ?? undefined

  const results = useQuery({
    queryKey: ['results', campaignId, unitId],
    queryFn: () => endpoints.results(campaignId!, unitId),
    enabled: enabled && Boolean(campaignId),
  })
  const history = useQuery({
    queryKey: ['history', unitId],
    queryFn: () => endpoints.history(unitId!),
    enabled: enabled && Boolean(unitId),
  })
  const recs = useQuery({
    queryKey: ['recommendations', campaignId, unitId],
    queryFn: () => endpoints.recommendations(campaignId!, unitId),
    enabled: enabled && Boolean(campaignId),
  })
  const measures = useQuery({
    queryKey: ['measures', unitId],
    queryFn: () => endpoints.measures({ unit_id: unitId }),
    enabled: enabled && Boolean(unitId),
  })

  const reload = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
    void qc.invalidateQueries({ queryKey: ['recommendations'] })
    void qc.invalidateQueries({ queryKey: ['measures'] })
  }, [qc])

  const decideMutation = useMutation({
    mutationFn: (v: {
      code: string
      decision: 'accepted' | 'clarify' | 'rejected'
      comment: string
      measure?: { owner: string; due_date: string }
    }) =>
      endpoints.decide(campaignId!, v.code, {
        unit_id: unitId,
        decision: v.decision,
        comment: v.comment,
        measure: v.measure
          ? { owner: v.measure.owner, due_date: v.measure.due_date, description: '' }
          : undefined,
      }),
    onSuccess: reload,
  })
  const measureMutation = useMutation({
    mutationFn: (v: { id: string; to: MeasureStatus; evidence?: string }) =>
      endpoints.updateMeasure(v.id, {
        status: (BACKEND_MEASURE_STATUS[v.to] ?? 'in_progress') as never,
        ...(v.to === 'done' ? { evidence: v.evidence, done_on: isoToday() } : {}),
      }),
    onSuccess: reload,
  })

  const value = useMemo<AppDataValue>(() => {
    const error =
      [dashboard.error, results.error, history.error].find(
        (e): e is ApiError => e instanceof ApiError,
      ) ?? null
    const noWave =
      dashboard.error instanceof ApiError &&
      (dashboard.error.status === 404 || dashboard.error.status === 409)
    const institution =
      results.data && (history.data || history.isError)
        ? toInstitution(results.data, history.data ?? null)
        : null
    const recommendations = (recs.data?.items ?? []).map(toRecommendation)
    const status: AppDataValue['status'] = !enabled
      ? 'empty'
      : noWave
        ? 'empty'
        : error
          ? 'error'
          : institution
            ? 'ready'
            : 'loading'
    return {
      status,
      error: noWave ? null : error,
      institution,
      recommendations,
      measures: (measures.data ?? []).map(toMeasure),
      recommendationTitles: Object.fromEntries(
        (recs.data?.items ?? []).map((r) => [r.code, r.title]),
      ),
      today: isoToday(),
      decide: async (code, decision, comment, measure) => {
        await decideMutation.mutateAsync({ code, decision, comment, measure })
      },
      setMeasureStatus: async (id, to, evidence) => {
        await measureMutation.mutateAsync({ id, to, evidence })
      },
      reload,
    }
  }, [
    enabled,
    dashboard.error,
    results.data,
    results.error,
    history.data,
    history.error,
    history.isError,
    recs.data,
    measures.data,
    decideMutation,
    measureMutation,
    reload,
  ])

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

/** Дані з бекенду або null, якщо застосунок працює на демо-даних. */
export const useAppData = (): AppDataValue | null => useContext(AppDataContext)

/** Обгортка екранів результатів: поки даних немає — стан завантаження, порожній стан або помилка. */
export function ResultsGate({ children }: { children: ReactNode }) {
  const data = useAppData()
  if (!data) return <>{children}</>
  if (data.status === 'ready') return <>{children}</>
  if (data.status === 'loading')
    return (
      <div aria-busy="true">
        <LoadingState>Завантажуємо результати останньої закритої хвилі</LoadingState>
      </div>
    )
  if (data.status === 'empty')
    return (
      <div data-ready="true">
        <EmptyState
          icon={<BarChart3 className="size-8" />}
          title="Ще немає закритої хвилі оцінювання"
          description="Результати зʼявляться, коли адміністратор закриє хвилю. Тоді система порахує індекс і збереже незмінний знімок."
        />
      </div>
    )
  return (
    <div data-ready="true">
      <ErrorState
        description={data.error?.message ?? 'Сервер не відповів.'}
        whatToDo={
          <span className="inline-flex items-center gap-1">
            <AlertTriangle aria-hidden className="size-4" />
            {data.error?.hint ?? 'Оновіть сторінку.'}
            {data.error?.requestId ? ` Код запиту: ${data.error.requestId}.` : ''}
          </span>
        }
        onRetry={data.reload}
      />
    </div>
  )
}
