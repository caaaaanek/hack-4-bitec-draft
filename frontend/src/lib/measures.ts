/** Заходи: прийняті рекомендації з відповідальною посадою (не особою) і строком. */
import type { StatusId } from '@/components/ui/config'

export type MeasureStatus = 'accepted' | 'inprogress' | 'done' | 'confirmed' | 'notconfirmed'
export type Verification =
  'Підтверджено наступним оцінюванням' | 'Не підтверджено, потрібен перегляд'

export interface Measure {
  id: string
  recommendationId: string
  title: string
  /** Синтетична посада, не ім'я. */
  responsiblePosition: string
  /** Дата ISO (рррр-мм-дд). */
  dueDate: string
  /** Збережений статус; «Прострочено» обчислюється (effectiveStatus). */
  status: MeasureStatus
  verification: Verification | null
}

export const VERIFIED: Verification = 'Підтверджено наступним оцінюванням'
export const NOT_VERIFIED: Verification = 'Не підтверджено, потрібен перегляд'

/** Статуси, після яких захід уже не вважається простроченим. */
const CLOSED: MeasureStatus[] = ['done', 'confirmed', 'notconfirmed']

const DAY = 86_400_000
const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

/** Скільки днів захід прострочено на дату `today` (0, якщо не прострочено). */
export function daysOverdue(m: Pick<Measure, 'dueDate' | 'status'>, today: string): number {
  if (CLOSED.includes(m.status)) return 0
  const diff = Math.floor((toUtc(today) - toUtc(m.dueDate)) / DAY)
  return diff > 0 ? diff : 0
}

/** Статус для показу: «Прострочено» обчислюється від строку й переданої дати. */
export function effectiveStatus(m: Pick<Measure, 'dueDate' | 'status'>, today: string): StatusId {
  return daysOverdue(m, today) > 0 ? 'overdue' : m.status
}

/** Ручні переходи. «Підтверджено» й «Не підтверджено» ставить лише наступне оцінювання. */
export const MEASURE_TRANSITIONS: Record<MeasureStatus, MeasureStatus[]> = {
  accepted: ['inprogress'],
  inprogress: ['done', 'accepted'],
  done: ['inprogress'],
  confirmed: [],
  notconfirmed: ['inprogress'],
}

export const canMeasureMove = (from: MeasureStatus, to: MeasureStatus) =>
  MEASURE_TRANSITIONS[from].includes(to)

/** Верифікацію ставить наступне оцінювання, для відкритого заходу вона порожня. */
export const verificationFor = (status: MeasureStatus, v: Verification | null) =>
  status === 'confirmed' || status === 'notconfirmed' ? v : null

export function measureSummary(
  measures: Measure[],
  today: string,
): { total: number; overdue: number } {
  return {
    total: measures.length,
    overdue: measures.filter((m) => daysOverdue(m, today) > 0).length,
  }
}

/** «Прострочено на 11 днів» з правильною формою слова. */
export function overdueText(days: number): string {
  const n = days % 100
  const last = days % 10
  const word =
    n >= 11 && n <= 14 ? 'днів' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дні' : 'днів'
  return `Прострочено на ${days} ${word}`
}
