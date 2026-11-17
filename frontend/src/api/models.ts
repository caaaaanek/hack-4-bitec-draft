/**
 * Моделі екранів «Рекомендації», «Трекер», «Огляд»: одна форма для демо і для бекенду.
 * З бекендом рішення й статуси зберігаються на сервері (і потрапляють у журнал дій), у демо — у localStorage.
 */
import { useMemo } from 'react'
import { CYCLE, CYCLE_DATE } from '@/demo/data'
import { DEMO_MEASURES, PAST_RECOMMENDATIONS, POSITIONS, TODAY } from '@/demo/measures'
import { getDecisions, setDecisions, useDecisions } from '@/demo/decisionsStore'
import { institutionById } from '@/demo/institutions'
import {
  accept as acceptDecision,
  allMeasures,
  applyDecisions,
  clarify as clarifyDecision,
  reject as rejectDecision,
  setMeasureStatus,
} from '@/lib/decisions'
import { buildRecommendations, type Recommendation } from '@/lib/recommendations'
import type { Measure, MeasureStatus } from '@/lib/measures'
import { useAppData } from './AppData'
import { useInstitution } from '@/demo/useInstitution'

export interface RecommendationsModel {
  list: Recommendation[]
  noteFor: (r: Recommendation) => string | undefined
  accept: (rec: Recommendation, input: { position: string; dueDate: string }) => Promise<void>
  clarify: (id: string, comment: string) => Promise<void>
  reject: (id: string, reason: string) => Promise<void>
  positions: readonly string[]
  today: string
}

export function useRecommendationsModel(): RecommendationsModel {
  const data = useAppData()
  const decisions = useDecisions()
  const inst = useInstitution()
  return useMemo<RecommendationsModel>(() => {
    if (data) {
      const notes = new Map(data.recommendations.map((r) => [r.id, r.note]))
      return {
        list: data.recommendations,
        noteFor: (r) => notes.get(r.id),
        accept: (rec, input) =>
          data.decide(rec.id, 'accepted', '', { owner: input.position, due_date: input.dueDate }),
        clarify: (id, comment) => data.decide(id, 'clarify', comment),
        reject: (id, reason) => data.decide(id, 'rejected', reason),
        positions: POSITIONS,
        today: data.today,
      }
    }
    const list = applyDecisions(
      buildRecommendations({
        items: [...inst.perceptionItems, ...inst.factItems],
        flags: inst.flags,
      }),
      decisions,
    )
    return {
      list,
      noteFor: (r) => {
        const d = decisions.recommendations[r.id]
        if (r.status === 'rejected' && d?.reason) return `Причина відхилення: ${d.reason}`
        if (r.status === 'clarified' && d?.comment) return `Коментар до уточнення: ${d.comment}`
        return undefined
      },
      accept: async (rec, input) => {
        setDecisions(acceptDecision(getDecisions(), rec, { ...input, measureId: `m-${rec.id}` }))
      },
      clarify: async (id, comment) => setDecisions(clarifyDecision(getDecisions(), id, comment)),
      reject: async (id, reason) => setDecisions(rejectDecision(getDecisions(), id, reason)),
      positions: POSITIONS,
      today: TODAY,
    }
  }, [data, decisions, inst])
}

export interface MeasuresModel {
  measures: Measure[]
  today: string
  /** Назва рекомендації, з якої виник захід. */
  sourceOf: (m: Measure) => string | undefined
  /** Бекенд вимагає доказ для «Виконано». */
  doneNeedsEvidence: boolean
  /** true, якщо статус змінено. */
  change: (id: string, to: MeasureStatus, evidence?: string) => Promise<boolean>
}

export function useMeasuresModel(): MeasuresModel {
  const data = useAppData()
  const decisions = useDecisions()
  return useMemo<MeasuresModel>(() => {
    if (data) {
      return {
        measures: data.measures,
        today: data.today,
        sourceOf: (m) => data.recommendationTitles[m.recommendationId],
        doneNeedsEvidence: true,
        change: async (id, to, evidence) => {
          await data.setMeasureStatus(id, to, evidence)
          return true
        },
      }
    }
    const measures = allMeasures(DEMO_MEASURES, decisions)
    return {
      measures,
      today: TODAY,
      sourceOf: (m) => PAST_RECOMMENDATIONS[m.recommendationId],
      doneNeedsEvidence: false,
      change: async (id, to) => {
        const next = setMeasureStatus(getDecisions(), measures, id, to)
        if (next === getDecisions()) return false
        setDecisions(next)
        return true
      },
    }
  }, [data, decisions])
}

/** Підпис циклу для шапки, картки індексу й звіту. */
export function useCycle(): { label: string; date: string } {
  const data = useAppData()
  const inst = data?.institution
  return inst
    ? { label: inst.cycleLabel, date: inst.cycleDate }
    : { label: CYCLE, date: CYCLE_DATE }
}

/** Демо-заклад «Альфа» для лічильників меню в демо-режимі. */
export const demoAlpha = () => institutionById('alpha')
