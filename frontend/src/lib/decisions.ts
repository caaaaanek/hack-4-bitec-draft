/** Рішення керівника за рекомендаціями й заходами: чисті функції над станом (без сховища). */
import {
  canRecommendationMove,
  type Recommendation,
  type RecommendationStatus,
} from './recommendations'
import { canMeasureMove, type Measure, type MeasureStatus } from './measures'

export interface RecommendationDecision {
  status: RecommendationStatus
  comment?: string
  reason?: string
}

export interface DecisionsState {
  recommendations: Record<string, RecommendationDecision>
  /** Ручні зміни статусу демо-заходів. */
  measureStatus: Record<string, MeasureStatus>
  /** Заходи, створені після прийняття рекомендацій. */
  added: Measure[]
}

export const EMPTY_DECISIONS: DecisionsState = {
  recommendations: {},
  measureStatus: {},
  added: [],
}

export const statusOfRecommendation = (state: DecisionsState, id: string): RecommendationStatus =>
  state.recommendations[id]?.status ?? 'proposed'

export function applyDecisions(list: Recommendation[], state: DecisionsState): Recommendation[] {
  return list.map((r) => ({ ...r, status: statusOfRecommendation(state, r.id) }))
}

export interface AcceptInput {
  position: string
  dueDate: string
  /** Ідентифікатор нового заходу (передається ззовні, щоб функція лишалась чистою). */
  measureId: string
}

export function accept(
  state: DecisionsState,
  rec: Pick<Recommendation, 'id' | 'title'>,
  input: AcceptInput,
): DecisionsState {
  if (!canRecommendationMove(statusOfRecommendation(state, rec.id), 'accepted')) return state
  return {
    ...state,
    recommendations: { ...state.recommendations, [rec.id]: { status: 'accepted' } },
    added: [
      ...state.added,
      {
        id: input.measureId,
        recommendationId: rec.id,
        title: rec.title,
        responsiblePosition: input.position,
        dueDate: input.dueDate,
        status: 'accepted',
        verification: null,
      },
    ],
  }
}

export function clarify(state: DecisionsState, id: string, comment: string): DecisionsState {
  if (!canRecommendationMove(statusOfRecommendation(state, id), 'clarified')) return state
  return {
    ...state,
    recommendations: { ...state.recommendations, [id]: { status: 'clarified', comment } },
  }
}

/** Причина обов'язкова: порожня причина не змінює стан. */
export function reject(state: DecisionsState, id: string, reason: string): DecisionsState {
  if (!reason.trim()) return state
  if (!canRecommendationMove(statusOfRecommendation(state, id), 'rejected')) return state
  return {
    ...state,
    recommendations: {
      ...state.recommendations,
      [id]: { status: 'rejected', reason: reason.trim() },
    },
  }
}

export function allMeasures(base: Measure[], state: DecisionsState): Measure[] {
  return [...base, ...state.added].map((m) => {
    const s = state.measureStatus[m.id]
    return s ? { ...m, status: s } : m
  })
}

export function setMeasureStatus(
  state: DecisionsState,
  measures: Measure[],
  id: string,
  to: MeasureStatus,
): DecisionsState {
  const m = measures.find((x) => x.id === id)
  if (!m || !canMeasureMove(m.status, to)) return state
  return { ...state, measureStatus: { ...state.measureStatus, [id]: to } }
}
